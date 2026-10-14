import { useEffect, useState } from 'react'

/** Re-renders on an interval so countdowns and timers stay live between server updates. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

export const fmtSecs = (s: number): string => {
  const n = Math.max(0, Math.round(s))
  return n >= 60 ? `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s` : `${n}s`
}
