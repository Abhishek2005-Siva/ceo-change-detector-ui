import type { VercelRequest, VercelResponse } from '@vercel/node'
import { one } from './_sec.js'

// Thin, authenticated proxy to the private model service (hosted on Modal).
// POST  {cik, accession}  -> {id}        start analysing a filing
// GET   ?job=<id>         -> job status/result
// GET   ?health=1         -> model readiness
const SPACE = (process.env.MODEL_URL || '').replace(/\/$/, '')
const TOKEN = process.env.MODEL_API_KEY || ''

async function call(path: string, init?: RequestInit) {
  return fetch(`${SPACE}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!SPACE) {
    return res.status(503).json({ error: 'not_configured', message: 'The model backend is not connected yet.' })
  }
  try {
    if (req.method === 'POST') {
      const { cik, accession } = (req.body ?? {}) as { cik?: string; accession?: string }
      if (!/^\d{1,10}$/.test(String(cik)) || !/^\d{10}-\d{2}-\d{6}$/.test(String(accession))) {
        return res.status(400).json({ error: 'bad_request', message: 'A valid CIK and accession number are required.' })
      }
      const r = await call('/jobs', { method: 'POST', body: JSON.stringify({ cik: String(cik), accession }) })
      const body = await r.json().catch(() => ({}))
      return res.status(r.status).json(r.ok ? body : { error: 'model_unavailable', message: body.detail || 'The model service is not ready.' })
    }
    if (one(req.query.health)) {
      // Pinging a sleeping service starts it. Don't hold the request open while it boots:
      // answer "waking" after a few seconds and let the browser ask again.
      try {
        const r = await call('/health', { signal: AbortSignal.timeout(8000) })
        return res.status(200).json(await r.json().catch(() => ({ ok: false, loading: true })))
      } catch {
        return res.status(200).json({ ok: false, loading: true, waking: true })
      }
    }
    const job = one(req.query.job)
    if (!/^[a-f0-9]{6,32}$/.test(job)) return res.status(400).json({ error: 'bad_request', message: 'Missing job id.' })
    const r = await call(`/jobs/${job}`)
    return res.status(r.status).json(await r.json().catch(() => ({ error: 'bad_response' })))
  } catch (e) {
    // A sleeping Space can take a minute to wake; the UI shows this as "waking up".
    return res.status(502).json({ error: 'model_unreachable', message: 'The model service is waking up. Try again in a minute.', detail: String(e) })
  }
}
