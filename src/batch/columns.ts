import type { AnalysisResult, DetectorResult, FilingRow } from '../types'

export type Row = Record<string, string | number>

export const COLUMNS = [
  'Filed', 'Company', 'Ticker', 'CIK', 'Form', 'Items in filing',
  'Events found', 'Event summary',
  'CEO appointed', 'CEO leaving', 'CFO appointed', 'CFO leaving',
  'Bankruptcy', 'Delisting / listing notice', 'Auditor change', 'Shareholder votes',
  'Acquisition / sale', 'Material agreements', 'Unregistered equity sales', 'Earnings guidance', 'Restructuring / impairment',
  'Top confidence', 'Evidence', 'SEC link', 'Accession', 'Status',
] as const

export type Column = (typeof COLUMNS)[number]

const pct = (x?: number | null) => (x == null ? '' : `${(x * 100).toFixed(1)}%`)

const det = (r: AnalysisResult, key: string): DetectorResult | undefined => (r.detectors ?? []).find((d) => d.key === key && d.applicable)

const summarize = (d?: DetectorResult): string =>
  d && d.found ? d.events.map((e) => e.title + (e.detail ? ` (${e.detail})` : '') + (e.confidence != null ? ` [${pct(e.confidence)}]` : '')).join('; ') : ''

const person = (name: string | null | undefined, conf?: number | null, interim?: boolean) =>
  `${name || 'Yes (name not stated)'}${interim ? ' (interim)' : ''}${conf != null ? ` [${pct(conf)}]` : ''}`

/** One spreadsheet row for a filing that was analyzed. */
export function rowFor(f: FilingRow, r: AnalysisResult): Row {
  const cfo = det(r, 'cfo')
  const cfoApp = cfo?.events.find((e) => e.kind === 'appointed')
  const cfoRes = cfo?.events.find((e) => e.kind === 'resigned')
  const dets = (r.detectors ?? []).filter((d) => d.applicable && d.found)
  const titles = [
    ...(r.appointed.found ? ['New CEO named'] : []),
    ...(r.resigned.found ? ['CEO leaving'] : []),
    ...dets.flatMap((d) => d.events.map((e) => e.title)),
  ]
  const confs = [r.appointed.confidence, r.resigned.confidence, ...dets.flatMap((d) => d.events.map((e) => e.confidence))].filter((x): x is number => typeof x === 'number')
  const evidence = r.appointed.sentence || r.resigned.sentence || dets.flatMap((d) => d.events).find((e) => e.evidence)?.evidence || ''
  const inFiling = r.item502Found || (r.detectors ?? []).some((d) => d.applicable)
  return {
    'Filed': f.date,
    'Company': f.company,
    'Ticker': f.ticker,
    'CIK': f.cik,
    'Form': f.form,
    'Items in filing': (r.filing.items?.length ? r.filing.items : f.items).join(', '),
    'Events found': titles.length,
    'Event summary': titles.join('; '),
    'CEO appointed': r.appointed.found ? person(r.appointed.name, r.appointed.confidence) : '',
    'CEO leaving': r.resigned.found ? person(r.resigned.name, r.resigned.confidence) : '',
    'CFO appointed': cfoApp ? person(cfoApp.name, cfoApp.confidence, cfoApp.interim) : '',
    'CFO leaving': cfoRes ? person(cfoRes.name, cfoRes.confidence, cfoRes.interim) : '',
    'Bankruptcy': summarize(det(r, 'bankruptcy')),
    'Delisting / listing notice': summarize(det(r, 'delisting')),
    'Auditor change': summarize(det(r, 'auditor')),
    'Shareholder votes': summarize(det(r, 'votes')),
    'Acquisition / sale': summarize(det(r, 'acquisition')),
    'Material agreements': summarize(det(r, 'agreements')),
    'Unregistered equity sales': summarize(det(r, 'equity')),
    'Earnings guidance': summarize(det(r, 'guidance')),
    'Restructuring / impairment': summarize(det(r, 'restructuring')),
    'Top confidence': confs.length ? Math.round(Math.max(...confs) * 1000) / 10 : '',
    'Evidence': evidence,
    'SEC link': f.indexUrl,
    'Accession': f.accession,
    'Status': inFiling ? 'Analyzed' : 'Analyzed (no tracked item in this filing)',
  }
}

export function errorRow(f: FilingRow, message: string): Row {
  const row: Row = Object.fromEntries(COLUMNS.map((c) => [c, ''])) as Row
  Object.assign(row, { 'Filed': f.date, 'Company': f.company, 'Ticker': f.ticker, 'CIK': f.cik, 'Form': f.form, 'Items in filing': f.items.join(', '), 'SEC link': f.indexUrl, 'Accession': f.accession, 'Status': `Error: ${message}` })
  return row
}
