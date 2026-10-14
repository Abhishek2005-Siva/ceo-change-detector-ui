import { useEffect, useState } from 'react'
import Overview from './pages/Overview'
import HowItWorks from './pages/HowItWorks'
import Explorer from './pages/Explorer'
import ModelLab from './pages/ModelLab'
import Notes from './pages/Notes'

const pages = [
  { id: 'overview', label: 'Overview', el: Overview },
  { id: 'how', label: 'How it works', el: HowItWorks },
  { id: 'results', label: 'Results explorer', el: Explorer },
  { id: 'models', label: 'Why this model', el: ModelLab },
  { id: 'notes', label: 'Model notes', el: Notes },
] as const

type PageId = (typeof pages)[number]['id']

const readHash = (): PageId => {
  const h = window.location.hash.replace('#/', '').split('/')[0]
  return (pages.find((p) => p.id === h)?.id ?? 'overview') as PageId
}

export default function App() {
  const [page, setPage] = useState<PageId>(readHash)

  useEffect(() => {
    const on = () => {
      setPage(readHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const Current = pages.find((p) => p.id === page)!.el

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
              <a key={p.id} href={`#/${p.id}`} className={p.id === page ? 'active' : ''} aria-current={p.id === page ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="container">
        <Current />
      </main>
      <footer className="footer">
        <div className="container">
          Built from the project’s real test results. Accuracy is measured against an independent answer key produced by a separate large AI model, not hand-checked by people.
        </div>
      </footer>
    </>
  )
}
