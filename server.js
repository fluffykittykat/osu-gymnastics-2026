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
let competitorData = {}; // { alabama: {...}, utah: {...}, denver: {...} }

// WebSocket server and connected clients
let wss = null;
let connectedClients = new Set();
let lastMeetsChecksum = null;

// Gymnastics events list (used for athlete progression analysis)
const GYMNASTICS_EVENTS = ['vault', 'bars', 'beam', 'floor'];

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

function loadCompetitorData() {
  const compDir = path.join(__dirname, 'data', 'competitors');
  try {
    const indexFile = path.join(compDir, 'index.json');
    if (!fs.existsSync(indexFile)) {
      console.log('No competitor data found. Run: node scripts/build_competitor_data.js');
      return;
    }
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    for (const team of index.teams) {
      const teamFile = path.join(compDir, `${team.key}.json`);
      if (fs.existsSync(teamFile)) {
        competitorData[team.key] = JSON.parse(fs.readFileSync(teamFile, 'utf-8'));
        console.log(`Loaded competitor data: ${team.name} (${Object.keys(competitorData[team.key].athletes).length} athletes, ${competitorData[team.key].meets.length} meets)`);
      }
    }
  } catch (err) {
    console.error('Failed to load competitor data:', err.message);
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
loadCompetitorData();

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

// Serve notes.html with injected asset version for automatic cache-busting
app.get('/notes.html', async (req, res) => {
  try {
    let html = await fs.promises.readFile(path.join(__dirname, 'public', 'notes.html'), 'utf8');
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

// GET /api/competitors — list all competitor teams with summary stats
app.get('/api/competitors', (req, res) => {
  const teams = Object.entries(competitorData).map(([key, data]) => ({
    key,
    ...data.team,
    teamStats: data.teamStats,
    athleteCount: Object.keys(data.athletes).length,
    meetsPlayed: data.meets.length,
  }));
  res.json(teams);
});

// GET /api/competitors/:team — full team data with athletes, meets, indexes
app.get('/api/competitors/:team', (req, res) => {
  const teamKey = req.params.team.toLowerCase();
  const data = competitorData[teamKey];
  if (!data) {
    const available = Object.keys(competitorData).join(', ') || 'none';
    return res.status(404).json({ error: `Team "${req.params.team}" not found. Available: ${available}` });
  }
  res.json(data);
});

// GET /api/competitors/:team/athletes/:name — individual athlete data
app.get('/api/competitors/:team/athletes/:name', (req, res) => {
  const teamKey = req.params.team.toLowerCase();
  const data = competitorData[teamKey];
  if (!data) return res.status(404).json({ error: 'Team not found' });

  const name = decodeURIComponent(req.params.name).toLowerCase();
  const match = Object.entries(data.athletes).find(([n]) => n.toLowerCase().includes(name));
  if (!match) return res.status(404).json({ error: `Athlete "${req.params.name}" not found on ${data.team.name}` });

  res.json({ name: match[0], ...match[1] });
});

// GET /api/competitors/:team/event-rankings/:event — ranked athletes for an event
app.get('/api/competitors/:team/event-rankings/:event', (req, res) => {
  const teamKey = req.params.team.toLowerCase();
  const data = competitorData[teamKey];
  if (!data) return res.status(404).json({ error: 'Team not found' });

  const event = req.params.event.toLowerCase();
  const rankings = data.eventRankings[event];
  if (!rankings) return res.status(404).json({ error: `Event "${event}" not found. Valid: vault, bars, beam, floor` });

  res.json({ team: data.team.name, event, rankings });
});

/**
 * Get athlete progression through the season (meet-by-meet data)
 * GET /api/athlete-progression/:name
 */
app.get('/api/athlete-progression/:name', (req, res) => {
  if (!statsCache) {
    return res.status(503).json({ 
      error: 'Statistics not yet computed. Please wait and try again.' 
    });
  }

  const athleteName = decodeURIComponent(req.params.name);
  const athlete = statsCache.athletes[athleteName];

  if (!athlete) {
    return res.status(404).json({ 
      error: `Athlete "${athleteName}" not found in database` 
    });
  }

  // Collect meet-by-meet data for this athlete
  const meetsByDate = {};
  const meetDatesSet = new Set();
  const events = GYMNASTICS_EVENTS;

  // Iterate through all meets and find entries for this athlete
  if (meetsData && Array.isArray(meetsData)) {
    meetsData.forEach(meet => {
      if (!meet.date || !meet.athletes) return;

      // Find this athlete in the meet's athlete list
      const athleteEntry = meet.athletes.find(a => 
        (a.name || '').toLowerCase() === athleteName.toLowerCase()
      );

      if (athleteEntry) {
        meetDatesSet.add(meet.date);

        if (!meetsByDate[meet.date]) {
          meetsByDate[meet.date] = {
            date: meet.date,
            opponent: meet.opponent || 'Unknown',
            scores: {}
          };
        }

        // Extract event scores for this athlete
        if (athleteEntry.scores) {
          Object.entries(athleteEntry.scores).forEach(([event, score]) => {
            if (events.includes(event)) {
              meetsByDate[meet.date].scores[event] = score;
            }
          });
        }

        // Calculate All-Around (AA) based on events actually competed
        // In gymnastics, AA is the sum of whatever events the athlete competed in
        const competedEvents = events.filter(ev => meetsByDate[meet.date].scores[ev] !== undefined);
        if (competedEvents.length > 0) {
          const aa = competedEvents.reduce((sum, ev) => sum + meetsByDate[meet.date].scores[ev], 0);
          meetsByDate[meet.date].scores.aa = parseFloat(aa.toFixed(3));
          meetsByDate[meet.date].competed_events = competedEvents;
        }
      }
    });
  }

  // Sort meets chronologically
  const meetDates = Array.from(meetDatesSet).sort((a, b) => {
    return new Date(a) - new Date(b);
  });

  const meets = meetDates.map(date => meetsByDate[date]);

  // Calculate summary statistics
  const allAAs = meets
    .filter(m => m.scores.aa !== undefined)
    .map(m => m.scores.aa);

  const seasonAvg = allAAs.length ? (allAAs.reduce((a, b) => a + b) / allAAs.length) : null;
  
  // Split season into first half and second half for trend analysis
  const midpoint = Math.ceil(meets.length / 2);
  const firstHalf = meets.slice(0, midpoint);
  const secondHalf = meets.slice(midpoint);

  const firstHalfAAs = firstHalf
    .filter(m => m.scores.aa !== undefined)
    .map(m => m.scores.aa);
  const secondHalfAAs = secondHalf
    .filter(m => m.scores.aa !== undefined)
    .map(m => m.scores.aa);

  const firstHalfAvg = firstHalfAAs.length ? (firstHalfAAs.reduce((a, b) => a + b) / firstHalfAAs.length) : null;
  const secondHalfAvg = secondHalfAAs.length ? (secondHalfAAs.reduce((a, b) => a + b) / secondHalfAAs.length) : null;

  // Determine progression trend
  let progressionTrend = 'stable';
  if (firstHalfAvg && secondHalfAvg) {
    const diff = secondHalfAvg - firstHalfAvg;
    if (diff > 0.2) {
      progressionTrend = 'improving';
    } else if (diff < -0.2) {
      progressionTrend = 'declining';
    }
  }

  // Find best and worst meets - CRITICAL FIX: handle empty meets array
  let bestMeet = null;
  let worstMeet = null;

  if (meets.length > 0) {
    bestMeet = meets.reduce((max, m) => 
      ((m.scores.aa || 0) > (max.scores.aa || 0) ? m : max)
    );
    worstMeet = meets.reduce((min, m) => 
      ((m.scores.aa || 0) < (min.scores.aa || 0) ? m : min)
    );
  }

  res.json({
    athlete: athleteName,
    meets: meets,
    summary: {
      total_meets: meets.length,
      season_average: seasonAvg ? parseFloat(seasonAvg.toFixed(3)) : null,
      progression_trend: progressionTrend,
      first_half_average: firstHalfAvg ? parseFloat(firstHalfAvg.toFixed(3)) : null,
      second_half_average: secondHalfAvg ? parseFloat(secondHalfAvg.toFixed(3)) : null,
      best_meet: bestMeet,
      worst_meet: worstMeet
    }
  });
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

// ── Saved Analyses API ──────────────────────────────────────────────────────

function loadAnalyses() {
  const filePath = path.join(__dirname, 'data', 'saved-analyses.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAnalyses(analyses) {
  const filePath = path.join(__dirname, 'data', 'saved-analyses.json');
  fs.writeFileSync(filePath, JSON.stringify(analyses, null, 2));
}

function writeReportPage(analysisId, title, category, createdAt, reportBody) {
  // Strip markdown code fences if AI wrapped the output
  reportBody = reportBody.replace(/^```html?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  // Strip any remaining inline style attributes
  reportBody = reportBody.replace(/\s*style="[^"]*"/g, '');
  const safeTitle = (title || 'Report').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
  const dateStr = new Date(createdAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} - OSU Gymnastics Analysis</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--orange:#FF6B35;--orange-dark:#D73F09;--orange-light:#FF8C5A;--black:#1a1612;--dark:#100e0b;--card:#2a241e;--card-hover:#332d26;--text:#F5EFEA;--text-muted:#A08B78;--border:#3d3228}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--dark);color:var(--text);min-height:100vh;line-height:1.7}
.banner{background:linear-gradient(135deg,var(--orange-dark) 0%,#a03000 100%);position:relative;overflow:hidden}
.banner::after{content:'';position:absolute;inset:0;background:url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" x="50" font-size="80" text-anchor="middle" dominant-baseline="central" opacity="0.06">🤸</text></svg>') repeat;background-size:120px;pointer-events:none}
.bi{max-width:1000px;margin:0 auto;padding:40px 40px 35px;position:relative;z-index:1}
.bnav{display:flex;align-items:center;gap:12px;margin-bottom:24px;font-size:14px}
.bnav a{color:rgba(255,255,255,.7);text-decoration:none}.bnav a:hover{color:var(--orange-light)}
.bnav .s{color:rgba(255,255,255,.3)}
.bbrand{font-family:'Oswald',sans-serif;font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--orange-light);margin-bottom:12px}
.banner h1{font-family:'Oswald',sans-serif;font-size:36px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:12px}
.bmeta{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;color:rgba(255,255,255,.8)}.bmeta span{display:flex;align-items:center;gap:6px}
.cbadge{background:rgba(255,107,53,.2);color:var(--orange-light);padding:3px 12px;border-radius:12px;font-size:12px;font-weight:600;border:1px solid rgba(255,107,53,.3)}
.main{max-width:1000px;margin:0 auto;padding:40px}
.content{background:var(--card);border-radius:16px;padding:40px 48px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.3)}
.content h1{font-family:'Oswald',sans-serif;font-size:28px;color:var(--orange);margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid rgba(255,107,53,.2)}.content h1:first-child{margin-top:0}
.content h2{font-family:'Oswald',sans-serif;font-size:22px;color:var(--orange);margin:28px 0 14px;padding-bottom:6px;border-bottom:1px solid rgba(255,107,53,.15)}
.content h3{font-size:18px;color:var(--text);font-weight:600;margin:24px 0 10px}
.content h4{font-size:15px;color:var(--text-muted);font-weight:600;margin:20px 0 8px}
.content p{margin:10px 0;color:var(--text)}.content strong{color:var(--orange);font-weight:600}.content em{color:var(--text-muted)}
.content ul,.content ol{padding-left:24px;margin:10px 0}.content li{margin:6px 0;color:var(--text)}.content li strong{color:var(--orange)}
.content table{width:100%;border-collapse:separate;border-spacing:0;margin:20px 0;border-radius:10px;overflow:hidden;border:1px solid var(--border)}
.content th{background:linear-gradient(135deg,var(--orange-dark),#a03000);color:#fff;padding:12px 16px;text-align:left;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
.content td{padding:11px 16px;border-bottom:1px solid var(--border);font-size:14px;color:var(--text)}
.content tr:nth-child(even) td{background:rgba(255,255,255,.02)}.content tr:hover td{background:rgba(255,107,53,.06)}.content tr:last-child td{border-bottom:none}
.content a{color:var(--orange);text-decoration:none}.content code{background:rgba(255,107,53,.1);padding:2px 6px;border-radius:4px;font-size:13px;color:var(--orange-light)}
.isec{max-width:1000px;margin:0 auto;padding:0 40px 40px}
.ibox{background:var(--card);border-radius:16px;padding:32px 40px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.3)}
.ibox h2{font-family:'Oswald',sans-serif;font-size:22px;color:var(--orange);margin:0 0 20px;padding-bottom:8px;border-bottom:1px solid rgba(255,107,53,.15)}
.ii{background:rgba(255,255,255,.03);border-radius:10px;padding:16px 20px;margin-bottom:12px;border-left:3px solid var(--orange-dark)}
.it{color:var(--text);font-size:14px;line-height:1.6}.id{color:var(--text-muted);font-size:12px;margin-top:6px}
.ie{color:var(--text-muted);font-style:italic;padding:12px 0}
.iform{display:flex;gap:12px;margin-top:20px}
.iinp{flex:1;background:var(--black);border:1px solid var(--border);border-radius:10px;padding:12px 16px;color:var(--text);font-family:'Inter',sans-serif;font-size:14px;resize:vertical;min-height:48px}
.iinp:focus{outline:none;border-color:var(--orange)}.iinp::placeholder{color:var(--text-muted)}
.ibtn{background:linear-gradient(135deg,var(--orange-dark),#a03000);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-family:'Inter',sans-serif;font-weight:600;font-size:14px;cursor:pointer;transition:all .2s;white-space:nowrap}
.ibtn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(215,63,9,.4)}.ibtn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.foot{max-width:1000px;margin:0 auto;padding:20px 40px 40px;text-align:center;color:var(--text-muted);font-size:13px}.foot a{color:var(--orange);text-decoration:none}.foot a:hover{color:var(--orange-light)}
@media print{body{background:#fff;color:#000}.banner{background:var(--orange-dark)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.content{border:1px solid #ddd;box-shadow:none;background:#fff}.content h1,.content h2,.content strong{color:var(--orange-dark)}.content th{background:var(--orange-dark)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.bnav,.isec{display:none}}
@media(max-width:768px){.bi{padding:24px 16px}.banner h1{font-size:26px}.bmeta{gap:10px;font-size:12px}.bnav{font-size:12px;gap:8px;flex-wrap:wrap}.main,.isec{padding-left:16px;padding-right:16px}.content,.ibox{padding:24px 16px}.iform{flex-direction:column}.content table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}}
@media(max-width:480px){.banner h1{font-size:22px}.bbrand{font-size:11px}.bmeta{flex-direction:column;gap:6px}.cbadge{align-self:flex-start}}
</style>
</head>
<body>
<header class="banner"><div class="bi">
<nav class="bnav"><a href="/">🦫 OSU Gymnastics</a><span class="s">/</span><a href="/notes.html">Saved Notes</a><span class="s">/</span><span style="color:rgba(255,255,255,.5)">Report</span></nav>
<div class="bbrand">OSU Beavers Gymnastics 2026 — Analysis Report</div>
<h1>${safeTitle}</h1>
<div class="bmeta"><span>📅 ${dateStr}</span><span class="cbadge">${category}</span><span>🤖 AI-Generated Analysis</span></div>
</div></header>
<main class="main"><div class="content">${reportBody}</div></main>
<section class="isec"><div class="ibox">
<h2>📌 Insights &amp; Notes</h2>
<div id="insightsList"><p class="ie">Loading...</p></div>
<div class="iform"><textarea id="insightInput" class="iinp" placeholder="Add a new insight or observation..." rows="2"></textarea><button id="addInsightBtn" class="ibtn">Add Insight</button></div>
</div></section>
<footer class="foot"><p>Generated by OSU Gymnastics AI Assistant · <a href="/notes.html">Back to Notes</a> · <a href="/">Dashboard</a></p></footer>
<link rel="stylesheet" href="/css/chatbot.css">
<script src="/js/chatbot.js"></script>
<script>
(function(){
var AID='${analysisId}',RT='${safeTitle.replace(/'/g,"\\'")}';
document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){
if(!window.chatbot)return;var bot=window.chatbot;
var re=document.querySelector('.content');var rt=re?re.innerText.substring(0,8000):'';
bot.contextMessages=[{role:'user',content:'CONTEXT: User is viewing a saved analysis report titled "'+RT+'". Here is the FULL current report content:\\n'+rt+'\\n\\nIMPORTANT: You have the entire existing report above. The user may want to ADD to this analysis, REVISE parts of it, or EXPAND its scope. When they give you a prompt:\\n- Consider ALL the existing report content as valid context\\n- Their new request builds ON TOP of the existing analysis\\n- When you respond, incorporate both the existing findings AND the new data/analysis\\n- Keep everything from the existing report that is still relevant\\n- The regenerated report should be a comprehensive merged document — the original content plus the new additions\\n- When user says her/his/she/he/they/this, they mean the subject of this analysis. Do NOT ask who.'},{role:'assistant',content:'Got it. I have the full content of "'+RT+'". I\\'ll treat your next message as building on this existing analysis. I\\'ll incorporate the current findings with any new data or analysis you request, and when you save, the report will be regenerated with everything merged together.'}];
bot.messages=[{role:'assistant',content:'Hi! 👋 I can see you are reviewing **'+RT+'**. Ask me anything — I can add new analysis, expand sections, or update the report with new data. When you\\'re done, hit **Regenerate Report** to update.',timestamp:new Date(),isGreeting:true}];
bot.saveConversationToStorage();if(bot.isOpen)bot.renderMessages();
var sa=document.getElementById('chatbotSaveArea');if(sa){var b=sa.querySelector('.chatbot-save-btn');if(b){b.textContent='🔄 Regenerate Report';b.id='regenReportBtn';}
var nb=document.createElement('button');nb.className='chatbot-save-btn-secondary';nb.id='saveNewNoteBtn';nb.textContent='💾 Save as New Note';sa.appendChild(nb);
nb.addEventListener('click',function(){document.getElementById('chatbotSaveArea').style.display='none';document.getElementById('chatbotSaveForm').style.display='block';document.getElementById('saveFeedback').style.display='none';
var ti=document.getElementById('saveTitle');var si=document.getElementById('saveSummary');
var today=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});ti.value='Chat Analysis - '+today;
var firstUser=bot.messages.find(function(m){return m.role==='user'&&!m.isGreeting});if(firstUser)si.value=firstUser.content.substring(0,120);else si.value='';
ti.focus();ti.select();});}
// Override showSaveForm to regenerate (for the main save btn)
ChatbotWidget.prototype.showSaveForm=function(){this.saveChat()};
// Override saveChat to append to this note (Regenerate Report)
ChatbotWidget.prototype.saveChat=async function(){var fb=document.getElementById('saveFeedback');var ch=this.messages.filter(function(m){return!m.isError&&!m.isGreeting}).map(function(m){return{role:m.role,content:m.content}});
if(ch.length<2){if(fb){fb.textContent='Have a conversation first.';fb.className='save-form-feedback error';fb.style.display='block';}return;}
try{var r=await fetch('/api/analyses/'+AID+'/append',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatHistory:ch})});if(!r.ok)throw 0;
this.messages=[this.messages[0]];this.renderMessages();this.saveConversationToStorage();
var banner=document.createElement('div');banner.id='updateBanner';
banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10000;background:linear-gradient(135deg,#D73F09,#a03000);color:#fff;padding:16px 24px;text-align:center;font-family:Inter,sans-serif;font-weight:600;font-size:15px;box-shadow:0 4px 20px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;gap:12px';
banner.innerHTML='<span style="animation:spin 1s linear infinite;display:inline-block">⏳</span> Regenerating report with new scope... Page will refresh automatically.';
var st=document.createElement('style');st.textContent='@keyframes spin{to{transform:rotate(360deg)}}';document.head.appendChild(st);
document.body.appendChild(banner);
var saveTime=new Date().toISOString();
(function poll(){if(Date.now()-Date.parse(saveTime)>60000){banner.innerHTML='Taking longer than expected. <a href="" style="color:#fff;text-decoration:underline">Refresh manually</a>';return;}
fetch('/api/analyses/'+AID).then(function(r){return r.json()}).then(function(d){if(d.reportGeneratedAt&&d.reportGeneratedAt>saveTime){window.location.reload()}else{setTimeout(poll,2000)}}).catch(function(){setTimeout(poll,3000)})})();
}catch(e){if(fb){fb.textContent='Error. Try again.';fb.className='save-form-feedback error';fb.style.display='block';}}};
// Override save form submit to create NEW note
var origSubmit=document.getElementById('saveSubmitBtn');if(origSubmit){origSubmit.addEventListener('click',function(e){e.stopImmediatePropagation();
var title=document.getElementById('saveTitle').value.trim();var summary=document.getElementById('saveSummary').value.trim();var category=document.getElementById('saveCategory').value;var fb=document.getElementById('saveFeedback');
if(!title){fb.textContent='Title is required';fb.className='save-form-feedback error';fb.style.display='block';return;}
var ch=bot.messages.filter(function(m){return!m.isError&&!m.isGreeting}).map(function(m){return{role:m.role,content:m.content}});
fetch('/api/analyses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title,summary:summary,category:category,chatHistory:ch})}).then(function(r){if(!r.ok)throw 0;fb.textContent='Saved! Redirecting to notes...';fb.className='save-form-feedback success';fb.style.display='block';bot.messages=[{role:'assistant',content:'Chat saved as new note! Redirecting...',timestamp:new Date(),isGreeting:true}];bot.saveConversationToStorage();setTimeout(function(){window.location.href='/notes.html'},1500)}).catch(function(){fb.textContent='Error saving. Try again.';fb.className='save-form-feedback error';fb.style.display='block'});},true);}
// Override cancel to restore two-button area
var origCancel=document.getElementById('saveCancelBtn');if(origCancel){origCancel.addEventListener('click',function(e){e.stopImmediatePropagation();document.getElementById('chatbotSaveForm').style.display='none';document.getElementById('saveFeedback').style.display='none';document.getElementById('chatbotSaveArea').style.display='flex';},true);}
},200);});
})();
</script>
<script>
var AID='${analysisId}';
async function loadInsights(){try{var r=await fetch('/api/analyses/'+AID);if(!r.ok)throw 0;var d=await r.json();renderInsights(d.insights||[])}catch(e){document.getElementById('insightsList').innerHTML='<p class="ie">Could not load insights.</p>'}}
function renderInsights(ins){var el=document.getElementById('insightsList');if(!ins.length){el.innerHTML='<p class="ie">No insights yet. Add your first below!</p>';return;}el.innerHTML=ins.map(function(i){var d=new Date(i.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});return'<div class="ii"><div class="it">'+i.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div><div class="id">'+d+'</div></div>'}).join('')}
document.getElementById('addInsightBtn').addEventListener('click',async function(){var inp=document.getElementById('insightInput'),c=inp.value.trim();if(!c)return;var btn=document.getElementById('addInsightBtn');btn.disabled=true;btn.textContent='Saving...';try{var r=await fetch('/api/analyses/'+AID+'/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})});if(!r.ok)throw 0;inp.value='';await loadInsights()}catch(e){alert('Failed to add insight.')}finally{btn.disabled=false;btn.textContent='Add Insight'}});
document.getElementById('insightInput').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('addInsightBtn').click()}});
loadInsights();
</script>
</body>
</html>`;

  const notesDir = path.join(__dirname, 'public', 'notes');
  if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, analysisId + '.html'), page, 'utf-8');
  console.log('[Analyses] Report page written: /notes/' + analysisId + '.html');
}

// POST /api/analyses — Save new analysis with AI-generated formatted report
app.post('/api/analyses', async (req, res) => {
  try {
    const { title, summary, category, chatHistory } = req.body;
    if (!title || !chatHistory || !Array.isArray(chatHistory)) {
      return res.status(400).json({ error: 'title and chatHistory array are required' });
    }

    const analyses = loadAnalyses();
    const now = new Date().toISOString();
    const newAnalysis = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      title,
      summary: summary || '',
      category: category || 'General',
      chatHistory,
      formattedReport: '',
      insights: [],
      createdAt: now,
      updatedAt: now
    };

    // Save immediately so user gets fast feedback
    analyses.push(newAnalysis);
    saveAnalyses(analyses);
    res.json({ success: true, analysis: newAnalysis });

    // Generate AI-formatted report in the background
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('No API key');

      const client = new Anthropic({ apiKey, timeout: 60000, maxRetries: 1 });
      const chatTranscript = chatHistory
        .map(m => `${m.role === 'user' ? 'User' : 'AI Assistant'}: ${m.content}`)
        .join('\n\n');

      const reportResponse = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16000,
        system: `You are a professional sports analytics report writer for OSU Gymnastics 2026. Transform a chatbot conversation into the BODY CONTENT of a professional analysis report.

# OUTPUT RULES — READ CAREFULLY
- Generate ONLY plain semantic HTML: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <strong>, <em>
- Do NOT use <div>, <span>, or <style> tags
- Do NOT use any inline styles (no style="" attributes anywhere)
- Do NOT use CSS, backgrounds, colors, fonts, padding, margins, or any visual styling
- Do NOT wrap content in any container elements
- Do NOT use markdown code fences — output raw HTML directly
- The page already has professional styling. You just provide the content structure.

# CONTENT STRUCTURE
1. <h1> with the report title
2. <h2>Executive Summary</h2> — 2-3 sentences of key findings
3. <h2>Key Takeaways</h2> — <ul> with the most important bullets
4. <h2>Detailed Analysis</h2> — organized by topic with <h3> subsections
5. Use <table> with <th> and <td> for any numerical data or comparisons
6. <h2>Trends & Patterns</h2> — what the data reveals
7. <h2>Outlook</h2> — forward-looking insights

# WRITING GUIDELINES
- Professional but positive — celebrate achievements
- Use specific numbers with 3 decimal places for gymnastics scores
- Use <strong> for key numbers and athlete names
- Use <em> for supplementary notes
- Use emoji sparingly in <h2> headers only (one per heading max)
- The reader should understand everything without seeing the original chat

# IMPORTANT
- This is a PROFESSIONAL REPORT, not a chat transcript
- Organize by topic, not conversation flow
- Extract ALL data points from the conversation`,
        messages: [{
          role: 'user',
          content: `Transform this chat conversation into a professional analysis report. Title: "${title}"\n\n--- CONVERSATION ---\n${chatTranscript}`
        }]
      });

      const report = reportResponse.content[0]?.text || '';
      if (report) {
        writeReportPage(newAnalysis.id, title, category || 'General', now, report);
        const updatedAnalyses = loadAnalyses();
        const idx = updatedAnalyses.findIndex(a => a.id === newAnalysis.id);
        if (idx >= 0) {
          updatedAnalyses[idx].formattedReport = report;
          updatedAnalyses[idx].reportUrl = '/notes/' + newAnalysis.id + '.html';
          updatedAnalyses[idx].updatedAt = new Date().toISOString();
          saveAnalyses(updatedAnalyses);
          console.log(`[Analyses API] Report page generated for "${title}"`);
        }
      }
    } catch (reportErr) {
      console.error('[Analyses API] Failed to generate formatted report:', reportErr.message);
      // Analysis is already saved with raw chat — report generation is best-effort
    }
  } catch (err) {
    console.error('[Analyses API] Error saving analysis:', err.message);
    res.status(500).json({ error: 'Failed to save analysis' });
  }
});

// GET /api/analyses — List all saved analyses
app.get('/api/analyses', (req, res) => {
  try {
    const analyses = loadAnalyses();
    // Sort by updatedAt descending
    analyses.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    // Return preview with only first 2 chat messages
    const previews = analyses.map(a => ({
      ...a,
      chatHistory: a.chatHistory ? a.chatHistory.slice(0, 2) : []
    }));
    res.json(previews);
  } catch (err) {
    console.error('[Analyses API] Error loading analyses:', err.message);
    res.status(500).json({ error: 'Failed to load analyses' });
  }
});

// GET /api/analyses/:id — Get specific analysis
app.get('/api/analyses/:id', (req, res) => {
  try {
    const analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    res.json(analysis);
  } catch (err) {
    console.error('[Analyses API] Error loading analysis:', err.message);
    res.status(500).json({ error: 'Failed to load analysis' });
  }
});

// POST /api/analyses/:id/insights — Add insight
app.post('/api/analyses/:id/insights', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const insight = {
      id: 'ins_' + Date.now(),
      content,
      createdAt: new Date().toISOString()
    };

    analysis.insights = analysis.insights || [];
    analysis.insights.push(insight);
    analysis.updatedAt = new Date().toISOString();
    saveAnalyses(analyses);

    res.json({ success: true, insight });
  } catch (err) {
    console.error('[Analyses API] Error adding insight:', err.message);
    res.status(500).json({ error: 'Failed to add insight' });
  }
});

// POST /api/analyses/:id/append — Append new chat to existing analysis and regenerate report
app.post('/api/analyses/:id/append', async (req, res) => {
  try {
    const { chatHistory } = req.body;
    if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
      return res.status(400).json({ error: 'chatHistory array is required' });
    }

    const analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Append new chat messages with separator
    analysis.chatHistory = analysis.chatHistory || [];
    analysis.chatHistory.push(
      { role: 'system', content: '--- Follow-up conversation ---' },
      ...chatHistory
    );
    analysis.updatedAt = new Date().toISOString();
    saveAnalyses(analyses);

    res.json({ success: true, message: 'Chat appended. Report is regenerating.' });

    // Regenerate formatted report in background with ALL chat content
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('No API key');

      const client = new Anthropic({ apiKey, timeout: 60000, maxRetries: 1 });
      const chatTranscript = analysis.chatHistory
        .map(m => {
          if (m.role === 'system') return '\n--- ' + m.content + ' ---\n';
          return (m.role === 'user' ? 'User' : 'AI Assistant') + ': ' + m.content;
        })
        .join('\n\n');

      const reportResponse = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16000,
        system: `You are a professional sports analytics report writer for OSU Gymnastics 2026. Transform conversations into the BODY CONTENT of a professional analysis report.

# OUTPUT RULES — CRITICAL, READ CAREFULLY
- Generate ONLY plain semantic HTML tags: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <strong>, <em>
- Do NOT use <div>, <span>, or <style> tags
- Do NOT use any inline styles (no style="" attributes anywhere)
- Do NOT use CSS, backgrounds, colors, fonts, padding, margins, or any visual styling
- Do NOT wrap content in any container elements
- ABSOLUTELY NO MARKDOWN. No #, ##, ###, **, -, ---, \`\`\` or any markdown syntax. Output ONLY HTML tags.
- The page already has professional styling. You just provide the content structure using HTML tags.
- Every heading MUST use <h1>, <h2>, or <h3> tags. Every paragraph MUST use <p> tags. Every list MUST use <ul>/<ol> and <li> tags.

# CONTENT STRUCTURE
1. <h1> with the report title
2. <h2>Executive Summary</h2> — 2-3 paragraphs in <p> tags
3. <h2>Key Takeaways</h2> — <ul> with <li> bullets
4. <h2>Detailed Analysis</h2> — organized by topic with <h3> subsections, <p> paragraphs, <table> for data
5. <h2>Trends & Patterns</h2>, <h2>Outlook</h2>

# WRITING GUIDELINES
- Professional but positive — celebrate achievements
- Use specific numbers with 3 decimal places for gymnastics scores
- Use <strong> for key numbers and athlete names

# REGENERATION RULES
This report is being updated. The conversation history includes the ORIGINAL analysis AND follow-up conversations that ADD TO or EXPAND the report. Your job is to produce a single cohesive report that MERGES everything together:
- Keep ALL valid findings from the original conversations
- Integrate NEW data and analysis from the latest conversations
- The final report should read as one unified document — not as separate sections bolted together
- If new data contradicts old data, use the newer data
- If the user asked to expand scope (e.g., from one event to all events), the report should now cover the full expanded scope while keeping the original analysis that is still relevant
- Organize logically by topic, not chronologically by conversation

Professional, positive, specific numbers with 3 decimal places.`,
        messages: [{
          role: 'user',
          content: 'Regenerate this analysis report by merging ALL conversation data into one cohesive document. Keep everything from earlier conversations that is still valid, and integrate the new findings from the latest conversation. The report should read as a single comprehensive analysis.\n\nTitle: "' + analysis.title + '"\n\nCategory: ' + analysis.category + '\n\n--- CONVERSATIONS ---\n' + chatTranscript
        }]
      });

      const report = reportResponse.content[0]?.text || '';
      if (report) {
        writeReportPage(analysis.id, analysis.title, analysis.category || 'General', analysis.createdAt, report);
        const updatedAnalyses = loadAnalyses();
        const idx = updatedAnalyses.findIndex(a => a.id === analysis.id);
        if (idx >= 0) {
          updatedAnalyses[idx].formattedReport = report;
          updatedAnalyses[idx].reportUrl = '/notes/' + analysis.id + '.html';
          updatedAnalyses[idx].reportGeneratedAt = new Date().toISOString();
          updatedAnalyses[idx].updatedAt = new Date().toISOString();
          saveAnalyses(updatedAnalyses);
          console.log('[Analyses API] Report regenerated for "' + analysis.title + '"');
        }
      }
    } catch (reportErr) {
      console.error('[Analyses API] Failed to regenerate report:', reportErr.message);
    }
  } catch (err) {
    console.error('[Analyses API] Error appending chat:', err.message);
    res.status(500).json({ error: 'Failed to append chat' });
  }
});

// PUT /api/analyses/:id — Update analysis metadata
app.put('/api/analyses/:id', (req, res) => {
  try {
    const { title, summary, category } = req.body;
    const analyses = loadAnalyses();
    const analysis = analyses.find(a => a.id === req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    if (title !== undefined) analysis.title = title;
    if (summary !== undefined) analysis.summary = summary;
    if (category !== undefined) analysis.category = category;
    analysis.updatedAt = new Date().toISOString();
    saveAnalyses(analyses);

    res.json({ success: true, analysis });
  } catch (err) {
    console.error('[Analyses API] Error updating analysis:', err.message);
    res.status(500).json({ error: 'Failed to update analysis' });
  }
});

// DELETE /api/analyses/:id — Delete analysis
app.delete('/api/analyses/:id', (req, res) => {
  try {
    let analyses = loadAnalyses();
    const index = analyses.findIndex(a => a.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    analyses.splice(index, 1);
    saveAnalyses(analyses);

    res.json({ success: true });
  } catch (err) {
    console.error('[Analyses API] Error deleting analysis:', err.message);
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

// ── Chatbot Data Preparation ────────────────────────────────────────────────

/**
 * Build comprehensive athlete profiles for chatbot analysis
 * Extracts detailed stats from the computed stats cache
 * Handles null/undefined safely with fallbacks
 * Returns ALL athletes (no cap) in a compact format for token efficiency
 */
function buildAthleteProfiles() {
  const profiles = {};

  try {
    if (!statsCache || !statsCache.athletes) {
      return profiles;
    }

    for (const [name, athleteStats] of Object.entries(statsCache.athletes)) {
      try {
        const allScores = [];
        const eventProfiles = {};
        let strongestEvent = null;
        let strongestScore = 0;
        let consistencyScores = [];

        if (athleteStats.events && typeof athleteStats.events === 'object') {
          for (const [event, eventData] of Object.entries(athleteStats.events)) {
            try {
              if (!eventData || !eventData.entries || !Array.isArray(eventData.entries) || eventData.entries.length === 0) {
                continue;
              }

              const scores = eventData.entries.map(e => e && typeof e.score === 'number' ? e.score : null).filter(s => s !== null);
              if (scores.length === 0) continue;

              scores.forEach(s => allScores.push(s));

              const avg = eventData.avg || 0;
              const stdDev = eventData.stdDev || 0;
              const cv = avg > 0 ? Math.abs(stdDev) / avg : 0;
              const consistency = Math.max(0, (1 - Math.min(cv / 0.1, 1)) * 100);
              consistencyScores.push(consistency);

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

// ── Chatbot Tool Handler Functions ──────────────────────────────────────────

/**
 * Tool 1: Get athlete progression through the season (meet-by-meet)
 */
function toolGetAthleteProgression(input) {
  const athleteName = input.athlete_name;
  if (!athleteName) return { error: 'athlete_name is required' };
  if (!meetsData || !statsCache || !statsCache.athletes) return { error: 'Data not available' };

  // Find best match for name
  const matchedName = findAthleteName(athleteName);
  if (!matchedName) return { error: `Athlete "${athleteName}" not found` };

  const meetsByDate = {};
  const meetDatesSet = new Set();

  meetsData.forEach(meet => {
    if (!meet.date || !meet.athletes) return;
    const athleteEntry = meet.athletes.find(a =>
      (a.name || '').toLowerCase() === matchedName.toLowerCase()
    );
    if (!athleteEntry) return;

    meetDatesSet.add(meet.date);
    if (!meetsByDate[meet.date]) {
      meetsByDate[meet.date] = {
        date: meet.date,
        opponent: meet.opponent || 'Unknown',
        location: meet.isHome ? 'Home' : 'Away',
        scores: {},
        lineup_positions: {}
      };
    }

    if (athleteEntry.scores) {
      Object.entries(athleteEntry.scores).forEach(([event, score]) => {
        if (GYMNASTICS_EVENTS.includes(event)) {
          meetsByDate[meet.date].scores[event] = score;
        }
      });
    }

    // Get lineup positions
    if (meet.lineups) {
      GYMNASTICS_EVENTS.forEach(event => {
        if (meet.lineups[event] && Array.isArray(meet.lineups[event])) {
          const pos = meet.lineups[event].findIndex(n => {
            const name = typeof n === 'string' ? n : (n && n.name ? n.name : '');
            return name && name.toLowerCase() === matchedName.toLowerCase();
          });
          if (pos >= 0) meetsByDate[meet.date].lineup_positions[event] = pos + 1;
        }
      });
    }

    // Calculate AA
    const competed = GYMNASTICS_EVENTS.filter(ev => meetsByDate[meet.date].scores[ev] !== undefined);
    if (competed.length > 0) {
      meetsByDate[meet.date].scores.aa = parseFloat(
        competed.reduce((sum, ev) => sum + meetsByDate[meet.date].scores[ev], 0).toFixed(3)
      );
    }
  });

  const meetDates = Array.from(meetDatesSet).sort((a, b) => new Date(a) - new Date(b));
  const meets = meetDates.map(date => meetsByDate[date]);

  // Summary
  const allAAs = meets.filter(m => m.scores.aa).map(m => m.scores.aa);
  const midpoint = Math.ceil(meets.length / 2);
  const firstHalfAAs = meets.slice(0, midpoint).filter(m => m.scores.aa).map(m => m.scores.aa);
  const secondHalfAAs = meets.slice(midpoint).filter(m => m.scores.aa).map(m => m.scores.aa);
  const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3)) : null;

  let trend = 'stable';
  const fha = avg(firstHalfAAs);
  const sha = avg(secondHalfAAs);
  if (fha && sha) {
    const diff = sha - fha;
    if (diff > 0.2) trend = 'improving';
    else if (diff < -0.2) trend = 'declining';
  }

  const bestMeet = meets.reduce((best, m) => (m.scores.aa || 0) > (best.scores.aa || 0) ? m : best, meets[0] || { scores: {} });
  const worstMeet = meets.reduce((worst, m) => (m.scores.aa || Infinity) < (worst.scores.aa || Infinity) ? m : worst, meets[0] || { scores: {} });

  return {
    athlete: matchedName,
    meets,
    summary: {
      total_meets: meets.length,
      trend,
      best_meet: bestMeet ? { date: bestMeet.date, opponent: bestMeet.opponent, aa: bestMeet.scores.aa } : null,
      worst_meet: worstMeet ? { date: worstMeet.date, opponent: worstMeet.opponent, aa: worstMeet.scores.aa } : null,
      first_half_avg: fha,
      second_half_avg: sha
    }
  };
}

/**
 * Tool 2: Get meet details
 */
function toolGetMeetDetails(input) {
  if (!meetsData) return { error: 'Data not available' };

  let meet = null;
  if (input.meet_id) {
    meet = meetsData.find(m => m.id === input.meet_id);
  } else if (input.date) {
    meet = meetsData.find(m => m.date === input.date);
  } else {
    return { error: 'Provide meet_id or date' };
  }

  if (!meet) return { error: 'Meet not found' };

  return {
    meet_id: meet.id,
    date: meet.date,
    opponent: meet.opponent,
    location: meet.location || (meet.isHome ? 'Home' : 'Away'),
    result: meet.result,
    osuScore: meet.osuScore,
    opponentScore: meet.opponentScore,
    athletes: meet.athletes || [],
    lineups: meet.lineups || {},
    competitorAthletes: meet.competitorAthletes || {}
  };
}

/**
 * Tool 3: Compare athletes side-by-side
 */
function toolCompareAthletes(input) {
  if (!input.athlete_names || !Array.isArray(input.athlete_names) || input.athlete_names.length === 0) {
    return { error: 'athlete_names array is required' };
  }
  if (!statsCache || !statsCache.athletes) return { error: 'Data not available' };

  const eventFilter = input.event || null;
  const athletes = {};

  for (const rawName of input.athlete_names) {
    const name = findAthleteName(rawName);
    if (!name) {
      athletes[rawName] = { error: 'Not found' };
      continue;
    }

    const stats = statsCache.athletes[name];
    if (!stats) { athletes[rawName] = { error: 'No stats' }; continue; }

    const result = { averages: {}, highs: {}, lows: {}, trends: {}, meet_count: {} };
    const events = eventFilter ? [eventFilter] : GYMNASTICS_EVENTS;

    events.forEach(ev => {
      const ed = stats.events && stats.events[ev];
      if (!ed || !ed.entries || ed.entries.length === 0) return;
      result.averages[ev] = ed.avg ? parseFloat(ed.avg.toFixed(3)) : null;
      result.highs[ev] = ed.best ? parseFloat(ed.best.toFixed(3)) : null;
      result.lows[ev] = ed.worst ? parseFloat(ed.worst.toFixed(3)) : null;
      result.trends[ev] = ed.trendSlope ? (ed.trendSlope > 0.01 ? 'improving' : ed.trendSlope < -0.01 ? 'declining' : 'stable') : 'stable';
      result.meet_count[ev] = ed.appearances || ed.entries.length;
    });

    athletes[name] = result;
  }

  // Head-to-head: meets where both athletes competed
  const names = Object.keys(athletes).filter(n => !athletes[n].error);
  const headToHead = [];
  if (names.length >= 2 && meetsData) {
    meetsData.forEach(meet => {
      if (!meet.athletes) return;
      const found = {};
      names.forEach(name => {
        const entry = meet.athletes.find(a => (a.name || '').toLowerCase() === name.toLowerCase());
        if (entry) found[name] = entry.scores || {};
      });
      if (Object.keys(found).length >= 2) {
        headToHead.push({ date: meet.date, opponent: meet.opponent, athletes: found });
      }
    });
  }

  return { athletes, head_to_head: headToHead };
}

/**
 * Tool 4: Get event rankings
 */
function toolGetEventRankings(input) {
  if (!input.event || !GYMNASTICS_EVENTS.includes(input.event)) {
    return { error: `Invalid event. Must be one of: ${GYMNASTICS_EVENTS.join(', ')}` };
  }
  if (!statsCache || !statsCache.athletes) return { error: 'Data not available' };

  const metric = input.metric || 'average';
  const event = input.event;
  const rankings = [];

  for (const [name, stats] of Object.entries(statsCache.athletes)) {
    const ed = stats.events && stats.events[event];
    if (!ed || !ed.entries || ed.entries.length === 0) continue;

    let value;
    if (metric === 'high') {
      value = ed.best || 0;
    } else if (metric === 'consistency') {
      const avg = ed.avg || 0;
      const stdDev = ed.stdDev || 0;
      value = avg > 0 ? parseFloat(((1 - Math.abs(stdDev) / avg / 0.1) * 100).toFixed(1)) : 0;
    } else {
      value = ed.avg || 0;
    }

    rankings.push({
      name,
      value: parseFloat(value.toFixed(3)),
      count: ed.appearances || ed.entries.length
    });
  }

  rankings.sort((a, b) => b.value - a.value);
  rankings.forEach((r, i) => r.rank = i + 1);

  return { event, metric, rankings };
}

/**
 * Tool 5: Get team trends across the season
 */
function toolGetTeamTrends(input) {
  if (!meetsData) return { error: 'Data not available' };

  const eventFilter = input.event || null;
  const sortedMeets = [...meetsData].sort((a, b) => new Date(a.date) - new Date(b.date));
  const meetResults = [];

  sortedMeets.forEach(meet => {
    if (!meet.date) return;
    const entry = {
      date: meet.date,
      opponent: meet.opponent || 'Unknown',
      team_total: meet.osuScore || null,
      result: meet.result || null,
      is_home: meet.isHome || false,
      event_totals: {}
    };

    // Compute event totals from lineups
    if (meet.lineups && meet.athletes) {
      GYMNASTICS_EVENTS.forEach(ev => {
        if (eventFilter && ev !== eventFilter) return;
        const lineupNames = meet.lineups[ev] || [];
        let total = 0;
        let count = 0;
        lineupNames.forEach(entry => {
          const athleteName = typeof entry === 'string' ? entry : (entry && entry.name ? entry.name : '');
          const athlete = meet.athletes.find(a => (a.name || '').toLowerCase() === (athleteName || '').toLowerCase());
          if (athlete && athlete.scores && typeof athlete.scores[ev] === 'number') {
            total += athlete.scores[ev];
            count++;
          }
        });
        if (count > 0) entry.event_totals[ev] = parseFloat(total.toFixed(3));
      });
    }

    meetResults.push(entry);
  });

  // Compute trends
  const teamTotals = meetResults.filter(m => m.team_total).map(m => m.team_total);
  const homeTotals = meetResults.filter(m => m.is_home && m.team_total).map(m => m.team_total);
  const awayTotals = meetResults.filter(m => !m.is_home && m.team_total).map(m => m.team_total);
  const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3)) : null;

  const mid = Math.ceil(teamTotals.length / 2);
  const firstHalf = avg(teamTotals.slice(0, mid));
  const secondHalf = avg(teamTotals.slice(mid));
  let direction = 'stable';
  if (firstHalf && secondHalf) {
    if (secondHalf - firstHalf > 0.5) direction = 'improving';
    else if (firstHalf - secondHalf > 0.5) direction = 'declining';
  }

  const bestMeet = meetResults.reduce((best, m) => (m.team_total || 0) > (best.team_total || 0) ? m : best, meetResults[0] || {});
  const worstMeet = meetResults.reduce((worst, m) => (m.team_total || Infinity) < (worst.team_total || Infinity) ? m : worst, meetResults[0] || {});

  return {
    meets: meetResults,
    trends: {
      overall_direction: direction,
      season_avg: avg(teamTotals),
      home_avg: avg(homeTotals),
      away_avg: avg(awayTotals),
      best_meet: bestMeet ? { date: bestMeet.date, opponent: bestMeet.opponent, total: bestMeet.team_total } : null,
      worst_meet: worstMeet ? { date: worstMeet.date, opponent: worstMeet.opponent, total: worstMeet.team_total } : null,
      first_half_avg: firstHalf,
      second_half_avg: secondHalf
    }
  };
}

/**
 * Tool 6: Get lineup analysis for an event
 */
function toolGetLineupAnalysis(input) {
  if (!input.event || !GYMNASTICS_EVENTS.includes(input.event)) {
    return { error: `Invalid event. Must be one of: ${GYMNASTICS_EVENTS.join(', ')}` };
  }
  if (!meetsData) return { error: 'Data not available' };

  const event = input.event;
  const athleteFilter = input.athlete_name ? findAthleteName(input.athlete_name) : null;
  const positions = {}; // position -> { scores: [], athletes: {} }

  meetsData.forEach(meet => {
    if (!meet.lineups || !meet.lineups[event] || !meet.athletes) return;
    const lineup = meet.lineups[event];

    lineup.forEach((entry, idx) => {
      const athleteName = typeof entry === 'string' ? entry : (entry && entry.name ? entry.name : '');
      if (!athleteName) return;
      const pos = idx + 1;
      if (!positions[pos]) positions[pos] = { scores: [], athletes: {} };

      const athlete = meet.athletes.find(a => (a.name || '').toLowerCase() === athleteName.toLowerCase());
      const score = athlete && athlete.scores && typeof athlete.scores[event] === 'number' ? athlete.scores[event] : null;

      if (score !== null) {
        positions[pos].scores.push(score);
        if (!positions[pos].athletes[athleteName]) {
          positions[pos].athletes[athleteName] = { scores: [], count: 0 };
        }
        positions[pos].athletes[athleteName].scores.push(score);
        positions[pos].athletes[athleteName].count++;
      }
    });
  });

  // Compute averages
  const positionSummary = {};
  for (const [pos, data] of Object.entries(positions)) {
    const avg = data.scores.length ? parseFloat((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(3)) : null;
    const athleteSummary = {};
    for (const [name, ad] of Object.entries(data.athletes)) {
      athleteSummary[name] = {
        avg: parseFloat((ad.scores.reduce((a, b) => a + b, 0) / ad.scores.length).toFixed(3)),
        count: ad.count,
        high: parseFloat(Math.max(...ad.scores).toFixed(3))
      };
    }
    positionSummary[pos] = { avg, count: data.scores.length, athletes: athleteSummary };
  }

  const result = { event, positions: positionSummary };

  // If athlete filter, add their specific detail
  if (athleteFilter) {
    const athleteDetail = { positions_used: [], scores_by_position: {} };
    for (const [pos, data] of Object.entries(positionSummary)) {
      if (data.athletes[athleteFilter]) {
        athleteDetail.positions_used.push(parseInt(pos));
        athleteDetail.scores_by_position[pos] = data.athletes[athleteFilter];
      }
    }
    result.athlete_detail = { name: athleteFilter, ...athleteDetail };
  }

  return result;
}

/**
 * Tool 7: Search athletes by partial/fuzzy name match
 */
function toolSearchAthletes(input) {
  if (!input.query) return { error: 'query is required' };
  if (!statsCache || !statsCache.athletes) return { error: 'Data not available' };

  const query = input.query.toLowerCase();
  const matches = [];

  for (const [name, stats] of Object.entries(statsCache.athletes)) {
    const nameLower = name.toLowerCase();
    // Match if query is substring of name or any word in name starts with query
    const words = nameLower.split(/\s+/);
    const isMatch = nameLower.includes(query) || words.some(w => w.startsWith(query));
    if (!isMatch) continue;

    let strongestEvent = null;
    let strongestAvg = 0;
    let totalAppearances = 0;

    if (stats.events) {
      for (const [ev, ed] of Object.entries(stats.events)) {
        if (ed && ed.avg && ed.avg > strongestAvg) {
          strongestAvg = ed.avg;
          strongestEvent = ev;
        }
        totalAppearances += (ed && ed.appearances) || 0;
      }
    }

    const allScores = [];
    if (stats.events) {
      for (const ed of Object.values(stats.events)) {
        if (ed && ed.entries) {
          ed.entries.forEach(e => { if (e && typeof e.score === 'number') allScores.push(e.score); });
        }
      }
    }
    const seasonAvg = allScores.length ? parseFloat((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(3)) : null;

    matches.push({
      name,
      season_average: seasonAvg,
      strongest_event: strongestEvent,
      meets_competed: stats.totalAppearances || totalAppearances
    });
  }

  matches.sort((a, b) => (b.season_average || 0) - (a.season_average || 0));

  return { query: input.query, matches };
}

/**
 * Tool 8: Get competitor data from meets
 */
function toolGetCompetitorData(input) {
  if (!meetsData) return { error: 'Data not available' };

  let filtered = meetsData;
  if (input.meet_id) {
    filtered = filtered.filter(m => m.id === input.meet_id);
  }
  if (input.team_name) {
    const teamQuery = input.team_name.toLowerCase();
    filtered = filtered.filter(m =>
      (m.opponent || '').toLowerCase().includes(teamQuery) ||
      (m.quadName || '').toLowerCase().includes(teamQuery) ||
      (m.allTeams || []).some(t => typeof t === 'string' && t.toLowerCase().includes(teamQuery))
    );
  }

  return {
    meets: filtered.map(m => ({
      date: m.date,
      opponent: m.opponent,
      osuScore: m.osuScore,
      opponentScore: m.opponentScore,
      result: m.result,
      competitorAthletes: m.competitorAthletes || {},
      competitorLineups: m.competitorLineups || {}
    }))
  };
}

/**
 * Get full competitor team season data (Alabama, Utah, Denver)
 */
function toolGetCompetitorTeam(input) {
  const teamKey = (input.team_name || '').toLowerCase().trim();
  if (!teamKey) return { error: 'team_name is required. Available: alabama, utah, denver' };

  // Find by key or partial name match
  const match = Object.entries(competitorData).find(([key, data]) =>
    key.includes(teamKey) || data.team.name.toLowerCase().includes(teamKey)
  );

  if (!match) {
    const available = Object.keys(competitorData).join(', ') || 'none loaded';
    return { error: `Team "${input.team_name}" not found. Available: ${available}` };
  }

  const [key, data] = match;

  // If specific athlete requested, return just that athlete
  if (input.athlete_name) {
    const aq = input.athlete_name.toLowerCase();
    const athleteMatch = Object.entries(data.athletes).find(([name]) =>
      name.toLowerCase().includes(aq)
    );
    if (!athleteMatch) return { error: `Athlete "${input.athlete_name}" not found on ${data.team.name}` };
    return {
      team: data.team.name,
      athlete: athleteMatch[0],
      profile: athleteMatch[1],
    };
  }

  // If specific event requested, return event rankings
  if (input.event) {
    const ev = input.event.toLowerCase();
    return {
      team: data.team.name,
      event: ev,
      rankings: data.eventRankings[ev] || [],
      teamTrends: data.teamTrends.map(m => ({ date: m.date, [ev]: m[ev], total: m.total })),
    };
  }

  // Return full team overview
  return {
    team: data.team.name,
    conference: data.team.conference,
    teamStats: data.teamStats,
    teamTrends: data.teamTrends,
    topScores: data.topScores,
    eventRankings: data.eventRankings,
    athletes: Object.fromEntries(
      Object.entries(data.athletes).map(([name, p]) => [name, {
        strongestEvent: p.strongestEvent,
        seasonAvg: p.seasonAvg,
        seasonHigh: p.seasonHigh,
        totalAppearances: p.totalAppearances,
        consistency: p.consistency,
        events: Object.fromEntries(
          Object.entries(p.events).map(([ev, s]) => [ev, { avg: s.avg, high: s.high, low: s.low, count: s.count, stdDev: s.stdDev }])
        ),
      }])
    ),
  };
}

/**
 * Helper: Find best matching athlete name (case-insensitive, partial match)
 */
function findAthleteName(query) {
  if (!statsCache || !statsCache.athletes) return null;
  const names = Object.keys(statsCache.athletes).filter(n => typeof n === 'string' && n.length > 0);
  const q = (query || '').toLowerCase().trim();
  if (!q) return null;

  // Exact match (case-insensitive)
  const exact = names.find(n => n.toLowerCase() === q);
  if (exact) return exact;

  // Partial match (query is substring)
  const partial = names.find(n => n.toLowerCase().includes(q));
  if (partial) return partial;

  // Word-start match
  const wordMatch = names.find(n => {
    const words = n.toLowerCase().split(/\s+/);
    return words.some(w => w.startsWith(q));
  });
  return wordMatch || null;
}

/**
 * Execute a tool call by name and return the result
 */
function executeToolCall(toolName, input) {
  try {
    switch (toolName) {
      case 'get_athlete_progression': return toolGetAthleteProgression(input);
      case 'get_meet_details': return toolGetMeetDetails(input);
      case 'compare_athletes': return toolCompareAthletes(input);
      case 'get_event_rankings': return toolGetEventRankings(input);
      case 'get_team_trends': return toolGetTeamTrends(input);
      case 'get_lineup_analysis': return toolGetLineupAnalysis(input);
      case 'search_athletes': return toolSearchAthletes(input);
      case 'get_competitor_data': return toolGetCompetitorData(input);
      case 'get_competitor_team': return toolGetCompetitorTeam(input);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[Tool] Error executing ${toolName}:`, err.message);
    return { error: `Tool execution failed: ${err.message}` };
  }
}

// ── Claude Tool Definitions ─────────────────────────────────────────────────

const chatbotTools = [
  {
    name: 'get_athlete_progression',
    description: 'Get an athlete\'s meet-by-meet progression through the season. Returns chronological scores per event, AA totals, lineup positions, HOME/AWAY location for each meet, and trend summary. Use for progression, trend, consistency, home vs away analysis, and any question requiring individual scores. ALWAYS call this tool — do not try to answer from pre-computed context.',
    input_schema: {
      type: 'object',
      properties: {
        athlete_name: { type: 'string', description: 'The athlete\'s name (partial match supported)' }
      },
      required: ['athlete_name']
    }
  },
  {
    name: 'get_meet_details',
    description: 'Get full details of a specific meet including all athletes, scores, lineups, and competitor data. Use when asked about a particular meet or date.',
    input_schema: {
      type: 'object',
      properties: {
        meet_id: { type: 'string', description: 'The meet ID' },
        date: { type: 'string', description: 'The meet date (YYYY-MM-DD)' }
      }
    }
  },
  {
    name: 'compare_athletes',
    description: 'Compare multiple athletes side-by-side with averages, highs, lows, trends, and head-to-head meet results. Use when asked to compare two or more gymnasts.',
    input_schema: {
      type: 'object',
      properties: {
        athlete_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of athlete names to compare'
        },
        event: { type: 'string', description: 'Optional: filter to a specific event (vault, bars, beam, floor)' }
      },
      required: ['athlete_names']
    }
  },
  {
    name: 'get_event_rankings',
    description: 'Rank all athletes on a specific event by average, season high, or consistency. Use for "who\'s the best on vault?" or "rank the beam gymnasts" type questions.',
    input_schema: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: ['vault', 'bars', 'beam', 'floor'], description: 'The gymnastics event' },
        metric: { type: 'string', enum: ['average', 'high', 'consistency'], description: 'Ranking metric (default: average)' }
      },
      required: ['event']
    }
  },
  {
    name: 'get_team_trends',
    description: 'Get team-level performance trends across the season: meet-by-meet team totals, event totals, home/away splits, and overall direction. Use for team trajectory and season overview questions.',
    input_schema: {
      type: 'object',
      properties: {
        event: { type: 'string', description: 'Optional: filter to a specific event (vault, bars, beam, floor)' }
      }
    }
  },
  {
    name: 'get_lineup_analysis',
    description: 'Analyze lineup rotation positions for an event: who competed in each position, position averages, and per-athlete position performance. Use for lineup strategy and rotation questions.',
    input_schema: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: ['vault', 'bars', 'beam', 'floor'], description: 'The gymnastics event' },
        athlete_name: { type: 'string', description: 'Optional: focus on a specific athlete\'s position history' }
      },
      required: ['event']
    }
  },
  {
    name: 'search_athletes',
    description: 'Search for athletes by partial name match. Returns matching athletes with basic stats. Use when the user mentions a name you\'re not sure about or to find athletes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial name to search for' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_competitor_data',
    description: 'Get competitor/opponent team data from OSU meets. Can filter by meet ID or team name. Use when asked about opponents in the context of OSU meets.',
    input_schema: {
      type: 'object',
      properties: {
        meet_id: { type: 'string', description: 'Optional: filter to a specific meet' },
        team_name: { type: 'string', description: 'Optional: filter by opponent team name (partial match)' }
      }
    }
  },
  {
    name: 'get_competitor_team',
    description: 'Get FULL SEASON DATA for Alabama, Utah, or Denver — their complete 2026 season with every athlete, every score, every meet, event rankings, team trends, and statistical profiles. Use this for any question about these teams: predictions, comparisons, trend analysis, scouting reports, or head-to-head matchup preparation. This is rich data — call it!',
    input_schema: {
      type: 'object',
      properties: {
        team_name: { type: 'string', description: 'Team name: alabama, utah, or denver' },
        athlete_name: { type: 'string', description: 'Optional: get detailed data for a specific athlete on the team' },
        event: { type: 'string', enum: ['vault', 'bars', 'beam', 'floor'], description: 'Optional: focus on a specific event' }
      },
      required: ['team_name']
    }
  }
];

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
      timeout: 60000, // 60 second timeout for API requests
      maxRetries: 1    // Retry once on transient failures
    });
    console.log('[Chat API] Anthropic client initialized with 60s timeout');

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

    // Build compact data context for system prompt (all athletes, no cap)
    let dataContext = '';

    if (statsAvailable && athleteIndex.length > 0) {
      // Compact team overview
      const t = teamContext;
      const teamLine = `Record: ${t.record.wins}-${t.record.losses} | Avg: ${t.season_average || 'N/A'} | High: ${t.season_high || 'N/A'} | Home: ${t.home_average || 'N/A'} | Away: ${t.away_average || 'N/A'} | Meets: ${t.meets_played} | NQS: ${t.nqs || 'N/A'}`;

      // Compact athlete summaries (ALL athletes, no cap)
      const athleteLines = athleteIndex.map(name => {
        const p = athleteProfiles[name];
        if (!p) return null;
        const evts = p.events && typeof p.events === 'object'
          ? Object.entries(p.events).map(([ev, s]) => `${ev}:${s.average || '-'}(${s.count})`).join(' ')
          : '';
        return `${name}|apps:${p.lineup_appearances || 0}|avg:${p.season_average || '-'}|hi:${p.season_high || '-'}|lo:${p.season_low || '-'}|con:${p.overall_consistency !== null ? p.overall_consistency + '%' : '-'}|best:${p.strongest_event || '-'}|${evts}`;
      }).filter(Boolean).join('\n');

      // Season highlights
      const sortedByAvg = athleteIndex
        .map(n => ({ name: n, avg: athleteProfiles[n]?.season_average || 0 }))
        .sort((a, b) => b.avg - a.avg);
      const topPerformers = sortedByAvg.slice(0, 5).map(a => `${a.name} (${a.avg})`).join(', ');

      dataContext = `
## TEAM OVERVIEW
${teamLine}

## TOP PERFORMERS
${topPerformers}

## ALL ATHLETES (${athleteIndex.length} total)
Format: Name|apps:N|avg:N|hi:N|lo:N|con:N%|best:event|event:avg(count)...
${athleteLines}
`;
    } else {
      dataContext = `
## DATA STATUS
Statistics are currently unavailable or being computed. You can still discuss gymnastics generally. Let users know data will be available when stats load.
`;
    }

    const systemPrompt = `You are an elite, positive gymnastics analytics AI for the OSU Beavers 2026 season. You celebrate achievements and frame areas for improvement as growth opportunities.

# IDENTITY
You are the OSU Gymnastics AI Assistant -- deeply knowledgeable about every athlete, every meet, every score from the 2026 season. You are enthusiastic about the Beavers and provide data-driven, encouraging analysis.

# PRE-COMPUTED DATA
${dataContext}

# ANALYTICAL WORKFLOW
When answering questions, follow this process:
1. **Understand**: Parse the user's intent -- what are they really asking?
2. **Gather**: IMMEDIATELY call tools to get the data you need. Do NOT plan or deliberate -- just call the tools in your FIRST response. The pre-computed context above is only a summary; for any real analysis you MUST use tools.
3. **Analyze**: Find patterns, trends, and insights in the returned data
4. **Present**: Deliver a clear, positive, data-backed response

# EFFICIENCY RULES
- The pre-computed context is a quick reference ONLY. For ANY question about specific scores, home/away splits, consistency, trends, comparisons, rankings, or statistical calculations — ALWAYS call tools IMMEDIATELY in your first response. Do not attempt to answer without tool data.
- Be decisive -- call tools and answer. Never say "let me get the data" or "I'll analyze this" without SIMULTANEOUSLY calling the tools. If you find yourself writing text without a tool call, you are doing it wrong.
- For complex analyses (comparisons, trends, lineup strategy), use as many tools as needed (up to 5 rounds)
- When asked "who is the most/best/worst X" — call get_event_rankings AND get_athlete_progression for the top candidates to get the detail you need. Do this in your FIRST response.

# TOOLS AVAILABLE
You have 8 tools that give you access to ALL raw data — every score from every routine at every meet. ALWAYS use these tools when the pre-computed context doesn't have enough detail. Never say you can't access data without trying.
- **get_athlete_progression**: Every individual score from every meet for an athlete, chronologically. Returns per-event scores, lineup positions, AA totals. Use this to calculate standard deviations, trends, consistency, or any per-routine analysis.
- **get_meet_details**: Full details of a specific meet. Use for "what happened at the BYU meet?"
- **compare_athletes**: Side-by-side athlete comparison. Use for "compare X vs Y"
- **get_event_rankings**: Rank all athletes on an event. Use for "who's the best on bars?"
- **get_team_trends**: Season-long team performance trends. Use for "how's the team doing over time?"
- **get_lineup_analysis**: Rotation position analysis. Use for "what positions does she compete in?"
- **search_athletes**: Find athletes by partial name. Use when unsure about a name
- **get_competitor_data**: Opponent team data from OSU meets. Use for "how did BYU score against us?"
- **get_competitor_team**: FULL SEASON DATA for Alabama, Utah, or Denver. Every athlete's scores from every meet, event rankings, team trends, consistency metrics. Use for scouting, predictions, comparisons, matchup analysis. ALWAYS use this when the user asks about Alabama, Utah, or Denver.

# GYMNASTICS FACTS — DO NOT GET THESE WRONG
- There are exactly 4 events in women's gymnastics: Vault, Bars, Beam, Floor. Always 4. Never say "12 events" or any other number.
- A quad meet is ONE meet with 4 teams competing, not 4 separate meets. Count meets by date/competition, not by opponent. For example, if OSU competed on 12 different dates, that is 12 meets — even if some were quad meets with multiple opponents.
- OSU has 12 actual meets this season (some are quad meets with multiple opponents recorded separately in the data, but they are single competitions).

# FORMATTING GUIDELINES
- Use tables for comparisons and rankings
- Use bullet points for summaries
- Always cite specific numbers (3 decimal places for scores)
- Use bold for key stats and athlete names
- Keep responses focused and scannable

# TONE
- Always positive and encouraging -- celebrate what athletes do well
- Frame weaknesses as "growth opportunities" or "areas to watch"
- Show genuine enthusiasm for great performances
- Be supportive and team-oriented
- Use phrases like "impressive," "strong showing," "exciting trajectory"

# CRITICAL RULES
- NEVER make up or hallucinate specific numbers
- Always use real data from tools
- ALWAYS call tools in your FIRST response. Never write a message saying you will get data or need to look something up — just call the tools. If your first response contains text but no tool calls, you have failed.
- NEVER claim data is unavailable or that you can't access something WITHOUT FIRST calling the relevant tools. You have access to EVERY individual score from EVERY routine for EVERY athlete via tools. If you need individual scores, call get_athlete_progression. If you need meet details, call get_meet_details. Always try the tools before saying you don't have the data.
- NEVER ask the user if they want you to try a "different approach" — just DO IT. You are an agentic AI. Figure out how to answer the question and execute.
- If a tool returns an error, try a different tool or approach. Do not give up after one attempt.
- You CAN calculate standard deviations, averages, trends, and any statistical analysis from the individual scores returned by tools. Do the math yourself.
- The get_athlete_progression tool returns home/away location for every meet. Use this to filter for home-only or away-only analysis when asked.
- Show 3 decimal places for gymnastics scores
- Handle truly missing data gracefully with "N/A" rather than guessing`;

    console.log('[Chat API] Athlete profiles ready. Stats available: ' + statsAvailable);
    console.log(`[Chat API] Context includes ${athleteIndex.length} athletes`);
    console.log('[Chat API] Starting agentic chat loop...');
    const startTime = Date.now();

    // Agentic chat loop with tool use
    let currentMessages = [...claudeMessages];
    let rounds = 0;
    const MAX_ROUNDS = 5;
    const LOOP_TIMEOUT = 45000; // 45 seconds
    let assistantMessage = '';

    while (rounds < MAX_ROUNDS) {
      if (Date.now() - startTime > LOOP_TIMEOUT) {
        console.log(`[Chat API] Loop timeout reached after ${rounds} rounds`);
        if (!assistantMessage) {
          assistantMessage = "I'm still analyzing your question. The data is complex -- could you try asking again? I'll work faster this time!";
        }
        break;
      }

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: chatbotTools,
      });

      rounds++;
      const roundDuration = Date.now() - startTime;
      console.log(`[Chat API] Round ${rounds} completed (${roundDuration}ms elapsed)`);

      // Check for tool use vs text response
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      if (toolUseBlocks.length === 0) {
        // Final text response -- done!
        assistantMessage = textBlocks.map(b => b.text).join('\n');
        console.log(`[Chat API] Final response received after ${rounds} round(s)`);
        break;
      }

      // Execute tool calls
      console.log(`[Chat API] Processing ${toolUseBlocks.length} tool call(s) in round ${rounds}`);
      const toolResults = [];
      for (const toolCall of toolUseBlocks) {
        console.log(`[Chat API] Tool call: ${toolCall.name}(${JSON.stringify(toolCall.input)})`);
        const result = executeToolCall(toolCall.name, toolCall.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Capture any partial text in case we timeout next round
      if (textBlocks.length > 0) {
        assistantMessage = textBlocks.map(b => b.text).join('\n');
      }

      // Add assistant response and tool results to conversation
      currentMessages.push({ role: 'assistant', content: response.content });
      currentMessages.push({ role: 'user', content: toolResults });
    }

    const duration = Date.now() - startTime;
    console.log(`[Chat API] Successfully completed in ${duration}ms with ${rounds} round(s)`);

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
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
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
