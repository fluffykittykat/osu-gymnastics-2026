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

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function getMonth(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
  }

  // ===== Hash Routing =====
  function navigate(hash, replace) {
    if (replace) {
      history.replaceState(null, '', '#' + hash);
    } else {
      history.pushState(null, '', '#' + hash);
    }
    routeFromHash();
  }

  function routeFromHash() {
    const hash = location.hash.slice(1) || 'season';
    const [path, queryStr] = hash.split('?');
    const params = new URLSearchParams(queryStr || '');

    if (path === 'season') {
      const filter = params.get('filter');
      if (filter) currentFilter = filter;
      showView('season', true);
    } else if (path.startsWith('meet/')) {
      const meetId = path.slice(5);
      showMeetDetail(meetId, true);
    } else if (path.startsWith('gymnast/')) {
      const slug = path.slice(8);
      showGymnastProfileBySlug(slug, true);
    } else if (path.startsWith('leaderboard/')) {
      const event = path.slice(12);
      showView('leaderboards', true);
      renderLeaderboard(event);
    } else if (path === 'gymnasts') {
      showView('gymnasts', true);
    } else if (path === 'leaderboards') {
      showView('leaderboards', true);
    } else if (path.startsWith('opponent/')) {
      const oppSlug = path.slice(9);
      showOpponentMeets(oppSlug, true);
    } else {
      showView('season', true);
    }
  }

  // ===== Data Loading =====
  async function loadData() {
    try {
      const res = await fetch('/api/meets');
      meets = await res.json();
      document.getElementById('loading').style.display = 'none';
      routeFromHash();
    } catch (err) {
      document.getElementById('loading').innerHTML =
        '<div class="empty-state"><div class="empty-icon">😕</div><p class="empty-text">Failed to load data. Is the server running?</p></div>';
    }
  }

  // ===== Navigation =====
  function showView(view, fromRoute) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`[data-view="${view}"]`).forEach(l => l.classList.add('active'));

    const el = document.getElementById(`view-${view}`);
    if (el) {
      el.style.display = 'block';
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
    }

    if (view === 'season') renderSeason();
    else if (view === 'gymnasts') renderGymnasts();
    else if (view === 'leaderboards') renderLeaderboard('vault');

    if (!fromRoute) {
      navigate(view);
    }
  }

  // ===== Breadcrumbs =====
  function renderBreadcrumbs(crumbs) {
    return `<nav class="breadcrumbs">${crumbs.map((c, i) => {
      if (i === crumbs.length - 1) return `<span class="breadcrumb-current">${c.label}</span>`;
      return `<a href="#${c.hash}" class="breadcrumb-link">${c.label}</a>`;
    }).join('<span class="breadcrumb-sep">›</span>')}</nav>`;
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
    // Deduplicate by date for trend (quad meets share a date/score)
    const seen = new Set();
    const uniqueMeets = meets.filter(m => {
      const key = m.date;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const w = 700, h = 180;
    const pad = { top: 20, right: 20, bottom: 35, left: 50 };
    const scores = uniqueMeets.map(m => m.osuScore);
    const min = Math.min(...scores) - 0.5;
    const max = Math.max(...scores) + 0.5;
    const xScale = i => pad.left + (i / (scores.length - 1)) * (w - pad.left - pad.right);
    const yScale = v => pad.top + (1 - (v - min) / (max - min)) * (h - pad.top - pad.bottom);

    let pathD = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(s).toFixed(1)}`).join(' ');

    let dots = scores.map((s, i) => {
      const color = uniqueMeets[i].result === 'W' ? '#2ecc71' : '#e74c3c';
      return `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(s).toFixed(1)}" r="5" fill="${color}" stroke="var(--dark)" stroke-width="2" style="cursor:pointer" data-meet-id="${uniqueMeets[i].id}">
        <title>${formatDate(uniqueMeets[i].date)}: ${s.toFixed(3)} (${uniqueMeets[i].result})</title>
      </circle>`;
    }).join('');

    let yTicks = 5, yLabels = '', yGridLines = '';
    for (let i = 0; i <= yTicks; i++) {
      const v = min + (i / yTicks) * (max - min);
      const y = yScale(v);
      yLabels += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#999" font-size="11" font-family="Inter">${v.toFixed(1)}</text>`;
      yGridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
    }

    let xLabels = uniqueMeets.map((m, i) => {
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

    // Update filter button active state
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === currentFilter);
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
    const eventBars = ['vault', 'bars', 'beam', 'floor'].map(e => {
      const pct = ((m.events[e].osu / 50) * 100).toFixed(1);
      return `
        <div class="event-bar-item">
          <div class="event-bar-label">
            <span class="event-bar-name clickable" data-event="${e}">${EVENT_SHORT[e]}</span>
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
            <div class="meet-date clickable" data-date="${m.date}">${formatDateLong(m.date)}</div>
            <div class="meet-location clickable" data-location="${m.isHome ? 'home' : 'away'}">${m.location}</div>
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
  }

  function renderQuadGroup(quadMeets) {
    const first = quadMeets[0];
    const wins = quadMeets.filter(m => m.result === 'W').length;
    const losses = quadMeets.filter(m => m.result === 'L').length;

    const matchupRows = quadMeets.map(m => `
      <div class="quad-matchup meet-card" data-meet-id="${m.id}" style="margin:0;border-radius:8px;cursor:pointer;">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1rem;">${m.opponent}</div>
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
      <div class="quad-group" style="border:1px solid #333;border-radius:12px;overflow:hidden;background:var(--card);">
        <div style="background:#1a1a1a;padding:0.75rem 1rem;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-family:Oswald;font-size:1.1rem;color:var(--orange);">${first.quadName}</span>
            <span class="badge" style="background:#333;color:#aaa;margin-left:0.5rem;font-size:0.7rem;">QUAD</span>
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
  function showMeetDetail(meetId, fromRoute) {
    const meet = meets.find(m => m.id === meetId);
    if (!meet) return;

    currentView = 'meet';
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    if (!fromRoute) navigate('meet/' + meetId);

    const content = document.getElementById('meetDetailContent');

    // Breadcrumbs
    const breadcrumbs = renderBreadcrumbs([
      { label: 'Season', hash: 'season' },
      { label: `${meet.opponent} ${formatDate(meet.date)}`, hash: 'meet/' + meetId }
    ]);

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

    // Recap section
    let recapSection = '';
    if (meet.recap) {
      const paragraphs = meet.recap.split('\n\n').filter(p => p.trim());
      const firstPara = paragraphs[0] || '';
      const restParas = paragraphs.slice(1);
      const hasMore = restParas.length > 2;

      recapSection = `
        <div class="section-card recap-card">
          <h2 class="section-title">📰 Meet Recap</h2>
          <div class="recap-body">
            <p class="recap-lede">${firstPara}</p>
            ${restParas.slice(0, 2).map(p => `<p class="recap-text">${p}</p>`).join('')}
            ${hasMore ? `
              <div class="recap-collapsed" id="recapMore" style="display:none;">
                ${restParas.slice(2).map(p => `<p class="recap-text">${p}</p>`).join('')}
              </div>
              <button class="recap-toggle" id="recapToggle">Read more ▾</button>
            ` : ''}
          </div>
          ${meet.recapUrl ? `<div class="recap-attribution"><a href="${meet.recapUrl}" target="_blank" rel="noopener">Source: Oregon State Athletics ↗</a></div>` : ''}
        </div>`;
    }

    // Event detail cards with clickable athlete names and event names
    const eventCards = ['vault', 'bars', 'beam', 'floor'].map(event => {
      const eventAthletes = meet.athletes
        .filter(a => a.scores[event] !== undefined)
        .sort((a, b) => b.scores[event] - a.scores[event]);

      const rows = eventAthletes.map((a, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><a href="#gymnast/${slugify(a.name)}" class="athlete-link">${a.name}</a></td>
          <td class="score-cell">${a.scores[event].toFixed(3)}</td>
        </tr>`).join('');

      const osuScore = meet.events[event].osu;
      const oppScore = meet.events[event].opponent;
      const barPct = ((osuScore / 50) * 100).toFixed(1);

      return `
        <div class="detail-event-card">
          <div class="detail-event-title"><a href="#leaderboard/${event}" class="event-title-link">${EVENT_NAMES[event]}</a></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
            <a href="#leaderboard/${event}" class="score-link" style="color:var(--orange);font-family:Oswald;font-weight:600;">${osuScore.toFixed(3)}</a>
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

    // Opponent link
    const opponentSlug = slugify(meet.opponent);

    content.innerHTML = `
      ${breadcrumbs}
      <div class="detail-hero">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1.5rem;">vs <a href="#opponent/${opponentSlug}" class="opponent-link">${meet.opponent}</a></div>
            <div class="meet-date">${formatDateLong(meet.date)}</div>
            <div class="meet-location">${meet.location}${meet.attendance ? ` • Attendance: ${meet.attendance}` : ''}</div>
          </div>
          <span class="badge badge-${meet.result.toLowerCase()}" style="font-size:1rem;padding:0.3rem 0.8rem;">${meet.result}</span>
        </div>
        <div class="meet-scores" style="margin-top:1rem;">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu" style="font-size:2rem;">${meet.osuScore.toFixed(3)}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name"><a href="#opponent/${opponentSlug}" class="opponent-link">${meet.opponent}</a></div><div class="score" style="font-size:2rem;">${meet.opponentScore.toFixed(3)}</div></div>
        </div>
      </div>
      ${teamsTable}
      ${recapSection}
      <h2 class="section-title" style="margin-bottom:1rem;">Event Breakdown</h2>
      <div class="detail-event-grid">${eventCards}</div>
    `;

    // Recap toggle
    const toggleBtn = document.getElementById('recapToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const more = document.getElementById('recapMore');
        const expanded = more.style.display !== 'none';
        more.style.display = expanded ? 'none' : 'block';
        toggleBtn.textContent = expanded ? 'Read more ▾' : 'Show less ▴';
      });
    }
  }

  // ===== Opponent Meets View =====
  function showOpponentMeets(oppSlug, fromRoute) {
    const oppMeets = meets.filter(m => slugify(m.opponent) === oppSlug);
    if (oppMeets.length === 0) { navigate('season'); return; }

    currentView = 'opponent';
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    if (!fromRoute) navigate('opponent/' + oppSlug);

    const oppName = oppMeets[0].opponent;
    const breadcrumbs = renderBreadcrumbs([
      { label: 'Season', hash: 'season' },
      { label: `vs ${oppName}`, hash: 'opponent/' + oppSlug }
    ]);

    const cards = oppMeets.map(m => renderMeetCard(m)).join('');

    document.getElementById('meetDetailContent').innerHTML = `
      ${breadcrumbs}
      <div class="section-card" style="margin-bottom:1.5rem;">
        <h2 class="section-title">All Meets vs ${oppName}</h2>
        <p style="color:var(--text-muted);font-size:0.9rem;">${oppMeets.length} meet${oppMeets.length > 1 ? 's' : ''} this season</p>
      </div>
      <div class="meets-grid">${cards}</div>
    `;
  }

  // ===== Gymnasts =====
  function getGymnastProfiles() {
    const profiles = {};
    meets.forEach(meet => {
      meet.athletes.forEach(a => {
        if (!profiles[a.name]) {
          profiles[a.name] = { name: a.name, slug: slugify(a.name), meets: [], events: new Set() };
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
        const entries = p.meets.filter(m => m.scores[event] !== undefined);
        const scores = entries.map(m => m.scores[event]);
        if (scores.length > 0) {
          p.averages[event] = scores.reduce((a, b) => a + b, 0) / scores.length;
          p.bests[event] = Math.max(...scores);
          const bestIdx = scores.indexOf(p.bests[event]);
          p.bestMeets[event] = entries[bestIdx].meetId;
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
        <div class="gymnast-card" data-gymnast="${p.name}" data-slug="${p.slug}">
          <div class="gymnast-name">${p.name}</div>
          <div class="gymnast-events">${eventBadges}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">${p.totalMeets} meets</div>
          <div class="gymnast-averages">${avgStats}</div>
        </div>`;
    }).join('');
  }

  function showGymnastProfileBySlug(slug, fromRoute) {
    const profiles = getGymnastProfiles();
    const p = profiles.find(pr => pr.slug === slug);
    if (!p) return;
    showGymnastProfile(p.name, fromRoute);
  }

  function showGymnastProfile(name, fromRoute) {
    const profiles = getGymnastProfiles();
    const p = profiles.find(pr => pr.name === name);
    if (!p) return;

    currentView = 'gymnast';

    if (!fromRoute) navigate('gymnast/' + p.slug);

    // Hide cards, show gymnasts view
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('[data-view="gymnasts"]').forEach(l => l.classList.add('active'));
    document.getElementById('view-gymnasts').style.display = 'block';

    document.getElementById('gymnastCards').style.display = 'none';
    const detail = document.getElementById('gymnastDetail');
    detail.style.display = 'block';

    // Breadcrumbs
    const breadcrumbs = renderBreadcrumbs([
      { label: 'Gymnasts', hash: 'gymnasts' },
      { label: p.name, hash: 'gymnast/' + p.slug }
    ]);

    // Stats grid
    const statsGrid = ['vault', 'bars', 'beam', 'floor'].map(event => {
      if (!p.averages[event]) return '';
      const bestMeetId = p.bestMeets[event];
      return `
        <div class="profile-stat">
          <div class="stat-value" style="color:var(--orange)">${p.averages[event].toFixed(3)}</div>
          <div class="stat-label">${EVENT_NAMES[event]} Avg</div>
        </div>
        <div class="profile-stat">
          <a href="#meet/${bestMeetId}" class="pb-link"><div class="stat-value">${p.bests[event].toFixed(3)} ★</div></a>
          <div class="stat-label">${EVENT_NAMES[event]} Best</div>
        </div>`;
    }).join('');

    // Sparklines
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

    // Meet history table with clickable scores and meet links
    const historyRows = p.meets.map(m => {
      const cells = ['vault', 'bars', 'beam', 'floor'].map(e => {
        if (m.scores[e] === undefined) return '<td style="color:var(--text-muted)">—</td>';
        const isBest = p.bests[e] === m.scores[e];
        return `<td class="${isBest ? 'personal-best' : ''}"><a href="#meet/${m.meetId}" class="score-history-link">${m.scores[e].toFixed(3)}${isBest ? ' ★' : ''}</a></td>`;
      }).join('');
      const aa = m.scores.aa ? `<td><a href="#meet/${m.meetId}" class="score-history-link">${m.scores.aa.toFixed(3)}</a></td>` : '<td style="color:var(--text-muted)">—</td>';
      return `<tr><td><a href="#meet/${m.meetId}" class="score-history-link">${formatDate(m.date)}</a></td><td><a href="#meet/${m.meetId}" class="score-history-link">${m.opponent}</a></td>${cells}${aa}</tr>`;
    }).join('');

    detail.innerHTML = `
      <div class="gymnast-profile">
        ${breadcrumbs}
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
            slug: slugify(a.name),
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
          <a href="#gymnast/${s.slug}" class="lb-name athlete-link">${s.name}</a>
          <a href="#meet/${s.meetId}" class="lb-context">${formatDate(s.meetDate)} vs ${s.opponent}</a>
        </div>
        <div class="lb-score">${s.score.toFixed(3)}</div>
      </div>`).join('');
  }

  // ===== Event Listeners =====
  document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // Hash navigation
    window.addEventListener('popstate', routeFromHash);

    // Navigation links
    document.querySelectorAll('[data-view]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const view = link.dataset.view;
        currentFilter = 'all';
        navigate(view);
      });
    });

    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (currentFilter === 'all') {
          navigate('season', true);
        } else {
          navigate('season?filter=' + currentFilter, true);
        }
        renderMeetCards();
      });
    });

    // Meet card click (delegated)
    document.getElementById('meetsGrid').addEventListener('click', e => {
      // Handle event name clicks on cards
      const eventName = e.target.closest('.event-bar-name');
      if (eventName) {
        e.stopPropagation();
        navigate('leaderboard/' + eventName.dataset.event);
        return;
      }

      const card = e.target.closest('.meet-card');
      if (card) navigate('meet/' + card.dataset.meetId);
    });

    // Score trend chart click
    document.getElementById('scoreTrend').addEventListener('click', e => {
      if (e.target.tagName === 'circle' && e.target.dataset.meetId) {
        navigate('meet/' + e.target.dataset.meetId);
      }
    });

    // Back to season
    document.getElementById('backToSeason').addEventListener('click', () => navigate('season'));

    // Gymnast search
    document.getElementById('gymnastSearch').addEventListener('input', e => {
      renderGymnasts(e.target.value);
    });

    // Gymnast card click
    document.getElementById('gymnastCards').addEventListener('click', e => {
      const card = e.target.closest('.gymnast-card');
      if (card) navigate('gymnast/' + card.dataset.slug);
    });

    // Event tabs
    document.getElementById('eventTabs').addEventListener('click', e => {
      const tab = e.target.closest('.event-tab');
      if (tab) {
        const event = tab.dataset.event;
        navigate('leaderboard/' + event, true);
        renderLeaderboard(event);
      }
    });
  });
})();
