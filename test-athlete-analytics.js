/**
 * Test suite for Intelligent Athlete Analytics Chatbot
 * Tests all new endpoints and error handling
 */

const http = require('http');

const PORT = process.env.PORT || 9999;
const BASE_URL = `http://localhost:${PORT}`;

// Helper function for HTTP requests
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            raw: data
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            raw: data
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Test runner
async function runTests() {
  const tests = [
    {
      name: 'GET /api/athlete-stats - Returns athlete profiles',
      fn: async () => {
        const res = await makeRequest('GET', '/api/athlete-stats');
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!res.body.athletes) throw new Error('Missing athletes object');
        const athleteCount = Object.keys(res.body.athletes).length;
        if (athleteCount === 0) throw new Error('No athletes returned');
        console.log(`  ✓ Returned ${athleteCount} athletes`);
      }
    },
    {
      name: 'GET /api/athlete-stats - Returns comprehensive athlete data',
      fn: async () => {
        const res = await makeRequest('GET', '/api/athlete-stats');
        const athletes = res.body.athletes;
        const firstAthlete = Object.entries(athletes)[0];
        if (!firstAthlete) throw new Error('No athlete data');
        const [name, profile] = firstAthlete;
        
        // Check required fields
        const required = ['season_average', 'season_high', 'season_low', 'lineup_appearances', 'events', 'meet_by_meet'];
        for (const field of required) {
          if (!(field in profile)) throw new Error(`Missing field: ${field}`);
        }
        
        // Check event data
        if (Object.keys(profile.events).length === 0) {
          console.log(`  ℹ Athlete ${name} has no event data (may be roster-only)`);
        } else {
          const firstEvent = Object.entries(profile.events)[0][1];
          const eventFields = ['average', 'high', 'low', 'consistency', 'stdDev', 'trend', 'recentAvg'];
          for (const field of eventFields) {
            if (!(field in firstEvent)) throw new Error(`Event missing field: ${field}`);
          }
          console.log(`  ✓ Event data includes: average, high, low, consistency, stdDev, trend, recentAvg`);
        }
      }
    },
    {
      name: 'GET /api/athlete-stats/search - Find athlete by name',
      fn: async () => {
        const res = await makeRequest('GET', '/api/athlete-stats/search?q=Savannah');
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!res.body.results) throw new Error('Missing results array');
        if (res.body.results.length === 0) throw new Error('No results for "Savannah"');
        
        const found = res.body.results.find(a => a.name.includes('Savannah'));
        if (!found) throw new Error('Savannah not found in results');
        
        console.log(`  ✓ Found athlete: ${found.name}`);
        console.log(`    - Season avg: ${found.season_average}`);
        console.log(`    - Lineup appearances: ${found.lineup_appearances}`);
        console.log(`    - Strongest event: ${found.strongest_event}`);
      }
    },
    {
      name: 'GET /api/athlete-stats/search - Empty query returns all',
      fn: async () => {
        const res = await makeRequest('GET', '/api/athlete-stats/search?q=');
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!Array.isArray(res.body.results)) throw new Error('Results should be array');
        console.log(`  ✓ Empty search returned ${res.body.results.length} athletes`);
      }
    },
    {
      name: 'GET /api/athlete-stats/search - Case-insensitive',
      fn: async () => {
        const res1 = await makeRequest('GET', '/api/athlete-stats/search?q=savannah');
        const res2 = await makeRequest('GET', '/api/athlete-stats/search?q=SAVANNAH');
        if (res1.body.results.length !== res2.body.results.length) {
          throw new Error('Search is not case-insensitive');
        }
        console.log(`  ✓ Search is case-insensitive`);
      }
    },
    {
      name: 'POST /api/chat - Returns error gracefully when API key missing',
      fn: async () => {
        const res = await makeRequest('POST', '/api/chat', {
          messages: [{ role: 'user', content: 'Hello' }]
        });
        if (res.status !== 500) {
          // Either 500 or 503 is acceptable
          if (res.status !== 503) {
            throw new Error(`Expected error status, got ${res.status}`);
          }
        }
        if (!res.body.error) throw new Error('No error message provided');
        console.log(`  ✓ Returned error: ${res.body.error}`);
      }
    },
    {
      name: 'POST /api/chat - Requires messages array',
      fn: async () => {
        const res = await makeRequest('POST', '/api/chat', {});
        if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
        if (!res.body.error) throw new Error('No error message');
        console.log(`  ✓ Validates input properly`);
      }
    },
    {
      name: 'GET /healthz - Health check endpoint',
      fn: async () => {
        const res = await makeRequest('GET', '/healthz');
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!res.body.status) throw new Error('Missing status');
        console.log(`  ✓ Health check: ${res.body.status}`);
      }
    }
  ];

  console.log('\n🧪 Running Intelligent Athlete Analytics Tests\n');
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`📋 ${test.name}`);
      await test.fn();
      passed++;
      console.log('');
    } catch (err) {
      failed++;
      console.log(`  ❌ FAILED: ${err.message}\n`);
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${tests.length} tests\n`);
  
  if (failed === 0) {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed\n');
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
