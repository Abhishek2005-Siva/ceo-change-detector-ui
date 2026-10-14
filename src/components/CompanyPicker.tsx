import { useEffect, useRef, useState } from 'react'
import { findCompanies } from '../api'
import type { Company } from '../types'

interface Props {
  value: Company | null
  onChange: (c: Company | null) => void
}

export default function CompanyPicker({ value, onChange }: Props) {
  const [text, setText] = useState('')
  const [opts, setOpts] = useState<Company[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<number>()

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (text.trim().length < 1) {
      setOpts([])
      return
    }
    timer.current = window.setTimeout(() => {
      findCompanies(text.trim()).then(setOpts).catch(() => setOpts([]))
    }, 200)
    return () => window.clearTimeout(timer.current)
  }, [text])

  if (value) {
    return (
      <div className="picked">
        <span><b>{value.name}</b> {value.ticker && <small>({value.ticker})</small>} <small>CIK {value.cik}</small></span>
        <button type="button" className="icon-btn" aria-label="Clear company" onClick={() => onChange(null)}>×</button>
      </div>
    )
  }

  return (
    <div className="combo">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder="Company name, ticker or CIK"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && opts.length > 0 && (
        <ul className="combo-list" role="listbox">
          {opts.map((c) => (
            <li key={c.cik} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(c); setText(''); setOpen(false) }}>
                <b>{c.name}</b>
                <small>{c.ticker ? `${c.ticker} · ` : ''}CIK {c.cik}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
