const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Load meets data into memory
let meetsData = null;
function loadMeets() {
  try {
    meetsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'meets.json')));
  } catch (err) {
    meetsData = [];
    console.error('Warning: could not load meets.json:', err.message);
  }
}
loadMeets();

app.get('/api/meets', (req, res) => {
  res.json(meetsData);
});

app.post('/api/refresh', (req, res) => {
  try {
    const result = execSync('python3 scripts/refresh_data.py', {
      cwd: __dirname,
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Reload meets.json into memory
    loadMeets();
    let summary = {};
    try {
      summary = JSON.parse(result.toString().trim());
    } catch (_) {
      summary = { raw: result.toString().trim() };
    }
    res.json({ success: true, summary });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    console.error('Refresh error:', err.message);
    console.error('stderr:', stderr);
    res.status(500).json({
      success: false,
      error: err.message,
      detail: stderr || stdout,
    });
  }
});

const PORT = 8888;
app.listen(PORT, () => {
  console.log(`🤸 OSU Gymnastics 2026 running on http://localhost:${PORT}`);
});
