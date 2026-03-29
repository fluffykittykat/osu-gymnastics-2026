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
 * Includes stats, trends, and meet-by-meet breakdowns
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
        const meetByMeet = {};

        if (athleteStats.events) {
          for (const [event, eventData] of Object.entries(athleteStats.events)) {
            if (eventData && eventData.entries && eventData.entries.length > 0) {
              const scores = eventData.entries.map(e => e.score);
              scores.forEach(s => allScores.push(s));

              // Calculate consistency (0-100 scale)
              const consistency = eventData.stdDev && eventData.avg > 0 
                ? Math.max(0, 100 - (eventData.stdDev / eventData.avg * 100))
                : 100;

              // Detect trend (improving/declining)
              let trend = 'stable';
              if (eventData.entries.length >= 3) {
                const recent = scores.slice(-3).reduce((a, b) => a + b) / 3;
                const earlier = scores.slice(0, 3).reduce((a, b) => a + b) / 3;
                if (recent > earlier + 0.1) trend = 'improving';
                else if (recent < earlier - 0.1) trend = 'declining';
              }

              eventProfiles[event] = {
                average: eventData.avg ? parseFloat(eventData.avg.toFixed(3)) : 0,
                high: eventData.best ? parseFloat(eventData.best.toFixed(3)) : 0,
                low: eventData.worst ? parseFloat(eventData.worst.toFixed(3)) : 0,
                count: eventData.appearances || 0,
                consistency: parseFloat(consistency.toFixed(1)),
                stdDev: eventData.stdDev ? parseFloat(eventData.stdDev.toFixed(3)) : 0,
                trend,
                recentAvg: scores.length >= 3
                  ? parseFloat((scores.slice(-3).reduce((a, b) => a + b) / 3).toFixed(3))
                  : eventData.avg,
              };

              if ((eventData.avg || 0) > strongestScore) {
                strongestScore = eventData.avg || 0;
                strongestEvent = event;
              }

              // Build meet-by-meet breakdown
              if (Array.isArray(eventData.entries)) {
                eventData.entries.forEach(entry => {
                  const dateKey = entry.date || 'unknown';
                  if (!meetByMeet[dateKey]) {
                    meetByMeet[dateKey] = { date: dateKey, opponent: entry.opponent, scores: {} };
                  }
                  meetByMeet[dateKey].scores[event] = entry.score;
                });
              }
            }
          }
        }

        const seasonAvg = allScores.length ? allScores.reduce((a, b) => a + b) / allScores.length : 0;
        const seasonHigh = allScores.length ? Math.max(...allScores) : 0;
        const seasonLow = allScores.length ? Math.min(...allScores) : 0;

        // Calculate overall trend
        let overallTrend = 'stable';
        if (allScores.length >= 4) {
          const recentScores = allScores.slice(-Math.ceil(allScores.length / 3));
          const earlierScores = allScores.slice(0, Math.ceil(allScores.length / 3));
          const recentAvg = recentScores.reduce((a, b) => a + b) / recentScores.length;
          const earlierAvg = earlierScores.reduce((a, b) => a + b) / earlierScores.length;
          if (recentAvg > earlierAvg + 0.2) overallTrend = 'improving';
          else if (recentAvg < earlierAvg - 0.2) overallTrend = 'declining';
        }

        profiles[name] = {
          lineup_appearances: athleteStats.totalAppearances || 0,
          season_average: parseFloat(seasonAvg.toFixed(3)),
          season_high: parseFloat(seasonHigh.toFixed(3)),
          season_low: parseFloat(seasonLow.toFixed(3)),
          strongest_event: strongestEvent,
          overall_trend: overallTrend,
          events: eventProfiles,
          meet_by_meet: Object.values(meetByMeet).sort((a, b) => a.date.localeCompare(b.date)),
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

// Chatbot-optimized athlete stats endpoint
// Returns compiled profiles with comprehensive analytics
app.get('/api/athlete-stats', (req, res) => {
  try {
    if (!athleteProfilesCache || Object.keys(athleteProfilesCache).length === 0) {
      return res.status(503).json({ 
        error: 'Stats not yet computed',
        athletes: {}
      });
    }
    res.json({ athletes: athleteProfilesCache });
  } catch (err) {
    console.error('[/api/athlete-stats] Error:', err.message);
    // Return empty but valid response on error
    res.status(200).json({ athletes: {} });
  }
});

// Search/lookup athletes by name
app.get('/api/athlete-stats/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const queryLower = query.toLowerCase().trim();
    
    if (!athleteProfilesCache) {
      return res.json({ results: [] });
    }

    // Find athletes matching the query
    const results = Object.entries(athleteProfilesCache)
      .filter(([name]) => name.toLowerCase().includes(queryLower))
      .map(([name, profile]) => ({
        name,
        season_average: profile.season_average,
        lineup_appearances: profile.lineup_appearances,
        strongest_event: profile.strongest_event,
        overall_trend: profile.overall_trend
      }))
      .sort((a, b) => b.season_average - a.season_average);

    res.json({ results, query });
  } catch (err) {
    console.error('[/api/athlete-stats/search] Error:', err.message);
    res.json({ results: [], error: err.message });
  }
});

// Claude AI Chatbot Endpoint — with comprehensive athlete analytics
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

    // Build rich context for chatbot from athlete profiles
    let dataContext = '';
    try {
      if (athleteProfilesCache && Object.keys(athleteProfilesCache).length > 0) {
        const athleteDetails = Object.entries(athleteProfilesCache)
          .map(([name, profile]) => {
            try {
              const events = Object.entries(profile.events || {})
                .filter(([_, e]) => e && e.average > 0)
                .map(([event, data]) => `${event}(${data.average})`)
                .join(', ');
              
              return `**${name}**: ${profile.lineup_appearances} lineups, avg ${profile.season_average || 0}, trend=${profile.overall_trend || 'stable'}, events=[${events}]`;
            } catch (e) {
              return `**${name}**: Limited data available`;
            }
          })
          .join('\n');

        dataContext = `## 2026 OSU GYMNASTICS ATHLETE ANALYTICS DATA

The following athletes have real performance data from this season:

${athleteDetails}

### Usage Guidelines
- Use this data to answer specific questions about athletes
- When asked about [athlete], provide their season average, strongest event, and trend
- Can compare athletes using their specific numbers
- If athlete not found, say so directly
- All numbers are factual from actual meet data`;
      } else {
        dataContext = `## 2026 OSU GYMNASTICS ATHLETE DATA

Stats are loading or not yet available. If asked about specific athletes, indicate that live stats aren't available yet.`;
      }
    } catch (err) {
      console.warn('[Chat] Error building data context:', err.message);
      dataContext = `## 2026 OSU GYMNASTICS ATHLETE DATA

(Stats loading...)`;
    }

    const systemPrompt = `You are an elite gymnastics analytics AI coach for OSU Gymnastics 2026.

You have access to REAL athlete performance data. Your role:
- Provide data-driven analysis with specific numbers
- Answer performance questions about athletes
- Identify trends and patterns in athlete performance
- Compare athletes objectively using their actual stats
- Explain consistency metrics and improvement trends

${dataContext}

### Response Style
- Be specific: use actual numbers, not generalities
- Show data: "Savannah's vault average is 9.45, up from 9.32"
- Compare: "Event X is her strongest at 9.6 avg vs 9.2 on bars"
- Trends: "She's been improving - recent avg 9.51 vs season 9.45"
- Honest: If you don't have data for an athlete, say so

### Conversation Examples
- "How has [athlete] done?" → Full season breakdown with numbers
- "Compare [A] vs [B]" → Side-by-side stats, event-by-event
- "Which events is [athlete] strongest?" → Ranked with averages
- "Who's most improved?" → Names with trend data
- "What about [athlete]'s consistency?" → Stddev + recent form

Make every response data-backed. Never guess stats - use what you have or say you don't have it.`;

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
    
    // Return helpful error message, don't break the app
    res.status(500).json({ 
      error: 'Chat service temporarily unavailable',
      message: 'I apologize, but I\'m having trouble processing your request right now. Please try again.'
    });
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
