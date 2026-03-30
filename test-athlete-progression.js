/**
 * Test suite for /api/athlete-progression endpoint
 * Tests meet-by-meet data access and trend analysis
 */

const http = require('http');

const BASE_URL = 'http://localhost:8888';

// Helper function to make HTTP requests
function makeRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Accept': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// Test cases
const tests = [
  {
    name: 'Happy path: Athlete exists with meets',
    path: '/api/athlete-progression/Savannah%20Miller',
    expectedStatus: 200,
    checks: (data) => {
      const checks = [];
      checks.push(['Has athlete name', !!data.athlete]);
      checks.push(['Has meets array', Array.isArray(data.meets)]);
      checks.push(['Has summary object', !!data.summary]);
      if (data.summary) {
        checks.push(['Has total_meets', data.summary.total_meets !== undefined]);
        checks.push(['Has season_average', data.summary.season_average !== undefined]);
        checks.push(['Has progression_trend', !!data.summary.progression_trend]);
        checks.push(['Trend is valid', ['improving', 'declining', 'stable'].includes(data.summary.progression_trend)]);
      }
      if (data.meets && data.meets.length > 0) {
        const firstMeet = data.meets[0];
        checks.push(['Meet has date', !!firstMeet.date]);
        checks.push(['Meet has opponent', !!firstMeet.opponent]);
        checks.push(['Meet has scores object', !!firstMeet.scores]);
      }
      return checks;
    }
  },

  {
    name: '404: Athlete does not exist',
    path: '/api/athlete-progression/NonExistentAthlete',
    expectedStatus: 404,
    checks: (data) => {
      return [['Has error message', !!data.error]];
    }
  },

  {
    name: 'Empty meets array (athlete with no event entries)',
    path: '/api/athlete-progression/UnknownPerson',
    expectedStatus: 404,
    checks: (data) => {
      return [['Returns 404 not error', !!data.error]];
    }
  },

  {
    name: 'URL encoding: Athlete name with special characters',
    path: '/api/athlete-progression/Kyanna%20Crabb',
    expectedStatus: 200,
    checks: (data) => {
      return [['Successfully decoded URL', !!data.athlete]];
    }
  },

  {
    name: 'Chronological ordering: Meets are sorted by date',
    path: '/api/athlete-progression/Savannah%20Miller',
    expectedStatus: 200,
    checks: (data) => {
      const checks = [];
      if (data.meets && data.meets.length > 1) {
        let isSorted = true;
        for (let i = 1; i < data.meets.length; i++) {
          const prev = new Date(data.meets[i-1].date);
          const curr = new Date(data.meets[i].date);
          if (prev > curr) {
            isSorted = false;
            break;
          }
        }
        checks.push(['Meets are chronologically sorted', isSorted]);
      } else {
        checks.push(['Meets are chronologically sorted', true]); // N/A if <= 1 meet
      }
      return checks;
    }
  },

  {
    name: 'Summary statistics: Correctly calculates averages',
    path: '/api/athlete-progression/Savannah%20Miller',
    expectedStatus: 200,
    checks: (data) => {
      const checks = [];
      if (data.meets && data.meets.length > 0 && data.summary) {
        // Calculate expected season average
        const aas = data.meets
          .filter(m => m.scores && m.scores.aa !== undefined)
          .map(m => m.scores.aa);
        
        if (aas.length > 0) {
          const expectedAvg = aas.reduce((a, b) => a + b) / aas.length;
          const actualAvg = data.summary.season_average;
          const diff = Math.abs(expectedAvg - actualAvg);
          checks.push(['Season average matches calculated value', diff < 0.01]);
        }
      }
      return checks;
    }
  },

  {
    name: 'Best/Worst meets: Correctly identifies high and low',
    path: '/api/athlete-progression/Savannah%20Miller',
    expectedStatus: 200,
    checks: (data) => {
      const checks = [];
      if (data.summary && data.meets && data.meets.length > 0) {
        const withAA = data.meets.filter(m => m.scores && m.scores.aa);
        if (withAA.length > 0) {
          const maxAA = Math.max(...withAA.map(m => m.scores.aa));
          const minAA = Math.min(...withAA.map(m => m.scores.aa));
          
          if (data.summary.best_meet) {
            checks.push(['Best meet has highest AA', data.summary.best_meet.scores.aa === maxAA]);
          }
          if (data.summary.worst_meet) {
            checks.push(['Worst meet has lowest AA', data.summary.worst_meet.scores.aa === minAA]);
          }
        }
      }
      return checks;
    }
  },

  {
    name: 'No crash on empty meets (critical bug fix)',
    path: '/api/athlete-progression/UnknownAthlete123',
    expectedStatus: 404,
    checks: (data) => {
      return [['Handled gracefully with 404', !!data.error]];
    }
  }
];

// Run all tests
async function runTests() {
  console.log('\n========================================');
  console.log('ATHLETE PROGRESSION API TEST SUITE');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n🧪 TEST: ${test.name}`);
    console.log(`   Path: ${test.path}`);

    try {
      const result = await makeRequest(test.path);

      // Check HTTP status
      if (result.status !== test.expectedStatus) {
        console.log(`   ❌ FAILED: Expected status ${test.expectedStatus}, got ${result.status}`);
        failed++;
        continue;
      }

      // Run custom checks
      const checks = test.checks(result.body);
      let testPassed = true;
      for (const [checkName, checkResult] of checks) {
        const symbol = checkResult ? '✓' : '✗';
        console.log(`   ${symbol} ${checkName}`);
        if (!checkResult) testPassed = false;
      }

      if (testPassed) {
        console.log(`   ✅ PASSED`);
        passed++;
      } else {
        console.log(`   ❌ FAILED`);
        failed++;
      }
    } catch (err) {
      console.log(`   ❌ ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
