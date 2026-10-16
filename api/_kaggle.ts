// Minimal client for Kaggle's REST API (the same one the `kaggle` CLI uses).
const BASE = 'https://api.kaggle.com/v1'

export class KaggleError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function kaggle<T = any>(token: string, service: string, method: string, body: object): Promise<T> {
  const r = await fetch(`${BASE}/${service}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  const text = await r.text()
  let json: any = {}
  try {
    json = JSON.parse(text)
  } catch { /* keep empty */ }
  if (!r.ok || json?.error) throw new KaggleError(json?.error?.code ?? r.status, json?.error?.message ?? text.slice(0, 200))
  return json as T
}

/** "77273.248s" -> 77273.248 */
export const seconds = (d?: string): number => (d ? parseFloat(d.replace('s', '')) || 0 : 0)

export const kernelsApi = 'kernels.KernelsApiService'
export const datasetsApi = 'datasets.DatasetApiService'
