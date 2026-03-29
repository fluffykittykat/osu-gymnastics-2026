const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const { computeStats } = require('./stats/stats');

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
  } catch (err) {
    console.error('Failed to load meets.json:', err.message);
    meetsData = [];
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

// ── WebSocket Setup ──────────────────────────────────────────────────────────

// Track connected WebSocket clients
const wsClients = new Set();

// Get active meets (meets that are currently in progress)
function getActiveMeets() {
  if (!meetsData || !Array.isArray(meetsData)) return [];
  
  // Consider a meet "active" if it was within the last 24 hours or scheduled for today/tomorrow
  // For demo purposes, we'll consider recent meets as active
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  return meetsData.filter(meet => {
    try {
      const meetDate = new Date(meet.date);
      return meetDate >= oneWeekAgo;
    } catch (e) {
      return false;
    }
  });
}

// Broadcast a message to all connected WebSocket clients
function broadcastToClients(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Periodically check for meet updates and broadcast changes
let lastBroadcastData = null;
setInterval(() => {
  const activeMeets = getActiveMeets();
  const broadcastData = JSON.stringify(activeMeets);
  
  // Only broadcast if data has changed
  if (broadcastData !== lastBroadcastData && wsClients.size > 0) {
    lastBroadcastData = broadcastData;
    broadcastToClients('meetsUpdate', activeMeets);
  }
}, 5000); // Check every 5 seconds

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
    
    // Broadcast score updates to connected WebSocket clients
    const activeMeets = getActiveMeets();
    broadcastToClients('dataRefreshed', {
      meets: activeMeets,
      timestamp: Date.now()
    });

    let summary;
    try {
      summary = JSON.parse(result.trim());
    } catch (e) {
      summary = { raw: result.trim() };
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
      return res.status(400).json({ error: 'Messages array required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return res.status(500).json({ error: 'AI service not configured' });
    }

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

    res.json({
      success: true,
      message: assistantMessage,
    });
  } catch (error) {
    console.error('Chat API error:', error.message);
    if (error.status === 401) {
      return res.status(500).json({ error: 'Invalid API credentials' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Rate limited. Please try again later.' });
    }
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

const PORT = process.env.PORT || 8888;
const REFRESH_SECRET = process.env.REFRESH_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Create HTTP server and attach WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('📡 WebSocket client connected. Total clients:', wsClients.size + 1);
  
  // Add client to set
  wsClients.add(ws);
  
  // Send current active meets to new client
  const activeMeets = getActiveMeets();
  ws.send(JSON.stringify({
    type: 'initialData',
    data: activeMeets,
    timestamp: Date.now()
  }));
  
  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      
      // Handle subscription to specific meets
      if (parsed.type === 'subscribeMeet') {
        // Client is interested in updates for a specific meet
        ws.subscribedMeets = ws.subscribedMeets || new Set();
        ws.subscribedMeets.add(parsed.meetId);
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e.message);
    }
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('📡 WebSocket client disconnected. Total clients:', wsClients.size);
  });
  
  // Handle errors
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`🤸 OSU Gymnastics 2026 running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready at ws://localhost:${PORT}`);
  
  // Check for required and optional configuration
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY env var is not set');
    console.warn('   Chatbot AI features will not work');
    console.warn('   See CHATBOT_SETUP.md for configuration instructions');
  }
  if (!REFRESH_SECRET) {
    console.warn('⚠️  WARNING: REFRESH_SECRET env var is not set — POST /api/refresh is unprotected');
  }
});
