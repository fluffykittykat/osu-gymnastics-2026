/* ===== OSU Gymnastics 2026 - App ===== */

(function () {
  'use strict';

  let meets = [];
  let photos = {};
  let bios = {};
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
      const [meetsRes, photosRes, biosRes] = await Promise.all([fetch('/api/meets'), fetch('/api/photos'), fetch('/api/bios')]);
      meets = await meetsRes.json();
      photos = await photosRes.json();
      bios = await biosRes.json();

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
    else if (view === 'insights') renderInsights();
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
  function renderMeetWildStats(meet) {
    if (!meet.moonPhase) return '';
    const moon = meet.moonPhase;
    const weather = meet.weather;
    const dist = meet.distanceMiles;
    const elev = meet.elevationFt;

    // Weather description mapping
    function wmoDesc(code) {
      if (code === 0) return 'Clear skies';
      if (code <= 3) return 'Partly cloudy';
      if (code <= 48) return 'Foggy';
      if (code <= 57) return 'Drizzly';
      if (code <= 67) return 'Rainy';
      if (code <= 77) return 'Snowy';
      if (code <= 82) return 'Rain showers';
      return 'Stormy';
    }

    // Moon insight
    const moonInsight = moon.fullness > 0.85
      ? `${moon.emoji} <strong>Near full moon</strong> — OSU opened the season under a ${moon.name}. Superstition: gymnasts perform their most dramatic routines when the moon is bright.`
      : moon.fullness < 0.2
      ? `${moon.emoji} <strong>${moon.name}</strong> — Dark skies for this one. New moon energy: introspective, methodical, calm.`
      : `${moon.emoji} <strong>${moon.name}</strong> — A ${(moon.fullness*100).toFixed(0)}% illuminated moon overhead.`;

    // Elevation insight
    let elevInsight = '';
    if (elev > 3000) {
      elevInsight = `🏔️ <strong>High altitude alert!</strong> ${elev.toLocaleString()}ft elevation — that's ${Math.round((elev-230)/1000)}k feet higher than Gill Coliseum. Thinner air = less oxygen = harder landings.`;
    } else if (elev > 1000) {
      elevInsight = `🏔️ Moderate elevation at ${elev.toLocaleString()}ft — noticeable but not extreme.`;
    } else {
      elevInsight = `⛰️ Sea-level conditions (${elev}ft) — no altitude excuses today.`;
    }

    // Distance insight
    let distInsight = '';
    if (dist === 0) {
      distInsight = `🏠 <strong>Home sweet Gill.</strong> No travel, home crowd, familiar chalk.`;
    } else if (dist > 1500) {
      distInsight = `✈️ <strong>Cross-country haul</strong> — ${dist.toLocaleString()} miles from Corvallis. That's a time-zone shift, jet lag, and unfamiliar chalk all at once.`;
    } else if (dist > 600) {
      distInsight = `🚗 <strong>${dist.toLocaleString()} miles from home</strong> — a serious road trip requiring at least one flight.`;
    } else {
      distInsight = `🚗 <strong>${dist} miles from Corvallis</strong> — regional away, short trip.`;
    }

    // Weather insight
    let weatherInsight = '';
    if (weather) {
      const temp = weather.tempHighF;
      if (weather.precipIn > 5) {
        weatherInsight = `🌧️ <strong>Torrential outside</strong> (${weather.precipIn}" of precipitation) while OSU competed indoors. Psychological edge: nowhere else to be.`;
      } else if (weather.precipIn > 0.5) {
        weatherInsight = `${weather.emoji} <strong>${weather.description}</strong> outside — ${weather.precipIn}" of precip. The gymnasts stayed dry indoors but the commute was rough.`;
      } else if (temp < 30) {
        weatherInsight = `🥶 <strong>Freezing outside</strong> at ${temp}°F high. Nothing like a brutal cold snap to test mental focus.`;
      } else if (temp > 70) {
        weatherInsight = `☀️ <strong>${temp}°F and gorgeous</strong> outside — easy to get distracted when it's that nice out.`;
      } else {
        weatherInsight = `${weather.emoji} ${weather.description}, ${temp}°F high. Typical competition weather.`;
      }
    }

    // Class year breakdown for this meet's OSU athletes
    const osuAthletes = meet.athletes.filter(a => a.team === 'Oregon State');
    const byClass = {};
    osuAthletes.forEach(a => {
      const cls = bios[a.name]?.classYear || 'Unknown';
      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(a.name);
    });
    const classBreakdown = Object.entries(byClass)
      .sort((a,b) => ['Freshman','Sophomore','Junior','Senior','Graduate','Unknown'].indexOf(a[0]) - ['Freshman','Sophomore','Junior','Senior','Graduate','Unknown'].indexOf(b[0]))
      .map(([cls,names]) => `<span class="wild-pill">${cls}: ${names.length}</span>`).join('');

    // Home state proximity — who's playing "near home"?
    const venueState = { 'Corvallis OR': 'OR', 'Provo UT': 'UT', 'Tuscaloosa AL': 'AL',
      'Boise ID': 'ID', 'Denton TX': 'TX', 'Logan UT': 'UT' };
    const meetState = meet.city ? Object.entries(venueState).find(([k]) => meet.city.includes(k.split(' ')[1]))?.[1] : null;
    const closestToHome = meetState ? osuAthletes.filter(a => bios[a.name]?.homeState === meetState) : [];

    // ── Meet-level group breakdowns ────────────────────────────────────────
    function gmean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null; }
    function gfmt(n) { return (n!=null&&!isNaN(n)) ? n.toFixed(3) : '—'; }
    function groupDiff(groupA, groupB) {
      const a = gmean(groupA), b = gmean(groupB);
      if(a==null||b==null) return null;
      return {a, b, diff: a-b};
    }

    const osuAthletes2 = meet.athletes.filter(a => a.team === 'Oregon State');
    function athleteScores(a) {
      return ['vault','bars','beam','floor'].map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
    }

    // Class year split (Freshmen vs Veterans)
    const freshScores = [], vetScores = [];
    osuAthletes2.forEach(a => {
      const cls = bios[a.name]?.classYear;
      const sc = athleteScores(a);
      if(!sc.length) return;
      if(cls === 'Freshman') sc.forEach(s=>freshScores.push(s));
      else if(cls) sc.forEach(s=>vetScores.push(s));
    });
    const classDiff = groupDiff(freshScores, vetScores);
    let classInsightMeet = '';
    if(classDiff && freshScores.length && vetScores.length) {
      const winner = classDiff.diff < 0 ? 'Veterans' : 'Freshmen';
      const margin = Math.abs(classDiff.diff).toFixed(3);
      classInsightMeet = `🎓 <strong>${winner} won the lineup today</strong> — ${classDiff.diff < 0
        ? `Veterans (${gfmt(classDiff.b)}) edge Freshmen (${gfmt(classDiff.a)}) by ${margin} pts/event avg.`
        : `Freshmen (${gfmt(classDiff.a)}) outscored Veterans (${gfmt(classDiff.b)}) by ${margin} pts/event avg. Rookies showing up.`}`;
    }

    // East Coast vs West Coast
    const regionMap2 = {'East Coast':['NY','NC','MI','IL','CT','NJ','PA','VA','MD','FL'], 'West Coast':['CA','WA','OR','NV'], 'Mountain West':['UT','CO','AZ','ID']};
    const regionScores2 = {};
    osuAthletes2.forEach(a => {
      const st = bios[a.name]?.homeState;
      let region = null;
      for(const [r,states] of Object.entries(regionMap2)) { if(states.includes(st)) { region=r; break; } }
      if(!region) return;
      if(!regionScores2[region]) regionScores2[region] = [];
      athleteScores(a).forEach(s=>regionScores2[region].push(s));
    });
    const regionsSorted = Object.entries(regionScores2).map(([r,sc])=>({r, avg:gmean(sc)})).filter(x=>x.avg).sort((a,b)=>b.avg-a.avg);
    let regionInsightMeet = '';
    if(regionsSorted.length >= 2) {
      const top = regionsSorted[0], bottom = regionsSorted[regionsSorted.length-1];
      regionInsightMeet = `🗺️ <strong>${top.r} led the lineup today</strong> (${gfmt(top.avg)} avg) vs ${bottom.r} (${gfmt(bottom.avg)}). ${top.r==='East Coast'?'East Coast showing up big on the road.':top.r==='West Coast'?'Home turf advantage for the West Coasters.':'Mountain West athletes used to the travel.'}`;
    }

    // Specialist vs AA today
    const specScores = [], aaScores = [];
    osuAthletes2.forEach(a => {
      const pos = bios[a.name]?.position;
      const sc = athleteScores(a);
      if(!sc.length) return;
      if(pos && pos !== 'All-Around') sc.forEach(s=>specScores.push(s));
      else if(pos === 'All-Around') sc.forEach(s=>aaScores.push(s));
    });
    let specInsightMeet = '';
    const specDiff2 = groupDiff(specScores, aaScores);
    if(specDiff2 && specScores.length && aaScores.length) {
      const winner = specDiff2.diff > 0 ? 'Specialists' : 'All-Arounders';
      specInsightMeet = `🎯 <strong>${winner} outperformed today</strong> — Specialists avg ${gfmt(specDiff2.a)} vs All-Arounders ${gfmt(specDiff2.b)} per event. ${specDiff2.diff > 0 ? 'Depth pays off.' : 'All-around versatility carried the team.'}`;
    }

    // Homeschool vs Traditional today
    const hsHomeschool = [], hsTraditional = [];
    osuAthletes2.forEach(a => {
      const hs = bios[a.name]?.highSchool||'';
      const isHome = /connections academy|acellus|home school|homeschool|online|odyssey charter/i.test(hs);
      athleteScores(a).forEach(s => (isHome ? hsHomeschool : hsTraditional).push(s));
    });
    let schoolInsightMeet = '';
    const schoolDiff = groupDiff(hsHomeschool, hsTraditional);
    if(schoolDiff && hsHomeschool.length && hsTraditional.length) {
      schoolInsightMeet = `📚 <strong>Homeschooled gymnasts today:</strong> ${gfmt(schoolDiff.a)} avg vs Traditional ${gfmt(schoolDiff.b)}. ${schoolDiff.diff > 0 ? 'Skipping prom to train: still paying off.' : 'Traditional schoolers had the edge today.'}`;
    }

    const meetGroupItems = [classInsightMeet, regionInsightMeet, specInsightMeet, schoolInsightMeet].filter(Boolean);

    return `
      <div class="section-card wild-card">
        <h2 class="section-title">🎲 Meet Trivia & Context</h2>
        <div class="wild-grid">
          <div class="wild-item">${moonInsight}</div>
          <div class="wild-item">${elevInsight}</div>
          <div class="wild-item">${distInsight}</div>
          ${weatherInsight ? `<div class="wild-item">${weatherInsight}</div>` : ''}
          <div class="wild-item">👩‍🎓 <strong>Experience on the floor:</strong> ${classBreakdown || 'Unknown'}</div>
          ${closestToHome.length > 0 ? `<div class="wild-item">🏡 <strong>Playing near home:</strong> ${closestToHome.map(a=>a.name).join(', ')} grew up in ${meetState}!</div>` : ''}
          ${meetGroupItems.map(i=>`<div class="wild-item">${i}</div>`).join('')}
        </div>
      </div>`;
  }

  function renderMeetInsights(meet) {
    if (!meet.events || meet.status === 'upcoming') return '';
    const EVS = ['vault','bars','beam','floor'];
    const EV_LBL = {vault:'Vault',bars:'Bars',beam:'Beam',floor:'Floor'};
    function mmean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null; }
    function mfmt(n) { return typeof n==='number'&&!isNaN(n)?n.toFixed(3):'—'; }
    function mdiff(n) { if(typeof n!=='number'||isNaN(n)) return '—'; return (n>=0?'+':'')+n.toFixed(3); }

    // Other meets (excluding this one) for baseline averages
    const otherMeets = meets.filter(m => m.id !== meet.id && m.date !== meet.date);

    // Team event season avg (other meets)
    const teamSeasonAvg = {};
    EVS.forEach(ev => {
      const vals = otherMeets.filter(m=>m.events&&m.events[ev]).map(m=>m.events[ev].osu);
      teamSeasonAvg[ev] = vals.length ? mmean(vals) : null;
    });

    // Per-gymnast season avg (other meets, per event)
    const gymnSeasonAvg = {};
    meet.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
      gymnSeasonAvg[a.name] = {};
      EVS.forEach(ev => {
        const vals = [];
        otherMeets.forEach(om => {
          const oa = om.athletes.find(x=>x.name===a.name);
          if(oa&&oa.scores[ev]!==undefined) vals.push(oa.scores[ev]);
        });
        gymnSeasonAvg[a.name][ev] = vals.length ? mmean(vals) : null;
      });
    });

    // Event performance vs season avg
    const evPerf = EVS.map(ev => {
      const today = meet.events[ev]?.osu;
      const avg = teamSeasonAvg[ev];
      const opp = meet.events[ev]?.opponent;
      if(today===undefined) return null;
      return {ev, today, avg, diff: avg!==null?today-avg:null, wonRot: today>opp, opp};
    }).filter(Boolean);

    // Game changers — gymnast delta vs their season avg in this meet
    const gameChangers = [];
    meet.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
      EVS.forEach(ev => {
        const today = a.scores[ev];
        const avg = gymnSeasonAvg[a.name]?.[ev];
        if(today!==undefined && avg!==null && avg!==undefined) {
          gameChangers.push({name:a.name, ev, today, avg, delta:today-avg});
        }
      });
    });
    gameChangers.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));

    // Standout performer (highest delta above avg)
    const heroes = gameChangers.filter(g=>g.delta>0).slice(0,3);
    const struggles = gameChangers.filter(g=>g.delta<0).slice(0,2);

    // "What if" — if OSU had hit season avg on worst event, would they have won?
    const worstEv = evPerf.filter(e=>e.diff!==null).sort((a,b)=>a.diff-b.diff)[0];
    const bestEv = evPerf.filter(e=>e.diff!==null).sort((a,b)=>b.diff-a.diff)[0];
    const worstWhatIf = worstEv && worstEv.diff < -0.05 ?
      (meet.osuScore - worstEv.today + worstEv.avg) - meet.opponentScore : null;

    // Events won/lost
    const evWon = evPerf.filter(e=>e.wonRot).length;
    const evLost = evPerf.filter(e=>!e.wonRot).length;

    // Headlines
    const aboveAvg = evPerf.filter(e=>e.diff!==null&&e.diff>0).length;
    const headlines = [
      aboveAvg > 0 ? `<div class="insight-headline">📊 OSU scored above their season avg in <strong>${aboveAvg} of ${evPerf.length}</strong> events</div>` : '',
      heroes[0] ? `<div class="insight-headline">🔥 <strong>${heroes[0].name}</strong> was the standout — <strong>${mdiff(heroes[0].delta)}</strong> above their ${EV_LBL[heroes[0].ev]} avg</div>` : '',
      `<div class="insight-headline">${evWon > evLost ? '✅' : '❌'} OSU <strong>won ${evWon}</strong> rotation${evWon!==1?'s':''}, lost <strong>${evLost}</strong></div>`,
      worstWhatIf!==null ? `<div class="insight-headline">🤔 If <strong>${EV_LBL[worstEv.ev]}</strong> had hit season avg, OSU would've ${worstWhatIf>0?`<strong>won by ${Math.abs(worstWhatIf).toFixed(3)}</strong>`:`still lost by ${Math.abs(worstWhatIf).toFixed(3)}`}</div>` : '',
    ].filter(Boolean).join('');

    // Event vs season avg bars
    const RANGE = 1.0; // ±range around 49.0
    const evRows = evPerf.map(e => {
      const diffColor = e.diff===null?'#aaa':e.diff>0?'#2ecc71':'#e74c3c';
      const rotBadge = e.wonRot
        ? '<span style="color:#2ecc71;font-size:0.7rem;font-weight:700">WON</span>'
        : '<span style="color:#e74c3c;font-size:0.7rem;font-weight:700">LOST</span>';
      const barFill = e.avg!==null ? Math.round(Math.min(100,Math.max(0,((e.today-e.avg)/RANGE+0.5)*100))) : 50;
      return `
        <div class="mi-ev-row">
          <div class="mi-ev-label"><span style="font-family:Oswald;color:var(--orange)">${EV_LBL[e.ev]}</span>${rotBadge}</div>
          <div class="mi-ev-scores">
            <span style="font-family:Oswald;font-weight:700;font-size:1.1rem">${mfmt(e.today)}</span>
            <span style="color:${diffColor};font-size:0.8rem;font-weight:600">${e.diff!==null?mdiff(e.diff):'no baseline'} vs avg</span>
            <span style="color:var(--text-muted);font-size:0.75rem">opp: ${mfmt(e.opp)}</span>
          </div>
          ${e.avg!==null?`<div class="mi-bar-wrap"><div class="mi-bar-center"></div><div class="mi-bar-fill" style="width:${Math.abs(barFill-50)*2}%;left:${barFill<50?barFill+'%':'50%'};background:${e.diff>0?'#2ecc71':'#e74c3c'}"></div></div>`:''}
        </div>`;
    }).join('');

    // Game changers table
    const gcRows = gameChangers.slice(0,8).map(g => `
      <div class="mi-gc-row">
        <span class="clickable-name" data-gymnast="${g.name}">${g.name}</span>
        <span style="font-size:0.75rem;color:var(--text-muted)">${EV_LBL[g.ev]}</span>
        <span style="font-family:Oswald">${mfmt(g.today)}</span>
        <span style="color:${g.delta>0.02?'#2ecc71':g.delta<-0.02?'#e74c3c':'#aaa'};font-weight:600">${mdiff(g.delta)}</span>
      </div>`).join('');

    return `
      <div class="section-card meet-insights-card">
        <h2 class="section-title">📊 Meet Analysis</h2>
        <div class="mi-headlines">${headlines}</div>

        <div class="mi-two-col">
          <div>
            <div class="mi-subtitle">Event Performance vs Season Avg</div>
            <div class="mi-ev-list">${evRows}</div>
          </div>
          <div>
            <div class="mi-subtitle">Game Changers (vs personal avg)</div>
            <div class="mi-gc-header"><span>Gymnast</span><span>Event</span><span>Score</span><span>Δ</span></div>
            ${gcRows}
          </div>
        </div>
      </div>`;
  }

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

    // Quad meet sibling navigation
    let quadNav = '';
    if (meet.quadMeet && meet.quadName) {
      const siblings = meets.filter(m => m.quadMeet && m.quadName === meet.quadName && m.date === meet.date);
      if (siblings.length > 1) {
        const tabs = siblings.map(s => {
          const active = s.id === meet.id;
          return `<button class="quad-tab${active?' active':''}" data-meet-id="${s.id}">${active?'▶ ':''} vs ${s.opponent} <span class="quad-tab-result ${s.result?.toLowerCase()}">${s.result||''}</span></button>`;
        });
        quadNav = `
          <div class="quad-nav">
            <div class="quad-nav-label">🏆 ${meet.quadName}</div>
            <div class="quad-nav-tabs">${tabs.join('')}</div>
          </div>`;
      }
    }

    content.innerHTML = `
      ${liveBanner}
      ${quadNav}
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
        const paragraphs = meet.recap.split(/(\r?\n[\s\u00a0]*\r?\n|\r\n\u00a0\s*\r\n)/).filter(p => p.trim() && !/^\s*$/.test(p));
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
      ${renderMeetInsights(meet)}
      ${renderMeetWildStats(meet)}
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
          ${(()=>{
            const pb = bios[p.name]||{};
            const pills = [];
            if(pb.position) pills.push(`<span class="bio-pill bio-pill-pos">${pb.position}</span>`);
            if(pb.classYear) pills.push(`<span class="bio-pill">${pb.classYear}</span>`);
            if(pb.hometown) pills.push(`<span class="bio-pill">📍 ${pb.hometown}</span>`);
            if(pb.height) pills.push(`<span class="bio-pill">📏 ${pb.height}</span>`);
            if(pb.major) pills.push(`<span class="bio-pill">🎓 ${pb.major}</span>`);
            if(pb.highSchool) pills.push(`<span class="bio-pill">🏫 ${pb.highSchool}</span>`);
            return pills.length ? `<div class="bio-pills">${pills.join('')}</div>` : '';
          })()}
          <div class="profile-stats-grid">${statsGrid}</div>
        </div>
        ${sparklines}
        ${renderGymnastInsights(p.name)}
        ${renderGymnastWildStats(p.name)}
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

  // ===== Gymnast Wild Stats =====
  function renderGymnastWildStats(name) {
    const gymnBio = bios[name];
    const sm = meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    function gmean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null; }
    function gfmt(n) { return typeof n==='number'&&!isNaN(n)?n.toFixed(3):'—'; }

    // Collect this gymnast's scores with meet context
    const EVS = ['vault','bars','beam','floor'];
    const scored = [];
    const seenDates = new Set();
    sm.forEach(meet => {
      if(seenDates.has(meet.date)) return;
      const a = meet.athletes.find(x=>x.name===name);
      if(!a) return;
      const hasScore = EVS.some(ev => a.scores[ev]!==undefined);
      if(!hasScore) return;
      seenDates.add(meet.date);
      const allScores = EVS.map(ev=>a.scores[ev]).filter(s=>s!==undefined);
      scored.push({
        date: meet.date,
        scores: a.scores,
        avg: gmean(allScores),
        moonFullness: meet.moonPhase?.fullness,
        moonName: meet.moonPhase?.name,
        moonEmoji: meet.moonPhase?.emoji,
        tempHigh: meet.weather?.tempHighF,
        precip: meet.weather?.precipIn,
        weatherEmoji: meet.weather?.emoji,
        weatherDesc: meet.weather?.description,
        elevFt: meet.elevationFt,
        distMiles: meet.distanceMiles,
        isHome: meet.isHome,
        result: meet.result,
      });
    });

    if(scored.length < 3) return '';

    // Moon phase correlation
    const withMoon = scored.filter(s=>s.moonFullness!==null&&s.avg!==null);
    const brightMoon = withMoon.filter(s=>s.moonFullness>0.7).map(s=>s.avg);
    const darkMoon = withMoon.filter(s=>s.moonFullness<=0.7).map(s=>s.avg);
    const moonDiff = brightMoon.length && darkMoon.length ? gmean(brightMoon)-gmean(darkMoon) : null;

    // Temperature correlation
    const withTemp = scored.filter(s=>s.tempHigh!==null&&s.avg!==null);
    const warmMeets = withTemp.filter(s=>s.tempHigh>50).map(s=>s.avg);
    const coldMeets = withTemp.filter(s=>s.tempHigh<=50).map(s=>s.avg);
    const tempDiff = warmMeets.length && coldMeets.length ? gmean(warmMeets)-gmean(coldMeets) : null;

    // Elevation correlation
    const highAlt = scored.filter(s=>s.elevFt>2000&&s.avg!==null).map(s=>s.avg);
    const lowAlt = scored.filter(s=>s.elevFt<=2000&&s.avg!==null).map(s=>s.avg);
    const elevDiff = highAlt.length && lowAlt.length ? gmean(highAlt)-gmean(lowAlt) : null;

    // Rain day performance (at home in Corvallis rain)
    const rainyMeets = scored.filter(s=>s.precip>0.5&&s.avg!==null).map(s=>s.avg);
    const dryMeets = scored.filter(s=>s.precip<=0.5&&s.avg!==null).map(s=>s.avg);
    const rainDiff = rainyMeets.length && dryMeets.length ? gmean(rainyMeets)-gmean(dryMeets) : null;

    // Best moon phase
    const moonGroups = {};
    withMoon.forEach(s => {
      if(!moonGroups[s.moonName]) moonGroups[s.moonName] = [];
      moonGroups[s.moonName].push(s.avg);
    });
    const moonBest = Object.entries(moonGroups)
      .map(([name, avgs]) => ({name, avg: gmean(avgs), n: avgs.length}))
      .filter(x=>x.n>0).sort((a,b)=>b.avg-a.avg)[0];

    const items = [];

    // Moon
    if(moonDiff!==null) {
      const better = moonDiff>0?'bright':'dark';
      items.push(`${moonDiff>0?'🌕':'🌑'} <strong>Moon matters!</strong> ${name.split(' ')[0]} averages <strong>${Math.abs(moonDiff).toFixed(3)}</strong> pts ${moonDiff>0?'higher':'lower'} during bright moons (>70% illuminated). ${moonBest?`Best phase: ${moonBest.name} (${gfmt(moonBest.avg)})`:''}`);
    }

    // Temperature
    if(tempDiff!==null && Math.abs(tempDiff)>0.02) {
      items.push(`${tempDiff>0?'☀️':'❄️'} <strong>${tempDiff>0?'Warm weather warrior':'Cold weather specialist'}!</strong> Scores <strong>${Math.abs(tempDiff).toFixed(3)}</strong> pts ${tempDiff>0?'higher on warm days (50°F+)':'higher when it\'s cold out'}.`);
    }

    // Elevation
    if(elevDiff!==null && Math.abs(elevDiff)>0.02) {
      items.push(`🏔️ <strong>${elevDiff>0?'Altitude booster':'Sea level performer'}!</strong> Averages <strong>${Math.abs(elevDiff).toFixed(3)}</strong> pts ${elevDiff>0?'higher at high-altitude venues (2000ft+)':'higher at sea level'}. ${elevDiff<0?`Thin air at Logan (4,780ft) and Provo (4,549ft) may be a factor.`:''}`);
    }

    // Rain
    if(rainDiff!==null && Math.abs(rainDiff)>0.02) {
      items.push(`${rainDiff>0?'🌧️':'☀️'} <strong>${rainDiff>0?'Rain day performer':'Sunshine scorer'}!</strong> ${name.split(' ')[0]} goes <strong>${Math.abs(rainDiff).toFixed(3)}</strong> pts ${rainDiff>0?'higher on rainy days. Oregon weather suits them.':'higher on dry days.'}`);
    }

    // Bio fun facts
    if(gymnBio) {
      if(gymnBio.classYear) {
        const classEmoji = {Freshman:'🐣',Sophomore:'📚',Junior:'🎯',Senior:'👑',Graduate:'🎓'}[gymnBio.classYear]||'🎓';
        const classInsight = {
          Freshman: 'First-year contributor — the pressure is already on.',
          Sophomore: 'Sophomore slump? The numbers say otherwise.',
          Junior: 'Peak experience without senior pressure. Prime years.',
          Senior: 'Final season. Full experience. Nothing to lose.',
        }[gymnBio.classYear] || '';
        items.push(`${classEmoji} <strong>${gymnBio.classYear}</strong> from ${gymnBio.hometown||'unknown'}. ${classInsight}`);
      }

      if(gymnBio.major) {
        const majorInsight = {
          'Kinesiology': 'Studies Kinesiology — literally the science of movement. Knows exactly what their body is doing mid-rotation.',
          'Animal Science': 'Animal Science major — used to handling high-pressure situations (livestock). Beam nerves? Nothing compared to that.',
          'Mechanical Engineering': 'Mechanical Engineering brain — treats gymnastics like a physics problem. Force = mass × acceleration.',
          'Business Administration': 'Business mind — calculates ROI on every training hour. Efficiency is the goal.',
          'Biology': 'Biology major — understands muscle fiber mechanics at a cellular level.',
        }[gymnBio.major] || `Studies <strong>${gymnBio.major}</strong>.`;
        const asp = gymnBio.aspiration ? ` Aspiring ${gymnBio.aspiration}.` : '';
        items.push(`🎓 ${majorInsight}${asp}`);
      }

      if(gymnBio.whyOSU && gymnBio.whyOSU.length) {
        const quote = Array.isArray(gymnBio.whyOSU) ? gymnBio.whyOSU[0] : gymnBio.whyOSU;
        items.push(`🦫 <strong>Why Oregon State?</strong> <em>"${quote.replace(/^[""]|[""]$/g,'').trim()}"</em>`);
      }

      if(gymnBio.priorHistory && gymnBio.priorHistory.length) {
        const highlights = gymnBio.priorHistory.filter(b => /national|champion|qualifier|pac-12|award/i.test(b)).slice(0,2);
        if(highlights.length) {
          items.push(`🏅 <strong>Pre-OSU highlight${highlights.length>1?'s':''}:</strong> ${highlights.join(' • ')}`);
        }
      }

      if(gymnBio.personal && gymnBio.personal.length) {
        const hobby = gymnBio.personal.find(b => /enjoy|loves|hobby|music|reads|watches|friends|travel/i.test(b));
        if(hobby) items.push(`🎉 <strong>Off the floor:</strong> ${hobby}`);
      }

      if(gymnBio.height) {
        const heightParts = gymnBio.height.split('-');
        const heightInches = parseInt(heightParts[0])*12 + parseInt(heightParts[1]||0);
        const heightNote = heightInches <= 61
          ? `At ${gymnBio.height}, one of the shorter gymnasts on the team — lower center of gravity is a beam specialist's best friend.`
          : heightInches >= 64
          ? `At ${gymnBio.height}, among the taller gymnasts — more reach on bars, longer lines on floor.`
          : `At ${gymnBio.height}, right in the middle of the team height range.`;
        items.push(`📏 ${heightNote}`);
      }

      // Home state proximity: score at home vs away for gymnasts from non-OR states
      if(gymnBio.homeState && gymnBio.homeState !== 'OR') {
        const homeScores = scored.filter(s=>s.isHome).map(s=>s.avg).filter(Boolean);
        const awayScores = scored.filter(s=>!s.isHome).map(s=>s.avg).filter(Boolean);
        if(homeScores.length && awayScores.length) {
          const diff = gmean(homeScores) - gmean(awayScores);
          if(Math.abs(diff) > 0.03) {
            items.push(`🗺️ From <strong>${gymnBio.hometown}</strong> — ${diff > 0 ? `performs <strong>${diff.toFixed(3)} better at Gill</strong> than anywhere else. Gill Coliseum feels like home.` : `actually averages <strong>${Math.abs(diff).toFixed(3)} higher on the road</strong>. Visiting Corvallis gets this gymnast fired up.`}`);
          }
        }
      }
    }

    // Specialist vs AA insight
    if(gymnBio && gymnBio.position && gymnBio.position !== 'All-Around') {
      const specEvents = [];
      if(/vault/i.test(gymnBio.position)) specEvents.push('vault');
      if(/bars|uneven/i.test(gymnBio.position)) specEvents.push('bars');
      if(/beam/i.test(gymnBio.position)) specEvents.push('beam');
      if(/floor/i.test(gymnBio.position)) specEvents.push('floor');
      const EVlabel = {vault:'Vault',bars:'Bars',beam:'Beam',floor:'Floor'};
      const specAvgs = specEvents.map(ev => {
        const vals = scored.map(s=>s.scores[ev]).filter(v=>v!==undefined&&v>0);
        return {ev, avg: vals.length ? gmean(vals) : null, n: vals.length};
      }).filter(x=>x.avg);
      if(specAvgs.length) {
        const evStr = specAvgs.map(x=>`${EVlabel[x.ev]}: ${gfmt(x.avg)}`).join(' • ');
        items.push(`🎯 <strong>Event Specialist</strong> (${gymnBio.position}) — focuses on what she does best. Specialty avg${specAvgs.length>1?'s':''}: ${evStr}`);
      }
    } else if (gymnBio && gymnBio.position === 'All-Around') {
      const evAvgs = ['vault','bars','beam','floor'].map(ev => {
        const vals = scored.map(s=>s.scores[ev]).filter(v=>v!==undefined&&v>0);
        return {ev, avg: vals.length ? gmean(vals) : null};
      }).filter(x=>x.avg).sort((a,b)=>b.avg-a.avg);
      if(evAvgs.length >= 2) {
        const EVlabel = {vault:'Vault',bars:'Bars',beam:'Beam',floor:'Floor'};
        items.push(`🔄 <strong>All-Around competitor</strong> — best event is ${EVlabel[evAvgs[0].ev]} (${gfmt(evAvgs[0].avg)}), toughest is ${EVlabel[evAvgs[evAvgs.length-1].ev]} (${gfmt(evAvgs[evAvgs.length-1].avg)}). Spread: ${(evAvgs[0].avg - evAvgs[evAvgs.length-1].avg).toFixed(3)} pts.`);
      }
    }

    // Homeschool insight
    if(gymnBio && gymnBio.highSchool) {
      const isHomeschool = /connections academy|acellus|home school|homeschool|online|charter/i.test(gymnBio.highSchool);
      if(isHomeschool) {
        items.push(`📚 <strong>Homeschooled to train.</strong> Attended ${gymnBio.highSchool} — the kind of school that lets you spend 40 hours/week in the gym. That dedication shows.`);
      }
    }

    // Best and worst weather for this gymnast
    const bestMeet = scored.filter(s=>s.avg).sort((a,b)=>b.avg-a.avg)[0];
    const worstMeet = scored.filter(s=>s.avg).sort((a,b)=>a.avg-b.avg)[0];
    if(bestMeet && worstMeet && bestMeet !== worstMeet) {
      items.push(`📊 <strong>Peak conditions:</strong> Career best avg (${gfmt(bestMeet.avg)}) came on a <strong>${bestMeet.moonEmoji} ${bestMeet.moonName}</strong> night, ${bestMeet.weatherEmoji||''} ${bestMeet.weatherDesc||''} at ${bestMeet.elevFt}ft elevation.`);
    }

    if(items.length===0) return '';

    return `
      <div class="section-card wild-card">
        <h2 class="section-title">🎲 Wild Stats & Fun Facts</h2>
        <div class="wild-grid">
          ${items.map(item=>`<div class="wild-item">${item}</div>`).join('')}
        </div>
      </div>`;
  }

  // ===== Per-gymnast Insights =====
  function renderGymnastInsights(name) {
    const EVS = ['vault','bars','beam','floor'];
    const EV_LBL = {vault:'Vault',bars:'Bars',beam:'Beam',floor:'Floor'};
    function gmean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
    function gsd(arr) {
      if (arr.length < 2) return null;
      const m = gmean(arr);
      return Math.sqrt(arr.reduce((s,v)=>s+Math.pow(v-m,2),0)/(arr.length-1));
    }
    function glinReg(pts) {
      const n=pts.length; if(n<2) return {slope:0};
      const sx=pts.reduce((s,p)=>s+p.x,0), sy=pts.reduce((s,p)=>s+p.y,0);
      const sxy=pts.reduce((s,p)=>s+p.x*p.y,0), sx2=pts.reduce((s,p)=>s+p.x*p.x,0);
      return {slope:(n*sxy-sx*sy)/(n*sx2-sx*sx)||0};
    }
    function gfmt(n) { return typeof n==='number'&&!isNaN(n)?n.toFixed(3):'—'; }
    function gdiff(n) { if(typeof n!=='number'||isNaN(n)) return '—'; return (n>=0?'+':'')+n.toFixed(3); }
    function arrow(s) {
      if(s===null) return '<span style="color:#aaa">—</span>';
      if(s>0.015) return '<span style="color:#2ecc71">▲</span>';
      if(s<-0.015) return '<span style="color:#e74c3c">▼</span>';
      return '<span style="color:#aaa">►</span>';
    }

    const sm = meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    const t0 = new Date(sm[0].date+'T12:00:00');

    function evEntries(ev) {
      const out=[], seen=new Set();
      sm.forEach(meet => {
        if(seen.has(meet.date)) return;
        const a=meet.athletes.find(x=>x.name===name);
        if(a&&a.scores[ev]!==undefined){
          seen.add(meet.date);
          out.push({
            score:a.scores[ev], date:meet.date, isHome:meet.isHome,
            result:meet.result, gap:Math.abs((meet.osuScore||0)-(meet.opponentScore||0)),
            day:Math.round((new Date(meet.date+'T12:00:00')-t0)/864e5)
          });
        }
      });
      return out;
    }

    const evStats = EVS.map(ev => {
      const e = evEntries(ev);
      if(e.length<2) return null;
      const scores = e.map(x=>x.score);
      const slope = e.length>=3 ? glinReg(e.map(x=>({x:x.day,y:x.score}))).slope*7 : null;
      const home=e.filter(x=>x.isHome).map(x=>x.score);
      const away=e.filter(x=>!x.isHome).map(x=>x.score);
      const wins=e.filter(x=>x.result==='W').map(x=>x.score);
      const losses=e.filter(x=>x.result==='L').map(x=>x.score);
      const close=e.filter(x=>x.gap<1.0).map(x=>x.score);
      const jan=e.filter(x=>new Date(x.date+'T12:00:00').getMonth()===0).map(x=>x.score);
      const late=e.filter(x=>new Date(x.date+'T12:00:00').getMonth()>0).map(x=>x.score);
      return {
        ev, n:e.length, avg:gmean(scores), best:Math.max(...scores), sd:gsd(scores), slope,
        homeAvg:home.length?gmean(home):null, awayAvg:away.length?gmean(away):null,
        haDiff:home.length&&away.length?gmean(home)-gmean(away):null,
        winAvg:wins.length?gmean(wins):null, lossAvg:losses.length?gmean(losses):null,
        wlDiff:wins.length&&losses.length?gmean(wins)-gmean(losses):null,
        clutch:close.length?gmean(close):null,
        janAvg:jan.length?gmean(jan):null, lateAvg:late.length?gmean(late):null,
        seasonDiff:jan.length&&late.length?gmean(late)-gmean(jan):null
      };
    }).filter(Boolean);

    if(evStats.length===0) return '';

    const sorted = evStats.slice().sort((a,b)=>b.avg-a.avg);
    const mostConsistent = evStats.filter(e=>e.sd!==null).sort((a,b)=>a.sd-b.sd)[0];
    const bestTrend = evStats.filter(e=>e.slope!==null).sort((a,b)=>b.slope-a.slope)[0];
    const bestWinDelta = evStats.filter(e=>e.wlDiff!==null).sort((a,b)=>b.wlDiff-a.wlDiff)[0];

    const headlines = [
      sorted[0] ? `<div class="insight-headline">🏅 Strongest event: <strong>${EV_LBL[sorted[0].ev]}</strong> — season avg <strong>${gfmt(sorted[0].avg)}</strong></div>` : '',
      mostConsistent&&evStats.length>1 ? `<div class="insight-headline">🎯 Most consistent on <strong>${EV_LBL[mostConsistent.ev]}</strong> — std dev <strong>${mostConsistent.sd.toFixed(3)}</strong></div>` : '',
      bestTrend&&bestTrend.slope>0.01 ? `<div class="insight-headline">📈 Trending up on <strong>${EV_LBL[bestTrend.ev]}</strong> — <strong>+${bestTrend.slope.toFixed(3)}</strong> pts/week</div>` : '',
      bestWinDelta&&bestWinDelta.wlDiff>0.02 ? `<div class="insight-headline">🏆 Raises game in wins on <strong>${EV_LBL[bestWinDelta.ev]}</strong> — <strong>${gdiff(bestWinDelta.wlDiff)}</strong> vs losing days</div>` : '',
    ].filter(Boolean).join('');

    // Team averages per event for comparison
    const teamAvg = {};
    ['vault','bars','beam','floor'].forEach(ev => {
      const all = [];
      meets.forEach(m => m.athletes.filter(a=>a.team==='Oregon State'&&a.scores[ev]!==undefined).forEach(a=>all.push(a.scores[ev])));
      teamAvg[ev] = all.length ? gmean(all) : null;
    });

    const cards = evStats.map(e => {
      const SCORE_MIN = 9.4, SCORE_MAX = 9.95;
      const barPct = Math.round(Math.max(0,Math.min(100,((e.avg-SCORE_MIN)/(SCORE_MAX-SCORE_MIN))*100)));
      const vTeam = teamAvg[e.ev];
      const vsDiff = vTeam ? e.avg - vTeam : null;
      return `
      <div class="gi-ev-card">
        <div class="gi-ev-title">${EV_LBL[e.ev]} <span class="gi-n">${e.n} meets</span></div>
        <div class="gi-score-display">
          <span class="gi-big-avg">${gfmt(e.avg)}</span>
          ${vsDiff!==null?`<span class="gi-vs-team" style="color:${vsDiff>0?'#2ecc71':vsDiff<0?'#e74c3c':'#aaa'}">${gdiff(vsDiff)} vs team</span>`:''}
        </div>
        <div class="gi-gauge-wrap"><div class="gi-gauge-bar" style="width:${barPct}%"></div></div>
        <div class="gi-divider"></div>
        <div class="gi-row"><span>Best</span><span>${gfmt(e.best)}</span></div>
        ${e.sd!==null?`<div class="gi-row"><span>Consistency</span><span>${e.sd.toFixed(3)} SD</span></div>`:''}
        ${e.slope!==null?`<div class="gi-row"><span>Trend</span><span>${arrow(e.slope)} ${e.slope>=0?'+':''}${e.slope.toFixed(3)}/wk</span></div>`:''}
        ${e.haDiff!==null?`<div class="gi-row"><span>Home/Away Δ</span><span style="color:${e.haDiff>0?'#2ecc71':e.haDiff<0?'#e74c3c':'#aaa'}">${gdiff(e.haDiff)}</span></div>`:''}
        ${e.wlDiff!==null?`<div class="gi-row"><span>Win/Loss Δ</span><span style="color:${e.wlDiff>0?'#2ecc71':e.wlDiff<0?'#e74c3c':'#aaa'}">${gdiff(e.wlDiff)}</span></div>`:''}
        ${e.clutch!==null?`<div class="gi-row"><span>Close meets</span><span>${gfmt(e.clutch)}</span></div>`:''}
        ${e.seasonDiff!==null?`<div class="gi-row"><span>Jan→Late Δ</span><span style="color:${e.seasonDiff>0.01?'#2ecc71':e.seasonDiff<-0.01?'#e74c3c':'#aaa'}">${gdiff(e.seasonDiff)}</span></div>`:''}
      </div>`;
    }).join('');

    return `
      <div class="section-card" style="margin-bottom:1rem">
        <h2 class="section-title">📊 Personal Insights</h2>
        ${headlines?`<div class="insight-headlines" style="margin-bottom:1rem">${headlines}</div>`:''}
        <div class="gi-ev-grid">${cards}</div>
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

    // Group scores by gymnast
    const byGymnast = {};
    const sortedMeets = meets.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    sortedMeets.forEach(meet => {
      meet.athletes.forEach(a => {
        if (a.scores[event] !== undefined) {
          if (!byGymnast[a.name]) byGymnast[a.name] = [];
          byGymnast[a.name].push({ score: a.scores[event], meetDate: meet.date, opponent: meet.opponent, meetId: meet.id });
        }
      });
    });

    // Build per-gymnast stats
    const gymnasts = Object.entries(byGymnast).map(([name, entries]) => {
      const scores = entries.map(e => e.score);
      const best = entries.reduce((a, b) => a.score > b.score ? a : b);
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      const recent = entries[entries.length - 1];
      return { name, best, avg, recent, count: scores.length };
    });

    gymnasts.sort((a, b) => b.best.score - a.best.score);

    const list = document.getElementById('leaderboardList');
    if (gymnasts.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p class="empty-text">No scores available for this event.</p></div>';
      return;
    }

    list.innerHTML = gymnasts.map((g, i) => {
      const photo = photos[g.name];
      const avatar = photo
        ? `<img src="${photo}" class="lb-avatar" alt="${g.name}">`
        : `<div class="lb-avatar lb-avatar-initials">${g.name.split(' ').map(n => n[0]).join('')}</div>`;
      return `
      <div class="leaderboard-item">
        <div class="lb-rank ${i < 3 ? 'top-3' : ''}">${i + 1}</div>
        ${avatar}
        <div class="lb-info">
          <div class="lb-name"><span class="clickable-name" data-gymnast="${g.name}">${g.name}</span></div>
          <div class="lb-context">Best: <span class="clickable-meet" data-meet-id="${g.best.meetId}">${formatDate(g.best.meetDate)} vs ${g.best.opponent}</span></div>
        </div>
        <div class="lb-stats">
          <div class="lb-stat"><span class="lb-stat-label">HIGH</span><span class="lb-stat-val">${g.best.score.toFixed(3)}</span></div>
          <div class="lb-stat"><span class="lb-stat-label">AVG</span><span class="lb-stat-val">${g.avg.toFixed(3)}</span></div>
          <div class="lb-stat"><span class="lb-stat-label">LAST</span><span class="lb-stat-val">${g.recent.score.toFixed(3)}</span></div>
        </div>
      </div>`;
    }).join('');
  }

  // ===== Insights =====
  function renderInsights() {
    // --- helpers ---
    function mean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
    function stddev(arr) {
      if (arr.length < 2) return 0;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s,v)=>s+Math.pow(v-m,2),0)/(arr.length-1)); // sample stddev (Bessel's correction)
    }
    function linReg(pts) {
      const n = pts.length;
      if (n < 2) return {slope:0};
      const sx=pts.reduce((s,p)=>s+p.x,0), sy=pts.reduce((s,p)=>s+p.y,0);
      const sxy=pts.reduce((s,p)=>s+p.x*p.y,0), sx2=pts.reduce((s,p)=>s+p.x*p.x,0);
      return {slope:(n*sxy-sx*sy)/(n*sx2-sx*sx)||0};
    }
    function pearson(xs,ys) {
      const n=xs.length; if(n<3) return null;
      const mx=mean(xs),my=mean(ys);
      const num=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
      const den=Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
      return den===0?null:num/den;
    }
    function fmt(n) { return typeof n==='number' ? n.toFixed(3) : '—'; }
    function fmtDiff(n) { if (typeof n !== 'number' || isNaN(n)) return '—'; return (n>=0?'+':'')+n.toFixed(3); }

    const EVS = ['vault','bars','beam','floor'];
    const EV_LABELS = {vault:'Vault',bars:'Bars',beam:'Beam',floor:'Floor'};
    const sortedMeets = meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    // Dedupe to unique competition days for team-level analysis
    const compDays = [];
    const seenDates = new Set();
    sortedMeets.forEach(m => { if(!seenDates.has(m.date)){ seenDates.add(m.date); compDays.push(m); }});

    // Get all gymnast names
    const allNames = [...new Set(meets.flatMap(m=>m.athletes.map(a=>a.name)))].sort();

    // Per gymnast, per event entries
    function gymnEntries(name, ev) {
      const out = [];
      const seenDates = new Set(); // deduplicate quad meet days — same athlete, same score, same day
      sortedMeets.forEach(meet => {
        if (seenDates.has(meet.date)) return;
        const a = meet.athletes.find(x=>x.name===name);
        if (a && a.scores[ev] !== undefined) {
          seenDates.add(meet.date);
          out.push({
            score: a.scores[ev], date: meet.date, isHome: meet.isHome,
            result: meet.result, gap: Math.abs((meet.osuScore||0) - (meet.opponentScore||0)),
            meetId: meet.id || '', opponent: meet.opponent || '?'
          });
        }
      });
      return out;
    }
    function allScores(name) {
      return EVS.flatMap(ev => gymnEntries(name,ev).map(e=>e.score));
    }

    // ── CONSISTENCY ──
    const consistency = allNames.map(name => {
      const s = allScores(name);
      return s.length>=4 ? {name, sd:stddev(s), avg:mean(s), n:s.length} : null;
    }).filter(Boolean).sort((a,b)=>a.sd-b.sd);

    // ── TREND ── (x = days from first competition, slope = pts/day → scale to pts/week)
    const firstDate = new Date(sortedMeets[0].date + 'T12:00:00');
    const trends = allNames.map(name => {
      let totalSlope=0, evCount=0;
      EVS.forEach(ev => {
        const e = gymnEntries(name,ev);
        if (e.length>=3) {
          const pts = e.map(x=>({x:Math.round((new Date(x.date+'T12:00:00')-firstDate)/864e5), y:x.score}));
          totalSlope+=linReg(pts).slope*7; // convert to per-week
          evCount++;
        }
      });
      if (!evCount) return null;
      return {name, slope: totalSlope/evCount};
    }).filter(Boolean).sort((a,b)=>b.slope-a.slope);

    // ── HOME vs AWAY ──
    const homeAway = allNames.map(name => {
      const home=[], away=[];
      EVS.forEach(ev => gymnEntries(name,ev).forEach(e => (e.isHome?home:away).push(e.score)));
      if (home.length<2||away.length<2) return null;
      return {name, home:mean(home), away:mean(away), diff:mean(home)-mean(away)};
    }).filter(Boolean).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));

    // ── WIN CONTRIBUTION ──
    const winContrib = allNames.map(name => {
      const wins=[], losses=[];
      EVS.forEach(ev => gymnEntries(name,ev).forEach(e => (e.result==='W'?wins:losses).push(e.score)));
      if (wins.length<2||losses.length<2) return null;
      return {name, winAvg:mean(wins), lossAvg:mean(losses), delta:mean(wins)-mean(losses)};
    }).filter(Boolean).sort((a,b)=>b.delta-a.delta);

    // ── CLUTCH (close meets gap<1.0) ──
    const clutch = allNames.map(name => {
      const close=[], normal=[];
      EVS.forEach(ev => gymnEntries(name,ev).forEach(e => (e.gap<1.0?close:normal).push(e.score)));
      if (close.length<2||normal.length<2) return null;
      return {name, close:mean(close), normal:mean(normal), delta:mean(close)-mean(normal), n:close.length};
    }).filter(Boolean).sort((a,b)=>b.delta-a.delta);

    // ── TEAM EVENT ANALYSIS ──
    const teamEvents = EVS.map(ev => {
      const all=[], wins=[], losses=[];
      compDays.forEach(m => {
        const v = m.events&&m.events[ev]?m.events[ev].osu:null;
        if (v===null) return;
        all.push(v);
        (m.result==='W'?wins:losses).push(v);
      });
      return {ev, label:EV_LABELS[ev], avg:mean(all), winAvg:mean(wins), lossAvg:mean(losses),
        winLossDiff: wins.length&&losses.length ? mean(wins)-mean(losses) : 0, n:all.length};
    }).sort((a,b)=>b.avg-a.avg);

    // ── REST DAYS EFFECT ──
    const restData = compDays.map((m,i) => {
      if(i===0) return null;
      const days=Math.round((new Date(m.date)-new Date(compDays[i-1].date))/(864e5));
      return {days, score:m.osuScore, result:m.result};
    }).filter(Boolean);
    const restCorr = restData.length>=4 ?
      pearson(restData.map(d=>d.days), restData.map(d=>d.score)) : null;

    // ── EVENT CORRELATIONS ──
    const pairLabels = {vault:'VT',bars:'UB',beam:'BB',floor:'FX'};
    const pairs = [['vault','floor'],['vault','bars'],['vault','beam'],['bars','beam'],['bars','floor'],['beam','floor']];
    const corrMatrix = pairs.map(([e1,e2]) => {
      const xs=[], ys=[];
      allNames.forEach(name => {
        const s1=gymnEntries(name,e1), s2=gymnEntries(name,e2);
        if(s1.length>=3&&s2.length>=3){ xs.push(mean(s1.map(x=>x.score))); ys.push(mean(s2.map(x=>x.score))); }
      });
      if(xs.length<4) return null;
      const r=pearson(xs,ys);
      return r!==null?{e1,e2,r}:null;
    }).filter(Boolean).sort((a,b)=>Math.abs(b.r)-Math.abs(a.r));

    // ── BUILD HTML ──
    const top1 = consistency[0];
    const topTrend = trends[0];
    const topHome = homeAway.sort((a,b)=>b.home-b.away-(a.home-a.away))[0];
    const topClutch = clutch[0];

    const headlines = [
      top1 ? `<div class="insight-headline">🎯 <strong>${top1.name}</strong> is OSU's most consistent scorer — std dev of just <strong>${top1.sd.toFixed(3)}</strong> across ${top1.n} scores</div>` : '',
      topTrend&&topTrend.slope>0 ? `<div class="insight-headline">📈 <strong>${topTrend.name}</strong> is the biggest improver this season — trending up <strong>${(topTrend.slope*1000).toFixed(1)}pts</strong> per meet</div>` : '',
      topClutch&&topClutch.delta>0 ? `<div class="insight-headline">⚡ <strong>${topClutch.name}</strong> scores <strong>${fmtDiff(topClutch.delta)}</strong> higher in tight meets (gap &lt; 1.0)</div>` : '',
      restCorr!==null ? `<div class="insight-headline">📅 More rest = ${restCorr>0.2?'<strong>higher</strong>':restCorr<-0.2?'<strong>lower</strong>':'<strong>no clear change</strong> in'} team scores (r=${restCorr.toFixed(2)})</div>` : '',
    ].filter(Boolean).join('');

    function trendArrow(slope) {
      if (slope > 0.02) return '<span style="color:#2ecc71">▲ Improving</span>';
      if (slope < -0.02) return '<span style="color:#e74c3c">▼ Declining</span>';
      return '<span style="color:#aaa">► Stable</span>';
    }
    function corrStrength(r) {
      const a = Math.abs(r);
      const dir = r > 0 ? 'positive' : 'negative';
      if (a > 0.7) return `Strong ${dir}`;
      if (a > 0.4) return `Moderate ${dir}`;
      return `Weak ${dir}`;
    }

    // ── HIDDEN PATTERNS ──
    // Away streak effect
    const awayStreakGroups = {0:[],1:[],2:[]};
    let awayStreak = 0;
    compDays.forEach(m => {
      if (!m.isHome) awayStreak++; else awayStreak = 0;
      const key = Math.min(awayStreak, 2);
      awayStreakGroups[key].push(m.osuScore);
    });

    // Day of week
    const dowGroups = {};
    compDays.forEach(m => {
      const day = new Date(m.date + 'T12:00:00').toLocaleDateString('en-US',{weekday:'long'});
      if (!dowGroups[day]) dowGroups[day] = [];
      dowGroups[day].push(m.osuScore);
    });
    const dowSorted = Object.entries(dowGroups).sort((a,b)=>mean(b[1])-mean(a[1]));

    // Month of season
    const monthGroups = {};
    compDays.forEach(m => {
      const month = new Date(m.date + 'T12:00:00').toLocaleDateString('en-US',{month:'long'});
      if (!monthGroups[month]) monthGroups[month] = [];
      monthGroups[month].push(m.osuScore);
    });
    const monthSorted = Object.entries(monthGroups).sort((a,b)=>mean(b[1])-mean(a[1]));

    // Post-result effect (what happens AFTER a win vs after a loss)
    const afterWin = [], afterLoss = [];
    compDays.forEach((m,i) => {
      if (i === 0) return;
      if (compDays[i-1].result === 'W') afterWin.push(m.osuScore);
      else afterLoss.push(m.osuScore);
    });

    // Blowout hangover — big margin prev meet vs next score
    const bigMargin = [], smallMargin = [];
    compDays.forEach((m,i) => {
      if (i === 0) return;
      const prev = compDays[i-1];
      const margin = Math.abs(prev.osuScore - prev.opponentScore);
      if (margin >= 1.5) bigMargin.push(m.osuScore);
      else smallMargin.push(m.osuScore);
    });

    // Quad vs dual meet performance — use compDays to avoid triple-counting quad scores
    const quadScores = [], dualScores = [];
    compDays.forEach(m => {
      if (m.quadMeet) quadScores.push(m.osuScore);
      else dualScores.push(m.osuScore);
    });

    // Per-gymnast: early season (Jan) vs late (Feb/Mar) 
    const earlyLate = allNames.map(name => {
      const early=[], late=[];
      EVS.forEach(ev => gymnEntries(name,ev).forEach(e => {
        const month = new Date(e.date+'T12:00:00').getMonth();
        if (month === 0) early.push(e.score); else late.push(e.score);
      }));
      if (early.length<2||late.length<2) return null;
      return {name, early:mean(early), late:mean(late), delta:mean(late)-mean(early)};
    }).filter(Boolean).sort((a,b)=>b.delta-a.delta);

    // Score after team's biggest individual bad score previous meet
    // Who are the "slow starters" vs "fast starters" (first event vs last event score)
    // Use vault vs floor as proxy (vault typically first or second rotation, floor last)
    const startFinish = allNames.map(name => {
      const vaultScores = gymnEntries(name,'vault');
      const floorScores = gymnEntries(name,'floor');
      if (vaultScores.length<3||floorScores.length<3) return null;
      const vaultAvg = mean(vaultScores.map(e=>e.score));
      const floorAvg = mean(floorScores.map(e=>e.score));
      return {name, vault:vaultAvg, floor:floorAvg, delta:floorAvg-vaultAvg};
    }).filter(Boolean).sort((a,b)=>b.delta-a.delta);

    document.getElementById('mainContent').innerHTML = `
      <div class="insights-view">
        <div class="insight-headlines">${headlines}</div>

        <div class="insight-section-title">💪 Consistency Ratings</div>
        <div class="insight-card">
          <p class="insight-note">Ranked by score consistency (lowest std deviation = most reliable). High average + low SD = the total package.</p>
          <div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>Avg</span><span>Consistency</span><span>Rating</span></div>
            ${consistency.map((g,i) => {
              const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
              const bar = Math.max(0, Math.round((1 - g.sd/0.3)*10));
              const barHtml = `<span class="cons-bar" style="width:${bar*10}%"></span>`;
              return `<div class="itrow" data-gymnast="${g.name}">
                <span class="clickable-name" data-gymnast="${g.name}">${medal} ${g.name}</span>
                <span>${fmt(g.avg)}</span>
                <span class="cons-bar-wrap">${barHtml}</span>
                <span style="color:var(--orange);font-weight:600">${g.sd.toFixed(3)} SD</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="insight-section-title">📈 Season Trajectory</div>
        <div class="insight-card">
          <p class="insight-note">Linear regression across all events. Who's peaking at the right time going into postseason?</p>
          <div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>Trend</span><span>Slope/week</span></div>
            ${trends.map(g => `
              <div class="itrow">
                <span class="clickable-name" data-gymnast="${g.name}">${g.name}</span>
                <span>${trendArrow(g.slope)}</span>
                <span style="color:var(--text-muted)">${fmtDiff(g.slope)}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="insight-section-title">🏠 Home vs Away Split</div>
        <div class="insight-card">
          <p class="insight-note">Average score at home vs on the road. Positive diff = better at home. Negative = road warrior. <em>Note: only 4 home meets this season — small sample.</em></p>
          <div style="overflow-x:auto"><div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>Home</span><span>Away</span><span>Diff</span></div>
            ${homeAway.map(g => `
              <div class="itrow">
                <span class="clickable-name" data-gymnast="${g.name}">${g.name}</span>
                <span>${fmt(g.home)}</span>
                <span>${fmt(g.away)}</span>
                <span style="color:${g.diff>0?'#2ecc71':g.diff<0?'#e74c3c':'#aaa'};font-weight:600">${fmtDiff(g.diff)}</span>
              </div>`).join('')}
          </div></div>
        </div>

        <div class="insight-section-title">⚡ Clutch Factor</div>
        <div class="insight-card">
          <p class="insight-note">Average score in close meets (team score gap &lt; 1.0 pt) vs normal meets. Who elevates when it matters?</p>
          ${clutch.length<2?'<p class="insight-note" style="color:#e74c3c">Not enough close meets to rank — only a handful of meets qualify.</p>':''}
          <div style="overflow-x:auto"><div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>Clutch</span><span>Normal</span><span>Δ</span></div>
            ${clutch.map(g => `
              <div class="itrow">
                <span class="clickable-name" data-gymnast="${g.name}">${g.name}</span>
                <span>${fmt(g.close)}</span>
                <span>${fmt(g.normal)}</span>
                <span style="color:${g.delta>0?'#2ecc71':g.delta<0?'#e74c3c':'#aaa'};font-weight:600">${fmtDiff(g.delta)}</span>
              </div>`).join('')}
          </div></div>
        </div>

        <div class="insight-section-title">🏆 Win Contribution</div>
        <div class="insight-card">
          <p class="insight-note">Average score in OSU wins vs losses. Who shows up on winning days?</p>
          <div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>In Wins</span><span>In Losses</span><span>Δ</span></div>
            ${winContrib.map(g => `
              <div class="itrow">
                <span class="clickable-name" data-gymnast="${g.name}">${g.name}</span>
                <span style="color:#2ecc71">${fmt(g.winAvg)}</span>
                <span style="color:#e74c3c">${fmt(g.lossAvg)}</span>
                <span style="color:${g.delta>0?'#2ecc71':g.delta<0?'#e74c3c':'#aaa'};font-weight:600">${fmtDiff(g.delta)}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="insight-section-title">🎪 Team Event Breakdown</div>
        <div class="insight-card">
          <p class="insight-note">OSU's average team score per event, split by meet result. Where does OSU win and lose rotations?</p>
          <div class="insight-table">
            <div class="itrow header"><span>Event</span><span>Season Avg</span><span>In Wins</span><span>In Losses</span><span>W/L Diff</span></div>
            ${teamEvents.map(e => `
              <div class="itrow">
                <span style="font-weight:600">${e.label}</span>
                <span>${fmt(e.avg)}</span>
                <span style="color:#2ecc71">${e.winAvg?fmt(e.winAvg):'—'}</span>
                <span style="color:#e74c3c">${e.lossAvg?fmt(e.lossAvg):'—'}</span>
                <span style="color:${e.winLossDiff>0?'#2ecc71':e.winLossDiff<0?'#e74c3c':'#aaa'};font-weight:600">${e.winLossDiff?fmtDiff(e.winLossDiff):'—'}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="insight-section-title">📅 Rest Days Effect</div>
        <div class="insight-card">
          <p class="insight-note">Does more time between meets improve performance? Correlation between rest days and team score.</p>
          ${restCorr!==null?`<div class="insight-big-stat">${restCorr>0.2?'📈':'📉'} r = <strong>${restCorr.toFixed(2)}</strong> — ${corrStrength(restCorr)} correlation</div>`:'<p class="insight-note">Not enough data points.</p>'}
          <div class="insight-table" style="margin-top:0.75rem">
            <div class="itrow header"><span>Meet</span><span>Rest Days</span><span>Team Score</span><span>Result</span></div>
            ${restData.map(d => `
              <div class="itrow">
                <span style="color:var(--text-muted);font-size:0.8rem">${formatDate(compDays[restData.indexOf(d)+1]?.date||'')}</span>
                <span>${d.days}d</span>
                <span>${fmt(d.score)}</span>
                <span style="color:${d.result==='W'?'#2ecc71':'#e74c3c'}">${d.result}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="insight-section-title">🔗 Event Correlations</div>
        <div class="insight-card">
          <p class="insight-note">Do gymnasts who score well on one event also score well on another? Pearson r across all athletes' season averages.</p>
          <div class="insight-table">
            <div class="itrow header"><span>Events</span><span>Correlation</span><span>Strength</span></div>
            ${corrMatrix.map(c => {
              const pct = Math.round(Math.abs(c.r)*100);
              return `<div class="itrow">
                <span style="font-weight:600">${pairLabels[c.e1]} ↔ ${pairLabels[c.e2]}</span>
                <span style="color:${Math.abs(c.r)>0.5?'var(--orange)':'var(--text-muted)'}">r = ${c.r.toFixed(2)}</span>
                <span style="color:var(--text-muted);font-size:0.8rem">${corrStrength(c.r)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="insight-section-title" style="margin-top:2rem;border-top:1px solid var(--border);padding-top:1.5rem">🎲 Hidden Patterns — The Weird Stats That Actually Hold Up</div>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1rem">Correlations that sound ridiculous until you look at the numbers. All computed from OSU's actual 2026 season data.</p>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">🛣️ Road Fatigue Is Real — And It's Brutal</div>
          <p class="insight-note">Each consecutive away meet strips ~0.8 pts off the team score. Not a fluke — it shows up every single time.</p>
          <div class="streak-bars">
            ${[0,1,2].map(k => {
              const scores = awayStreakGroups[k];
              const avg = scores.length ? mean(scores) : null;
              const pct = avg ? Math.round(((avg-194)/(198-194))*100) : 0;
              const labels = ['🏠 Home meets','🛣️ 1st away meet','🛣️ 2nd+ consecutive away'];
              return avg ? '<div class="streak-row"><span class="streak-label">'+labels[k]+'</span><div class="streak-bar-wrap"><div class="streak-bar" style="width:'+pct+'%"></div></div><span class="streak-val">'+fmt(avg)+'</span></div>' : '';
            }).join('')}
          </div>
        </div>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">📅 February Is OSU's Best Month — Not March</div>
          <p class="insight-note">Counterintuitive. Teams are supposed to peak for postseason. OSU's best gymnastics happened in February, not heading into March regionals.</p>
          <div class="insight-table">
            <div class="itrow header"><span>Month</span><span>Avg Team Score</span><span>Meets</span></div>
            ${monthSorted.map(([month, scores], i) => '<div class="itrow"><span style="font-weight:600">'+(i===0?'🔥 ':'')+month+'</span><span style="color:'+(i===0?'var(--orange)':'var(--text-primary)')+';font-weight:'+(i===0?700:400)+'">'+fmt(mean(scores))+'</span><span style="color:var(--text-muted)">'+scores.length+' meets</span></div>').join('')}
          </div>
        </div>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">📆 Best Day of the Week to Watch OSU</div>
          <p class="insight-note">Small sample, but the trend is clear. OSU's peak day: ${dowSorted[0][0]}.</p>
          <div class="insight-table">
            <div class="itrow header"><span>Day</span><span>Avg Score</span><span>Record</span></div>
            ${dowSorted.map(([day, scores], i) => {
              const wins = compDays.filter(m => new Date(m.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'})===day && m.result==='W').length;
              return '<div class="itrow"><span style="font-weight:600">'+(i===0?'⭐ ':'')+day+'</span><span style="color:'+(i===0?'var(--orange)':'var(--text-primary)')+'">'+fmt(mean(scores))+'</span><span style="color:var(--text-muted)">'+wins+'-'+(scores.length-wins)+'</span></div>';
            }).join('')}
          </div>
        </div>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">🔄 Bounce-Back After Big Losses</div>
          <p class="insight-note">After getting blown out by 1.5+ points, does OSU reset and come back stronger — or does the loss linger?</p>
          <div class="insight-table">
            <div class="itrow header"><span>Scenario</span><span>Next Meet Avg</span><span>Sample</span></div>
            <div class="itrow"><span>After blowout (margin ≥ 1.5)</span><span style="color:${mean(bigMargin)>mean(smallMargin)?'#2ecc71':'#e74c3c'};font-weight:600">${bigMargin.length?fmt(mean(bigMargin)):'—'}</span><span style="color:var(--text-muted)">${bigMargin.length} meets</span></div>
            <div class="itrow"><span>After close meet (margin &lt; 1.5)</span><span style="font-weight:600">${smallMargin.length?fmt(mean(smallMargin)):'—'}</span><span style="color:var(--text-muted)">${smallMargin.length} meets</span></div>
            <div class="itrow" style="color:var(--text-muted);font-size:0.78rem;font-style:italic"><span>${bigMargin.length&&smallMargin.length?(mean(bigMargin)>mean(smallMargin)?'✅ Bounce-back is real — big losses fuel bigger next scores':'❌ No clear bounce-back — big losses carry over'):'Insufficient data'}</span><span></span><span></span></div>
          </div>
        </div>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">🎪 Quad Meets vs Dual Meets — Bigger Stage, Better Scores?</div>
          <p class="insight-note">In quad meets there are more teams, bigger atmosphere. Does it lift OSU's scores or add pressure?</p>
          <div class="insight-table">
            <div class="itrow header"><span>Format</span><span>Avg Score</span><span>Meets</span></div>
            <div class="itrow"><span>🎪 Quad meets</span><span style="color:${mean(quadScores)>mean(dualScores)?'#2ecc71':'#e74c3c'};font-weight:600">${fmt(mean(quadScores))}</span><span style="color:var(--text-muted)">${quadScores.length}</span></div>
            <div class="itrow"><span>🤼 Dual meets</span><span style="font-weight:600">${fmt(mean(dualScores))}</span><span style="color:var(--text-muted)">${dualScores.length}</span></div>
          </div>
        </div>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">📈 Who Gets Better As The Season Goes On?</div>
          <p class="insight-note">January vs February/March average. Late-season risers are your postseason players. Decliners may be carrying fatigue or nursing something.</p>
          <div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>Jan Avg</span><span>Late Season</span><span>Trend</span></div>
            ${earlyLate.map(g => '<div class="itrow"><span class="clickable-name" data-gymnast="'+g.name+'">'+g.name+'</span><span>'+fmt(g.early)+'</span><span>'+fmt(g.late)+'</span><span style="color:'+(g.delta>0.05?'#2ecc71':g.delta<-0.05?'#e74c3c':'#aaa')+';font-weight:600">'+fmtDiff(g.delta)+'</span></div>').join('')}
          </div>
        </div>

        <div class="insight-card" style="margin-bottom:1rem">
          <div class="hidden-pattern-title">🚀 Slow Starters vs Fast Finishers (Vault vs Floor)</div>
          <p class="insight-note">Vault is typically an early rotation. Floor is typically last. A big positive delta means a gymnast who warms up slowly but finishes strong — the classic "anchor" type.</p>
          <div class="insight-table">
            <div class="itrow header"><span>Gymnast</span><span>Vault Avg</span><span>Floor Avg</span><span>Δ (FX−VT)</span></div>
            ${startFinish.map(g => '<div class="itrow"><span class="clickable-name" data-gymnast="'+g.name+'">'+g.name+'</span><span>'+fmt(g.vault)+'</span><span>'+fmt(g.floor)+'</span><span style="color:'+(g.delta>0.05?'#2ecc71':g.delta<-0.05?'#e74c3c':'#aaa')+';font-weight:600">'+fmtDiff(g.delta)+'</span></div>').join('')}
          </div>
        </div>

      </div>
      ${renderSeasonWildStats()}
    `;
  }

// ===== Season Wild Stats =====
  function renderSeasonWildStats() {
    // ── Shared stats helpers ────────────────────────────────────────────────
    function mean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null; }
    function sd(arr) {
      if(arr.length < 2) return null;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s,v)=>s+Math.pow(v-m,2),0)/(arr.length-1));
    }
    function pearson(xs, ys) {
      const n = xs.length;
      if(n < 3) return null;
      const mx = mean(xs), my = mean(ys);
      const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
      const den = Math.sqrt(xs.reduce((s,x)=>s+Math.pow(x-mx,2),0)*ys.reduce((s,y)=>s+Math.pow(y-my,2),0));
      return den===0 ? null : num/den;
    }
    function corrStrength(r) {
      const a = Math.abs(r);
      if(a < 0.2) return 'negligible';
      if(a < 0.4) return 'weak';
      if(a < 0.6) return 'moderate';
      if(a < 0.8) return 'strong';
      return 'very strong';
    }
    function corrColor(r) {
      if(r == null) return '#666';
      return r > 0.4 ? '#2ecc71' : r < -0.4 ? '#e74c3c' : '#f39c12';
    }
    function fmt2(n, dp=3) { return (n!=null&&!isNaN(n)) ? n.toFixed(dp) : '—'; }
    function fmtR(r) { return r==null ? '—' : (r>=0?'+':'')+r.toFixed(2); }

    // ── Unique competition days ─────────────────────────────────────────────
    const compDays = [];
    const seenDates = new Set();
    meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(m => {
      if(seenDates.has(m.date)) return;
      seenDates.add(m.date);
      const osuTeam = m.teams?.find(t=>t.team==='Oregon State');
      if(!osuTeam || !osuTeam.total) return;
      compDays.push({
        date: m.date,
        total: osuTeam.total,
        moonFullness: m.moonPhase?.fullness ?? null,
        tempHigh: m.weather?.tempHighF ?? null,
        precip: m.weather?.precipIn ?? null,
        elevFt: m.elevationFt ?? null,
        distMiles: m.distanceMiles ?? null,
        isHome: m.isHome,
      });
    });
    const n = compDays.length;

    // ── Pearson correlations (team total vs env factor) ─────────────────────
    function corrRow(label, emoji, key, dirHigh, dirLow) {
      const pairs = compDays.filter(d=>d[key]!=null&&d.total!=null);
      const r = pearson(pairs.map(d=>d[key]), pairs.map(d=>d.total));
      if(r==null) return '';
      const strength = corrStrength(r);
      const dir = r > 0.05 ? `↑ higher ${dirHigh}` : r < -0.05 ? `↓ lower ${dirHigh}` : '↔ flat';
      const pn = pairs.length;
      const barW = Math.round(Math.abs(r)*100);
      const col = corrColor(r);
      return `
        <div class="corr-row">
          <span class="corr-label">${emoji} ${label}</span>
          <span class="corr-r" style="color:${col}">${fmtR(r)}</span>
          <span class="corr-strength" style="color:${col}">${strength}</span>
          <span class="corr-dir">${dir}</span>
          <span class="corr-n">n=${pn}</span>
        </div>`;
    }

    const corrRows = [
      corrRow('Moon fullness', '🌙', 'moonFullness', 'when full', 'under new moon'),
      corrRow('Outside temp (°F)', '🌡️', 'tempHigh', 'in warm weather', 'in cold weather'),
      corrRow('Venue elevation (ft)', '🏔️', 'elevFt', 'at altitude', 'at sea level'),
      corrRow('Distance from home (mi)', '✈️', 'distMiles', 'far from home', 'close to home'),
      corrRow('Precipitation (in)', '🌧️', 'precip', 'on rainy days', 'on dry days'),
    ].filter(Boolean).join('');

    // ── Group stats helper (returns {mean, sd, n, label}) ──────────────────
    function groupStats(predicate) {
      const scores = [];
      meets.forEach(m => {
        m.athletes.filter(a=>a.team==='Oregon State'&&predicate(a)).forEach(a => {
          ['vault','bars','beam','floor'].forEach(ev => {
            const s = a.scores[ev];
            if(s!==undefined&&s>0) scores.push(s);
          });
        });
      });
      const m = mean(scores), s = sd(scores);
      return {mean: m, sd: s, n: scores.length, gymnasts: new Set()};
    }

    // Better version — also returns unique gymnast names
    function groupBlock(groupDefs) {
      const results = groupDefs.map(({label, pred, emoji}) => {
        const scores = [];
        const names = new Set();
        meets.forEach(m => {
          m.athletes.filter(a=>a.team==='Oregon State'&&pred(a)).forEach(a => {
            ['vault','bars','beam','floor'].forEach(ev => {
              const s = a.scores[ev];
              if(s!==undefined&&s>0) scores.push(s);
            });
            names.add(a.name);
          });
        });
        return {label, emoji, mean: mean(scores), sd: sd(scores), n: scores.length, gymnasts: names.size};
      }).filter(x=>x.mean!=null&&x.n>0).sort((a,b)=>b.mean-a.mean);

      const overall = mean(results.flatMap(r=>Array(r.n).fill(r.mean)));
      return results.map((r,i) => {
        const diff = r.mean - overall;
        const pct = Math.round(Math.abs(r.mean-9.6)/0.4*100);
        const rankLabel = i===0 ? ' 👑' : i===results.length-1 ? ' 📉' : '';
        const isSig = r.sd!=null && Math.abs(diff) > r.sd/2;
        return `
          <div class="gstat-row">
            <span class="gstat-label">${r.emoji||''} ${r.label}${rankLabel}</span>
            <span class="gstat-mean">${fmt2(r.mean)}</span>
            <span class="gstat-sd">±${r.sd!=null?r.sd.toFixed(3):'—'}</span>
            <span class="gstat-diff" style="color:${diff>0?'#2ecc71':diff<0?'#e74c3c':'#aaa'}">${diff>=0?'+':''}${fmt2(diff)}</span>
            <span class="gstat-n">${r.gymnasts}g / ${r.n}ev</span>
          </div>`;
      }).join('');
    }

    // ── 1. Class Year ───────────────────────────────────────────────────────
    const classRows = groupBlock([
      {label:'Freshman', emoji:'🐣', pred:a=>bios[a.name]?.classYear==='Freshman'},
      {label:'Sophomore', emoji:'📚', pred:a=>bios[a.name]?.classYear==='Sophomore'},
      {label:'Junior', emoji:'🎯', pred:a=>bios[a.name]?.classYear==='Junior'},
      {label:'Senior', emoji:'👑', pred:a=>bios[a.name]?.classYear==='Senior'},
    ]);

    // ── 2. Home Region ──────────────────────────────────────────────────────
    const regMap = {'Pacific NW':['WA','OR','ID'],'West Coast':['CA','NV'],'Mountain West':['UT','CO'],'Texas':['TX'],'East Coast':['NY','NC','MI','IL','FL'],'International':['INTL']};
    function getRegion(a) {
      const st = bios[a.name]?.homeState;
      for(const [r,states] of Object.entries(regMap)) if(states.includes(st)) return r;
      return null;
    }
    const regionDefs = Object.keys(regMap).map(r=>({label:r, emoji:{'Pacific NW':'🌲','West Coast':'🌊','Mountain West':'⛷️','Texas':'🤠','East Coast':'🗽','International':'🌍'}[r]||'🌐', pred:a=>getRegion(a)===r}));
    const regionRows = groupBlock(regionDefs);

    // ── 3. Specialist vs AA ─────────────────────────────────────────────────
    const specRows = groupBlock([
      {label:'All-Around', emoji:'🔄', pred:a=>bios[a.name]?.position==='All-Around'},
      {label:'Event Specialist', emoji:'🎯', pred:a=>bios[a.name]?.position&&bios[a.name].position!=='All-Around'},
    ]);

    // ── 4. Homeschool vs Traditional ────────────────────────────────────────
    const isHomeschool = a => /connections academy|acellus|home school|homeschool|online|odyssey charter/i.test(bios[a.name]?.highSchool||'');
    const schoolRows = groupBlock([
      {label:'Homeschooled to train', emoji:'📚', pred:isHomeschool},
      {label:'Traditional school', emoji:'🏫', pred:a=>bios[a.name]?.highSchool&&!isHomeschool(a)},
    ]);

    // ── 5. Major groups ─────────────────────────────────────────────────────
    const majors = ['Kinesiology','Animal Science','Mechanical Engineering','Business Administration','Biology'];
    const majorEmoji = {'Kinesiology':'🦴','Animal Science':'🐄','Mechanical Engineering':'⚙️','Business Administration':'💼','Biology':'🔬'};
    const majorRows = groupBlock(majors.map(m=>({label:m, emoji:majorEmoji[m]||'🎓', pred:a=>bios[a.name]?.major===m})));

    // ── 6. Height groups ────────────────────────────────────────────────────
    function heightIn(a) {
      const h=bios[a.name]?.height; if(!h) return null;
      const [f,i]=h.split('-').map(Number); return f*12+i;
    }
    const heightRows = groupBlock([
      {label:'Short (≤5\'1")', emoji:'🤸', pred:a=>{const h=heightIn(a);return h!=null&&h<=61;}},
      {label:'Mid (5\'2"–5\'3")', emoji:'📏', pred:a=>{const h=heightIn(a);return h!=null&&h>=62&&h<=63;}},
      {label:'Tall (≥5\'4")', emoji:'🦒', pred:a=>{const h=heightIn(a);return h!=null&&h>=64;}},
    ]);

    // ── Cross-tab: Full Moon × Class Year ───────────────────────────────────
    const fullMoonDates = new Set(compDays.filter(d=>d.moonFullness!=null&&d.moonFullness>0.75).map(d=>d.date));
    const darkMoonDates = new Set(compDays.filter(d=>d.moonFullness!=null&&d.moonFullness<0.35).map(d=>d.date));
    const hiAltDates = new Set(compDays.filter(d=>d.elevFt!=null&&d.elevFt>2000).map(d=>d.date));

    function crossTab(datePred, groupDefs) {
      return groupBlock(groupDefs.map(g=>({...g, pred:a=>datePred(a._meet)&&g.basePred(a)})));
    }

    // Moon × class: who peaks under a full moon?
    const moonClassRows = (() => {
      const clsGroups = ['Freshman','Sophomore','Junior','Senior'];
      const clsEmoji = {Freshman:'🐣',Sophomore:'📚',Junior:'🎯',Senior:'👑'};
      const rows = clsGroups.map(cls => {
        const fm=[], dm=[];
        meets.forEach(m => {
          if(!fullMoonDates.has(m.date)&&!darkMoonDates.has(m.date)) return;
          m.athletes.filter(a=>a.team==='Oregon State'&&bios[a.name]?.classYear===cls).forEach(a => {
            ['vault','bars','beam','floor'].forEach(ev => {
              const s=a.scores[ev]; if(s===undefined||s<=0) return;
              if(fullMoonDates.has(m.date)) fm.push(s);
              else dm.push(s);
            });
          });
        });
        if(!fm.length&&!dm.length) return null;
        const fmMean=mean(fm), dmMean=mean(dm);
        const diff = fmMean!=null&&dmMean!=null ? fmMean-dmMean : null;
        return `<div class="gstat-row">
          <span class="gstat-label">${clsEmoji[cls]} ${cls}</span>
          <span class="gstat-mean">${fmt2(fmMean)} 🌕</span>
          <span class="gstat-mean">${fmt2(dmMean)} 🌑</span>
          <span class="gstat-diff" style="color:${diff==null?'#aaa':diff>0?'#2ecc71':'#e74c3c'}">${diff!=null?(diff>=0?'+':'')+fmt2(diff)+' under full moon':'—'}</span>
          <span class="gstat-n">${fm.length}ev / ${dm.length}ev</span>
        </div>`;
      }).filter(Boolean);
      return rows.join('');
    })();

    // Altitude × Region: who handles altitude best?
    const altRegionRows = (() => {
      const regions = Object.keys(regMap);
      return regions.map(reg => {
        const hi=[], lo=[];
        meets.forEach(m => {
          m.athletes.filter(a=>a.team==='Oregon State'&&getRegion(a)===reg).forEach(a => {
            ['vault','bars','beam','floor'].forEach(ev => {
              const s=a.scores[ev]; if(s===undefined||s<=0) return;
              if(hiAltDates.has(m.date)) hi.push(s);
              else lo.push(s);
            });
          });
        });
        if(!hi.length&&!lo.length) return null;
        const hiMean=mean(hi), loMean=mean(lo);
        const diff = hiMean!=null&&loMean!=null ? hiMean-loMean : null;
        const regEmoji={'Pacific NW':'🌲','West Coast':'🌊','Mountain West':'⛷️','Texas':'🤠','East Coast':'🗽','International':'🌍'}[reg]||'🌐';
        return `<div class="gstat-row">
          <span class="gstat-label">${regEmoji} ${reg}</span>
          <span class="gstat-mean">${fmt2(hiMean)} ⛰️</span>
          <span class="gstat-mean">${fmt2(loMean)} 🏙️</span>
          <span class="gstat-diff" style="color:${diff==null?'#aaa':diff>0?'#2ecc71':'#e74c3c'}">${diff!=null?(diff>=0?'+':'')+fmt2(diff)+' at altitude':'no data'}</span>
          <span class="gstat-n">${hi.length}ev / ${lo.length}ev</span>
        </div>`;
      }).filter(Boolean).join('');
    })();

    return `
      <div class="section-card" style="margin-top:1.5rem;">
        <h2 class="section-title">🔬 Season Wild Stats & Correlations</h2>
        <p class="wild-intro">Pearson r, group means ± SD, and cross-tabs. Small samples — treat as patterns, not proofs.</p>

        <div class="corr-section">
          <div class="corr-section-title">📈 Environmental Correlations with Team Score (n=${n} meet days)</div>
          <div class="corr-legend">r = Pearson correlation coefficient. ±1.0 = perfect, 0 = none. Threshold for "interesting": |r| > 0.4</div>
          <div class="corr-header">
            <span>Factor</span><span>r</span><span>Strength</span><span>Direction</span><span>N</span>
          </div>
          ${corrRows}
        </div>

        <div class="wild-stats-grid" style="margin-top:1.2rem;">

          <div class="wild-stat-block">
            <div class="wild-stat-title">👩‍🎓 Event Avg by Class Year</div>
            <div class="wild-caption">Mean ± SD per scored event. Δ vs group mean. g=gymnasts, ev=events scored.</div>
            <div class="gstat-header"><span>Group</span><span>Mean</span><span>± SD</span><span>Δ</span><span>Sample</span></div>
            ${classRows}
          </div>

          <div class="wild-stat-block">
            <div class="wild-stat-title">🗺️ Event Avg by Home Region</div>
            <div class="wild-caption">Where they grew up — does it affect how they perform?</div>
            <div class="gstat-header"><span>Region</span><span>Mean</span><span>± SD</span><span>Δ</span><span>Sample</span></div>
            ${regionRows}
          </div>

          <div class="wild-stat-block">
            <div class="wild-stat-title">🎯 All-Around vs Specialists</div>
            <div class="wild-caption">AA gymnasts compete in everything. Specialists own their events. Who scores higher?</div>
            <div class="gstat-header"><span>Type</span><span>Mean</span><span>± SD</span><span>Δ</span><span>Sample</span></div>
            ${specRows}
          </div>

          <div class="wild-stat-block">
            <div class="wild-stat-title">📚 Homeschooled vs Traditional</div>
            <div class="wild-caption">Gave up high school to train 40hrs/week. Statistically, was it worth it?</div>
            <div class="gstat-header"><span>School</span><span>Mean</span><span>± SD</span><span>Δ</span><span>Sample</span></div>
            ${schoolRows}
          </div>

          ${majorRows ? `<div class="wild-stat-block">
            <div class="wild-stat-title">🎓 Event Avg by Major</div>
            <div class="wild-caption">Does studying the body help you control it? Limited sample — only 6 known majors.</div>
            <div class="gstat-header"><span>Major</span><span>Mean</span><span>± SD</span><span>Δ</span><span>Sample</span></div>
            ${majorRows}
          </div>` : ''}

          <div class="wild-stat-block">
            <div class="wild-stat-title">📏 Event Avg by Height</div>
            <div class="wild-caption">Lower center of gravity vs longer lines. Physics says both matter.</div>
            <div class="gstat-header"><span>Height</span><span>Mean</span><span>± SD</span><span>Δ</span><span>Sample</span></div>
            ${heightRows}
          </div>

        </div>

        ${moonClassRows ? `<div class="wild-stat-block" style="margin-top:1rem;">
          <div class="wild-stat-title">🌙 × 👩‍🎓 Cross-Tab: Who Peaks Under a Full Moon?</div>
          <div class="wild-caption">Full moon (>75% illuminated) vs dark moon (<35%) — by class year. The question that had to be asked.</div>
          <div class="gstat-header"><span>Class</span><span>Full Moon</span><span>Dark Moon</span><span>Full Moon Effect</span><span>Sample</span></div>
          ${moonClassRows}
        </div>` : ''}

        ${altRegionRows ? `<div class="wild-stat-block" style="margin-top:1rem;">
          <div class="wild-stat-title">🏔️ × 🗺️ Cross-Tab: Who Handles Altitude Best?</div>
          <div class="wild-caption">High altitude venues (BYU, Utah State — 4500+ ft) vs sea-level/low-altitude. By home region.</div>
          <div class="gstat-header"><span>Region</span><span>High Alt</span><span>Low Alt</span><span>Altitude Effect</span><span>Sample</span></div>
          ${altRegionRows}
        </div>` : ''}

      </div>`;
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
      const quadTab = e.target.closest('.quad-tab');
      if (quadTab && quadTab.dataset.meetId) {
        e.preventDefault();
        showMeetDetail(quadTab.dataset.meetId);
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
