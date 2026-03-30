/**
 * Test script for Saved Analyses API endpoints
 * Tests all CRUD operations for the saved notes feature
 */

const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:8888';
let analysisId = null;

// Helper function to make HTTP requests
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Test functions
async function testCreateAnalysis() {
  console.log('\n✓ Testing POST /api/analyses');
  
  const response = await makeRequest('POST', '/api/analyses', {
    title: 'Test Analysis: Savannah Mill',
    summary: 'Performance analysis for Savannah Mill during season',
    category: 'Athlete Performance',
    chatHistory: [
      {
        role: 'user',
        content: 'How has Savannah done this season?'
      },
      {
        role: 'assistant',
        content: 'Savannah has performed very well this season with strong consistency.'
      }
    ]
  });

  assert.strictEqual(response.status, 201, `Expected 201, got ${response.status}`);
  assert(response.body.id, 'Response should contain ID');
  assert.strictEqual(response.body.title, 'Test Analysis: Savannah Mill');
  assert.strictEqual(response.body.category, 'Athlete Performance');
  assert(Array.isArray(response.body.insights), 'Response should have insights array');
  
  analysisId = response.body.id;
  console.log(`  ✓ Created analysis: ${analysisId}`);
  console.log(`  ✓ Title: ${response.body.title}`);
  console.log(`  ✓ Created at: ${response.body.createdAt}`);
}

async function testGetAnalyses() {
  console.log('\n✓ Testing GET /api/analyses');
  
  const response = await makeRequest('GET', '/api/analyses');
  
  assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
  assert(Array.isArray(response.body), 'Response should be an array');
  assert(response.body.length > 0, 'Should have at least one analysis');
  
  const analysis = response.body.find(a => a.id === analysisId);
  assert(analysis, `Should find created analysis with ID ${analysisId}`);
  console.log(`  ✓ Found ${response.body.length} analyses`);
  console.log(`  ✓ Created analysis is in list`);
}

async function testGetAnalysisDetail() {
  console.log('\n✓ Testing GET /api/analyses/:id');
  
  const response = await makeRequest('GET', `/api/analyses/${analysisId}`);
  
  assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
  assert.strictEqual(response.body.id, analysisId);
  assert.strictEqual(response.body.title, 'Test Analysis: Savannah Mill');
  assert(Array.isArray(response.body.chatHistory), 'Should have chatHistory');
  assert.strictEqual(response.body.chatHistory.length, 2, 'Should have 2 messages');
  
  console.log(`  ✓ Retrieved analysis: ${response.body.title}`);
  console.log(`  ✓ Chat history: ${response.body.chatHistory.length} messages`);
  console.log(`  ✓ Insights: ${response.body.insights.length}`);
}

async function testAddInsight() {
  console.log('\n✓ Testing POST /api/analyses/:id/insights');
  
  const response = await makeRequest('POST', `/api/analyses/${analysisId}/insights`, {
    content: 'Savannah shows strongest performance on vault with average 9.2'
  });
  
  assert.strictEqual(response.status, 201, `Expected 201, got ${response.status}`);
  assert.strictEqual(response.body.content, 'Savannah shows strongest performance on vault with average 9.2');
  assert(response.body.createdAt, 'Should have createdAt timestamp');
  
  console.log(`  ✓ Added insight: ${response.body.content.substring(0, 50)}...`);
  console.log(`  ✓ Created at: ${response.body.createdAt}`);
}

async function testUpdateAnalysis() {
  console.log('\n✓ Testing PUT /api/analyses/:id');
  
  const response = await makeRequest('PUT', `/api/analyses/${analysisId}`, {
    title: 'Updated: Savannah Mill Full Season Analysis',
    category: 'Athlete Comparison',
    summary: 'Comprehensive performance analysis for Savannah Mill'
  });
  
  assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
  assert.strictEqual(response.body.title, 'Updated: Savannah Mill Full Season Analysis');
  assert.strictEqual(response.body.category, 'Athlete Comparison');
  
  console.log(`  ✓ Updated title: ${response.body.title}`);
  console.log(`  ✓ Updated category: ${response.body.category}`);
  console.log(`  ✓ Updated at: ${response.body.updatedAt}`);
}

async function testVerifyInsightPersistence() {
  console.log('\n✓ Testing insight persistence');
  
  const response = await makeRequest('GET', `/api/analyses/${analysisId}`);
  
  assert.strictEqual(response.status, 200);
  assert(response.body.insights.length > 0, 'Should have insights after adding');
  assert.strictEqual(
    response.body.insights[0].content,
    'Savannah shows strongest performance on vault with average 9.2'
  );
  
  console.log(`  ✓ Insight persisted: ${response.body.insights[0].content.substring(0, 50)}...`);
  console.log(`  ✓ Total insights: ${response.body.insights.length}`);
}

async function testDeleteAnalysis() {
  console.log('\n✓ Testing DELETE /api/analyses/:id');
  
  const response = await makeRequest('DELETE', `/api/analyses/${analysisId}`);
  
  assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
  assert(response.body.success, 'Should indicate success');
  assert.strictEqual(response.body.deleted.id, analysisId);
  
  console.log(`  ✓ Deleted analysis: ${response.body.deleted.title}`);
  
  // Verify it's gone
  const getResponse = await makeRequest('GET', `/api/analyses/${analysisId}`);
  assert.strictEqual(getResponse.status, 404, 'Should return 404 for deleted analysis');
  console.log(`  ✓ Verified deletion: GET returns 404`);
}

async function testErrorHandling() {
  console.log('\n✓ Testing error handling');
  
  // Test missing required field
  const noTitleResponse = await makeRequest('POST', '/api/analyses', {
    title: '',
    chatHistory: []
  });
  assert.strictEqual(noTitleResponse.status, 400, 'Should reject empty title');
  console.log(`  ✓ Rejects empty title: ${noTitleResponse.body.error}`);
  
  // Test non-existent ID
  const notFoundResponse = await makeRequest('GET', '/api/analyses/nonexistent');
  assert.strictEqual(notFoundResponse.status, 404, 'Should return 404 for non-existent ID');
  console.log(`  ✓ Returns 404 for non-existent ID`);
  
  // Test invalid insight content
  const invalidInsightResponse = await makeRequest('POST', '/api/analyses/fake-id/insights', {
    content: 'a'
  });
  assert.strictEqual(invalidInsightResponse.status, 404, 'Should handle missing analysis');
  console.log(`  ✓ Returns 404 when adding insight to non-existent analysis`);
}

// Run all tests
async function runTests() {
  console.log('='.repeat(60));
  console.log('TESTING SAVED ANALYSES API ENDPOINTS');
  console.log('='.repeat(60));
  
  try {
    await testCreateAnalysis();
    await testGetAnalyses();
    await testGetAnalysisDetail();
    await testAddInsight();
    await testVerifyInsightPersistence();
    await testUpdateAnalysis();
    await testErrorHandling();
    await testDeleteAnalysis();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
runTests();
