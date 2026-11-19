/**
 * Rolling-trend sparkline. `invert` flips the y axis for stats where lower is better (FIP),
 * so "up" always means "better". `ref` draws the league-average line.
 */
export function Spark({ values, refValue, invert, label }: { values?: number[]; refValue: number; invert?: boolean; label: string }) {
  if (!values || values.length < 2) return <span className="spark-empty" aria-label="Not enough games">—</span>
  const W = 96
  const H = 26
  const lo = Math.min(...values, refValue)
  const hi = Math.max(...values, refValue)
  const span = hi - lo || 1
  const y = (v: number) => {
    const t = (v - lo) / span
    return 2 + (invert ? t : 1 - t) * (H - 4)
  }
  const x = (i: number) => 1 + (i / (values.length - 1)) * (W - 5)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const last = values[values.length - 1]
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      <line className="spark-ref" x1={0} x2={W} y1={y(refValue)} y2={y(refValue)} />
      <path className="spark-line" d={d} />
      <circle className="spark-dot" cx={x(values.length - 1)} cy={y(last)} r={2.5} />
    </svg>
  )
}
