# Design Spec: Chatbot Intelligence Upgrade (#68)

**Date:** 2026-03-30
**Issue:** #68 — Chatbot must access meet-by-meet data for trend analysis
**Status:** Approved

## Problem

The chatbot falsely claims it can't do meet-by-meet trend analysis. The data exists in `meets.json` — the chatbot just doesn't have proper access to it. Currently only aggregate stats for the first 25 athletes are injected into the system prompt.

## Solution: Tiered Data Access with Agentic Tool Use

### Architecture

```
System Prompt (Pre-computed, always available)
├── Team summary (record, averages, NQS, trends)
├── ALL athlete summaries (avg, trend, strongest event, meet count)
└── Season highlights & notable performances

Claude Tool Use (On-demand, deep analysis)
├── get_athlete_progression — meet-by-meet scores
├── get_meet_details — full meet breakdown
├── compare_athletes — side-by-side comparison
├── get_event_rankings — rank athletes per event
├── get_team_trends — season trajectory
├── get_lineup_analysis — rotation position performance
├── search_athletes — fuzzy name matching
└── get_competitor_data — opponent scores
```

### Agentic Workflow

The chatbot follows a 6-step analytical process for every question:

1. **Understand** — Parse the user's intent, even if vaguely stated
2. **Plan** — Decide what data is needed and which tools to call
3. **Gather** — Fetch data via tool calls (possibly multiple rounds)
4. **Verify** — Cross-check data makes sense (score ranges, totals, dates)
5. **Analyze** — Perform calculations, find patterns, draw conclusions
6. **Present** — Deliver answer in clear, positive, data-backed format

### Server-Side Chat Loop

Replace single `client.messages.create()` with an agentic loop:

```
while response has tool_use blocks AND rounds < 5:
  execute each tool call against in-memory data
  feed results back to Claude
  call Claude again
return final text response
```

Safety caps:
- Max 5 tool-call rounds
- 45-second timeout for the entire loop
- If timeout hit, force response with available data

## Tool Definitions

### 1. get_athlete_progression
- **Input:** `athlete_name` (string)
- **Returns:** Meet-by-meet scores chronologically, per-event breakdown, AA totals, trend summary, best/worst meets
- **Data source:** Iterates `meetsData`, finds athlete entries, sorts by date

### 2. get_meet_details
- **Input:** `meet_id` (string) OR `date` (string), optional `event` (string)
- **Returns:** All athletes who competed, all scores, team total, opponent scores, result, location
- **Data source:** Finds meet in `meetsData` by id or date

### 3. compare_athletes
- **Input:** `athlete_names` (array of strings), optional `event` (string)
- **Returns:** Side-by-side stats — averages, trends, highs/lows per event, head-to-head meet comparison
- **Data source:** `statsCache.athletes` + `meetsData` for meet-by-meet

### 4. get_event_rankings
- **Input:** `event` (vault/bars/beam/floor), optional `metric` (average/high/consistency)
- **Returns:** All athletes ranked on that event by chosen metric, with scores
- **Data source:** `statsCache.athletes` filtered by event

### 5. get_team_trends
- **Input:** optional `event` (string)
- **Returns:** Team totals per meet chronologically, home/away splits, win/loss correlation, event-by-event team trends
- **Data source:** `meetsData` iterated chronologically

### 6. get_lineup_analysis
- **Input:** `event` (string), optional `athlete_name` (string)
- **Returns:** Performance by rotation position (1st through 6th), who competed in each spot, averages by position
- **Data source:** `meetsData` lineups for the event

### 7. search_athletes
- **Input:** `query` (string)
- **Returns:** Matching athlete names (fuzzy/partial match), basic stats for each
- **Data source:** `statsCache.athletes` keys, fuzzy matched

### 8. get_competitor_data
- **Input:** optional `meet_id` (string), optional `team_name` (string)
- **Returns:** Competitor athletes and scores from specified meet(s)
- **Data source:** `meetsData` competitorAthletes/competitorLineups

## Pre-Computed Context

Injected into every system prompt (replaces current approach):

- **Team overview:** Record, season average, season high, NQS, home/away splits, meets played
- **All athletes** (no 25-cap): Name, lineup appearances, season average per event, trend direction, strongest event, consistency score
- **Season highlights:** Top 3 individual scores, team season high meet, most improved athletes

Format: Compact structured text, not full JSON — minimize token usage while maximizing information density.

## System Prompt Structure

1. **Identity** — Positive, data-driven gymnastics analyst for OSU 2026 season
2. **Pre-computed data** — Team + all athlete summaries
3. **Analytical workflow** — 6-step process
4. **Efficiency rules:**
   - Answer from context first, only call tools for deeper data
   - Never call more than 3 tools for a simple question
   - Be decisive — gather what you need, then answer
   - Don't over-fetch data
5. **Tool descriptions** — When to use each tool
6. **Response formatting** — Tables for comparisons, bullet points for summaries, cite specific numbers, positive encouraging tone
7. **Verification** — Sanity-check scores (8.0-10.0 range), totals add up, dates chronological
8. **Tone** — Always positive, celebrate achievements, frame weaknesses as growth opportunities

## Changes Required

| Component | Change |
|-----------|--------|
| `server.js` — buildAthleteProfiles() | Include ALL athletes, richer summaries |
| `server.js` — buildTeamContext() | Add season highlights, trends |
| `server.js` — NEW tool handler functions | 8 functions querying in-memory data |
| `server.js` — POST /api/chat | Agentic loop with tool execution |
| `server.js` — System prompt | Complete rewrite |
| `server.js` — Config | max_tokens → 4096, timeout → 60s |
| Frontend | **No changes** |

## What's NOT in Scope

- No new browser-facing API endpoints (tools are internal)
- No database or new data files
- No changes to parse_pdfs.py or meets.json schema
- No frontend modifications
- No saved notes/analysis (#67 is separate)

## Acceptance Criteria

- [ ] Chatbot answers meet-by-meet progression questions with real data
- [ ] Chatbot performs trend analysis (improving/declining/stable)
- [ ] Chatbot identifies best/worst meet performance per athlete
- [ ] Chatbot compares athletes side-by-side with data
- [ ] Chatbot analyzes lineup/rotation position performance
- [ ] Chatbot accesses competitor data when asked
- [ ] Chatbot uses positive, encouraging tone
- [ ] Multi-round tool calls work without timeout
- [ ] Simple questions answered from pre-computed context (no tool calls needed)
- [ ] Complex questions use tools efficiently (max 5 rounds)
- [ ] No false "limitation" claims in responses
