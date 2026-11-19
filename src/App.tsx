import { useEffect, useMemo, useState } from 'react'
import type { Contract, Data, Hitter, Pitcher, Window } from './types'
import { f, heat, percentile } from './format'
import { Leaderboard, type Column } from './components/Leaderboard'
import { Spark } from './components/Spark'

type Tab = 'hitters' | 'pitchers' | 'contracts' | 'method'
type League = 'MLB' | 'AL' | 'NL'
const LEAGUE_ID: Record<League, number | null> = { MLB: null, AL: 103, NL: 104 }
const TABS: { id: Tab; label: string }[] = [
  { id: 'hitters', label: 'Hitters' },
  { id: 'pitchers', label: 'Pitchers' },
  { id: 'contracts', label: 'Contracts' },
]

function useTab(): [Tab, (t: Tab) => void] {
  const read = () => {
    const h = location.hash.replace('#', '') as Tab
    return ['hitters', 'pitchers', 'contracts', 'method'].includes(h) ? h : 'hitters'
  }
  const [tab, setTab] = useState<Tab>(read)
  useEffect(() => {
    const on = () => setTab(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [tab, (t) => { location.hash = t }]
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useTab()
  const [win, setWin] = useState<Window>('last30')
  const [league, setLeague] = useState<League>('MLB')
  const [team, setTeam] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('/data/latest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(`The stats file didn't load (${e.message}). Refresh the page to try again.`))
  }, [])

  if (error) return <div className="shell"><p className="empty">{error}</p></div>
  if (!data) return <div className="shell"><p className="empty">Loading the leaderboards…</p></div>

  const teamList = Object.entries(data.teams)
    .filter(([, t]) => league === 'MLB' || t.league === league)
    .sort((a, b) => a[1].city.localeCompare(b[1].city))

  const filters = { league: LEAGUE_ID[league], team: team ? +team : null, query: query.trim().toLowerCase() }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-inner">
          <a className="wordmark" href="#hitters" aria-label="That's ball, baby! home">
            <span className="wm-1">That's ball,</span>
            <span className="wm-2">baby!</span>
          </a>
          <nav className="board-tabs" aria-label="Leaderboards">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="slot" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <StatusLine data={data} />
      </header>

      <main className="content">
        {tab !== 'method' && (
          <div className="controls" role="group" aria-label="Filters">
            {tab !== 'contracts' && (
              <div className="seg" role="radiogroup" aria-label="Time window">
                <button type="button" role="radio" aria-checked={win === 'last30'} onClick={() => setWin('last30')}>Last 30 days</button>
                <button type="button" role="radio" aria-checked={win === 'season'} onClick={() => setWin('season')}>{data.season} season</button>
              </div>
            )}
            <div className="seg" role="radiogroup" aria-label="League">
              {(['MLB', 'AL', 'NL'] as League[]).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={league === l} onClick={() => { setLeague(l); setTeam('') }}>{l}</button>
              ))}
            </div>
            <label className="select">
              <span className="sr-only">Team</span>
              <select value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">All teams</option>
                {teamList.map(([id, t]) => <option key={id} value={id}>{t.city} {t.name}</option>)}
              </select>
            </label>
            <label className="search">
              <span className="sr-only">Find a player</span>
              <input type="search" placeholder="Find a player" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
        )}

        {tab === 'hitters' && <Hitters data={data} win={win} filters={filters} />}
        {tab === 'pitchers' && <Pitchers data={data} win={win} filters={filters} />}
        {tab === 'contracts' && <Contracts data={data} filters={filters} />}
        {tab === 'method' && <Method data={data} />}
      </main>

      <footer className="foot">
        <p>
          Data from the MLB Stats API and Baseball Savant, refreshed daily. Last updated {new Date(data.generatedAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}.
        </p>
        <p>
          <a href="#method">How the numbers work</a>. Built by Eric Hartman. Not affiliated with MLB.
        </p>
      </footer>
    </div>
  )
}

function StatusLine({ data }: { data: Data }) {
  const range = `${f.date(data.window.start)}–${f.date(data.window.end)}`
  return (
    <p className="status">
      {data.state === 'complete'
        ? `The ${data.season} regular season is over. “Last 30 days” covers its final stretch, ${range}.`
        : `Through games of ${f.date(data.lastPlayed)}. “Last 30 days” covers ${range}.`}
    </p>
  )
}

interface Filters {
  league: number | null
  team: number | null
  query: string
}

function applyFilters<T extends { name: string; league: number | null; team: number | null; teams?: number[] }>(rows: T[], fl: Filters) {
  return rows.filter(
    (r) =>
      (!fl.league || r.league === fl.league) &&
      (!fl.team || r.team === fl.team || r.teams?.includes(fl.team)) &&
      (!fl.query || r.name.toLowerCase().includes(fl.query)),
  )
}

function Player({ name, team, extra, data }: { name: string; team: number | null; extra: string | null; data: Data }) {
  const t = team ? data.teams[team] : null
  return (
    <span className="player">
      <span className="pname">{name}</span>
      <span className="pmeta">{[t?.abbr, extra].filter(Boolean).join(' ')}</span>
    </span>
  )
}

function Heat({ value, p, children }: { value: string; p: number; children?: string }) {
  const c = heat(p)
  return (
    <span className="heat" style={{ background: c.bg, color: c.fg }} title={`${Math.round(p * 100)}th percentile among qualified players`}>
      {children ?? value}
    </span>
  )
}

// ---------- Hitters ----------
function Hitters({ data, win, filters }: { data: Data; win: Window; filters: Filters }) {
  const set = data.hitters[win]
  const pool = useMemo(() => set.rows.map((r) => r.wrcPlus), [set])
  const rankOf = useMemo(() => new Map(set.rows.map((r, i) => [r.id, i + 1])), [set])
  const rows = applyFilters(set.rows, filters).slice(0, 50)

  const cols: Column<Hitter>[] = [
    { key: 'rank', label: '#', className: 'rank', render: (r) => rankOf.get(r.id) },
    { key: 'name', label: 'Player', className: 'pcol', sort: (r) => r.name, desc: false, render: (r) => <Player data={data} name={r.name} team={r.team} extra={r.pos} /> },
    { key: 'wrc', label: 'wRC+', title: 'Weighted runs created plus. 100 is league average. Not park-adjusted.', className: 'num key', sort: (r) => r.wrcPlus, render: (r) => <Heat value={f.int(r.wrcPlus)} p={percentile(pool, r.wrcPlus)} /> },
    { key: 'trend', label: 'Trend', title: 'Rolling 15-game wRC+ this season. The line marks 100.', className: 'trend', render: (r) => <Spark values={data.spark.hitters[r.id]} refValue={100} label={`${r.name}: rolling 15-game wRC+, latest ${data.spark.hitters[r.id]?.at(-1) ?? '—'}`} /> },
    { key: 'pa', label: 'PA', className: 'num', sort: (r) => r.pa, render: (r) => r.pa },
    { key: 'hr', label: 'HR', className: 'num', sort: (r) => r.hr, render: (r) => r.hr, hideOnMobile: true },
    { key: 'slash', label: 'AVG / OBP / SLG', className: 'num slash', sort: (r) => r.obp + r.slg, render: (r) => `${f.rate(r.avg)} / ${f.rate(r.obp)} / ${f.rate(r.slg)}`, hideOnMobile: true },
    { key: 'woba', label: 'wOBA', className: 'num', sort: (r) => r.woba, render: (r) => f.rate(r.woba), hideOnMobile: true },
    ...(win === 'season'
      ? [{ key: 'xwoba', label: 'xwOBA', title: 'Expected wOBA from quality of contact (Baseball Savant).', className: 'num', sort: (r: Hitter) => r.xwoba ?? 0, render: (r: Hitter) => f.rate(r.xwoba), hideOnMobile: true }]
      : []),
    { key: 'bb', label: 'BB%', className: 'num', sort: (r) => r.bbPct, render: (r) => f.pct(r.bbPct), hideOnMobile: true },
    { key: 'k', label: 'K%', className: 'num', sort: (r) => r.kPct, desc: false, render: (r) => f.pct(r.kPct), hideOnMobile: true },
  ]

  return (
    <section aria-labelledby="h-title">
      <div className="section-head">
        <h1 id="h-title">Top 50 hitters</h1>
        <p>Ranked by wRC+, {win === 'last30' ? 'over the last 30 days' : `for the ${data.season} season`}. Minimum {set.minPA} plate appearances.</p>
      </div>
      <Leaderboard key={win} rows={rows} columns={cols} initialSort={{ key: 'wrc', desc: true }} caption="Top hitters by wRC+" empty="No qualified hitters match these filters." />
    </section>
  )
}

// ---------- Pitchers ----------
function Pitchers({ data, win, filters }: { data: Data; win: Window; filters: Filters }) {
  const set = data.pitchers[win]
  const pool = useMemo(() => set.rows.map((r) => r.fip), [set])
  const rankOf = useMemo(() => new Map(set.rows.map((r, i) => [r.id, i + 1])), [set])
  const rows = applyFilters(set.rows, filters).slice(0, 50)
  const lgFip = data.league.season.era

  const cols: Column<Pitcher>[] = [
    { key: 'rank', label: '#', className: 'rank', render: (r) => rankOf.get(r.id) },
    { key: 'name', label: 'Player', className: 'pcol', sort: (r) => r.name, desc: false, render: (r) => <Player data={data} name={r.name} team={r.team} extra={r.role} /> },
    { key: 'fip', label: 'FIP', title: 'Fielding independent pitching: strikeouts, walks, hit batters and homers, on the ERA scale.', className: 'num key', sort: (r) => r.fip, desc: false, render: (r) => <Heat value={f.dec(r.fip)} p={percentile(pool, r.fip, false)} /> },
    { key: 'trend', label: 'Trend', title: 'Rolling 5-appearance FIP this season. Up is better. The line marks league average.', className: 'trend', render: (r) => <Spark invert values={data.spark.pitchers[r.id]} refValue={lgFip} label={`${r.name}: rolling 5-appearance FIP, latest ${data.spark.pitchers[r.id]?.at(-1) ?? '—'}`} /> },
    { key: 'ip', label: 'IP', className: 'num', sort: (r) => r.ip, render: (r) => f.ip(r.ip) },
    { key: 'era', label: 'ERA', className: 'num', sort: (r) => r.era, desc: false, render: (r) => f.dec(r.era), hideOnMobile: true },
    ...(win === 'season'
      ? [{ key: 'xera', label: 'xERA', title: 'Expected ERA from quality of contact allowed (Baseball Savant).', className: 'num', sort: (r: Pitcher) => r.xera ?? 99, desc: false, render: (r: Pitcher) => f.dec(r.xera), hideOnMobile: true }]
      : []),
    { key: 'k', label: 'K%', className: 'num', sort: (r) => r.kPct, render: (r) => f.pct(r.kPct), hideOnMobile: true },
    { key: 'bb', label: 'BB%', className: 'num', sort: (r) => r.bbPct, desc: false, render: (r) => f.pct(r.bbPct), hideOnMobile: true },
    { key: 'hr9', label: 'HR/9', className: 'num', sort: (r) => r.hr9, desc: false, render: (r) => f.dec(r.hr9), hideOnMobile: true },
    { key: 'whip', label: 'WHIP', className: 'num', sort: (r) => r.whip, desc: false, render: (r) => f.dec(r.whip), hideOnMobile: true },
  ]

  return (
    <section aria-labelledby="p-title">
      <div className="section-head">
        <h1 id="p-title">Top 50 pitchers</h1>
        <p>Ranked by FIP, {win === 'last30' ? 'over the last 30 days' : `for the ${data.season} season`}. Minimum {set.minIP} innings.</p>
      </div>
      <Leaderboard key={win} rows={rows} columns={cols} initialSort={{ key: 'fip', desc: false }} caption="Top pitchers by FIP" empty="No qualified pitchers match these filters." />
    </section>
  )
}

// ---------- Contracts ----------
function Contracts({ data, filters }: { data: Data; filters: Filters }) {
  const rows = applyFilters(data.contracts, filters)
  const maxAbs = Math.max(...data.contracts.map((c) => Math.abs(c.surplus)), 1)

  const cols: Column<Contract>[] = [
    { key: 'name', label: 'Player', className: 'pcol', sort: (r) => r.name, desc: false, render: (r) => <Player data={data} name={r.name} team={r.team} extra={r.type === 'TWP' ? 'two-way' : r.type === 'P' ? r.arm?.role ?? 'P' : null} /> },
    {
      key: 'perf', label: `${data.season} line`, className: 'num perf', hideOnMobile: true,
      render: (r) => r.type === 'DNP' ? <span className="muted">Barely played</span> : [r.bat && `${f.int(r.bat.wrcPlus)} wRC+`, r.arm && `${f.dec(r.arm.fip)} FIP`].filter(Boolean).join(', '),
    },
    { key: 'wins', label: 'Wins', title: 'Estimated wins above replacement (our model).', className: 'num', sort: (r) => r.wins, render: (r) => (r.type === 'DNP' ? '—' : f.dec(r.wins, 1)) },
    { key: 'value', label: 'Worth', title: 'Estimated market value of this season’s production.', className: 'num', sort: (r) => r.value, render: (r) => f.money(r.value) },
    { key: 'aav', label: 'Paid (AAV)', title: 'Average annual value of the contract.', className: 'num', sort: (r) => r.aav, render: (r) => <span title={r.note}>{f.money(r.aav)}</span> },
    {
      key: 'surplus', label: 'Surplus', className: 'surplus', sort: (r) => r.surplus,
      render: (r) => {
        const w = (Math.abs(r.surplus) / maxAbs) * 50
        return (
          <span className="sbar" title={r.note}>
            <span className="sbar-track" aria-hidden="true">
              <span className={`sbar-fill ${r.surplus >= 0 ? 'pos' : 'neg'}`} style={r.surplus >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
            </span>
            <span className="sbar-val">{f.signedMoney(r.surplus)}</span>
          </span>
        )
      },
    },
  ]

  return (
    <section aria-labelledby="c-title">
      <div className="section-head">
        <h1 id="c-title">Contract value</h1>
        <p>
          What each player’s {data.season} season was worth on the open market, against what he’s paid per year. Positive surplus means the team got more than it paid for. Figures in US dollars.
        </p>
      </div>
      <Leaderboard rows={rows} columns={cols} initialSort={{ key: 'surplus', desc: true }} caption="Contract surplus value" empty="No tracked contracts match these filters." />
      <p className="note">
        Tracking {data.contracts.length} contracts so far, entered from public reporting. Worth assumes {f.money(data.model.dollarsPerWin)} per win. <a href="#method">See the method</a>.
      </p>
    </section>
  )
}

// ---------- Method ----------
function Method({ data }: { data: Data }) {
  const m = data.model
  const lg = data.league.season
  return (
    <section className="method" aria-labelledby="m-title">
      <div className="section-head">
        <h1 id="m-title">How the numbers work</h1>
        <p>Everything here is calculated from free public data every morning. Nothing is copied from another site’s leaderboards.</p>
      </div>

      <h2>wOBA and wRC+</h2>
      <p>
        wOBA weights each way of reaching base by how many runs it’s worth. We use standard linear weights and rescale them each day so league-average wOBA equals league OBP ({f.rate(lg.woba)} in {data.season}). wRC+ turns that into runs created per plate appearance, relative to the league: 100 is average, 150 is 50% better.
      </p>
      <p>Our wRC+ isn’t adjusted for ballparks yet, so hitters in Coors Field look a little better than they are.</p>

      <h2>FIP</h2>
      <p>
        FIP only counts what a pitcher controls: strikeouts, walks, hit batters and home runs. The constant ({f.dec(lg.cFip)} this season) puts it on the same scale as ERA, so league-average FIP equals league ERA ({f.dec(lg.era)}).
      </p>

      <h2>Trend lines</h2>
      <p>Hitters show a rolling 15-game wRC+. Pitchers show a rolling 5-appearance FIP, drawn so up means better. The faint line is league average.</p>

      <h2>Contract value</h2>
      <p>
        Hitters earn runs above average from wOBA, plus {m.hitterReplacementPer600} runs per 600 plate appearances for being better than a replacement-level call-up. Pitchers earn runs from how far their FIP beats a replacement level set {m.spReplacementGap} runs per nine innings worse than average for starters, {m.rpReplacementGap} for relievers.
      </p>
      <p>
        Runs become wins at {m.runsPerWin} runs per win (calculated from this season’s scoring). Wins become dollars at {f.money(m.dollarsPerWin)} each, a rough free-agent market price. Defence, baserunning and position aren’t counted yet, so shortstops and catchers are undervalued.
      </p>
      <p>Salaries are average annual value from public reporting, kept in a file in the project’s repository.</p>

      <h2>Qualifying</h2>
      <p>
        Season leaderboards use the usual qualifiers: 3.1 plate appearances or 1 inning per team game. The last-30-day boards scale that to the games in the window.
      </p>
      <p><a href="#hitters">Back to the leaderboards</a></p>
    </section>
  )
}
