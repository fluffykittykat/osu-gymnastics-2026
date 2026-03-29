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
if (errors > 0) {
  console.log('FAIL: Data validation found errors that must be fixed.');
  process.exit(1);
} else if (warnings > 0) {
  console.log('PASS with warnings.');
  process.exit(0);
} else {
  console.log('PASS: All checks passed.');
  process.exit(0);
}
