import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, pollJob, startAnalysis } from '../api'
import Highlight from '../components/Highlight'
import { memory } from '../searchState'
import type { AnalysisResult, Extraction, JobStatus } from '../types'
import { fmtDate, pct } from '../utils'

const STEPS = [
  ['fetching', 'Downloading the filing from the SEC'],
  ['locating', 'Finding the leadership section (Item 5.02)'],
  ['splitting', 'Splitting it into sentences'],
  ['reading', 'Three AI readers read every sentence'],
] as const

const order = ['queued', 'fetching', 'locating', 'splitting', 'reading', 'done']

function Progress({ job }: { job: JobStatus | null }) {
  const idx = job ? order.indexOf(job.stage) : 0
  return (
    <div className="card progress-card" role="status" aria-live="polite">
      <h3>Analyzing this filing…</h3>
      <ol className="psteps">
        {STEPS.map(([id, label], i) => {
          const state = idx > i + 1 ? 'done' : idx === i + 1 ? 'active' : 'todo'
          return (
            <li key={id} className={state}>
              <span className="pdot">{state === 'done' ? '✓' : i + 1}</span>
              <span>
                {label}
                {id === 'reading' && state === 'active' && job?.sentenceCount !== undefined && (
                  <small className="block muted">{job.sentenceCount} sentences · reader {Math.min((job.readersDone ?? 0) + 1, 3)} of 3</small>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="meter big"><i style={{ width: `${Math.round((job?.progress ?? 0.02) * 100)}%` }} /></div>
      <p className="muted small">The first filing after a quiet period can take a minute while the model service wakes up. Usually it takes 10–60 seconds.</p>
    </div>
  )
}

function Panel({ kind, ex }: { kind: 'appointed' | 'resigned'; ex: Extraction }) {
  const title = kind === 'appointed' ? 'New CEO named' : 'CEO leaving'
  return (
    <div className={`card extract ${ex.found ? `found k-${kind}` : 'none'}`}>
      <div className="extract-head">
        <span className={`kind k-${kind}`}>{kind === 'appointed' ? '＋' : '−'}</span>
        <div>
          <h3>{title}</h3>
          <p className="muted small">{ex.found ? `${ex.votesFor} of 3 readers agreed` : 'Not found in this filing'}</p>
        </div>
      </div>
      {ex.found && (
        <>
          <dl className="facts">
            <div><dt>Person</dt><dd>{ex.name || 'Name not captured by the pattern matcher. See the sentence.'}</dd></div>
            <div><dt>Confidence</dt><dd>{ex.confidence != null ? pct(ex.confidence, 2) : '—'}</dd></div>
          </dl>
          <h4>Sentence the AI relied on</h4>
          <blockquote><Highlight text={ex.sentence ?? ''} names={[ex.name ?? '']} /></blockquote>
          <h4>How each reader voted</h4>
          <ul className="votes">
            {ex.readers?.map((r) => (
              <li key={r.reader} className={r.voted ? 'yes' : 'no'}>
                <span aria-hidden="true">{r.voted ? '✓' : '–'}</span>
                <span>{r.reader}</span>
                <b>{r.voted && r.confidence != null ? pct(r.confidence, 1) : 'not sure enough'}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Result({ r }: { r: AnalysisResult }) {
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const data = useMemo(
    () => ({
      company: r.filing.company,
      cik: r.filing.cik,
      accession_number: r.filing.accession,
      form: r.filing.form,
      filing_date: r.filing.filed,
      item_502_present: r.item502Found,
      ceo_appointed: r.appointed.found,
      appointed_name: r.appointed.name ?? '',
      appointed_sentence: r.appointed.sentence ?? '',
      appointed_confidence: r.appointed.confidence ?? null,
      ceo_resigned: r.resigned.found,
      resigned_name: r.resigned.name ?? '',
      resigned_sentence: r.resigned.sentence ?? '',
      resigned_confidence: r.resigned.confidence ?? null,
      source_url: r.filing.url,
    }),
    [r],
  )

  let headline = 'No CEO change found in this filing'
  let tone: 'good' | 'neutral' = 'neutral'
  if (!r.item502Found) headline = 'This filing has no leadership-change section (Item 5.02)'
  else if (r.appointed.found && r.resigned.found) { headline = 'CEO transition: one CEO leaving and a new one named'; tone = 'good' }
  else if (r.appointed.found) { headline = 'A new CEO was named'; tone = 'good' }
  else if (r.resigned.found) { headline = 'A CEO is leaving'; tone = 'good' }

  const rows = showAll ? r.sentences : r.sentences.filter((s) => s.readers.some((x) => x.label !== 'NONE'))

  return (
    <>
      <div className={`banner ${tone}`}>
        <b>{headline}</b>
        <span>Analyzed in {r.seconds}s · {r.sentences.length} sentences read by 3 AI readers</span>
      </div>

      {r.item502Found && (
        <div className="grid-2 tight">
          <Panel kind="appointed" ex={r.appointed} />
          <Panel kind="resigned" ex={r.resigned} />
        </div>
      )}

      {r.item502Found && (
        <section>
          <h2>Everything the AI read</h2>
          <p className="muted">
            Each sentence of the leadership section, with the label every reader gave it. A vote only counts when the reader is at least 70% sure.
          </p>
          <div className="seg" role="group" aria-label="Which sentences">
            <button type="button" className={!showAll ? 'on' : ''} aria-pressed={!showAll} onClick={() => setShowAll(false)}>Flagged by any reader</button>
            <button type="button" className={showAll ? 'on' : ''} aria-pressed={showAll} onClick={() => setShowAll(true)}>All {r.sentences.length}</button>
          </div>
          <div className="sentences">
            {rows.length === 0 && <p className="empty">No sentence looked like a CEO appointment or departure to any reader.</p>}
            {rows.map((s, i) => (
              <div key={i} className="card sent">
                <p><Highlight text={s.text} names={[r.appointed.name ?? '', r.resigned.name ?? '']} /></p>
                <div className="chips">
                  {s.readers.map((x) => (
                    <span key={x.reader} className={`rchip l-${x.label.toLowerCase()} ${x.counts ? 'counts' : ''}`} title={`${x.reader}: ${x.label} ${pct(x.confidence, 1)}`}>
                      {x.reader.split(' · ')[0]}: {x.label === 'NONE' ? 'no CEO change' : x.label === 'APPOINTED' ? 'new CEO' : 'CEO leaving'} · {pct(x.confidence, 0)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Extracted data</h2>
        <div className="card">
          <div className="code-head">
            <span className="muted small">Structured result, ready to copy</span>
            <button
              type="button"
              className="btn small"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })}
            >
              {copied ? 'Copied ✓' : 'Copy JSON'}
            </button>
          </div>
          <pre className="code">{JSON.stringify(data, null, 2)}</pre>
        </div>
      </section>
    </>
  )
}

export default function Filing({ cik, accession }: { cik: string; accession: string }) {
  const [job, setJob] = useState<JobStatus | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const cancelled = useRef(false)

  const sel = memory.selected?.accession === accession ? memory.selected : null
  const meta = job?.result?.filing ?? job?.filing

  useEffect(() => {
    cancelled.current = false
    setJob(null)
    setErr(null)
    let timer: number
    const tick = async (id: string) => {
      try {
        const j = await pollJob(id)
        if (cancelled.current) return
        setJob(j)
        if (j.stage === 'error') return setErr({ code: 'job', message: j.error ?? 'The analysis failed.' })
        if (j.stage !== 'done') timer = window.setTimeout(() => void tick(id), 1500)
      } catch (e) {
        if (cancelled.current) return
        setErr({ code: e instanceof ApiError ? e.code : 'error', message: e instanceof Error ? e.message : 'Lost connection' })
      }
    }
    startAnalysis(cik, accession)
      .then((id) => !cancelled.current && void tick(id))
      .catch((e) => !cancelled.current && setErr({ code: e instanceof ApiError ? e.code : 'error', message: e instanceof Error ? e.message : 'Could not start' }))
    return () => {
      cancelled.current = true
      window.clearTimeout(timer)
    }
  }, [cik, accession])

  const company = meta?.company || sel?.company || `CIK ${cik}`
  const form = meta?.form || sel?.form || '8-K'
  const filed = meta?.filed || sel?.date || ''
  const secUrl = sel?.indexUrl ?? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`

  return (
    <>
      <p className="crumb"><a href="#/search">← Back to search results</a></p>
      <section className="filing-head">
        <span className="eyebrow">{form} filing</span>
        <h1>{company}</h1>
        <p className="muted">
          {filed && `Filed ${fmtDate(filed)} · `}Accession {accession} · CIK {cik}
          {(meta?.items?.length ?? sel?.items.length) ? ` · Items ${(meta?.items?.length ? meta.items : sel?.items ?? []).join(', ')}` : ''}
        </p>
        <a className="btn" href={secUrl} target="_blank" rel="noreferrer">View on SEC.gov ↗</a>
      </section>

      {err ? (
        <div className="card err-card" role="alert">
          <h3>{err.code === 'not_configured' ? 'The model backend isn’t connected yet' : err.code === 'model_unreachable' || err.code === 'model_unavailable' ? 'The model is waking up' : 'We couldn’t analyze this filing'}</h3>
          <p>{err.message}</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>Try again</button>
        </div>
      ) : job?.stage === 'done' && job.result ? (
        <Result r={job.result} />
      ) : (
        <Progress job={job} />
      )}
    </>
  )
}
