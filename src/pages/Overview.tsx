import { march } from '../data/march'
import { num, pct } from '../utils'
import Stat from '../components/Stat'
import Dots from '../components/Dots'
import BarChart from '../components/BarChart'

const progress = [
  { label: 'First reliable model', sub: 'DistilBERT (small)', value: 0.8126 },
  { label: 'Bigger reader', sub: 'RoBERTa-base', value: 0.8207 },
  { label: 'Three readers voting', sub: 'RoBERTa-base ×3', value: 0.839 },
  { label: 'Large reader', sub: 'RoBERTa-large ×3', value: 0.8537 },
  { label: 'Mixed team (best)', sub: 'RoBERTa-large ×2 + DeBERTa', value: 0.8673, highlight: true },
]

export default function Overview() {
  const { metrics: m, funnel: f } = march
  const apptReal = m.appointed.tp + m.appointed.fn
  const resgReal = m.resigned.tp + m.resigned.fn
  const flagged = m.appointed.tp + m.appointed.fp + m.resigned.tp + m.resigned.fp
  const correct = m.appointed.tp + m.resigned.tp
  const falseAlarms = m.appointed.fp + m.resigned.fp

  return (
    <>
      <section className="hero">
        <span className="eyebrow">Best model found across all tests</span>
        <h1>An AI that reads company filings and tells you when a CEO is hired or leaves.</h1>
        <p className="lead">
          When a US public company changes its CEO, it must tell the SEC in a short public document called an <strong>8-K</strong>. Thousands of these are filed
          every month, almost all about something else. This system reads every one, finds the CEO news, and shows you the exact sentence it relied on.
        </p>
        <div className="hero-actions">
          <a className="btn primary" href="#/results">Browse real results</a>
          <a className="btn" href="#/how">See how it works</a>
        </div>
      </section>

      <section aria-labelledby="h-proof">
        <h2 id="h-proof">How well did it do? <span className="tag">Tested on {march.period.label}, a month the AI never saw during training</span></h2>
        <div className="grid-4">
          <Stat big={pct(m.appointed.precision, 0)} title="of “new CEO” alerts were right" tone="green">
            {m.appointed.tp} of {m.appointed.tp + m.appointed.fp} appointment alerts were genuine. Only {m.appointed.fp} false alarms.
          </Stat>
          <Stat big={pct(m.appointed.recall, 0)} title="of real new-CEO news was caught" tone="blue">
            Found {m.appointed.tp} of {apptReal} real appointments. The other {m.appointed.fn} slipped past.
          </Stat>
          <Stat big={pct(m.resigned.precision, 0)} title="of “CEO leaving” alerts were right" tone="green">
            {m.resigned.tp} of {m.resigned.tp + m.resigned.fp} departure alerts were genuine. Only {m.resigned.fp} false alarms.
          </Stat>
          <Stat big={pct(m.resigned.recall, 0)} title="of real departures were caught" tone="violet">
            Found {m.resigned.tp} of {resgReal} real departures. Departures are harder because they are phrased in more ways.
          </Stat>
        </div>
        <p className="note">
          Think of it as a careful assistant: when it raises its hand, it is almost always right. It is a little more cautious than perfect, so it occasionally misses a case.
        </p>
      </section>

      <section aria-labelledby="h-dots">
        <h2 id="h-dots">Every real CEO event in {march.period.label}, and what the AI did with it</h2>
        <div className="grid-2">
          <div className="card">
            <h3>New CEO named — {apptReal} real events</h3>
            <Dots found={m.appointed.tp} missed={m.appointed.fn} label="New CEO named" />
            <p className="legend">
              <span className="dot found" /> found ({m.appointed.tp}) <span className="dot miss" /> missed ({m.appointed.fn})
              <span className="pill warn">+{m.appointed.fp} false alarms</span>
            </p>
          </div>
          <div className="card">
            <h3>CEO leaving — {resgReal} real events</h3>
            <Dots found={m.resigned.tp} missed={m.resigned.fn} label="CEO leaving" />
            <p className="legend">
              <span className="dot found" /> found ({m.resigned.tp}) <span className="dot miss" /> missed ({m.resigned.fn})
              <span className="pill warn">+{m.resigned.fp} false alarms</span>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-funnel">
        <h2 id="h-funnel">From a mountain of filings to a short list</h2>
        <div className="funnel">
          <div className="funnel-step" style={{ ['--w' as string]: '100%' }}>
            <b>{num(f.filings)}</b>
            <span>8-K filings filed in {march.period.label}</span>
          </div>
          <div className="funnel-step" style={{ ['--w' as string]: '62%' }}>
            <b>{num(f.withItem502)}</b>
            <span>mention a change in directors or officers (the only ones worth reading closely)</span>
          </div>
          <div className="funnel-step" style={{ ['--w' as string]: '34%' }}>
            <b>{flagged}</b>
            <span>CEO events flagged (new CEO named or CEO leaving)</span>
          </div>
          <div className="funnel-step good" style={{ ['--w' as string]: '28%' }}>
            <b>{correct}</b>
            <span>confirmed correct · {falseAlarms} false alarms</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-prog">
        <h2 id="h-prog">How we picked the best model</h2>
        <div className="grid-2 tight">
          <div className="card">
            <h3>Overall accuracy score, tested on four unseen months</h3>
            <BarChart bars={progress} min={0.8} max={0.875} ariaLabel="Overall accuracy score of each model generation, rising from 0.8126 to 0.8673" />
          </div>
          <div className="card">
            <h3>The winner: a panel of three AI readers</h3>
            <p>
              Instead of trusting one AI, three different ones read every sentence. Two are <strong>RoBERTa-large</strong> models and one is <strong>DeBERTa-v3</strong>,
              a different design with different strengths. A sentence is flagged only if at least two of them agree <em>and</em> are at least 70% sure.
            </p>
            <p className="muted">
              Mixing different designs beat using three copies of the same one in all four test months. Its overall score: <strong>0.867</strong> out of 1.
            </p>
            <a className="btn" href="#/models">Read the full comparison</a>
          </div>
        </div>
      </section>
    </>
  )
}
