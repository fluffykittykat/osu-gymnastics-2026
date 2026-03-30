/**
 * Test Suite for Saved Analyses API
 * Tests all CRUD endpoints for server-side analysis persistence
 */

const http = require('http');

const API_BASE = 'http://localhost:9999';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Make HTTP request helper
 */
async function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
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
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Test runner
 */
async function runTests() {
  console.log(`\n${colors.blue}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║       SAVED ANALYSES API - COMPREHENSIVE TEST SUITE          ║${colors.reset}`);
  console.log(`${colors.blue}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  let passed = 0;
  let failed = 0;
  let analysisId = null;

  try {
    // Test 1: GET /api/analyses - Empty list
    console.log(`${colors.yellow}[Test 1]${colors.reset} GET /api/analyses - Get empty list initially`);
    const getEmptyRes = await makeRequest('GET', '/api/analyses');
    if (getEmptyRes.status === 200 && getEmptyRes.body.success && Array.isArray(getEmptyRes.body.analyses)) {
      console.log(`${colors.green}✓ PASS${colors.reset} - Empty analyses list returned\n`);
      passed++;
    } else {
      console.log(`${colors.red}✗ FAIL${colors.reset} - Unexpected response\n`);
      failed++;
    }

    // Test 2: POST /api/analyses - Create new analysis
    console.log(`${colors.yellow}[Test 2]${colors.reset} POST /api/analyses - Create new analysis`);
    const postRes = await makeRequest('POST', '/api/analyses', {
      title: 'Savannah Mill Season Analysis',
      summary: 'Comprehensive review of Savannah Mill performance throughout the season',
      category: 'athlete',
      chatHistory: [
        { role: 'user', content: 'How did Savannah perform this season?' },
        { role: 'assistant', content: 'Savannah had an exceptional season with consistent improvements.' },
        { role: 'user', content: 'What are her strongest events?' },
        { role: 'assistant', content: 'She excels on vault and balance beam.' },
      ],
    });

    if (postRes.status === 200 && postRes.body.success && postRes.body.analysis.id) {
      analysisId = postRes.body.analysis.id;
      console.log(`${colors.green}✓ PASS${colors.reset} - Analysis created with ID: ${analysisId}`);
      console.log(`  - Title: ${postRes.body.analysis.title}`);
      console.log(`  - Chat messages: ${postRes.body.analysis.chatHistory.length}`);
      console.log(`  - Insights: ${postRes.body.analysis.insights.length}\n`);
      passed++;
    } else {
      console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to create analysis\n`);
      failed++;
    }

    // Test 3: GET /api/analyses/:id - Get specific analysis
    if (analysisId) {
      console.log(`${colors.yellow}[Test 3]${colors.reset} GET /api/analyses/:id - Get specific analysis`);
      const getRes = await makeRequest('GET', `/api/analyses/${analysisId}`);
      if (getRes.status === 200 && getRes.body.success && getRes.body.analysis.id === analysisId) {
        console.log(`${colors.green}✓ PASS${colors.reset} - Retrieved analysis by ID`);
        console.log(`  - Title: ${getRes.body.analysis.title}`);
        console.log(`  - Category: ${getRes.body.analysis.category}\n`);
        passed++;
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to retrieve analysis\n`);
        failed++;
      }
    }

    // Test 4: POST /api/analyses/:id/insights - Add insight
    if (analysisId) {
      console.log(`${colors.yellow}[Test 4]${colors.reset} POST /api/analyses/:id/insights - Add insight`);
      const insightRes = await makeRequest('POST', `/api/analyses/${analysisId}/insights`, {
        content: 'She is strongest on vault with consistent scores above 9.2',
      });
      if (insightRes.status === 200 && insightRes.body.success && insightRes.body.analysis.insights.length > 0) {
        console.log(`${colors.green}✓ PASS${colors.reset} - Insight added successfully`);
        console.log(`  - Content: "${insightRes.body.analysis.insights[0].content}"`);
        console.log(`  - Total insights: ${insightRes.body.analysis.insights.length}\n`);
        passed++;
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to add insight\n`);
        failed++;
      }
    }

    // Test 5: POST /api/analyses/:id/insights - Add second insight
    if (analysisId) {
      console.log(`${colors.yellow}[Test 5]${colors.reset} POST /api/analyses/:id/insights - Add second insight`);
      const insight2Res = await makeRequest('POST', `/api/analyses/${analysisId}/insights`, {
        content: 'Consistency improved significantly over season - fewer falls in second half',
      });
      if (insight2Res.status === 200 && insight2Res.body.success && insight2Res.body.analysis.insights.length === 2) {
        console.log(`${colors.green}✓ PASS${colors.reset} - Second insight added`);
        console.log(`  - Total insights: ${insight2Res.body.analysis.insights.length}\n`);
        passed++;
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to add second insight\n`);
        failed++;
      }
    }

    // Test 6: PUT /api/analyses/:id - Update analysis
    if (analysisId) {
      console.log(`${colors.yellow}[Test 6]${colors.reset} PUT /api/analyses/:id - Update analysis category`);
      const putRes = await makeRequest('PUT', `/api/analyses/${analysisId}`, {
        category: 'comparison',
        summary: 'Updated: Comparison of Savannah with other top performers',
      });
      if (putRes.status === 200 && putRes.body.success && putRes.body.analysis.category === 'comparison') {
        console.log(`${colors.green}✓ PASS${colors.reset} - Analysis updated successfully`);
        console.log(`  - New category: ${putRes.body.analysis.category}`);
        console.log(`  - Updated at: ${putRes.body.analysis.updatedAt}\n`);
        passed++;
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to update analysis\n`);
        failed++;
      }
    }

    // Test 7: GET /api/analyses - List all analyses
    console.log(`${colors.yellow}[Test 7]${colors.reset} GET /api/analyses - List all analyses (sorted by date)`);
    const listRes = await makeRequest('GET', '/api/analyses');
    if (listRes.status === 200 && listRes.body.success && listRes.body.analyses.length >= 1) {
      console.log(`${colors.green}✓ PASS${colors.reset} - Retrieved all analyses`);
      console.log(`  - Total analyses: ${listRes.body.analyses.length}`);
      console.log(`  - Newest: ${listRes.body.analyses[0].title}\n`);
      passed++;
    } else {
      console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to list analyses\n`);
      failed++;
    }

    // Test 8: DELETE /api/analyses/:id - Delete analysis
    if (analysisId) {
      console.log(`${colors.yellow}[Test 8]${colors.reset} DELETE /api/analyses/:id - Delete analysis`);
      const deleteRes = await makeRequest('DELETE', `/api/analyses/${analysisId}`);
      if (deleteRes.status === 200 && deleteRes.body.success) {
        console.log(`${colors.green}✓ PASS${colors.reset} - Analysis deleted successfully\n`);
        passed++;

        // Verify deletion
        console.log(`${colors.yellow}[Test 9]${colors.reset} GET /api/analyses/:id - Verify analysis is deleted (404)`);
        const verifyRes = await makeRequest('GET', `/api/analyses/${analysisId}`);
        if (verifyRes.status === 404) {
          console.log(`${colors.green}✓ PASS${colors.reset} - Confirmed: Analysis not found after deletion\n`);
          passed++;
        } else {
          console.log(`${colors.red}✗ FAIL${colors.reset} - Analysis still exists after deletion\n`);
          failed++;
        }
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset} - Failed to delete analysis\n`);
        failed++;
      }
    }

    // Test 10: Validation - Invalid title
    console.log(`${colors.yellow}[Test 10]${colors.reset} POST /api/analyses - Validation: Title too short (400)`);
    const badRes = await makeRequest('POST', '/api/analyses', {
      title: 'Bad',
      summary: 'Test',
      category: 'other',
      chatHistory: [],
    });
    if (badRes.status === 400) {
      console.log(`${colors.green}✓ PASS${colors.reset} - Validation working: ${badRes.body.error}\n`);
      passed++;
    } else {
      console.log(`${colors.red}✗ FAIL${colors.reset} - Validation should have failed\n`);
      failed++;
    }
  } catch (error) {
    console.error(`${colors.red}ERROR:${colors.reset}`, error.message);
    failed++;
  }

  // Summary
  console.log(`${colors.blue}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║                        TEST SUMMARY                        ║${colors.reset}`);
  console.log(`${colors.blue}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);
  console.log(`Total: ${passed + failed}\n`);

  if (failed === 0) {
    console.log(`${colors.green}🎉 All tests passed!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}⚠️  Some tests failed${colors.reset}\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
