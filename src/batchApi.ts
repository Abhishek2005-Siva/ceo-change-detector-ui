import { ApiError } from './api'
import type { FilingRow, SlimResult } from './types'

export type BatchStatus = 'queued' | 'collecting' | 'running' | 'done' | 'stopped' | 'interrupted' | 'error'

export interface BatchMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status: BatchStatus
  total: number
  done: number
  errors: number
  parts: number
  message?: string
  live?: boolean
  search?: Record<string, string>
}

export interface PartEntry {
  filing: FilingRow
  result?: SlimResult
  error?: string
}

export const isLive = (s: BatchStatus) => s === 'queued' || s === 'collecting' || s === 'running'
export const isResumable = (s: BatchStatus) => s === 'interrupted' || s === 'stopped' || s === 'error'

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(body.error ?? 'error', body.message ?? `The request failed (${r.status}).`)
  return body as T
}

const post = <T>(body: unknown) => fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r))

export interface CreateBody {
  title: string
  search?: { q: string; forms: string; start: string; end: string; cik: string; item: string }
  filings?: FilingRow[]
}

export const createBatch = (b: CreateBody) => post<{ id: string }>({ action: 'create', ...b })
export const stopBatch = (id: string) => post<{ ok: boolean }>({ action: 'stop', id })
export const resumeBatch = (id: string) => post<{ ok: boolean }>({ action: 'resume', id })
export type LiveBatch = Pick<BatchMeta, 'status' | 'total' | 'done' | 'errors' | 'parts' | 'updatedAt'> & { message?: string; live: true; tail: PartEntry[] }

export const getBatch = (id: string) => fetch(`/api/batch?id=${id}`).then((r) => json<BatchMeta>(r))
export const getPart = (id: string, n: number) => fetch(`/api/batch?id=${id}&part=${n}`).then((r) => json<{ items: PartEntry[] }>(r)).then((r) => r.items)

// ---- "my analyses": there are no accounts, so this browser remembers the links it has started ----
const KEY = 'filinglensAnalyses'
export interface Mine {
  id: string
  title: string
  createdAt: number
}

export function loadMine(): Mine[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((m) => m && typeof m.id === 'string').slice(0, 30) : []
  } catch {
    return []
  }
}

export function remember(m: Mine) {
  try {
    localStorage.setItem(KEY, JSON.stringify([m, ...loadMine().filter((x) => x.id !== m.id)].slice(0, 30)))
  } catch { /* storage unavailable */ }
}

export function forget(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadMine().filter((x) => x.id !== id)))
  } catch { /* storage unavailable */ }
}

/** Progress straight from the model server, plus the finished filings that are not stored yet. Falls back to the stored copy when the server cannot be reached. */
export async function getLive(id: string): Promise<LiveBatch | BatchMeta> {
  const r = await fetch(`/api/batch?id=${id}&live=1`)
  return json<LiveBatch | BatchMeta>(r)
}
