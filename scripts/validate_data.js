#!/usr/bin/env node

/**
 * Validates meets.json for data integrity.
 * Checks: required fields, score ranges, null scores on completed meets.
 */

const fs = require('fs');
const path = require('path');

const meetsPath = path.join(__dirname, '..', 'data', 'meets.json');

let meets;
try {
  meets = JSON.parse(fs.readFileSync(meetsPath, 'utf-8'));
} catch (err) {
  console.error('ERROR: Cannot read/parse meets.json:', err.message);
  process.exit(1);
}

const REQUIRED_FIELDS = ['id', 'date', 'opponent', 'location'];
const EVENTS = ['vault', 'bars', 'beam', 'floor'];
let errors = 0;
let warnings = 0;

function error(meetId, msg) {
  console.error(`  ERROR [${meetId}]: ${msg}`);
  errors++;
}

function warn(meetId, msg) {
  console.warn(`  WARN  [${meetId}]: ${msg}`);
  warnings++;
}

console.log(`Validating ${meets.length} meets...\n`);

const ids = new Set();

meets.forEach((m, i) => {
  // Required fields
  REQUIRED_FIELDS.forEach(f => {
    if (m[f] == null || m[f] === '') {
      error(m.id || `index:${i}`, `Missing required field: ${f}`);
    }
  });

  // Duplicate IDs
  if (ids.has(m.id)) {
    error(m.id, 'Duplicate meet ID');
  }
  ids.add(m.id);

  // Date format
  if (m.date && !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) {
    error(m.id, `Invalid date format: ${m.date} (expected YYYY-MM-DD)`);
  }

  const isUpcoming = m.status === 'upcoming';
  const isCompleted = m.result === 'W' || m.result === 'L';

  // Completed meets must have scores
  if (isCompleted) {
    if (m.osuScore == null) {
      error(m.id, 'Completed meet (W/L) has null osuScore');
    }
    if (m.opponentScore == null) {
      error(m.id, 'Completed meet (W/L) has null opponentScore');
    }
  }

  // Score range validation (when present)
  if (m.osuScore != null) {
    if (m.osuScore < 140 || m.osuScore > 200) {
      warn(m.id, `osuScore ${m.osuScore} outside expected range [140-200]`);
    }
  }
  if (m.opponentScore != null) {
    if (m.opponentScore < 140 || m.opponentScore > 200) {
      warn(m.id, `opponentScore ${m.opponentScore} outside expected range [140-200]`);
    }
  }

  // Result consistency
  if (isCompleted && m.osuScore != null && m.opponentScore != null) {
    if (m.result === 'W' && m.osuScore < m.opponentScore) {
      warn(m.id, `Result is W but osuScore (${m.osuScore}) < opponentScore (${m.opponentScore})`);
    }
    if (m.result === 'L' && m.osuScore > m.opponentScore) {
      warn(m.id, `Result is L but osuScore (${m.osuScore}) > opponentScore (${m.opponentScore})`);
    }
  }

  // Upcoming meets should have null scores
  if (isUpcoming) {
    if (m.osuScore != null) {
      warn(m.id, 'Upcoming meet has non-null osuScore');
    }
    if (m.result != null) {
      warn(m.id, `Upcoming meet has result: ${m.result}`);
    }
  }

  // Event score ranges
  if (m.events && typeof m.events === 'object') {
    EVENTS.forEach(ev => {
      const evData = m.events[ev];
      if (!evData) return;
      if (evData.osu != null && (evData.osu < 40 || evData.osu > 50)) {
        warn(m.id, `Event ${ev} osu score ${evData.osu} outside expected range [40-50]`);
      }
      if (evData.opponent != null && (evData.opponent < 40 || evData.opponent > 50)) {
        warn(m.id, `Event ${ev} opponent score ${evData.opponent} outside expected range [40-50]`);
      }
    });
  }

  // Athletes validation
  if (m.athletes && Array.isArray(m.athletes)) {
    m.athletes.forEach(a => {
      if (!a.name) {
        error(m.id, 'Athlete missing name');
      }
      if (a.scores) {
        Object.entries(a.scores).forEach(([ev, score]) => {
          const maxScore = ev === 'aa' ? 40.5 : 10.5;
          if (typeof score !== 'number' || score < 0 || score > maxScore) {
            warn(m.id, `Athlete ${a.name}: ${ev} score ${score} outside expected range [0-${maxScore}]`);
          }
        });
      }
    });
  }
});

console.log(`\nResults: ${errors} error(s), ${warnings} warning(s)`);

// ===== Stats.js Module Tests =====
console.log('\n--- Stats.js Module Tests ---\n');

// Mock window and load stats.js
const vm = require('vm');
const statsCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'stats.js'), 'utf-8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(statsCode, sandbox);
const Stats = sandbox.window.Stats;

let statErrors = 0;
function assert(condition, msg) {
  if (!condition) {
    console.error(`  STAT FAIL: ${msg}`);
    statErrors++;
  } else {
    console.log(`  STAT OK: ${msg}`);
  }
}

// Test basic stats functions
assert(Stats.mean([1, 2, 3]) === 2, 'mean([1,2,3]) === 2');
assert(Stats.mean([]) === null, 'mean([]) === null');
assert(Stats.stddev([1]) === 0, 'stddev single item returns 0');
assert(Stats.stddev([1, 3]) > 0, 'stddev([1,3]) > 0');
assert(Stats.pearson([1,2], [1,2]) === null, 'pearson with < 3 items returns null');
assert(Stats.pearson([1,2,3], [1,2,3]) !== null, 'pearson with 3+ items returns value');
const lr = Stats.linReg([{x:0,y:0},{x:1,y:1},{x:2,y:2}]);
assert(Math.abs(lr.slope - 1) < 0.001, 'linReg slope for y=x is 1');

// Test with real meets data
const sopVault = Stats.getAthleteEntries(meets, 'Sophia Esposito', 'vault');
const sopBest = sopVault.length ? Math.max(...sopVault.map(e => e.score)) : null;
assert(sopBest === 9.95, `Sophia Esposito best vault is ${sopBest} (expected 9.95)`);

const aaLB = Stats.getAALeaderboard(meets);
assert(aaLB.length >= 1, `getAALeaderboard returns ${aaLB.length} entries (expected >= 1)`);
assert(aaLB[0].name === 'Sophia Esposito', `AA leader is ${aaLB[0]?.name} (expected Sophia Esposito)`);

const rankings = Stats.getSeasonRankings(meets);
const osuRank = rankings.find(r => r.team === 'Oregon State');
assert(osuRank !== undefined, 'getSeasonRankings includes Oregon State');
assert(rankings.length > 0, `getSeasonRankings returns ${rankings.length} teams`);

const teamStats = Stats.getTeamSeasonStats(meets);
assert(teamStats.record.w > 0 || teamStats.record.l > 0, 'getTeamSeasonStats has W/L record');
assert(teamStats.totalAvg > 190, `Team avg is ${teamStats.totalAvg} (expected > 190)`);

const eventStats = Stats.getEventStats(meets, 'vault');
assert(eventStats.avg > 0, `Vault avg is ${eventStats.avg}`);
assert(eventStats.byMeet.length > 0, `Vault has ${eventStats.byMeet.length} meet entries`);

const lineupStats = Stats.getLineupPositionStats(meets, 'vault');
assert(Object.keys(lineupStats.byPosition).length > 0, 'getLineupPositionStats has positions');

const rolling = Stats.getRollingAverage(meets, 3);
assert(rolling.length > 0, `getRollingAverage(3) returns ${rolling.length} entries`);

const cmpData = Stats.getAthleteComparisonData(meets, 'Sophia Esposito', 'Jade Carey', 'vault');
assert(cmpData.athlete1 && cmpData.athlete1.name === 'Sophia Esposito', 'Comparison athlete1 is correct');

console.log(`\nStats test results: ${statErrors} failure(s)`);
if (statErrors > 0) errors += statErrors;

if (errors > 0) {
  console.log('\nFAIL: Data validation found errors that must be fixed.');
  process.exit(1);
} else if (warnings > 0) {
  console.log('PASS with warnings.');
  process.exit(0);
} else {
  console.log('PASS: All checks passed.');
  process.exit(0);
}
