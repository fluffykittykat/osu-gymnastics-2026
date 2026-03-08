/* ===== OSU Gymnastics 2026 - App ===== */

(function () {
  'use strict';

  let meets = [];
  let currentFilter = 'all';
  let currentView = 'season';
  let lastRefreshedTime = null;
  let autoRefreshInterval = null;
  let autoRefreshEnabled = false;
  let previousScores = {}; // meetId → osuScore, for flash detection

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

  function timeSinceRefresh() {
    if (!lastRefreshedTime) return null;
    const diffMs = Date.now() - lastRefreshedTime;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin === 1) return '1 minute ago';
    if (diffMin < 60) return `${diffMin} minutes ago`;
    const diffH = Math.floor(diffMin / 60);
    return `${diffH}h ago`;
  }

  function hasLiveMeets() {
    return meets.some(m => m.status === 'in_progress');
  }

  // ===== Toast =====
  function showToast(message, type = 'default', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  // ===== Last Updated Bar =====
  function updateLastUpdatedBar() {
    const bar = document.getElementById('lastUpdatedBar');
    const txt = document.getElementById('lastUpdatedText');
    const autoToggle = document.getElementById('autoRefreshToggle');

    const since = timeSinceRefresh();
    if (since) {
      bar.style.display = 'flex';
      txt.textContent = `Last updated: ${since}`;
    }

    if (hasLiveMeets()) {
      autoToggle.style.display = 'flex';
    } else {
      autoToggle.style.display = 'none';
      // Turn off auto-refresh if no live meets
      if (autoRefreshEnabled) {
        stopAutoRefresh();
        document.getElementById('autoRefreshCheck').checked = false;
      }
    }
  }

  // ===== Auto-Refresh =====
  function startAutoRefresh() {
    autoRefreshEnabled = true;
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
      if (autoRefreshEnabled && hasLiveMeets()) {
        doRefresh(true);
      } else {
        stopAutoRefresh();
      }
    }, 60000);
  }

  function stopAutoRefresh() {
    autoRefreshEnabled = false;
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  // ===== Score snapshot for flash detection =====
  function snapshotScores() {
    previousScores = {};
    meets.forEach(m => {
      previousScores[m.id] = m.osuScore;
    });
  }

  function flashChangedScores() {
    meets.forEach(m => {
      if (previousScores[m.id] !== undefined && previousScores[m.id] !== m.osuScore) {
        // Flash all score elements for this meet
        document.querySelectorAll(`[data-meet-id="${m.id}"] .score-osu`).forEach(el => {
          el.classList.remove('score-updated');
          void el.offsetWidth; // reflow
          el.classList.add('score-updated');
          el.addEventListener('animationend', () => el.classList.remove('score-updated'), { once: true });
        });
      }
    });
  }

  // ===== Refresh =====
  async function doRefresh(silent = false) {
    const btn = document.getElementById('refreshBtn');
    const mobileBtn = document.getElementById('mobileRefreshBtn');

    // Set loading state
    btn.disabled = true;
    btn.classList.add('spinning');
    btn.querySelector('.refresh-label').textContent = 'Refreshing...';

    snapshotScores();

    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        // Reload meets data
        const meetsRes = await fetch('/api/meets');
        const newMeets = await meetsRes.json();
        meets = newMeets;

        lastRefreshedTime = Date.now();
        updateLastUpdatedBar();

        // Re-render current view
        if (currentView === 'season') renderSeason();
        else if (currentView === 'gymnasts') renderGymnasts();
        else if (currentView === 'leaderboards') renderLeaderboard(document.querySelector('.event-tab.active')?.dataset.event || 'vault');

        flashChangedScores();

        if (!silent) {
          const s = data.summary || {};
          const live = s.meetsInProgress > 0;
          if (live) {
            showToast(`⚡ Live meet in progress — scores updating`, 'live');
          } else if (s.meetsUpdated > 0) {
            showToast(`✅ Updated — ${s.meetsUpdated} meet${s.meetsUpdated !== 1 ? 's' : ''} refreshed`, 'success');
          } else {
            showToast('✅ Data is up to date', 'success');
          }
        }
      } else {
        if (!silent) showToast('❌ Refresh failed — check connection', 'error');
        console.error('Refresh failed:', data.error);
      }
    } catch (err) {
      if (!silent) showToast('❌ Refresh failed — check connection', 'error');
      console.error('Refresh error:', err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('spinning');
      btn.querySelector('.refresh-label').textContent = 'Refresh';
    }
  }

  // ===== Data Loading =====
  async function loadData() {
    try {
      const res = await fetch('/api/meets');
      meets = await res.json();
      lastRefreshedTime = Date.now();
      document.getElementById('loading').style.display = 'none';
      showView('season');
      updateLastUpdatedBar();
      // Update "last updated" display every minute
      setInterval(updateLastUpdatedBar, 60000);
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
    const finishedMeets = meets.filter(m => m.result !== null && m.status !== 'upcoming');
    if (finishedMeets.length === 0) {
      document.getElementById('seasonRecord').innerHTML = '<div class="record-stat"><div class="value">—</div><div class="label">No data yet</div></div>';
      renderScoreTrend();
      renderMeetCards();
      return;
    }

    const wins = finishedMeets.filter(m => m.result === 'W').length;
    const losses = finishedMeets.filter(m => m.result === 'L').length;
    const avgScore = (finishedMeets.reduce((s, m) => s + m.osuScore, 0) / finishedMeets.length).toFixed(3);
    const highScore = Math.max(...finishedMeets.map(m => m.osuScore)).toFixed(3);

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
    const scoredMeets = meets.filter(m => m.osuScore > 0 && m.status !== 'upcoming');
    if (scoredMeets.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No scored meets yet.</p>';
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
      const m = scoredMeets[i];
      const color = m.status === 'in_progress' ? '#ff4444' : (m.result === 'W' ? '#2ecc71' : '#e74c3c');
      return `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(s).toFixed(1)}" r="5" fill="${color}" stroke="var(--dark)" stroke-width="2">
        <title>${formatDate(m.date)}: ${s.toFixed(3)} (${m.status === 'in_progress' ? 'IN PROGRESS' : m.result})</title>
      </circle>`;
    }).join('');

    const yTicks = 5;
    let yLabels = '';
    let yGridLines = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = min + (i / yTicks) * (max - min);
      const y = yScale(v);
      yLabels += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#999" font-size="11" font-family="Inter">${v.toFixed(1)}</text>`;
      yGridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
    }

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

    const rendered = [];
    const seenQuads = new Set();

    filtered.forEach(m => {
      if (m.quadMeet && m.quadName) {
        if (!seenQuads.has(m.quadName)) {
          seenQuads.add(m.quadName);
          const quadMeets = filtered.filter(q => q.quadName === m.quadName);
          rendered.push(renderQuadGroup(quadMeets));
        }
      } else {
        rendered.push(renderMeetCard(m));
      }
    });

    grid.innerHTML = rendered.join('');

    requestAnimationFrame(() => {
      grid.querySelectorAll('.event-bar-fill').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
    });
  }

  function renderMeetCard(m) {
    const isLive = m.status === 'in_progress';
    const isUpcoming = m.status === 'upcoming';

    const liveBadge = isLive
      ? `<span class="badge badge-live">🔴 LIVE</span>`
      : '';

    let resultBadge = '';
    if (isUpcoming) {
      resultBadge = `<span class="badge badge-upcoming">UPCOMING</span>`;
    } else if (m.result) {
      resultBadge = `<span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>`;
    }

    const eventBars = !isUpcoming ? ['vault', 'bars', 'beam', 'floor'].map(e => {
      const val = m.events[e]?.osu || 0;
      const pct = ((val / 50) * 100).toFixed(1);
      return `
        <div class="event-bar-item">
          <div class="event-bar-label">
            <span>${EVENT_SHORT[e]}</span>
            <span>${val > 0 ? val.toFixed(3) : '—'}</span>
          </div>
          <div class="event-bar-track">
            <div class="event-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('') : '';

    const scoreSection = !isUpcoming ? `
      <div class="meet-scores">
        <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu">${m.osuScore > 0 ? m.osuScore.toFixed(3) : '—'}</div></div>
        <div class="score-vs">vs</div>
        <div class="team-score"><div class="team-name">Opponent</div><div class="score">${m.opponentScore > 0 ? m.opponentScore.toFixed(3) : '—'}</div></div>
      </div>
      <div class="event-bars">${eventBars}</div>
    ` : `<div style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem;">Scores not yet available</div>`;

    return `
      <div class="meet-card${isUpcoming ? ' upcoming' : ''}" data-meet-id="${m.id}">
        <div class="meet-header">
          <div>
            <div class="meet-opponent">${m.opponent || 'TBD'}${m.isHome ? '<span class="badge badge-home">HOME</span>' : ''} ${liveBadge}</div>
            <div class="meet-date">${formatDateLong(m.date)}</div>
            <div class="meet-location">${m.location}</div>
          </div>
          ${resultBadge}
        </div>
        ${scoreSection}
      </div>`;
  }

  function renderQuadGroup(quadMeets) {
    const first = quadMeets[0];
    const wins = quadMeets.filter(m => m.result === 'W').length;
    const losses = quadMeets.filter(m => m.result === 'L').length;
    const hasLive = quadMeets.some(m => m.status === 'in_progress');

    const matchupRows = quadMeets.map(m => `
      <div class="quad-matchup meet-card" data-meet-id="${m.id}" style="margin:0;border-radius:8px;cursor:pointer;">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1rem;">${m.opponent} ${m.status === 'in_progress' ? '<span class="badge badge-live">🔴 LIVE</span>' : ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span style="font-family:Oswald;color:var(--orange);font-size:1rem;">${m.osuScore > 0 ? m.osuScore.toFixed(3) : '—'}</span>
            <span style="color:var(--text-muted);">–</span>
            <span style="font-size:1rem;">${m.opponentScore > 0 ? m.opponentScore.toFixed(3) : '—'}</span>
            ${m.result ? `<span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>` : ''}
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="quad-group" style="border:1px solid #333;border-radius:12px;overflow:hidden;background:var(--card);">
        <div style="background:#1a1a1a;padding:0.75rem 1rem;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-family:Oswald;font-size:1.1rem;color:var(--orange);">${first.quadName}</span>
            <span class="badge" style="background:#333;color:#aaa;margin-left:0.5rem;font-size:0.7rem;">QUAD</span>
            ${hasLive ? '<span class="badge badge-live" style="margin-left:0.4rem;">🔴 LIVE</span>' : ''}
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            <span style="color:#999;font-size:0.8rem;">${formatDate(first.date)} · ${first.location}</span>
            <span style="font-family:Oswald;color:var(--orange);">${wins}–${losses}</span>
          </div>
        </div>
        <div style="padding:0.75rem;display:flex;flex-direction:column;gap:0.5rem;">
          <div style="color:#888;font-size:0.8rem;padding-bottom:0.25rem;">OSU: ${first.osuScore > 0 ? first.osuScore.toFixed(3) : '—'}</div>
          ${matchupRows}
        </div>
      </div>`;
  }

  // ===== Meet Detail =====
  function showMeetDetail(meetId) {
    const meet = meets.find(m => m.id === meetId);
    if (!meet) return;

    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    const content = document.getElementById('meetDetailContent');
    const isLive = meet.status === 'in_progress';
    const isUpcoming = meet.status === 'upcoming';

    // In-progress banner
    let liveBanner = '';
    if (isLive) {
      const lastUpdated = meet.lastRefreshed
        ? (() => {
            const diffMs = Date.now() - new Date(meet.lastRefreshed).getTime();
            const diffMin = Math.floor(diffMs / 60000);
            return diffMin < 1 ? 'just now' : `${diffMin} min ago`;
          })()
        : 'unknown';
      const completedEvts = meet.completedEvents
        ? `Completed: ${meet.completedEvents.map(e => EVENT_SHORT[e] || e).join(', ')}`
        : '';
      liveBanner = `
        <div class="in-progress-banner">
          🔴 Meet in progress — scores may be partial. Last updated: ${lastUpdated}.
          ${completedEvts ? `<span style="margin-left:0.5rem;opacity:0.8;">${completedEvts}</span>` : ''}
        </div>`;
    }

    // Quad meet teams table
    let teamsTable = '';
    if (meet.allTeams && meet.allTeams.length > 0) {
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

    // Event detail cards
    let eventSection = '';
    if (!isUpcoming && meet.athletes && meet.athletes.length > 0) {
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

        const osuScore = meet.events[event]?.osu || 0;
        const oppScore = meet.events[event]?.opponent || 0;
        const barPct = ((osuScore / 50) * 100).toFixed(1);

        return `
          <div class="detail-event-card">
            <div class="detail-event-title">${EVENT_NAMES[event]}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
              <span style="color:var(--orange);font-family:Oswald;font-weight:600;">${osuScore > 0 ? osuScore.toFixed(3) : '—'}</span>
              <span style="color:var(--text-muted);font-size:0.85rem;">vs ${oppScore > 0 ? oppScore.toFixed(3) : '—'}</span>
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

      eventSection = `
        <h2 class="section-title" style="margin-bottom:1rem;">Event Breakdown</h2>
        <div class="detail-event-grid">${eventCards}</div>
      `;
    }

    const resultBadge = isUpcoming
      ? `<span class="badge badge-upcoming">UPCOMING</span>`
      : (meet.result ? `<span class="badge badge-${meet.result.toLowerCase()}" style="font-size:1rem;padding:0.3rem 0.8rem;">${meet.result}</span>` : '');

    const liveBadgeInline = isLive ? `<span class="badge badge-live" style="margin-left:0.5rem;">🔴 LIVE</span>` : '';

    content.innerHTML = `
      ${liveBanner}
      <div class="detail-hero">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1.5rem;">vs ${meet.opponent || 'TBD'}${liveBadgeInline}</div>
            <div class="meet-date">${formatDateLong(meet.date)}</div>
            <div class="meet-location">${meet.location}${meet.attendance ? ` • Attendance: ${meet.attendance}` : ''}</div>
          </div>
          ${resultBadge}
        </div>
        ${!isUpcoming ? `
        <div class="meet-scores" style="margin-top:1rem;">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu" style="font-size:2rem;">${meet.osuScore > 0 ? meet.osuScore.toFixed(3) : '—'}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name">Opponent</div><div class="score" style="font-size:2rem;">${meet.opponentScore > 0 ? meet.opponentScore.toFixed(3) : '—'}</div></div>
        </div>` : `<div style="color:var(--text-muted);margin-top:1rem;">Scores not yet available</div>`}
      </div>
      ${teamsTable}
      ${eventSection}
    `;
  }

  // ===== Gymnasts =====
  function getGymnastProfiles() {
    const profiles = {};
    meets.forEach(meet => {
      if (!meet.athletes) return;
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

    const historyRows = p.meets.map(m => {
      const cells = ['vault', 'bars', 'beam', 'floor'].map(e => {
        if (m.scores[e] === undefined) return '<td style="color:var(--text-muted)">—</td>';
        const isBest = p.bests[e] === m.scores[e];
        return `<td class="${isBest ? 'personal-best' : ''}">${m.scores[e].toFixed(3)}${isBest ? ' ★' : ''}</td>`;
      }).join('');
      const aa = m.scores.aa ? `<td>${m.scores.aa.toFixed(3)}</td>` : '<td style="color:var(--text-muted)">—</td>';
      return `<tr><td>${formatDate(m.date)}</td><td>${m.opponent || '—'}</td>${cells}${aa}</tr>`;
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
      if (!meet.athletes) return;
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
          <div class="lb-context">${formatDate(s.meetDate)} vs ${s.opponent || '—'}</div>
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
        const view = link.dataset.view;
        if (view) showView(view);
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

    // Refresh button (desktop)
    document.getElementById('refreshBtn').addEventListener('click', () => doRefresh(false));

    // Refresh button (mobile)
    document.getElementById('mobileRefreshBtn').addEventListener('click', e => {
      e.preventDefault();
      doRefresh(false);
    });

    // Auto-refresh toggle
    document.getElementById('autoRefreshCheck').addEventListener('change', e => {
      if (e.target.checked) {
        startAutoRefresh();
        showToast('⚡ Auto-refresh enabled — updating every 60s', 'live', 3000);
      } else {
        stopAutoRefresh();
        showToast('Auto-refresh disabled', 'default', 2000);
      }
    });
  });
})();
