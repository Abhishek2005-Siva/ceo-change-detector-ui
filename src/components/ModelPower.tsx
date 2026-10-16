import { useEffect, useRef, useState } from 'react'
import { ApiError, modelHealth } from '../api'
import { clearStarting, bootEstimate, getStartingAt, markOff, markReady, markStarting, readyUntil, recordBoot, setStartingEstimate } from '../modelState'
import { fmtSecs } from '../hooks'
import { hostCall, type BootProgress, type StartResult } from '../host'
import ModelStatusPanel, { DEMO, DEMO_MODELS, summarize } from './ModelStatusPanel'
import StartPanel from './StartPanel'
import StartProgress, { finished, type BootEvent, type BootState, type Tunnel } from './StartProgress'

type State = 'off' | 'starting' | 'on' | 'error' | 'missing'

const KAGGLE_LABEL: Record<string, string> = {
  QUEUED: 'waiting in Kaggle’s queue',
  RUNNING: 'the session is running',
  COMPLETE: 'the session ended',
  ERROR: 'the session crashed',
  NONE: 'no session found',
}

type Live = Omit<BootState, 'elapsed' | 'checkedAgo'> & { t0: number; checkedAt: number }

export default function ModelPower() {
  const [state, setState] = useState<State>(() => (DEMO ? 'on' : getStartingAt() !== null ? 'starting' : readyUntil() > Date.now() ? 'on' : 'off'))
  const [msg, setMsg] = useState('')
  const [panel, setPanel] = useState(DEMO)
  const [picker, setPicker] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [sum, setSum] = useState<ReturnType<typeof summarize> | null>(DEMO ? summarize(DEMO_MODELS) : null)
  const [boot, setBoot] = useState<BootState | null>(null)
  const [bootOpen, setBootOpen] = useState(false)
  const run = useRef(0) // bumped to cancel an older watch loop
  const live = useRef<Live>()

  // Keep the badge honest: it turns "off" when the server has probably shut itself down.
  useEffect(() => {
    const tick = () => {
      if (DEMO) return
      const left = readyUntil() - Date.now()
      setState((s) => {
        if (s === 'on' && left <= 0) return 'off'
        if (s === 'off' && left > 0) return 'on'
        // another page (a filing waking the server) finished without us tracking it
        if (s === 'starting' && !live.current && getStartingAt() === null) return left > 0 ? 'on' : 'off'
        return s
      })
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

  // While starting, refresh the tracker's clocks every second.
  useEffect(() => {
    if (state !== 'starting') return
    const id = window.setInterval(() => {
      const l = live.current
      if (!l) return
      setBoot({ ...l, elapsed: Math.round((performance.now() - l.t0) / 1000), checkedAgo: Math.round((Date.now() - l.checkedAt) / 1000) })
    }, 1000)
    return () => window.clearInterval(id)
  }, [state])

  useEffect(() => () => { run.current++ }, [])

  // The server is already awake (we saw it ready moments ago): fetch the status once so the sign can show counts.
  useEffect(() => {
    if (DEMO || state !== 'on' || sum) return
    modelHealth().then((h) => h.models && setSum(summarize(h.models))).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const turnOff = async () => {
    if (!window.confirm('Turn the model server off?\n\nThis stops the Kaggle GPU session for everyone using the site and frees the GPU hours. Starting it again takes about 12 minutes.')) return
    setStopping(true)
    try {
      run.current++
      await hostCall('stop')
      markOff()
      setPanel(false)
      setMsg('')
      setBoot(null)
      live.current = undefined
      setState('off')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not stop the server.')
    } finally {
      setStopping(false)
    }
  }

  /** Follows a server that is booting on Kaggle until it is ready, or reports exactly what went wrong. */
  const watch = async (account: string, estimate: number) => {
    const me = ++run.current
    const alive = () => run.current === me
    setPicker(false)
    setMsg('')
    setStartingEstimate(estimate)
    markStarting()
    setState('starting')
    setBootOpen(true)
    const t0 = performance.now()
    const events: BootEvent[] = []
    const at = () => Math.round((performance.now() - t0) / 1000)
    const log = (text: string, tone?: BootEvent['tone']) => events.push({ at: at(), text, tone })
    let kaggle = ''
    let kaggleUrl = `https://www.kaggle.com/code/${account}/filinglens-server`
    let tunnel: Tunnel = 'unknown'
    let serverUp = false
    let models: BootState['models'] = null
    let failure = ''
    let lastReady = -1
    const publish = () => {
      live.current = { account, estimate, kaggle, kaggleUrl, tunnel, serverUp, models, events: [...events], failure: failure || undefined, t0, checkedAt: Date.now() }
      setBoot({ ...live.current, elapsed: at(), checkedAgo: 0 })
    }
    log(`Asked Kaggle to start the server on ${account}`)
    publish()

    const maxTries = Math.ceil((estimate * 2.5) / 3)
    for (let i = 0; i < maxTries && alive(); i++) {
      // 1) what does Kaggle say about the run?
      if (i % 2 === 0) {
        try {
          const p = await hostCall<BootProgress>('progress', { account })
          kaggleUrl = p.kaggleUrl
          if (p.status !== kaggle) {
            log(`Kaggle: ${KAGGLE_LABEL[p.status] ?? p.status.toLowerCase()}`, p.status === 'ERROR' ? 'bad' : p.status === 'RUNNING' ? 'good' : undefined)
            kaggle = p.status
          }
          if (finished(kaggle) && !serverUp) {
            failure = p.failureMessage || `Kaggle ended the run (${kaggle.toLowerCase()}) before the server came up.`
            log(failure, 'bad')
            break
          }
        } catch { /* a missed status check is not fatal */ }
      }
      // 2) how far has the server itself got?
      try {
        const h = await modelHealth()
        if (!alive()) return
        if (h.hostError) {
          if (h.hostKind === 'blocked') {
            failure = h.hostError
            log(failure, 'bad')
            break
          }
          // ngrok 3200 means the public address is not open yet; any other code means it is open but the server is not up
          const closed = !h.hostCode || h.hostCode === 'ERR_NGROK_3200'
          if (closed && tunnel !== 'closed') { tunnel = 'closed'; log('Installing software; the public address is not open yet') }
          if (!closed && tunnel !== 'open') { tunnel = 'open'; log('Public address is open; the server is starting', 'good') }
        } else {
          if (tunnel !== 'open') { tunnel = 'open'; log('Public address is open', 'good') }
          if (!serverUp) { serverUp = true; log('Server is up; loading the models', 'good') }
          models = h.models ?? models
          const ready = models ? models.filter((m) => m.state === 'ready').length : 0
          const bad = models ? models.filter((m) => m.state === 'error') : []
          if (ready !== lastReady) { lastReady = ready; log(`${ready} of ${models?.length ?? 11} models ready`) }
          bad.forEach((m) => { if (!events.some((e) => e.text.startsWith(m.title))) log(`${m.title} failed to load: ${m.error ?? 'unknown error'}`, 'bad') })
          const settled = !!models && models.every((m) => m.state === 'ready' || m.state === 'error')
          if (h.ok && settled) {
            recordBoot(at())
            if (models) setSum(summarize(models))
            log(bad.length ? `Ready, but ${bad.length} model${bad.length === 1 ? '' : 's'} failed to load` : 'Ready: all models are on', bad.length ? 'warn' : 'good')
            publish()
            setStartingEstimate(null)
            markReady()
            setState('on')
            window.setTimeout(() => { if (run.current === me) setBootOpen(false) }, 4000)
            return
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'not_configured') {
          setState('missing')
          clearStarting()
          return
        }
      }
      publish()
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (!alive()) return
    if (!failure) {
      failure = 'The server did not come up in time. Kaggle may still be installing it. Open the Kaggle log to see.'
      log(failure, 'bad')
    }
    publish()
    clearStarting()
    setMsg(failure)
    setState('error')
  }

  const retry = () => {
    run.current++
    setBoot(null)
    live.current = undefined
    setBootOpen(false)
    clearStarting()
    setMsg('')
    setState('off')
    setPicker(true)
  }

  const progressPanel = bootOpen && boot && <StartProgress b={boot} onRetry={retry} onClose={() => setBootOpen(false)} />

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
        {progressPanel}
        <button type="button" className="power-off" onClick={() => void turnOff()} disabled={stopping || DEMO} title="Stop the Kaggle GPU session">
          {stopping ? 'Stopping…' : 'Turn off'}
        </button>
      </div>
    )
  }
  if (state === 'starting') {
    const e = boot?.elapsed ?? 0
    const est = boot?.estimate ?? bootEstimate()
    return (
      <div className="power-wrap">
        <button type="button" className="power starting btn-like" onClick={() => boot && setBootOpen((v) => !v)} aria-expanded={bootOpen} aria-haspopup="dialog">
          <span className="power-dot" /> Starting{boot ? ` on ${boot.account}` : ' the model'}… {fmtSecs(e)}
          <small>{boot ? `${e < est ? `about ${fmtSecs(est - e)} left` : 'almost there…'} · ${bootOpen ? 'hide' : 'live progress'} ▾` : 'please wait'}</small>
        </button>
        {progressPanel}
      </div>
    )
  }
  if (state === 'missing') {
    return <div className="power error" role="status">Model not connected</div>
  }
  const failed = state === 'error'
  return (
    <div className="power-wrap">
      <button
        type="button"
        className={`power-btn ${failed ? 'error' : ''}`}
        onClick={() => (failed && boot ? setBootOpen((v) => !v) : setPicker((v) => !v))}
        aria-expanded={picker || bootOpen}
        aria-haspopup="dialog"
        title={msg || 'Choose a Kaggle account and start the model server'}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3v9" />
          <path d="M6.4 6.6a8 8 0 1 0 11.2 0" />
        </svg>
        {failed ? 'Server did not start: see why' : 'Turn on AI model'}
      </button>
      {picker && <StartPanel onClose={() => setPicker(false)} onStarted={(r: StartResult) => void watch(r.account, bootEstimate())} onAlreadyRunning={(account) => void watch(account, bootEstimate())} />}
      {failed && !boot && msg && !picker && (
        <div className="mstatus" role="alert">
          <p className="explain bad"><b>The model server could not start.</b> {msg}</p>
        </div>
      )}
      {failed && progressPanel}
    </div>
  )
}
