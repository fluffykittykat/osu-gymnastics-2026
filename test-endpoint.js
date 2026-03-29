#!/usr/bin/env node
/**
 * Integration test for /api/athlete-stats endpoint
 * Validates the endpoint returns properly formatted data for chatbot integration
 */

const http = require('http');
const assert = require('assert');

const PORT = 9996;
const API_URL = `http://localhost:${PORT}`;

console.log('🧪 Testing /api/athlete-stats endpoint...\n');

// Start server
process.env.PORT = PORT;
const server = require('./server.js');

setTimeout(() => {
  runTests();
}, 2000);

function runTests() {
  console.log('Starting endpoint tests...\n');
  
  testAthleteStats()
    .then(() => {
      console.log('\n✅ All endpoint tests passed!\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Test failed:', err.message);
      process.exit(1);
    });
}

function testAthleteStats() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/api/athlete-stats',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          
          console.log('✓ Response is valid JSON');
          
          // Validate structure
          assert(json.athletes && typeof json.athletes === 'object', 'Missing athletes object');
          console.log(`✓ Found ${Object.keys(json.athletes).length} athletes`);
          
          // Validate a sample athlete
          const [sampleName, sampleAthlete] = Object.entries(json.athletes)[0];
          
          assert(sampleAthlete.lineup_appearances !== undefined, 'Missing lineup_appearances');
          console.log(`✓ Athlete "${sampleName}" has lineup_appearances: ${sampleAthlete.lineup_appearances}`);
          
          assert(sampleAthlete.season_average !== undefined, 'Missing season_average');
          console.log(`✓ Season average available: ${sampleAthlete.season_average}`);
          
          assert(sampleAthlete.overall_consistency !== undefined, 'Missing overall_consistency');
          console.log(`✓ Overall consistency available: ${sampleAthlete.overall_consistency}%`);
          
          assert(sampleAthlete.team_rank !== undefined, 'Missing team_rank');
          console.log(`✓ Team rank available: ${sampleAthlete.team_rank}`);
          
          assert(sampleAthlete.strongest_event !== null, 'Missing strongest_event');
          console.log(`✓ Strongest event: ${sampleAthlete.strongest_event}`);
          
          assert(sampleAthlete.events && typeof sampleAthlete.events === 'object', 'Missing events');
          const eventCount = Object.keys(sampleAthlete.events).length;
          console.log(`✓ Events breakdown: ${eventCount} events`);
          
          // Validate a sample event
          const [eventName, eventStats] = Object.entries(sampleAthlete.events)[0];
          assert(eventStats.average !== undefined, `Missing average for ${eventName}`);
          assert(eventStats.consistency !== undefined, `Missing consistency for ${eventName}`);
          assert(eventStats.trend !== undefined, `Missing trend for ${eventName}`);
          assert(eventStats.meet_by_meet && Array.isArray(eventStats.meet_by_meet), 'Missing meet_by_meet');
          console.log(`✓ Event "${eventName}" has all stats: avg=${eventStats.average}, consistency=${eventStats.consistency}%, trend=${eventStats.trend}`);
          console.log(`  Meet-by-meet data: ${eventStats.meet_by_meet.length} entries`);
          
          // Validate team context
          assert(json.team && typeof json.team === 'object', 'Missing team object');
          assert(json.team.record && json.team.record.wins !== undefined, 'Missing team record');
          console.log(`✓ Team record: ${json.team.record.wins}W - ${json.team.record.losses}L`);
          
          // Validate metadata
          assert(json.metadata && json.metadata.status !== undefined, 'Missing metadata');
          console.log(`✓ Metadata status: ${json.metadata.status}`);
          
          console.log('\n✓ All /api/athlete-stats endpoint validations passed');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
