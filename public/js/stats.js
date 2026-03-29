/* ===== OSU Gymnastics 2026 — Stats Module ===== */

window.Stats = (function () {
  'use strict';

  // ── Core Math ─────────────────────────────────────────────────────────────
  function mean(arr) {
    return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  }

  function stddev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (arr.length - 1));
  }

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = mean(xs), my = mean(ys);
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = Math.sqrt(
      xs.reduce((s, x) => s + Math.pow(x - mx, 2), 0) *
      ys.reduce((s, y) => s + Math.pow(y - my, 2), 0)
    );
    return den === 0 ? null : num / den;
  }

  function linReg(pts) {
    const n = pts.length;
    if (n < 2) return { slope: 0 };
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
    return { slope: (n * sxy - sx * sy) / (n * sx2 - sx * sx) || 0 };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const EVENTS = ['vault', 'bars', 'beam', 'floor'];

  function sortedByDate(meets) {
    return meets.slice().sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── getAthleteEntries ─────────────────────────────────────────────────────
  // Returns chronological array of {score, date, meetId, opponent, isHome, result}
  // for a given athlete + event, deduped by date (quad meet days).
  function getAthleteEntries(meets, name, event) {
    const out = [];
    const seenDates = new Set();
    sortedByDate(meets).forEach(meet => {
      if (seenDates.has(meet.date)) return;
      const a = meet.athletes.find(x => x.name === name);
      if (a && a.scores[event] !== undefined) {
        seenDates.add(meet.date);
        out.push({
          score: a.scores[event],
          date: meet.date,
          meetId: meet.id,
          opponent: meet.opponent,
          isHome: meet.isHome,
          result: meet.result
        });
      }
    });
    return out;
  }

  // ── getAthleteStats ───────────────────────────────────────────────────────
  // Returns per-event + overall stats for an athlete.
  function getAthleteStats(meets, name) {
    const stats = {};
    EVENTS.forEach(ev => {
      const entries = getAthleteEntries(meets, name, ev);
      if (!entries.length) return;
      const scores = entries.map(e => e.score);
      stats[ev] = {
        count: scores.length,
        avg: mean(scores),
        best: Math.max(...scores),
        worst: Math.min(...scores),
        stddev: stddev(scores),
        scores: scores,
        entries: entries
      };
    });
    // AA
    const aaEntries = getAthleteEntries(meets, name, 'aa');
    if (aaEntries.length) {
      const aaScores = aaEntries.map(e => e.score);
      stats.aa = {
        count: aaScores.length,
        avg: mean(aaScores),
        best: Math.max(...aaScores),
        worst: Math.min(...aaScores),
        stddev: stddev(aaScores),
        scores: aaScores,
        entries: aaEntries
      };
    }
    // Overall
    const allScores = EVENTS.flatMap(ev => (stats[ev] || { scores: [] }).scores);
    stats.overall = {
      count: allScores.length,
      avg: mean(allScores),
      stddev: stddev(allScores)
    };
    return stats;
  }

  // ── getEventStats ─────────────────────────────────────────────────────────
  // Team event stats across the season.
  function getEventStats(meets, event) {
    const scores = [];
    const seenDates = new Set();
    sortedByDate(meets).forEach(m => {
      if (seenDates.has(m.date)) return;
      if (m.events && m.events[event] && m.events[event].osu > 0) {
        seenDates.add(m.date);
        scores.push({
          score: m.events[event].osu,
          oppScore: m.events[event].opponent,
          date: m.date,
          meetId: m.id,
          opponent: m.opponent
        });
      }
    });
    const vals = scores.map(s => s.score);
    return {
      count: vals.length,
      avg: mean(vals),
      best: vals.length ? Math.max(...vals) : null,
      worst: vals.length ? Math.min(...vals) : null,
      stddev: stddev(vals),
      entries: scores
    };
  }

  // ── getTeamSeasonStats ────────────────────────────────────────────────────
  function getTeamSeasonStats(meets) {
    const compDays = [];
    const seenDates = new Set();
    sortedByDate(meets).forEach(m => {
      if (seenDates.has(m.date)) return;
      if (!m.osuScore || m.osuScore <= 0) return;
      seenDates.add(m.date);
      compDays.push(m);
    });
    const totals = compDays.map(m => m.osuScore);
    const wins = meets.filter(m => m.result === 'W').length;
    const losses = meets.filter(m => m.result === 'L').length;
    return {
      meetCount: compDays.length,
      wins: wins,
      losses: losses,
      avg: mean(totals),
      best: totals.length ? Math.max(...totals) : null,
      worst: totals.length ? Math.min(...totals) : null,
      stddev: stddev(totals),
      compDays: compDays
    };
  }

  // ── getSeasonRankings ─────────────────────────────────────────────────────
  // Team season rankings from allTeams data across all meets, deduped by date.
  function getSeasonRankings(meets) {
    const teamTotals = {};
    const seenDates = new Set();
    sortedByDate(meets).forEach(m => {
      if (!m.allTeams || seenDates.has(m.date)) return;
      seenDates.add(m.date);
      m.allTeams.forEach(t => {
        if (!teamTotals[t.team]) {
          teamTotals[t.team] = { scores: [], vault: [], bars: [], beam: [], floor: [] };
        }
        if (t.total > 0) teamTotals[t.team].scores.push(t.total);
        if (t.vault > 0) teamTotals[t.team].vault.push(t.vault);
        if (t.bars > 0) teamTotals[t.team].bars.push(t.bars);
        if (t.beam > 0) teamTotals[t.team].beam.push(t.beam);
        if (t.floor > 0) teamTotals[t.team].floor.push(t.floor);
      });
    });
    return Object.entries(teamTotals)
      .map(([team, data]) => ({
        team: team,
        avg: mean(data.scores),
        best: data.scores.length ? Math.max(...data.scores) : null,
        meets: data.scores.length,
        vaultAvg: mean(data.vault),
        barsAvg: mean(data.bars),
        beamAvg: mean(data.beam),
        floorAvg: mean(data.floor)
      }))
      .filter(t => t.avg != null)
      .sort((a, b) => b.avg - a.avg);
  }

  // ── getLineupPositionStats ────────────────────────────────────────────────
  // Average score by lineup position 1-6 for a given event.
  function getLineupPositionStats(meets, event) {
    const positions = {};
    for (let i = 1; i <= 6; i++) positions[i] = [];

    meets.forEach(m => {
      if (!m.lineups || !m.lineups[event]) return;
      m.lineups[event].forEach(entry => {
        if (entry.position >= 1 && entry.position <= 6 && entry.score > 0) {
          positions[entry.position].push(entry.score);
        }
      });
    });

    return Object.entries(positions).map(([pos, scores]) => ({
      position: parseInt(pos),
      avg: mean(scores),
      count: scores.length,
      best: scores.length ? Math.max(...scores) : null,
      stddev: stddev(scores),
      scores: scores
    }));
  }

  // ── getRollingAverage ─────────────────────────────────────────────────────
  // Returns array of {date, avg} for n-meet rolling average of team total.
  function getRollingAverage(meets, n) {
    const compDays = [];
    const seenDates = new Set();
    sortedByDate(meets).forEach(m => {
      if (seenDates.has(m.date) || !m.osuScore || m.osuScore <= 0) return;
      seenDates.add(m.date);
      compDays.push({ date: m.date, score: m.osuScore });
    });

    const result = [];
    for (let i = n - 1; i < compDays.length; i++) {
      const window = compDays.slice(i - n + 1, i + 1);
      result.push({
        date: compDays[i].date,
        avg: mean(window.map(w => w.score)),
        index: i
      });
    }
    return result;
  }

  // ── getAALeaderboard ──────────────────────────────────────────────────────
  // All-Around leaderboard from scores.aa field.
  function getAALeaderboard(meets) {
    const byGymnast = {};
    sortedByDate(meets).forEach(meet => {
      meet.athletes.forEach(a => {
        if (a.scores && a.scores.aa !== undefined) {
          if (!byGymnast[a.name]) byGymnast[a.name] = [];
          byGymnast[a.name].push({
            score: a.scores.aa,
            meetDate: meet.date,
            opponent: meet.opponent,
            meetId: meet.id
          });
        }
      });
    });

    return Object.entries(byGymnast).map(([name, entries]) => {
      const scores = entries.map(e => e.score);
      const best = entries.reduce((a, b) => a.score > b.score ? a : b);
      const recent = entries[entries.length - 1];
      // Trend: compare first half to second half
      const half = Math.floor(scores.length / 2);
      let trend = null;
      if (scores.length >= 3) {
        const firstAvg = mean(scores.slice(0, half || 1));
        const secondAvg = mean(scores.slice(half || 1));
        trend = secondAvg - firstAvg;
      }
      return {
        name: name,
        best: best,
        avg: mean(scores),
        recent: recent,
        count: scores.length,
        scores: scores,
        entries: entries,
        trend: trend
      };
    }).sort((a, b) => b.best.score - a.best.score);
  }

  // ── getAthleteComparisonData ──────────────────────────────────────────────
  // Side-by-side stats for two athletes on a given event (or all events).
  function getAthleteComparisonData(meets, name1, name2, event) {
    if (event) {
      return {
        athlete1: { name: name1, entries: getAthleteEntries(meets, name1, event) },
        athlete2: { name: name2, entries: getAthleteEntries(meets, name2, event) }
      };
    }
    // All events comparison
    const stats1 = getAthleteStats(meets, name1);
    const stats2 = getAthleteStats(meets, name2);
    return {
      athlete1: { name: name1, stats: stats1 },
      athlete2: { name: name2, stats: stats2 }
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    mean: mean,
    stddev: stddev,
    pearson: pearson,
    linReg: linReg,
    getAthleteEntries: getAthleteEntries,
    getAthleteStats: getAthleteStats,
    getEventStats: getEventStats,
    getTeamSeasonStats: getTeamSeasonStats,
    getSeasonRankings: getSeasonRankings,
    getLineupPositionStats: getLineupPositionStats,
    getRollingAverage: getRollingAverage,
    getAALeaderboard: getAALeaderboard,
    getAthleteComparisonData: getAthleteComparisonData
  };
})();
