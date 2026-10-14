import { Fragment } from 'react'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Highlights the person's name and CEO title inside a filing sentence. */
export default function Highlight({ text, names }: { text: string; names: string[] }) {
  const terms = names.filter((n) => n && n.length > 2).map(esc)
  terms.push('Chief Executive Officer', 'Interim Chief Executive Officer', 'CEO')
  const re = new RegExp(`(${terms.join('|')})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={/ceo|chief/i.test(p) ? 'mk-title' : 'mk-name'}>
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}
