import { useEffect, useState } from 'react'
import { forget, getBatch, isLive, loadMine, type BatchMeta, type Mine } from '../batchApi'

const LABEL: Record<BatchMeta['status'], string> = {
  queued: 'Starting', collecting: 'Collecting filings', running: 'Running', done: 'Finished', stopped: 'Stopped', interrupted: 'Paused: server stopped', error: 'Problem',
}

export default function Analyses() {
  const [mine, setMine] = useState<Mine[]>(loadMine)
  const [meta, setMeta] = useState<Record<string, BatchMeta | 'missing'>>({})

  useEffect(() => {
    let alive = true
    mine.slice(0, 12).forEach((m) =>
      getBatch(m.id)
        .then((b) => alive && setMeta((x) => ({ ...x, [m.id]: b })))
        .catch(() => alive && setMeta((x) => ({ ...x, [m.id]: 'missing' }))),
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="page">
      <h1>My analyses</h1>
      <p className="lead">Every “Analyze all results” you start keeps running on the AI server, even when you close the page. Open one here to see its progress or its finished spreadsheet.</p>
      <p className="muted small">There are no accounts, so this list lives in this browser. Anyone with an analysis link can open it; copy the link to open it elsewhere.</p>
      {mine.length === 0 && <p className="empty">You have not started an analysis yet. Run a search, then press “Analyze”.</p>}
      <ul className="analysis-list">
        {mine.map((m) => {
          const b = meta[m.id]
          const info = b && b !== 'missing' ? b : null
          return (
            <li key={m.id} className="card">
              <div>
                <a href={`#/analysis/${m.id}`}><b>{m.title}</b></a>
                <small className="muted block">
                  Started {new Date(m.createdAt).toLocaleString()}
                  {info ? ` · ${LABEL[info.status]} · ${info.done.toLocaleString()} of ${info.total.toLocaleString()} filings` : b === 'missing' ? ' · no longer stored' : ' · checking…'}
                </small>
                {info && isLive(info.status) && <div className="meter" aria-hidden="true"><i style={{ width: `${info.total ? Math.max(2, Math.round((info.done / info.total) * 100)) : 2}%` }} /></div>}
              </div>
              <div className="boot-actions">
                <a className="btn small primary" href={`#/analysis/${m.id}`}>Open</a>
                <button type="button" className="btn small" onClick={() => { forget(m.id); setMine(loadMine()) }} title="Remove from this list (the stored results are kept)">Remove</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
