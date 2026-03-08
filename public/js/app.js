/* ===== OSU Gymnastics 2026 - App ===== */

(function () {
  'use strict';

  let meets = [];
  let currentFilter = 'all';
  let currentView = 'season';
  let _suppressHashPush = false;

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

  function slugifyName(name) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  // ===== Hash Routing =====
  function pushHash(hash) {
    if (_suppressHashPush) return;
    history.pushState(null, '', '#' + hash);
  }

  function readAndRouteHash() {
    const hash = location.hash.replace('#', '');
    if (!hash || hash === 'season') {
      showView('season', true);
      return;
    }
    if (hash.startsWith('meet/')) {
      const meetId = hash.slice(5);
      const m = meets.find(x => x.id === meetId);
      if (m) { showMeetDetail(meetId, true); return; }
    }
    if (hash.startsWith('gymnast/')) {
      const slug = hash.slice(8);
      const profiles = getGymnastProfiles();
      const p = profiles.find(pr => slugifyName(pr.name) === slug);
      if (p) {
        showView('gymnasts', true);
        showGymnastProfile(p.name, true);
        return;
      }
    }
    if (hash.startsWith('leaderboard/')) {
      const event = hash.slice(12);
      showView('leaderboards', true);
      renderLeaderboard(event);
      return;
    }
    if (hash === 'gymnasts') { showView('gymnasts', true); return; }
    if (hash === 'leaderboards') { showView('leaderboards', true); return; }
    showView('season', true);
  }

  window.addEventListener('popstate', () => {
    _suppressHashPush = true;
    readAndRouteHash();
    _suppressHashPush = false;
  });

  // ===== Data Loading =====
  async function loadData() {
    try {
      const res = await fetch('/api/meets');
      meets = await res.json();

      // Set initial lastRefreshed from meet data
      const refreshed = meets.find(m => m.lastRefreshed);
      if (refreshed) {
        lastRefreshedTime = new Date(refreshed.lastRefreshed);
        updateLastUpdatedDisplay();
      }

      document.getElementById('loading').style.display = 'none';

      if (window.OSUSearch) {
        OSUSearch.buildIndex(meets);
        OSUSearch.createUI();
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

      // Route from hash or default to season
      if (location.hash && location.hash !== '#') {
        readAndRouteHash();
      } else {
        showView('season', true);
      }
    } catch (err) {
      document.getElementById('loading').innerHTML =
        '<div class="empty-state"><div class="empty-icon">😕</div><p class="empty-text">Failed to load data. Is the server running?</p></div>';
    }
  }

  // ===== Navigation =====
  function showView(view, skipPush) {
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
      el.offsetHeight;
      el.style.animation = '';
    }

    if (!skipPush) pushHash(view);

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
    const scoredMeets = meets.filter(m => m.osuScore > 0);
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
      const color = meets[i].result === 'W' ? '#2ecc71' : '#e74c3c';
      return `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(s).toFixed(1)}" r="5" fill="${color}" stroke="var(--dark)" stroke-width="2" class="trend-dot" data-meet-id="${meets[i].id}" style="cursor:pointer;">
        <title>${formatDate(meets[i].date)}: ${s.toFixed(3)} (${meets[i].result})</title>
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

    let xLabels = meets.map((m, i) => {
      const x = xScale(i);
      return `<text x="${x}" y="${h - 5}" text-anchor="middle" fill="#999" font-size="9" font-family="Inter" class="trend-dot" data-meet-id="${m.id}" style="cursor:pointer;">${formatDate(m.date)}</text>`;
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

    // Trend dot clicks
    container.querySelectorAll('.trend-dot').forEach(el => {
      el.addEventListener('click', () => showMeetDetail(el.dataset.meetId));
    });
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
      <div class="meet-card" data-meet-id="${m.id}" style="cursor:pointer;">
        <div class="meet-header">
          <div>
            <div class="meet-opponent">${m.opponent} ${getHomeAwayBadge(m.isHome, 'full')}</div>
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
            <div class="meet-opponent" style="font-size:1rem;">${m.opponent} ${getHomeAwayBadge(m.isHome, 'full')}</div>
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
  function showMeetDetail(meetId, skipPush) {
    const meet = meets.find(m => m.id === meetId);
    if (!meet) return;

    if (!skipPush) pushHash('meet/' + meetId);

    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    // Breadcrumb
    const breadcrumb = `
      <nav class="breadcrumb">
        <a href="#" class="breadcrumb-link" data-nav="season">Season</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">${meet.opponent} ${formatDate(meet.date)}</span>
      </nav>`;

    // Quad meet full standings table
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

    // Event detail cards with clickable athlete names and event headers
    const eventCards = ['vault', 'bars', 'beam', 'floor'].map(event => {
      const eventAthletes = meet.athletes
        .filter(a => a.scores[event] !== undefined)
        .sort((a, b) => b.scores[event] - a.scores[event]);

      const rows = eventAthletes.map((a, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><a href="#" class="inline-link gymnast-link" data-gymnast="${a.name}">${a.name}</a></td>
          <td class="score-cell">${a.scores[event].toFixed(3)}</td>
        </tr>`).join('');

      const osuScore = meet.events[event].osu;
      const oppScore = meet.events[event].opponent;
      const barPct = ((osuScore / 50) * 100).toFixed(1);

      return `
        <div class="detail-event-card">
          <div class="detail-event-title">
            <a href="#" class="inline-link event-link" data-event="${event}">${EVENT_NAMES[event]}</a>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
            <a href="#" class="inline-link event-score-link" data-event="${event}" data-score="${osuScore}" style="font-family:Oswald;font-weight:600;color:var(--orange);">${osuScore.toFixed(3)}</a>
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

    // Meet recap section
    let recapSection = '';
    if (meet.recap) {
      const paragraphs = meet.recap.trim().split(/\n\n+/).filter(p => p.trim());
      const lede = paragraphs[0] || '';
      const rest = paragraphs.slice(1);

      // Mobile collapsible: first 3 paragraphs visible, rest hidden
      const visibleParas = paragraphs.slice(0, 3).map(p => `<p>${p.trim()}</p>`).join('');
      const hiddenParas = paragraphs.slice(3).map(p => `<p>${p.trim()}</p>`).join('');

      recapSection = `
        <div class="section-card recap-card">
          <h2 class="section-title">📰 Meet Recap</h2>
          <div class="recap-body">
            <div class="recap-visible">${visibleParas}</div>
            ${hiddenParas ? `
              <div class="recap-hidden" id="recapHidden" style="display:none;">${hiddenParas}</div>
              <button class="recap-toggle" id="recapToggle">Read more ▾</button>
            ` : ''}
          </div>
          <div class="recap-attribution">
            Source: <a href="${meet.recapUrl}" target="_blank" rel="noopener" class="inline-link">Oregon State Athletics</a>
          </div>
        </div>`;
    }

    // Location/home-away filter links
    const locationText = meet.isHome
      ? `<a href="#" class="inline-link location-link" data-filter="home">${meet.location}</a>`
      : `<a href="#" class="inline-link location-link" data-filter="away">${meet.location}</a>`;

    const dateMonth = new Date(meet.date + 'T12:00:00').toLocaleString('en-US', { month: 'long' });

    const content = document.getElementById('meetDetailContent');
    content.innerHTML = `
      ${breadcrumb}
      <div class="detail-hero">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1.5rem;">
              vs <a href="#" class="inline-link opponent-link" data-opponent="${meet.opponent}">${meet.opponent}</a>
              ${meet.isHome ? '<span class="badge badge-home">HOME</span>' : ''}
            </div>
            <div class="meet-date">
              <a href="#" class="inline-link date-link" data-month="${dateMonth}">${formatDateLong(meet.date)}</a>
            </div>
            <div class="meet-location">${locationText}${meet.attendance ? ` • Attendance: ${meet.attendance}` : ''}</div>
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
      ${recapSection}
      <h2 class="section-title" style="margin-bottom:1rem;">Event Breakdown</h2>
      <div class="detail-event-grid">${eventCards}</div>
    `;

    // Wire up breadcrumb
    content.querySelector('.breadcrumb-link[data-nav="season"]').addEventListener('click', e => {
      e.preventDefault();
      showView('season');
    });

    // Wire up gymnast links
    content.querySelectorAll('.gymnast-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showView('gymnasts');
        showGymnastProfile(el.dataset.gymnast);
      });
    });

    // Wire up event links → leaderboard
    content.querySelectorAll('.event-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showView('leaderboards');
        renderLeaderboard(el.dataset.event);
        pushHash('leaderboard/' + el.dataset.event);
      });
    });

    // Wire up event score links → leaderboard
    content.querySelectorAll('.event-score-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showView('leaderboards');
        renderLeaderboard(el.dataset.event);
        pushHash('leaderboard/' + el.dataset.event);
      });
    });

    // Wire up opponent links → filtered season
    content.querySelectorAll('.opponent-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showView('season');
        // Filter by opponent using a custom filter
        filterByOpponent(el.dataset.opponent);
      });
    });

    // Wire up date links → season (no filter change, just scroll)
    content.querySelectorAll('.date-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showView('season');
      });
    });

    // Wire up location links → home/away filter
    content.querySelectorAll('.location-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        currentFilter = el.dataset.filter;
        showView('season');
        document.querySelectorAll('.filter-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === el.dataset.filter);
        });
        renderMeetCards();
      });
    });

    // Wire up recap toggle
    const recapToggle = content.querySelector('#recapToggle');
    const recapHidden = content.querySelector('#recapHidden');
    if (recapToggle && recapHidden) {
      recapToggle.addEventListener('click', () => {
        const expanded = recapHidden.style.display !== 'none';
        recapHidden.style.display = expanded ? 'none' : 'block';
        recapToggle.textContent = expanded ? 'Read more ▾' : 'Read less ▴';
      });
    }

    // Animate bars
    requestAnimationFrame(() => {
      content.querySelectorAll('.event-bar-fill').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
    });
  }

  function filterByOpponent(opponent) {
    const grid = document.getElementById('meetsGrid');
    // Show all meets vs this opponent
    const filtered = meets.filter(m => m.opponent === opponent);

    if (filtered.length === 0) {
      renderMeetCards();
      return;
    }

    // Reset filter UI
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');
    currentFilter = 'all';

    // Show filtered cards with a header
    grid.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0;margin-bottom:0.5rem;">
      Showing all meets vs <strong style="color:var(--text)">${opponent}</strong>
      <a href="#" id="clearOpponentFilter" style="color:var(--orange);margin-left:0.75rem;font-size:0.8rem;">Clear filter</a>
    </div>` + filtered.map(m => renderMeetCard(m)).join('');

    grid.querySelector('#clearOpponentFilter')?.addEventListener('click', e => {
      e.preventDefault();
      renderMeetCards();
    });
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

    Object.values(profiles).forEach(p => {
      p.averages = {};
      p.bests = {};
      p.bestMeets = {};
      p.eventsList = Array.from(p.events);

      ['vault', 'bars', 'beam', 'floor', 'aa'].forEach(event => {
        const scores = p.meets
          .filter(m => m.scores[event] !== undefined)
          .map(m => ({ score: m.scores[event], meetId: m.meetId }));
        if (scores.length > 0) {
          p.averages[event] = scores.reduce((a, b) => a + b.score, 0) / scores.length;
          const best = scores.reduce((a, b) => b.score > a.score ? b : a);
          p.bests[event] = best.score;
          p.bestMeets[event] = best.meetId;
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
        <div class="gymnast-card" data-gymnast="${p.name}" style="cursor:pointer;">
          <div class="gymnast-name">${p.name}</div>
          <div class="gymnast-events">${eventBadges}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">${p.totalMeets} meets</div>
          <div class="gymnast-averages">${avgStats}</div>
        </div>`;
    }).join('');
  }

  function showGymnastProfile(name, skipPush) {
    const profiles = getGymnastProfiles();
    const p = profiles.find(pr => pr.name === name);
    if (!p) return;

    if (!skipPush) pushHash('gymnast/' + slugifyName(name));

    document.getElementById('gymnastCards').style.display = 'none';
    const detail = document.getElementById('gymnastDetail');
    detail.style.display = 'block';

    // Breadcrumb
    const breadcrumb = `
      <nav class="breadcrumb">
        <a href="#" class="breadcrumb-link" data-nav="gymnasts">Gymnasts</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">${p.name}</span>
      </nav>`;

    const statsGrid = ['vault', 'bars', 'beam', 'floor'].map(event => {
      if (!p.averages[event]) return '';
      const pbMeetId = p.bestMeets[event];
      return `
        <div class="profile-stat">
          <div class="stat-value" style="color:var(--orange)">${p.averages[event].toFixed(3)}</div>
          <div class="stat-label">${EVENT_NAMES[event]} Avg</div>
        </div>
        <div class="profile-stat">
          <div class="stat-value">
            <a href="#" class="inline-link pb-link" data-meet-id="${pbMeetId}">${p.bests[event].toFixed(3)}</a> ★
          </div>
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
        return `<td class="${isBest ? 'personal-best' : ''}">
          <a href="#" class="inline-link score-meet-link" data-meet-id="${m.meetId}">${m.scores[e].toFixed(3)}</a>${isBest ? ' <span class="pb-badge" data-meet-id="${m.meetId}">PB</span>' : ''}
        </td>`;
      }).join('');
      const aa = m.scores.aa
        ? `<td><a href="#" class="inline-link score-meet-link" data-meet-id="${m.meetId}">${m.scores.aa.toFixed(3)}</a></td>`
        : '<td style="color:var(--text-muted)">—</td>';
      return `<tr>
        <td>${formatDate(m.date)}</td>
        <td><a href="#" class="inline-link meet-detail-link" data-meet-id="${m.meetId}">${m.opponent}</a></td>
        ${cells}${aa}
      </tr>`;
    }).join('');

    detail.innerHTML = `
      ${breadcrumb}
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

    // Wire back button
    detail.querySelector('#backToGymnasts').addEventListener('click', () => {
      pushHash('gymnasts');
      detail.style.display = 'none';
      document.getElementById('gymnastCards').style.display = 'grid';
    });

    // Wire breadcrumb
    detail.querySelector('.breadcrumb-link[data-nav="gymnasts"]').addEventListener('click', e => {
      e.preventDefault();
      pushHash('gymnasts');
      detail.style.display = 'none';
      document.getElementById('gymnastCards').style.display = 'grid';
    });

    // Wire PB links → meet detail
    detail.querySelectorAll('.pb-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showMeetDetail(el.dataset.meetId);
      });
    });

    // Wire score-meet links → meet detail
    detail.querySelectorAll('.score-meet-link, .meet-detail-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showMeetDetail(el.dataset.meetId);
      });
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

    list.innerHTML = top.map((s, i) => {
      const meet = meets.find(m => m.id === s.meetId);
      const homeAwayBadge = meet ? getHomeAwayBadge(meet.isHome, 'short') : '';
      return `
      <div class="leaderboard-item">
        <div class="lb-rank ${i < 3 ? 'top-3' : ''}">${i + 1}</div>
        <div class="lb-info">
          <div class="lb-name">
            <a href="#" class="inline-link gymnast-lb-link" data-gymnast="${s.name}">${s.name}</a>
          </div>
          <div class="lb-context">
            ${formatDate(s.meetDate)} vs
            <a href="#" class="inline-link meet-lb-link" data-meet-id="${s.meetId}">${s.opponent}</a>
          </div>
        </div>
        <div class="lb-score">${s.score.toFixed(3)}</div>
      </div>`).join('');

    // Wire leaderboard gymnast links
    list.querySelectorAll('.gymnast-lb-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showView('gymnasts');
        showGymnastProfile(el.dataset.gymnast);
      });
    });

    // Wire leaderboard meet links
    list.querySelectorAll('.meet-lb-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showMeetDetail(el.dataset.meetId);
      });
    });
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

    // Meet card click (season view)
    document.getElementById('meetsGrid').addEventListener('click', e => {
      const card = e.target.closest('.meet-card');
      if (card) showMeetDetail(card.dataset.meetId);
    });

    // Back button on meet detail
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

    // Event tabs (leaderboard)
    document.getElementById('eventTabs').addEventListener('click', e => {
      const tab = e.target.closest('.event-tab');
      if (tab) {
        renderLeaderboard(tab.dataset.event);
        pushHash('leaderboard/' + tab.dataset.event);
      }
    });
  });
})();
