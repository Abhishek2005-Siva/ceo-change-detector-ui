import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, modelHealth } from '../api'
import { clearStarting, coldEstimate, getStartingAt, markReady, markStarting, readyUntil, recordCold } from '../modelState'
import { fmtSecs } from '../hooks'

type State = 'off' | 'starting' | 'on' | 'error' | 'missing'

export default function ModelPower() {
  const [state, setState] = useState<State>(() => (getStartingAt() !== null ? 'starting' : readyUntil() > Date.now() ? 'on' : 'off'))
  const [secs, setSecs] = useState(0)
  const [msg, setMsg] = useState('')
  const stop = useRef(false)

  // Keep the badge honest: it turns "off" when the server has likely gone back to sleep.
  useEffect(() => {
    const tick = () => {
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
        if (h.ok) {
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
    return (
      <div className="power on" role="status">
        <span className="power-dot" /> AI model on
        <small>sleeps after ~3 min idle</small>
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
    <button type="button" className={`power-btn ${state === 'error' ? 'error' : ''}`} onClick={() => void turnOn()} title={msg || 'Wake the AI model server so filings are analyzed straight away'}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M12 3v9" />
        <path d="M6.4 6.6a8 8 0 1 0 11.2 0" />
      </svg>
      {state === 'error' ? 'Retry: turn on model' : 'Turn on AI model'}
    </button>
  )
}
