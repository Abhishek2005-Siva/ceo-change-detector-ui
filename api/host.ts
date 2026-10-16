import { timingSafeEqual } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { strToU8, zipSync } from 'fflate'
import { ACCOUNTS, DATASET_SLUG, KERNEL_SLUG, type AccountDef } from './_accounts.js'
import { datasetsApi, kaggle, KaggleError, kernelsApi, seconds } from './_kaggle.js'

// Owner-only control of where the model server runs (which Kaggle account's GPU) and when it is on.
//   POST {action:'accounts'}                         -> GPU hours left per account (exhausted accounts are reported separately)
//   POST {action:'start', account, runHours?}        -> starts the server on that account ('auto' = best available)
//   POST {action:'stop'}                             -> stops the running server
//   POST {action:'status'}                           -> which account is running, and how
// Every call needs the owner key in the x-admin-key header.

const MIN_HOURS = 1          // an account with less than this left is treated as out of GPU time
const DEFAULT_RUN_HOURS = 3  // how long one start may run (Kaggle reserves this much quota up front)
const IDLE_MINUTES = 7

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const tokenOf = (a: AccountDef) => process.env[a.env] || ''

interface AccountInfo {
  id: string
  label: string
  main: boolean
  configured: boolean
  adaptersReady: boolean
  usedHours: number
  reservedHours: number
  totalHours: number
  remainingHours: number
  refreshTime: string
  kernel: 'RUNNING' | 'QUEUED' | 'COMPLETE' | 'ERROR' | 'CANCELLED' | 'NONE'
  failureMessage?: string
  error?: string
}

async function inspect(a: AccountDef): Promise<AccountInfo> {
  const base: AccountInfo = {
    id: a.id, label: a.label, main: !!a.main, configured: !!tokenOf(a), adaptersReady: false,
    usedHours: 0, reservedHours: 0, totalHours: 30, remainingHours: 0, refreshTime: '', kernel: 'NONE',
  }
  const token = tokenOf(a)
  if (!token) return { ...base, error: 'No Kaggle token configured for this account.' }
  const [quota, ds, ker] = await Promise.allSettled([
    kaggle(token, kernelsApi, 'GetAcceleratorQuotaStatistics', {}),
    kaggle(token, datasetsApi, 'GetDatasetStatus', { ownerSlug: a.id, datasetSlug: DATASET_SLUG }),
    kaggle(token, kernelsApi, 'GetKernelSessionStatus', { userName: a.id, kernelSlug: KERNEL_SLUG }),
  ])
  const out = { ...base }
  if (quota.status === 'fulfilled') {
    const g = quota.value.gpuQuota ?? {}
    out.usedHours = seconds(g.timeUsed) / 3600
    out.reservedHours = seconds(g.timeReserved) / 3600
    out.totalHours = seconds(g.totalTimeAllowed) / 3600 || 30
    out.remainingHours = Math.max(0, out.totalHours - out.usedHours - out.reservedHours)
    out.refreshTime = quota.value.quotaRefreshTime ?? ''
  } else {
    out.error = `Could not read the GPU quota: ${quota.reason?.message ?? 'unknown error'}`
  }
  out.adaptersReady = ds.status === 'fulfilled' && ds.value.status === 'READY'
  if (ker.status === 'fulfilled') {
    out.kernel = (ker.value.status as AccountInfo['kernel']) ?? 'NONE'
    out.failureMessage = ker.value.failureMessage || undefined
  }
  return out
}

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (n === '__pycache__' || n.endsWith('.pyc')) return []
    return statSync(p).isDirectory() ? listFiles(p) : [p]
  })

/** The kernel script with the app code and secrets filled in (never logged or returned). */
function buildScript(runHours: number): string {
  const root = process.cwd()
  const backend = join(root, 'backend')
  const files: Record<string, Uint8Array> = {}
  for (const f of listFiles(join(backend, 'app'))) files[relative(backend, f).split('\\').join('/')] = new Uint8Array(readFileSync(f))
  const zip = Buffer.from(zipSync(files, { level: 6 })).toString('base64')
  const need = (k: string) => {
    const v = process.env[k]
    if (!v) throw new Error(`The server setting ${k} is missing.`)
    return v
  }
  let s = readFileSync(join(backend, 'kaggle', 'server_template.py'), 'utf8')
  const rep: Record<string, string> = {
    __APP_B64__: zip,
    __API_KEY__: need('MODEL_API_KEY'),
    __SEC_UA__: need('SEC_USER_AGENT'),
    __NGROK_TOKEN__: need('NGROK_AUTHTOKEN'),
    __NGROK_DOMAIN__: need('NGROK_DOMAIN'),
    __RUN_HOURS__: String(runHours),
    __IDLE_MINUTES__: String(IDLE_MINUTES),
  }
  for (const [k, v] of Object.entries(rep)) s = s.split(k).join(v)
  return s
}

async function pushKernel(a: AccountDef, runHours: number) {
  return kaggle<{ url?: string; versionNumber?: number; error?: string }>(tokenOf(a), kernelsApi, 'SaveKernel', {
    slug: `${a.id}/${KERNEL_SLUG}`,
    newTitle: KERNEL_SLUG,
    text: buildScript(runHours),
    language: 'python',
    kernelType: 'script',
    isPrivate: true,
    enableGpu: true,
    enableTpu: false,
    enableInternet: true,
    datasetDataSources: [`${a.id}/${DATASET_SLUG}`],
    competitionDataSources: [],
    kernelDataSources: [],
    modelDataSources: [],
    categoryIds: [],
    sessionTimeoutSeconds: Math.round(runHours * 3600 + 900),
  })
}

/** Stops the server on the given accounts. Kaggle only reports a kernel's latest run, so an older session can still be
 *  running when the status says COMPLETE; deleting the kernel ends every session it has, so do that whenever it exists. */
async function stopRunning(infos: AccountInfo[], only?: string) {
  const stopped: string[] = []
  const targets = infos.filter((i) => i.kernel !== 'NONE' && (!only || i.id === only))
  const url = (process.env.MODEL_URL || '').replace(/\/$/, '')
  if (url && targets.length) {
    // Ask the server to stop itself first (newer versions understand this); deleting the kernel below ends it either way.
    await fetch(`${url}/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY || ''}`, 'ngrok-skip-browser-warning': '1', 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(6000) }).catch(() => undefined)
  }
  for (const i of targets) {
    const def = ACCOUNTS.find((a) => a.id === i.id)!
    try {
      await kaggle(tokenOf(def), kernelsApi, 'DeleteKernel', { userName: i.id, kernelSlug: KERNEL_SLUG })
      stopped.push(i.id)
    } catch { /* already gone */ }
  }
  return stopped
}

const eligible = (i: AccountInfo) => i.configured && i.adaptersReady && i.kernel !== 'RUNNING' && i.kernel !== 'QUEUED' && i.remainingHours >= MIN_HOURS

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const key = process.env.ADMIN_KEY || ''
  if (!key) return res.status(503).json({ error: 'not_configured', message: 'Server control is not set up on this site.' })
  const given = String(req.headers['x-admin-key'] || '')
  if (!given || !same(given, key)) return res.status(401).json({ error: 'unauthorized', message: 'The owner key is missing or wrong.' })

  const body = (req.body ?? {}) as { action?: string; account?: string; runHours?: number; dryRun?: boolean; except?: string }
  try {
    const infos = await Promise.all(ACCOUNTS.map(inspect))

    if (body.action === 'accounts' || body.action === 'status') {
      return res.status(200).json({
        accounts: infos.filter((i) => i.configured && (eligible(i) || i.kernel === 'RUNNING' || i.kernel === 'QUEUED')),
        hidden: infos
          .filter((i) => !(i.configured && (eligible(i) || i.kernel === 'RUNNING' || i.kernel === 'QUEUED')))
          .map((i) => ({ id: i.id, label: i.label, reason: !i.configured ? 'not configured' : !i.adaptersReady ? 'model files not uploaded to this account yet' : i.remainingHours < MIN_HOURS ? 'out of GPU hours' : 'unavailable', remainingHours: i.remainingHours, refreshTime: i.refreshTime })),
        running: infos.find((i) => i.kernel === 'RUNNING' || i.kernel === 'QUEUED')?.id ?? null,
        defaultAccount: ACCOUNTS.find((a) => a.main)?.id ?? ACCOUNTS[0].id,
      })
    }

    if (body.action === 'stop') {
      const stopped = await stopRunning(infos.filter((i) => i.id !== body.except), body.account && body.account !== 'all' ? body.account : undefined)
      return res.status(200).json({ ok: true, stopped })
    }

    if (body.action === 'start') {
      const wanted = body.account && body.account !== 'auto' ? body.account : ''
      const order = [
        ...(wanted ? [wanted] : []),
        ...ACCOUNTS.filter((a) => a.main).map((a) => a.id),
        ...ACCOUNTS.map((a) => a.id),
      ].filter((id, i, arr) => arr.indexOf(id) === i)
      const tried: { account: string; reason: string }[] = []
      for (const id of order) {
        const info = infos.find((i) => i.id === id)!
        const def = ACCOUNTS.find((a) => a.id === id)!
        if (!eligible(info)) {
          tried.push({ account: id, reason: !info.configured ? 'not configured' : !info.adaptersReady ? 'model files not uploaded yet' : info.kernel === 'RUNNING' || info.kernel === 'QUEUED' ? 'already running' : 'out of GPU hours' })
          continue
        }
        const runHours = Math.max(1, Math.min(Number(body.runHours) || DEFAULT_RUN_HOURS, Math.floor(info.remainingHours - 0.25)))
        if (body.dryRun) {
          const script = buildScript(runHours) // proves the app code and secrets are all available; nothing is pushed or stopped
          return res.status(200).json({ ok: true, dryRun: true, account: id, runHours, scriptKB: Math.round(script.length / 1024), remainingHours: info.remainingHours })
        }
        // only one server can hold the public address: stop any other running one first
        await stopRunning(infos.filter((i) => i.id !== id))
        try {
          const r = await pushKernel(def, runHours)
          if (r.error) throw new KaggleError(400, r.error)
          return res.status(200).json({ ok: true, account: id, runHours, url: r.url, remainingHours: info.remainingHours, skipped: tried, bootMinutes: 12 })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'failed'
          tried.push({ account: id, reason: /quota/i.test(msg) ? 'out of GPU hours' : msg.slice(0, 120) })
        }
      }
      return res.status(409).json({ error: 'no_account', message: 'No Kaggle account has GPU time available right now.', tried })
    }

    return res.status(400).json({ error: 'bad_request', message: 'Unknown action.' })
  } catch (e) {
    return res.status(502).json({ error: 'kaggle_error', message: e instanceof Error ? e.message : 'Could not reach Kaggle.' })
  }
}
