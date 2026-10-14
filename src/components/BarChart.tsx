interface Bar {
  label: string
  value: number
  highlight?: boolean
  sub?: string
}

interface Props {
  bars: Bar[]
  min?: number
  max?: number
  format?: (v: number) => string
  ariaLabel: string
}

/** Horizontal bar chart in plain HTML/CSS; axis starts at `min` so small gains stay visible. */
export default function BarChart({ bars, min = 0.8, max = 0.88, format = (v) => v.toFixed(4), ariaLabel }: Props) {
  return (
    <div className="bars" role="img" aria-label={ariaLabel}>
      {bars.map((b) => {
        const w = Math.max(2, Math.min(100, ((b.value - min) / (max - min)) * 100))
        return (
          <div className="bar-row" key={b.label}>
            <div className="bar-label">
              {b.label}
              {b.sub && <small>{b.sub}</small>}
            </div>
            <div className="bar-track">
              <div className={`bar-fill ${b.highlight ? 'hl' : ''}`} style={{ width: `${w}%` }} />
            </div>
            <div className={`bar-val ${b.highlight ? 'hl' : ''}`}>{format(b.value)}</div>
          </div>
        )
      })}
      <div className="bar-axis">Axis starts at {format(min)} so the differences are visible</div>
    </div>
  )
}
