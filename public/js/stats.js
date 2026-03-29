/* ===== OSU Gymnastics 2026 - Stats Module ===== */

window.Stats = (function () {
  'use strict';

  function mean(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
  }

  function stddev(arr) {
    if (!arr || arr.length < 2) return 0;
    var m = mean(arr);
    return Math.sqrt(arr.reduce(function (s, v) { return s + Math.pow(v - m, 2); }, 0) / (arr.length - 1));
  }

  function pearson(xs, ys) {
    if (!xs || !ys) return null;
    var n = xs.length;
    if (n < 3 || ys.length < 3) return null;
    var mx = mean(xs), my = mean(ys);
    var num = xs.reduce(function (s, x, i) { return s + (x - mx) * (ys[i] - my); }, 0);
    var denX = xs.reduce(function (s, x) { return s + Math.pow(x - mx, 2); }, 0);
    var denY = ys.reduce(function (s, y) { return s + Math.pow(y - my, 2); }, 0);
    var den = Math.sqrt(denX * denY);
    return den === 0 ? null : num / den;
  }

  function linReg(pts) {
    if (!pts || pts.length < 2) return { slope: 0, intercept: 0 };
    var n = pts.length;
    var sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (var i = 0; i < n; i++) {
      sx += pts[i].x;
      sy += pts[i].y;
      sxy += pts[i].x * pts[i].y;
      sx2 += pts[i].x * pts[i].x;
    }
    var denom = n * sx2 - sx * sx;
    var slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / n;
    return { slope: slope, intercept: intercept };
  }

  function getAthleteEntries(meets, name, event) {
    if (!meets || !name || !event) return [];
    var entries = [];
    var seenDates = {};
    var sorted = meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (seenDates[m.date]) continue;
      if (!m.athletes) continue;
      for (var j = 0; j < m.athletes.length; j++) {
        var a = m.athletes[j];
        if (a.name === name && a.scores && a.scores[event] !== undefined) {
          seenDates[m.date] = true;
          entries.push({
            score: a.scores[event],
            date: m.date,
            meetId: m.id,
            opponent: m.opponent,
            isHome: m.isHome
          });
          break;
        }
      }
    }
    return entries;
  }

  function getAthleteStats(meets, name) {
    if (!meets || !name) return { perEvent: {}, aa: { scores: [], avg: null, best: null, count: 0 } };
    var events = ['vault', 'bars', 'beam', 'floor'];
    var perEvent = {};
    for (var ei = 0; ei < events.length; ei++) {
      var ev = events[ei];
      var entries = getAthleteEntries(meets, name, ev);
      var scores = entries.map(function (e) { return e.score; });
      var avg = mean(scores);
      var best = scores.length ? Math.max.apply(null, scores) : null;
      var worst = scores.length ? Math.min.apply(null, scores) : null;
      var sd = stddev(scores);
      var trend = null;
      if (entries.length >= 3) {
        var pts = entries.map(function (e, i) { return { x: i, y: e.score }; });
        trend = linReg(pts).slope;
      }
      perEvent[ev] = { avg: avg, best: best, worst: worst, sd: sd, trend: trend, entries: entries };
    }

    // AA scores
    var aaScores = [];
    var seenDates = {};
    var sorted = meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (seenDates[m.date]) continue;
      if (!m.athletes) continue;
      for (var j = 0; j < m.athletes.length; j++) {
        var a = m.athletes[j];
        if (a.name === name && a.scores && a.scores.aa !== undefined) {
          seenDates[m.date] = true;
          aaScores.push(a.scores.aa);
          break;
        }
      }
    }

    return {
      perEvent: perEvent,
      aa: {
        scores: aaScores,
        avg: mean(aaScores),
        best: aaScores.length ? Math.max.apply(null, aaScores) : null,
        count: aaScores.length
      }
    };
  }

  function getEventStats(meets, event) {
    if (!meets || !event) return { avg: null, best: null, worst: null, sd: 0, trend: null, byMeet: [] };
    var byMeet = [];
    var seenDates = {};
    var sorted = meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (seenDates[m.date]) continue;
      if (!m.events || !m.events[event] || m.events[event].osu == null || m.events[event].osu <= 0) continue;
      seenDates[m.date] = true;
      byMeet.push({ date: m.date, score: m.events[event].osu, meetId: m.id });
    }
    var scores = byMeet.map(function (d) { return d.score; });
    var trend = null;
    if (scores.length >= 3) {
      var pts = byMeet.map(function (d, i) { return { x: i, y: d.score }; });
      trend = linReg(pts).slope;
    }
    return {
      avg: mean(scores),
      best: scores.length ? Math.max.apply(null, scores) : null,
      worst: scores.length ? Math.min.apply(null, scores) : null,
      sd: stddev(scores),
      trend: trend,
      byMeet: byMeet
    };
  }

  function getTeamSeasonStats(meets) {
    if (!meets) return { record: { w: 0, l: 0, t: 0 }, totalAvg: null, byEvent: {}, seasonHigh: null, recentN: [] };
    var w = 0, l = 0, t = 0;
    for (var i = 0; i < meets.length; i++) {
      if (meets[i].result === 'W') w++;
      else if (meets[i].result === 'L') l++;
    }

    // Unique competition days for totals
    var compDays = [];
    var seenDates = {};
    var sorted = meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (seenDates[m.date]) continue;
      if (!m.osuScore || m.osuScore <= 0) continue;
      seenDates[m.date] = true;
      compDays.push(m);
    }

    var totals = compDays.map(function (m) { return m.osuScore; });
    var totalAvg = mean(totals);
    var seasonHigh = totals.length ? Math.max.apply(null, totals) : null;
    var recentN = compDays.slice(-3);

    var events = ['vault', 'bars', 'beam', 'floor'];
    var byEvent = {};
    for (var ei = 0; ei < events.length; ei++) {
      var ev = events[ei];
      var evScores = [];
      var seenEv = {};
      for (var i = 0; i < sorted.length; i++) {
        var m = sorted[i];
        if (seenEv[m.date]) continue;
        if (m.events && m.events[ev] && m.events[ev].osu != null && m.events[ev].osu > 0) {
          seenEv[m.date] = true;
          evScores.push(m.events[ev].osu);
        }
      }
      byEvent[ev] = {
        avg: mean(evScores),
        best: evScores.length ? Math.max.apply(null, evScores) : null
      };
    }

    return {
      record: { w: w, l: l, t: t },
      totalAvg: totalAvg,
      byEvent: byEvent,
      seasonHigh: seasonHigh,
      recentN: recentN.map(function (m) { return { date: m.date, score: m.osuScore, meetId: m.id }; })
    };
  }

  function getSeasonRankings(meets) {
    if (!meets) return [];
    var teamMap = {};
    var seenDates = {};
    for (var i = 0; i < meets.length; i++) {
      var m = meets[i];
      if (!m.allTeams) continue;
      if (seenDates[m.date]) continue;
      seenDates[m.date] = true;
      for (var j = 0; j < m.allTeams.length; j++) {
        var t = m.allTeams[j];
        if (!teamMap[t.team]) {
          teamMap[t.team] = { appearances: 0, totals: [], vaults: [], bars: [], beams: [], floors: [] };
        }
        teamMap[t.team].appearances++;
        if (t.total != null) teamMap[t.team].totals.push(t.total);
        if (t.vault != null) teamMap[t.team].vaults.push(t.vault);
        if (t.bars != null) teamMap[t.team].bars.push(t.bars);
        if (t.beam != null) teamMap[t.team].beams.push(t.beam);
        if (t.floor != null) teamMap[t.team].floors.push(t.floor);
      }
    }

    var rankings = [];
    var teams = Object.keys(teamMap);
    for (var i = 0; i < teams.length; i++) {
      var name = teams[i];
      var d = teamMap[name];
      rankings.push({
        team: name,
        appearances: d.appearances,
        avgTotal: mean(d.totals),
        bestTotal: d.totals.length ? Math.max.apply(null, d.totals) : null,
        vault: mean(d.vaults),
        bars: mean(d.bars),
        beam: mean(d.beams),
        floor: mean(d.floors)
      });
    }
    rankings.sort(function (a, b) { return (b.avgTotal || 0) - (a.avgTotal || 0); });
    return rankings;
  }

  function getLineupPositionStats(meets, event) {
    if (!meets || !event) return { byPosition: {} };
    var positions = {};
    for (var i = 0; i < meets.length; i++) {
      var m = meets[i];
      if (!m.lineups || !m.lineups[event] || !m.lineups[event].length) continue;
      var lineup = m.lineups[event];
      for (var j = 0; j < lineup.length; j++) {
        var entry = lineup[j];
        var pos = entry.position;
        if (!positions[pos]) positions[pos] = { scores: [], athletes: {} };
        positions[pos].scores.push(entry.score);
        if (!positions[pos].athletes[entry.name]) positions[pos].athletes[entry.name] = [];
        positions[pos].athletes[entry.name].push(entry.score);
      }
    }

    var byPosition = {};
    var posKeys = Object.keys(positions);
    for (var i = 0; i < posKeys.length; i++) {
      var pos = posKeys[i];
      var p = positions[pos];
      var avg = mean(p.scores);
      var count = p.scores.length;
      // Find top athlete by frequency
      var topAthlete = null, topCount = 0;
      var athleteNames = Object.keys(p.athletes);
      for (var j = 0; j < athleteNames.length; j++) {
        var aName = athleteNames[j];
        if (p.athletes[aName].length > topCount) {
          topCount = p.athletes[aName].length;
          topAthlete = aName;
        }
      }
      byPosition[pos] = { avg: avg, count: count, topAthlete: topAthlete };
    }

    return { byPosition: byPosition };
  }

  function getRollingAverage(meets, n) {
    if (!meets || !n) return [];
    var compDays = [];
    var seenDates = {};
    var sorted = meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (seenDates[m.date]) continue;
      if (!m.osuScore || m.osuScore <= 0) continue;
      seenDates[m.date] = true;
      compDays.push({ date: m.date, meetId: m.id, score: m.osuScore });
    }

    var result = [];
    for (var i = 0; i < compDays.length; i++) {
      if (i < n - 1) continue;
      var window = compDays.slice(i - n + 1, i + 1);
      var avg = mean(window.map(function (d) { return d.score; }));
      result.push({ date: compDays[i].date, meetId: compDays[i].meetId, rolling: avg });
    }
    return result;
  }

  function getAALeaderboard(meets) {
    if (!meets) return [];
    var athleteMap = {};
    var sorted = meets.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (!m.athletes) continue;
      for (var j = 0; j < m.athletes.length; j++) {
        var a = m.athletes[j];
        if (a.scores && a.scores.aa !== undefined) {
          if (!athleteMap[a.name]) athleteMap[a.name] = [];
          athleteMap[a.name].push({ score: a.scores.aa, date: m.date });
        }
      }
    }

    var leaderboard = [];
    var names = Object.keys(athleteMap);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      // Deduplicate by date
      var seenDates = {};
      var entries = [];
      for (var j = 0; j < athleteMap[name].length; j++) {
        var e = athleteMap[name][j];
        if (!seenDates[e.date]) {
          seenDates[e.date] = true;
          entries.push(e.score);
        }
      }
      if (entries.length === 0) continue;
      var best = Math.max.apply(null, entries);
      var avg = mean(entries);
      var trend = null;
      if (entries.length >= 3) {
        var pts = entries.map(function (s, idx) { return { x: idx, y: s }; });
        trend = linReg(pts).slope;
      }
      leaderboard.push({ name: name, best: best, avg: avg, count: entries.length, trend: trend });
    }
    leaderboard.sort(function (a, b) { return b.best - a.best; });
    return leaderboard;
  }

  function getAthleteComparisonData(meets, name1, name2, event) {
    if (!meets || !name1 || !name2 || !event) return { athlete1: null, athlete2: null };
    var e1 = getAthleteEntries(meets, name1, event);
    var e2 = getAthleteEntries(meets, name2, event);
    var s1 = e1.map(function (e) { return e.score; });
    var s2 = e2.map(function (e) { return e.score; });
    return {
      athlete1: {
        name: name1,
        entries: e1,
        avg: mean(s1),
        best: s1.length ? Math.max.apply(null, s1) : null
      },
      athlete2: {
        name: name2,
        entries: e2,
        avg: mean(s2),
        best: s2.length ? Math.max.apply(null, s2) : null
      }
    };
  }

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
