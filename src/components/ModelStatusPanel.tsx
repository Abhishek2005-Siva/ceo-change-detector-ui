import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { modelHealth, runSelfTest } from '../api'
import type { ModelStatus, SelfTestResult } from '../types'

export const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('statusdemo')

// Sample data for previewing the sign and panel (open the site with ?statusdemo). Not real model state.
export const DEMO_MODELS: ModelStatus[] = [
  { key: 'ceo', item: '5.02', title: 'CEO appointed or leaving', state: 'ready', adapters: 3, loadSeconds: 7.7 },
  { key: 'cfo', item: '5.02', title: 'CFO appointed or leaving', state: 'ready', adapters: 4, loadSeconds: 9.1 },
  { key: 'bankruptcy', item: '1.03', title: 'Bankruptcy or receivership', state: 'ready', adapters: 2, loadSeconds: 5.2 },
  { key: 'delisting', item: '3.01', title: 'Delisting or listing notice', state: 'loading', adapters: 3 },
  { key: 'auditor', item: '4.01', title: 'Change of auditor', state: 'error', adapters: 1, error: 'FileNotFoundError: adapter_model.safetensors is missing' },
  { key: 'votes', item: '5.07', title: 'Shareholder vote results', state: 'ready', adapters: 1, loadSeconds: 2.4, lastError: 'ValueError: could not parse a vote table' },
  { key: 'guidance', item: '2.02', title: 'Earnings guidance direction', state: 'off', adapters: 1 },
]

const LABEL: Record<string, string> = { ready: 'On', loading: 'Starting', off: 'Off', error: 'Problem' }

/** Summary used by the header sign: how many models are ready and whether any has a problem. */
export function summarize(models: ModelStatus[]) {
  const problems = models.filter((m) => m.state === 'error' || m.lastError)
  const ready = models.filter((m) => m.state === 'ready')
  return { total: models.length, ready: ready.length, problems: problems.length, loading: models.filter((m) => m.state === 'loading' || m.state === 'off').length }
}

export default function ModelStatusPanel({ onClose, onSummary }: { onClose: () => void; onSummary: (s: ReturnType<typeof summarize>) => void }) {
  const [models, setModels] = useState<ModelStatus[] | null>(null)
  const [tests, setTests] = useState<Record<string, SelfTestResult>>({})
  const [testing, setTesting] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)

  // Keep the panel fully on screen wherever the header button ends up.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    const dx = r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0
    if (dx) el.style.transform = `translateX(${dx}px)`
  })

  const refresh = useCallback(async () => {
    if (DEMO) {
      setModels(DEMO_MODELS)
      onSummary(summarize(DEMO_MODELS))
      return
    }
    try {
      const h = await modelHealth()
      if (h.hostError) {
        setErr(h.hostError)
        return
      }
      if (h.models) {
        setModels(h.models)
        onSummary(summarize(h.models))
      }
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach the model server.')
    }
  }, [onSummary])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 4000) // only while the panel is open
    return () => window.clearInterval(id)
  }, [refresh])

  const test = async () => {
    setTesting(true)
    setErr('')
    try {
      const r = await runSelfTest()
      setTests(Object.fromEntries(r.results.map((x) => [x.key, x])))
      setModels(r.models)
      onSummary(summarize(r.models))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The self-test failed.')
    } finally {
      setTesting(false)
    }
  }

  const sum = models ? summarize(models) : null

  return (
    <div className="mstatus" role="dialog" aria-label="Model status" ref={box}>
      <div className="mstatus-head">
        <div>
          <b>Model status</b>
          <small className="muted block">
            {sum ? (sum.problems ? `${sum.problems} with a problem · ` : '') + `${sum.ready} of ${sum.total} ready` : 'Checking…'}
          </small>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close model status">×</button>
      </div>

      {err && <p className="explain bad" role="alert">{err}</p>}
      {!models && !err && <p className="muted small">Asking the model server…</p>}

      <ul className="mlist">
        {models?.map((m) => {
          const t = tests[m.key]
          const bad = m.state === 'error' || !!m.lastError || (t && !t.ok)
          const tone = bad ? 'error' : m.state
          return (
            <li key={m.key} className={`mrow s-${tone}`}>
              <span className="mdot" aria-hidden="true" />
              <div className="mmain">
                <b>{m.title}</b>
                <small>
                  Item {m.item} · {m.adapters} model{m.adapters === 1 ? '' : 's'}
                  {m.loadSeconds ? ` · loaded in ${m.loadSeconds}s` : ''}
                </small>
                {m.error && <small className="bad-text block">Could not load: {m.error}</small>}
                {m.lastError && <small className="bad-text block">Last filing failed: {m.lastError}</small>}
                {t && !t.ok && (
                  <small className="bad-text block">
                    Self-test failed: {t.error ?? t.models.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error}`).join('; ')}
                  </small>
                )}
                {t?.ok && <small className="ok-text block">Self-test passed ({t.models.length} model{t.models.length === 1 ? '' : 's'}, {t.ms} ms)</small>}
              </div>
              <span className={`mlabel s-${tone}`}>{bad ? 'Problem' : LABEL[m.state]}</span>
            </li>
          )
        })}
      </ul>

      <div className="mstatus-foot">
        <button type="button" className="btn small" onClick={() => void test()} disabled={testing || !models}>
          {testing ? 'Testing every model…' : 'Run self-test'}
        </button>
        <small className="muted">The self-test runs each model once to confirm it loads and gives a valid answer. “Off” means the model has not been loaded yet.</small>
      </div>
    </div>
  )
}
