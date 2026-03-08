/* ===== OSU Gymnastics 2026 - App ===== */

(function () {
  'use strict';

  let meets = [];
  let currentFilter = 'all';
  let currentView = 'season';

  const EVENT_NAMES = {
    vault: 'Vault', bars: 'Bars', beam: 'Beam', floor: 'Floor', aa: 'All-Around'
  };

  const EVENT_SHORT = {
    vault: 'VT', bars: 'UB', beam: 'BB', floor: 'FX', aa: 'AA'
  };

  // ===== Utility =====
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatDateLong(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ===== Data Loading =====
  async function loadData() {
    try {
      const res = await fetch('/api/meets');
      meets = await res.json();
      document.getElementById('loading').style.display = 'none';

      // Build search index and initialize search UI
      if (window.OSUSearch) {
        OSUSearch.buildIndex(meets);
        OSUSearch.createUI();
        // Wire navigation callbacks
        OSUSearch.onGymnastSelect = function (name) {
          showView('gymnasts');
          showGymnastProfile(name);
        };
        OSUSearch.onMeetSelect = function (meetId) {
          showMeetDetail(meetId);
        };
        OSUSearch.onLeaderboardSelect = function (event) {
          showView('leaderboards');
          renderLeaderboard(event);
        };
        OSUSearch.onFilterSelect = function (filter) {
          showView('season');
          currentFilter = filter;
          document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === filter);
          });
          renderMeetCards();
        };
      }

      showView('season');
    } catch (err) {
      document.getElementById('loading').innerHTML =
        '<div class="empty-state"><div class="empty-icon">😕</div><p class="empty-text">Failed to load data. Is the server running?</p></div>';
    }
  }

  // ===== Navigation =====
  function showView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`[data-view="${view}"]`).forEach(l => l.classList.add('active'));

    const el = document.getElementById(`view-${view}`);
    if (el) {
      el.style.display = 'block';
      el.style.animation = 'none';
      el.offsetHeight; // trigger reflow
      el.style.animation = '';
    }

    if (view === 'season') renderSeason();
    else if (view === 'gymnasts') renderGymnasts();
    else if (view === 'leaderboards') renderLeaderboard('vault');
  }

  // ===== Season Overview =====
  function renderSeason() {
    const wins = meets.filter(m => m.result === 'W').length;
    const losses = meets.filter(m => m.result === 'L').length;
    const avgScore = (meets.reduce((s, m) => s + m.osuScore, 0) / meets.length).toFixed(3);
    const highScore = Math.max(...meets.map(m => m.osuScore)).toFixed(3);

    document.getElementById('seasonRecord').innerHTML = `
      <div class="record-stat"><div class="value">${wins}-${losses}</div><div class="label">Record</div></div>
      <div class="record-stat"><div class="value">${avgScore}</div><div class="label">Avg Score</div></div>
      <div class="record-stat"><div class="value">${highScore}</div><div class="label">Season High</div></div>
    `;

    renderScoreTrend();
    renderMeetCards();
  }

  function renderScoreTrend() {
    const container = document.getElementById('scoreTrend');
    const w = 700, h = 180;
    const pad = { top: 20, right: 20, bottom: 35, left: 50 };
    const scores = meets.map(m => m.osuScore);
    const min = Math.min(...scores) - 0.5;
    const max = Math.max(...scores) + 0.5;
    const xScale = i => pad.left + (i / (scores.length - 1)) * (w - pad.left - pad.right);
    const yScale = v => pad.top + (1 - (v - min) / (max - min)) * (h - pad.top - pad.bottom);

    let pathD = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(s).toFixed(1)}`).join(' ');

    let dots = scores.map((s, i) => {
      const color = meets[i].result === 'W' ? '#2ecc71' : '#e74c3c';
      return `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(s).toFixed(1)}" r="5" fill="${color}" stroke="var(--dark)" stroke-width="2">
        <title>${formatDate(meets[i].date)}: ${s.toFixed(3)} (${meets[i].result})</title>
      </circle>`;
    }).join('');

    // Y-axis labels
    const yTicks = 5;
    let yLabels = '';
    let yGridLines = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = min + (i / yTicks) * (max - min);
      const y = yScale(v);
      yLabels += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#999" font-size="11" font-family="Inter">${v.toFixed(1)}</text>`;
      yGridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
    }

    // X-axis labels
    let xLabels = meets.map((m, i) => {
      const x = xScale(i);
      return `<text x="${x}" y="${h - 5}" text-anchor="middle" fill="#999" font-size="9" font-family="Inter">${formatDate(m.date)}</text>`;
    }).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        ${yGridLines}
        <path d="${pathD}" fill="none" stroke="var(--orange)" stroke-width="2.5" stroke-linejoin="round"/>
        ${dots}
        ${yLabels}
        ${xLabels}
      </svg>
    `;
  }

  function renderMeetCards() {
    const grid = document.getElementById('meetsGrid');
    const filtered = meets.filter(m => {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'home') return m.isHome;
      if (currentFilter === 'away') return !m.isHome;
      return m.result === currentFilter;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">No meets match this filter.</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(m => {
      const eventBars = ['vault', 'bars', 'beam', 'floor'].map(e => {
        const pct = ((m.events[e].osu / 50) * 100).toFixed(1);
        return `
          <div class="event-bar-item">
            <div class="event-bar-label">
              <span>${EVENT_SHORT[e]}</span>
              <span>${m.events[e].osu.toFixed(3)}</span>
            </div>
            <div class="event-bar-track">
              <div class="event-bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>`;
      }).join('');

      return `
        <div class="meet-card" data-meet-id="${m.id}">
          <div class="meet-header">
            <div>
              <div class="meet-opponent">${m.opponent}${m.isHome ? '<span class="badge badge-home">HOME</span>' : ''}</div>
              <div class="meet-date">${formatDateLong(m.date)}</div>
              <div class="meet-location">${m.location}</div>
            </div>
            <span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>
          </div>
          <div class="meet-scores">
            <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu">${m.osuScore.toFixed(3)}</div></div>
            <div class="score-vs">vs</div>
            <div class="team-score"><div class="team-name">Opponent</div><div class="score">${m.opponentScore.toFixed(3)}</div></div>
          </div>
          <div class="event-bars">${eventBars}</div>
        </div>`;
    }).join('');

    // Animate bars after render
    requestAnimationFrame(() => {
      grid.querySelectorAll('.event-bar-fill').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
    });
  }

  // ===== Meet Detail =====
  function showMeetDetail(meetId) {
    const meet = meets.find(m => m.id === meetId);
    if (!meet) return;

    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    const content = document.getElementById('meetDetailContent');

    // Quad meet teams table
    let teamsTable = '';
    if (meet.allTeams) {
      teamsTable = `
        <div class="section-card">
          <h2 class="section-title">Full Standings</h2>
          <table class="all-teams-table">
            <thead><tr><th>Rank</th><th>Team</th><th>VT</th><th>UB</th><th>BB</th><th>FX</th><th>Total</th></tr></thead>
            <tbody>
              ${meet.allTeams.map(t => `
                <tr class="${t.team.toLowerCase().includes('oregon') ? 'osu-row' : ''}">
                  <td>${t.rank}</td><td>${t.team}</td>
                  <td>${t.vault.toFixed(3)}</td><td>${t.bars.toFixed(3)}</td>
                  <td>${t.beam.toFixed(3)}</td><td>${t.floor.toFixed(3)}</td>
                  <td><strong>${t.total.toFixed(3)}</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Event detail cards with athlete lineups
    const eventCards = ['vault', 'bars', 'beam', 'floor'].map(event => {
      const eventAthletes = meet.athletes
        .filter(a => a.scores[event] !== undefined)
        .sort((a, b) => b.scores[event] - a.scores[event]);

      const rows = eventAthletes.map((a, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${a.name}</td>
          <td class="score-cell">${a.scores[event].toFixed(3)}</td>
        </tr>`).join('');

      const osuScore = meet.events[event].osu;
      const oppScore = meet.events[event].opponent;
      const barPct = ((osuScore / 50) * 100).toFixed(1);

      return `
        <div class="detail-event-card">
          <div class="detail-event-title">${EVENT_NAMES[event]}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
            <span style="color:var(--orange);font-family:Oswald;font-weight:600;">${osuScore.toFixed(3)}</span>
            <span style="color:var(--text-muted);font-size:0.85rem;">vs ${oppScore.toFixed(3)}</span>
          </div>
          <div class="event-bar-track" style="margin-bottom:0.75rem;">
            <div class="event-bar-fill" style="width:${barPct}%"></div>
          </div>
          <table class="lineup-table">
            <thead><tr><th>#</th><th>Athlete</th><th style="text-align:right">Score</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" style="color:var(--text-muted)">No data</td></tr>'}</tbody>
          </table>
        </div>`;
    }).join('');

    content.innerHTML = `
      <div class="detail-hero">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1.5rem;">vs ${meet.opponent}</div>
            <div class="meet-date">${formatDateLong(meet.date)}</div>
            <div class="meet-location">${meet.location}${meet.attendance ? ` • Attendance: ${meet.attendance}` : ''}</div>
          </div>
          <span class="badge badge-${meet.result.toLowerCase()}" style="font-size:1rem;padding:0.3rem 0.8rem;">${meet.result}</span>
        </div>
        <div class="meet-scores" style="margin-top:1rem;">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu" style="font-size:2rem;">${meet.osuScore.toFixed(3)}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name">Opponent</div><div class="score" style="font-size:2rem;">${meet.opponentScore.toFixed(3)}</div></div>
        </div>
      </div>
      ${teamsTable}
      <h2 class="section-title" style="margin-bottom:1rem;">Event Breakdown</h2>
      <div class="detail-event-grid">${eventCards}</div>
    `;
  }

  // ===== Gymnasts =====
  function getGymnastProfiles() {
    const profiles = {};
    meets.forEach(meet => {
      meet.athletes.forEach(a => {
        if (!profiles[a.name]) {
          profiles[a.name] = { name: a.name, meets: [], events: new Set() };
        }
        const entry = { meetId: meet.id, date: meet.date, opponent: meet.opponent, scores: { ...a.scores } };
        profiles[a.name].meets.push(entry);
        Object.keys(a.scores).forEach(e => {
          if (e !== 'aa') profiles[a.name].events.add(e);
        });
      });
    });

    // Compute averages and bests
    Object.values(profiles).forEach(p => {
      p.averages = {};
      p.bests = {};
      p.eventsList = Array.from(p.events);

      ['vault', 'bars', 'beam', 'floor', 'aa'].forEach(event => {
        const scores = p.meets
          .filter(m => m.scores[event] !== undefined)
          .map(m => m.scores[event]);
        if (scores.length > 0) {
          p.averages[event] = scores.reduce((a, b) => a + b, 0) / scores.length;
          p.bests[event] = Math.max(...scores);
        }
      });

      p.totalMeets = p.meets.length;
    });

    return Object.values(profiles).sort((a, b) => b.totalMeets - a.totalMeets);
  }

  function renderGymnasts(searchTerm = '') {
    const profiles = getGymnastProfiles();
    const filtered = searchTerm
      ? profiles.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : profiles;

    const detail = document.getElementById('gymnastDetail');
    detail.style.display = 'none';

    const container = document.getElementById('gymnastCards');
    container.style.display = 'grid';

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">No gymnasts found.</p></div>';
      return;
    }

    container.innerHTML = filtered.map(p => {
      const eventBadges = p.eventsList.map(e => `<span class="event-badge">${EVENT_SHORT[e]}</span>`).join('');
      const avgStats = p.eventsList.map(e => {
        if (!p.averages[e]) return '';
        return `<div class="avg-stat"><div class="avg-value">${p.averages[e].toFixed(3)}</div><div class="avg-label">${EVENT_SHORT[e]}</div></div>`;
      }).join('');

      return `
        <div class="gymnast-card" data-gymnast="${p.name}">
          <div class="gymnast-name">${p.name}</div>
          <div class="gymnast-events">${eventBadges}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">${p.totalMeets} meets</div>
          <div class="gymnast-averages">${avgStats}</div>
        </div>`;
    }).join('');
  }

  function showGymnastProfile(name) {
    const profiles = getGymnastProfiles();
    const p = profiles.find(pr => pr.name === name);
    if (!p) return;

    document.getElementById('gymnastCards').style.display = 'none';
    const detail = document.getElementById('gymnastDetail');
    detail.style.display = 'block';

    // Stats grid
    const statsGrid = ['vault', 'bars', 'beam', 'floor'].map(event => {
      if (!p.averages[event]) return '';
      return `
        <div class="profile-stat">
          <div class="stat-value" style="color:var(--orange)">${p.averages[event].toFixed(3)}</div>
          <div class="stat-label">${EVENT_NAMES[event]} Avg</div>
        </div>
        <div class="profile-stat">
          <div class="stat-value">${p.bests[event].toFixed(3)}</div>
          <div class="stat-label">${EVENT_NAMES[event]} Best</div>
        </div>`;
    }).join('');

    // Sparklines per event
    const sparklines = ['vault', 'bars', 'beam', 'floor'].map(event => {
      const eventMeets = p.meets.filter(m => m.scores[event] !== undefined);
      if (eventMeets.length < 2) return '';

      const scores = eventMeets.map(m => m.scores[event]);
      return `
        <div class="sparkline-section">
          <div class="sparkline-title">${EVENT_NAMES[event]} Trend</div>
          <div class="sparkline-container">${createSparkline(scores, eventMeets.map(m => formatDate(m.date)))}</div>
        </div>`;
    }).join('');

    // Meet history table
    const historyRows = p.meets.map(m => {
      const cells = ['vault', 'bars', 'beam', 'floor'].map(e => {
        if (m.scores[e] === undefined) return '<td style="color:var(--text-muted)">—</td>';
        const isBest = p.bests[e] === m.scores[e];
        return `<td class="${isBest ? 'personal-best' : ''}">${m.scores[e].toFixed(3)}${isBest ? ' ★' : ''}</td>`;
      }).join('');
      const aa = m.scores.aa ? `<td>${m.scores.aa.toFixed(3)}</td>` : '<td style="color:var(--text-muted)">—</td>';
      return `<tr><td>${formatDate(m.date)}</td><td>${m.opponent}</td>${cells}${aa}</tr>`;
    }).join('');

    detail.innerHTML = `
      <div class="gymnast-profile">
        <button class="back-btn" id="backToGymnasts">← Back to Gymnasts</button>
        <div class="profile-header">
          <div class="profile-name">${p.name}</div>
          <div style="color:var(--text-muted);margin-top:0.25rem;">${p.totalMeets} meets competed • Oregon State</div>
          <div class="profile-stats-grid">${statsGrid}</div>
        </div>
        ${sparklines}
        <div class="section-card">
          <h2 class="section-title">Meet History</h2>
          <div style="overflow-x:auto;">
            <table class="meet-history-table">
              <thead><tr><th>Date</th><th>Opponent</th><th>VT</th><th>UB</th><th>BB</th><th>FX</th><th>AA</th></tr></thead>
              <tbody>${historyRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    document.getElementById('backToGymnasts').addEventListener('click', () => {
      detail.style.display = 'none';
      document.getElementById('gymnastCards').style.display = 'grid';
    });
  }

  function createSparkline(scores, labels) {
    const w = 400, h = 70;
    const pad = { top: 10, right: 10, bottom: 20, left: 10 };
    const min = Math.min(...scores) - 0.05;
    const max = Math.max(...scores) + 0.05;
    const xScale = i => pad.left + (i / (scores.length - 1)) * (w - pad.left - pad.right);
    const yScale = v => pad.top + (1 - (v - min) / (max - min)) * (h - pad.top - pad.bottom);

    const pathD = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(s).toFixed(1)}`).join(' ');

    const dots = scores.map((s, i) => `
      <circle cx="${xScale(i).toFixed(1)}" cy="${yScale(s).toFixed(1)}" r="4" fill="var(--orange)" stroke="var(--dark)" stroke-width="2">
        <title>${labels[i]}: ${s.toFixed(3)}</title>
      </circle>`).join('');

    const xLabels = scores.map((s, i) => `
      <text x="${xScale(i).toFixed(1)}" y="${h - 2}" text-anchor="middle" fill="#999" font-size="8" font-family="Inter">${labels[i]}</text>`).join('');

    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <path d="${pathD}" fill="none" stroke="var(--orange)" stroke-width="2" opacity="0.6"/>
      ${dots}
      ${xLabels}
    </svg>`;
  }

  // ===== Leaderboards =====
  function renderLeaderboard(event) {
    document.querySelectorAll('.event-tab').forEach(t => t.classList.toggle('active', t.dataset.event === event));

    const allScores = [];
    meets.forEach(meet => {
      meet.athletes.forEach(a => {
        if (a.scores[event] !== undefined) {
          allScores.push({
            name: a.name,
            score: a.scores[event],
            meetDate: meet.date,
            opponent: meet.opponent,
            meetId: meet.id,
          });
        }
      });
    });

    allScores.sort((a, b) => b.score - a.score);
    const top = allScores.slice(0, 25);

    const list = document.getElementById('leaderboardList');
    if (top.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p class="empty-text">No scores available for this event.</p></div>';
      return;
    }

    list.innerHTML = top.map((s, i) => `
      <div class="leaderboard-item">
        <div class="lb-rank ${i < 3 ? 'top-3' : ''}">${i + 1}</div>
        <div class="lb-info">
          <div class="lb-name">${s.name}</div>
          <div class="lb-context">${formatDate(s.meetDate)} vs ${s.opponent}</div>
        </div>
        <div class="lb-score">${s.score.toFixed(3)}</div>
      </div>`).join('');
  }

  // ===== Event Listeners =====
  document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // Navigation
    document.querySelectorAll('[data-view]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        showView(link.dataset.view);
      });
    });

    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderMeetCards();
      });
    });

    // Meet card click
    document.getElementById('meetsGrid').addEventListener('click', e => {
      const card = e.target.closest('.meet-card');
      if (card) showMeetDetail(card.dataset.meetId);
    });

    // Back button
    document.getElementById('backToSeason').addEventListener('click', () => showView('season'));

    // Gymnast search
    document.getElementById('gymnastSearch').addEventListener('input', e => {
      renderGymnasts(e.target.value);
    });

    // Gymnast card click
    document.getElementById('gymnastCards').addEventListener('click', e => {
      const card = e.target.closest('.gymnast-card');
      if (card) showGymnastProfile(card.dataset.gymnast);
    });

    // Event tabs
    document.getElementById('eventTabs').addEventListener('click', e => {
      const tab = e.target.closest('.event-tab');
      if (tab) renderLeaderboard(tab.dataset.event);
    });
  });
})();
