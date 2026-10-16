import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, modelHealth } from '../api'
import { clearStarting, coldEstimate, getStartingAt, markReady, markStarting, readyUntil, recordCold } from '../modelState'
import { fmtSecs } from '../hooks'
import ModelStatusPanel, { DEMO, DEMO_MODELS, summarize } from './ModelStatusPanel'

type State = 'off' | 'starting' | 'on' | 'error' | 'missing'

export default function ModelPower() {
  const [state, setState] = useState<State>(() => (DEMO ? 'on' : getStartingAt() !== null ? 'starting' : readyUntil() > Date.now() ? 'on' : 'off'))
  const [secs, setSecs] = useState(0)
  const [msg, setMsg] = useState('')
  const stop = useRef(false)
  const [panel, setPanel] = useState(DEMO)
  const [sum, setSum] = useState<ReturnType<typeof summarize> | null>(DEMO ? summarize(DEMO_MODELS) : null)

  // Keep the badge honest: it turns "off" when the server has likely gone back to sleep.
  useEffect(() => {
    const tick = () => {
      if (DEMO) return
      const left = readyUntil() - Date.now()
      setState((s) => (s === 'on' && left <= 0 ? 'off' : s === 'off' && left > 0 ? 'on' : s))
    }
    const id = window.setInterval(tick, 2000)
    const onStarting = () => setState((s) => (s === 'on' ? s : 'starting'))
    window.addEventListener('model-ready', tick)
    window.addEventListener('model-starting', onStarting)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('model-ready', tick)
      window.removeEventListener('model-starting', onStarting)
    }
  }, [])

  useEffect(() => {
    if (state !== 'starting') return
    const id = window.setInterval(() => {
      const t = getStartingAt()
      setSecs(t === null ? 0 : Math.round((performance.now() - t) / 1000))
    }, 500)
    return () => window.clearInterval(id)
  }, [state])

  useEffect(() => () => { stop.current = true }, [])

  // The server is already awake (we saw it ready moments ago): fetch the status once so the sign can show counts.
  useEffect(() => {
    if (DEMO || state !== 'on' || sum) return
    modelHealth().then((h) => h.models && setSum(summarize(h.models))).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const turnOn = useCallback(async () => {
    stop.current = false
    markStarting()
    const t0 = getStartingAt() ?? performance.now()
    setState('starting')
    setSecs(0)
    setMsg('')
    for (let i = 0; i < 60 && !stop.current; i++) {
      try {
        const h = await modelHealth()
        if (h.hostError) {
          clearStarting()
          setMsg(h.hostError)
          setState('error')
          return
        }
        if (h.ok) {
          if (h.models) setSum(summarize(h.models))
          recordCold((performance.now() - t0) / 1000)
          markReady()
          setState('on')
          return
        }
        if (h.error) {
          clearStarting()
          setMsg(h.error)
          setState('error')
          return
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'not_configured') {
          setState('missing')
          return
        }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    if (!stop.current) {
      clearStarting()
      setMsg('The model did not start in time.')
      setState('error')
    }
  }, [])

  if (state === 'on') {
    const bad = !!sum && sum.problems > 0
    const warming = !!sum && sum.loading > 0 && !bad
    return (
      <div className="power-wrap">
        <button type="button" className={`power on btn-like ${bad ? 'bad' : warming ? 'warm' : ''}`} onClick={() => setPanel((v) => !v)} aria-expanded={panel} aria-haspopup="dialog">
          <span className="power-dot" />
          {bad ? `${sum!.problems} model${sum!.problems === 1 ? '' : 's'} with a problem` : sum ? `AI models on · ${sum.ready}/${sum.total} ready` : 'AI models on'}
          <small>{panel ? 'hide' : 'details'} ▾</small>
        </button>
        {panel && <ModelStatusPanel onClose={() => setPanel(false)} onSummary={setSum} />}
      </div>
    )
  }
  if (state === 'starting') {
    return (
      <div className="power starting" role="status" aria-live="polite">
        <span className="power-dot" /> Starting the model… {secs}s
        <small>{secs < coldEstimate() ? `about ${fmtSecs(coldEstimate() - secs)} left` : 'almost there…'}</small>
      </div>
    )
  }
  if (state === 'missing') {
    return <div className="power error" role="status">Model not connected</div>
  }
  return (
    <div className="power-wrap">
      <button type="button" className={`power-btn ${state === 'error' ? 'error' : ''}`} onClick={() => void turnOn()} title={msg || 'Wake the AI model server so filings are analyzed straight away'}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3v9" />
          <path d="M6.4 6.6a8 8 0 1 0 11.2 0" />
        </svg>
        {state === 'error' ? 'Retry: turn on model' : 'Turn on AI model'}
      </button>
      {state === 'error' && msg && (
        <div className="mstatus" role="alert">
          <p className="explain bad"><b>The model server could not start.</b> {msg}</p>
        </div>
      )}
    </div>
  )
}
