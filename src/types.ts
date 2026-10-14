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

// ---- live search + analysis ----
export interface FilingRow {
  accession: string
  cik: string
  company: string
  ticker: string
  date: string
  form: string
  items: string[]
  location: string
  description: string
  docUrl: string
  indexUrl: string
}

export interface SearchResponse {
  total: number
  from: number
  pageSize: number
  filings: FilingRow[]
  company?: { name: string; ticker: string; cik: string }
}

export interface Company {
  cik: string
  name: string
  ticker: string
}

export interface ReaderVote {
  reader: string
  voted: boolean
  confidence: number | null
}

export interface Extraction {
  found: boolean
  name?: string
  sentence?: string
  sentenceIndex?: number | null
  confidence?: number | null
  votesFor?: number
  readers?: ReaderVote[]
}

export interface SentenceRow {
  text: string
  readers: { reader: string; label: 'NONE' | 'APPOINTED' | 'RESIGNED'; confidence: number; counts: boolean }[]
}

export interface AnalysisResult {
  filing: { cik: string; accession: string; company: string; form: string; filed: string; items: string[]; url: string; characters: number }
  item502Found: boolean
  section: string
  readers?: string[]
  sentences: SentenceRow[]
  appointed: Extraction
  resigned: Extraction
  seconds: number
}

export interface JobStatus {
  id: string
  stage: 'queued' | 'fetching' | 'locating' | 'splitting' | 'reading' | 'done' | 'error'
  progress: number
  sentenceCount?: number
  readersDone?: number
  unitsDone?: number
  unitsTotal?: number
  elapsed?: number
  etaSeconds?: number
  filing?: AnalysisResult['filing']
  result?: AnalysisResult
  error?: string
}
