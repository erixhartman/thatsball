# That's ball, baby!

MLB leaderboards, refreshed every morning: the top 50 hitters by wRC+, the top 50 pitchers by FIP, and how much surplus value teams are getting from big contracts.

A from-scratch rebuild of the original thatsball.baby, which I made with Glenjamin.

## What's on it

- **Top 50 hitters.** wRC+ over the last 30 days or the full season, with a rolling 15-game trend line, slash line, wOBA, xwOBA, walk and strikeout rates.
- **Top 50 pitchers.** FIP over the same windows, with a rolling 5-appearance trend, ERA, xERA, K%, BB%, HR/9 and WHIP.
- **Contract value.** Each player's season converted to wins above replacement, then dollars, compared with his contract's average annual value.
- Filters for league, team and player name. Every column sorts.

## How it works

```
GitHub Action (daily, 10:15 UTC)
  └─ scripts/fetch-data.mjs
       ├─ MLB Stats API: season + last-30-day lines, game logs, teams
       ├─ Baseball Savant: xwOBA / xERA
       ├─ data/salaries.csv: contract AAVs
       └─ writes public/data/latest.json  →  commit  →  Vercel redeploys
React + Vite front end reads latest.json. No server, no database.
```

All stats are calculated here from raw counting stats. The method is explained on the site under "How the numbers work."

## Decisions

| Decision | Why |
|---|---|
| Calculate wRC+ and FIP myself | FanGraphs' terms don't allow scraping. Both stats can be built from the free MLB API, and doing it myself means I can explain every number. |
| No park adjustment yet | Needs a park-factor source I can use. Labelled on the site. |
| Hand-maintained salary file | Spotrac's terms ban scraping and republishing. A CSV is about two dozen lines and changes a few times a year. |
| Static JSON, rebuilt daily | Stats change once a day. A static file is free to host, fast, and can't go down at 2 a.m. |
| Skip the commit when nothing changed | In the offseason the data is frozen, so this avoids a pointless deploy every day. |
| Savant red/blue colour scale | Baseball fans already read red as hot and blue as cold from Baseball Savant. |

## Updating salaries

Edit `data/salaries.csv` (name, AAV in USD, years, final season, note) and push. Names are matched to MLB's player names, ignoring accents. Anyone who doesn't match is listed in `unmatchedSalaries` in the output.

## Run it locally

```bash
npm install
node scripts/fetch-data.mjs   # pull fresh stats
npm run dev
```

Data: MLB Stats API and Baseball Savant. Not affiliated with MLB.
