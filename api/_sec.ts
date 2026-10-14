// Shared helpers for the SEC-facing serverless functions.
export const UA = process.env.SEC_USER_AGENT || 'LeadershipChangeDetector contact@example.com'

export async function secFetch(url: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
}

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, '').padStart(10, '0')
export const noDashes = (acc: string) => acc.replace(/-/g, '')

export const indexUrl = (cik: string | number, acc: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${noDashes(acc)}/${acc}-index.htm`

export const docUrl = (cik: string | number, acc: string, file: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${noDashes(acc)}/${file}`

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

export const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? ''
