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
    const meetsInput = meetsData && Array.isArray(meetsData) ? meetsData : [];
    const biosInput = biosData && typeof biosData === 'object' ? biosData : {};
    
    statsCache = computeStats(meetsInput, biosInput);
    
    if (statsCache && statsCache.athletes) {
      const athleteCount = Object.keys(statsCache.athletes).length;
      const competitorCount = statsCache.competitors ? Object.keys(statsCache.competitors).length : 0;
      console.log(`✅ Stats computed successfully: ${athleteCount} athletes, ${competitorCount} competitors`);
    } else {
      console.warn('⚠️  Stats computed but athletes data is empty');
      statsCache = null;
    }
  } catch (err) {
    console.error('❌ Failed to compute stats:', err.message);
    console.error('Stack trace:', err.stack?.split('\n').slice(0, 5).join('\n'));
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

// Fast athlete search endpoint (alias for /api/stats/athletes/:name)
app.get('/api/athlete/:name', (req, res) => {
  if (!statsCache) {
    return res.status(503).json({ error: 'Stats not yet computed' });
  }
  const name = decodeURIComponent(req.params.name);
  const athlete = statsCache.athletes[name];
  if (athlete) {
    // Enhance with analysis context
    const profile = buildAthleteProfiles()[name];
    res.json({
      ...athlete,
      profile: profile
    });
  } else {
    res.status(404).json({ error: `Athlete "${name}" not found` });
  }
});

/**
 * Comprehensive athlete stats endpoint for chatbot analytics
 * Returns compiled athlete profiles with all performance metrics
 */
app.get('/api/athlete-stats', (req, res) => {
  try {
    // Return empty but valid response if stats not yet computed
    if (!statsCache) {
      return res.json({
        athletes: {},
        team: {},
        metadata: {
          status: 'computing',
          message: 'Stats are being computed, please try again shortly'
        }
      });
    }

    const athleteProfiles = buildAthleteProfiles();
    const teamContext = buildTeamContext();
    
    res.json({
      athletes: athleteProfiles,
      team: teamContext,
      metadata: {
        status: 'ready',
        athleteCount: Object.keys(athleteProfiles).length,
        computedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Athlete Stats API] Error:', err.message);
    // Graceful fallback - return empty but valid response
    res.json({
      athletes: {},
      team: {},
      metadata: {
        status: 'error',
        error: err.message
      }
    });
  }
});

/**
 * Athlete comparison endpoint
 * Compare multiple athletes side-by-side
 */
app.get('/api/athlete-stats/compare', (req, res) => {
  try {
    if (!statsCache) {
      return res.status(503).json({ error: 'Stats not yet computed' });
    }

    const names = req.query.names ? req.query.names.split(',').map(n => decodeURIComponent(n.trim())) : [];
    if (names.length === 0) {
      return res.status(400).json({ error: 'Provide at least one athlete name in ?names=name1,name2' });
    }

    const athleteProfiles = buildAthleteProfiles();
    const comparison = {};

    names.forEach(name => {
      if (athleteProfiles[name]) {
        comparison[name] = athleteProfiles[name];
      }
    });

    res.json({
      comparison,
      count: Object.keys(comparison).length,
      metadata: {
        requestedCount: names.length,
        foundCount: Object.keys(comparison).length,
        computedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Athlete Comparison API] Error:', err.message);
    res.status(500).json({ error: 'Failed to compare athletes' });
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

// ── Chatbot Data Preparation ────────────────────────────────────────────────

/**
 * Build comprehensive athlete profiles for chatbot analysis
 * Extracts detailed stats from the computed stats cache
 * Handles null/undefined safely with fallbacks
 */
function buildAthleteProfiles() {
  const profiles = {};
  
  try {
    if (!statsCache || !statsCache.athletes) {
      return profiles;
    }
    
    for (const [name, athleteStats] of Object.entries(statsCache.athletes)) {
      try {
        // Compute overall season metrics from all events
        const allScores = [];
        const eventProfiles = {};
        let strongestEvent = null;
        let strongestScore = 0;
        let consistencyScores = [];

        // Process each event with null safety
        if (athleteStats.events && typeof athleteStats.events === 'object') {
          for (const [event, eventData] of Object.entries(athleteStats.events)) {
            try {
              // Skip if event data is null or invalid
              if (!eventData || !eventData.entries || !Array.isArray(eventData.entries)) {
                continue;
              }

              if (eventData.entries.length === 0) {
                continue;
              }

              const scores = eventData.entries.map(e => e && typeof e.score === 'number' ? e.score : null).filter(s => s !== null);
              if (scores.length === 0) {
                continue;
              }

              scores.forEach(s => allScores.push(s));

              // Calculate consistency (inverse of coefficient of variation)
              const avg = eventData.avg || 0;
              const stdDev = eventData.stdDev || 0;
              const cv = avg > 0 ? Math.abs(stdDev) / avg : 0;
              const consistency = Math.max(0, (1 - Math.min(cv / 0.1, 1)) * 100);
              consistencyScores.push(consistency);

              // Safe number formatting
              const trend = eventData.trendSlope 
                ? (eventData.trendSlope > 0.01 ? 'improving' : eventData.trendSlope < -0.01 ? 'declining' : 'stable')
                : 'stable';

              eventProfiles[event] = {
                average: avg ? parseFloat(Math.max(0, avg).toFixed(3)) : null,
                high: eventData.best ? parseFloat(Math.max(0, eventData.best).toFixed(3)) : null,
                low: eventData.worst ? parseFloat(Math.max(0, eventData.worst).toFixed(3)) : null,
                count: Math.max(0, eventData.appearances || 0),
                consistency: parseFloat(consistency.toFixed(1)),
                trend: trend,
                home_avg: eventData.homeAvg ? parseFloat(Math.max(0, eventData.homeAvg).toFixed(3)) : null,
                away_avg: eventData.awayAvg ? parseFloat(Math.max(0, eventData.awayAvg).toFixed(3)) : null,
                win_avg: eventData.winAvg ? parseFloat(Math.max(0, eventData.winAvg).toFixed(3)) : null,
                loss_avg: eventData.lossAvg ? parseFloat(Math.max(0, eventData.lossAvg).toFixed(3)) : null,
                meet_by_meet: eventData.entries ? eventData.entries.map(e => ({
                  date: e && e.date ? e.date : null,
                  score: e && typeof e.score === 'number' ? parseFloat(e.score.toFixed(3)) : null,
                  opponent: e && e.opponent ? e.opponent : null
                })) : []
              };

              // Track strongest event
              if ((eventData.avg || 0) > strongestScore) {
                strongestScore = eventData.avg || 0;
                strongestEvent = event;
              }
            } catch (eventErr) {
              console.warn(`[buildAthleteProfiles] Skipping event ${event} for ${name}:`, eventErr.message);
              continue;
            }
          }
        }

        // Overall season metrics with null safety
        const seasonAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b) / allScores.length : null;
        const seasonHigh = allScores.length > 0 ? Math.max(...allScores) : null;
        const seasonLow = allScores.length > 0 ? Math.min(...allScores) : null;
        const overallConsistency = consistencyScores.length > 0
          ? consistencyScores.reduce((a, b) => a + b) / consistencyScores.length
          : null;

        profiles[name] = {
          lineup_appearances: Math.max(0, athleteStats.totalAppearances || 0),
          season_average: seasonAvg ? parseFloat(seasonAvg.toFixed(3)) : null,
          season_high: seasonHigh ? parseFloat(seasonHigh.toFixed(3)) : null,
          season_low: seasonLow ? parseFloat(seasonLow.toFixed(3)) : null,
          overall_consistency: overallConsistency ? parseFloat(overallConsistency.toFixed(1)) : null,
          strongest_event: strongestEvent || null,
          bio: athleteStats.bio && typeof athleteStats.bio === 'object' ? athleteStats.bio : {},
          events: eventProfiles,
          team_rank: athleteStats.teamRank || null
        };
      } catch (athleteErr) {
        console.warn(`[buildAthleteProfiles] Skipping athlete ${name}:`, athleteErr.message);
        continue;
      }
    }

    return profiles;
  } catch (err) {
    console.error('[buildAthleteProfiles] Fatal error:', err.message);
    return {};
  }
}

/**
 * Get team statistics summary for chatbot context
 * Returns safe, well-formed data with fallbacks
 */
function buildTeamContext() {
  try {
    if (!statsCache || !statsCache.team) {
      return {
        record: { wins: 0, losses: 0 },
        season_average: null,
        season_high: null,
        home_average: null,
        away_average: null,
        meets_played: 0,
        nqs: null
      };
    }
    
    const team = statsCache.team;
    return {
      record: (team.record && typeof team.record === 'object') 
        ? { wins: team.record.wins || 0, losses: team.record.losses || 0 }
        : { wins: 0, losses: 0 },
      season_average: team.seasonAvg && typeof team.seasonAvg === 'number' 
        ? parseFloat(Math.max(0, team.seasonAvg).toFixed(3)) 
        : null,
      season_high: team.seasonHigh && typeof team.seasonHigh === 'number'
        ? parseFloat(Math.max(0, team.seasonHigh).toFixed(3))
        : null,
      home_average: team.homeAvg && typeof team.homeAvg === 'number'
        ? parseFloat(Math.max(0, team.homeAvg).toFixed(3))
        : null,
      away_average: team.awayAvg && typeof team.awayAvg === 'number'
        ? parseFloat(Math.max(0, team.awayAvg).toFixed(3))
        : null,
      meets_played: Math.max(0, team.meetsPlayed || 0),
      nqs: team.nqs && typeof team.nqs === 'number'
        ? parseFloat(Math.max(0, team.nqs).toFixed(3))
        : null,
    };
  } catch (err) {
    console.error('[buildTeamContext] Error:', err.message);
    return {
      record: { wins: 0, losses: 0 },
      season_average: null,
      season_high: null,
      home_average: null,
      away_average: null,
      meets_played: 0,
      nqs: null
    };
  }
}

// Claude AI Chatbot Endpoint
app.post('/api/chat', async (req, res) => {
  let athleteProfiles = null;
  let teamContext = null;
  let athleteIndex = [];
  let statsAvailable = true;

  try {
    console.log('[Chat API] Received message request');
    
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      console.error('[Chat API] Invalid request: messages not an array');
      return res.status(400).json({ error: 'Messages array required' });
    }

    console.log(`[Chat API] Processing ${messages.length} message(s)`);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[Chat API] ANTHROPIC_API_KEY not set in environment');
      return res.status(500).json({ error: 'AI service not configured' });
    }

    console.log(`[Chat API] API Key found: ${apiKey.substring(0, 10)}...`);

    const client = new Anthropic({ 
      apiKey,
      timeout: 30000, // 30 second timeout for API requests
      maxRetries: 1    // Retry once on transient failures
    });
    console.log('[Chat API] Anthropic client initialized with 30s timeout');

    // Format messages for Claude API
    const claudeMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    // Build rich athlete and team context for Claude (with graceful fallback)
    try {
      athleteProfiles = buildAthleteProfiles();
      teamContext = buildTeamContext();
      athleteIndex = Object.keys(athleteProfiles).sort();
      console.log(`[Chat API] Athlete profiles loaded: ${athleteIndex.length} athletes`);
    } catch (profileErr) {
      console.warn('[Chat API] Failed to build athlete profiles:', profileErr.message);
      athleteProfiles = {};
      teamContext = {};
      athleteIndex = [];
      statsAvailable = false;
    }

    // Build data context string with fallback if stats unavailable
    let dataContext = '';
    
    if (statsAvailable && athleteIndex.length > 0) {
      dataContext = `
## REAL 2026 OSU GYMNASTICS DATA

### Team Overview
${JSON.stringify(teamContext, null, 2)}

### Available Athletes & Their Performance
${athleteIndex.slice(0, 25).map(name => {
  const profile = athleteProfiles[name];
  if (!profile) return '';
  const events = profile.events && typeof profile.events === 'object' 
    ? Object.entries(profile.events).map(([ev, stats]) => 
        `${ev} (avg: ${stats.average || 'N/A'}, count: ${stats.count || 0})`
      ).join(', ')
    : 'N/A';
  
  return `
**${name}**
- Lineup appearances: ${profile.lineup_appearances || 0}
- Season average: ${profile.season_average || 'N/A'}
- Season range: ${profile.season_low || 'N/A'} - ${profile.season_high || 'N/A'}
- Overall consistency: ${profile.overall_consistency !== null ? profile.overall_consistency + '%' : 'N/A'}
- Strongest event: ${profile.strongest_event || 'N/A'}
- Events: ${events}`;
}).filter(Boolean).join('\n')}
${athleteIndex.length > 25 ? `\n[...and ${athleteIndex.length - 25} more athletes]` : ''}

### All Athletes Index
${athleteIndex.join(', ')}
`;
    } else {
      dataContext = `
## GYMNASTICS DATA STATUS

⚠️ Real-time statistics are currently unavailable or being computed.

Your role is to:
1. Engage in gymnastics discussion and analysis
2. Answer questions about gymnastics training, rules, and techniques
3. Provide general guidance when specific OSU data is not available
4. Let users know that live statistics will be available when data loads

When stats do load, they will be included in your context.
`;
    }

    const systemPrompt = `You are an elite gymnastics analytics AI for OSU Gymnastics 2026 season.

# YOUR ROLE

You are a specialized gymnastics analytics engine with deep knowledge of OSU's 2026 season performance data.

${dataContext}

# ANALYTICAL FRAMEWORK

When asked about an athlete or team:
1. Look up their stats in the provided data
2. Provide SPECIFIC numbers (averages, highs, lows, event breakdown)
3. Identify TRENDS and patterns (improving, declining, stable)
4. Compare to team averages and other athletes when relevant
5. Give coaching-level insights about strengths and weaknesses

## Analysis Capabilities:
- **Event Strengths**: Which apparatus are they strongest/weakest on?
- **Consistency**: How reliable are they across competitions?
- **Trends**: Are they improving or declining?
- **Team Impact**: How do they contribute to team performance?
- **Competitive Positioning**: Where do they rank among teammates?
- **Comparative Analysis**: Side-by-side athlete comparisons

## Questions you can answer:
- "How has [athlete] done this season?"
- "Compare [athlete1] vs [athlete2]"
- "Which events is [athlete] strongest in?"
- "What's the team average on [event]?"
- "Who's trending up/down?"
- "Show me consistency metrics"
- "Who's most improved?"
- "Deep dive on [athlete]'s performance"

# CRITICAL RULES

- When you have data, be DATA-DRIVEN and never generic
- Always show specific numbers with 3 decimal places when available
- Use clear formatting: headers, bullet points, tables
- Provide statistical context and comparisons
- Be analytical, insightful, not just conversational
- If stats are unavailable, say so explicitly and offer general gymnastics guidance
- Never make up or hallucinate specific numbers
- Handle missing data gracefully

# FALLBACK BEHAVIOR

If live stats are unavailable:
- Acknowledge this clearly to the user
- Offer to discuss gymnastics topics generally
- Explain that specific athlete/team data will be available when stats load
- Stay helpful and conversational`;

    console.log('[Chat API] Athlete profiles ready. Stats available: ' + statsAvailable);
    console.log(`[Chat API] Context includes ${athleteIndex.length} athletes`);
    console.log('[Chat API] Making request to Claude API...');
    const startTime = Date.now();
    
    const response = await client.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 2048,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const duration = Date.now() - startTime;
    console.log(`[Chat API] Successfully received response from Claude API (took ${duration}ms)`);

    const assistantMessage = response.content[0]?.text || '';

    res.json({
      success: true,
      message: assistantMessage,
      statsAvailable: statsAvailable,
    });
  } catch (error) {
    console.error('[Chat API] Error caught:', {
      name: error.name,
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'), // First 3 lines of stack
    });
    
    // Handle timeout errors
    if (error.name === 'APIConnectionTimeoutError' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      console.error('[Chat API] Request timed out - Claude API may be slow or unreachable');
      return res.status(504).json({ error: 'Request timed out. Please try again.' });
    }
    
    // Handle network/connection errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EAI_AGAIN') {
      console.error('[Chat API] Network error - cannot reach Claude API');
      return res.status(503).json({ error: 'Cannot reach AI service. Please check network connection.' });
    }
    
    // Handle authentication errors
    if (error.status === 401) {
      console.error('[Chat API] Authentication failed - invalid API key');
      return res.status(500).json({ error: 'Invalid API credentials' });
    }
    
    // Handle rate limiting
    if (error.status === 429) {
      console.error('[Chat API] Rate limited');
      return res.status(429).json({ error: 'Rate limited. Please try again later.' });
    }
    
    // Generic error fallback
    console.error('[Chat API] Generic error:', error.message);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// ============================================================================
// SAVED ANALYSES API ENDPOINTS
// ============================================================================

const ANALYSES_FILE = path.join(__dirname, 'data', 'saved-analyses.json');

/**
 * Load saved analyses from JSON file
 */
function loadAnalyses() {
  try {
    if (fs.existsSync(ANALYSES_FILE)) {
      const data = fs.readFileSync(ANALYSES_FILE, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  } catch (err) {
    console.error('[Analyses] Error loading saved-analyses.json:', err.message);
    return [];
  }
}

/**
 * Save analyses to JSON file
 */
function saveAnalyses(analyses) {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(ANALYSES_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(ANALYSES_FILE, JSON.stringify(analyses, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Analyses] Error saving saved-analyses.json:', err.message);
    return false;
  }
}

/**
 * Generate a unique ID for analyses
 */
function generateAnalysisId() {
  return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * POST /api/analyses - Save a new chat analysis
 */
app.post('/api/analyses', (req, res) => {
  try {
    const { title, summary, category, chatHistory } = req.body;

    // Validation
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required and must be a string' });
    }

    if (title.trim().length < 5) {
      return res.status(400).json({ error: 'Title must be at least 5 characters' });
    }

    if (!Array.isArray(chatHistory)) {
      return res.status(400).json({ error: 'Chat history must be an array' });
    }

    // Load existing analyses
    let analyses = loadAnalyses();

    // Create new analysis
    const newAnalysis = {
      id: generateAnalysisId(),
      title: title.trim(),
      summary: (summary || '').trim(),
      category: category || 'other',
      chatHistory: chatHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || new Date().toISOString(),
      })),
      insights: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Add to analyses
    analyses.push(newAnalysis);

    // Save to file
    if (!saveAnalyses(analyses)) {
      return res.status(500).json({ error: 'Failed to save analysis' });
    }

    console.log(`[Analyses] Saved new analysis: ${newAnalysis.id}`);
    res.json({
      success: true,
      analysis: newAnalysis,
    });
  } catch (err) {
    console.error('[Analyses] Error in POST /api/analyses:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analyses - List all saved analyses
 */
app.get('/api/analyses', (req, res) => {
  try {
    const analyses = loadAnalyses();
    // Sort by creation date (newest first)
    analyses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({
      success: true,
      analyses: analyses,
    });
  } catch (err) {
    console.error('[Analyses] Error in GET /api/analyses:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analyses/:id - Get specific analysis with all insights
 */
app.get('/api/analyses/:id', (req, res) => {
  try {
    const { id } = req.params;
    const analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === id);

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json({
      success: true,
      analysis: analysis,
    });
  } catch (err) {
    console.error('[Analyses] Error in GET /api/analyses/:id:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/analyses/:id/insights - Add insight to analysis
 */
app.post('/api/analyses/:id/insights', (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    // Validation
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Insight content is required' });
    }

    if (content.trim().length === 0) {
      return res.status(400).json({ error: 'Insight cannot be empty' });
    }

    // Load analyses
    let analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === id);

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Create insight
    const insight = {
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };

    // Add insight
    if (!analysis.insights) {
      analysis.insights = [];
    }
    analysis.insights.push(insight);
    analysis.updatedAt = new Date().toISOString();

    // Save
    if (!saveAnalyses(analyses)) {
      return res.status(500).json({ error: 'Failed to save insight' });
    }

    console.log(`[Analyses] Added insight to analysis: ${id}`);
    res.json({
      success: true,
      analysis: analysis,
    });
  } catch (err) {
    console.error('[Analyses] Error in POST /api/analyses/:id/insights:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/analyses/:id - Update analysis title/category
 */
app.put('/api/analyses/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, summary, category } = req.body;

    // Load analyses
    let analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === id);

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Update fields if provided
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 5) {
        return res.status(400).json({ error: 'Title must be at least 5 characters' });
      }
      analysis.title = title.trim();
    }

    if (summary !== undefined) {
      analysis.summary = (summary || '').trim();
    }

    if (category !== undefined) {
      analysis.category = category || 'other';
    }

    analysis.updatedAt = new Date().toISOString();

    // Save
    if (!saveAnalyses(analyses)) {
      return res.status(500).json({ error: 'Failed to update analysis' });
    }

    console.log(`[Analyses] Updated analysis: ${id}`);
    res.json({
      success: true,
      analysis: analysis,
    });
  } catch (err) {
    console.error('[Analyses] Error in PUT /api/analyses/:id:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/analyses/:id - Delete saved analysis
 */
app.delete('/api/analyses/:id', (req, res) => {
  try {
    const { id } = req.params;

    // Load analyses
    let analyses = loadAnalyses();
    const index = analyses.findIndex(a => a.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Remove analysis
    const deleted = analyses.splice(index, 1)[0];

    // Save
    if (!saveAnalyses(analyses)) {
      return res.status(500).json({ error: 'Failed to delete analysis' });
    }

    console.log(`[Analyses] Deleted analysis: ${id}`);
    res.json({
      success: true,
      message: 'Analysis deleted successfully',
    });
  } catch (err) {
    console.error('[Analyses] Error in DELETE /api/analyses/:id:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
  
  // Check for required and optional configuration
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY env var is not set');
    console.warn('   Chatbot AI features will not work');
    console.warn('   See CHATBOT_SETUP.md for configuration instructions');
  } else {
    const keyLength = ANTHROPIC_API_KEY.length;
    const keyPreview = ANTHROPIC_API_KEY.substring(0, 10) + '...' + ANTHROPIC_API_KEY.substring(keyLength - 5);
    console.log(`✅ ANTHROPIC_API_KEY loaded: ${keyPreview} (${keyLength} chars)`);
  }
  if (!REFRESH_SECRET) {
    console.warn('⚠️  WARNING: REFRESH_SECRET env var is not set — POST /api/refresh is unprotected');
  }
});
