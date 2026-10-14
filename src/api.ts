import type { Company, JobStatus, SearchResponse } from './types'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(body.error ?? 'error', body.message ?? body.error ?? `Request failed (${r.status})`)
  return body as T
}

export interface SearchParams {
  q: string
  forms: string
  start: string
  end: string
  cik: string
  leadership: boolean
  from: number
}

export async function searchFilings(p: SearchParams): Promise<SearchResponse> {
  // Browsing one company with no keywords uses the company filing list (complete and fast).
  if (p.cik && !p.q.trim()) {
    const qs = new URLSearchParams({ cik: p.cik, forms: p.forms, start: p.start, end: p.end, leadership: p.leadership ? '1' : '0' })
    return json(await fetch(`/api/filings?${qs}`))
  }
  const qs = new URLSearchParams({ q: p.q, forms: p.forms, start: p.start, end: p.end, cik: p.cik, leadership: p.leadership ? '1' : '0', from: String(p.from) })
  return json(await fetch(`/api/search?${qs}`))
}

export async function findCompanies(q: string): Promise<Company[]> {
  const r = await json<{ companies: Company[] }>(await fetch(`/api/companies?q=${encodeURIComponent(q)}`))
  return r.companies
}

export async function startAnalysis(cik: string, accession: string): Promise<string> {
  const r = await json<{ id: string }>(
    await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cik, accession }) }),
  )
  return r.id
}

export async function pollJob(id: string): Promise<JobStatus> {
  return json(await fetch(`/api/analyze?job=${id}`))
}

export interface ModelHealth {
  ok: boolean
  loading?: boolean
  waking?: boolean
  error?: string | null
}

/** Asks the model service if it is ready. Asking also wakes it if it is asleep. */
export async function modelHealth(): Promise<ModelHealth> {
  const r = await fetch('/api/analyze?health=1')
  const body = await r.json().catch(() => ({}))
  if (r.status === 503 && body.error === 'not_configured') throw new ApiError('not_configured', body.message)
  return body as ModelHealth
}
