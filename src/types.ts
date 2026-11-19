export type Window = 'last30' | 'season'

export interface Team {
  abbr: string
  name: string
  city: string
  league: 'AL' | 'NL'
}

export interface Hitter {
  id: number
  name: string
  team: number | null
  teams: number[]
  league: number | null
  pos: string | null
  g: number
  pa: number
  hr: number
  sb: number
  avg: number
  obp: number
  slg: number
  bbPct: number
  kPct: number
  woba: number
  wraa: number
  wrcPlus: number
  xwoba?: number
}

export interface Pitcher {
  id: number
  name: string
  team: number | null
  teams: number[]
  league: number | null
  role: 'SP' | 'RP'
  g: number
  gs: number
  ip: number
  era: number
  fip: number
  kPct: number
  bbPct: number
  hr9: number
  whip: number
  w: number
  sv: number
  xera?: number
}

export interface Contract {
  id: number
  name: string
  team: number | null
  league: number | null
  type: 'H' | 'P' | 'TWP' | 'DNP'
  aav: number
  years: number | null
  through: number | null
  note: string
  bat: { pa: number; wrcPlus: number; rar: number } | null
  arm: { ip: number; fip: number; role: 'SP' | 'RP'; rar: number } | null
  rar: number
  wins: number
  value: number
  surplus: number
}

export interface Data {
  generatedAt: string
  season: number
  state: 'complete' | 'in-progress'
  lastPlayed: string
  window: { start: string; end: string }
  model: { dollarsPerWin: number; runsPerWin: number; hitterReplacementPer600: number; spReplacementGap: number; rpReplacementGap: number }
  league: Record<Window, { woba: number; wobaScale: number; rPerPA: number; era: number; cFip: number }>
  teams: Record<string, Team>
  hitters: Record<Window, { minPA: number; rows: Hitter[] }>
  pitchers: Record<Window, { minIP: number; rows: Pitcher[] }>
  spark: { hitters: Record<string, number[]>; pitchers: Record<string, number[]> }
  contracts: Contract[]
  unmatchedSalaries: string[]
}
