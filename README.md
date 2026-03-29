# OSU Gymnastics 2026

## Stats API

All stats are pre-computed server-side when data loads and cached in memory. Stats are recomputed on data refresh.

### Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/stats` | Full stats bundle (team, events, athletes, leaderboards, heatmap, competitors) |
| `GET /api/stats/summary` | Lightweight summary: record, team avg, season high, last meet |
| `GET /api/stats/team` | Team-level stats: W-L record, season avg/high/low, home/away, NQS, hot/cold athletes, trajectory |
| `GET /api/stats/athletes` | All athlete stats keyed by name |
| `GET /api/stats/athletes/:name` | Single athlete stats (URL-encode the name, e.g. `/api/stats/athletes/Taylor%20DeVries`) |
| `GET /api/stats/events/:event` | Single event stats: `vault`, `bars`, `beam`, or `floor` |

### Stats Bundle Schema

```json
{
  "team": {
    "record": { "wins": 7, "losses": 10 },
    "dayRecord": { "wins": 5, "losses": 8 },
    "seasonAvg": 196.066,
    "seasonHigh": 197.250,
    "seasonLow": 194.675,
    "homeAvg": 196.690,
    "awayAvg": 195.546,
    "trajectory": 0.123,
    "nqs": 196.690,
    "nqsDetail": { "nqs": 196.690, "scoresUsed": [...], "dropped": 196.35 },
    "hotCold": { "hot": [...], "cold": [...] },
    "scoreTrend": [{ "date": "...", "score": 196.5, "isHome": true, "opponent": "..." }]
  },
  "eventTrends": {
    "vault": { "seasonAvg": 9.739, "recentAvg": 9.806, "trendDirection": "up", "rotationRecord": { "wins": 7, "losses": 10 } }
  },
  "events": {
    "vault": {
      "seasonAvg": 48.925, "best": 49.3, "worst": 48.5, "stdDev": 0.25,
      "topScores": [{ "name": "...", "score": 9.9, "date": "...", "opponent": "..." }],
      "lineupPositionAvgs": { "1": { "avg": 9.72, "best": 9.85, "count": 11 }, ... }
    }
  },
  "athletes": {
    "Athlete Name": {
      "name": "...", "totalAppearances": 22,
      "bio": { "classYear": "Freshman", "position": "All-Around" },
      "events": {
        "vault": { "avg": 9.78, "best": 9.9, "stdDev": 0.05, "trendSlope": 0.003, "homeDelta": 0.02, "clutchAvg": 9.8 }
      }
    }
  },
  "leaderboards": { "vault": [{ "name": "...", "avg": 9.8, "best": 9.9, "appearances": 10 }] },
  "heatmap": { "teamAvgs": { "vault": 9.73 }, "gymnasts": [{ "name": "...", "overallAvg": 9.75, "evAvgs": {...}, "evDelta": {...} }] },
  "competitors": { "UCLA": { "meetsPlayed": 1, "eventAvgs": {...}, "topScorers": {...} } },
  "summary": { "record": "7-10", "teamAvg": 196.066, "seasonHigh": 197.250, "meetsPlayed": 11, "lastMeetDate": "2026-03-14" },
  "computedAt": "2026-03-29T06:35:43.486Z"
}
```

### Stats Module

The stats computation lives in `stats/stats.js` — a pure Node.js module with no Express dependency. Can be run standalone:

```bash
node stats/stats.js  # Prints summary to console
```
