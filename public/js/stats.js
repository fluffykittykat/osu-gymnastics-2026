/* ===== OSU Gymnastics 2026 - Stats Module ===== */
/* Shared statistical computation library.
   Loaded before app.js; available as window.StatsLib in browser,
   or via module.exports in Node. */

(function (root) {
  'use strict';

  var EVENTS = ['vault', 'bars', 'beam', 'floor'];

  // ───── Core Math ─────

  function mean(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
  }

  /** Population standard deviation (N denominator). */
  function stddev(arr) {
    if (!arr || arr.length < 2) return 0;
    var m = mean(arr);
    var sumSq = arr.reduce(function (s, v) { return s + Math.pow(v - m, 2); }, 0);
    return Math.sqrt(sumSq / arr.length);
  }

  /** Pearson correlation coefficient. Returns null if n < 3 or zero variance. */
  function pearson(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var mx = mean(xs), my = mean(ys);
    var num = xs.reduce(function (s, x, i) { return s + (x - mx) * (ys[i] - my); }, 0);
    var den = Math.sqrt(
      xs.reduce(function (s, x) { return s + Math.pow(x - mx, 2); }, 0) *
      ys.reduce(function (s, y) { return s + Math.pow(y - my, 2); }, 0)
    );
    return den === 0 ? null : num / den;
  }

  /** Simple linear regression. Returns { slope, intercept, r2 }. */
  function linReg(pts) {
    var n = pts.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
    var sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (var i = 0; i < n; i++) {
      sx += pts[i].x;
      sy += pts[i].y;
      sxy += pts[i].x * pts[i].y;
      sx2 += pts[i].x * pts[i].x;
    }
    var denom = n * sx2 - sx * sx;
    if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 };
    var slope = (n * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / n;
    var my = sy / n;
    var ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) {
      var predicted = slope * pts[j].x + intercept;
      ssRes += Math.pow(pts[j].y - predicted, 2);
      ssTot += Math.pow(pts[j].y - my, 2);
    }
    var r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    return { slope: slope, intercept: intercept, r2: r2 };
  }

  function fmt(n, dp) {
    if (dp === undefined) dp = 3;
    return n != null && !isNaN(n) ? n.toFixed(dp) : '\u2014';
  }

  // ───── Data Helpers ─────

  function sortedByDate(meets) {
    return meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /** Deduplicate meets to unique competition days (by date), sorted chronologically. */
  function dedupByDate(meets) {
    var seen = {};
    var out = [];
    var sorted = sortedByDate(meets);
    for (var i = 0; i < sorted.length; i++) {
      if (!seen[sorted[i].date]) {
        seen[sorted[i].date] = true;
        out.push(sorted[i]);
      }
    }
    return out;
  }

  // ── getAthleteEntries ─────────────────────────────────────────────────────
  // Returns chronological array of {score, date, meetId, opponent, isHome, result}
  // for a given athlete + event, deduped by date (quad meet days).
  function getAthleteEntries(meets, name, event) {
    var out = [];
    var seenDates = {};
    var sorted = sortedByDate(meets);
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (seenDates[m.date]) continue;
      if (!m.athletes) continue;
      for (var j = 0; j < m.athletes.length; j++) {
        var a = m.athletes[j];
        if (a.name === name && a.scores[event] !== undefined) {
          seenDates[m.date] = true;
          out.push({
            score: a.scores[event],
            date: m.date,
            meetId: m.id,
            opponent: m.opponent || '?',
            isHome: m.isHome,
            result: m.result
          });
          break;
        }
      }
    }
    return out;
  }

  // ── getAthleteStats ───────────────────────────────────────────────────────
  // Returns { perEvent: { vault: {avg,best,worst,sd,trend,scores[],count}, ... }, aa: {scores[],avg,best,count} }
  function getAthleteStats(meets, name) {
    var perEvent = {};
    for (var ei = 0; ei < EVENTS.length; ei++) {
      var ev = EVENTS[ei];
      var entries = getAthleteEntries(meets, name, ev);
      if (!entries.length) continue;
      var scores = entries.map(function (e) { return e.score; });
      var pts = entries.map(function (e, i) { return { x: i, y: e.score }; });
      var reg = linReg(pts);
      perEvent[ev] = {
        avg: mean(scores),
        best: Math.max.apply(null, scores),
        worst: Math.min.apply(null, scores),
        sd: stddev(scores),
        trend: reg.slope,
        scores: scores,
        count: scores.length,
        entries: entries
      };
    }

    // AA scores
    var aaEntries = getAthleteEntries(meets, name, 'aa');
    var aaScores = aaEntries.map(function (e) { return e.score; });
    var aa = {
      scores: aaScores,
      avg: aaScores.length ? mean(aaScores) : null,
      best: aaScores.length ? Math.max.apply(null, aaScores) : null,
      count: aaScores.length,
      entries: aaEntries
    };

    return { perEvent: perEvent, aa: aa };
  }

  // ── getEventStats ─────────────────────────────────────────────────────────
  // Team event stats across the season, deduped by date.
  // Returns { avg, best, worst, sd, trend, byMeet: [{date, score, opponent, meetId}] }
  function getEventStats(meets, event) {
    var deduped = dedupByDate(meets);
    var byMeet = [];
    for (var i = 0; i < deduped.length; i++) {
      var m = deduped[i];
      if (m.events && m.events[event] && m.events[event].osu > 0) {
        byMeet.push({ date: m.date, score: m.events[event].osu, opponent: m.opponent, meetId: m.id });
      }
    }
    var scores = byMeet.map(function (e) { return e.score; });
    if (!scores.length) return { avg: null, best: null, worst: null, sd: 0, trend: 0, byMeet: [] };
    var pts = byMeet.map(function (e, i) { return { x: i, y: e.score }; });
    var reg = linReg(pts);
    return {
      avg: mean(scores),
      best: Math.max.apply(null, scores),
      worst: Math.min.apply(null, scores),
      sd: stddev(scores),
      trend: reg.slope,
      byMeet: byMeet
    };
  }

  // ── getTeamSeasonStats ────────────────────────────────────────────────────
  // Returns { record:{w,l}, totalAvg, byEvent:{vault:{avg,best},...}, seasonHigh, recentN:[] }
  function getTeamSeasonStats(meets) {
    var deduped = dedupByDate(meets);
    var scored = deduped.filter(function (m) { return m.osuScore && m.osuScore > 0; });
    var totals = scored.map(function (m) { return m.osuScore; });

    var w = 0, l = 0;
    meets.forEach(function (m) {
      if (m.result === 'W') w++;
      else if (m.result === 'L') l++;
    });

    var byEvent = {};
    EVENTS.forEach(function (ev) {
      var evScores = scored
        .filter(function (m) { return m.events && m.events[ev] && m.events[ev].osu > 0; })
        .map(function (m) { return m.events[ev].osu; });
      if (evScores.length) {
        byEvent[ev] = { avg: mean(evScores), best: Math.max.apply(null, evScores) };
      }
    });

    return {
      record: { w: w, l: l },
      totalAvg: mean(totals),
      byEvent: byEvent,
      seasonHigh: totals.length ? Math.max.apply(null, totals) : null,
      recentN: totals.slice(-3),
      compDays: scored
    };
  }

  // ── getSeasonRankings ─────────────────────────────────────────────────────
  // Aggregates allTeams[] across all meets (deduped by date) into a ranked table.
  // Returns [{ team, appearances, avgTotal, bestTotal, vault, bars, beam, floor }]
  function getSeasonRankings(meets) {
    var teamMap = {};
    var deduped = dedupByDate(meets);
    for (var i = 0; i < deduped.length; i++) {
      var m = deduped[i];
      if (!m.allTeams) continue;
      for (var j = 0; j < m.allTeams.length; j++) {
        var t = m.allTeams[j];
        if (!t.team || t.total == null) continue;
        var key = t.team.trim();
        if (!teamMap[key]) teamMap[key] = { totals: [], vaults: [], barss: [], beams: [], floors: [] };
        teamMap[key].totals.push(t.total);
        if (t.vault != null) teamMap[key].vaults.push(t.vault);
        if (t.bars != null) teamMap[key].barss.push(t.bars);
        if (t.beam != null) teamMap[key].beams.push(t.beam);
        if (t.floor != null) teamMap[key].floors.push(t.floor);
      }
    }

    var rankings = Object.keys(teamMap).map(function (key) {
      var d = teamMap[key];
      return {
        team: key,
        appearances: d.totals.length,
        avgTotal: mean(d.totals),
        bestTotal: Math.max.apply(null, d.totals),
        vault: mean(d.vaults),
        bars: mean(d.barss),
        beam: mean(d.beams),
        floor: mean(d.floors)
      };
    });
    rankings.sort(function (a, b) { return b.avgTotal - a.avgTotal; });
    return rankings;
  }

  // ── getLineupPositionStats ────────────────────────────────────────────────
  // Returns { positions: [{position, avg, count, best, scores[]}], anchor: {name,avg,count}, leadoff: {name,avg,count} }
  function getLineupPositionStats(meets, event) {
    var posMap = {};
    var anchorMap = {};
    var leadoffMap = {};
    var deduped = dedupByDate(meets);

    for (var i = 0; i < deduped.length; i++) {
      var m = deduped[i];
      if (!m.lineups || !m.lineups[event] || m.lineups[event].length < 5) continue;
      var lineup = m.lineups[event];
      var maxPos = lineup.length;

      for (var j = 0; j < lineup.length; j++) {
        var entry = lineup[j];
        var pos = entry.position || (j + 1);
        if (!posMap[pos]) posMap[pos] = [];
        posMap[pos].push(entry.score);

        if (pos === maxPos) {
          if (!anchorMap[entry.name]) anchorMap[entry.name] = [];
          anchorMap[entry.name].push(entry.score);
        }
        if (pos === 1) {
          if (!leadoffMap[entry.name]) leadoffMap[entry.name] = [];
          leadoffMap[entry.name].push(entry.score);
        }
      }
    }

    var positions = Object.keys(posMap).map(function (pos) {
      var scores = posMap[pos];
      return {
        position: parseInt(pos, 10),
        avg: mean(scores),
        count: scores.length,
        best: Math.max.apply(null, scores),
        scores: scores
      };
    }).sort(function (a, b) { return a.position - b.position; });

    function topPerformer(map) {
      var best = null;
      Object.keys(map).forEach(function (name) {
        var scores = map[name];
        var thisAvg = mean(scores);
        if (!best || thisAvg > best.avg || (thisAvg === best.avg && scores.length > best.count)) {
          best = { name: name, avg: thisAvg, count: scores.length };
        }
      });
      return best;
    }

    return {
      positions: positions,
      anchor: topPerformer(anchorMap),
      leadoff: topPerformer(leadoffMap)
    };
  }

  // ── getRollingAverage ─────────────────────────────────────────────────────
  // Returns [{date, avg, score}] for n-meet rolling average of team total.
  function getRollingAverage(meets, n) {
    if (!n) n = 3;
    var deduped = dedupByDate(meets);
    var scored = deduped.filter(function (m) { return m.osuScore && m.osuScore > 0; });
    var result = [];
    for (var i = 0; i < scored.length; i++) {
      if (i < n - 1) {
        result.push({ date: scored[i].date, avg: null, score: scored[i].osuScore });
        continue;
      }
      var window = [];
      for (var j = i - n + 1; j <= i; j++) window.push(scored[j].osuScore);
      result.push({ date: scored[i].date, avg: mean(window), score: scored[i].osuScore });
    }
    return result;
  }

  // ── getAALeaderboard ──────────────────────────────────────────────────────
  // Returns [{ name, best, avg, count, trend, entries }] sorted by best AA.
  function getAALeaderboard(meets) {
    var byName = {};
    var sorted = sortedByDate(meets);
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (!m.athletes) continue;
      for (var j = 0; j < m.athletes.length; j++) {
        var a = m.athletes[j];
        if (a.scores && a.scores.aa != null && a.team === 'Oregon State') {
          if (!byName[a.name]) byName[a.name] = [];
          var exists = false;
          for (var k = 0; k < byName[a.name].length; k++) {
            if (byName[a.name][k].date === m.date) { exists = true; break; }
          }
          if (!exists) {
            byName[a.name].push({ score: a.scores.aa, date: m.date, meetId: m.id, opponent: m.opponent });
          }
        }
      }
    }

    var result = [];
    Object.keys(byName).forEach(function (name) {
      var entries = byName[name];
      var scores = entries.map(function (e) { return e.score; });
      var pts = entries.map(function (e, i) { return { x: i, y: e.score }; });
      var reg = linReg(pts);
      var bestEntry = entries.reduce(function (a, b) { return a.score > b.score ? a : b; });
      result.push({
        name: name,
        best: bestEntry.score,
        bestEntry: bestEntry,
        avg: mean(scores),
        count: scores.length,
        trend: reg.slope,
        entries: entries
      });
    });
    result.sort(function (a, b) { return b.best - a.best; });
    return result;
  }

  // ── getAthleteComparisonData ──────────────────────────────────────────────
  // Returns { a: athleteStats, b: athleteStats, sharedEvents: [], sharedDates: [] }
  function getAthleteComparisonData(meets, nameA, nameB) {
    var statsA = getAthleteStats(meets, nameA);
    var statsB = getAthleteStats(meets, nameB);

    var sharedEvents = [];
    EVENTS.forEach(function (ev) {
      if (statsA.perEvent[ev] && statsB.perEvent[ev]) sharedEvents.push(ev);
    });

    var datesA = {}, datesB = {};
    sortedByDate(meets).forEach(function (m) {
      if (!m.athletes) return;
      m.athletes.forEach(function (a) {
        if (a.name === nameA) datesA[m.date] = true;
        if (a.name === nameB) datesB[m.date] = true;
      });
    });
    var sharedDates = Object.keys(datesA).filter(function (d) { return datesB[d]; }).sort();

    return { a: statsA, b: statsB, sharedEvents: sharedEvents, sharedDates: sharedDates };
  }

  // ── getNQSBreakdown ───────────────────────────────────────────────────────
  // Returns { scores: [{name,score,dropped}], nqs, dropName, dropScore } or null.
  function getNQSBreakdown(meet, event) {
    if (!meet.lineups || !meet.lineups[event] || meet.lineups[event].length < 5) return null;
    var lineup = meet.lineups[event].slice().sort(function (a, b) { return a.position - b.position; });
    var scores = lineup.map(function (e) {
      return { name: e.name, score: e.score, position: e.position, dropped: false };
    });

    if (scores.length >= 6) {
      var minIdx = 0;
      for (var i = 1; i < scores.length; i++) {
        if (scores[i].score < scores[minIdx].score) minIdx = i;
      }
      scores[minIdx].dropped = true;
    }

    var counting = scores.filter(function (s) { return !s.dropped; });
    var nqs = counting.reduce(function (sum, s) { return sum + s.score; }, 0);
    var dropped = scores.find(function (s) { return s.dropped; });

    return {
      scores: scores,
      nqs: nqs,
      dropName: dropped ? dropped.name : null,
      dropScore: dropped ? dropped.score : null
    };
  }

  // ── getScoreDistribution ──────────────────────────────────────────────────
  // Returns { min, q1, median, q3, max, scores[] } for OSU individual scores on an event.
  function getScoreDistribution(meets, event) {
    var allScores = [];
    var seenKeys = {};
    meets.forEach(function (m) {
      if (!m.athletes) return;
      m.athletes.forEach(function (a) {
        if (a.team !== 'Oregon State') return;
        if (a.scores[event] !== undefined && a.scores[event] > 0) {
          var key = a.name + '|' + m.date;
          if (!seenKeys[key]) {
            seenKeys[key] = true;
            allScores.push(a.scores[event]);
          }
        }
      });
    });

    allScores.sort(function (a, b) { return a - b; });
    var n = allScores.length;
    if (n === 0) return { min: null, q1: null, median: null, q3: null, max: null, scores: [] };

    function quantile(arr, q) {
      var pos = (arr.length - 1) * q;
      var base = Math.floor(pos);
      var rest = pos - base;
      if (arr[base + 1] !== undefined) return arr[base] + rest * (arr[base + 1] - arr[base]);
      return arr[base];
    }

    return {
      min: allScores[0],
      q1: quantile(allScores, 0.25),
      median: quantile(allScores, 0.5),
      q3: quantile(allScores, 0.75),
      max: allScores[n - 1],
      scores: allScores
    };
  }

  // ───── Export ─────
  var StatsLib = {
    mean: mean,
    stddev: stddev,
    pearson: pearson,
    linReg: linReg,
    fmt: fmt,
    EVENTS: EVENTS,
    dedupByDate: dedupByDate,
    getAthleteEntries: getAthleteEntries,
    getAthleteStats: getAthleteStats,
    getEventStats: getEventStats,
    getTeamSeasonStats: getTeamSeasonStats,
    getSeasonRankings: getSeasonRankings,
    getLineupPositionStats: getLineupPositionStats,
    getRollingAverage: getRollingAverage,
    getAALeaderboard: getAALeaderboard,
    getAthleteComparisonData: getAthleteComparisonData,
    getNQSBreakdown: getNQSBreakdown,
    getScoreDistribution: getScoreDistribution
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatsLib;
  }
  if (typeof root !== 'undefined') {
    root.StatsLib = StatsLib;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
