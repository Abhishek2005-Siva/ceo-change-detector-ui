import Highlight from '../components/Highlight'

const example =
  'On February 28, 2025, the Board of Directors of Douglas Dynamics, Inc. elected Mark Van Genderen, the Company’s then-current Chief Operating Officer, as President and Chief Executive Officer of the Company and a member of the Company’s Board, effective March 3, 2025.'

const steps = [
  {
    n: 1,
    title: 'Collect every filing',
    body: 'We download the full list of 8-K filings the SEC published for the period. Nothing is sampled, so nothing is silently skipped.',
  },
  {
    n: 2,
    title: 'Skip the irrelevant ones',
    body: 'Most 8-Ks are about earnings, loans or contracts. The SEC’s own search tells us which ones contain “Item 5.02”, the section for leadership changes. The rest are set aside, which saves a lot of time.',
  },
  {
    n: 3,
    title: 'Cut the section into sentences',
    body: 'The leadership section is split into individual sentences, taking care not to break at things like “Mr.” or “Inc.”. A bug here was once costing the AI accuracy, and fixing it was one of the biggest wins.',
  },
  {
    n: 4,
    title: 'Three AI readers vote',
    body: 'Each sentence goes to three AI models that were trained on thousands of labelled examples. Each decides: is this a new CEO, a CEO leaving, or neither? Two out of three must agree with high confidence.',
  },
  {
    n: 5,
    title: 'Show the evidence',
    body: 'The result is a list of companies with the exact sentence and a link to the original SEC filing, so a person can verify any answer in seconds.',
  },
]

const glossary = [
  ['8-K', 'A short report US public companies file with the SEC when something important happens.'],
  ['Item 5.02', 'The section of an 8-K about directors and senior officers joining, leaving or changing roles.'],
  ['Precision', 'When the AI says “this is CEO news”, how often is it right? High precision means few false alarms.'],
  ['Recall', 'Of all the real CEO news, how much did the AI find? High recall means few misses.'],
  ['F1 score', 'One number (0 to 1) that balances precision and recall. Higher is better.'],
  ['Answer key', 'The correct answers we score against. Here, an independent large AI model labelled every filing separately.'],
  ['Held-out month', 'A month of filings the AI never saw while learning, like an exam with new questions.'],
  ['Ensemble', 'Several models voting together. Usually steadier than any single one.'],
]

export default function HowItWorks() {
  return (
    <>
      <section className="hero compact">
        <span className="eyebrow">Plain-English walkthrough</span>
        <h1>How the system turns thousands of filings into a short, trustworthy list</h1>
      </section>

      <ol className="steps">
        {steps.map((s) => (
          <li key={s.n} className="card step">
            <span className="step-n">{s.n}</span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section aria-labelledby="h-ex">
        <h2 id="h-ex">A real example</h2>
        <div className="card example">
          <p className="quote">
            <Highlight text={example} names={['Mark Van Genderen']} />
          </p>
          <div className="vote">
            {['Reader A', 'Reader B', 'Reader C'].map((r) => (
              <div key={r} className="voter">
                <span className="check" aria-hidden="true">✓</span>
                <b>{r}</b>
                <span>“New CEO named”</span>
              </div>
            ))}
            <div className="verdict good">
              <b>Result: New CEO named</b>
              <span>Confidence 99.96% · Mark Van Genderen · Douglas Dynamics, March 2025</span>
            </div>
          </div>
          <p className="muted small">The sentence and confidence are real output from the March 2025 run. The three-reader panel is simplified for illustration.</p>
        </div>
      </section>

      <section aria-labelledby="h-trick">
        <h2 id="h-trick">What makes this hard</h2>
        <div className="grid-3">
          <div className="card">
            <h3>Look-alikes</h3>
            <p>“Mr. Lee will <em>continue to serve</em> as CEO” sounds like CEO news but means nobody changed. Many of the system’s early mistakes were exactly this.</p>
          </div>
          <div className="card">
            <h3>Other companies</h3>
            <p>“…to focus on his role as CEO of Acme Corp” is about a different company. The AI has to know whose CEO is being discussed.</p>
          </div>
          <div className="card">
            <h3>One sentence is not much</h3>
            <p>Sometimes the title is in the previous sentence. Giving the AI neighbouring sentences was tried four times and made things worse, so it reads one sentence at a time.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-gl">
        <h2 id="h-gl">Glossary</h2>
        <dl className="glossary">
          {glossary.map(([t, d]) => (
            <div key={t} className="card">
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
