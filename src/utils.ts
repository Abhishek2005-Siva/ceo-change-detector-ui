export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`
export const num = (x: number) => x.toLocaleString('en-US')

export const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** The date a change takes effect, in words: a calendar date, 'immediately', or the condition the filing gives. */
export const whenText = (w: { effective?: string | null; effectiveNote?: string | null }): string =>
  w.effective ? fmtDate(w.effective) : w.effectiveNote ? (w.effectiveNote === 'immediately' ? 'Immediately' : w.effectiveNote.charAt(0).toUpperCase() + w.effectiveNote.slice(1)) : ''

export const verdictLabel = {
  correct: 'Confirmed correct',
  false_alarm: 'False alarm',
  missed: 'Missed by the AI',
} as const

export const kindLabel = {
  appointed: 'New CEO named',
  resigned: 'CEO leaving',
} as const
