export type Kind = 'appointed' | 'resigned'
export type Verdict = 'correct' | 'false_alarm' | 'missed'

export interface EventRow {
  id: string
  company: string
  date: string
  url: string
  kind: Kind
  verdict: Verdict
  confidence: number | null
  aiSentence: string
  aiName: string
  truthName: string
  truthSentence: string
}

export interface ClassMetrics {
  tp: number
  fp: number
  fn: number
  tn: number
  precision: number
  recall: number
  f1: number
}

export interface MarchData {
  period: { start: string; end: string; label: string }
  funnel: {
    filings: number
    withItem502: number
    skippedByPrefilter: number
    flaggedAppointed: number
    flaggedResigned: number
  }
  scoring: { scoredFilings: number; excludedUnresolved: number }
  metrics: { appointed: ClassMetrics; resigned: ClassMetrics }
  events: EventRow[]
}
