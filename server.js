const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();

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

app.use(express.static('public'));

app.get('/api/meets', (req, res) => {
  if (meetsData) {
    res.json(meetsData);
  } else {
    res.sendFile(path.join(__dirname, 'data', 'meets.json'));
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const result = execSync('python3 scripts/refresh_data.py', {
      cwd: __dirname,
      timeout: 60000,
      encoding: 'utf-8',
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
