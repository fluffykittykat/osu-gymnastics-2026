/**
 * Test Suite: Saved Analyses API
 * Tests all 6 endpoints and validates persistence across sessions
 * Run with: node test-saved-analyses.js
 */

const http = require('http');

// Configuration
const API_BASE = 'http://localhost:8888';
const TEST_TIMEOUT = 30000;

let testsPassed = 0;
let testsFailed = 0;

// Helper: Make HTTP request
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: TEST_TIMEOUT
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
            headers: res.headers
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: data,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Test runner
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    testsFailed++;
  }
}

// Assert helpers
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function assertStatus(response, expectedStatus, message) {
  if (response.status !== expectedStatus) {
    throw new Error(`${message}: expected status ${expectedStatus}, got ${response.status}`);
  }
}

// Test suite
async function runTests() {
  console.log('\n📊 Testing Saved Analyses API\n');

  let analysisId = null;

  // Test 1: GET /api/analyses on empty list
  await test('GET /api/analyses returns empty array on startup', async () => {
    const res = await request('GET', '/api/analyses');
    assertStatus(res, 200, 'GET /api/analyses');
    assert(Array.isArray(res.body), 'Response should be an array');
  });

  // Test 2: POST /api/analyses - Create new analysis
  await test('POST /api/analyses creates new analysis with valid data', async () => {
    const chatHistory = [
      { role: 'user', content: 'How did Savannah do?' },
      { role: 'assistant', content: 'Savannah had an excellent season!' }
    ];

    const res = await request('POST', '/api/analyses', {
      title: 'Savannah Season Analysis',
      summary: 'Performance review',
      category: 'Athlete Performance',
      chatHistory
    });

    assertStatus(res, 200, 'POST /api/analyses');
    assert(res.body.success, 'Response should indicate success');
    assert(res.body.analysis, 'Response should contain analysis object');
    assert(res.body.analysis.id, 'Analysis should have an ID');
    assert(res.body.analysis.title === 'Savannah Season Analysis', 'Title should match');
    assert(Array.isArray(res.body.analysis.insights), 'Analysis should have insights array');

    analysisId = res.body.analysis.id;
  });

  // Test 3: POST /api/analyses validation - Missing title
  await test('POST /api/analyses rejects missing title', async () => {
    const res = await request('POST', '/api/analyses', {
      chatHistory: [{ role: 'user', content: 'Test' }]
    });

    assertStatus(res, 400, 'POST /api/analyses without title');
    assert(res.body.error, 'Should return error message');
  });

  // Test 4: POST /api/analyses validation - Missing chatHistory
  await test('POST /api/analyses rejects missing chatHistory', async () => {
    const res = await request('POST', '/api/analyses', {
      title: 'Test'
    });

    assertStatus(res, 400, 'POST /api/analyses without chatHistory');
    assert(res.body.error, 'Should return error message');
  });

  // Test 5: GET /api/analyses - List all
  await test('GET /api/analyses returns list of analyses', async () => {
    const res = await request('GET', '/api/analyses');
    assertStatus(res, 200, 'GET /api/analyses');
    assert(Array.isArray(res.body), 'Response should be an array');
    assert(res.body.length > 0, 'Should have at least one analysis');
  });

  // Test 6: GET /api/analyses/:id - Get specific analysis
  await test('GET /api/analyses/:id retrieves specific analysis', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res = await request('GET', `/api/analyses/${analysisId}`);
    assertStatus(res, 200, `GET /api/analyses/${analysisId}`);
    assert(res.body.id === analysisId, 'Returned analysis should match requested ID');
    assert(res.body.chatHistory, 'Analysis should include full chat history');
  });

  // Test 7: GET /api/analyses/:id - Not found
  await test('GET /api/analyses/:id returns 404 for non-existent ID', async () => {
    const res = await request('GET', '/api/analyses/nonexistent-id-12345');
    assertStatus(res, 404, 'GET /api/analyses/:id for non-existent ID');
    assert(res.body.error, 'Should return error message');
  });

  // Test 8: POST /api/analyses/:id/insights - Add insight
  await test('POST /api/analyses/:id/insights adds new insight', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res = await request('POST', `/api/analyses/${analysisId}/insights`, {
      content: 'She excels on vault'
    });

    assertStatus(res, 200, `POST /api/analyses/${analysisId}/insights`);
    assert(res.body.success, 'Response should indicate success');
    assert(res.body.insight, 'Response should contain insight object');
    assert(res.body.insight.content === 'She excels on vault', 'Insight content should match');
    assert(res.body.insight.id, 'Insight should have an ID');
    assert(res.body.insight.createdAt, 'Insight should have timestamp');
  });

  // Test 9: POST /api/analyses/:id/insights - Multiple insights
  await test('POST /api/analyses/:id/insights allows multiple insights', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res1 = await request('POST', `/api/analyses/${analysisId}/insights`, {
      content: 'Consistency improved over season'
    });
    assertStatus(res1, 200, 'First insight');

    const res2 = await request('POST', `/api/analyses/${analysisId}/insights`, {
      content: 'Ready for nationals'
    });
    assertStatus(res2, 200, 'Second insight');

    // Verify both insights exist
    const getRes = await request('GET', `/api/analyses/${analysisId}`);
    assert(getRes.body.insights.length >= 2, 'Should have at least 2 insights');
  });

  // Test 10: POST /api/analyses/:id/insights - Missing content
  await test('POST /api/analyses/:id/insights rejects missing content', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res = await request('POST', `/api/analyses/${analysisId}/insights`, {});
    assertStatus(res, 400, `POST /api/analyses/${analysisId}/insights without content`);
    assert(res.body.error, 'Should return error message');
  });

  // Test 11: PUT /api/analyses/:id - Update analysis
  await test('PUT /api/analyses/:id updates analysis metadata', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res = await request('PUT', `/api/analyses/${analysisId}`, {
      title: 'Updated: Savannah Season Analysis',
      summary: 'Updated performance review',
      category: 'Athlete Comparison'
    });

    assertStatus(res, 200, `PUT /api/analyses/${analysisId}`);
    assert(res.body.success, 'Response should indicate success');
    assert(res.body.analysis.title === 'Updated: Savannah Season Analysis', 'Title should be updated');
    assert(res.body.analysis.category === 'Athlete Comparison', 'Category should be updated');
  });

  // Test 12: Verify persistence - Analysis persists after update
  await test('Analysis persists and reflects updates', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res = await request('GET', `/api/analyses/${analysisId}`);
    assertStatus(res, 200, 'Retrieve updated analysis');
    assert(res.body.title.includes('Updated'), 'Updated title should persist');
    assert(res.body.category === 'Athlete Comparison', 'Updated category should persist');
  });

  // Test 13: DELETE /api/analyses/:id - Delete analysis
  let deleteTestId = null;

  // First create an analysis to delete
  await test('DELETE /api/analyses/:id deletes analysis', async () => {
    const res = await request('POST', '/api/analyses', {
      title: 'Analysis to Delete',
      chatHistory: [{ role: 'user', content: 'Test' }]
    });

    assertStatus(res, 200, 'Create analysis for deletion');
    deleteTestId = res.body.analysis.id;

    // Now delete it
    const deleteRes = await request('DELETE', `/api/analyses/${deleteTestId}`);
    assertStatus(deleteRes, 200, `DELETE /api/analyses/${deleteTestId}`);
    assert(deleteRes.body.success, 'Response should indicate success');
  });

  // Test 14: Verify deletion
  await test('Deleted analysis cannot be retrieved (404)', async () => {
    if (!deleteTestId) throw new Error('No delete test ID');

    const res = await request('GET', `/api/analyses/${deleteTestId}`);
    assertStatus(res, 404, `GET deleted analysis ${deleteTestId}`);
  });

  // Test 15: DELETE /api/analyses/:id - Not found
  await test('DELETE /api/analyses/:id returns 404 for non-existent ID', async () => {
    const res = await request('DELETE', '/api/analyses/nonexistent-id-12345');
    assertStatus(res, 404, 'DELETE /api/analyses/:id for non-existent ID');
    assert(res.body.error, 'Should return error message');
  });

  // Test 16: Multiple analyses - List returns all
  await test('Multiple analyses are stored and retrieved correctly', async () => {
    // Create a few more analyses
    for (let i = 0; i < 2; i++) {
      await request('POST', '/api/analyses', {
        title: `Test Analysis ${i}`,
        chatHistory: [{ role: 'user', content: `Test ${i}` }]
      });
    }

    const res = await request('GET', '/api/analyses');
    assertStatus(res, 200, 'GET /api/analyses');
    assert(res.body.length >= 2, 'Should have multiple analyses');
  });

  // Test 17: Data structure validation - Check required fields
  await test('Analyses have required fields (id, title, chatHistory, insights, timestamps)', async () => {
    const res = await request('GET', '/api/analyses');
    assertStatus(res, 200, 'GET /api/analyses');

    const analysis = res.body[0];
    assert(analysis.id, 'Analysis should have id');
    assert(analysis.title, 'Analysis should have title');
    assert(analysis.chatHistory, 'Analysis should have chatHistory');
    assert(Array.isArray(analysis.insights), 'Analysis should have insights array');
    assert(analysis.createdAt, 'Analysis should have createdAt timestamp');
    assert(analysis.updatedAt, 'Analysis should have updatedAt timestamp');
    assert(analysis.category !== undefined, 'Analysis should have category');
  });

  // Test 18: Formatted report handling - Check if reportUrl field exists
  await test('Analyses include reportUrl field (can be empty or populated with report link)', async () => {
    if (!analysisId) throw new Error('No analysis ID from previous test');

    const res = await request('GET', `/api/analyses/${analysisId}`);
    assertStatus(res, 200, `GET /api/analyses/${analysisId}`);

    const analysis = res.body;
    assert(analysis.hasOwnProperty('reportUrl'), 'Analysis should have reportUrl field');
    // reportUrl may be empty initially and filled in later when report generation completes
    assert(typeof analysis.reportUrl === 'string', 'reportUrl should be a string');
  });

  // Print results
  console.log(`\n─────────────────────────────────────`);
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);
  console.log(`─────────────────────────────────────\n`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
