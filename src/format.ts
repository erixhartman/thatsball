// Savant-style diverging scale: blue (poor) → neutral grey → red (great).
const BLUE = [47, 95, 174]
const GREY = [232, 233, 231]
const RED = [210, 45, 73]

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** p is a percentile 0–1 where 1 is best. */
export function heat(p: number) {
  const c = p < 0.5 ? mix(BLUE, GREY, p / 0.5) : mix(GREY, RED, (p - 0.5) / 0.5)
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return { bg: `rgb(${c.join(',')})`, fg: lum > 0.32 ? '#1b1f1d' : '#ffffff' }
}

/** Percentile rank of value within a pool. higherIsBetter flips for stats like FIP. */
export function percentile(pool: number[], value: number, higherIsBetter = true) {
  if (pool.length < 2) return 0.5
  let below = 0
  for (const v of pool) if (higherIsBetter ? v < value : v > value) below++
  return below / (pool.length - 1)
}

export const f = {
  rate: (n: number | undefined) => (n === undefined || n === null ? '—' : n.toFixed(3).replace(/^0/, '')),
  pct: (n: number) => `${n.toFixed(1)}%`,
  int: (n: number) => Math.round(n).toString(),
  dec: (n: number | undefined, d = 2) => (n === undefined || n === null ? '—' : n.toFixed(d)),
  ip: (n: number) => {
    const whole = Math.floor(n + 1e-6)
    const outs = Math.round((n - whole) * 3)
    return outs === 3 ? `${whole + 1}.0` : `${whole}.${outs}`
  },
  money: (n: number) => {
    const abs = Math.abs(n)
    if (abs < 500) return '$0'
    const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M` : `$${Math.round(abs / 1e3)}K`
    return n < 0 ? `−${s}` : s
  },
  signedMoney: (n: number) => (n > 0 ? `+${f.money(n)}` : f.money(n)),
  date: (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
}
