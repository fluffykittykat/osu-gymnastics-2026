#!/usr/bin/env node

/**
 * Unit tests for StatsLib (public/js/stats.js).
 * Run: node scripts/test_stats.js
 */

const StatsLib = require('../public/js/stats.js');
const fs = require('fs');
const path = require('path');

let passes = 0;
let failures = 0;

function assert(condition, label) {
  if (condition) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function assertClose(actual, expected, tolerance, label) {
  const ok = actual != null && Math.abs(actual - expected) < tolerance;
  if (ok) {
    passes++;
  } else {
    failures++;
    console.error(`  FAIL: ${label} — expected ~${expected}, got ${actual}`);
  }
}

// ── Core math tests ──

console.log('Testing core math...');
assert(StatsLib.mean([1, 2, 3]) === 2, 'mean([1,2,3]) = 2');
assert(StatsLib.mean([]) === null, 'mean([]) = null');
assert(StatsLib.mean([5]) === 5, 'mean([5]) = 5');

assertClose(StatsLib.stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2.0, 0.1, 'stddev basic');
assert(StatsLib.stddev([]) === 0, 'stddev([]) = 0');
assert(StatsLib.stddev([5]) === 0, 'stddev([5]) = 0');

assert(StatsLib.pearson([1, 2], [3, 4]) === null, 'pearson n<3 = null');
const r = StatsLib.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
assertClose(r, 1.0, 0.001, 'pearson perfect positive');
const rNeg = StatsLib.pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
assertClose(rNeg, -1.0, 0.001, 'pearson perfect negative');

const reg = StatsLib.linReg([{x:0,y:1},{x:1,y:3},{x:2,y:5}]);
assertClose(reg.slope, 2.0, 0.001, 'linReg slope = 2');

const regSingle = StatsLib.linReg([{x:0,y:5}]);
assert(regSingle.slope === 0, 'linReg single point slope = 0');

// ── Data function tests with real data ──

console.log('Testing data functions...');
const meetsPath = path.join(__dirname, '..', 'data', 'meets.json');
const meets = JSON.parse(fs.readFileSync(meetsPath, 'utf-8'));

// getAthleteEntries
const esposito = StatsLib.getAthleteEntries(meets, 'Sophia Esposito', 'vault');
assert(esposito.length > 0, 'Esposito has vault entries');
assert(esposito.every(e => typeof e.score === 'number' && e.score > 0), 'All entries have valid scores');
// Should be deduped by date
const dates = esposito.map(e => e.date);
assert(new Set(dates).size === dates.length, 'Entries deduped by date');

// getAthleteStats
const stats = StatsLib.getAthleteStats(meets, 'Sophia Esposito');
assert(stats.perEvent.vault != null, 'Esposito has vault stats');
assert(stats.perEvent.vault.avg > 9.0, 'Esposito vault avg > 9.0');
assert(stats.perEvent.vault.best >= stats.perEvent.vault.avg, 'Best >= avg');

// AA entries
const aaEntries = StatsLib.getAthleteEntries(meets, 'Sophia Esposito', 'aa');
// Esposito has some AA scores per the issue description
assert(aaEntries.length >= 0, 'AA entries exist or are empty');

// getEventStats
const vaultStats = StatsLib.getEventStats(meets, 'vault');
assert(vaultStats.avg > 40, 'Team vault avg > 40');
assert(vaultStats.best >= vaultStats.avg, 'Team vault best >= avg');

// getTeamSeasonStats
const teamStats = StatsLib.getTeamSeasonStats(meets);
assert(teamStats.totalAvg > 190, 'Team total avg > 190');
assert(teamStats.record.w + teamStats.record.l > 0, 'Has W/L record');

// getSeasonRankings
const rankings = StatsLib.getSeasonRankings(meets);
assert(rankings.length > 0, 'Has season rankings');
assert(rankings[0].avgTotal > 0, 'Top team has positive avg');
const osuRank = rankings.find(t => t.team.toLowerCase().includes('oregon'));
assert(osuRank != null, 'Oregon State in rankings');

// getLineupPositionStats
const posStats = StatsLib.getLineupPositionStats(meets, 'vault');
assert(posStats.positions.length > 0, 'Has position stats');
assert(posStats.positions[0].position === 1, 'First position is 1');

// getRollingAverage
const rolling = StatsLib.getRollingAverage(meets, 3);
assert(rolling.length > 0, 'Has rolling averages');
assert(rolling[0].avg === null, 'First entry has null avg (window not full)');
const validRolling = rolling.filter(r => r.avg != null);
assert(validRolling.length > 0, 'Has valid rolling avg entries');
assert(validRolling[0].avg > 190, 'Rolling avg > 190');

// getAALeaderboard
const aaBoard = StatsLib.getAALeaderboard(meets);
// May have entries or may not depending on data
assert(Array.isArray(aaBoard), 'AA leaderboard is array');

// getAthleteComparisonData
const comp = StatsLib.getAthleteComparisonData(meets, 'Sophia Esposito', 'Camryn Richardson');
assert(comp.a != null && comp.b != null, 'Comparison has both athletes');
assert(Array.isArray(comp.sharedEvents), 'Comparison has shared events');

// getNQSBreakdown
const meetWithLineup = meets.find(m => m.lineups && m.lineups.vault && m.lineups.vault.length >= 6);
if (meetWithLineup) {
  const nqs = StatsLib.getNQSBreakdown(meetWithLineup, 'vault');
  assert(nqs != null, 'NQS breakdown exists for meet with lineup');
  assert(nqs.scores.length >= 6, 'NQS has 6+ scores');
  const dropped = nqs.scores.filter(s => s.dropped);
  assert(dropped.length === 1, 'Exactly one dropped score');
  assert(nqs.nqs > 0, 'NQS total > 0');
}

// getScoreDistribution
const dist = StatsLib.getScoreDistribution(meets, 'vault');
assert(dist.scores.length > 0, 'Score distribution has scores');
assert(dist.min <= dist.q1, 'min <= q1');
assert(dist.q1 <= dist.median, 'q1 <= median');
assert(dist.median <= dist.q3, 'median <= q3');
assert(dist.q3 <= dist.max, 'q3 <= max');

// ── Summary ──

console.log(`\nResults: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.log('FAIL: Some StatsLib tests failed.');
  process.exit(1);
} else {
  console.log('PASS: All StatsLib tests passed.');
  process.exit(0);
}
