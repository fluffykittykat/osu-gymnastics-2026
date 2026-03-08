const express = require('express');
const path = require('path');
const app = express();

app.use(express.static('public'));

app.get('/api/meets', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'meets.json'));
});

app.get('/healthz', (req, res) => {
  const { name, version } = require('./package.json');
  res.json({ status: 'ok', uptime: process.uptime(), version });
});

const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`🤸 OSU Gymnastics 2026 running on http://localhost:${PORT}`);
});
