// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { computeStats } = require('./stats/stats');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const { execSync } = require('child_process');

// Middleware
app.use(express.json({ limit: '10mb' }));

// Cache-bust version = git commit hash (short)
let ASSET_VERSION = 'dev';
try {
  ASSET_VERSION = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch (e) {}

// Keep meets + bios data in memory for fast serving
let meetsData = null;
let biosData = null;
let statsCache = null;

// WebSocket server and connected clients
let wss = null;
let connectedClients = new Set();
let lastMeetsChecksum = null;

function loadBiosData() {
  try {
    biosData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'bios.json'), 'utf-8'));
  } catch (err) {
    console.error('Failed to load bios.json:', err.message);
    biosData = {};
  }
}

function loadMeetsData() {
  try {
    meetsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'meets.json'), 'utf-8'));
    // Mark meets with "in_progress" or future dates as live
    const today = new Date().toISOString().split('T')[0];
    meetsData = meetsData.map(m => ({
      ...m,
      status: m.status === 'in_progress' ? 'in_progress' : (m.date >= today && !m.result) ? 'upcoming' : 'completed'
    }));
  } catch (err) {
    console.error('Failed to load meets.json:', err.message);
    meetsData = [];
  }
}

// Simple checksum to detect changes in meets data
function getMeetsChecksum() {
  return require('crypto')
    .createHash('sha256')
    .update(JSON.stringify(meetsData))
    .digest('hex');
}

// Broadcast message to all connected WebSocket clients
function broadcastToClients(message) {
  if (!wss) return;
  const data = JSON.stringify(message);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function recomputeStats() {
  try {
    statsCache = computeStats(meetsData || [], biosData || {});
    console.log(`Stats computed: ${Object.keys(statsCache.athletes).length} athletes, ${Object.keys(statsCache.competitors).length} competitors`);
  } catch (err) {
    console.error('Failed to compute stats:', err.message);
    statsCache = null;
  }
}

// Load on startup
loadBiosData();
loadMeetsData();
recomputeStats();

// Serve index.html with injected asset version for automatic cache-busting
app.get('/', async (req, res) => {
  try {
    let html = await fs.promises.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html.replace(/\?v=[^"']*/g, `?v=${ASSET_VERSION}`);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Failed to load page');
  }
});

app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

app.get('/api/bios', (req, res) => {
  if (biosData) {
    res.json(biosData);
  } else {
    res.json({});
  }
});

app.get('/api/photos', async (req, res) => {
  try {
    const raw = await fs.promises.readFile(path.join(__dirname, 'data/photos.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    res.json({});
  }
});

app.get('/api/meet-photos', async (req, res) => {
  try {
    const raw = await fs.promises.readFile(path.join(__dirname, 'data/meet_photos.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    res.json({});
  }
});

app.get('/api/meets', (req, res) => {
  if (meetsData) {
    res.json(meetsData);
  } else {
    res.sendFile(path.join(__dirname, 'data', 'meets.json'));
  }
});

// ── Stats API endpoints ──────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  if (statsCache) {
    res.json(statsCache);
  } else {
    res.status(503).json({ error: 'Stats not yet computed' });
  }
});

app.get('/api/stats/summary', (req, res) => {
  if (statsCache) {
    res.json(statsCache.summary);
  } else {
    res.status(503).json({ error: 'Stats not yet computed' });
  }
});

app.get('/api/stats/team', (req, res) => {
  if (statsCache) {
    res.json(statsCache.team);
  } else {
    res.status(503).json({ error: 'Stats not yet computed' });
  }
});

app.get('/api/stats/athletes', (req, res) => {
  if (statsCache) {
    res.json(statsCache.athletes);
  } else {
    res.status(503).json({ error: 'Stats not yet computed' });
  }
});

app.get('/api/stats/athletes/:name', (req, res) => {
  if (!statsCache) {
    return res.status(503).json({ error: 'Stats not yet computed' });
  }
  const name = decodeURIComponent(req.params.name);
  const athlete = statsCache.athletes[name];
  if (athlete) {
    res.json(athlete);
  } else {
    res.status(404).json({ error: `Athlete "${name}" not found` });
  }
});

app.get('/api/stats/events/:event', (req, res) => {
  if (!statsCache) {
    return res.status(503).json({ error: 'Stats not yet computed' });
  }
  const event = req.params.event;
  const eventData = statsCache.events[event];
  if (eventData) {
    res.json(eventData);
  } else {
    res.status(404).json({ error: `Event "${event}" not found. Valid: vault, bars, beam, floor` });
  }
});

app.get('/api/competitor-scores', (req, res) => {
  const meets = meetsData || [];
  res.json(meets.map(m => ({
    id: m.id,
    date: m.date,
    competitorAthletes: m.competitorAthletes || {},
    competitorLineups: m.competitorLineups || {},
  })));
});

let refreshInProgress = false;

app.post('/api/refresh', async (req, res) => {
  if (REFRESH_SECRET && req.headers['x-refresh-secret'] !== REFRESH_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  if (refreshInProgress) {
    return res.status(429).json({ success: false, error: 'Refresh already in progress' });
  }
  refreshInProgress = true;
  try {
    const result = await new Promise((resolve, reject) => {
      exec('python3 scripts/refresh_data.py', {
        cwd: __dirname,
        timeout: 60000,
        encoding: 'utf-8',
      }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });

    // Reload data into memory and recompute stats
    loadMeetsData();
    loadBiosData();
    recomputeStats();

    let summary;
    try {
      summary = JSON.parse(result.trim());
    } catch (e) {
      summary = { raw: result.trim() };
    }

    // Broadcast score updates to all connected clients
    const newChecksum = getMeetsChecksum();
    if (newChecksum !== lastMeetsChecksum) {
      lastMeetsChecksum = newChecksum;
      broadcastToClients({
        event: 'scoresUpdated',
        meets: meetsData,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, summary });
  } catch (err) {
    console.error('Refresh failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    refreshInProgress = false;
  }
});

app.get('/healthz', (req, res) => {
  const { name, version } = require('./package.json');
  res.json({ status: 'ok', uptime: process.uptime(), version });
});

// Claude AI Chatbot Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      console.error('[Chat API] Invalid request - messages array required');
      return res.status(400).json({ error: 'Messages array required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[Chat API] ANTHROPIC_API_KEY environment variable is not set');
      console.error('[Chat API] Please create .env file with your API key (see .env.example)');
      return res.status(500).json({ 
        error: 'AI service not configured. Please add ANTHROPIC_API_KEY to .env file.' 
      });
    }

    console.log('[Chat API] Processing request with', messages.length, 'messages');
    const client = new Anthropic({ apiKey });

    // Format messages for Claude API
    const claudeMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const systemPrompt = `You are an expert gymnastics analytics assistant for the OSU Gymnastics 2026 stats website.

**Your Role:**
- Provide detailed analysis of gymnastics meet results, team performance, and athlete statistics
- Answer questions about team rankings, individual event performances, and historical trends
- Explain gymnastics scoring systems (NQS, team averages, lineup positioning, etc.)
- Offer insights into athlete strengths, weaknesses, and performance patterns
- Help users understand statistical relationships and competitive positioning

**Analytics Capabilities:**
- When users ask for analysis, provide comprehensive metrics, comparisons, and context
- Break down team performance by event (vault, bars, beam, floor, AA)
- Compare athlete performances across meets and identify trends
- Discuss lineup optimization and scoring implications
- Contextualize individual scores within team and competitive landscapes

**Data Available:**
- Meet results, scores, and dates
- Athlete performance statistics and rankings
- Team seasonal trends and momentum
- Event-specific analytics and breakdowns

**Communication Style:**
- Be conversational and friendly while maintaining analytical depth
- Use clear formatting with headers, bullet points, and numbered lists for complex analysis
- Provide specific numbers and statistics when discussing performance
- Offer context and comparisons to help users understand significance
- Ask clarifying questions if you need more specific information about what they're analyzing

**Important Notes:**
- You can reference meet data, scores, and athlete information available on this website
- Users can share specific data or results for you to analyze
- Always be accurate with numbers and careful with statistical claims
- Focus on gymnastics-specific analysis rather than general sports commentary`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const assistantMessage = response.content[0]?.text || '';

    console.log('[Chat API] Successfully generated response');
    res.json({
      success: true,
      message: assistantMessage,
    });
  } catch (error) {
    console.error('[Chat API] Error:', error.message);
    console.error('[Chat API] Error details:', {
      status: error.status,
      type: error.type,
      name: error.name
    });
    
    if (error.status === 401) {
      console.error('[Chat API] Authentication failed - check if your ANTHROPIC_API_KEY is valid');
      return res.status(500).json({ 
        error: 'Invalid API credentials. Please check your ANTHROPIC_API_KEY in .env file.' 
      });
    }
    if (error.status === 429) {
      console.error('[Chat API] Rate limit exceeded');
      return res.status(429).json({ error: 'Rate limited. Please try again later.' });
    }
    res.status(500).json({ 
      error: 'Failed to process chat message: ' + error.message 
    });
  }
});

const PORT = process.env.PORT || 8888;
const REFRESH_SECRET = process.env.REFRESH_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Create HTTP server and attach WebSocket server
const server = http.createServer(app);
wss = new WebSocket.Server({ server, path: '/ws' });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log(`[WebSocket] Client connected. Total clients: ${connectedClients.size + 1}`);
  connectedClients.add(ws);

  // Send initial data to newly connected client
  ws.send(JSON.stringify({
    event: 'connected',
    meets: meetsData,
    timestamp: new Date().toISOString(),
  }));

  // Handle client disconnect
  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total clients: ${connectedClients.size}`);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error.message);
  });

  // Echo ping/pong for keep-alive
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
});

// Initialize checksum on startup
lastMeetsChecksum = getMeetsChecksum();

// Periodic check for file changes (every 10 seconds)
// This enables auto-refresh when meets.json is updated externally
setInterval(() => {
  try {
    const fileChecksum = require('crypto')
      .createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, 'data', 'meets.json'), 'utf-8'))
      .digest('hex');
    
    if (fileChecksum !== lastMeetsChecksum) {
      console.log('[Live Updates] Detected changes in meets.json, broadcasting to clients...');
      loadMeetsData();
      recomputeStats();
      lastMeetsChecksum = getMeetsChecksum();
      
      broadcastToClients({
        event: 'scoresUpdated',
        meets: meetsData,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Silently ignore file read errors
  }
}, 10000);

server.listen(PORT, () => {
  console.log(`🤸 OSU Gymnastics 2026 running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server available at ws://localhost:${PORT}/ws`);
  console.log('');
  
  // Check for required and optional configuration
  console.log('📋 Configuration Status:');
  if (ANTHROPIC_API_KEY) {
    const keyPreview = ANTHROPIC_API_KEY.substring(0, 12) + '...' + ANTHROPIC_API_KEY.substring(ANTHROPIC_API_KEY.length - 4);
    console.log(`   ✅ ANTHROPIC_API_KEY is loaded (${keyPreview})`);
    console.log('   💬 Chatbot features enabled');
  } else {
    console.warn('   ⚠️  ANTHROPIC_API_KEY is NOT set');
    console.warn('   ❌ Chatbot AI features will not work');
    console.warn('   📝 Action required:');
    console.warn('      1. Copy .env.example to .env: cp .env.example .env');
    console.warn('      2. Edit .env and add your Anthropic API key');
    console.warn('      3. Get API key from: https://console.anthropic.com');
    console.warn('      4. Restart the server: npm start');
  }
  
  if (!REFRESH_SECRET) {
    console.warn('   ⚠️  REFRESH_SECRET is not set — POST /api/refresh is unprotected');
  } else {
    console.log('   ✅ REFRESH_SECRET is set');
  }
  console.log('');
});
