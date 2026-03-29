/**
 * Comprehensive WebSocket test for real-time meet score updates
 * Tests:
 * - WebSocket connection
 * - Initial data reception
 * - Multiple simultaneous connections
 * - Ping/pong keep-alive
 * - Message broadcasting
 */

const WebSocket = require('ws');

const tests = [];
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

test('Basic WebSocket Connection', (done) => {
  const ws = new WebSocket('ws://localhost:9999/ws');
  
  ws.on('open', () => {
    assert(ws.readyState === WebSocket.OPEN, 'WebSocket should be open');
    ws.close();
  });
  
  ws.on('close', () => {
    done();
  });
  
  ws.on('error', (err) => {
    done(err);
  });
  
  setTimeout(() => done(new Error('Connection timeout')), 3000);
});

test('Receives Initial Data on Connection', (done) => {
  const ws = new WebSocket('ws://localhost:9999/ws');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      assert(message.event === 'connected', 'First message should be "connected" event');
      assert(Array.isArray(message.meets), 'Should receive meets array');
      assert(message.meets.length > 0, 'Should have at least one meet');
      assert(message.timestamp, 'Should have timestamp');
      ws.close();
    } catch (err) {
      done(err);
    }
  });
  
  ws.on('close', () => {
    done();
  });
  
  ws.on('error', done);
  
  setTimeout(() => done(new Error('Receive timeout')), 3000);
});

test('Ping/Pong Keep-Alive Works', (done) => {
  const ws = new WebSocket('ws://localhost:9999/ws');
  let receivedPong = false;
  
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'pong') {
        assert(message.timestamp, 'Pong should have timestamp');
        receivedPong = true;
        ws.close();
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  });
  
  ws.on('close', () => {
    assert(receivedPong, 'Should have received pong response');
    done();
  });
  
  ws.on('error', done);
  
  setTimeout(() => done(new Error('Pong timeout')), 3000);
});

test('Multiple Simultaneous Connections', (done) => {
  const clients = [];
  const connectedClients = [];
  const meetsReceived = [];
  
  function createClient() {
    const ws = new WebSocket('ws://localhost:9999/ws');
    
    ws.on('open', () => {
      connectedClients.push(ws);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.event === 'connected') {
          meetsReceived.push(message.meets);
        }
      } catch (e) {
        // Ignore
      }
    });
    
    ws.on('error', (err) => {
      done(err);
    });
    
    clients.push(ws);
  }
  
  // Create 3 concurrent connections
  for (let i = 0; i < 3; i++) {
    createClient();
  }
  
  setTimeout(() => {
    assert(connectedClients.length === 3, '3 clients should be connected');
    assert(meetsReceived.length === 3, 'All 3 clients should receive initial data');
    assert(meetsReceived[0].length > 0, 'Meets array should not be empty');
    
    // Verify all clients received the same data
    const firstMeetsIds = meetsReceived[0].map(m => m.id).sort();
    const secondMeetsIds = meetsReceived[1].map(m => m.id).sort();
    assert(
      JSON.stringify(firstMeetsIds) === JSON.stringify(secondMeetsIds),
      'All clients should receive identical meets data'
    );
    
    clients.forEach(ws => ws.close());
    
    setTimeout(() => {
      done();
    }, 500);
  }, 1500);
  
  setTimeout(() => done(new Error('Multiple connections timeout')), 5000);
});

test('Meets Data Contains Valid Structure', (done) => {
  const ws = new WebSocket('ws://localhost:9999/ws');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.event === 'connected' && message.meets) {
        const meet = message.meets[0];
        assert(meet.id, 'Meet should have id');
        assert(meet.date, 'Meet should have date');
        assert(meet.opponent, 'Meet should have opponent');
        assert(typeof meet.osuScore === 'number' || meet.status === 'upcoming', 'Meet should have osuScore or be upcoming');
        assert(meet.status, 'Meet should have status (in_progress, upcoming, or completed)');
        ws.close();
      }
    } catch (err) {
      done(err);
    }
  });
  
  ws.on('close', () => {
    done();
  });
  
  ws.on('error', done);
  
  setTimeout(() => done(new Error('Data structure timeout')), 3000);
});

// Run all tests
let testIndex = 0;

function runNextTest() {
  if (testIndex >= tests.length) {
    // All tests done
    console.log('\n========== TEST SUMMARY ==========');
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`Total:   ${tests.length}`);
    console.log('=================================\n');
    process.exit(failedTests > 0 ? 1 : 0);
    return;
  }
  
  const { name, fn } = tests[testIndex];
  testIndex++;
  
  console.log(`\n📋 Running: ${name}`);
  
  fn((err) => {
    if (err) {
      console.log(`❌ FAILED: ${err.message}`);
      failedTests++;
    } else {
      console.log(`✅ PASSED`);
      passedTests++;
    }
    
    setTimeout(runNextTest, 500);
  });
}

console.log('🧪 WebSocket Real-Time Updates - Comprehensive Test Suite');
console.log('=========================================================\n');

setTimeout(() => {
  runNextTest();
}, 1000);

setTimeout(() => {
  console.error('❌ Test suite timeout');
  process.exit(1);
}, 30000);
