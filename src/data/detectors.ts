// The detectors that run on the site, with the held-out results recorded in the project logs.
// Sources: ml/IMPROVEMENT_LOG.md (CEO), ml/items/_distress/TRACKER.md (1.03, 3.01), ml/items/TRACKER_401_507.md (4.01, 5.07).

export interface DetectorInfo {
  key: string
  item: string
  title: string
  icon: string
  tone: 'blue' | 'red' | 'amber' | 'violet' | 'green'
  what: string
  model: string
  tested: string
  metrics: { label: string; value: string }[]
  caveat?: string
}

export const detectors: DetectorInfo[] = [
  {
    key: 'ceo',
    item: '5.02',
    title: 'CEO appointed or leaving',
    icon: '👤',
    tone: 'green',
    what: 'Finds when a company names a new CEO (including interim) or its CEO resigns, retires or is replaced.',
    model: 'Three AI readers vote: 2× RoBERTa-large + 1× DeBERTa-v3. Reads sentence by sentence.',
    tested: 'March 2025, a month never used in training: 5,626 filings, 192 real CEO events',
    metrics: [
      { label: 'New CEO: alerts that were right', value: '94.7%' },
      { label: 'New CEO: real events found', value: '84.8%' },
      { label: 'CEO leaving: alerts that were right', value: '95.8%' },
      { label: 'CEO leaving: real events found', value: '79.3%' },
    ],
    caveat: 'Average F1 over four unseen months: 0.867.',
  },
  {
    key: 'bankruptcy',
    item: '1.03',
    title: 'Bankruptcy or receivership',
    icon: '⚖',
    tone: 'red',
    what: 'Finds new bankruptcy petitions, receiverships, confirmed reorganization plans and converted or dismissed cases. Pulls out the chapter, court and case number.',
    model: 'Two AI readers (RoBERTa-large + DeBERTa-v3) average their answers on the whole section. Dates are converted to "days before filing" so it can tell new events from old recaps.',
    tested: '149 real events across 7 held-out windows (2024–2026)',
    metrics: [
      { label: 'Alerts that were right', value: '94.7%' },
      { label: 'Real events found', value: '96.0%' },
      { label: 'Held-out events tested', value: '149' },
    ],
    caveat: 'Receivership has only 9 test events. Small samples.',
  },
  {
    key: 'delisting',
    item: '3.01',
    title: 'Delisting or listing notice',
    icon: '⇩',
    tone: 'amber',
    what: 'Finds exchange deficiency notices (such as a share price below $1), delistings, voluntary delistings, exchange transfers and regained compliance. Pulls out the exchange, rule and cure deadline.',
    model: 'Three AI readers (RoBERTa-large ×2 + DeBERTa-v3) average their answers on the whole section.',
    tested: '477 real events across 4 held-out months, hand-checked where labelers disagreed',
    metrics: [
      { label: 'Deficiency notice: right / found', value: '97% / 92%' },
      { label: 'Delisted by exchange: right / found', value: '90% / 89%' },
      { label: 'Voluntary delisting: right / found', value: '95% / 99%' },
      { label: 'Compliance regained: right / found', value: '87% / 100%' },
    ],
    caveat: 'Exchange transfers are the weakest (74% right) and have only 19 test events.',
  },
  {
    key: 'auditor',
    item: '4.01',
    title: 'Change of auditor',
    icon: '✎',
    tone: 'violet',
    what: 'Finds when a company dismisses or loses its auditor or engages a new one, and flags any disagreement, reportable event or adverse audit opinion. Names the firms.',
    model: 'A RoBERTa-base reader plus a rule engine, combined: a flag counts if either one raises it.',
    tested: '348 filings across 5 held-out months',
    metrics: [
      { label: 'Auditor dismissed (F1)', value: '0.986' },
      { label: 'Auditor resigned (F1)', value: '0.972' },
      { label: 'New auditor engaged (F1)', value: '0.982' },
      { label: 'Reportable event (F1)', value: '0.981' },
    ],
    caveat: 'The AI scores about the same as the rules it learned from; "disagreement" is too rare to measure.',
  },
  {
    key: 'votes',
    item: '5.07',
    title: 'Shareholder vote results',
    icon: '☑',
    tone: 'blue',
    what: 'Finds what shareholders voted on: directors, auditor, pay, equity plans, mergers, reverse splits, proposals. Flags votes that failed and reads the vote-count tables.',
    model: 'A RoBERTa-base reader plus a rule engine and a vote-table parser.',
    tested: '589 filings from two fresh months (June 2025, June 2026)',
    metrics: [
      { label: 'Directors elected (F1)', value: '0.989' },
      { label: 'Auditor ratified (F1)', value: '0.991' },
      { label: 'Say-on-pay (F1)', value: '0.994' },
      { label: 'A proposal failed (F1)', value: '0.857' },
    ],
    caveat: 'Mergers and adjournments are weaker (F1 about 0.77–0.78).',
  },
]

export const comingSoon: { title: string; item: string; status: string }[] = [
  { title: 'CFO appointed or leaving', item: '5.02', status: 'Trained and measured (about 96% right on appointments), final model still being prepared' },
  { title: 'Acquisitions and sales of assets', item: '2.01', status: 'Direction (who bought whom) is 90% accurate; not yet packaged' },
  { title: 'Earnings guidance direction', item: '2.02', status: 'Model training, not yet scored' },
  { title: 'Restructuring and impairment charges', item: '2.05 / 2.06', status: 'Labels ready, model not yet trained' },
  { title: 'Unregistered equity sales', item: '3.02', status: 'Early model, no accuracy measure yet' },
  { title: 'Material agreements', item: '1.01 / 1.02', status: 'Tested; not better than simple rules, so not shown' },
]
