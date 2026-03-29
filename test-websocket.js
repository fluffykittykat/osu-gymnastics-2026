/**
 * Test WebSocket connection for real-time meet score updates
 */

const WebSocket = require('ws');

console.log('[Test] Testing WebSocket connection...');

const url = 'ws://localhost:9999/ws';
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('[Test] ✅ Connected to WebSocket server');
  
  // Send a ping message
  ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
  console.log('[Test] Sent ping message');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    console.log('[Test] 📨 Received message:', {
      event: message.event,
      timestamp: message.timestamp,
      meetsCount: message.meets?.length,
    });
    
    if (message.event === 'connected') {
      console.log('[Test] ✅ Initial connection data received');
      console.log('[Test] Sample meet:', JSON.stringify(message.meets[0], null, 2).substring(0, 200));
    }
    
    // Close connection after receiving initial data
    setTimeout(() => {
      ws.close();
    }, 1000);
  } catch (e) {
    console.log('[Test] Raw message:', data.substring(0, 100));
  }
});

ws.on('error', (error) => {
  console.error('[Test] ❌ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('[Test] 🔌 Connection closed');
  console.log('[Test] ✅ WebSocket test completed successfully!');
  process.exit(0);
});

// Timeout after 5 seconds
setTimeout(() => {
  console.error('[Test] ❌ Test timeout - no connection response');
  process.exit(1);
}, 5000);
