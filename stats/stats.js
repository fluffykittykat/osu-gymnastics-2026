/**
 * OSU Gymnastics 2026 — Stats Module
 *
 * Pure Node.js module (no Express dependency).
 * Computes all team, event, and individual stats from meets + bios data.
 *
 * Usage:
 *   const { computeStats } = require('./stats/stats');
 *   const bundle = computeStats(meetsData, biosData);
 */

'use strict';

const EVENTS = ['vault', 'bars', 'beam', 'floor'];

// ── Utility helpers ──────────────────────────────────────────────────────────

function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (arr.length - 1));
}

function linReg(pts) {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sx2 - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function safeMax(arr) { return arr.length ? Math.max(...arr) : null; }
function safeMin(arr) { return arr.length ? Math.min(...arr) : null; }

/**
 * Deduplicate meets by competition date.
 * Quad meets share a date — pick the first occurrence per date for team-level totals.
 */
function uniqueCompDays(meets) {
  const seen = new Set();
  const result = [];
  const sorted = meets.slice().sort((a, b) => a.date.localeCompare(b.date));
  sorted.forEach(m => {
    if (seen.has(m.date)) return;
    if (!m.osuScore || m.osuScore <= 0) return;
    seen.add(m.date);
    result.push(m);
  });
  return result;
}

/**
 * Get all unique OSU athlete names across all meets.
 */
function getAllAthleteNames(meets) {
  const names = new Set();
  meets.forEach(m => {
    (m.athletes || [])
      .filter(a => a.team === 'Oregon State')
      .forEach(a => names.add(a.name));
  });
  return [...names].sort();
}

// ── Team-level stats ─────────────────────────────────────────────────────────

function computeTeamStats(meets) {
  const compDays = uniqueCompDays(meets);
  const allScores = compDays.map(d => d.osuScore);
  const homeScores = compDays.filter(d => d.isHome).map(d => d.osuScore);
  const awayScores = compDays.filter(d => !d.isHome).map(d => d.osuScore);

  // W-L by matchup
  const wins = meets.filter(m => m.result === 'W').length;
  const losses = meets.filter(m => m.result === 'L').length;

  // W-L by competition day
  const dayWins = new Set();
  const dayLosses = new Set();
  meets.forEach(m => {
    if (m.result === 'W') dayWins.add(m.date);
    else if (m.result === 'L') dayLosses.add(m.date);
  });

  const teamAvg = mean(allScores);
  const homeAvg = mean(homeScores);
  const awayAvg = mean(awayScores);
  const seasonHigh = safeMax(allScores);
  const seasonLow = safeMin(allScores);

  // Season trajectory — first half vs second half
  const half = Math.floor(allScores.length / 2);
  const firstHalfAvg = half > 0 ? mean(allScores.slice(0, half)) : null;
  const secondHalfAvg = half > 0 ? mean(allScores.slice(half)) : null;
  const trajectory = firstHalfAvg != null && secondHalfAvg != null
    ? secondHalfAvg - firstHalfAvg : null;

  // Score trend array (for charts)
  const scoreTrend = compDays.map(d => ({
    date: d.date,
    score: d.osuScore,
    isHome: d.isHome,
    opponent: d.opponent,
    result: d.result,
  }));

  return {
    record: { wins, losses },
    dayRecord: { wins: dayWins.size, losses: dayLosses.size },
    seasonAvg: teamAvg,
    seasonHigh,
    seasonLow,
    homeAvg,
    awayAvg,
    trajectory,
    firstHalfAvg,
    secondHalfAvg,
    scoreTrend,
    meetsPlayed: compDays.length,
  };
}

// ── Event trends ─────────────────────────────────────────────────────────────

function computeEventTrends(meets) {
  const compDays = uniqueCompDays(meets);
  const sorted = compDays.slice().sort((a, b) => a.date.localeCompare(b.date));
  const trends = {};

  EVENTS.forEach(ev => {
    const pts = [];
    sorted.forEach(m => {
      const osuAthletes = (m.athletes || []).filter(a => a.team === 'Oregon State');
      const evScores = osuAthletes
        .map(a => a.scores[ev])
        .filter(s => s !== undefined && s > 0);
      if (evScores.length) {
        pts.push({ date: m.date, avg: mean(evScores), teamTotal: m.events?.[ev]?.osu || null });
      }
    });

    const avgs = pts.map(p => p.avg);
    const seasonAvg = mean(avgs);
    const recentAvg = pts.length >= 3 ? mean(pts.slice(-3).map(p => p.avg)) : seasonAvg;

    // Trend direction: first 3 vs last 3
    let trendDiff = null;
    let trendSlope = null;
    if (pts.length >= 4) {
      const firstAvg = mean(pts.slice(0, 3).map(p => p.avg));
      const lastAvg = mean(pts.slice(-3).map(p => p.avg));
      trendDiff = lastAvg - firstAvg;
    }
    if (pts.length >= 3) {
      trendSlope = linReg(pts.map((p, i) => ({ x: i, y: p.avg }))).slope;
    }

    // Rotation win/loss rate: did OSU beat opponent on this event?
    let rotWins = 0, rotLosses = 0;
    meets.forEach(m => {
      if (m.events?.[ev]?.osu && m.events?.[ev]?.opponent) {
        if (m.events[ev].osu > m.events[ev].opponent) rotWins++;
        else if (m.events[ev].osu < m.events[ev].opponent) rotLosses++;
      }
    });

    // Team-total based stats
    const teamTotals = pts.map(p => p.teamTotal).filter(t => t != null);

    trends[ev] = {
      seasonAvg,
      recentAvg,
      trendDirection: trendDiff == null ? 'flat' : trendDiff > 0.03 ? 'up' : trendDiff < -0.03 ? 'down' : 'flat',
      trendDiff,
      trendSlope,
      rotationRecord: { wins: rotWins, losses: rotLosses },
      teamTotalAvg: mean(teamTotals),
      teamTotalBest: safeMax(teamTotals),
      meetByMeet: pts,
    };
  });

  return trends;
}

// ── NQS (National Qualifying Score) ──────────────────────────────────────────

function computeNQS(meets) {
  // NQS = average of top 6 team totals from qualifying meets, dropping the lowest
  // Exclude exhibition meets
  const compDays = uniqueCompDays(meets);
  const qualifying = compDays.filter(m => !m.exhibition);
  const scores = qualifying.map(d => d.osuScore).sort((a, b) => b - a);

  if (scores.length < 2) return { nqs: null, scoresUsed: scores, dropped: null };

  // Top 6 scores
  const top6 = scores.slice(0, 6);
  // Drop lowest of those
  const dropped = top6.length > 1 ? top6[top6.length - 1] : null;
  const used = top6.length > 1 ? top6.slice(0, -1) : top6;
  const nqs = mean(used);

  return { nqs, scoresUsed: used, dropped, allScores: scores };
}

// ── Hot/Cold athletes ────────────────────────────────────────────────────────

function computeHotColdAthletes(meets) {
  const names = getAllAthleteNames(meets);
  const sorted = meets.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  function athleteRecentAvg(name, n) {
    const scores = [];
    const dates = new Set();
    sorted.forEach(m => {
      if (dates.size >= n || dates.has(m.date)) return;
      const a = (m.athletes || []).find(x => x.name === name && x.team === 'Oregon State');
      if (!a) return;
      const evScores = EVENTS.map(ev => a.scores[ev]).filter(s => s !== undefined && s > 0);
      if (!evScores.length) return;
      dates.add(m.date);
      evScores.forEach(s => scores.push(s));
    });
    return mean(scores);
  }

  function athleteSeasonAvg(name) {
    const scores = [];
    const seen = new Set();
    meets.forEach(m => {
      if (seen.has(m.date)) return;
      const a = (m.athletes || []).find(x => x.name === name && x.team === 'Oregon State');
      if (!a) return;
      const evScores = EVENTS.map(ev => a.scores[ev]).filter(s => s !== undefined && s > 0);
      if (!evScores.length) return;
      seen.add(m.date);
      evScores.forEach(s => scores.push(s));
    });
    return mean(scores);
  }

  const form = names.map(name => {
    const recent = athleteRecentAvg(name, 3);
    const season = athleteSeasonAvg(name);
    if (!recent || !season) return null;
    return { name, recent, season, diff: recent - season };
  }).filter(Boolean).sort((a, b) => b.diff - a.diff);

  const hot = form.slice(0, 3).filter(g => g.diff > 0.01);
  const cold = form.slice(-3).filter(g => g.diff < -0.01).reverse();

  return { hot, cold, all: form };
}

// ── Event-level stats ────────────────────────────────────────────────────────

function computeEventStats(meets, eventKey) {
  const seasonData = [];
  const seenDates = new Set();
  const sorted = meets.slice().sort((a, b) => a.date.localeCompare(b.date));

  sorted.forEach(m => {
    if (!m.events?.[eventKey]?.osu || m.events[eventKey].osu <= 0) return;
    const key = m.date + '|' + m.id;
    if (seenDates.has(key)) return;
    seenDates.add(key);
    seasonData.push({
      meetId: m.id,
      date: m.date,
      opponent: m.opponent,
      score: m.events[eventKey].osu,
      oppScore: m.events[eventKey].opponent,
      result: m.result,
      isHome: m.isHome,
    });
  });

  const scores = seasonData.map(d => d.score);
  const homeScores = seasonData.filter(d => d.isHome).map(d => d.score);
  const awayScores = seasonData.filter(d => !d.isHome).map(d => d.score);

  return {
    seasonAvg: mean(scores),
    best: safeMax(scores),
    worst: safeMin(scores),
    mostRecent: seasonData.length ? seasonData[seasonData.length - 1].score : null,
    stdDev: stddev(scores),
    homeAvg: mean(homeScores),
    awayAvg: mean(awayScores),
    meetByMeet: seasonData,
  };
}

function computeTopIndividualScores(meets, eventKey, limit = 10) {
  const scores = [];
  meets.forEach(m => {
    (m.athletes || [])
      .filter(a => a.team === 'Oregon State')
      .forEach(a => {
        if (a.scores[eventKey] !== undefined && a.scores[eventKey] > 0) {
          scores.push({
            name: a.name,
            score: a.scores[eventKey],
            date: m.date,
            opponent: m.opponent,
            meetId: m.id,
          });
        }
      });
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, limit);
}

function computeLineupPositionStats(meets, eventKey) {
  // Average score by lineup position (1–6) across all meets
  const byPosition = {};
  meets.forEach(m => {
    const lineup = m.lineups?.[eventKey];
    if (!lineup || !Array.isArray(lineup)) return;
    lineup.forEach(entry => {
      const pos = entry.position;
      if (!pos || !entry.score || entry.score <= 0) return;
      if (!byPosition[pos]) byPosition[pos] = [];
      byPosition[pos].push(entry.score);
    });
  });

  const result = {};
  Object.entries(byPosition).forEach(([pos, scores]) => {
    result[pos] = {
      avg: mean(scores),
      best: safeMax(scores),
      count: scores.length,
    };
  });

  return result;
}

// ── Individual athlete stats ─────────────────────────────────────────────────

function computeAthleteStats(meets, bios, athleteName) {
  const sorted = meets.slice().sort((a, b) => a.date.localeCompare(b.date));
  const t0 = sorted.length ? new Date(sorted[0].date + 'T12:00:00') : new Date();

  function evEntries(ev) {
    const out = [];
    const seen = new Set();
    sorted.forEach(meet => {
      if (seen.has(meet.date)) return;
      const a = (meet.athletes || []).find(x => x.name === athleteName && x.team === 'Oregon State');
      if (a && a.scores[ev] !== undefined) {
        seen.add(meet.date);
        out.push({
          score: a.scores[ev],
          date: meet.date,
          isHome: meet.isHome,
          result: meet.result,
          gap: Math.abs((meet.osuScore || 0) - (meet.opponentScore || 0)),
          day: Math.round((new Date(meet.date + 'T12:00:00') - t0) / 864e5),
          opponent: meet.opponent,
          meetId: meet.id,
        });
      }
    });
    return out;
  }

  const perEvent = {};
  let totalAppearances = 0;

  EVENTS.forEach(ev => {
    const entries = evEntries(ev);
    if (entries.length === 0) return;

    const scores = entries.map(e => e.score);
    const slope = entries.length >= 3
      ? linReg(entries.map(e => ({ x: e.day, y: e.score }))).slope * 7 // per week
      : null;

    const home = entries.filter(e => e.isHome).map(e => e.score);
    const away = entries.filter(e => !e.isHome).map(e => e.score);
    const wins = entries.filter(e => e.result === 'W').map(e => e.score);
    const losses = entries.filter(e => e.result === 'L').map(e => e.score);
    const close = entries.filter(e => e.gap < 1.0).map(e => e.score);
    const jan = entries.filter(e => new Date(e.date + 'T12:00:00').getMonth() === 0).map(e => e.score);
    const late = entries.filter(e => new Date(e.date + 'T12:00:00').getMonth() > 0).map(e => e.score);

    totalAppearances += entries.length;

    perEvent[ev] = {
      avg: mean(scores),
      best: safeMax(scores),
      worst: safeMin(scores),
      stdDev: stddev(scores),
      appearances: entries.length,
      trendSlope: slope,
      homeAvg: mean(home),
      awayAvg: mean(away),
      homeDelta: home.length && away.length ? mean(home) - mean(away) : null,
      winAvg: mean(wins),
      lossAvg: mean(losses),
      winLossDelta: wins.length && losses.length ? mean(wins) - mean(losses) : null,
      clutchAvg: mean(close),
      janAvg: mean(jan),
      lateAvg: mean(late),
      seasonDelta: jan.length && late.length ? mean(late) - mean(jan) : null,
      entries: entries.map(e => ({
        score: e.score,
        date: e.date,
        opponent: e.opponent,
        meetId: e.meetId,
      })),
    };
  });

  const bio = bios?.[athleteName] || null;

  return {
    name: athleteName,
    bio: bio ? {
      classYear: bio.classYear,
      hometown: bio.hometown,
      position: bio.position,
      height: bio.height,
    } : null,
    totalAppearances,
    events: perEvent,
  };
}

function computeAllAthleteStats(meets, bios) {
  const names = getAllAthleteNames(meets);
  const result = {};
  names.forEach(name => {
    result[name] = computeAthleteStats(meets, bios, name);
  });
  return result;
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

function computeLeaderboards(meets) {
  const leaderboards = {};

  EVENTS.forEach(ev => {
    const byGymnast = {};
    const sorted = meets.slice().sort((a, b) => a.date.localeCompare(b.date));

    sorted.forEach(meet => {
      (meet.athletes || []).forEach(a => {
        if (a.scores[ev] === undefined || a.scores[ev] <= 0) return;
        if (!byGymnast[a.name]) byGymnast[a.name] = { team: a.team, entries: [] };
        byGymnast[a.name].entries.push({
          score: a.scores[ev],
          date: meet.date,
          opponent: meet.opponent,
          meetId: meet.id,
        });
      });
    });

    const list = Object.entries(byGymnast).map(([name, data]) => {
      const scores = data.entries.map(e => e.score);
      const best = data.entries.reduce((a, b) => a.score > b.score ? a : b);
      return {
        name,
        team: data.team,
        avg: mean(scores),
        best: best.score,
        bestMeetDate: best.date,
        bestOpponent: best.opponent,
        bestMeetId: best.meetId,
        appearances: data.entries.length,
        recent: data.entries[data.entries.length - 1],
      };
    });

    // Sort by best score descending
    list.sort((a, b) => b.best - a.best);
    leaderboards[ev] = list;
  });

  return leaderboards;
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

function computeHeatmap(meets) {
  const gymnData = {};
  const seen = new Set();

  meets.forEach(m => {
    (m.athletes || [])
      .filter(a => a.team === 'Oregon State')
      .forEach(a => {
        if (!gymnData[a.name]) gymnData[a.name] = { vault: [], bars: [], beam: [], floor: [] };
        EVENTS.forEach(ev => {
          const s = a.scores[ev];
          if (s !== undefined && s > 0) {
            const key = `${a.name}|${ev}|${m.date}`;
            if (!seen.has(key)) {
              seen.add(key);
              gymnData[a.name][ev].push(s);
            }
          }
        });
      });
  });

  // Team averages per event
  const teamAvgs = {};
  EVENTS.forEach(ev => {
    const all = Object.values(gymnData).flatMap(g => g[ev]);
    teamAvgs[ev] = mean(all);
  });

  // Build matrix
  const matrix = Object.entries(gymnData).map(([name, evData]) => {
    const allScores = EVENTS.flatMap(ev => evData[ev]);
    const overallAvg = mean(allScores);
    const evAvgs = {};
    const evDelta = {};
    EVENTS.forEach(ev => {
      evAvgs[ev] = mean(evData[ev]);
      evDelta[ev] = evAvgs[ev] != null && teamAvgs[ev] != null
        ? evAvgs[ev] - teamAvgs[ev] : null;
    });
    return { name, overallAvg, evAvgs, evDelta };
  }).filter(g => g.overallAvg != null).sort((a, b) => b.overallAvg - a.overallAvg);

  return { teamAvgs, gymnasts: matrix };
}

// ── Competitor stats ─────────────────────────────────────────────────────────

function computeCompetitorStats(meets) {
  const competitors = {};

  meets.forEach(m => {
    const ca = m.competitorAthletes || {};
    Object.entries(ca).forEach(([team, athletes]) => {
      if (!competitors[team]) {
        competitors[team] = {
          meetsPlayed: 0,
          dates: [],
          eventTotals: { vault: [], bars: [], beam: [], floor: [] },
          individualScores: {},
        };
      }

      competitors[team].meetsPlayed++;
      competitors[team].dates.push(m.date);

      // The athletes data is a dict of { name: { event: score } }
      if (typeof athletes === 'object' && !Array.isArray(athletes)) {
        Object.entries(athletes).forEach(([name, scores]) => {
          if (typeof scores !== 'object') return;
          if (!competitors[team].individualScores[name]) {
            competitors[team].individualScores[name] = [];
          }
          Object.entries(scores).forEach(([ev, score]) => {
            if (typeof score === 'number' && score > 0 && EVENTS.includes(ev)) {
              competitors[team].eventTotals[ev].push(score);
              competitors[team].individualScores[name].push({ event: ev, score, date: m.date });
            }
          });
        });
      }
    });

    // Also include opponent from the meet's events data
    if (m.opponent && m.events) {
      const team = m.opponent;
      if (!competitors[team]) {
        competitors[team] = {
          meetsPlayed: 0,
          dates: [],
          eventTotals: { vault: [], bars: [], beam: [], floor: [] },
          individualScores: {},
        };
      }
    }
  });

  // Summarize per team
  const result = {};
  Object.entries(competitors).forEach(([team, data]) => {
    const eventAvgs = {};
    const topScorers = {};

    EVENTS.forEach(ev => {
      eventAvgs[ev] = mean(data.eventTotals[ev]);
    });

    // Top individual scores per event
    EVENTS.forEach(ev => {
      const scores = [];
      Object.entries(data.individualScores).forEach(([name, entries]) => {
        entries.filter(e => e.event === ev).forEach(e => {
          scores.push({ name, score: e.score, date: e.date });
        });
      });
      scores.sort((a, b) => b.score - a.score);
      topScorers[ev] = scores.slice(0, 5);
    });

    result[team] = {
      meetsPlayed: data.meetsPlayed,
      dates: data.dates,
      eventAvgs,
      topScorers,
      rosterSize: Object.keys(data.individualScores).length,
    };
  });

  return result;
}

// ── Summary endpoint ─────────────────────────────────────────────────────────

function computeSummary(meets) {
  const compDays = uniqueCompDays(meets);
  const wins = meets.filter(m => m.result === 'W').length;
  const losses = meets.filter(m => m.result === 'L').length;
  const allScores = compDays.map(d => d.osuScore);
  const lastMeet = compDays.length ? compDays[compDays.length - 1] : null;

  return {
    record: `${wins}-${losses}`,
    teamAvg: mean(allScores),
    seasonHigh: safeMax(allScores),
    meetsPlayed: compDays.length,
    lastMeetDate: lastMeet?.date || null,
    lastMeetOpponent: lastMeet?.opponent || null,
    lastMeetScore: lastMeet?.osuScore || null,
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

function computeStats(meets, bios) {
  if (!meets || !Array.isArray(meets)) meets = [];
  if (!bios || typeof bios !== 'object') bios = {};

  const team = computeTeamStats(meets);
  const nqs = computeNQS(meets);
  const hotCold = computeHotColdAthletes(meets);
  const eventTrends = computeEventTrends(meets);

  // Per-event stats
  const events = {};
  EVENTS.forEach(ev => {
    events[ev] = {
      ...computeEventStats(meets, ev),
      topScores: computeTopIndividualScores(meets, ev, 10),
      lineupPositionAvgs: computeLineupPositionStats(meets, ev),
    };
  });

  const athletes = computeAllAthleteStats(meets, bios);
  const leaderboards = computeLeaderboards(meets);
  const heatmap = computeHeatmap(meets);
  const competitors = computeCompetitorStats(meets);
  const summary = computeSummary(meets);

  return {
    team: { ...team, nqs: nqs.nqs, nqsDetail: nqs, hotCold },
    eventTrends,
    events,
    athletes,
    leaderboards,
    heatmap,
    competitors,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ── CLI test runner ──────────────────────────────────────────────────────────

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');

  let meets, bios;
  try {
    meets = JSON.parse(fs.readFileSync(path.join(dataDir, 'meets.json'), 'utf-8'));
  } catch (e) {
    console.error('Failed to load meets.json:', e.message);
    process.exit(1);
  }
  try {
    bios = JSON.parse(fs.readFileSync(path.join(dataDir, 'bios.json'), 'utf-8'));
  } catch (e) {
    bios = {};
  }

  const stats = computeStats(meets, bios);

  console.log('=== OSU Gymnastics 2026 Stats Summary ===');
  console.log(`Record: ${stats.team.record.wins}W - ${stats.team.record.losses}L`);
  console.log(`Day Record: ${stats.team.dayRecord.wins}W - ${stats.team.dayRecord.losses}L`);
  console.log(`Season Avg: ${stats.team.seasonAvg?.toFixed(3) || 'N/A'}`);
  console.log(`Season High: ${stats.team.seasonHigh?.toFixed(3) || 'N/A'}`);
  console.log(`NQS: ${stats.team.nqs?.toFixed(3) || 'N/A'}`);
  console.log(`Home Avg: ${stats.team.homeAvg?.toFixed(3) || 'N/A'}`);
  console.log(`Away Avg: ${stats.team.awayAvg?.toFixed(3) || 'N/A'}`);
  console.log(`\n--- Event Trends ---`);
  EVENTS.forEach(ev => {
    const t = stats.eventTrends[ev];
    console.log(`  ${ev}: avg=${t.seasonAvg?.toFixed(3)} recent=${t.recentAvg?.toFixed(3)} trend=${t.trendDirection} rotation=${t.rotationRecord.wins}W-${t.rotationRecord.losses}L`);
  });
  console.log(`\n--- Hot Athletes ---`);
  stats.team.hotCold.hot.forEach(g => console.log(`  🔥 ${g.name}: ${g.recent.toFixed(3)} (+${g.diff.toFixed(3)})`));
  console.log(`--- Cold Athletes ---`);
  stats.team.hotCold.cold.forEach(g => console.log(`  🧊 ${g.name}: ${g.recent.toFixed(3)} (${g.diff.toFixed(3)})`));
  console.log(`\nAthletes computed: ${Object.keys(stats.athletes).length}`);
  console.log(`Competitors tracked: ${Object.keys(stats.competitors).length}`);
  console.log(`Computed at: ${stats.computedAt}`);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  computeStats,
  computeTeamStats,
  computeEventTrends,
  computeNQS,
  computeHotColdAthletes,
  computeEventStats,
  computeTopIndividualScores,
  computeLineupPositionStats,
  computeAthleteStats,
  computeAllAthleteStats,
  computeLeaderboards,
  computeHeatmap,
  computeCompetitorStats,
  computeSummary,
  // Utilities exposed for testing
  mean,
  stddev,
  linReg,
};
