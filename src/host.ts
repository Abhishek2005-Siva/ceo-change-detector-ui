import { ApiError } from './api'

const KEY = 'filinglensOwnerKey'

export const getAdminKey = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}
export const setAdminKey = (v: string) => {
  try {
    localStorage.setItem(KEY, v.trim())
  } catch { /* storage unavailable */ }
}
export const clearAdminKey = () => {
  try {
    localStorage.removeItem(KEY)
  } catch { /* storage unavailable */ }
}

export interface HostAccount {
  id: string
  label: string
  main: boolean
  usedHours: number
  reservedHours: number
  totalHours: number
  remainingHours: number
  refreshTime: string
  kernel: 'RUNNING' | 'QUEUED' | 'COMPLETE' | 'ERROR' | 'CANCELLED' | 'NONE'
  failureMessage?: string
}

export interface HostHidden {
  id: string
  label: string
  reason: string
  remainingHours: number
  refreshTime: string
}

export interface HostAccounts {
  accounts: HostAccount[]
  hidden: HostHidden[]
  running: string | null
  defaultAccount: string
}

export interface StartResult {
  ok: boolean
  account: string
  runHours: number
  remainingHours: number
  bootMinutes: number
  skipped: { account: string; reason: string }[]
}

/** Owner-only calls that decide where the model server runs. Needs the owner key. */
export async function hostCall<T>(action: 'accounts' | 'start' | 'stop' | 'status', extra: Record<string, unknown> = {}): Promise<T> {
  const key = getAdminKey()
  if (!key) throw new ApiError('need_key', 'Enter the owner key to control the server.')
  const r = await fetch('/api/host', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': key }, body: JSON.stringify({ action, ...extra }) })
  const body = await r.json().catch(() => ({}))
  if (r.status === 401) {
    clearAdminKey()
    throw new ApiError('unauthorized', 'That owner key is not right. Please enter it again.')
  }
  if (!r.ok) throw new ApiError(body.error ?? 'error', body.message ?? `The request failed (${r.status}).`)
  return body as T
}
