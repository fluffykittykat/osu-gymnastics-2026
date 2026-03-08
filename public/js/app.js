/* ===== OSU Gymnastics 2026 - App ===== */

(function () {
  'use strict';

  let meets = [];
  let photos = {};
  let currentFilter = 'all';
  let currentView = 'season';
  let lastRefreshedTime = null;
  let autoRefreshInterval = null;
  let autoRefreshEnabled = false;

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

  function timeAgo(date) {
    if (!date) return 'never';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function hasLiveMeets() {
    return meets.some(m => m.status === 'in_progress');
  }

  // ===== Toast Notifications =====
  function showToast(message, type = 'default', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ===== Last Updated =====
  function updateLastUpdatedDisplay() {
    const bar = document.getElementById('lastUpdatedBar');
    const text = document.getElementById('lastUpdatedText');
    if (lastRefreshedTime) {
      bar.style.display = '';
      text.textContent = `Last updated: ${timeAgo(lastRefreshedTime)}`;
    }
  }

  // Update the display every 30 seconds
  setInterval(updateLastUpdatedDisplay, 30000);

  // ===== Refresh =====
  async function doRefresh() {
    const btn = document.getElementById('refreshBtn');
    const mobileBtn = document.getElementById('refreshBtnMobile');

    // Set loading state
    btn.disabled = true;
    btn.classList.add('refreshing');
    if (mobileBtn) mobileBtn.classList.add('refreshing');

    const labelEl = btn.querySelector('.refresh-label');
    if (labelEl) labelEl.textContent = 'Refreshing...';

    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        // Re-fetch the meets data
        const meetsRes = await fetch('/api/meets');
        const oldMeets = meets.slice();
        meets = await meetsRes.json();

        lastRefreshedTime = new Date();
        updateLastUpdatedDisplay();

        // Re-render current view
        if (currentView === 'season') renderSeason();
        else if (currentView === 'gymnasts') renderGymnasts();
        else if (currentView === 'leaderboards') renderLeaderboard(document.querySelector('.event-tab.active')?.dataset.event || 'vault');

        // Show appropriate toast
        const summary = data.summary;
        if (summary.meetsInProgress > 0) {
          showToast(`⚡ Live meet in progress — scores updating`, 'live');
        } else if (summary.meetsUpdated > 0) {
          showToast(`✅ Updated — ${summary.meetsUpdated} meet${summary.meetsUpdated > 1 ? 's' : ''} refreshed`, 'success');
        } else {
          showToast('✅ Data is up to date', 'success');
        }

        // Flash updated scores
        highlightChanges(oldMeets, meets);

        // Show/hide auto-refresh based on live meets
        if (hasLiveMeets() && !autoRefreshEnabled) {
          // Auto-refresh is available but not auto-enabled
        }
      } else {
        showToast('❌ Refresh failed — ' + (data.error || 'unknown error'), 'error');
      }
    } catch (err) {
      showToast('❌ Refresh failed — check connection', 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('refreshing');
      if (mobileBtn) mobileBtn.classList.remove('refreshing');
      if (labelEl) labelEl.textContent = 'Refresh';
    }
  }

  function highlightChanges(oldMeets, newMeets) {
    // Brief delay to let DOM render, then flash changed scores
    setTimeout(() => {
      const oldMap = {};
      oldMeets.forEach(m => { oldMap[m.id] = m; });

      newMeets.forEach(m => {
        const old = oldMap[m.id];
        if (old && old.osuScore !== m.osuScore) {
          const card = document.querySelector(`[data-meet-id="${m.id}"]`);
          if (card) {
            const scoreEl = card.querySelector('.score-osu');
            if (scoreEl) scoreEl.classList.add('score-updated');
          }
        }
      });
    }, 100);
  }

  // ===== Auto-Refresh =====
  function toggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled;
    const toggle = document.querySelector('.toggle-switch');
    if (toggle) toggle.classList.toggle('active', autoRefreshEnabled);

    if (autoRefreshEnabled) {
      autoRefreshInterval = setInterval(doRefresh, 60000);
      showToast('🔄 Auto-refresh enabled (every 60s)', 'default');
    } else {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
      showToast('Auto-refresh disabled', 'default');
    }
  }

  // ===== Data Loading =====
  async function loadData() {
    try {
      const [meetsRes, photosRes] = await Promise.all([fetch('/api/meets'), fetch('/api/photos')]);
      meets = await meetsRes.json();
      photos = await photosRes.json();

      // Set initial lastRefreshed from meet data
      const refreshed = meets.find(m => m.lastRefreshed);
      if (refreshed) {
        lastRefreshedTime = new Date(refreshed.lastRefreshed);
        updateLastUpdatedDisplay();
      }

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
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => {
      if (l.dataset.view) l.classList.remove('active');
    });
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
    const scoredMeets = meets.filter(m => m.result === 'W' || m.result === 'L');
    const wins = meets.filter(m => m.result === 'W').length;
    const losses = meets.filter(m => m.result === 'L').length;
    const avgScore = scoredMeets.length > 0
      ? (scoredMeets.reduce((s, m) => s + m.osuScore, 0) / scoredMeets.length).toFixed(3)
      : '—';
    const highScore = scoredMeets.length > 0
      ? Math.max(...scoredMeets.map(m => m.osuScore)).toFixed(3)
      : '—';

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
    // Deduplicate quad meets — one point per competition date
    const seenDates = new Set();
    const scoredMeets = meets.filter(m => {
      if (!m.osuScore || m.osuScore <= 0) return false;
      if (seenDates.has(m.date)) return false;
      seenDates.add(m.date);
      return true;
    });
    if (scoredMeets.length < 2) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Not enough data for trend chart</p>';
      return;
    }

    const w = 700, h = 180;
    const pad = { top: 20, right: 20, bottom: 35, left: 50 };
    const scores = scoredMeets.map(m => m.osuScore);
    const min = Math.min(...scores) - 0.5;
    const max = Math.max(...scores) + 0.5;
    const xScale = i => pad.left + (i / (scores.length - 1)) * (w - pad.left - pad.right);
    const yScale = v => pad.top + (1 - (v - min) / (max - min)) * (h - pad.top - pad.bottom);

    let pathD = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(s).toFixed(1)}`).join(' ');

    let dots = scores.map((s, i) => {
      const meet = scoredMeets[i];
      const color = meet.result === 'W' ? '#2ecc71' : '#e74c3c';
      const isLive = meet.status === 'in_progress';
      return `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(s).toFixed(1)}" r="5" fill="${isLive ? '#ff4444' : color}" stroke="var(--dark)" stroke-width="2"${isLive ? ' class="live-dot"' : ''}>
        <title>${formatDate(meet.date)}: ${s.toFixed(3)} (${meet.result})${isLive ? ' 🔴 LIVE' : ''}</title>
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
    let xLabels = scoredMeets.map((m, i) => {
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

    // Group quad meets together; non-quad meets appear as-is
    const rendered = [];
    const seenQuads = new Set();

    filtered.forEach(m => {
      if (m.quadMeet && m.quadName) {
        if (!seenQuads.has(m.quadName)) {
          seenQuads.add(m.quadName);
          // Gather all matchups for this quad
          const quadMeets = filtered.filter(q => q.quadName === m.quadName);
          rendered.push(renderQuadGroup(quadMeets));
        }
      } else {
        rendered.push(renderMeetCard(m));
      }
    });

    grid.innerHTML = rendered.join('');

    // Animate bars after render
    requestAnimationFrame(() => {
      grid.querySelectorAll('.event-bar-fill').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
    });
  }

  function getStatusBadge(meet) {
    if (meet.status === 'in_progress') {
      return '<span class="badge badge-live">🔴 LIVE</span>';
    }
    if (meet.status === 'upcoming') {
      return '<span class="badge badge-upcoming">UPCOMING</span>';
    }
    return '';
  }

  function renderMeetCard(m) {
    const statusBadge = getStatusBadge(m);
    const resultBadge = m.status !== 'upcoming'
      ? `<span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>`
      : '';

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
      <div class="meet-card${m.status === 'in_progress' ? ' meet-card-live' : ''}" data-meet-id="${m.id}">
        <div class="meet-header">
          <div>
            <div class="meet-opponent">${m.opponent}${m.isHome ? '<span class="badge badge-home">HOME</span>' : ''} ${statusBadge}</div>
            <div class="meet-date">${formatDateLong(m.date)}</div>
            <div class="meet-location">${m.location}</div>
          </div>
          ${resultBadge}
        </div>
        <div class="meet-scores">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu">${m.osuScore.toFixed(3)}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name">Opponent</div><div class="score">${m.opponentScore.toFixed(3)}</div></div>
        </div>
        <div class="event-bars">${eventBars}</div>
      </div>`;
  }

  function renderQuadGroup(quadMeets) {
    const first = quadMeets[0];
    const wins = quadMeets.filter(m => m.result === 'W').length;
    const losses = quadMeets.filter(m => m.result === 'L').length;
    const isLive = quadMeets.some(m => m.status === 'in_progress');
    const liveBadge = isLive ? '<span class="badge badge-live">🔴 LIVE</span>' : '';

    const matchupRows = quadMeets.map(m => `
      <div class="quad-matchup meet-card" data-meet-id="${m.id}" style="margin:0;border-radius:8px;cursor:pointer;">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1rem;">${m.opponent} ${getStatusBadge(m)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span style="font-family:Oswald;color:var(--orange);font-size:1rem;">${m.osuScore.toFixed(3)}</span>
            <span style="color:var(--text-muted);">–</span>
            <span style="font-size:1rem;">${m.opponentScore.toFixed(3)}</span>
            <span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="quad-group" style="border:1px solid ${isLive ? 'rgba(255,68,68,0.5)' : '#333'};border-radius:12px;overflow:hidden;background:var(--card);">
        <div style="background:#1a1a1a;padding:0.75rem 1rem;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-family:Oswald;font-size:1.1rem;color:var(--orange);">${first.quadName}</span>
            <span class="badge" style="background:#333;color:#aaa;margin-left:0.5rem;font-size:0.7rem;">QUAD</span>
            ${liveBadge}
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            <span style="color:#999;font-size:0.8rem;">${formatDate(first.date)} · ${first.location}</span>
            <span style="font-family:Oswald;color:var(--orange);">${wins}–${losses}</span>
          </div>
        </div>
        <div style="padding:0.75rem;display:flex;flex-direction:column;gap:0.5rem;">
          <div style="color:#888;font-size:0.8rem;padding-bottom:0.25rem;">OSU: ${first.osuScore.toFixed(3)}</div>
          ${matchupRows}
        </div>
      </div>`;
  }

  // ===== Meet Detail =====
  let _meetDetailOrigin = 'season';
  function showMeetDetail(meetId) {
    _meetDetailOrigin = currentView;
    const meet = meets.find(m => m.id === meetId);
    if (!meet) return;

    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    const content = document.getElementById('meetDetailContent');

    // Live banner
    let liveBanner = '';
    if (meet.status === 'in_progress') {
      const lastUpdated = meet.lastRefreshed ? timeAgo(new Date(meet.lastRefreshed)) : 'unknown';
      liveBanner = `
        <div class="live-banner">
          <div class="live-banner-text">
            <span class="badge badge-live">🔴 LIVE</span>
            <span>Meet in progress — scores may be partial</span>
            <span class="live-banner-time">Last updated: ${lastUpdated}</span>
          </div>
          <div class="auto-refresh-toggle">
            <span>Auto-refresh</span>
            <div class="toggle-switch${autoRefreshEnabled ? ' active' : ''}" id="autoRefreshToggle"></div>
          </div>
        </div>`;
    }

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
                  <td>${t.rank}</td><td><span class="clickable-team" data-team="${t.team}">${t.team}</span></td>
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
      const osuScore = meet.events[event].osu;
      const oppScore = meet.events[event].opponent;
      const barPct = ((osuScore / 50) * 100).toFixed(1);

      let rows;
      if (meet.lineups && meet.lineups[event] && meet.lineups[event].length > 0) {
        // Render in competition order using lineup data
        const lineup = meet.lineups[event];
        const topScore = Math.max(...lineup.map(e => e.score));
        rows = lineup.map(entry => {
          const isTop = entry.score === topScore;
          return `
            <tr>
              <td style="color:#aaa;font-size:0.75rem;font-family:monospace;width:1.5rem;">${entry.position}</td>
              <td><span class="clickable-name" data-gymnast="${entry.name}">${entry.name}</span></td>
              <td class="score-cell${isTop ? ' score-top' : ''}">${entry.score.toFixed(3)}</td>
            </tr>`;
        }).join('');
      } else {
        // Fallback: sort by score descending (legacy behaviour)
        const eventAthletes = meet.athletes
          .filter(a => a.scores[event] !== undefined);
        rows = eventAthletes.map((a, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><span class="clickable-name" data-gymnast="${a.name}">${a.name}</span></td>
            <td class="score-cell">${a.scores[event].toFixed(3)}</td>
          </tr>`).join('');
      }

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

    const resultBadge = meet.status === 'upcoming'
      ? '<span class="badge badge-upcoming" style="font-size:1rem;padding:0.3rem 0.8rem;">UPCOMING</span>'
      : `<span class="badge badge-${meet.result.toLowerCase()}" style="font-size:1rem;padding:0.3rem 0.8rem;">${meet.result}</span>`;

    content.innerHTML = `
      ${liveBanner}
      <div class="detail-hero">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1.5rem;">vs ${meet.opponent}</div>
            <div class="meet-date">${formatDateLong(meet.date)}</div>
            <div class="meet-location">${meet.location}${meet.attendance ? ` • Attendance: ${meet.attendance}` : ''}</div>
          </div>
          ${resultBadge}
        </div>
        <div class="meet-scores" style="margin-top:1rem;">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu" style="font-size:2rem;">${meet.osuScore.toFixed(3)}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name">Opponent</div><div class="score" style="font-size:2rem;">${meet.opponentScore.toFixed(3)}</div></div>
        </div>
      </div>
      ${teamsTable}
      ${meet.recap ? (() => {
        const paragraphs = meet.recap.split(/\n\n+/).filter(p => p.trim());
        const preview = paragraphs.slice(0, 2).map(p => `<p>${p.trim()}</p>`).join('');
        const rest = paragraphs.slice(2).map(p => `<p>${p.trim()}</p>`).join('');
        return `
        <div class="section-card recap-card">
          <h2 class="section-title">📰 Meet Recap</h2>
          <div class="recap-body">
            <div class="recap-preview">${preview}</div>
            ${rest ? `<div class="recap-full" style="display:none;">${rest}</div>
            <button class="recap-toggle">Read more ▾</button>` : ''}
          </div>
          ${meet.recapUrl ? `<a href="${meet.recapUrl}" target="_blank" class="recap-link">Full recap on osubeavers.com →</a>` : ''}
        </div>`;
      })() : ''}
      <h2 class="section-title" style="margin-bottom:1rem;">Event Breakdown</h2>
      <div class="detail-event-grid">${eventCards}</div>
    `;

    // Bind auto-refresh toggle
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle) {
      toggle.addEventListener('click', toggleAutoRefresh);
    }
  }

  // ===== Gymnasts =====
  function getGymnastProfiles() {
    const profiles = {};
    meets.forEach(meet => {
      meet.athletes.forEach(a => {
        if (!profiles[a.name]) {
          profiles[a.name] = { name: a.name, meets: [], events: new Set() };
        }
        const entry = { meetId: meet.id, date: meet.date, opponent: meet.opponent, isHome: meet.isHome, scores: { ...a.scores } };
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

      p.totalMeets = new Set(p.meets.map(m => m.date)).size;
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

      const photo = photos[p.name];
      const photoHtml = photo
        ? `<img src="${photo}" class="gymnast-headshot" alt="${p.name}" loading="lazy">`
        : `<div class="gymnast-headshot-placeholder">${p.name.split(' ').map(n=>n[0]).join('')}</div>`;
      return `
        <div class="gymnast-card" data-gymnast="${p.name}">
          ${photoHtml}
          <div class="gymnast-name">${p.name}</div>
          <div class="gymnast-events">${eventBadges}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">${p.totalMeets} competition days</div>
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
      const haBadge = m.isHome ? '<span class="badge badge-home" style="font-size:0.65rem;padding:0.1rem 0.4rem;margin-left:0.3rem;">H</span>' : '<span class="badge" style="font-size:0.65rem;padding:0.1rem 0.4rem;margin-left:0.3rem;background:#333;color:#aaa;">A</span>';
      return `<tr><td>${formatDate(m.date)}</td><td><span class="clickable-meet" data-meet-id="${m.meetId}">${m.opponent}</span>${haBadge}</td>${cells}${aa}</tr>`;
    }).join('');

    detail.innerHTML = `
      <div class="gymnast-profile">
        <button class="back-btn" id="backToGymnasts">← Back to Gymnasts</button>
        <div class="profile-header">
          ${photos[p.name] ? `<img src="${photos[p.name]}" class="profile-headshot" alt="${p.name}">` : ''}
          <div class="profile-name">${p.name}</div>
          <div style="color:var(--text-muted);margin-top:0.25rem;">${p.totalMeets} competition days • Oregon State</div>
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

  // ===== Team Stats =====
  function showTeamStats(teamName) {
    const teamMeets = meets.filter(m =>
      m.opponent.toLowerCase().includes(teamName.toLowerCase()) ||
      (m.allTeams && m.allTeams.some(t => t.team.toLowerCase() === teamName.toLowerCase()))
    );
    if (teamMeets.length === 0) return;

    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    const wins = teamMeets.filter(m => m.result === 'W').length;
    const losses = teamMeets.filter(m => m.result === 'L').length;

    const rows = teamMeets.map(m => {
      const teamData = m.allTeams && m.allTeams.find(t => t.team.toLowerCase() === teamName.toLowerCase());
      const oppScore = teamData ? teamData.total.toFixed(3) : m.opponentScore.toFixed(3);
      const result = m.result;
      return `<tr>
        <td>${formatDateLong(m.date)}</td>
        <td><span class="clickable-meet" data-meet-id="${m.id}">${m.quadName || m.opponent}</span></td>
        <td style="color:var(--orange);font-family:Oswald;">${m.osuScore.toFixed(3)}</td>
        <td>${oppScore}</td>
        <td><span class="badge badge-${result.toLowerCase()}">${result}</span></td>
      </tr>`;
    }).join('');

    document.getElementById('meetDetailContent').innerHTML = `
      <div class="detail-hero">
        <button class="back-btn" id="backFromTeam">← Back</button>
        <div class="meet-opponent" style="font-size:1.5rem;margin-top:1rem;">${teamName}</div>
        <div style="color:var(--text-muted);margin-top:0.25rem;">Season record vs ${teamName}: <strong style="color:var(--orange)">${wins}W – ${losses}L</strong></div>
      </div>
      <div class="section-card" style="margin-top:1rem;">
        <h2 class="section-title">Meets vs ${teamName}</h2>
        <div style="overflow-x:auto;">
          <table class="meet-history-table">
            <thead><tr><th>Date</th><th>Meet</th><th>OSU</th><th>${teamName}</th><th>Result</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('backFromTeam').addEventListener('click', () => showView('season'));
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
          <div class="lb-name"><span class="clickable-name" data-gymnast="${s.name}">${s.name}</span></div>
          <div class="lb-context">${formatDate(s.meetDate)} vs <span class="clickable-meet" data-meet-id="${s.meetId}">${s.opponent}</span></div>
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
        if (link.dataset.view) showView(link.dataset.view);
      });
    });

    // Refresh buttons
    document.getElementById('refreshBtn').addEventListener('click', doRefresh);
    const mobileRefresh = document.getElementById('refreshBtnMobile');
    if (mobileRefresh) {
      mobileRefresh.addEventListener('click', e => {
        e.preventDefault();
        doRefresh();
      });
    }

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

    // Back button — returns to wherever the user came from
    document.getElementById('backToSeason').addEventListener('click', () => showView(_meetDetailOrigin));

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

    // Global click delegation for clickable names, meets, teams
    document.addEventListener('click', e => {
      const nameEl = e.target.closest('.clickable-name');
      if (nameEl) {
        e.preventDefault();
        showView('gymnasts');
        showGymnastProfile(nameEl.dataset.gymnast);
        return;
      }
      const meetEl = e.target.closest('.clickable-meet');
      if (meetEl) {
        e.preventDefault();
        showMeetDetail(meetEl.dataset.meetId);
        return;
      }
      const teamEl = e.target.closest('.clickable-team');
      if (teamEl) {
        e.preventDefault();
        showTeamStats(teamEl.dataset.team);
        return;
      }
      const recapToggle = e.target.closest('.recap-toggle');
      if (recapToggle) {
        const full = recapToggle.previousElementSibling;
        const expanded = full.style.display !== 'none';
        full.style.display = expanded ? 'none' : 'block';
        recapToggle.textContent = expanded ? 'Read more ▾' : 'Read less ▴';
        return;
      }
    });
  });
})();
