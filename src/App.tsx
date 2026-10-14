import { useEffect, useState } from 'react'
import Overview from './pages/Overview'
import HowItWorks from './pages/HowItWorks'
import Explorer from './pages/Explorer'
import ModelLab from './pages/ModelLab'
import Notes from './pages/Notes'
import Search from './pages/Search'
import Filing from './pages/Filing'

const pages = [
  { id: 'overview', label: 'Overview', el: Overview },
  { id: 'search', label: 'Search filings', el: Search },
  { id: 'how', label: 'How it works', el: HowItWorks },
  { id: 'results', label: 'Test results', el: Explorer },
  { id: 'models', label: 'Why this model', el: ModelLab },
  { id: 'notes', label: 'Model notes', el: Notes },
] as const

type Route = { page: string; cik?: string; accession?: string }

const readRoute = (): Route => {
  const parts = window.location.hash.replace('#/', '').split('/')
  if (parts[0] === 'filing' && /^\d+$/.test(parts[1] ?? '') && /^\d{10}-\d{2}-\d{6}$/.test(parts[2] ?? '')) {
    return { page: 'filing', cik: parts[1], accession: parts[2] }
  }
  return { page: pages.find((p) => p.id === parts[0])?.id ?? 'overview' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const on = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const active = route.page === 'filing' ? 'search' : route.page
  const Current = pages.find((p) => p.id === route.page)?.el

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/overview" aria-label="Leadership Change Detector home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
              </svg>
            </span>
            <span>
              Leadership Change Detector
              <small>SEC 8-K filings · CEO appointed / resigned</small>
            </span>
          </a>
          <nav aria-label="Main">
            {pages.map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={p.id === active ? 'active' : ''} aria-current={p.id === active ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="container">
        {route.page === 'filing' ? <Filing key={route.accession} cik={route.cik!} accession={route.accession!} /> : Current && <Current />}
      </main>
      <footer className="footer">
        <div className="container">
          Search results come live from the SEC’s public EDGAR database. Accuracy figures are measured against an independent answer key produced by a separate large AI model, not hand-checked by people.
        </div>
      </footer>
    </>
  )
}
