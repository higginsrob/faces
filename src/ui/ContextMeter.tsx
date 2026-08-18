const SIZE = 28
const STROKE = 3
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function estimateTokens(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return Math.ceil(t.length / 4)
}

export function ContextMeter({
  used,
  limit,
  onClick,
  expanded,
}: {
  used: number
  limit: number
  onClick?: () => void
  expanded?: boolean
}) {
  const cap = Math.max(1, limit)
  const tokens = Math.max(0, used)
  const ratio = Math.min(1, tokens / cap)
  const pct = Math.round(ratio * 100)
  const offset = CIRCUMFERENCE * (1 - ratio)
  const tone = ratio >= 0.92 ? 'critical' : ratio >= 0.75 ? 'warn' : 'ok'
  const label = `Context ${pct}% · ${tokens.toLocaleString()} of ${cap.toLocaleString()} tokens`

  return (
    <button
      type="button"
      className={`ctx-meter ${tone}`}
      aria-label={`${label}. Show usage details`}
      aria-haspopup="dialog"
      aria-expanded={expanded ?? false}
      title={label}
      onClick={onClick}
    >
      <svg
        className="ctx-meter-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
      >
        <circle
          className="ctx-meter-track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
        />
        {ratio > 0 ? (
          <circle
            className="ctx-meter-fill"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        ) : null}
      </svg>
    </button>
  )
}
