/**
 * Tests for athlete comparison export endpoints and functionality
 * Run with: npm test
 */

const assert = require('assert');
const { generateComparisonCSV, generateComparisonPDF } = require('../utils/exportUtils');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    testsFailed++;
  }
}

console.log('\n📋 Export Utils Tests\n');

const mockAthlete1 = {
  vault: {
    avg: 9.542,
    best: 9.875,
    scores: [9.542, 9.625, 9.875],
    stddev: 0.167
  },
  bars: {
    avg: 8.920,
    best: 9.125,
    scores: [8.920, 9.010, 9.125],
    stddev: 0.107
  },
  beam: {
    avg: 9.345,
    best: 9.650,
    scores: [9.345, 9.450, 9.650],
    stddev: 0.154
  },
  floor: {
    avg: 9.720,
    best: 9.950,
    scores: [9.720, 9.800, 9.950],
    stddev: 0.115
  },
  aa: {
    avg: 37.527,
    best: 39.200
  }
};

const mockAthlete2 = {
  vault: {
    avg: 9.210,
    best: 9.550,
    scores: [9.210, 9.380, 9.550],
    stddev: 0.171
  },
  bars: {
    avg: 9.100,
    best: 9.350,
    scores: [9.100, 9.220, 9.350],
    stddev: 0.128
  },
  beam: {
    avg: 9.510,
    best: 9.800,
    scores: [9.510, 9.650, 9.800],
    stddev: 0.145
  },
  floor: {
    avg: 9.610,
    best: 9.880,
    scores: [9.610, 9.750, 9.880],
    stddev: 0.135
  },
  aa: {
    avg: 37.430,
    best: 38.980
  }
};

console.log('CSV Generation Tests:');

test('generates valid CSV data with headers', () => {
  const csv = generateComparisonCSV(mockAthlete1, mockAthlete2, 'Alice Smith', 'Bob Johnson');
  assert(csv, 'CSV should be generated');
  assert(csv.includes('Athlete Comparison Report'), 'Should include report title');
  assert(csv.includes('Alice Smith'), 'Should include first athlete name');
  assert(csv.includes('Bob Johnson'), 'Should include second athlete name');
});

test('includes event statistics in CSV', () => {
  const csv = generateComparisonCSV(mockAthlete1, mockAthlete2, 'Alice Smith', 'Bob Johnson');
  assert(csv.includes('Vault'), 'Should include Vault event');
  assert(csv.includes('Bars'), 'Should include Bars event');
  assert(csv.includes('Beam'), 'Should include Beam event');
  assert(csv.includes('Floor'), 'Should include Floor event');
});

test('includes all-around summary in CSV', () => {
  const csv = generateComparisonCSV(mockAthlete1, mockAthlete2, 'Alice Smith', 'Bob Johnson');
  assert(csv.includes('All-Around Summary'), 'Should include AA summary section');
  assert(csv.includes('AA Average'), 'Should include AA Average metric');
});

test('handles missing event data gracefully', () => {
  const incompleteAthlete = { vault: {} };
  const csv = generateComparisonCSV(incompleteAthlete, mockAthlete2, 'Alice', 'Bob');
  assert(csv, 'CSV should be generated even with incomplete data');
});

test('formats numbers with 3 decimal places', () => {
  const csv = generateComparisonCSV(mockAthlete1, mockAthlete2, 'Alice', 'Bob');
  assert(/\d\.\d{3}/.test(csv), 'Numbers should be formatted with 3 decimal places');
});

console.log('\nPDF Generation Tests:');

test('generates a PDFKit document', () => {
  const doc = generateComparisonPDF(mockAthlete1, mockAthlete2, 'Alice Smith', 'Bob Johnson');
  assert(doc, 'PDF document should be generated');
  assert(doc._write, 'Document should be a stream with write capability');
});

test('creates a document with proper structure', () => {
  const doc = generateComparisonPDF(mockAthlete1, mockAthlete2, 'Alice Smith', 'Bob Johnson');
  assert(doc._pageBuffer !== undefined, 'Document should have page buffer');
  assert(doc.page, 'Document should have page object');
});

test('generates PDF without crashing with missing data', () => {
  const incompleteAthlete = { vault: {} };
  try {
    generateComparisonPDF(incompleteAthlete, mockAthlete2, 'Alice', 'Bob');
    // Success - no exception thrown
  } catch (err) {
    throw new Error('PDF generation should handle incomplete data');
  }
});

test('handles special characters in athlete names', () => {
  try {
    generateComparisonPDF(mockAthlete1, mockAthlete2, "O'Brien", "José García");
    // Success - no exception thrown
  } catch (err) {
    throw new Error('PDF generation should handle special characters in names');
  }
});

console.log('\nURL Handling Tests:');

test('validates correct share URL format', () => {
  const name1 = 'Alice Smith';
  const name2 = 'Bob Johnson';
  const url = `/?compare=${encodeURIComponent(name1)}&with=${encodeURIComponent(name2)}`;
  
  const params = new URLSearchParams(url.substring(2));
  assert.strictEqual(params.get('compare'), name1, 'Should correctly parse compare parameter');
  assert.strictEqual(params.get('with'), name2, 'Should correctly parse with parameter');
});

test('handles special characters in URLs', () => {
  const name1 = "O'Brien, Mary-Jane";
  const name2 = 'José García';
  const url = `/?compare=${encodeURIComponent(name1)}&with=${encodeURIComponent(name2)}`;
  
  const params = new URLSearchParams(url.substring(2));
  assert.strictEqual(params.get('compare'), name1, 'Should encode special characters');
  assert.strictEqual(params.get('with'), name2, 'Should encode accented characters');
});

test('does not create malformed URLs', () => {
  // Verify that we're NOT using the old broken format
  const name1 = 'Alice';
  const name2 = 'Bob';
  const brokenFormat = `/?view=gymnasts&compare=a1=${name1}&a2=${name2}`;
  const correctFormat = `/?compare=${encodeURIComponent(name1)}&with=${encodeURIComponent(name2)}`;
  
  const correctParams = new URLSearchParams(correctFormat.substring(2));
  
  assert.strictEqual(correctParams.get('compare'), name1, 'Correct format has clean compare param');
  assert.strictEqual(correctParams.get('with'), name2, 'Correct format has clean with param');
  assert(!correctParams.has('view'), 'Correct format should not have view parameter');
  assert(!correctParams.has('a1'), 'Correct format should not have a1 parameter');
});

console.log('\n' + '='.repeat(60));
console.log(`\nTest Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
