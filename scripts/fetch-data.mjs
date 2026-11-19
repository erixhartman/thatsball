#!/usr/bin/env node
// Pulls MLB stats from the free MLB Stats API and Baseball Savant, computes
// wOBA / wRC+ / FIP / value, and writes public/data/latest.json for the site.
// Runs daily in GitHub Actions. No dependencies; Node 20+.

import { readFile, writeFile, mkdir } from 'node:fs/promises'

const API = 'https://statsapi.mlb.com/api/v1'
const SAVANT = 'https://baseballsavant.mlb.com/leaderboard/expected_statistics'
const OUT = new URL('../public/data/latest.json', import.meta.url)
const SALARIES = new URL('../data/salaries.csv', import.meta.url)

// ---- Model assumptions (documented on the site's Method page) ----
const DOLLARS_PER_WIN = 8_500_000 // USD, rough free-agent market price of 1 win
const HITTER_REPLACEMENT_RUNS_PER_600PA = 20
const SP_REPLACEMENT_FIP_GAP = 1.2 // runs per 9 worse than league average
const RP_REPLACEMENT_FIP_GAP = 0.6
// Standard wOBA linear weights (Tango/FanGraphs scale, ~1.24). Rescaled each run so league wOBA = league OBP.
const BASE_WEIGHTS = { bb: 0.689, hbp: 0.72, single: 0.882, double: 1.254, triple: 1.59, hr: 2.05 }
const BASE_SCALE = 1.242

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'thatsball-dashboard (github.com/erixhartman)' } })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      return await res.json()
    } catch (e) {
      if (i === tries - 1) throw e
      await sleep(1000 * (i + 1))
    }
  }
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'thatsball-dashboard (github.com/erixhartman)' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return (await res.text()).replace(/^﻿/, '')
}

function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.length > 1)
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const iso = (d) => d.toISOString().slice(0, 10)
const round = (n, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? null : +n.toFixed(d))

// ---------- season state ----------
async function seasonInfo() {
  const now = new Date()
  let season = now.getUTCFullYear()
  const sched = async (y) => (await getJson(`${API}/schedule?sportId=1&season=${y}&gameType=R&fields=dates,date,games,status,abstractGameState`)).dates ?? []
  let dates = await sched(season)
  // Before Opening Day, show last season.
  if (!dates.length || dates[0].date > iso(now)) {
    season -= 1
    dates = await sched(season)
  }
  const played = dates.filter((d) => d.games.some((g) => g.status?.abstractGameState === 'Final'))
  const lastPlayed = played.at(-1)?.date ?? dates[0].date
  const seasonEnd = dates.at(-1).date
  const state = lastPlayed >= seasonEnd ? 'complete' : 'in-progress'
  const end = new Date(lastPlayed + 'T12:00:00Z')
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 29)
  return { season, state, openingDay: dates[0].date, lastPlayed, window: { start: iso(start), end: lastPlayed } }
}

// ---------- stats ----------
function ip(stat) {
  return stat.outs !== undefined ? stat.outs / 3 : (() => {
    const [w, f = '0'] = String(stat.inningsPitched ?? '0').split('.')
    return +w + +f / 3
  })()
}

/** Combine per-team splits into one line per player (traded players). */
function collapse(splits) {
  const by = new Map()
  for (const s of splits) {
    const id = s.player.id
    const cur = by.get(id)
    const teamless = !s.team
    if (!cur) by.set(id, { ...s, teams: s.team ? [s.team.id] : [], _total: teamless })
    else if (teamless) by.set(id, { ...s, teams: cur.teams, _total: true })
    else if (!cur._total) {
      const stat = { ...cur.stat }
      for (const [k, v] of Object.entries(s.stat)) if (typeof v === 'number' && typeof stat[k] === 'number') stat[k] += v
      by.set(id, { ...cur, stat, teams: [...cur.teams, s.team.id], team: s.team, league: s.league })
    } else cur.teams.push(s.team.id)
  }
  return [...by.values()]
}

async function statLines(group, params) {
  const url = `${API}/stats?group=${group}&sportId=1&playerPool=ALL&limit=3000&${params}`
  const data = await getJson(url)
  return collapse(data.stats?.[0]?.splits ?? [])
}

function leagueHitting(rows) {
  const t = { pa: 0, ab: 0, h: 0, d: 0, tr: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, r: 0 }
  for (const { stat: s } of rows) {
    t.pa += s.plateAppearances; t.ab += s.atBats; t.h += s.hits; t.d += s.doubles; t.tr += s.triples; t.hr += s.homeRuns
    t.bb += s.baseOnBalls; t.ibb += s.intentionalWalks; t.hbp += s.hitByPitch; t.sf += s.sacFlies; t.r += s.runs
  }
  const obp = (t.h + t.bb + t.hbp) / (t.ab + t.bb + t.hbp + t.sf)
  const raw = rawWoba(t, BASE_WEIGHTS)
  const k = obp / raw
  const weights = Object.fromEntries(Object.entries(BASE_WEIGHTS).map(([key, v]) => [key, v * k]))
  return { obp, woba: obp, wobaScale: BASE_SCALE * k, weights, rPerPA: t.r / t.pa, totals: t }
}

function rawWoba(t, w) {
  const singles = t.h - t.d - t.tr - t.hr
  const denom = t.ab + t.bb - t.ibb + t.sf + t.hbp
  return denom ? (w.bb * (t.bb - t.ibb) + w.hbp * t.hbp + w.single * singles + w.double * t.d + w.triple * t.tr + w.hr * t.hr) / denom : 0
}

const hitTotals = (s) => ({ pa: s.plateAppearances, ab: s.atBats, h: s.hits, d: s.doubles, tr: s.triples, hr: s.homeRuns, bb: s.baseOnBalls, ibb: s.intentionalWalks, hbp: s.hitByPitch, sf: s.sacFlies })

function hitterLine(row, lg) {
  const s = row.stat
  const t = hitTotals(s)
  const woba = rawWoba(t, lg.weights)
  const wraa = ((woba - lg.woba) / lg.wobaScale) * t.pa
  const wrcPlus = ((wraa / t.pa + lg.rPerPA) / lg.rPerPA) * 100
  return {
    id: row.player.id,
    name: row.player.fullName,
    team: row.team?.id ?? null,
    teams: row.teams,
    league: row.league?.id ?? null,
    pos: row.position?.abbreviation ?? null,
    g: s.gamesPlayed, pa: t.pa, hr: t.hr, sb: s.stolenBases,
    avg: +s.avg || 0, obp: +s.obp || 0, slg: +s.slg || 0,
    bbPct: (t.bb / t.pa) * 100, kPct: (s.strikeOuts / t.pa) * 100,
    woba, wraa, wrcPlus,
  }
}

function leaguePitching(rows) {
  const t = { ip: 0, er: 0, r: 0, hr: 0, bb: 0, hbp: 0, k: 0, bf: 0 }
  for (const { stat: s } of rows) {
    t.ip += ip(s); t.er += s.earnedRuns; t.r += s.runs; t.hr += s.homeRuns; t.bb += s.baseOnBalls; t.hbp += s.hitBatsmen ?? s.hitByPitch ?? 0
    t.k += s.strikeOuts; t.bf += s.battersFaced
  }
  const era = (t.er * 9) / t.ip
  const cFip = era - (13 * t.hr + 3 * (t.bb + t.hbp) - 2 * t.k) / t.ip
  const ra9 = (t.r * 9) / t.ip
  const runsPerWin = 9 * (t.r / t.ip) * 1.5 + 3
  return { era, ra9, cFip, fip: era, runsPerWin, totals: t }
}

function pitcherLine(row, lg) {
  const s = row.stat
  const inn = ip(s)
  const hbp = s.hitBatsmen ?? s.hitByPitch ?? 0
  const fip = (13 * s.homeRuns + 3 * (s.baseOnBalls + hbp) - 2 * s.strikeOuts) / inn + lg.cFip
  const role = s.gamesStarted >= s.gamesPitched / 2 ? 'SP' : 'RP'
  return {
    id: row.player.id,
    name: row.player.fullName,
    team: row.team?.id ?? null,
    teams: row.teams,
    league: row.league?.id ?? null,
    role,
    g: s.gamesPitched, gs: s.gamesStarted, ip: inn,
    era: (s.earnedRuns * 9) / inn, fip,
    kPct: (s.strikeOuts / s.battersFaced) * 100,
    bbPct: (s.baseOnBalls / s.battersFaced) * 100,
    hr9: (s.homeRuns * 9) / inn,
    whip: +s.whip || 0, w: s.wins, sv: s.saves,
  }
}

function pct(arr, p) {
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0
}

// ---------- game-log sparklines ----------
async function sparkline(id, group, lgH, lgP) {
  const data = await getJson(`${API}/people/${id}/stats?stats=gameLog&group=${group}&season=${SEASON}`)
  const games = data.stats?.[0]?.splits ?? []
  const N = group === 'hitting' ? 15 : 5
  const out = []
  for (let i = N - 1; i < games.length; i++) {
    const slice = games.slice(i - N + 1, i + 1)
    if (group === 'hitting') {
      const t = { pa: 0, ab: 0, h: 0, d: 0, tr: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0 }
      for (const g of slice) for (const [k, v] of Object.entries(hitTotals(g.stat))) t[k] += v || 0
      if (!t.pa) continue
      const woba = rawWoba(t, lgH.weights)
      out.push(round((((woba - lgH.woba) / lgH.wobaScale + lgH.rPerPA) / lgH.rPerPA) * 100, 0))
    } else {
      let inn = 0, hr = 0, bb = 0, k = 0
      for (const g of slice) { inn += ip(g.stat); hr += g.stat.homeRuns; bb += g.stat.baseOnBalls + (g.stat.hitBatsmen ?? g.stat.hitByPitch ?? 0); k += g.stat.strikeOuts }
      if (inn < 3) continue
      out.push(round((13 * hr + 3 * bb - 2 * k) / inn + lgP.cFip, 2))
    }
  }
  return out.slice(-40)
}

async function pool(items, n, fn) {
  const out = new Map()
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const item = items[i++]
      try { out.set(item, await fn(item)) } catch (e) { console.warn('sparkline failed', item, e.message) }
    }
  }))
  return out
}

// ---------- main ----------
const info = await seasonInfo()
const SEASON = info.season
console.log('Season', SEASON, info.state, 'window', info.window)

const [teamsRes, hitSeason, hitWin, pitSeason, pitWin] = await Promise.all([
  getJson(`${API}/teams?sportId=1&season=${SEASON}`),
  statLines('hitting', `stats=season&season=${SEASON}`),
  statLines('hitting', `stats=byDateRange&season=${SEASON}&startDate=${info.window.start}&endDate=${info.window.end}`),
  statLines('pitching', `stats=season&season=${SEASON}`),
  statLines('pitching', `stats=byDateRange&season=${SEASON}&startDate=${info.window.start}&endDate=${info.window.end}`),
])

const teams = Object.fromEntries(teamsRes.teams.map((t) => [t.id, { abbr: t.abbreviation, name: t.teamName, city: t.franchiseName ?? t.locationName, league: t.league.id === 103 ? 'AL' : 'NL' }]))

const lgH = { season: leagueHitting(hitSeason), last30: leagueHitting(hitWin) }
const lgP = { season: leaguePitching(pitSeason), last30: leaguePitching(pitWin) }

const teamGames = (rows) => pct(rows.map((r) => r.stat.gamesPlayed ?? 0), 0.97)
const gH = { season: teamGames(hitSeason), last30: teamGames(hitWin) }

const hitters = {}
const pitchers = {}
for (const w of ['season', 'last30']) {
  const rows = w === 'season' ? hitSeason : hitWin
  const minPA = Math.round(3.1 * gH[w])
  hitters[w] = { minPA, rows: rows.filter((r) => r.stat.plateAppearances >= minPA).map((r) => hitterLine(r, lgH[w])).sort((a, b) => b.wrcPlus - a.wrcPlus) }
  const prow = w === 'season' ? pitSeason : pitWin
  const minIP = Math.round(gH[w] * (w === 'season' ? 1 : 0.8))
  pitchers[w] = { minIP, rows: prow.filter((r) => ip(r.stat) >= minIP).map((r) => pitcherLine(r, lgP[w])).sort((a, b) => a.fip - b.fip) }
}

// Savant expected stats (season only)
try {
  const [xb, xp] = await Promise.all([
    getText(`${SAVANT}?type=batter&year=${SEASON}&position=&team=&min=1&csv=true`).then(parseCsv),
    getText(`${SAVANT}?type=pitcher&year=${SEASON}&position=&team=&min=1&csv=true`).then(parseCsv),
  ])
  const xbById = new Map(xb.map((r) => [+r.player_id, r]))
  const xpById = new Map(xp.map((r) => [+r.player_id, r]))
  for (const h of hitters.season.rows) {
    const x = xbById.get(h.id)
    if (x) { h.xwoba = +x.est_woba; h.savantWoba = +x.woba }
  }
  for (const p of pitchers.season.rows) {
    const x = xpById.get(p.id)
    if (x) { p.xera = +x.xera; p.xwoba = +x.est_woba }
  }
} catch (e) {
  console.warn('Savant fetch failed:', e.message)
}

// Sparklines for everyone who could appear in a top-50 (any window, any league)
const topIds = (lists, n) => {
  const ids = new Set()
  for (const list of lists) {
    for (const lg of [null, 103, 104]) list.filter((r) => !lg || r.league === lg).slice(0, n).forEach((r) => ids.add(r.id))
  }
  return [...ids]
}
const hitIds = topIds([hitters.season.rows, hitters.last30.rows], 50)
const pitIds = topIds([pitchers.season.rows, pitchers.last30.rows], 50)
console.log(`Fetching game logs: ${hitIds.length} hitters, ${pitIds.length} pitchers`)
const [hitSpark, pitSpark] = await Promise.all([
  pool(hitIds, 6, (id) => sparkline(id, 'hitting', lgH.season, lgP.season)),
  pool(pitIds, 6, (id) => sparkline(id, 'pitching', lgH.season, lgP.season)),
])

// ---------- contracts ----------
const salaries = parseCsv(await readFile(SALARIES, 'utf8'))
const hitByName = new Map(hitSeason.map((r) => [norm(r.player.fullName), r]))
const pitByName = new Map(pitSeason.map((r) => [norm(r.player.fullName), r]))
const contracts = []
const unmatched = []
for (const s of salaries) {
  const key = norm(s.name)
  const h = hitByName.get(key)
  const p = pitByName.get(key)
  const aav = +s.aav_usd
  let bat = null, arm = null
  if (h && h.stat.plateAppearances >= 50) {
    const line = hitterLine(h, lgH.season)
    const rar = line.wraa + (HITTER_REPLACEMENT_RUNS_PER_600PA * line.pa) / 600
    bat = { pa: line.pa, wrcPlus: line.wrcPlus, rar }
  }
  if (p && ip(p.stat) >= 15) {
    const line = pitcherLine(p, lgP.season)
    const gap = line.role === 'SP' ? SP_REPLACEMENT_FIP_GAP : RP_REPLACEMENT_FIP_GAP
    const runScale = lgP.season.ra9 / lgP.season.era
    const rar = (gap + lgP.season.fip - line.fip) * (line.ip / 9) * runScale
    arm = { ip: line.ip, fip: line.fip, role: line.role, rar }
  }
  const base = h ?? p
  if (!base) { unmatched.push(s.name); continue }
  const rar = (bat?.rar ?? 0) + (arm?.rar ?? 0)
  const wins = rar / lgP.season.runsPerWin
  const value = Math.max(0, wins) * DOLLARS_PER_WIN
  contracts.push({
    id: base.player.id,
    name: base.player.fullName,
    team: base.team?.id ?? null,
    league: base.league?.id ?? null,
    type: bat && arm ? 'TWP' : arm ? 'P' : bat ? 'H' : 'DNP',
    aav, years: +s.years || null, through: +s.through || null, note: s.note || '',
    bat, arm, rar, wins, value, surplus: value - aav,
  })
}
contracts.sort((a, b) => b.surplus - a.surplus)
if (unmatched.length) console.warn('No 2026 stats found for:', unmatched.join(', '))

// ---------- write ----------
const r3 = (rows, keys) => rows.map((r) => {
  const o = { ...r }
  for (const k of keys) if (typeof o[k] === 'number') o[k] = round(o[k], k === 'woba' || k === 'xwoba' || k === 'avg' || k === 'obp' || k === 'slg' || k === 'savantWoba' ? 3 : 2)
  return o
})
const hitKeys = ['woba', 'wraa', 'wrcPlus', 'bbPct', 'kPct', 'xwoba', 'avg', 'obp', 'slg', 'savantWoba']
const pitKeys = ['ip', 'era', 'fip', 'kPct', 'bbPct', 'hr9', 'xera', 'xwoba']
const limit = (list, n = 200) => list.slice(0, n)

const out = {
  generatedAt: new Date().toISOString(),
  season: SEASON,
  state: info.state,
  lastPlayed: info.lastPlayed,
  window: info.window,
  model: {
    dollarsPerWin: DOLLARS_PER_WIN,
    runsPerWin: round(lgP.season.runsPerWin, 2),
    hitterReplacementPer600: HITTER_REPLACEMENT_RUNS_PER_600PA,
    spReplacementGap: SP_REPLACEMENT_FIP_GAP,
    rpReplacementGap: RP_REPLACEMENT_FIP_GAP,
  },
  league: {
    season: { woba: round(lgH.season.woba), wobaScale: round(lgH.season.wobaScale), rPerPA: round(lgH.season.rPerPA, 4), era: round(lgP.season.era, 2), cFip: round(lgP.season.cFip, 2) },
    last30: { woba: round(lgH.last30.woba), wobaScale: round(lgH.last30.wobaScale), rPerPA: round(lgH.last30.rPerPA, 4), era: round(lgP.last30.era, 2), cFip: round(lgP.last30.cFip, 2) },
  },
  teams,
  hitters: {
    season: { minPA: hitters.season.minPA, rows: r3(limit(hitters.season.rows), hitKeys) },
    last30: { minPA: hitters.last30.minPA, rows: r3(limit(hitters.last30.rows), hitKeys) },
  },
  pitchers: {
    season: { minIP: pitchers.season.minIP, rows: r3(limit(pitchers.season.rows), pitKeys) },
    last30: { minIP: pitchers.last30.minIP, rows: r3(limit(pitchers.last30.rows), pitKeys) },
  },
  spark: {
    hitters: Object.fromEntries(hitSpark),
    pitchers: Object.fromEntries(pitSpark),
  },
  contracts: contracts.map((c) => ({
    ...c,
    rar: round(c.rar, 1), wins: round(c.wins, 2), value: Math.round(c.value), surplus: Math.round(c.surplus),
    bat: c.bat && { ...c.bat, wrcPlus: round(c.bat.wrcPlus, 0), rar: round(c.bat.rar, 1) },
    arm: c.arm && { ...c.arm, ip: round(c.arm.ip, 1), fip: round(c.arm.fip, 2), rar: round(c.arm.rar, 1) },
  })),
  unmatchedSalaries: unmatched,
}

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true })
// Skip the write when nothing but the timestamp changed, so the offseason doesn't trigger a deploy every day.
try {
  const prev = JSON.parse(await readFile(OUT, 'utf8'))
  const strip = (o) => JSON.stringify({ ...o, generatedAt: null })
  if (strip(prev) === strip(out)) {
    console.log('No data changes; leaving latest.json as is.')
    process.exit(0)
  }
} catch {}
await writeFile(OUT, JSON.stringify(out))
console.log(`Wrote ${OUT.pathname}: ${out.hitters.season.rows.length} hitters, ${out.pitchers.season.rows.length} pitchers, ${out.contracts.length} contracts`)
