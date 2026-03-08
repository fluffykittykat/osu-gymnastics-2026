const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const { execSync } = require('child_process');

// Cache-bust version = git commit hash (short)
let ASSET_VERSION = 'dev';
try {
  ASSET_VERSION = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch (e) {}

// Keep meets data in memory for fast serving
let meetsData = null;

function loadMeetsData() {
  try {
    meetsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'meets.json'), 'utf-8'));
  } catch (err) {
    console.error('Failed to load meets.json:', err.message);
    meetsData = [];
  }
}

// Load on startup
loadMeetsData();

// Serve index.html with injected asset version for automatic cache-busting
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html.replace(/\?v=[^"']*/g, `?v=${ASSET_VERSION}`);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.use(express.static('public'));

app.get('/api/bios', (req, res) => {
  try {
    const bios = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/bios.json'), 'utf8'));
    res.json(bios);
  } catch (e) { res.json({}); }
});

app.get('/api/photos', (req, res) => {
  try {
    const photos = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/photos.json'), 'utf8'));
    res.json(photos);
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

app.post('/api/refresh', async (req, res) => {
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

    // Reload meets.json into memory
    loadMeetsData();

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
  }
});

app.get('/healthz', (req, res) => {
  const { name, version } = require('./package.json');
  res.json({ status: 'ok', uptime: process.uptime(), version });
});

const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`🤸 OSU Gymnastics 2026 running on http://localhost:${PORT}`);
});
