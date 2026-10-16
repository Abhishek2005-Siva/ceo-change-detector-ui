import { ApiError, pollJob, startAnalysis } from './api'
import type { AnalysisResult } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Analyzes one filing end to end: start a job, poll until done. Retries while the model server wakes up. */
export async function runAnalysis(cik: string, accession: string, signal?: AbortSignal): Promise<AnalysisResult> {
  let id = ''
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    try {
      id = await startAnalysis(cik, accession)
      break
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      if ((code === 'model_unavailable' || code === 'model_unreachable') && attempt < 60) {
        await sleep(3000)
        continue
      }
      throw e
    }
  }
  for (let i = 0; i < 600; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const j = await pollJob(id)
    if (j.stage === 'done' && j.result) return j.result
    if (j.stage === 'error') throw new Error(j.error ?? 'The analysis failed.')
    await sleep(700)
  }
  throw new Error('The analysis timed out.')
}
