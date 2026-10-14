// One-off data prep: joins the best model's predictions (March 2025, mixed ensemble)
// with the independent ground truth and writes a compact JSON for the UI.
// Mirrors ml/compare_accuracy.py semantics (dedupe by accession number, drop unresolved GT rows).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const predPath = resolve(root, 'ml/kaggle_eval_ensemble/out_mixed_verify/scan_model_ensemble_2025-03-01_2025-03-31.jsonl')
const gtPath = resolve(root, 'checkpoints/8k_2025-03-01_2025-03-31.jsonl')

const load = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))

const dedupe = (rows) => {
  const seen = new Set()
  return rows.filter((r) => (seen.has(r.accession_number) ? false : (seen.add(r.accession_number), true)))
}

const pred = dedupe(load(predPath))
const gtAll = load(gtPath)
const excluded = gtAll.filter((r) => r.row_status !== 'ok').length
const gt = dedupe(gtAll.filter((r) => r.row_status === 'ok'))
const gtBy = new Map(gt.map((r) => [r.accession_number, r]))

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()

// "A (appointed); B (resigned)" -> { appointed: 'A', resigned: 'B' }
const parseNames = (s) => {
  const out = {}
  for (const part of (s || '').split(';')) {
    const m = part.trim().match(/^(.*)\((appointed|resigned)\)$/i)
    if (m) out[m[2].toLowerCase()] = m[1].trim()
  }
  return out
}

const events = []
const counts = {
  appointed: { tp: 0, fp: 0, fn: 0, tn: 0 },
  resigned: { tp: 0, fp: 0, fn: 0, tn: 0 },
}
let scored = 0

for (const p of pred) {
  const g = gtBy.get(p.accession_number)
  if (!g) continue
  scored++
  const gtApp = !!g.ceo_appointed
  const gtRes = g.event_type === 'Both' || g.event_type === 'Resigned'
  const gtNames = parseNames(g.name)
  const parts = clean(g.line).split(' | ')

  const add = (kind, predicted, truth) => {
    const c = counts[kind]
    if (predicted && truth) c.tp++
    else if (predicted && !truth) c.fp++
    else if (!predicted && truth) c.fn++
    else c.tn++
    if (!predicted && !truth) return
    const verdict = predicted && truth ? 'correct' : predicted ? 'false_alarm' : 'missed'
    let truthLine = ''
    if (truth) {
      if (parts.length >= 2) truthLine = kind === 'appointed' ? parts[0] : parts[parts.length - 1]
      else truthLine = parts[0] || ''
    }
    events.push({
      id: `${p.accession_number}-${kind}`,
      company: clean(p.company_name),
      date: p.filing_date,
      url: p.filing_url,
      kind,
      verdict,
      confidence: predicted ? Number((kind === 'appointed' ? p.appointed_confidence : p.resigned_confidence)?.toFixed(4) ?? 0) : null,
      aiSentence: predicted ? clean(kind === 'appointed' ? p.appointed_line : p.resigned_line) : '',
      aiName: predicted ? clean(kind === 'appointed' ? p.appointed_name : p.resigned_name) : '',
      truthName: truth ? gtNames[kind] || '' : '',
      truthSentence: truthLine,
    })
  }
  add('appointed', !!p.ceo_appointed, gtApp)
  add('resigned', !!p.ceo_resigned, gtRes)
}

const metrics = (c) => {
  const precision = c.tp / (c.tp + c.fp || 1)
  const recall = c.tp / (c.tp + c.fn || 1)
  const f1 = (2 * precision * recall) / (precision + recall || 1)
  return { ...c, precision, recall, f1 }
}

const withItem502 = pred.filter((r) => r.item_502_exists).length
const skipped = pred.filter((r) => /Skipped/i.test(r.note || '')).length

events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.company.localeCompare(b.company)))

const out = {
  period: { start: '2025-03-01', end: '2025-03-31', label: 'March 2025' },
  funnel: {
    filings: pred.length,
    withItem502,
    skippedByPrefilter: skipped,
    flaggedAppointed: pred.filter((r) => r.ceo_appointed).length,
    flaggedResigned: pred.filter((r) => r.ceo_resigned).length,
  },
  scoring: { scoredFilings: scored, excludedUnresolved: excluded },
  metrics: { appointed: metrics(counts.appointed), resigned: metrics(counts.resigned) },
  events,
}

writeFileSync(resolve(here, '../src/data/march2025.json'), JSON.stringify(out))
console.log(JSON.stringify({ ...out, events: `${events.length} events` }, null, 2))
