export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`
export const num = (x: number) => x.toLocaleString('en-US')

export const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const verdictLabel = {
  correct: 'Confirmed correct',
  false_alarm: 'False alarm',
  missed: 'Missed by the AI',
} as const

export const kindLabel = {
  appointed: 'New CEO named',
  resigned: 'CEO leaving',
} as const
