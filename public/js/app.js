/* ===== OSU Gymnastics 2026 - App ===== */

(function () {
  'use strict';

  let meets = [];
  let photos = {};
  let bios = {};
  let meetPhotos = {};
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

  // ===== Shared Stats Helpers (delegating to Stats module) =====
  function mean(arr) { return Stats.mean(arr); }
  function stddev(arr) { return Stats.stddev(arr); }
  function pearson(xs, ys) { return Stats.pearson(xs, ys); }
  function fmt(n, dp=3) { return n!=null&&!isNaN(n) ? n.toFixed(dp) : '—'; }

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
      const [meetsRes, photosRes, biosRes, meetPhotosRes] = await Promise.all([fetch('/api/meets'), fetch('/api/photos'), fetch('/api/bios'), fetch('/api/meet-photos')]);
      meets = await meetsRes.json();
      photos = await photosRes.json();
      bios = await biosRes.json();
      meetPhotos = await meetPhotosRes.json();

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
      console.error('[OSU] Fatal render error:', err);
      document.getElementById('loading').style.display = 'block';
      document.getElementById('loading').innerHTML =
        '<div class="empty-state"><div class="empty-icon">😕</div><p class="empty-text">Failed to load data. Is the server running?</p></div>';
    }
  }

  // ===== Navigation =====
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function showView(view) {
    currentView = view;
    scrollToTop();
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

    try {
      if (view === 'season') renderSeason();
      else if (view === 'gymnasts') renderGymnasts();
      else if (view === 'leaderboards') { renderHeatMap(); renderLeaderboard('vault'); }
      else if (view === 'insights') renderInsights();
    } catch (err) {
      console.error('Render error in view "' + view + '":', err);
      const el = document.getElementById('view-' + view);
      if (el) el.innerHTML = '<div style="padding:2rem;text-align:center;"><div style="font-size:2rem;margin-bottom:0.5rem;">⚠️</div><div style="color:#e74c3c;font-family:Oswald;font-size:1.2rem;">Something went wrong</div><p style="color:var(--text-muted);margin-top:0.5rem;">Error rendering this view. Try refreshing the page.</p><pre style="color:#888;font-size:0.75rem;margin-top:1rem;text-align:left;overflow-x:auto;">' + err.message + '</pre></div>';
    }
  }


  // ===== Mission Control Utilities =====
  function animateValue(el, start, end, duration, decimals) {
    if (!el) return;
    const range = end - start;
    const startTime = performance.now();
    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = decimals === 0
        ? Math.round(start + range * ease)
        : (start + range * ease).toFixed(decimals);
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  function mcMean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null; }
  function mcPearson(xs, ys) {
    const n = xs.length; if (n < 3) return null;
    const mx = mcMean(xs), my = mcMean(ys);
    const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
    const den = Math.sqrt(xs.reduce((s,x)=>s+Math.pow(x-mx,2),0)*ys.reduce((s,y)=>s+Math.pow(y-my,2),0));
    return den === 0 ? null : num/den;
  }

  // ===== Mission Control Dashboard =====
  function renderMissionControl() {
    const mc = document.getElementById('missionControl');
    if (!mc) return;

    // Unique competition days
    const compDays = [];
    const seenD = new Set();
    meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(m => {
      if (seenD.has(m.date)) return; seenD.add(m.date);
      if (!m.osuScore || m.osuScore <= 0) return;
      compDays.push({ date: m.date, total: m.osuScore, isHome: m.isHome,
        moonFullness: m.moonPhase?.fullness ?? null,
        elevFt: m.elevationFt ?? null });
    });

    const scoredMeets = meets.filter(m => m.result === 'W' || m.result === 'L');
    const wins = meets.filter(m => m.result === 'W').length;
    const losses = meets.filter(m => m.result === 'L').length;

    // Unique day wins
    const dayWins = new Set(), dayLosses = new Set();
    meets.forEach(m => {
      if (m.result === 'W') dayWins.add(m.date);
      else if (m.result === 'L') dayLosses.add(m.date);
    });

    const allScores = compDays.map(d=>d.total);
    const homeScores = compDays.filter(d=>d.isHome).map(d=>d.total);
    const awayScores = compDays.filter(d=>!d.isHome).map(d=>d.total);
    const teamAvg = mcMean(allScores);
    const homeAvg = mcMean(homeScores);
    const awayAvg = mcMean(awayScores);
    const seasonHigh = allScores.length ? Math.max(...allScores) : null;
    const homeDiff = homeAvg && teamAvg ? homeAvg - teamAvg : null;

    // Season trajectory — first half vs second half
    const half = Math.floor(allScores.length / 2);
    const firstHalf = mcMean(allScores.slice(0, half));
    const secondHalf = mcMean(allScores.slice(half));
    const trajectory = firstHalf && secondHalf ? secondHalf - firstHalf : null;
    const trajArrow = trajectory == null ? '' : trajectory > 0.1 ? '🚀' : trajectory < -0.1 ? '📉' : '→';
    const trajLabel = trajectory == null ? '' : trajectory > 0.1 ? `Up ${trajectory.toFixed(3)} pts vs early season` : trajectory < -0.1 ? `Down ${Math.abs(trajectory).toFixed(3)} pts vs early season` : 'Flat season trend';

    // Event trends — compare first 5 vs last 5 scored meets
    const EVS = ['vault','bars','beam','floor'];
    const EVlabel = {vault:'VAULT',bars:'BARS',beam:'BEAM',floor:'FLOOR'};
    const EVemoji = {vault:'🤸',bars:'💪',beam:'⚖️',floor:'🔥'};

    function eventTrend(ev) {
      const dates = [...seenD].slice().sort();
      const pts = [];
      dates.forEach(date => {
        const m = meets.find(m2=>m2.date===date);
        if (!m) return;
        const osu = m.athletes.filter(a=>a.team==='Oregon State');
        const evScores = osu.map(a=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (evScores.length) pts.push({ date, avg: mcMean(evScores) });
      });
      if (pts.length < 4) return { avg: mcMean(pts.map(p=>p.avg)), trend: 0 };
      const firstAvg = mcMean(pts.slice(0,3).map(p=>p.avg));
      const lastAvg  = mcMean(pts.slice(-3).map(p=>p.avg));
      return { avg: mcMean(pts.map(p=>p.avg)), trend: lastAvg - firstAvg, recent: lastAvg };
    }

    const evData = {};
    EVS.forEach(ev => { evData[ev] = eventTrend(ev); });

    // Hot/Cold gymnasts — last 3 meets vs season avg
    function gymnLastN(name, n) {
      const scored = [];
      const dates = new Set();
      meets.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(m => {
        if (dates.size >= n || dates.has(m.date)) return;
        const a = m.athletes.find(x=>x.name===name&&x.team==='Oregon State');
        if (!a) return;
        const evScores = EVS.map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (!evScores.length) return;
        dates.add(m.date);
        evScores.forEach(s=>scored.push(s));
      });
      return mcMean(scored);
    }
    function gymnSeasonAvg(name) {
      const scores = [];
      const seen = new Set();
      meets.forEach(m => {
        if (seen.has(m.date)) return;
        const a = m.athletes.find(x=>x.name===name&&x.team==='Oregon State');
        if (!a) return;
        const evScores = EVS.map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (!evScores.length) return;
        seen.add(m.date);
        evScores.forEach(s=>scores.push(s));
      });
      return mcMean(scores);
    }

    const gymnasts = [...new Set(meets.flatMap(m=>m.athletes.filter(a=>a.team==='Oregon State').map(a=>a.name)))];
    const gymnForm = gymnasts.map(name => {
      const recent = gymnLastN(name, 3);
      const season = gymnSeasonAvg(name);
      if (!recent || !season) return null;
      return { name, recent, season, diff: recent - season };
    }).filter(Boolean).sort((a,b)=>b.diff-a.diff);

    const hot = gymnForm.slice(0,3).filter(g=>g.diff>0.01);
    const cold = gymnForm.slice(-3).filter(g=>g.diff<-0.01).reverse();

    // Record context
    const need500 = Math.max(0, losses - wins);
    const gamesLeft = meets.filter(m=>m.status==='upcoming').length;
    const recordContext = need500 > 0
      ? `Need ${need500} more W${need500>1?'s':''} to reach .500 — ${gamesLeft} meets left`
      : wins > losses ? `${wins-losses} game${wins-losses>1?'s':''} above .500 🔥` : 'Sitting at .500';

    mc.innerHTML = `
      <div class="mc-header">
        <div class="mc-title">⚡ OSU BEAVERS — 2026 SEASON WAR ROOM</div>
        <div class="mc-subtitle">Women's Gymnastics • Live Analytics</div>
      </div>
      <div class="mc-stat-row">
        <div class="mc-stat-card mc-record">
          <div class="mc-stat-value" id="mcWins">0</div>
          <div class="mc-stat-sub">—</div>
          <div class="mc-stat-value" id="mcLosses">0</div>
          <div class="mc-stat-label">W — L</div>
          <div class="mc-context">${recordContext}</div>
        </div>
        <div class="mc-stat-card">
          <div class="mc-stat-value" id="mcAvg">0.000</div>
          <div class="mc-stat-label">Team Avg</div>
          <div class="mc-context">${trajArrow} ${trajLabel}</div>
        </div>
        <div class="mc-stat-card">
          <div class="mc-stat-value" id="mcHome">0.000</div>
          <div class="mc-stat-label">Home Avg</div>
          <div class="mc-context">${homeAvg && teamAvg ? (homeDiff >= 0 ? '+' : '') + homeDiff.toFixed(3) + ' vs away' : ''}</div>
        </div>
        <div class="mc-stat-card">
          <div class="mc-stat-value" id="mcAway">0.000</div>
          <div class="mc-stat-label">Away Avg</div>
          <div class="mc-context">${awayScores.length} road meet${awayScores.length!==1?'s':''}</div>
        </div>
        <div class="mc-stat-card mc-high">
          <div class="mc-stat-value" id="mcHigh">0.000</div>
          <div class="mc-stat-label">Season High 🏆</div>
          <div class="mc-context">${compDays.find(d=>d.total===seasonHigh)?.date || ''}</div>
        </div>
        ${(() => {
          // Projected NQS: best NQS per event across all meets
          const nqsEvents = ['vault','bars','beam','floor'];
          let bestNqs = 0;
          let hasNqs = false;
          nqsEvents.forEach(ev => {
            let bestEvNqs = 0;
            meets.forEach(m => {
              if (!m.lineups || !m.lineups[ev] || m.lineups[ev].length < 5) return;
              const scores = m.lineups[ev].map(e => e.score).slice().sort((a,b) => a - b);
              const nqs = scores.length >= 6 ? scores.slice(1).reduce((s,v) => s+v, 0) : scores.reduce((s,v) => s+v, 0);
              if (nqs > bestEvNqs) bestEvNqs = nqs;
            });
            if (bestEvNqs > 0) { bestNqs += bestEvNqs; hasNqs = true; }
          });
          return hasNqs ? `<div class="mc-stat-card"><div class="mc-stat-value" style="color:var(--orange)">${bestNqs.toFixed(3)}</div><div class="mc-stat-label">Proj. NQS</div><div class="mc-context">Best per-event NQS combined</div></div>` : '';
        })()}
      </div>

      <div class="mc-event-row">
        ${EVS.map(ev => {
          const d = evData[ev];
          const arrow = d.trend > 0.03 ? '▲' : d.trend < -0.03 ? '▼' : '→';
          const arrowColor = d.trend > 0.03 ? '#2ecc71' : d.trend < -0.03 ? '#e74c3c' : '#aaa';
          const barPct = Math.round(((d.avg||0) - 9.6) / 0.4 * 100);
          return `<div class="mc-event-card">
            <div class="mc-ev-label">${EVemoji[ev]} ${EVlabel[ev]}</div>
            <div class="mc-ev-avg">${d.avg != null ? d.avg.toFixed(3) : '—'}</div>
            <div class="mc-ev-trend" style="color:${arrowColor}">${arrow} ${d.trend!=null?((d.trend>=0?'+':'')+d.trend.toFixed(3)+' trend'):'—'}</div>
            <div class="mc-ev-bar-wrap"><div class="mc-ev-bar" style="width:${Math.max(0,Math.min(100,barPct))}%"></div></div>
          </div>`;
        }).join('')}
      </div>

      <div class="mc-hotcold-row">
        <div class="mc-hot-card">
          <div class="mc-hot-title">🔥 Running Hot <span class="mc-hot-sub">(last 3 meets vs season avg)</span></div>
          ${hot.length ? hot.map(g => `
            <div class="mc-gymnast-row" data-gymnast="${g.name}">
              ${photos[g.name] ? `<img src="${photos[g.name]}" class="mc-tiny-photo">` : '<div class="mc-tiny-photo-placeholder"></div>'}
              <span class="mc-gyname clickable-name" data-gymnast="${g.name}">${g.name}</span>
              <span class="mc-gystat">${g.recent.toFixed(3)}</span>
              <span class="mc-gydiff" style="color:#2ecc71">+${g.diff.toFixed(3)}</span>
            </div>`).join('')
          : '<div class="mc-empty">No hot streaks detected yet</div>'}
        </div>
        <div class="mc-cold-card">
          <div class="mc-hot-title">🧊 Running Cold <span class="mc-hot-sub">(needs a bounce-back)</span></div>
          ${cold.length ? cold.map(g => `
            <div class="mc-gymnast-row" data-gymnast="${g.name}">
              ${photos[g.name] ? `<img src="${photos[g.name]}" class="mc-tiny-photo">` : '<div class="mc-tiny-photo-placeholder"></div>'}
              <span class="mc-gyname clickable-name" data-gymnast="${g.name}">${g.name}</span>
              <span class="mc-gystat">${g.recent.toFixed(3)}</span>
              <span class="mc-gydiff" style="color:#e74c3c">${g.diff.toFixed(3)}</span>
            </div>`).join('')
          : '<div class="mc-empty">No cold streaks — everyone showing up</div>'}
        </div>
      </div>`;

    // Animate the numbers
    setTimeout(() => {
      animateValue(document.getElementById('mcWins'), 0, wins, 800, 0);
      animateValue(document.getElementById('mcLosses'), 0, losses, 800, 0);
      if (teamAvg) animateValue(document.getElementById('mcAvg'), 196, teamAvg, 900, 3);
      if (homeAvg) animateValue(document.getElementById('mcHome'), 196, homeAvg, 900, 3);
      if (awayAvg) animateValue(document.getElementById('mcAway'), 196, awayAvg, 900, 3);
      if (seasonHigh) animateValue(document.getElementById('mcHigh'), 196, seasonHigh, 1000, 3);
    }, 100);
  }

  // ===== Hot Takes Generator =====
  function renderHotTakes() {
    const takes = [];

    // Unique competition days
    const compDays = [];
    const seenD = new Set();
    meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(m => {
      if (seenD.has(m.date)) return; seenD.add(m.date);
      if (!m.osuScore || m.osuScore <= 0) return;
      compDays.push({ date: m.date, total: m.osuScore, isHome: m.isHome,
        moonFullness: m.moonPhase?.fullness ?? null, elevFt: m.elevationFt ?? null,
        tempHigh: m.weather?.tempHighF ?? null });
    });

    // 1. Record framing
    const wins = meets.filter(m=>m.result==='W').length;
    const losses = meets.filter(m=>m.result==='L').length;
    const dayWins = [...new Set(meets.filter(m=>m.result==='W').map(m=>m.date))].length;
    const dayTotal = compDays.length;
    takes.push({
      icon: '📋', color: '#f39c12',
      title: 'The Record Is Complicated',
      body: `The ${wins}-${losses} W-L is based on individual matchup math from quad meets. By competition day, OSU won <strong>${dayWins} of ${dayTotal}</strong> meets — a <strong>${(dayWins/dayTotal*100).toFixed(0)}%</strong> day-win rate. The headline number isn't the whole story.`
    });

    // 2. Moon correlation
    const moonPairs = compDays.filter(d=>d.moonFullness!=null);
    const moonR = mcPearson(moonPairs.map(d=>d.moonFullness), moonPairs.map(d=>d.total));
    if (moonR != null) {
      const absR = Math.abs(moonR);
      const strength = absR > 0.6 ? 'strong' : absR > 0.4 ? 'moderate' : absR > 0.2 ? 'weak' : 'negligible';
      const dir = moonR > 0 ? 'fuller the moon, the higher the score' : 'darker the moon, the higher the score';
      takes.push({
        icon: '🌙', color: '#9b59b6',
        title: moonR > 0.4 ? 'The Moon Is Affecting OSU Scores (No, Really)' : moonR < -0.4 ? 'OSU Scores Higher Under a Dark Moon' : 'Moon Phase: Interesting But Not Decisive',
        body: `Pearson r = <strong>${moonR.toFixed(2)}</strong> between moon fullness and team score. That's a <strong>${strength}</strong> correlation — the ${dir}. ${absR > 0.5 ? 'At this sample size (n=' + moonPairs.length + '), that\'s actually statistically meaningful. 🤯' : 'With only ' + moonPairs.length + ' data points, keep your astrology hat on but don\'t bet your season on it.'}`
      });
    }

    // 3. Altitude effect
    const hiAlt = compDays.filter(d=>d.elevFt!=null&&d.elevFt>2000);
    const loAlt = compDays.filter(d=>d.elevFt!=null&&d.elevFt<=2000);
    if (hiAlt.length && loAlt.length) {
      const hiAvg = mean(hiAlt.map(d=>d.total));
      const loAvg = mean(loAlt.map(d=>d.total));
      const diff = hiAvg - loAvg;
      takes.push({
        icon: '🏔️', color: '#27ae60',
        title: diff < -0.1 ? 'Altitude Is Genuinely Hurting OSU' : diff > 0.1 ? 'OSU Somehow Scores Better at Altitude' : 'Altitude Effect: Smaller Than Expected',
        body: `At high-altitude venues (BYU: 4,549ft, Utah State: 4,780ft), OSU averages <strong>${fmt(hiAvg)}</strong>. At sea-level/low venues: <strong>${fmt(loAvg)}</strong>. That's a <strong>${diff >= 0 ? '+' : ''}${fmt(diff)}</strong> point difference. ${diff < -0.2 ? 'The thin air at Logan and Provo is a real factor — that\'s ~0.X pts per event across 4 events.' : diff > 0 ? 'Counterintuitive — the team may be mentally sharper at big-venue meets.' : 'The gymnasts are adapting better than expected.'}`
      });
    }

    // 4. Class year leader
    const clsGroups = {};
    meets.forEach(m => {
      m.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
        const cls = bios[a.name]?.classYear; if (!cls) return;
        const scores = ['vault','bars','beam','floor'].map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (!scores.length) return;
        if (!clsGroups[cls]) clsGroups[cls] = {scores:[],names:new Set()};
        scores.forEach(s=>clsGroups[cls].scores.push(s));
        clsGroups[cls].names.add(a.name);
      });
    });
    const clsRanked = Object.entries(clsGroups).map(([cls,g])=>({cls, avg: mean(g.scores), n: g.names.size})).filter(x=>x.avg).sort((a,b)=>b.avg-a.avg);
    if (clsRanked.length >= 2) {
      const top = clsRanked[0], bottom = clsRanked[clsRanked.length-1];
      const spread = top.avg - bottom.avg;
      takes.push({
        icon: '👩‍🎓', color: '#e67e22',
        title: `${top.cls}s Are Running This Team`,
        body: `By class year, <strong>${top.cls}s</strong> lead with a <strong>${fmt(top.avg)}</strong> event avg (${top.n} gymnasts). <strong>${bottom.cls}s</strong> are at the other end at <strong>${fmt(bottom.avg)}</strong> — a <strong>${fmt(spread)}</strong> pt spread per event. ${top.cls==='Freshman'?'The freshmen class came ready to compete.' : top.cls==='Senior'?'The veterans are carrying it home in their final season.' : top.cls==='Junior'?'Junior year is peak performance — the data agrees.' : 'Sophomore spike is real.'}`
      });
    }

    // 5. Homeschool stat
    const hsScores = [], tradScores = [];
    const hsNames = new Set(), tradNames = new Set();
    meets.forEach(m => {
      m.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
        const hs = bios[a.name]?.highSchool||'';
        const isHome = /connections academy|acellus|home school|homeschool|online|odyssey charter/i.test(hs);
        const scores = ['vault','bars','beam','floor'].map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (!scores.length) return;
        if (isHome) { scores.forEach(s=>hsScores.push(s)); hsNames.add(a.name); }
        else { scores.forEach(s=>tradScores.push(s)); tradNames.add(a.name); }
      });
    });
    if (hsScores.length && tradScores.length) {
      const hsAvg = mean(hsScores), tradAvg = mean(tradScores);
      const diff = hsAvg - tradAvg;
      takes.push({
        icon: '📚', color: '#3498db',
        title: diff > 0.02 ? 'Skipping Prom to Train: Still Paying Off' : diff < -0.02 ? 'Traditional School Athletes Have the Edge' : 'Homeschool vs Traditional: Too Close to Call',
        body: `<strong>${hsNames.size} gymnasts</strong> were homeschooled to train full-time and average <strong>${fmt(hsAvg)}</strong>/event. The <strong>${tradNames.size} traditionally schooled</strong> gymnasts average <strong>${fmt(tradAvg)}</strong>. Difference: <strong>${diff>=0?'+':''}${fmt(diff)}</strong>. ${Math.abs(diff) > 0.05 ? 'Meaningful gap at this sample size.' : 'Statistically, it\'s a wash — both paths work.'}`
      });
    }

    // 6. Home vs away — how big is the Gill advantage?
    const homeScores = compDays.filter(d=>d.isHome).map(d=>d.total);
    const awayScores2 = compDays.filter(d=>!d.isHome).map(d=>d.total);
    if (homeScores.length && awayScores2.length) {
      const hAvg = mean(homeScores), aAvg = mean(awayScores2);
      const diff = hAvg - aAvg;
      takes.push({
        icon: '🏠', color: '#e74c3c',
        title: diff > 0.2 ? 'Gill Coliseum Is a Genuine Home Court Advantage' : diff > 0 ? 'Home Field Exists But It\'s Subtle' : 'OSU Actually Scores Better on the Road',
        body: `Gill Coliseum average: <strong>${fmt(hAvg)}</strong>. Road average: <strong>${fmt(aAvg)}</strong>. Home advantage: <strong>${diff>=0?'+':''}${fmt(diff)}</strong> pts per meet. ${diff > 0.3 ? 'That\'s massive — home crowd, familiar chalk, no jet lag.' : diff > 0.1 ? 'A real but modest edge.' : diff > 0 ? 'Minimal — this team travels well.' : 'The road wakes this team up. They\'re actually better away from home. 👀'}`
      });
    }

    // 7. Hottest gymnast right now
    function gymnLastAvg(name, n) {
      const scores = []; const seen = new Set();
      meets.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(m => {
        if (seen.size>=n||seen.has(m.date)) return;
        const a = m.athletes.find(x=>x.name===name&&x.team==='Oregon State');
        if (!a) return;
        const ev = ['vault','bars','beam','floor'].map(e=>a.scores[e]).filter(s=>s!==undefined&&s>0);
        if (!ev.length) return;
        seen.add(m.date); ev.forEach(s=>scores.push(s));
      });
      return mean(scores);
    }
    function gymnSeasonAvg2(name) {
      const scores = []; const seen = new Set();
      meets.forEach(m => {
        if (seen.has(m.date)) return;
        const a = m.athletes.find(x=>x.name===name&&x.team==='Oregon State');
        if (!a) return;
        const ev = ['vault','bars','beam','floor'].map(e=>a.scores[e]).filter(s=>s!==undefined&&s>0);
        if (!ev.length) return;
        seen.add(m.date); ev.forEach(s=>scores.push(s));
      });
      return mean(scores);
    }
    const allNames = [...new Set(meets.flatMap(m=>m.athletes.filter(a=>a.team==='Oregon State').map(a=>a.name)))];
    const formList = allNames.map(name => {
      const last = gymnLastAvg(name, 3), season = gymnSeasonAvg2(name);
      if (!last||!season) return null;
      return { name, last, season, diff: last-season };
    }).filter(Boolean).sort((a,b)=>b.diff-a.diff);

    if (formList[0] && formList[0].diff > 0.02) {
      const h = formList[0];
      takes.push({
        icon: '🔥', color: '#e74c3c',
        title: `${h.name.split(' ')[0]} Is the Hottest Gymnast on the Roster Right Now`,
        body: `Over her last 3 meets, <strong class="clickable-name" data-gymnast="${h.name}">${h.name}</strong> is averaging <strong>${fmt(h.last)}</strong>/event — that's <strong>+${fmt(h.diff)}</strong> above her <strong>${fmt(h.season)}</strong> season average. Peak season form heading into postseason.`
      });
    }

    // 8. Biggest surprise — who's overperforming their billing?
    const specList = allNames.map(name => {
      const pos = bios[name]?.position;
      if (pos === 'All-Around') return null; // they're expected to score everywhere
      if (!pos) return null;
      const season = gymnSeasonAvg2(name);
      return season ? { name, pos, season } : null;
    }).filter(Boolean).sort((a,b)=>b.season-a.season);

    if (specList.length) {
      const topSpec = specList[0];
      takes.push({
        icon: '🎯', color: '#1abc9c',
        title: `Best Specialist Performance: ${topSpec.name.split(' ')[0]}`,
        body: `<strong class="clickable-name" data-gymnast="${topSpec.name}">${topSpec.name}</strong> competes as a <strong>${topSpec.pos}</strong> specialist and is averaging <strong>${fmt(topSpec.season)}</strong>/event — a focused, ruthless approach to doing one or two things at the highest level.`
      });
    }

    if (!takes.length) return '';

    return `
      <div class="takes-section">
        <h2 class="takes-title">🎙️ Hot Takes — Auto-Generated From The Data</h2>
        <p class="takes-subtitle">Every sentence below is computed live from the season stats. No humans were harmed in the writing of these takes.</p>
        <div class="takes-grid">
          ${takes.map(t => `
            <div class="take-card" style="border-left-color:${t.color}">
              <div class="take-icon">${t.icon}</div>
              <div class="take-body">
                <div class="take-title">${t.title}</div>
                <div class="take-text">${t.body}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // ===== Gymnast Heat Map =====
  function renderHeatMap() {
    const ll = document.getElementById('leaderboardList');
    if (!ll) return;

    const EVS = ['vault','bars','beam','floor'];
    const EVlabel = {vault:'VAULT',bars:'BARS',beam:'BEAM',floor:'FLOOR'};

    // Per-gymnast, per-event averages
    const gymnData = {};
    const seen = new Set();
    meets.forEach(m => {
      m.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
        if (!gymnData[a.name]) gymnData[a.name] = {vault:[],bars:[],beam:[],floor:[]};
        EVS.forEach(ev => {
          const s = a.scores[ev];
          if (s !== undefined && s > 0) {
            // Dedup per date
            const key = `${a.name}|${ev}|${m.date}`;
            if (!seen.has(key)) { seen.add(key); gymnData[a.name][ev].push(s); }
          }
        });
      });
    });

    // Team averages per event
    const teamAvgs = {};
    EVS.forEach(ev => {
      const all = Object.values(gymnData).flatMap(g=>g[ev]);
      teamAvgs[ev] = mcMean(all);
    });

    // Sort gymnasts by overall avg
    const gymnList = Object.entries(gymnData).map(([name, evData]) => {
      const allScores = EVS.flatMap(ev=>evData[ev]);
      const overallAvg = mcMean(allScores);
      const evAvgs = {};
      EVS.forEach(ev => { evAvgs[ev] = mcMean(evData[ev]); });
      return { name, overallAvg, evAvgs };
    }).filter(g=>g.overallAvg).sort((a,b)=>b.overallAvg-a.overallAvg);

    function heatColor(val, teamAvg) {
      if (!val || !teamAvg) return '#1e1e1e';
      const diff = val - teamAvg;
      if (diff > 0.15) return 'rgba(46,204,113,0.55)';
      if (diff > 0.08) return 'rgba(46,204,113,0.35)';
      if (diff > 0.03) return 'rgba(46,204,113,0.18)';
      if (diff > -0.03) return 'rgba(255,255,255,0.06)';
      if (diff > -0.08) return 'rgba(231,76,60,0.2)';
      if (diff > -0.15) return 'rgba(231,76,60,0.35)';
      return 'rgba(231,76,60,0.55)';
    }

    ll.innerHTML = `
      <div class="heatmap-wrapper">
        <div class="heatmap-legend">
          <span>🟥 Below team avg</span>
          <span style="margin:0 1rem;">⬛ Near avg</span>
          <span>🟩 Above team avg</span>
          <span style="margin-left:1rem;color:#555">Team avgs: ${EVS.map(ev=>`${EVlabel[ev].toLowerCase()} ${teamAvgs[ev]!=null?teamAvgs[ev].toFixed(3):'—'}`).join(' • ')}</span>
        </div>
        <div class="heatmap-table-wrap">
          <table class="heatmap-table">
            <thead>
              <tr>
                <th class="hm-name">Gymnast</th>
                ${EVS.map(ev=>`<th>${EVlabel[ev]}</th>`).join('')}
                <th>OVERALL</th>
              </tr>
            </thead>
            <tbody>
              ${gymnList.map((g,i) => `
                <tr>
                  <td class="hm-name">
                    ${photos[g.name]?`<img src="${photos[g.name]}" class="hm-photo">`:''}
                    <span class="clickable-name" data-gymnast="${g.name}">${g.name}</span>
                    ${bios[g.name]?.position&&bios[g.name].position!=='All-Around'?`<span class="hm-spec-badge">SPEC</span>`:''}
                  </td>
                  ${EVS.map(ev => {
                    const val = g.evAvgs[ev];
                    const bg = heatColor(val, teamAvgs[ev]);
                    const diff = val && teamAvgs[ev] ? val - teamAvgs[ev] : null;
                    return `<td class="hm-cell" style="background:${bg}" title="${val?val.toFixed(3):'—'} (${diff!=null?(diff>=0?'+':'')+diff.toFixed(3):'no data'} vs team)">
                      ${val ? val.toFixed(3) : '—'}
                      ${diff!=null?`<span class="hm-diff" style="color:${diff>=0?'#2ecc71':'#e74c3c'}">${diff>=0?'+':''}${diff.toFixed(3)}</span>`:''}
                    </td>`;
                  }).join('')}
                  <td class="hm-cell hm-overall">${g.overallAvg.toFixed(3)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
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

    document.getElementById('seasonRecord').innerHTML = '';
    renderMissionControl();

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
          try { rendered.push(renderQuadGroup(quadMeets)); } catch (err) {
            console.error('Error rendering quad group:', err);
            rendered.push('<div class="meet-card" style="border:1px solid #e74c3c;padding:1rem;text-align:center;"><span style="color:#e74c3c;">⚠️ Error loading meet group</span></div>');
          }
        }
      } else {
        try { rendered.push(renderMeetCard(m)); } catch (err) {
          console.error('Error rendering meet card:', err);
          rendered.push('<div class="meet-card" style="border:1px solid #e74c3c;padding:1rem;text-align:center;"><span style="color:#e74c3c;">⚠️ Error loading meet: ' + (m.opponent || m.id) + '</span></div>');
        }
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

    // Meet card thumbnail from photos
    const mpThumb = meetPhotos[m.date]?.heroImage;
    const thumbHtml = mpThumb ? `
      <div class="meet-card-thumb" style="position:relative;height:110px;overflow:hidden;border-radius:8px 8px 0 0;margin:-1rem -1rem 0.75rem -1rem;">
        <img src="${mpThumb}" alt="${m.opponent}" style="width:100%;height:100%;object-fit:cover;object-position:center center;" loading="lazy" onerror="this.parentElement.style.display='none'">
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(26,26,26,0.95) 0%,rgba(26,26,26,0.1) 60%,transparent 100%)"></div>
      </div>` : '';

    // Upcoming placeholder card
    if (m.status === 'upcoming') {
      const competitorsList = m.competitors ? m.competitors.map(c =>
        `<div style="padding:0.25rem 0;color:${c.includes('Oregon State') ? 'var(--orange)' : '#ccc'};font-size:0.85rem;">${c}</div>`
      ).join('') : '';
      const noteHtml = m.note ? `<div style="color:var(--text-muted);font-size:0.75rem;margin-top:0.5rem;font-style:italic;">${m.note}</div>` : '';
      return `
        <div class="meet-card" data-meet-id="${m.id}" style="overflow:hidden;border:1px solid var(--orange);border-top:3px solid var(--orange);">
          ${thumbHtml}
          <div class="meet-header">
            <div>
              <div class="meet-opponent">${m.opponent}${m.isHome ? '<span class="badge badge-home">HOME</span>' : ''} ${statusBadge}</div>
              <div class="meet-date">${formatDateLong(m.date)}</div>
              <div class="meet-location">${m.location}</div>
            </div>
            <span class="badge badge-upcoming">UPCOMING</span>
          </div>
          ${competitorsList ? `<div style="margin-top:0.75rem;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.03);border-radius:6px;">
            <div style="font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Competitors</div>
            ${competitorsList}
          </div>` : ''}
          ${noteHtml}
        </div>`;
    }

    const resultBadge = m.result
      ? `<span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>`
      : '<span class="badge badge-upcoming">—</span>';

    const eventBars = (!m.events || !m.events.vault) ? '' : ['vault', 'bars', 'beam', 'floor'].map(e => {
      const evData = m.events[e];
      if (!evData || evData.osu == null) return '';
      const pct = ((evData.osu / 50) * 100).toFixed(1);
      return `
        <div class="event-bar-item">
          <div class="event-bar-label">
            <span>${EVENT_SHORT[e]}</span>
            <span>${evData.osu.toFixed(3)}</span>
          </div>
          <div class="event-bar-track">
            <div class="event-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="meet-card${m.status === 'in_progress' ? ' meet-card-live' : ''}" data-meet-id="${m.id}" style="overflow:hidden;">
        ${thumbHtml}
        <div class="meet-header">
          <div>
            <div class="meet-opponent">${m.opponent}${m.isHome ? '<span class="badge badge-home">HOME</span>' : ''} ${statusBadge}</div>
            <div class="meet-date">${formatDateLong(m.date)}</div>
            <div class="meet-location">${m.location}</div>
          </div>
          ${resultBadge}
        </div>
        <div class="meet-scores">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu">${m.osuScore != null ? m.osuScore.toFixed(3) : "TBD"}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name">Opponent</div><div class="score">${m.opponentScore != null ? m.opponentScore.toFixed(3) : "TBD"}</div></div>
        </div>
        <div class="event-bars">${eventBars}</div>
      </div>`;
  }

  function renderQuadGroup(quadMeets) {
    const first = quadMeets[0];
    const isUpcoming = first.status === 'upcoming';
    const isLive = quadMeets.some(m => m.status === 'in_progress');
    const liveBadge = isLive ? '<span class="badge badge-live">🔴 LIVE</span>' : '';

    // Quad card photo banner
    const qThumb = meetPhotos[first.date]?.heroImage;
    const qThumbHtml = qThumb ? `<div class="quad-banner-click" data-quad-name="${first.quadName}" data-quad-date="${first.date}" style="height:90px;overflow:hidden;position:relative;cursor:pointer;">
      <img src="${qThumb}" alt="${first.quadName}" style="width:100%;height:100%;object-fit:cover;object-position:center center;" loading="lazy" onerror="this.parentElement.style.display='none'">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 30%,var(--card))"></div>
    </div>` : '';

    // Upcoming quad placeholder
    if (isUpcoming) {
      const competitorsList = first.competitors ? first.competitors.map(c =>
        `<div style="padding:0.3rem 0.5rem;color:${c.includes('Oregon State') ? 'var(--orange)' : '#ccc'};font-size:0.9rem;${c.includes('Oregon State') ? 'font-weight:600;' : ''}">${c}</div>`
      ).join('') : '';
      const noteHtml = first.note ? `<div style="color:var(--text-muted);font-size:0.75rem;padding:0 0.75rem 0.75rem;font-style:italic;">${first.note}</div>` : '';
      return `
        <div class="quad-group meet-card" data-meet-id="${first.id}" style="border:1px solid var(--orange);border-top:3px solid var(--orange);border-radius:12px;overflow:hidden;background:var(--card);cursor:pointer;">
          ${qThumbHtml}
          <div style="background:var(--black);padding:0.75rem 1rem;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span style="font-family:Oswald;font-size:1.1rem;color:var(--orange);">${first.quadName}</span>
              <span class="badge badge-upcoming" style="margin-left:0.5rem;">UPCOMING</span>
            </div>
            <div style="display:flex;gap:0.5rem;align-items:center;">
              <span style="color:#999;font-size:0.8rem;">${formatDate(first.date)} · ${first.location}</span>
            </div>
          </div>
          ${competitorsList ? `<div style="padding:0.75rem;">
            <div style="font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Competitors</div>
            ${competitorsList}
          </div>` : ''}
          ${noteHtml}
        </div>`;
    }

    const wins = quadMeets.filter(m => m.result === 'W').length;
    const losses = quadMeets.filter(m => m.result === 'L').length;

    const matchupRows = quadMeets.map(m => `
      <div class="quad-matchup meet-card" data-meet-id="${m.id}" style="margin:0;border-radius:8px;cursor:pointer;">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1rem;">${m.opponent} ${getStatusBadge(m)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span style="font-family:Oswald;color:var(--orange);font-size:1rem;">${m.osuScore != null ? m.osuScore.toFixed(3) : "TBD"}</span>
            <span style="color:var(--text-muted);">–</span>
            <span style="font-size:1rem;">${m.opponentScore != null ? m.opponentScore.toFixed(3) : "TBD"}</span>
            ${m.result ? `<span class="badge badge-${m.result.toLowerCase()}">${m.result}</span>` : ''}
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="quad-group" style="border:1px solid ${isLive ? 'rgba(255,68,68,0.5)' : '#333'};border-radius:12px;overflow:hidden;background:var(--card);">
        ${qThumbHtml}
        <div style="background:var(--black);padding:0.75rem 1rem;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
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
          <div style="color:#888;font-size:0.8rem;padding-bottom:0.25rem;">OSU: ${first.osuScore != null ? first.osuScore.toFixed(3) : 'TBD'}</div>
          ${matchupRows}
        </div>
      </div>`;
  }

  // ===== Quad Meet Overview =====
  function showQuadOverview(quadName, date) {
    _meetDetailOrigin = currentView;
    const siblings = meets.filter(m => m.quadMeet && m.quadName === quadName && m.date === date);
    if (!siblings.length) return;

    scrollToTop();
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    const content = document.getElementById('meetDetailContent');
    const first = siblings[0];

    // Build tabs — Overview is active
    const overviewTabActive = `<button class="quad-tab quad-tab-overview active" data-quad-overview="${quadName}|${date}">🏆 Overview</button>`;
    const siblingTabs = siblings.map(s =>
      `<button class="quad-tab" data-meet-id="${s.id}">vs ${s.opponent} <span class="quad-tab-result ${s.result?.toLowerCase()}">${s.result||''}</span></button>`
    ).join('');

    const quadNav = `
      <div class="quad-nav">
        <div class="quad-nav-label">🏆 ${quadName}</div>
        <div class="quad-nav-tabs">${overviewTabActive}${siblingTabs}</div>
      </div>`;

    // Hero photo
    const mpData = meetPhotos[date];
    const heroImg = mpData?.heroImage;
    const heroHtml = heroImg ? `
      <div style="position:relative;width:100%;height:220px;overflow:hidden;border-radius:12px;margin-bottom:1rem;">
        <img src="${heroImg}" alt="${quadName}" style="width:100%;height:100%;object-fit:cover;object-position:center center;" loading="lazy" onerror="this.parentElement.style.display='none'">
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.7) 0%,transparent 50%)"></div>
        <div style="position:absolute;bottom:0.75rem;left:1rem;">
          <span style="color:#fff;font-family:Oswald;font-size:1.2rem;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,0.9)">${quadName}</span>
          <div style="color:rgba(255,255,255,0.7);font-size:0.75rem;margin-top:0.2rem">${formatDateLong(date)} · ${first.location}</div>
        </div>
      </div>` : '';

    // Full standings (allTeams from any sibling)
    const allTeams = first.allTeams || [];
    const osuRank = allTeams.findIndex(t => t.team.toLowerCase().includes('oregon')) + 1;
    const rankEmoji = ['🥇','🥈','🥉','4️⃣'][osuRank - 1] || '';

    const standingsRows = allTeams.map((t, i) => {
      const isOSU = t.team.toLowerCase().includes('oregon');
      const medals = ['🥇','🥈','🥉',''];
      return `<tr class="${isOSU ? 'osu-row' : ''}">
        <td style="font-size:1.1rem">${medals[i] || i+1}</td>
        <td><strong>${t.team}</strong></td>
        <td>${t.vault?.toFixed(3) ?? '—'}</td>
        <td>${t.bars?.toFixed(3) ?? '—'}</td>
        <td>${t.beam?.toFixed(3) ?? '—'}</td>
        <td>${t.floor?.toFixed(3) ?? '—'}</td>
        <td style="font-family:Oswald;font-size:1.05rem;color:${isOSU?'var(--osu-orange)':'inherit'}">${t.total != null ? t.total.toFixed(3) : '—'}</td>
      </tr>`;
    }).join('');

    // Per-event winner cards
    const EVENTS = ['vault','bars','beam','floor'];
    const evLabels = {vault:'Vault 🤸',bars:'Bars 💫',beam:'Beam ⚖️',floor:'Floor 🔥'};
    const evCards = EVENTS.map(ev => {
      const sorted = [...allTeams].sort((a,b) => (b[ev]||0) - (a[ev]||0));
      const winner = sorted[0];
      const isOSUWin = winner?.team.toLowerCase().includes('oregon');
      return `
        <div style="background:var(--card);border-radius:10px;padding:0.85rem;border:1px solid ${isOSUWin ? 'var(--osu-orange)' : '#333'}">
          <div style="font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem">${evLabels[ev]}</div>
          ${sorted.map((t,i) => {
            const isOSU = t.team.toLowerCase().includes('oregon');
            const score = t[ev];
            if (!score) return '';
            const pct = ((score / sorted[0][ev]) * 100).toFixed(0);
            return `
              <div style="margin-bottom:0.35rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.15rem">
                  <span style="font-size:0.78rem;color:${isOSU?'var(--osu-orange)':i===0?'#fff':'#aaa'};font-weight:${i===0?'700':'400'}">${t.team.replace('Oregon State','OSU').replace('Washington','UW').replace('California','Cal').replace('Arizona State','ASU').replace('Kent State','Kent')}</span>
                  <span style="font-family:Oswald;font-size:0.85rem;color:${isOSU?'var(--osu-orange)':i===0?'#fff':'#aaa'}">${score.toFixed(3)}</span>
                </div>
                <div style="height:3px;background:#333;border-radius:2px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${isOSU?'var(--osu-orange)':i===0?'#fff':'#555'};border-radius:2px"></div>
                </div>
              </div>`;
          }).join('')}
        </div>`;
    }).join('');

    // Top individual performers across ALL teams in this quad
    const allAthletes = [];
    siblings.forEach(s => {
      (s.athletes || []).forEach(a => {
        EVENTS.forEach(ev => {
          if (a.scores[ev] !== undefined) {
            allAthletes.push({ name: a.name, team: a.team, event: ev, score: a.scores[ev] });
          }
        });
      });
    });
    // Best per event (deduplicated by athlete+event)
    const topByEvent = EVENTS.map(ev => {
      const evScores = allAthletes.filter(x => x.event === ev);
      const dedupMap = {};
      evScores.forEach(x => {
        const key = x.name + '|' + x.team;
        if (!dedupMap[key] || dedupMap[key].score < x.score) dedupMap[key] = x;
      });
      return Object.values(dedupMap).sort((a,b) => b.score - a.score).slice(0, 3);
    });

    const topRows = EVENTS.map((ev, ei) => {
      return topByEvent[ei].map((x, rank) => {
        const isOSU = x.team.toLowerCase().includes('oregon');
        const medals = ['🥇','🥈','🥉'];
        const isClickable = isOSU;
        const nameHtml = isClickable
          ? `<span class="clickable-name" data-gymnast="${x.name}" style="color:var(--osu-orange)">${x.name}</span>`
          : `<span style="color:#ccc">${x.name}</span>`;
        return `<tr>
          <td style="color:#888;font-size:0.75rem">${medals[rank]||rank+1}</td>
          <td style="font-size:0.8rem">${EVENT_SHORT[ev]}</td>
          <td>${nameHtml}</td>
          <td style="color:${isOSU?'var(--osu-orange)':'#888'};font-size:0.7rem">${x.team.replace('Oregon State','OSU')}</td>
          <td style="font-family:Oswald;color:${rank===0?'#fff':'#aaa'}">${x.score.toFixed(3)}</td>
        </tr>`;
      }).join('');
    }).join('');

    // OSU summary callout
    const osuWins = siblings.filter(m => m.result === 'W').length;
    const osuLosses = siblings.filter(m => m.result === 'L').length;
    const osuScore = first.osuScore;
    const summaryColor = osuRank === 1 ? '#4caf50' : osuRank === 2 ? '#ff9800' : '#ef5350';

    content.innerHTML = `
      <button class="back-btn" id="backFromQuadOverview">← Back</button>
      ${quadNav}
      ${heroHtml}

      <div class="section-card" style="border-left:3px solid ${summaryColor}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
          <div>
            <div style="font-family:Oswald;font-size:1.3rem">${rankEmoji} Oregon State finished <strong style="color:${summaryColor}">${['1st','2nd','3rd','4th'][osuRank-1]||osuRank+'th'}</strong></div>
            <div style="color:#aaa;font-size:0.85rem;margin-top:0.2rem">${osuScore != null ? osuScore.toFixed(3) : 'TBD'} total · ${osuWins}W–${osuLosses}L in matchups</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:Oswald;font-size:1.8rem;color:var(--osu-orange)">${osuScore != null ? osuScore.toFixed(3) : 'TBD'}</div>
            <div style="font-size:0.7rem;color:#888">Oregon State</div>
          </div>
        </div>
      </div>

      <div class="section-card">
        <h2 class="section-title">📊 Full Standings</h2>
        <div style="overflow-x:auto">
          <table class="all-teams-table">
            <thead><tr><th></th><th>Team</th><th>VT</th><th>UB</th><th>BB</th><th>FX</th><th>Total</th></tr></thead>
            <tbody>${standingsRows}</tbody>
          </table>
        </div>
      </div>

      <div class="section-card">
        <h2 class="section-title">🎯 Event Breakdown</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">${evCards}</div>
      </div>

      <div class="section-card">
        <h2 class="section-title">⭐ Top Scores — All Teams</h2>
        <p style="color:#888;font-size:0.8rem;margin-bottom:0.75rem">Best individual scores across all competitors in this quad. OSU names are clickable.</p>
        <div style="overflow-x:auto">
          <table class="lineup-table">
            <thead><tr><th></th><th>Ev</th><th>Athlete</th><th>Team</th><th style="text-align:right">Score</th></tr></thead>
            <tbody>${topRows}</tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('backFromQuadOverview').addEventListener('click', () => showView(_meetDetailOrigin));
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

    // ── Context favorability score ──────────────────────────────────────────
    // Based on season-wide correlations, rate each factor as favorable/neutral/unfavorable for this meet
    const favorability = [];
    // Moon: negative correlation with score (r=-0.23) → darker moon = slightly better scores
    if (moon.fullness < 0.3) favorability.push({ label: 'Moon', rating: 'favorable', why: `${moon.emoji} Dark moon (${(moon.fullness*100).toFixed(0)}%) — OSU trends slightly higher under darker moons (r=−0.23)` });
    else if (moon.fullness > 0.7) favorability.push({ label: 'Moon', rating: 'unfavorable', why: `${moon.emoji} Full moon (${(moon.fullness*100).toFixed(0)}%) — OSU's worst results have come under bright moons` });
    else favorability.push({ label: 'Moon', rating: 'neutral', why: `${moon.emoji} Quarter moon (${(moon.fullness*100).toFixed(0)}%) — neutral lunar context` });
    // Elevation: negative correlation → high altitude is bad
    if (elev > 3000) favorability.push({ label: 'Elevation', rating: 'unfavorable', why: `🏔️ High altitude (${elev.toLocaleString()}ft) — thin air hurts OSU scores` });
    else if (elev < 500) favorability.push({ label: 'Elevation', rating: 'favorable', why: `🏙️ Sea level (${elev}ft) — OSU's best conditions` });
    else favorability.push({ label: 'Elevation', rating: 'neutral', why: `⛰️ Moderate altitude (${elev.toLocaleString()}ft)` });
    // Distance: negative correlation → far is bad
    if (dist > 1500) favorability.push({ label: 'Distance', rating: 'unfavorable', why: `✈️ ${dist.toLocaleString()} miles from home — long haul hurts` });
    else if (dist === 0) favorability.push({ label: 'Distance', rating: 'favorable', why: `🏠 Home game — maximum favorable` });
    else if (dist < 400) favorability.push({ label: 'Distance', rating: 'favorable', why: `🚗 Regional trip (${dist} miles) — minimal travel impact` });
    else favorability.push({ label: 'Distance', rating: 'neutral', why: `🚌 Mid-range trip (${dist} miles)` });

    const favScore = favorability.filter(f=>f.rating==='favorable').length;
    const unfavScore = favorability.filter(f=>f.rating==='unfavorable').length;
    const overallCtx = favScore > unfavScore ? '✅ Context was favorable for OSU' : unfavScore > favScore ? '⚠️ Tough environmental conditions' : '⚖️ Mixed conditions';
    const ctxColor = favScore > unfavScore ? '#2ecc71' : unfavScore > favScore ? '#e74c3c' : '#f39c12';

    return `
      <div class="section-card wild-card">
        <h2 class="section-title">🎲 Meet Trivia & Context</h2>
        <div class="ctx-summary" style="border-color:${ctxColor}">
          <span class="ctx-verdict" style="color:${ctxColor}">${overallCtx}</span>
          <div class="ctx-pills">
            ${favorability.map(f=>`<span class="ctx-pill ctx-${f.rating}" title="${f.why}">${f.label}: ${f.rating==='favorable'?'✅':f.rating==='unfavorable'?'⚠️':'—'}</span>`).join('')}
          </div>
        </div>
        <div class="wild-grid">
          <div class="wild-item">${moonInsight}</div>
          <div class="wild-item">${elevInsight}</div>
          <div class="wild-item">${distInsight}</div>
          ${weatherInsight ? `<div class="wild-item">${weatherInsight}</div>` : ''}
          <div class="wild-item">👩‍🎓 <strong>Experience on the floor:</strong> ${classBreakdown || 'Unknown'}</div>
          ${closestToHome.length > 0 ? `<div class="wild-item">🏡 <strong>Playing near home:</strong> ${closestToHome.map(a=>a.name).join(', ')} grew up in ${meetState}!</div>` : ''}
          ${meetGroupItems.map(i=>`<div class="wild-item">${i}</div>`).join('')}
        </div>
      </div>
    `;
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

    scrollToTop();
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-meet');
    view.style.display = 'block';

    const content = document.getElementById('meetDetailContent');

    try { _showMeetDetailInner(meet, content, view); } catch (err) {
      console.error('Error rendering meet detail:', err);
      content.innerHTML = '<div style="padding:2rem;text-align:center;"><div style="font-size:2rem;margin-bottom:0.5rem;">⚠️</div><div style="color:#e74c3c;font-family:Oswald;font-size:1.2rem;">Error loading meet details</div><p style="color:var(--text-muted);margin-top:0.5rem;">Could not render this meet. It may have incomplete data.</p><pre style="color:#888;font-size:0.75rem;margin-top:1rem;text-align:left;overflow-x:auto;">' + err.message + '</pre><button class="back-btn" onclick="history.back()" style="margin-top:1rem;">← Go Back</button></div>';
    }
  }

  function _showMeetDetailInner(meet, content, view) {

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
                  <td>${t.vault?.toFixed(3) ?? '—'}</td><td>${t.bars?.toFixed(3) ?? '—'}</td>
                  <td>${t.beam?.toFixed(3) ?? '—'}</td><td>${t.floor?.toFixed(3) ?? '—'}</td>
                  <td><strong>${t.total != null ? t.total.toFixed(3) : '—'}</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Event detail cards with athlete lineups + NQS
    const eventCards = (!meet.events || !meet.events.vault) ? [] : ['vault', 'bars', 'beam', 'floor'].map(event => {
      const osuScore = meet.events[event]?.osu;
      const oppScore = meet.events[event]?.opponent;
      if (osuScore == null) return '';
      const barPct = ((osuScore / 50) * 100).toFixed(1);

      let rows;
      let nqsHtml = '';
      if (meet.lineups && meet.lineups[event] && meet.lineups[event].length > 0) {
        const lineup = meet.lineups[event];
        const topScore = Math.max(...lineup.map(e => e.score));
        // NQS: top 5 of 6 count
        const sortedScores = lineup.map(e => e.score).slice().sort((a,b) => a - b);
        const droppedScore = sortedScores.length >= 6 ? sortedScores[0] : null;
        const nqsTotal = sortedScores.length >= 6
          ? sortedScores.slice(1).reduce((s,v) => s+v, 0)
          : sortedScores.reduce((s,v) => s+v, 0);

        rows = lineup.map(entry => {
          const isTop = entry.score === topScore;
          const isDropped = droppedScore !== null && entry.score === droppedScore;
          return `
            <tr class="lineup-row">
              <td style="color:#aaa;font-size:0.75rem;font-family:monospace;width:1.5rem;">${entry.position}</td>
              <td><span class="clickable-name lineup-gymnast" data-gymnast="${entry.name}" data-event="${event}" data-meet="${meet.id}">${entry.name}</span></td>
              <td class="score-cell${isTop ? ' score-top' : ''}${isDropped ? ' nqs-dropped' : ''}">${entry.score.toFixed(3)}</td>
            </tr>`;
        }).join('');

        if (lineup.length >= 5) {
          nqsHtml = `<div class="nqs-breakdown"><div class="nqs-label">NQS (top ${Math.min(5, lineup.length)})</div><div class="nqs-value">${nqsTotal.toFixed(3)}</div>${droppedScore !== null ? `<div class="nqs-dropped-label">Dropped: ${droppedScore.toFixed(3)}</div>` : ''}</div>`;
        }
      } else {
        const eventAthletes = meet.athletes
          .filter(a => a.scores[event] !== undefined);
        rows = eventAthletes.map((a, i) => `
          <tr class="lineup-row">
            <td>${i + 1}</td>
            <td><span class="clickable-name lineup-gymnast" data-gymnast="${a.name}" data-event="${event}" data-meet="${meet.id}">${a.name}</span></td>
            <td class="score-cell">${a.scores[event].toFixed(3)}</td>
          </tr>`).join('');
      }

      return `
        <div class="detail-event-card detail-event-clickable" data-event="${event}" data-from-meet="${meet.id}" style="cursor:pointer;">
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
          ${nqsHtml}
        </div>`;
    }).join('');

    const resultBadge = meet.status === 'upcoming'
      ? '<span class="badge badge-upcoming" style="font-size:1rem;padding:0.3rem 0.8rem;">UPCOMING</span>'
      : meet.result ? `<span class="badge badge-${meet.result.toLowerCase()}" style="font-size:1rem;padding:0.3rem 0.8rem;">${meet.result}</span>` : '';

    // Quad meet sibling navigation + Overview tab
    let quadNav = '';
    if (meet.quadMeet && meet.quadName) {
      const siblings = meets.filter(m => m.quadMeet && m.quadName === meet.quadName && m.date === meet.date);
      if (siblings.length > 1) {
        const overviewTab = `<button class="quad-tab quad-tab-overview" data-quad-overview="${meet.quadName}|${meet.date}">🏆 Overview</button>`;
        const tabs = siblings.map(s => {
          const active = s.id === meet.id;
          return `<button class="quad-tab${active?' active':''}" data-meet-id="${s.id}">vs ${s.opponent} <span class="quad-tab-result ${s.result?.toLowerCase()}">${s.result||''}</span></button>`;
        });
        quadNav = `
          <div class="quad-nav">
            <div class="quad-nav-label">🏆 ${meet.quadName}</div>
            <div class="quad-nav-tabs">${overviewTab}${tabs.join('')}</div>
          </div>`;
      }
    }

    // Meet hero photo
    const mpData = meetPhotos[meet.date];
    const heroImg = mpData?.heroImage;
    const heroHtml = heroImg ? `
      <div class="meet-hero-photo" style="position:relative;width:100%;height:220px;overflow:hidden;border-radius:12px;margin-bottom:1rem;">
        <img src="${heroImg}" alt="${meet.opponent} meet" style="width:100%;height:100%;object-fit:cover;object-position:center center;" loading="lazy" onerror="this.parentElement.style.display='none'">
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.7) 0%,transparent 50%)"></div>
        <div style="position:absolute;bottom:0.75rem;left:1rem;right:1rem;display:flex;justify-content:space-between;align-items:flex-end;">
          <span style="color:#fff;font-family:Oswald;font-size:1.1rem;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,0.8)">vs ${meet.opponent}</span>
          ${mpData?.recapUrl ? `<a href="${mpData.recapUrl}" target="_blank" style="color:rgba(255,255,255,0.75);font-size:0.72rem;text-decoration:none;background:rgba(0,0,0,0.4);padding:0.2rem 0.5rem;border-radius:4px">📸 osubeavers.com →</a>` : ''}
        </div>
      </div>` : '';

    content.innerHTML = `
      ${liveBanner}
      ${quadNav}
      ${heroHtml}
      <div class="detail-hero">
        <div class="meet-header">
          <div>
            <div class="meet-opponent" style="font-size:1.5rem;">vs ${meet.opponent}</div>
            <div class="meet-date">${formatDateLong(meet.date)}</div>
            <div class="meet-location">${meet.location}${meet.attendance ? ` • Attendance: ${meet.attendance}` : ''}</div>
          </div>
          ${resultBadge}
        </div>
        ${meet.status === 'upcoming' ? `
        <div style="margin-top:1rem;">
          ${meet.competitors ? `<div style="margin-bottom:0.75rem;">
            <div style="font-size:0.8rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Competitors</div>
            ${meet.competitors.map(c => `<div style="padding:0.3rem 0;color:${c.includes('Oregon State') ? 'var(--orange)' : '#ccc'};font-size:1rem;${c.includes('Oregon State') ? 'font-weight:600;' : ''}">${c}</div>`).join('')}
          </div>` : ''}
          ${meet.note ? `<div style="color:var(--text-muted);font-size:0.85rem;font-style:italic;margin-top:0.5rem;">${meet.note}</div>` : ''}
        </div>` : `
        <div class="meet-scores" style="margin-top:1rem;">
          <div class="team-score"><div class="team-name">Oregon State</div><div class="score score-osu" style="font-size:2rem;">${meet.osuScore?.toFixed(3) || '—'}</div></div>
          <div class="score-vs">vs</div>
          <div class="team-score"><div class="team-name">Opponent</div><div class="score" style="font-size:2rem;">${meet.opponentScore?.toFixed(3) || '—'}</div></div>
        </div>`}
      </div>
      ${(()=>{try{return renderMeetSpotlight(meet);}catch(e){return '';}})()}
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
      ${(()=>{try{return renderMeetInsights(meet);}catch(e){return '<div style="color:red;padding:1rem;background:#1a0000;border-radius:8px;margin-bottom:1rem">⚠️ Meet Analysis error: '+e.message+'</div>';}})()}
      ${(()=>{try{return renderMeetWildStats(meet);}catch(e){return '<div style="color:red;padding:1rem;background:#1a0000;border-radius:8px;margin-bottom:1rem">⚠️ Wild Stats error: '+e.message+'</div>';}})()}
      <h2 class="section-title" style="margin-bottom:1rem;">Event Breakdown</h2>
      <div class="detail-event-grid">${eventCards}</div>
    `;

    // Bind auto-refresh toggle
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle) {
      toggle.addEventListener('click', toggleAutoRefresh);
    }
  }

  // ===== Performance Panel + Spotlight =====

  function getGymnastEventHistory(name, event) {
    const history = [];
    meets.forEach(m => {
      if (!m.athletes) return;
      const athlete = m.athletes.find(a => a.name === name);
      if (athlete && athlete.scores[event] !== undefined) {
        history.push({ date: m.date, score: athlete.scores[event], meetId: m.id });
      }
    });
    return history.sort((a, b) => a.date.localeCompare(b.date));
  }

  function buildSparkline(scores) {
    if (!scores || scores.length === 0) return '';
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 0.1;
    const w = 8, gap = 2, h = 28;
    const bars = scores.map((s, i) => {
      const barH = Math.max(3, Math.round(((s - min) / range) * (h - 6)) + 6);
      const x = i * (w + gap);
      const y = h - barH;
      return `<rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="1" fill="var(--orange)" opacity="0.75"><title>${s.toFixed(3)}</title></rect>`;
    });
    const totalW = scores.length * (w + gap) - gap;
    return `<svg width="${totalW}" height="${h}" style="vertical-align:middle;display:inline-block">${bars.join('')}</svg>`;
  }

  function buildPerformancePanel(name, event, meetId) {
    const meet = meets.find(m => m.id === meetId);
    if (!meet) return '';

    // Today's score
    let todayScore = null;
    if (meet.lineups && meet.lineups[event]) {
      const entry = meet.lineups[event].find(e => e.name === name);
      if (entry) todayScore = entry.score;
    }
    if (todayScore === null && meet.athletes) {
      const athlete = meet.athletes.find(a => a.name === name);
      if (athlete && athlete.scores[event] !== undefined) todayScore = athlete.scores[event];
    }
    if (todayScore === null) return '';

    // Season history up to (and including) this meet
    const allHistory = getGymnastEventHistory(name, event);
    const history = allHistory.filter(h => h.date <= meet.date);
    const seasonScores = history.map(h => h.score);
    const seasonAvg = seasonScores.length > 0 ? seasonScores.reduce((a, b) => a + b, 0) / seasonScores.length : null;
    const delta = seasonAvg !== null ? todayScore - seasonAvg : null;

    // Rank among competitors on this event
    const competitors = [];
    if (meet.lineups && meet.lineups[event] && meet.lineups[event].length > 0) {
      meet.lineups[event].forEach(e => competitors.push({ name: e.name, score: e.score }));
    } else if (meet.athletes) {
      meet.athletes.filter(a => a.scores[event] !== undefined).forEach(a => {
        competitors.push({ name: a.name, score: a.scores[event] });
      });
    }
    competitors.sort((a, b) => b.score - a.score);
    const rank = competitors.findIndex(c => c.name === name) + 1;
    const total = competitors.length;
    let rankText = '';
    if (rank > 0 && total > 0) {
      const sfx = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
      rankText = `${rank}${sfx} of ${total} competing`;
    }

    // Last 5 scores sparkline
    const last5 = history.slice(-5).map(h => h.score);
    const sparkSvg = buildSparkline(last5);

    const deltaClass = delta !== null ? (delta >= 0 ? 'delta-pos' : 'delta-neg') : '';
    const deltaText = delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}` : '—';
    const avgText = seasonAvg !== null ? seasonAvg.toFixed(3) : '—';

    return `
      <tr class="perf-panel-row">
        <td colspan="3" style="padding:0;border:none;">
          <div class="perf-panel">
            <div class="perf-panel-top">
              <div class="perf-panel-delta ${deltaClass}">${deltaText}</div>
              <div class="perf-panel-stats">
                <span class="perf-stat">Season avg: <strong>${avgText}</strong></span>
                <span class="perf-stat">Today: <strong>${todayScore.toFixed(3)}</strong></span>
                ${rankText ? `<span class="perf-stat">Rank: <strong>${rankText}</strong></span>` : ''}
              </div>
            </div>
            ${sparkSvg ? `<div class="perf-sparkline"><span class="perf-spark-label">Last ${last5.length}</span>${sparkSvg}</div>` : ''}
            <div class="perf-panel-footer">
              <span class="clickable-name" data-gymnast="${name}" style="cursor:pointer;color:var(--orange);font-size:0.8rem;">Full profile →</span>
            </div>
          </div>
        </td>
      </tr>`;
  }

  function togglePerformancePanel(nameEl) {
    const name = nameEl.dataset.gymnast;
    const event = nameEl.dataset.event;
    const meetId = nameEl.dataset.meet;
    const row = nameEl.closest('tr');
    if (!row) return;

    // Toggle off if already open
    const next = row.nextElementSibling;
    if (next && next.classList.contains('perf-panel-row')) {
      next.remove();
      return;
    }

    // Close any other open panels
    document.querySelectorAll('.perf-panel-row').forEach(p => p.remove());

    const panelHtml = buildPerformancePanel(name, event, meetId);
    if (!panelHtml) return;
    row.insertAdjacentHTML('afterend', panelHtml);
  }

  function renderMeetSpotlight(meet) {
    if (!meet.athletes || meet.athletes.length === 0) return '';
    if (meet.status === 'upcoming') return '';

    const callouts = [];
    const allEvents = ['vault', 'bars', 'beam', 'floor'];
    const seen = {};

    meet.athletes.forEach(athlete => {
      allEvents.forEach(ev => {
        if (callouts.length >= 3) return;
        const todayScore = athlete.scores[ev];
        if (todayScore === undefined) return;

        const allHistory = getGymnastEventHistory(athlete.name, ev);
        const prevHistory = allHistory.filter(h => h.date < meet.date);
        if (prevHistory.length < 2) return;

        const prevScores = prevHistory.map(h => h.score);
        const seasonMax = Math.max(...prevScores);
        const seasonMin = Math.min(...prevScores);
        const seasonAvg = prevScores.reduce((a, b) => a + b, 0) / prevScores.length;

        // Best day of the season
        if (todayScore > seasonMax && !seen[athlete.name + '_best']) {
          seen[athlete.name + '_best'] = true;
          callouts.push({ emoji: '🔥', text: `${athlete.name} — season-high ${todayScore.toFixed(3)} on ${EVENT_NAMES[ev]}` });
        }
        // Off day (season low, gap > 0.1 from avg)
        if (callouts.length < 3 && todayScore < seasonMin && (seasonAvg - todayScore) > 0.1 && !seen[athlete.name + '_off']) {
          seen[athlete.name + '_off'] = true;
          callouts.push({ emoji: '📉', text: `${athlete.name} — off day on ${EVENT_NAMES[ev]} (${todayScore.toFixed(3)} vs ${seasonAvg.toFixed(3)} avg)` });
        }
        // Consistent (within 0.025 of season avg)
        if (callouts.length < 3 && Math.abs(todayScore - seasonAvg) <= 0.025 && !seen[athlete.name + '_consistent']) {
          seen[athlete.name + '_consistent'] = true;
          callouts.push({ emoji: '🎯', text: `${athlete.name} — on target: ${todayScore.toFixed(3)} on ${EVENT_NAMES[ev]} (avg ${seasonAvg.toFixed(3)})` });
        }
        // Comeback (below avg last personal meet, above avg this meet)
        if (callouts.length < 3 && !seen[athlete.name + '_comeback'] && prevHistory.length >= 1) {
          const lastPrev = prevHistory[prevHistory.length - 1];
          const prevSeasonBefore = prevHistory.slice(0, -1);
          if (prevSeasonBefore.length >= 1) {
            const prevAvg = prevSeasonBefore.reduce((a, h) => a + h.score, 0) / prevSeasonBefore.length;
            if (lastPrev.score < prevAvg && todayScore > seasonAvg) {
              seen[athlete.name + '_comeback'] = true;
              callouts.push({ emoji: '⚡', text: `${athlete.name} — bounce-back on ${EVENT_NAMES[ev]} after below-avg last outing` });
            }
          }
        }
      });
    });

    // Clutch: top scorer in a close event (gap ≤ 0.1)
    if (callouts.length < 3) {
      allEvents.forEach(ev => {
        if (callouts.length >= 3) return;
        const evData = meet.events && meet.events[ev];
        if (!evData) return;
        const gap = Math.abs(evData.osu - evData.opponent);
        if (gap > 0.1) return;
        let topEntry = null;
        if (meet.lineups && meet.lineups[ev] && meet.lineups[ev].length > 0) {
          topEntry = meet.lineups[ev].reduce((best, e) => (!best || e.score > best.score) ? e : best, null);
        } else {
          const ev_athletes = meet.athletes.filter(a => a.scores[ev] !== undefined);
          if (ev_athletes.length > 0) {
            const top = ev_athletes.reduce((best, a) => (!best || a.scores[ev] > best.scores[ev]) ? a : best, null);
            if (top) topEntry = { name: top.name, score: top.scores[ev] };
          }
        }
        if (topEntry && !seen[topEntry.name + '_clutch']) {
          seen[topEntry.name + '_clutch'] = true;
          callouts.push({ emoji: '🏅', text: `${topEntry.name} — clutch ${topEntry.score.toFixed(3)} in tight ${EVENT_NAMES[ev]} (margin ${gap.toFixed(3)})` });
        }
      });
    }

    if (callouts.length === 0) return '';

    const cards = callouts.slice(0, 3).map(c => `
      <div class="spotlight-card">
        <span class="spotlight-emoji">${c.emoji}</span>
        <span class="spotlight-text">${c.text}</span>
      </div>`).join('');

    return `
      <div class="spotlight-section">
        <div class="spotlight-grid">${cards}</div>
      </div>`;
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

    // Also include bio-only gymnasts who didn't appear in meet data (e.g., injured/redshirt)
    const profileNames = new Set(profiles.map(p => p.name));
    const bioOnlyCards = Object.keys(bios)
      .filter(name => !profileNames.has(name))
      .map(name => ({ name, bioOnly: true }));

    const allCards = [...profiles, ...bioOnlyCards];
    const filtered = searchTerm
      ? allCards.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : allCards;

    const detail = document.getElementById('gymnastDetail');
    detail.style.display = 'none';

    const container = document.getElementById('gymnastCards');
    container.style.display = 'grid';

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">No gymnasts found.</p></div>';
      return;
    }

    container.innerHTML = filtered.map(p => {
      const photo = photos[p.name];
      const photoHtml = photo
        ? `<img src="${photo}" class="gymnast-headshot" alt="${p.name}" loading="lazy">`
        : `<div class="gymnast-headshot-placeholder">${p.name.split(' ').map(n=>n[0]).join('')}</div>`;

      if (p.bioOnly) {
        const bio = bios[p.name] || {};
        const pos = bio.position ? `<span class="event-badge" style="background:var(--orange-dark);color:#fff">${bio.position}</span>` : '';
        const yr = bio.classYear ? `<span class="event-badge">${bio.classYear}</span>` : '';
        return `
          <div class="gymnast-card" data-gymnast="${p.name}" style="opacity:0.75">
            ${photoHtml}
            <div class="gymnast-name">${p.name}</div>
            <div class="gymnast-events">${pos}${yr}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">Did not compete</div>
            <div class="gymnast-averages" style="font-size:0.7rem;color:var(--text-muted)">${bio.hometown ? '📍 ' + bio.hometown : ''}</div>
          </div>`;
      }

      const eventBadges = p.eventsList.map(e => `<span class="event-badge">${EVENT_SHORT[e]}</span>`).join('');
      const avgStats = p.eventsList.map(e => {
        if (!p.averages[e]) return '';
        return `<div class="avg-stat"><div class="avg-value">${p.averages[e].toFixed(3)}</div><div class="avg-label">${EVENT_SHORT[e]}</div></div>`;
      }).join('');

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
    scrollToTop();
    const profiles = getGymnastProfiles();
    const p = profiles.find(pr => pr.name === name);

    // Bio-only gymnast (on roster but didn't compete this season)
    if (!p && bios[name]) {
      document.getElementById('gymnastCards').style.display = 'none';
      const detail = document.getElementById('gymnastDetail');
      detail.style.display = 'block';
      const bio = bios[name];
      const photo = photos[name];
      const photoHtml = photo
        ? `<img src="${photo}" class="profile-photo" alt="${name}" loading="lazy">`
        : `<div class="gymnast-headshot-placeholder" style="width:80px;height:80px;font-size:1.5rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#333;color:#fff;margin:0 auto 1rem;">${name.split(' ').map(n=>n[0]).join('')}</div>`;
      const pills = [
        bio.position ? `<span style="background:var(--orange-dark);color:#fff;padding:0.2rem 0.7rem;border-radius:999px;font-size:0.75rem;font-weight:700">${bio.position}</span>` : '',
        bio.classYear ? `<span style="background:#333;color:#aaa;padding:0.2rem 0.7rem;border-radius:999px;font-size:0.75rem">${bio.classYear}</span>` : '',
        bio.hometown ? `<span style="background:#222;color:#aaa;padding:0.2rem 0.7rem;border-radius:999px;font-size:0.75rem">📍 ${bio.hometown}</span>` : '',
      ].filter(Boolean).join(' ');
      detail.innerHTML = `
        <button class="back-btn" id="backFromBioOnly">← Back to Roster</button>
        <div class="gymnast-profile-header">
          ${photoHtml}
          <div>
            <h2 class="profile-name">${name}</h2>
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem">${pills}</div>
            <div style="margin-top:0.75rem;color:#aaa;font-size:0.85rem">⚠️ Did not appear in 2026 season competition data.</div>
            ${bio.major ? `<div style="margin-top:0.5rem;color:#999;font-size:0.8rem">🎓 ${bio.major}</div>` : ''}
            ${bio.aspiration ? `<div style="margin-top:0.5rem;color:#bbb;font-style:italic;font-size:0.85rem">"${bio.aspiration}"</div>` : ''}
          </div>
        </div>`;
      document.getElementById('backFromBioOnly').addEventListener('click', () => {
        detail.style.display = 'none';
        document.getElementById('gymnastCards').style.display = 'grid';
      });
      return;
    }

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

    // Athlete profile hero card — portrait photo + info
    const gymnPhoto = photos[p.name];
    const pb = bios[p.name]||{};

    // Build badge pills
    const heroPills = [];
    if(pb.position) heroPills.push(`<span style="background:#D73F09;color:#fff;padding:0.2rem 0.6rem;border-radius:4px;font-size:0.75rem;font-weight:700;letter-spacing:0.03em">${pb.position}</span>`);
    if(pb.classYear) heroPills.push(`<span style="background:rgba(255,255,255,0.12);color:#ccc;padding:0.2rem 0.6rem;border-radius:4px;font-size:0.75rem;font-weight:600">${pb.classYear}</span>`);

    // Build info rows
    const heroInfoRows = [];
    if(pb.hometown) heroInfoRows.push(`<div style="color:rgba(255,255,255,0.7);font-size:0.85rem">📍 ${pb.hometown}</div>`);
    if(pb.height) heroInfoRows.push(`<div style="color:rgba(255,255,255,0.7);font-size:0.85rem">📏 ${pb.height}</div>`);
    if(pb.major) heroInfoRows.push(`<div style="color:rgba(255,255,255,0.7);font-size:0.85rem">🎓 ${pb.major}</div>`);
    if(pb.highSchool) heroInfoRows.push(`<div style="color:rgba(255,255,255,0.7);font-size:0.85rem">🏫 ${pb.highSchool}</div>`);

    // Best scores mini stat boxes
    const heroStatEvents = ['vault','bars','beam','floor'].filter(e => p.bests[e] !== undefined);
    const heroStatsHtml = heroStatEvents.length ? `
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem">
        ${heroStatEvents.map(e => `
          <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:0.35rem 0.6rem;text-align:center;min-width:60px">
            <div style="font-size:0.6rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${{vault:'VT',bars:'UB',beam:'BB',floor:'FX'}[e]}</div>
            <div style="font-size:0.95rem;font-weight:700;color:#D73F09;font-family:Oswald">${p.bests[e].toFixed(3)}</div>
          </div>`).join('')}
        ${p.bests.aa !== undefined ? `
          <div style="background:rgba(215,63,9,0.15);border:1px solid rgba(215,63,9,0.3);border-radius:6px;padding:0.35rem 0.6rem;text-align:center;min-width:60px">
            <div style="font-size:0.6rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">AA</div>
            <div style="font-size:0.95rem;font-weight:700;color:#fff;font-family:Oswald">${p.bests.aa.toFixed(3)}</div>
          </div>` : ''}
      </div>` : '';

    const heroCardHtml = `
      <div class="athlete-hero-card" style="display:flex;gap:1.5rem;padding:1.25rem;background:linear-gradient(135deg,#1a1a1a 0%,#0d0d0d 100%);border-radius:12px;border:1px solid rgba(255,255,255,0.08);align-items:flex-start">
        ${gymnPhoto ? `
        <div style="flex-shrink:0;width:200px;height:280px;border-radius:10px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.08)">
          <img src="${gymnPhoto}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;object-position:center;" loading="lazy">
        </div>` : ''}
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-height:${gymnPhoto ? '280px' : 'auto'};padding:0.25rem 0">
          <div style="font-family:Oswald;font-size:2rem;font-weight:700;color:#fff;line-height:1.1;letter-spacing:0.01em">${p.name}</div>
          <div style="color:rgba(255,255,255,0.45);font-size:0.8rem;margin-top:0.3rem;font-weight:500;text-transform:uppercase;letter-spacing:0.08em">Oregon State Gymnastics</div>
          ${heroPills.length ? `<div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.6rem;align-items:center">${heroPills.join('')}</div>` : ''}
          ${heroInfoRows.length ? `<div style="display:flex;flex-direction:column;gap:0.25rem;margin-top:0.75rem">${heroInfoRows.join('')}</div>` : ''}
          <div style="color:var(--text-muted);font-size:0.8rem;margin-top:0.6rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.6rem">${p.totalMeets} competition days</div>
          ${heroStatsHtml}
        </div>
      </div>`;

    detail.innerHTML = `
      <div class="gymnast-profile">
        <button class="back-btn" id="backToGymnasts">← Back to Gymnasts</button>
        ${heroCardHtml}
        <div class="profile-header" style="margin-top:0.75rem">
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
      const oppScore = teamData ? teamData.total.toFixed(3) : m.opponentScore != null ? m.opponentScore.toFixed(3) : "TBD";
      const result = m.result;
      return `<tr>
        <td>${formatDateLong(m.date)}</td>
        <td><span class="clickable-meet" data-meet-id="${m.id}">${m.quadName || m.opponent}</span></td>
        <td style="color:var(--orange);font-family:Oswald;">${m.osuScore != null ? m.osuScore.toFixed(3) : "TBD"}</td>
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

  // ===== Event Detail Drill-down =====
  let _eventDetailMeetId = null;

  function showEventDetail(eventKey, fromMeetId) {
    _eventDetailMeetId = fromMeetId;
    scrollToTop();
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById('view-event');
    view.style.display = 'block';

    const evName = EVENT_NAMES[eventKey];

    // Gather team scores for this event across all meets, chronologically
    const seasonData = [];
    const seenDates = new Set();
    meets.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(m => {
      if (!m.events || !m.events[eventKey] || !m.events[eventKey].osu) return;
      if (m.events[eventKey].osu <= 0) return;
      // Deduplicate by date (quad meets share a date)
      const key = m.date + '|' + m.id;
      if (seenDates.has(key)) return;
      seenDates.add(key);
      seasonData.push({
        meetId: m.id,
        date: m.date,
        opponent: m.opponent,
        score: m.events[eventKey].osu,
        oppScore: m.events[eventKey].opponent,
        result: m.result,
        osuTotal: m.osuScore,
        oppTotal: m.opponentScore
      });
    });

    const scores = seasonData.map(d => d.score);
    const seasonAvg = mean(scores);
    const seasonBest = scores.length ? Math.max(...scores) : null;
    const seasonWorst = scores.length ? Math.min(...scores) : null;
    const bestMeet = seasonData.find(d => d.score === seasonBest);
    const worstMeet = seasonData.find(d => d.score === seasonWorst);
    const mostRecent = seasonData.length ? seasonData[seasonData.length - 1] : null;
    const sd = stddev(scores);

    // Trend direction: compare first half to second half
    const half = Math.floor(scores.length / 2);
    const firstHalfAvg = mean(scores.slice(0, half));
    const secondHalfAvg = mean(scores.slice(half));
    const trendDiff = firstHalfAvg && secondHalfAvg ? secondHalfAvg - firstHalfAvg : 0;
    const trendArrow = trendDiff > 0.05 ? '↑' : trendDiff < -0.05 ? '↓' : '→';
    const trendColor = trendDiff > 0.05 ? '#2ecc71' : trendDiff < -0.05 ? '#e74c3c' : '#aaa';
    const trendLabel = trendDiff > 0.05 ? 'Trending Up' : trendDiff < -0.05 ? 'Trending Down' : 'Steady';

    // Consistency label
    let consistLabel, consistColor;
    if (sd < 0.2) { consistLabel = 'Very Consistent'; consistColor = '#2ecc71'; }
    else if (sd < 0.5) { consistLabel = 'Solid'; consistColor = '#f1c40f'; }
    else { consistLabel = 'Inconsistent'; consistColor = '#e74c3c'; }

    // Build SVG bar chart
    const chartHeight = 160;
    const barWidth = Math.max(20, Math.min(50, Math.floor(600 / Math.max(scores.length, 1)) - 6));
    const gap = 4;
    const chartWidth = scores.length * (barWidth + gap) - gap + 60;
    const minScore = scores.length ? Math.min(...scores) - 0.3 : 47;
    const maxScore = scores.length ? Math.max(...scores) + 0.1 : 50;
    const range = maxScore - minScore || 1;

    const bars = seasonData.map((d, i) => {
      const barH = Math.max(4, ((d.score - minScore) / range) * (chartHeight - 30));
      const x = 50 + i * (barWidth + gap);
      const y = chartHeight - barH - 10;
      const isCurrent = d.meetId === fromMeetId;
      const fill = isCurrent ? '#D73F09' : 'var(--orange)';
      const opacity = isCurrent ? '1' : '0.65';
      const label = formatDate(d.date);
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="${fill}" opacity="${opacity}">
            <title>${d.opponent} (${label}): ${d.score.toFixed(3)}</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" fill="${isCurrent ? '#fff' : '#aaa'}" font-size="10" font-family="Oswald">${d.score.toFixed(3)}</text>
          <text x="${x + barWidth / 2}" y="${chartHeight}" text-anchor="middle" fill="#666" font-size="8" transform="rotate(-45 ${x + barWidth / 2} ${chartHeight})">${label}</text>
        </g>`;
    }).join('');

    // Average line
    const avgY = chartHeight - ((seasonAvg - minScore) / range) * (chartHeight - 30) - 10;
    const avgLine = seasonAvg ? `
      <line x1="45" y1="${avgY}" x2="${50 + scores.length * (barWidth + gap)}" y2="${avgY}" stroke="#aaa" stroke-dasharray="4,3" stroke-width="1"/>
      <text x="42" y="${avgY + 3}" text-anchor="end" fill="#aaa" font-size="9">avg</text>
    ` : '';

    const chart = `
      <div class="section-card" style="overflow-x:auto;">
        <h2 class="section-title">Season Trend</h2>
        <svg width="${Math.max(chartWidth, 300)}" height="${chartHeight + 30}" style="display:block;margin:0 auto;">
          ${avgLine}
          ${bars}
        </svg>
      </div>`;

    // Season stats panel
    const statsPanel = `
      <div class="section-card">
        <h2 class="section-title">Season Stats</h2>
        <div class="event-stats-grid">
          <div class="event-stat-item">
            <div class="event-stat-value">${fmt(seasonAvg)}</div>
            <div class="event-stat-label">Season Average</div>
          </div>
          <div class="event-stat-item">
            <div class="event-stat-value" style="color:#2ecc71">${fmt(seasonBest)}</div>
            <div class="event-stat-label">Season Best${bestMeet ? ` (vs ${bestMeet.opponent})` : ''}</div>
          </div>
          <div class="event-stat-item">
            <div class="event-stat-value" style="color:#e74c3c">${fmt(seasonWorst)}</div>
            <div class="event-stat-label">Season Worst${worstMeet ? ` (vs ${worstMeet.opponent})` : ''}</div>
          </div>
          <div class="event-stat-item">
            <div class="event-stat-value">${mostRecent ? fmt(mostRecent.score) : '—'}</div>
            <div class="event-stat-label">Most Recent</div>
          </div>
          <div class="event-stat-item">
            <div class="event-stat-value" style="color:${trendColor};font-size:1.5rem;">${trendArrow}</div>
            <div class="event-stat-label" style="color:${trendColor}">${trendLabel}</div>
          </div>
          <div class="event-stat-item">
            <div class="event-stat-value" style="color:${consistColor}">${sd.toFixed(3)}</div>
            <div class="event-stat-label" style="color:${consistColor}">${consistLabel} (σ)</div>
          </div>
        </div>
      </div>`;

    // All-time leaderboard — top individual scores across all meets
    const individualScores = [];
    meets.forEach(m => {
      if (!m.athletes) return;
      m.athletes.filter(a => a.team === 'Oregon State').forEach(a => {
        if (a.scores[eventKey] !== undefined && a.scores[eventKey] > 0) {
          individualScores.push({
            name: a.name,
            score: a.scores[eventKey],
            date: m.date,
            opponent: m.opponent,
            meetId: m.id
          });
        }
      });
    });
    individualScores.sort((a, b) => b.score - a.score);
    const top10 = individualScores.slice(0, 10);

    const leaderboard = `
      <div class="section-card">
        <h2 class="section-title">Top Individual Scores — ${evName}</h2>
        <table class="event-detail-table">
          <thead><tr><th>#</th><th>Gymnast</th><th>Score</th><th>Meet</th><th>Date</th></tr></thead>
          <tbody>
            ${top10.map((s, i) => `
              <tr${s.meetId === fromMeetId ? ' style="background:rgba(215,63,9,0.1)"' : ''}>
                <td style="color:${i < 3 ? 'var(--orange)' : '#aaa'};font-weight:${i < 3 ? '700' : '400'}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                <td><span class="clickable-name" data-gymnast="${s.name}">${s.name}</span></td>
                <td style="color:var(--orange);font-family:Oswald;font-weight:600">${s.score.toFixed(3)}</td>
                <td>vs ${s.opponent}</td>
                <td style="color:var(--text-muted)">${formatDate(s.date)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    // Meet-by-meet breakdown
    const breakdownRows = seasonData.map(d => {
      const isCurrent = d.meetId === fromMeetId;
      const won = d.score > d.oppScore;
      return `
        <tr${isCurrent ? ' style="background:rgba(215,63,9,0.15)"' : ''}>
          <td><span class="clickable-meet" data-meet-id="${d.meetId}">${formatDate(d.date)}</span></td>
          <td>vs ${d.opponent}</td>
          <td style="color:var(--orange);font-family:Oswald;font-weight:600">${d.score.toFixed(3)}</td>
          <td style="color:var(--text-muted)">${d.oppScore.toFixed(3)}</td>
          <td><span style="color:${won ? '#2ecc71' : '#e74c3c'};font-weight:600">${won ? 'W' : 'L'}</span></td>
        </tr>`;
    }).join('');

    const breakdown = `
      <div class="section-card">
        <h2 class="section-title">Meet-by-Meet Breakdown</h2>
        <div style="overflow-x:auto;">
          <table class="event-detail-table">
            <thead><tr><th>Date</th><th>Opponent</th><th>OSU</th><th>Opp</th><th>Event</th></tr></thead>
            <tbody>${breakdownRows}</tbody>
          </table>
        </div>
      </div>`;

    // ── Media Card for Banner ──
    const currentMeet = meets.find(m => m.id === fromMeetId);
    const meetPhotoData = currentMeet ? meetPhotos[currentMeet.date] : null;
    const meetPhotoUrl = meetPhotoData?.heroImage || null;
    const mediaCard = `
      <div class="event-banner-media">
        ${meetPhotoUrl
          ? `<img src="${meetPhotoUrl}" alt="${currentMeet?.opponent || 'Meet'}" class="event-banner-img"/>`
          : `<div class="event-banner-placeholder"><span style="font-size:2.5rem;">🤸</span><div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;">OSU Gymnastics</div></div>`}
        ${currentMeet ? `<div class="event-banner-caption">${currentMeet.opponent} — ${formatDate(currentMeet.date)}</div>` : ''}
      </div>`;

    // ── Individual Gymnast Performance Cards ──
    // Gather per-gymnast data for this event across all meets
    const sortedMeetsChron = meets.slice().sort((a, b) => a.date.localeCompare(b.date));
    const gymnastMap = {};
    const meetDates = seasonData.map(d => d.date + '|' + d.meetId);

    sortedMeetsChron.forEach(m => {
      if (!m.athletes) return;
      m.athletes.filter(a => a.team === 'Oregon State').forEach(a => {
        if (a.scores[eventKey] === undefined || a.scores[eventKey] <= 0) return;
        if (!gymnastMap[a.name]) gymnastMap[a.name] = [];
        gymnastMap[a.name].push({
          date: m.date,
          meetId: m.id,
          score: a.scores[eventKey],
          opponent: m.opponent
        });
      });
    });

    // Deduplicate per gymnast per date
    Object.keys(gymnastMap).forEach(name => {
      const seen = new Set();
      gymnastMap[name] = gymnastMap[name].filter(e => {
        const k = e.date;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });

    // Build gymnast stats
    const gymnastStats = Object.entries(gymnastMap).map(([name, entries]) => {
      const scores = entries.map(e => e.score);
      const avg = mean(scores);
      const best = Math.max(...scores);
      const bestEntry = entries.find(e => e.score === best);
      const appearances = entries.length;

      // Linear regression for trend
      let slope = 0;
      if (entries.length >= 2) {
        const pts = entries.map((e, i) => ({ x: i, y: e.score }));
        const n = pts.length;
        const sx = pts.reduce((s, p) => s + p.x, 0);
        const sy = pts.reduce((s, p) => s + p.y, 0);
        const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
        const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
        slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx) || 0;
      }

      // Improvement = last score - first score (for "most improved" sort)
      const improvement = entries.length >= 2 ? entries[entries.length - 1].score - entries[0].score : 0;

      return { name, entries, scores, avg, best, bestEntry, appearances, slope, improvement };
    });

    // Default sort: season avg descending
    let gymnastSorted = gymnastStats.slice().sort((a, b) => b.avg - a.avg);

    function buildGymnastCards(sortedList, sortMode) {
      return sortedList.map((g, idx) => {
        const photoUrl = photos[g.name];
        const bio = bios[g.name];
        const initials = g.name.split(' ').map(w => w[0]).join('');

        // Trend label
        let trendBadge;
        if (g.slope > 0.015) trendBadge = '<span class="gymnast-trend-badge trend-up">Improving</span>';
        else if (g.slope < -0.015) trendBadge = '<span class="gymnast-trend-badge trend-down">Declining</span>';
        else trendBadge = '<span class="gymnast-trend-badge trend-steady">Steady</span>';

        // Build mini sparkline — one bar per meet in seasonData, gray if gymnast didn't compete
        const sparkBars = seasonData.map((sd, si) => {
          const entry = g.entries.find(e => e.date === sd.date);
          const score = entry ? entry.score : null;
          const minS = 9.0, maxS = 10.0, rangeS = maxS - minS;
          const barH = score ? Math.max(4, ((score - minS) / rangeS) * 36) : 6;
          const bw = Math.max(8, Math.min(18, Math.floor(260 / Math.max(seasonData.length, 1)) - 2));
          const x = si * (bw + 2);
          const y = 40 - barH;
          const isPersonalBest = score === g.best;
          const fill = score === null ? '#3d3228' : isPersonalBest ? '#FFD700' : 'var(--orange)';
          const opacity = score === null ? '0.4' : isPersonalBest ? '1' : '0.7';
          const title = score ? `${sd.opponent} (${formatDate(sd.date)}): ${score.toFixed(3)}${isPersonalBest ? ' ★ PB' : ''}` : `${sd.opponent}: DNP`;
          return `<rect x="${x}" y="${y}" width="${bw}" height="${barH}" rx="2" fill="${fill}" opacity="${opacity}"><title>${title}</title></rect>`;
        }).join('');

        const sparkWidth = seasonData.length * (Math.max(8, Math.min(18, Math.floor(260 / Math.max(seasonData.length, 1)) - 2)) + 2);

        return `
          <div class="gymnast-perf-card" style="animation-delay:${idx * 0.05}s">
            <div class="gymnast-card-left">
              ${photoUrl
                ? `<img src="${photoUrl}" alt="${g.name}" class="gymnast-card-photo"/>`
                : `<div class="gymnast-card-initials">${initials}</div>`}
            </div>
            <div class="gymnast-card-body">
              <div class="gymnast-card-header">
                <span class="clickable-name gymnast-card-name" data-gymnast="${g.name}">${g.name}</span>
                ${trendBadge}
              </div>
              ${bio ? `<div class="gymnast-card-meta">${bio.classYear || ''} ${bio.hometown ? '· ' + bio.hometown : ''}</div>` : ''}
              <div class="gymnast-card-sparkline">
                <svg width="${sparkWidth}" height="42" style="display:block;">
                  ${sparkBars}
                </svg>
              </div>
              <div class="gymnast-card-stats">
                <span class="gymnast-stat"><strong>${g.avg.toFixed(3)}</strong> avg</span>
                <span class="gymnast-stat" style="color:#FFD700"><strong>${g.best.toFixed(3)}</strong> best</span>
                <span class="gymnast-stat">${g.appearances} meet${g.appearances !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>`;
      }).join('');
    }

    const gymnastSection = `
      <div class="section-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
          <h2 class="section-title" style="margin:0;">Gymnast Performance — ${evName}</h2>
          <div class="gymnast-sort-toggle" id="gymnastSortToggle">
            <button class="gymnast-sort-btn active" data-sort="avg">By Average</button>
            <button class="gymnast-sort-btn" data-sort="improved">Most Improved</button>
          </div>
        </div>
        <div class="gymnast-perf-grid" id="gymnastPerfGrid">
          ${buildGymnastCards(gymnastSorted, 'avg')}
        </div>
      </div>`;

    // ── Deep Dive Analytics Section ──
    function buildDeepDive() {
      const evKey = eventKey;

      // Home vs Away
      const homeScores = seasonData.filter(d => {
        const m = meets.find(mm => mm.id === d.meetId);
        return m && m.isHome;
      }).map(d => d.score);
      const awayScores = seasonData.filter(d => {
        const m = meets.find(mm => mm.id === d.meetId);
        return m && !m.isHome;
      }).map(d => d.score);
      const homeAvg = homeScores.length ? mean(homeScores) : null;
      const awayAvg = awayScores.length ? mean(awayScores) : null;
      const haDiff = homeAvg && awayAvg ? homeAvg - awayAvg : null;
      const haLabel = haDiff !== null
        ? (haDiff > 0.05 ? `Home court is worth <strong>+${haDiff.toFixed(3)}</strong> on ${evName}. Gill Coliseum magic is real.`
          : haDiff < -0.05 ? `OSU actually scores <strong>${Math.abs(haDiff).toFixed(3)}</strong> better on the road for ${evName}. Road warriors!`
          : `Home and away are basically identical. This team is locked in everywhere.`)
        : 'Not enough data for a split yet.';

      // Win correlation threshold
      let winThreshold = null, winPct = null;
      if (seasonData.length >= 4) {
        const sorted = seasonData.slice().sort((a, b) => a.score - b.score);
        const mid = sorted[Math.floor(sorted.length * 0.6)].score;
        const above = seasonData.filter(d => d.score >= mid);
        const aboveWins = above.filter(d => d.result === 'W').length;
        winThreshold = mid;
        winPct = above.length ? Math.round((aboveWins / above.length) * 100) : 0;
      }

      // Hot streak
      let streak = 0, streakType = 'above';
      for (let i = seasonData.length - 1; i >= 0; i--) {
        if (seasonData[i].score >= seasonAvg) streak++;
        else break;
      }
      if (streak === 0) {
        streakType = 'below';
        for (let i = seasonData.length - 1; i >= 0; i--) {
          if (seasonData[i].score < seasonAvg) streak++;
          else break;
        }
      }
      const streakLabel = streakType === 'above'
        ? (streak >= 4 ? `${streak}-meet heater! OSU has been above average on ${evName} for the last ${streak} meets straight.`
          : streak >= 2 ? `${streak} meets above average and counting.`
          : 'Back above average in the latest outing.')
        : (streak >= 3 ? `Broke through after ${streak} meets below average. Time to bounce back.`
          : streak >= 1 ? `Dipped below average last time out. Rebound incoming?`
          : '');

      // Peak performance
      const peakEntry = individualScores.length ? individualScores[0] : null;
      const peakLabel = peakEntry
        ? `Career night: <strong>${peakEntry.name}</strong> dropped a <strong>${peakEntry.score.toFixed(3)}</strong> vs ${peakEntry.opponent} on ${formatDate(peakEntry.date)}`
        : '';

      // Momentum — last 3 meets vs season avg
      const last3 = seasonData.slice(-3);
      const last3Avg = last3.length ? mean(last3.map(d => d.score)) : null;
      const momDiff = last3Avg ? last3Avg - seasonAvg : 0;
      let momLabel, momEmoji;
      if (momDiff > 0.15) { momLabel = 'On fire'; momEmoji = '🔥'; }
      else if (momDiff > 0.05) { momLabel = 'Building steam'; momEmoji = '📈'; }
      else if (momDiff > -0.05) { momLabel = 'Steady Eddie'; momEmoji = '💪'; }
      else if (momDiff > -0.15) { momLabel = 'Cooling off'; momEmoji = '😐'; }
      else { momLabel = 'Rough patch'; momEmoji = '😬'; }

      // Event MVP
      const mvpCandidates = gymnastStats.filter(g => g.appearances >= 3)
        .sort((a, b) => {
          const scoreA = a.avg * 0.6 + (a.appearances / Math.max(...gymnastStats.map(g => g.appearances))) * 0.4 * 10;
          const scoreB = b.avg * 0.6 + (b.appearances / Math.max(...gymnastStats.map(g => g.appearances))) * 0.4 * 10;
          return scoreB - scoreA;
        });
      const mvp = mvpCandidates[0];
      const mvpTitles = [
        'The Engine', 'The Backbone', 'Captain Consistency', 'The Anchor',
        'The Workhorse', 'Ms. Reliable', 'The Specialist'
      ];
      const mvpTitle = mvp ? mvpTitles[Math.abs(mvp.name.length * 7) % mvpTitles.length] : '';

      // Clutch factor
      const closeScores = seasonData.filter(d => Math.abs(d.osuTotal - d.oppTotal) <= 0.5).map(d => d.score);
      const blowoutScores = seasonData.filter(d => Math.abs(d.osuTotal - d.oppTotal) > 1.5).map(d => d.score);
      const closeAvg = closeScores.length ? mean(closeScores) : null;
      const blowoutAvg = blowoutScores.length ? mean(blowoutScores) : null;
      const clutchDiff = closeAvg && blowoutAvg ? closeAvg - blowoutAvg : null;

      return `
        <div class="section-card deep-dive-section">
          <h2 class="section-title">Deep Dive — ${evName} Analytics</h2>
          <div class="deep-dive-grid">

            <div class="deep-dive-card">
              <div class="deep-dive-icon">🏠</div>
              <div class="deep-dive-label">Home vs Away</div>
              <div class="deep-dive-body">
                ${homeAvg ? `<div class="deep-dive-split"><span>Home: <strong style="color:#2ecc71">${homeAvg.toFixed(3)}</strong> (${homeScores.length} meets)</span><span>Away: <strong style="color:#e74c3c">${awayAvg ? awayAvg.toFixed(3) : '—'}</strong> (${awayScores.length} meets)</span></div>` : ''}
                <div class="deep-dive-text">${haLabel}</div>
              </div>
            </div>

            ${winThreshold !== null ? `
            <div class="deep-dive-card">
              <div class="deep-dive-icon">🏆</div>
              <div class="deep-dive-label">Win Correlation</div>
              <div class="deep-dive-body">
                <div class="deep-dive-big">${winPct}%</div>
                <div class="deep-dive-text">When OSU scores <strong>${winThreshold.toFixed(3)}</strong> or above on ${evName}, they win <strong>${winPct}%</strong> of the time.</div>
              </div>
            </div>` : ''}

            <div class="deep-dive-card">
              <div class="deep-dive-icon">${streakType === 'above' && streak >= 3 ? '🔥' : '📊'}</div>
              <div class="deep-dive-label">Hot Streak Detector</div>
              <div class="deep-dive-body">
                <div class="deep-dive-text">${streakLabel}</div>
              </div>
            </div>

            ${peakLabel ? `
            <div class="deep-dive-card">
              <div class="deep-dive-icon">⭐</div>
              <div class="deep-dive-label">Peak Performance</div>
              <div class="deep-dive-body">
                <div class="deep-dive-text">${peakLabel}</div>
              </div>
            </div>` : ''}

            <div class="deep-dive-card">
              <div class="deep-dive-icon">${momEmoji}</div>
              <div class="deep-dive-label">Momentum Arrow</div>
              <div class="deep-dive-body">
                <div class="deep-dive-big" style="color:${momDiff > 0.05 ? '#2ecc71' : momDiff < -0.05 ? '#e74c3c' : '#f1c40f'}">${momLabel} ${momEmoji}</div>
                <div class="deep-dive-text">Last 3 meets avg: <strong>${last3Avg ? last3Avg.toFixed(3) : '—'}</strong> vs season avg <strong>${seasonAvg.toFixed(3)}</strong> (${momDiff >= 0 ? '+' : ''}${momDiff.toFixed(3)})</div>
              </div>
            </div>

            ${mvp ? `
            <div class="deep-dive-card deep-dive-mvp">
              <div class="deep-dive-icon">👑</div>
              <div class="deep-dive-label">Event MVP — "${mvpTitle}"</div>
              <div class="deep-dive-body">
                <div class="deep-dive-text"><span class="clickable-name" data-gymnast="${mvp.name}"><strong>${mvp.name}</strong></span> — ${mvp.appearances} appearances, <strong>${mvp.avg.toFixed(3)}</strong> avg, <strong>${mvp.best.toFixed(3)}</strong> best. The heartbeat of OSU ${evName}.</div>
              </div>
            </div>` : ''}

            ${clutchDiff !== null ? `
            <div class="deep-dive-card">
              <div class="deep-dive-icon">🎯</div>
              <div class="deep-dive-label">Clutch Factor</div>
              <div class="deep-dive-body">
                <div class="deep-dive-split"><span>Close meets: <strong>${closeAvg.toFixed(3)}</strong> (${closeScores.length})</span><span>Blowouts: <strong>${blowoutAvg.toFixed(3)}</strong> (${blowoutScores.length})</span></div>
                <div class="deep-dive-text">${clutchDiff > 0.02
                  ? `OSU rises to the occasion — <strong>+${clutchDiff.toFixed(3)}</strong> better in nail-biters. Ice in their veins.`
                  : clutchDiff < -0.02
                  ? `OSU scores <strong>${Math.abs(clutchDiff).toFixed(3)}</strong> lower in close meets. Pressure is real.`
                  : `No difference in tight games vs blowouts. Consistent under all conditions.`}</div>
              </div>
            </div>` : ''}

          </div>
        </div>`;
    }

    const deepDive = buildDeepDive();

    // Lineup Position Analysis
    const posStats = Stats.getLineupPositionStats(meets, eventKey);
    let lineupAnalysisHtml = '';
    const posKeys = Object.keys(posStats.byPosition).sort();
    if (posKeys.length > 0) {
      const posScores = posKeys.map(p => posStats.byPosition[p].avg);
      const maxPosAvg = posScores.length ? Math.max(...posScores) : 10;
      const minPosAvg = posScores.length ? Math.min(...posScores) : 9;

      const posBars = posKeys.map(p => {
        const ps = posStats.byPosition[p];
        const pct = ((ps.avg - 9.0) / 1.0 * 100).toFixed(1);
        return `<div class="position-bar-item">
          <div class="position-bar-label">Pos ${p}</div>
          <div class="position-bar-track"><div class="position-bar-fill" style="width:${Math.max(5, Math.min(100, pct))}%"></div></div>
          <div class="position-bar-value">${ps.avg.toFixed(3)} <span style="color:var(--text-muted);font-size:0.7rem">(${ps.count})</span></div>
        </div>`;
      }).join('');

      const anchor = posStats.byPosition['6'];
      const leadoff = posStats.byPosition['1'];
      const anchorCard = anchor ? `<div class="lineup-role-card"><div class="lineup-role-title">Anchor (Pos 6)</div><div class="lineup-role-athlete">${anchor.topAthlete || '—'}</div><div class="lineup-role-avg">${anchor.avg.toFixed(3)} avg</div></div>` : '';
      const leadoffCard = leadoff ? `<div class="lineup-role-card"><div class="lineup-role-title">Leadoff (Pos 1)</div><div class="lineup-role-athlete">${leadoff.topAthlete || '—'}</div><div class="lineup-role-avg">${leadoff.avg.toFixed(3)} avg</div></div>` : '';

      lineupAnalysisHtml = `
        <div class="section-card">
          <h2 class="section-title">Lineup Analysis — ${evName}</h2>
          <div class="position-bars">${posBars}</div>
          <div class="lineup-roles">${leadoffCard}${anchorCard}</div>
        </div>`;
    }

    document.getElementById('eventDetailContent').innerHTML = `
      <div class="event-detail-header">
        <div class="event-banner-content">
          <h1 class="event-detail-title">${evName} — Season Performance</h1>
        </div>
        ${mediaCard}
      </div>
      ${chart}
      ${statsPanel}
      ${lineupAnalysisHtml}
      ${gymnastSection}
      ${leaderboard}
      ${breakdown}
      ${deepDive}
    `;

    // Sort toggle handler
    const sortToggle = document.getElementById('gymnastSortToggle');
    if (sortToggle) {
      sortToggle.addEventListener('click', e => {
        const btn = e.target.closest('.gymnast-sort-btn');
        if (!btn) return;
        sortToggle.querySelectorAll('.gymnast-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.sort;
        const sorted = mode === 'improved'
          ? gymnastStats.slice().sort((a, b) => b.improvement - a.improvement)
          : gymnastStats.slice().sort((a, b) => b.avg - a.avg);
        document.getElementById('gymnastPerfGrid').innerHTML = buildGymnastCards(sorted, mode);
      });
    }

    // Bind back button
    document.getElementById('backFromEvent').onclick = () => {
      document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
      document.getElementById('view-meet').style.display = 'block';
      scrollToTop();
    };
  }

  // ===== Leaderboards =====
  function renderLeaderboard(event) {
    document.querySelectorAll('.event-tab').forEach(t => t.classList.toggle('active', t.dataset.event === event));

    // AA leaderboard — special handling
    if (event === 'aa') {
      const list = document.getElementById('leaderboardList');
      const aaData = Stats.getAALeaderboard(meets);
      if (!aaData.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p class="empty-text">No AA scores recorded this season.</p></div>';
        return;
      }
      list.innerHTML = aaData.map((g, i) => {
        const photo = photos[g.name];
        const avatar = photo
          ? `<img src="${photo}" class="lb-avatar" alt="${g.name}">`
          : `<div class="lb-avatar lb-avatar-initials">${g.name.split(' ').map(n => n[0]).join('')}</div>`;
        const trendArrow = g.trend != null ? (g.trend > 0.01 ? '<span style="color:#2ecc71">▲</span>' : g.trend < -0.01 ? '<span style="color:#e74c3c">▼</span>' : '<span style="color:#aaa">►</span>') : '';
        return `
        <div class="leaderboard-item">
          <div class="lb-rank ${i < 3 ? 'top-3' : ''}">${i + 1}</div>
          ${avatar}
          <div class="lb-info">
            <div class="lb-name"><span class="clickable-name" data-gymnast="${g.name}">${g.name}</span></div>
            <div class="lb-context">${g.count} AA score${g.count !== 1 ? 's' : ''} this season</div>
          </div>
          <div class="lb-stats">
            <div class="lb-stat"><span class="lb-stat-label">BEST</span><span class="lb-stat-val">${g.best.toFixed(3)}</span></div>
            <div class="lb-stat"><span class="lb-stat-label">AVG</span><span class="lb-stat-val">${g.avg.toFixed(3)}</span></div>
            <div class="lb-stat"><span class="lb-stat-label">COUNT</span><span class="lb-stat-val">${g.count}</span></div>
            <div class="lb-stat"><span class="lb-stat-label">TREND</span><span class="lb-stat-val">${trendArrow}</span></div>
          </div>
        </div>`;
      }).join('');
      return;
    }

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
    function linReg(pts) { return Stats.linReg(pts); }
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
      ${renderSeasonRankings()}
      ${renderHotTakes()}
      ${renderDeepCuts()}
      ${renderSeasonWildStats()}
    `;
  }

  // ===== Season Rankings from allTeams (quad meets) =====
  function renderSeasonRankings() {
    const rankings = Stats.getSeasonRankings(meets);
    if (!rankings.length) return '';

    const rows = rankings.map(r => {
      const isOSU = r.team.toLowerCase().includes('oregon');
      const rowClass = isOSU ? ' class="rankings-osu-row"' : '';
      return `<tr${rowClass}>
        <td>${r.team}</td>
        <td>${r.appearances}</td>
        <td style="font-family:Oswald;font-weight:600">${r.avgTotal != null ? r.avgTotal.toFixed(3) : '—'}</td>
        <td>${r.bestTotal != null ? r.bestTotal.toFixed(3) : '—'}</td>
        <td>${r.vault != null ? r.vault.toFixed(3) : '—'}</td>
        <td>${r.bars != null ? r.bars.toFixed(3) : '—'}</td>
        <td>${r.beam != null ? r.beam.toFixed(3) : '—'}</td>
        <td>${r.floor != null ? r.floor.toFixed(3) : '—'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="section-card" style="margin-top:1.5rem;">
        <h2 class="section-title">🏆 Season Rankings (Quad Meets)</h2>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1rem">Aggregated from allTeams data across quad meets. Sorted by average total score.</p>
        <div style="overflow-x:auto">
          <table class="rankings-table">
            <thead><tr><th>Team</th><th>App.</th><th>Avg Total</th><th>Best Total</th><th>VT Avg</th><th>UB Avg</th><th>BB Avg</th><th>FX Avg</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ===== Deep Cuts: Factor × Event Correlation Matrix =====
  function renderDeepCuts() {
    function fmtR(r) { return r==null ? '—' : (r>=0?'+':'')+r.toFixed(2); }
    function rColor(r) {
      if (r == null) return '#333';
      const a = Math.abs(r);
      if (a < 0.2) return '#333';
      if (r > 0) return `rgba(46,204,113,${Math.min(0.9, a*1.2)})`;
      return `rgba(231,76,60,${Math.min(0.9, a*1.2)})`;
    }
    function rLabel(r) {
      if (r == null) return '—';
      const a = Math.abs(r);
      if (a < 0.2) return 'flat';
      if (a < 0.4) return 'weak';
      if (a < 0.6) return 'mod';
      if (a < 0.8) return 'strong';
      return 'v.strong';
    }

    // ── Build per-meet-day event averages ──────────────────────────────────
    const seenDates = new Set();
    const meetDays = [];
    meets.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(m => {
      if (seenDates.has(m.date)) return; seenDates.add(m.date);
      const osuA = m.athletes.filter(a=>a.team==='Oregon State');
      function evAvg(ev) {
        const sc = osuA.map(a=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        return sc.length ? mean(sc) : null;
      }
      meetDays.push({
        date: m.date,
        isHome: m.isHome ? 1 : 0,
        moonFullness: m.moonPhase?.fullness ?? null,
        tempHigh: m.weather?.tempHighF ?? null,
        precip: m.weather?.precipIn ?? null,
        elevFt: m.elevationFt ?? null,
        distMiles: m.distanceMiles ?? null,
        vtAvg: evAvg('vault'),
        ubAvg: evAvg('bars'),
        bbAvg: evAvg('beam'),
        fxAvg: evAvg('floor'),
        total: m.osuScore || null,
      });
    });

    const envFactors = [
      { key: 'moonFullness', label: 'Moon Fullness', emoji: '🌙', note: '0=new, 1=full' },
      { key: 'tempHigh', label: 'Outside Temp (°F)', emoji: '🌡️', note: 'weather at venue' },
      { key: 'precip', label: 'Precipitation (in)', emoji: '🌧️', note: 'rain/snow at venue' },
      { key: 'elevFt', label: 'Elevation (ft)', emoji: '🏔️', note: 'venue altitude' },
      { key: 'distMiles', label: 'Distance from Home', emoji: '✈️', note: 'miles from Corvallis' },
      { key: 'isHome', label: 'Home Game (1=yes)', emoji: '🏠', note: 'Gill Coliseum' },
    ];
    const eventCols = [
      { key: 'vtAvg', label: 'VAULT', emoji: '🤸' },
      { key: 'ubAvg', label: 'BARS', emoji: '💪' },
      { key: 'bbAvg', label: 'BEAM', emoji: '⚖️' },
      { key: 'fxAvg', label: 'FLOOR', emoji: '🔥' },
      { key: 'total', label: 'TOTAL', emoji: '🏆' },
    ];

    // Compute all r values
    const matrix = {};
    let maxR = 0, maxCell = null;
    envFactors.forEach(fac => {
      matrix[fac.key] = {};
      eventCols.forEach(ev => {
        const pairs = meetDays.filter(d=>d[fac.key]!=null&&d[ev.key]!=null);
        const r = pearson(pairs.map(d=>d[fac.key]), pairs.map(d=>d[ev.key]));
        matrix[fac.key][ev.key] = { r, n: pairs.length };
        if (r != null && Math.abs(r) > maxR) { maxR = Math.abs(r); maxCell = { fac, ev, r }; }
      });
    });

    // ── Gymnast-level correlations: height & class year per event ──────────
    const gymnLevelData = [];
    const heightSeen = {};
    meets.forEach(m => {
      m.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
        const bio = bios[a.name]; if (!bio) return;
        const h = bio.height; const cls = bio.classYear;
        const htIn = h ? (() => { const [f,i]=h.split('-').map(Number); return f*12+i; })() : null;
        const clsN = {Freshman:1,Sophomore:2,Junior:3,Senior:4,Graduate:5}[cls] || null;
        if (!heightSeen[a.name]) heightSeen[a.name] = true;
        ['vault','bars','beam','floor'].forEach(ev => {
          const s = a.scores[ev];
          if (s === undefined || s <= 0) return;
          gymnLevelData.push({ name: a.name, ev, score: s, htIn, clsN, date: m.date });
        });
      });
    });

    // Per-gymnast averages for height/class correlations
    const gymnAvgByEvent = {};
    const tempMap = {};
    gymnLevelData.forEach(d => {
      const key = `${d.name}|${d.ev}`;
      if (!tempMap[key]) tempMap[key] = { scores:[], htIn: d.htIn, clsN: d.clsN, name: d.name };
      tempMap[key].scores.push(d.score);
    });
    Object.values(tempMap).forEach(g => {
      const ev = Object.keys(tempMap).find(k=>tempMap[k]===g)?.split('|')[1];
    });

    // Rebuild with event key
    const gymnEventAvgs = {};
    Object.entries(tempMap).forEach(([key, g]) => {
      const ev = key.split('|')[1];
      if (!gymnEventAvgs[ev]) gymnEventAvgs[ev] = [];
      gymnEventAvgs[ev].push({ name: g.name, avg: mean(g.scores), htIn: g.htIn, clsN: g.clsN });
    });

    const gymnFactors = [
      { key: 'htIn',  label: 'Height (inches)', emoji: '📏', note: 'per gymnast avg per event' },
      { key: 'clsN',  label: 'Class Year (1-4)', emoji: '👩‍🎓', note: '1=Fr, 2=So, 3=Jr, 4=Sr' },
    ];

    const gymnCols = ['vault','bars','beam','floor'];
    const gymnEvLabel = {vault:'VAULT',bars:'BARS',beam:'BEAM',floor:'FLOOR'};
    const gymnMatrix = {};
    let maxGymnR = 0, maxGymnCell = null;
    gymnFactors.forEach(fac => {
      gymnMatrix[fac.key] = {};
      gymnCols.forEach(ev => {
        const data = gymnEventAvgs[ev] || [];
        const pairs = data.filter(g=>g[fac.key]!=null&&g.avg!=null);
        const r = pearson(pairs.map(g=>g[fac.key]), pairs.map(g=>g.avg));
        gymnMatrix[fac.key][ev] = { r, n: pairs.length };
        if (r!=null&&Math.abs(r)>maxGymnR) { maxGymnR=Math.abs(r); maxGymnCell={fac, ev, r}; }
      });
    });

    // ── Home state proximity effect ─────────────────────────────────────────
    const venueStateMap = {
      '2026-01-03': 'WA', '2026-01-09': 'UT', '2026-01-16': 'OR',
      '2026-01-25': 'OR', '2026-01-30': 'AL', '2026-02-06': 'ID',
      '2026-02-14': 'OR', '2026-02-22': 'TX', '2026-02-27': 'OR',
      '2026-03-06': 'UT', '2026-03-14': 'OR',
    };
    const proxData = { near: [], far: [] }; // scores when gymnast is near/far from home
    const proxByGymnast = {};
    meets.forEach(m => {
      const venueState = venueStateMap[m.date];
      if (!venueState) return;
      m.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
        const homeState = bios[a.name]?.homeState;
        if (!homeState) return;
        const scores = ['vault','bars','beam','floor'].map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (!scores.length) return;
        const near = homeState === venueState;
        if (!proxByGymnast[a.name]) proxByGymnast[a.name] = { near:[], far:[] };
        scores.forEach(s => {
          if (near) { proxData.near.push(s); proxByGymnast[a.name].near.push(s); }
          else { proxData.far.push(s); proxByGymnast[a.name].far.push(s); }
        });
      });
    });
    const proxNearAvg = mean(proxData.near), proxFarAvg = mean(proxData.far);
    const proxDiff = proxNearAvg && proxFarAvg ? proxNearAvg - proxFarAvg : null;
    const proxGymnasts = Object.entries(proxByGymnast)
      .filter(([,g])=>g.near.length>0&&g.far.length>0)
      .map(([name,g])=>({ name, nearAvg: mean(g.near), farAvg: mean(g.far), diff: mean(g.near)-mean(g.far) }))
      .sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));

    // ── Pre-college achievement count vs season avg ─────────────────────────
    const achieveData = [];
    meets.forEach(m => {
      m.athletes.filter(a=>a.team==='Oregon State').forEach(a => {
        const bio = bios[a.name];
        if (!bio?.priorHistory) return;
        const achieveCount = bio.priorHistory.filter(b=>/national|champion|qualifier|pac-12|award|place|finish/i.test(b)).length;
        const scores = ['vault','bars','beam','floor'].map(ev=>a.scores[ev]).filter(s=>s!==undefined&&s>0);
        if (!scores.length||!achieveCount) return;
        achieveData.push({ name: a.name, achieveCount, avgScore: mean(scores) });
      });
    });
    const achByGymnast = {};
    achieveData.forEach(d => {
      if (!achByGymnast[d.name]) achByGymnast[d.name] = { count: d.achieveCount, scores: [] };
      achByGymnast[d.name].scores.push(d.avgScore);
    });
    const achList = Object.entries(achByGymnast).map(([name,g])=>({ name, achieveCount: g.count, avgScore: mean(g.scores) }));
    const achR = achList.length >= 3 ? pearson(achList.map(g=>g.achieveCount), achList.map(g=>g.avgScore)) : null;

    // ── Weather type vs event ───────────────────────────────────────────────
    // Group meets by clear/cloudy/rainy then compare event avgs
    const weatherGroups = { '☀️ Clear/Partly Cloudy': [], '☁️ Cloudy/Foggy': [], '🌧️ Rain/Snow': [] };
    meetDays.forEach(d => {
      const m = meets.find(mm=>mm.date===d.date);
      const code = m?.weather?.weatherCode ?? null;
      if (code == null) return;
      let group;
      if (code <= 3) group = '☀️ Clear/Partly Cloudy';
      else if (code <= 48) group = '☁️ Cloudy/Foggy';
      else group = '🌧️ Rain/Snow';
      ['vtAvg','ubAvg','bbAvg','fxAvg','total'].forEach(ev => {
        if (d[ev] != null) {
          if (!weatherGroups[group][ev]) weatherGroups[group][ev] = [];
          weatherGroups[group][ev].push(d[ev]);
        }
      });
      // Push total for group avg
      if (d.total) weatherGroups[group].push(d.total);
    });

    // Render the matrix HTML
    function matrixCell(r, n) {
      if (r == null) return `<td class="mx-cell mx-null" title="n<3">—</td>`;
      const bg = rColor(r);
      const label = rLabel(r);
      const textColor = Math.abs(r) > 0.4 ? '#fff' : '#aaa';
      return `<td class="mx-cell" style="background:${bg};color:${textColor}" title="r=${r.toFixed(3)}, n=${n}">
        <span class="mx-r">${fmtR(r)}</span>
        <span class="mx-label">${label}</span>
      </td>`;
    }

    // Find the wildest single finding to call out
    const wildFindings = [];
    if (maxCell) {
      const dir = maxCell.r > 0 ? 'higher' : 'lower';
      const ev = maxCell.ev.label;
      const facLabel = maxCell.fac.label.toLowerCase();
      wildFindings.push(`The single strongest correlation in the dataset: <strong>${maxCell.fac.emoji} ${maxCell.fac.label}</strong> vs <strong>${maxCell.ev.emoji} ${maxCell.ev.label}</strong> — r = <strong>${fmtR(maxCell.r)}</strong>. Translation: OSU scores significantly ${dir} on ${ev.toLowerCase()} when ${facLabel} is ${maxCell.r>0?'high':'low'}.`);
    }
    if (maxGymnCell) {
      const dir = maxGymnCell.r > 0 ? 'higher' : 'lower';
      const evLabel = gymnEvLabel[maxGymnCell.ev];
      wildFindings.push(`Across gymnasts: <strong>${maxGymnCell.fac.emoji} ${maxGymnCell.fac.label}</strong> vs <strong>${evLabel}</strong> avg — r = <strong>${fmtR(maxGymnCell.r)}</strong>. ${maxGymnCell.fac.key==='htIn'?`${dir==='higher'?'Taller':'Shorter'} gymnasts score ${dir} on ${evLabel.toLowerCase()}. ${maxGymnCell.ev==='bars'?'More reach = more power on bars.':maxGymnCell.ev==='beam'?'Height affects center of gravity.':'The physics checks out.'}`:''}`);
    }
    if (proxDiff != null && Math.abs(proxDiff) > 0.01) {
      wildFindings.push(`Playing near their home state, OSU gymnasts average <strong>${fmt(proxNearAvg)}</strong> vs <strong>${fmt(proxFarAvg)}</strong> far from home — a <strong>${proxDiff>=0?'+':''}${fmt(proxDiff)}</strong> pt/event home-state effect.${proxGymnasts[0]?` Biggest individual effect: <span class="clickable-name" data-gymnast="${proxGymnasts[0].name}">${proxGymnasts[0].name}</span> (${proxGymnasts[0].diff>=0?'+':''}${fmt(proxGymnasts[0].diff)} pts near home).`:''}`);
    }
    if (achR != null && Math.abs(achR) > 0.15) {
      const dir = achR > 0 ? 'more' : 'fewer';
      wildFindings.push(`Pre-college achievements vs season performance: r = <strong>${fmtR(achR)}</strong>. Gymnasts with ${dir} pre-college titles tend to score ${achR>0?'higher':'lower'} this season. ${achR > 0.4 ? 'Elite pedigree predicts elite performance.' : achR < -0.2 ? 'Interesting — prior accolades don\'t guarantee current form.' : 'Prior achievements explain some but not all performance.'}`);
    }

    return `
      <div class="section-card" style="margin-top:1.5rem;">
        <h2 class="section-title">🔬 Factor × Event Correlation Matrix</h2>
        <p class="wild-intro">Every environmental factor crossed with every individual event. Green = higher score, Red = lower score. Deeper color = stronger signal.</p>

        ${wildFindings.length ? `<div class="deep-findings">
          ${wildFindings.map(f=>`<div class="deep-finding">⚡ ${f}</div>`).join('')}
        </div>` : ''}

        <div class="mx-section-label">🌍 Environmental Factors × Meet Performance (n=${meetDays.length} comp days)</div>
        <div class="mx-table-wrap">
          <table class="mx-table">
            <thead>
              <tr>
                <th class="mx-factor-head">Factor</th>
                ${eventCols.map(ev=>`<th>${ev.emoji}<br>${ev.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${envFactors.map(fac => `
                <tr>
                  <td class="mx-factor-label">
                    <span class="mx-fac-emoji">${fac.emoji}</span>
                    <span>${fac.label}</span>
                    <span class="mx-fac-note">${fac.note}</span>
                  </td>
                  ${eventCols.map(ev => matrixCell(matrix[fac.key][ev.key].r, matrix[fac.key][ev.key].n)).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="mx-section-label" style="margin-top:1.5rem;">🧬 Gymnast Characteristics × Event Performance (per gymnast season avg)</div>
        <div class="mx-table-wrap">
          <table class="mx-table">
            <thead>
              <tr>
                <th class="mx-factor-head">Factor</th>
                ${gymnCols.map(ev=>`<th>${gymnEvLabel[ev]}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${gymnFactors.map(fac => `
                <tr>
                  <td class="mx-factor-label">
                    <span class="mx-fac-emoji">${fac.emoji}</span>
                    <span>${fac.label}</span>
                    <span class="mx-fac-note">${fac.note}</span>
                  </td>
                  ${gymnCols.map(ev => matrixCell(gymnMatrix[fac.key][ev].r, gymnMatrix[fac.key][ev].n)).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        ${proxData.near.length && proxData.far.length ? `
        <div class="mx-section-label" style="margin-top:1.5rem;">🏡 Home State Proximity Effect — Do Gymnasts Perform Better Near Home?</div>
        <div class="prox-summary">
          <div class="prox-stat">
            <div class="prox-val ${proxDiff>0?'prox-pos':'prox-neg'}">${fmt(proxNearAvg)}</div>
            <div class="prox-label">Near Home State (${proxData.near.length} events)</div>
          </div>
          <div class="prox-vs">vs</div>
          <div class="prox-stat">
            <div class="prox-val">${fmt(proxFarAvg)}</div>
            <div class="prox-label">Away from Home State (${proxData.far.length} events)</div>
          </div>
          <div class="prox-diff" style="color:${proxDiff>0?'#2ecc71':'#e74c3c'}">${proxDiff>=0?'+':''}${fmt(proxDiff)} pts/event</div>
        </div>
        ${proxGymnasts.length ? `
        <div class="mx-table-wrap">
          <table class="mx-table" style="margin-top:0.75rem;">
            <thead><tr><th class="mx-factor-head">Gymnast</th><th>Home</th><th>Near-Home Avg</th><th>Away Avg</th><th>Near-Home Δ</th></tr></thead>
            <tbody>
              ${proxGymnasts.map(g=>`<tr>
                <td class="mx-factor-label"><span class="clickable-name" data-gymnast="${g.name}">${g.name}</span> (${bios[g.name]?.homeState||'?'})</td>
                <td style="font-size:0.75rem;color:#666">${bios[g.name]?.hometown?.split(',')[1]?.trim()||'?'}</td>
                <td class="mx-cell" style="background:rgba(46,204,113,0.15)">${fmt(g.nearAvg)}</td>
                <td class="mx-cell">${fmt(g.farAvg)}</td>
                <td class="mx-cell" style="color:${g.diff>0?'#2ecc71':'#e74c3c'};font-weight:700">${g.diff>=0?'+':''}${fmt(g.diff)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}` : ''}

        ${achList.length >= 3 ? `
        <div class="mx-section-label" style="margin-top:1.5rem;">🏅 Pre-College Achievement Count vs Season Performance (r = ${fmtR(achR)})</div>
        <div class="mx-table-wrap">
          <table class="mx-table">
            <thead><tr><th class="mx-factor-head">Gymnast</th><th>Pre-College Titles</th><th>Season Event Avg</th><th>vs Group Mean</th></tr></thead>
            <tbody>
              ${achList.sort((a,b)=>b.achieveCount-a.achieveCount).map(g => {
                const groupMean = mean(achList.map(x=>x.avgScore));
                const diff = groupMean ? g.avgScore - groupMean : null;
                return `<tr>
                  <td class="mx-factor-label"><span class="clickable-name" data-gymnast="${g.name}">${g.name}</span></td>
                  <td class="mx-cell">${g.achieveCount} 🏅</td>
                  <td class="mx-cell" style="color:var(--orange)">${fmt(g.avgScore)}</td>
                  <td class="mx-cell" style="color:${diff>0?'#2ecc71':diff<0?'#e74c3c':'#aaa'}">${diff!=null?(diff>=0?'+':'')+fmt(diff):'—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : ''}

      </div>`;
  }
// ===== Season Wild Stats =====
  function renderSeasonWildStats() {
    // ── Shared stats helpers ────────────────────────────────────────────────
    function sd(arr) {
      if(arr.length < 2) return null;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s,v)=>s+Math.pow(v-m,2),0)/(arr.length-1));
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
      if(!m.osuScore || m.osuScore <= 0) return;
      compDays.push({
        date: m.date,
        total: m.osuScore,
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
      const banner = e.target.closest('.quad-banner-click');
      if (banner) { showQuadOverview(banner.dataset.quadName, banner.dataset.quadDate); return; }
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
      if (!tab) return;
      document.querySelectorAll('.event-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.event === 'heatmap') renderHeatMap();
      else renderLeaderboard(tab.dataset.event);
    });

    // Global click delegation for clickable names, meets, teams
    document.addEventListener('click', e => {
      const nameEl = e.target.closest('.clickable-name');
      if (nameEl) {
        e.preventDefault();
        if (nameEl.classList.contains('lineup-gymnast')) {
          togglePerformancePanel(nameEl);
          return;
        }
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
      if (quadTab && quadTab.dataset.quadOverview) {
        e.preventDefault();
        const [quadName, date] = quadTab.dataset.quadOverview.split('|');
        showQuadOverview(quadName, date);
        return;
      }
      if (quadTab && quadTab.dataset.meetId) {
        e.preventDefault();
        showMeetDetail(quadTab.dataset.meetId);
        return;
      }
      const eventCard = e.target.closest('.detail-event-clickable');
      if (eventCard && !e.target.closest('.clickable-name')) {
        e.preventDefault();
        showEventDetail(eventCard.dataset.event, eventCard.dataset.fromMeet);
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
