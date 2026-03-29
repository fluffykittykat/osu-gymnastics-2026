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
let athleteProfilesCache = null; // For chatbot context

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
    athleteProfilesCache = buildAthleteProfiles(); // Build chatbot data too
    console.log(`Stats computed: ${Object.keys(statsCache.athletes).length} athletes, ${Object.keys(statsCache.competitors).length} competitors`);
  } catch (err) {
    console.error('Failed to compute stats:', err.message);
    statsCache = null;
    athleteProfilesCache = null;
  }
}

/**
 * Build comprehensive athlete profiles for chatbot analysis
 */
function buildAthleteProfiles() {
  const profiles = {};
  try {
    if (!statsCache || !statsCache.athletes) return profiles;
    
    for (const [name, athleteStats] of Object.entries(statsCache.athletes)) {
      try {
        const allScores = [];
        const eventProfiles = {};
        let strongestEvent = null;
        let strongestScore = 0;

        if (athleteStats.events) {
          for (const [event, eventData] of Object.entries(athleteStats.events)) {
            if (eventData && eventData.entries && eventData.entries.length > 0) {
              const scores = eventData.entries.map(e => e.score);
              scores.forEach(s => allScores.push(s));

              const consistency = eventData.avg > 0 ? Math.max(0, 100 - (eventData.stdDev / eventData.avg * 100)) : 0;

              eventProfiles[event] = {
                average: eventData.avg ? parseFloat(eventData.avg.toFixed(3)) : 0,
                high: eventData.best ? parseFloat(eventData.best.toFixed(3)) : 0,
                low: eventData.worst ? parseFloat(eventData.worst.toFixed(3)) : 0,
                count: eventData.appearances || 0,
                consistency: parseFloat(consistency.toFixed(1)),
              };

              if ((eventData.avg || 0) > strongestScore) {
                strongestScore = eventData.avg || 0;
                strongestEvent = event;
              }
            }
          }
        }

        const seasonAvg = allScores.length ? allScores.reduce((a, b) => a + b) / allScores.length : 0;
        const seasonHigh = allScores.length ? Math.max(...allScores) : 0;
        const seasonLow = allScores.length ? Math.min(...allScores) : 0;

        profiles[name] = {
          lineup_appearances: athleteStats.totalAppearances || 0,
          season_average: parseFloat(seasonAvg.toFixed(3)),
          season_high: parseFloat(seasonHigh.toFixed(3)),
          season_low: parseFloat(seasonLow.toFixed(3)),
          strongest_event: strongestEvent,
          events: eventProfiles,
          bio: athleteStats.bio || {}
        };
      } catch (err) {
        console.warn(`[Profiles] Error processing ${name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Profiles] Error building profiles:', err.message);
  }
  return profiles;
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

// Claude AI Chatbot Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AI service not configured' });
    }

    const client = new Anthropic({ apiKey });

    // Format messages for Claude API
    const claudeMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    // Build rich context for chatbot
    const athleteList = athleteProfilesCache ? Object.keys(athleteProfilesCache) : [];
    const dataContext = athleteProfilesCache && athleteList.length > 0 
      ? `## 2026 OSU GYMNASTICS ATHLETE DATA\n\n${athleteList.map(name => {
          const p = athleteProfilesCache[name];
          return `**${name}**: ${p.lineup_appearances} meets, avg ${p.season_average}, strongest: ${p.strongest_event}`;
        }).join('\n')}`
      : '';

    const systemPrompt = `You are an elite gymnastics analytics AI for OSU Gymnastics 2026.

You have COMPLETE access to real athlete performance data. Provide specific, data-driven analysis.

${dataContext}

When asked about an athlete:
1. Look up their stats in the data above
2. Provide SPECIFIC numbers (averages, highs, lows)
3. Identify trends and patterns
4. Compare to teammates
5. Give coaching-level insights

Answer questions like:
- "How has [athlete] done?" - Full breakdown
- "Compare [athlete1] vs [athlete2]" - Side-by-side
- "Which events is [athlete] strongest?" - Event analysis
- "Who's improving?" - Trend analysis

Be data-driven, analytical, and insightful. Use specific numbers always.`;

    const response = await client.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 2048,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const assistantMessage = response.content[0]?.text || '';

    res.json({
      success: true,
      message: assistantMessage,
    });
  } catch (error) {
    console.error('[Chat API] Error:', error.message);
    
    // Handle timeout/network errors gracefully
    if (error.message?.includes('timeout') || error.code?.includes('TIMEOUT')) {
      return res.status(504).json({ error: 'Request timed out. Please try again.' });
    }
    
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

app.get('/healthz', (req, res) => {
  const { name, version } = require('./package.json');
  res.json({ status: 'ok', uptime: process.uptime(), version });
});

let refreshInProgress = false;

app.post('/api/refresh', async (req, res) => {
  const REFRESH_SECRET = process.env.REFRESH_SECRET;
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

    loadMeetsData();
    loadBiosData();
    recomputeStats();

    let summary;
    try {
      summary = JSON.parse(result.trim());
    } catch (e) {
      summary = { raw: result.trim() };
    }

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

const PORT = process.env.PORT || 8888;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const server = http.createServer(app);
wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log(`[WebSocket] Client connected. Total: ${connectedClients.size + 1}`);
  connectedClients.add(ws);

  ws.send(JSON.stringify({
    event: 'connected',
    meets: meetsData,
    timestamp: new Date().toISOString(),
  }));

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total: ${connectedClients.size}`);
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error.message);
  });
});

lastMeetsChecksum = getMeetsChecksum();

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
      lastMeetsChecksum = fileChecksum;
      
      broadcastToClients({
        event: 'scoresUpdated',
        meets: meetsData,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Silently ignore
  }
}, 10000);

server.listen(PORT, () => {
  console.log(`🤸 OSU Gymnastics 2026 running on http://0.0.0.0:${PORT} (accessible on all interfaces)`);
  console.log(`📡 WebSocket server available at ws://0.0.0.0:${PORT}/ws`);
  
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY env var is not set');
  } else {
    const keyLength = ANTHROPIC_API_KEY.length;
    console.log(`✅ ANTHROPIC_API_KEY loaded: ${ANTHROPIC_API_KEY.substring(0, 10)}...${ANTHROPIC_API_KEY.substring(keyLength - 5)} (${keyLength} chars)`);
  }
  
  if (!process.env.REFRESH_SECRET) {
    console.warn('⚠️  WARNING: REFRESH_SECRET env var is not set — POST /api/refresh is unprotected');
  }
});
