import type { SearchParams } from './api'
import type { Row } from './batch/columns'
import type { Company, FilingRow, SearchResponse } from './types'

// Remembers the last search so "Back to results" restores it instead of starting over.
export interface SearchMemory {
  params: SearchParams
  company: Company | null
  response: SearchResponse | null
}

export const memory: { search: SearchMemory | null; selected: FilingRow | null; batch: { rows: Row[]; label: string } | null } = { search: null, selected: null, batch: null }
