interface Props {
  found: number
  missed: number
  label: string
}

/** One dot per real event: filled = AI found it, hollow = AI missed it. */
export default function Dots({ found, missed, label }: Props) {
  const total = found + missed
  return (
    <div role="img" aria-label={`${label}: AI found ${found} of ${total}`} className="dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < found ? 'dot found' : 'dot miss'} />
      ))}
    </div>
  )
}
