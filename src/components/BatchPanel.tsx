import { useEffect, useMemo, useRef, useState } from 'react'
import { runAnalysis } from '../analyze'
import { ApiError, searchFilings, type SearchParams } from '../api'
import { COLUMNS, errorRow, rowFor, type Row } from '../batch/columns'
import { downloadCsv, downloadXlsx } from '../batch/export'
import { fmtSecs } from '../hooks'
import { memory } from '../searchState'
import type { Company, FilingRow } from '../types'

const PAGE = 100
const CAP = 300       // most filings one batch will take, so a run stays reasonable
const PARALLEL = 4    // filings analyzed at the same time

type Status = 'idle' | 'collecting' | 'running' | 'done' | 'cancelled' | 'error'
type SortKey = 'Filed' | 'Company' | 'Events found'

interface Props {
  filings: FilingRow[]
  total: number
  params: SearchParams
  company: Company | null
}

const STICKY = new Set(['Company'])

export default function BatchPanel({ filings, total, params, company }: Props) {
  const saved = memory.batch
  const [scope, setScope] = useState<'page' | 'all'>('page')
  const [status, setStatus] = useState<Status>(saved ? 'done' : 'idle')
  const [rows, setRows] = useState<Row[]>(saved?.rows ?? [])
  const [expected, setExpected] = useState(saved?.rows.length ?? 0)
  const [message, setMessage] = useState('')
  const [t0, setT0] = useState(0)
  const [now, setNow] = useState(0)
  const [filter, setFilter] = useState('')
  const [onlyEvents, setOnlyEvents] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'Events found', dir: -1 })
  const [exporting, setExporting] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const label = useRef(saved?.label ?? '')

  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [status])

  const more = total > filings.length
  const toAnalyze = scope === 'all' ? Math.min(total, CAP) : filings.length

  const start = async () => {
    const ac = new AbortController()
    abort.current = ac
    setRows([])
    setMessage('')
    setStatus('collecting')
    label.current = `${params.start || 'all dates'} to ${params.end || 'today'}${company ? `, ${company.name}` : ''}${params.q ? `, "${params.q}"` : ''}`

    // 1) gather the filings to analyze (the shown page, or more pages of the same search)
    let list: FilingRow[] = [...filings]
    try {
      if (scope === 'all') {
        for (let from = filings.length; list.length < Math.min(total, CAP) && from < Math.min(total, 10000); ) {
          if (ac.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
          const r = await searchFilings({ ...params, cik: company?.cik ?? '', from })
          if (!r.filings.length) break
          const seen = new Set(list.map((f) => f.accession))
          list = list.concat(r.filings.filter((f) => !seen.has(f.accession)))
          from += PAGE
          if (company && !params.q.trim()) break // company browse returns everything at once
        }
        list = list.slice(0, CAP)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return setStatus('cancelled')
      setMessage(e instanceof Error ? e.message : 'Could not load the other pages of results.')
      return setStatus('error')
    }

    setExpected(list.length)
    setT0(Date.now())
    setNow(Date.now())
    setStatus('running')

    // 2) analyze them a few at a time
    const done = new Map<string, Row>()
    const queue = [...list]
    let fatal = ''
    const flush = () => setRows(list.map((f) => done.get(f.accession)).filter((r): r is Row => !!r))
    const worker = async () => {
      while (!ac.signal.aborted && !fatal) {
        const f = queue.shift()
        if (!f) return
        try {
          const r = await runAnalysis(f.cik, f.accession, ac.signal)
          done.set(f.accession, rowFor(f, r))
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          const code = e instanceof ApiError ? e.code : ''
          if (code === 'model_host' || code === 'not_configured') {
            fatal = e instanceof Error ? e.message : 'The model server is not available.'
            return
          }
          done.set(f.accession, errorRow(f, e instanceof Error ? e.message : 'failed'))
        }
        flush()
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker))
    flush()
    if (ac.signal.aborted) return setStatus('cancelled')
    if (fatal) {
      setMessage(fatal)
      return setStatus('error')
    }
    setStatus('done')
    memory.batch = { rows: list.map((f) => done.get(f.accession)).filter((r): r is Row => !!r), label: label.current }
  }

  const cancel = () => abort.current?.abort()

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase()
    let out = rows.filter((r) => (!onlyEvents || Number(r['Events found']) > 0) && (!t || Object.values(r).some((v) => String(v).toLowerCase().includes(t))))
    out = [...out].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return c * sort.dir || String(a.Company).localeCompare(String(b.Company))
    })
    return out
  }, [rows, filter, onlyEvents, sort])

  const withEvents = rows.filter((r) => Number(r['Events found']) > 0).length
  const errors = rows.filter((r) => String(r.Status).startsWith('Error')).length
  const running = status === 'running' || status === 'collecting'
  const elapsed = t0 ? (now - t0) / 1000 : 0
  const eta = rows.length > 2 ? (elapsed / rows.length) * (expected - rows.length) : null
  const fileBase = `filinglens_${(params.start || 'all').replace(/-/g, '')}_${(params.end || 'now').replace(/-/g, '')}_${rows.length}filings`
  const about: [string, string][] = [
    ['Created by', 'FilingLens (SEC 8-K event detector)'],
    ['Created', new Date().toLocaleString()],
    ['Search', label.current || '—'],
    ['Filings analyzed', String(rows.length)],
    ['Filings with at least one event', String(withEvents)],
    ['How to read this', 'Each row is one SEC filing. Event columns show what the AI found, the person or detail, and in [brackets] how sure it is. Blank means nothing found for that event type.'],
    ['Caveats', 'AI output with imperfect accuracy; check the evidence sentence and the SEC link. Experimental detectors (CFO, acquisitions, agreements, equity sales, guidance, restructuring) have thinner testing.'],
  ]

  const exportXlsx = async () => {
    setExporting(true)
    try {
      await downloadXlsx(shown, `${fileBase}.xlsx`, about)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not build the Excel file.')
    } finally {
      setExporting(false)
    }
  }

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (-s.dir as 1 | -1) } : { key, dir: key === 'Events found' ? -1 : 1 }))
  const open = (r: Row) => (window.location.hash = `#/filing/${r.CIK}/${r.Accession}`)

  return (
    <section className="batch card" aria-labelledby="h-batch">
      <div className="batch-head">
        <div>
          <h2 id="h-batch">Analyze all results</h2>
          <p className="muted small">Runs every filing in these results through all of the AI detectors and puts the answers in a spreadsheet you can view here and download.</p>
        </div>
        {!running ? (
          <button type="button" className="btn primary" onClick={() => void start()} disabled={!filings.length}>
            {rows.length ? 'Run again' : `Analyze ${toAnalyze} filing${toAnalyze === 1 ? '' : 's'}`}
          </button>
        ) : (
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
        )}
      </div>

      {more && !running && (
        <fieldset className="scope">
          <legend className="sr-only">Which results to analyze</legend>
          <label><input type="radio" name="scope" checked={scope === 'page'} onChange={() => setScope('page')} /> The {filings.length} results on this page</label>
          <label><input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All pages ({Math.min(total, CAP).toLocaleString()} of {total.toLocaleString()} results{total > CAP ? `; capped at ${CAP}` : ''})</label>
        </fieldset>
      )}

      {running && (
        <div className="batch-progress" role="status" aria-live="polite">
          <div className="meter big"><i style={{ width: `${expected ? Math.max(2, Math.round((rows.length / expected) * 100)) : 4}%` }} /></div>
          <p className="muted small">
            {status === 'collecting' ? 'Collecting the filings from the other pages…' : `Analyzed ${rows.length} of ${expected} · ${withEvents} with events${errors ? ` · ${errors} errors` : ''} · ${fmtSecs(elapsed)} elapsed${eta != null ? ` · about ${fmtSecs(eta)} left` : ''}`}
          </p>
        </div>
      )}

      {status === 'error' && <p className="explain bad" role="alert">{message}</p>}
      {status === 'cancelled' && <p className="explain warn">Cancelled. The {rows.length} filings analyzed so far are shown below and can be downloaded.</p>}
      {status === 'done' && message && <p className="explain bad">{message}</p>}

      {rows.length > 0 && (
        <>
          <div className="sheet-bar">
            <div className="sheet-stats"><b>{rows.length}</b> filings · <b>{withEvents}</b> with events{errors ? <> · <b className="bad-text">{errors}</b> errors</> : null}</div>
            <input type="search" placeholder="Filter the sheet…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter the sheet" />
            <label className="check-line"><input type="checkbox" checked={onlyEvents} onChange={(e) => setOnlyEvents(e.target.checked)} /> <span>Only filings with events</span></label>
            <div className="sheet-actions">
              <button type="button" className="btn small" onClick={() => downloadCsv(shown, `${fileBase}.csv`)}>Download CSV</button>
              <button type="button" className="btn small primary" onClick={() => void exportXlsx()} disabled={exporting}>{exporting ? 'Building…' : 'Download Excel (.xlsx)'}</button>
            </div>
          </div>
          <p className="muted small">Showing {shown.length} row{shown.length === 1 ? '' : 's'}. Downloads include exactly the rows shown. Click a company to open its full analysis; click Filed, Company or Events found to sort.</p>
          <div className="sheet-wrap" tabIndex={0} role="region" aria-label="Analysis spreadsheet">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="rownum" aria-hidden="true">#</th>
                  {COLUMNS.map((c) => {
                    const sortable = c === 'Filed' || c === 'Company' || c === 'Events found'
                    return (
                      <th key={c} className={STICKY.has(c) ? 'sticky' : ''} scope="col" aria-sort={sortable && sort.key === c ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                        {sortable ? <button type="button" className="th-btn" onClick={() => sortBy(c as SortKey)}>{c}{sort.key === c ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button> : c}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={String(r.Accession)}>
                    <td className="rownum">{i + 1}</td>
                    {COLUMNS.map((c) => {
                      const v = r[c] ?? ''
                      if (c === 'Company') return <td key={c} className="sticky"><button type="button" className="linklike" onClick={() => open(r)}>{v}</button></td>
                      if (c === 'SEC link') return <td key={c}>{v ? <a href={String(v)} target="_blank" rel="noreferrer">Open ↗</a> : ''}</td>
                      const isEvent = c !== 'Events found' && COLUMNS.indexOf(c) >= 8 && COLUMNS.indexOf(c) <= 20 && !!v
                      return <td key={c} className={`${isEvent ? 'hit' : ''} ${c === 'Events found' || c === 'Top confidence' ? 'num' : ''} ${String(v).startsWith('Error') ? 'err' : ''}`} title={String(v)}>{v}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
