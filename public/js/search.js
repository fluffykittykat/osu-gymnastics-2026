/* ===== OSU Gymnastics 2026 - Global Search ===== */

(function (global) {
  'use strict';

  // ===== Search Index =====
  let searchIndex = [];
  let indexBuilt = false;

  const EVENT_NAMES = {
    vault: 'Vault', bars: 'Bars', beam: 'Beam', floor: 'Floor', aa: 'All-Around'
  };

  const TYPE_PRIORITY = { gymnast: 0, meet: 1, event: 2, location: 3, score: 4 };

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ===== Build Index from meets data =====
  function buildSearchIndex(meets) {
    if (indexBuilt) return;
    searchIndex = [];

    // ---- Gymnasts ----
    const gymnasts = {};
    meets.forEach(meet => {
      meet.athletes.forEach(a => {
        if (!gymnasts[a.name]) {
          gymnasts[a.name] = { name: a.name, events: new Set() };
        }
        Object.keys(a.scores).forEach(e => {
          if (e !== 'aa') gymnasts[a.name].events.add(e);
        });
      });
    });

    Object.values(gymnasts).forEach(g => {
      const eventLabels = Array.from(g.events)
        .map(e => EVENT_NAMES[e] || e)
        .join(', ');
      const allEvents = g.events.size === 4 ? eventLabels + ', AA' : eventLabels;
      searchIndex.push({
        type: 'gymnast',
        label: g.name,
        sublabel: `Oregon State · ${allEvents}`,
        action: `gymnast:${g.name}`,
        searchText: `${g.name} Oregon State gymnast ${allEvents}`.toLowerCase(),
      });
    });

    // ---- Meets ----
    meets.forEach(meet => {
      if (!meet || !meet.opponent) return; // Skip invalid meets
      const homeAway = meet.isHome ? 'Home' : 'Away';
      const osuScore = meet.osuScore ? meet.osuScore.toFixed(3) : 'N/A';
      const oppScore = meet.opponentScore ? meet.opponentScore.toFixed(3) : 'N/A';
      const resultStr = `${meet.result || '?'} ${osuScore}–${oppScore}`;
      const dateStr = formatDate(meet.date);
      searchIndex.push({
        type: 'meet',
        label: `vs ${meet.opponent}`,
        sublabel: `${dateStr} · ${homeAway} · ${resultStr}`,
        action: `meet:${meet.id}`,
        searchText: `${meet.opponent} meet ${homeAway} ${meet.result} ${dateStr} ${meet.location} ${resultStr}`.toLowerCase(),
      });
    });

    // ---- Events (season-level) ----
    ['vault', 'bars', 'beam', 'floor', 'aa'].forEach(event => {
      // Find best score across all meets for this event
      let bestScore = 0;
      let bestAthlete = '';
      meets.forEach(meet => {
        meet.athletes.forEach(a => {
          if (a.scores[event] !== undefined && a.scores[event] > bestScore) {
            bestScore = a.scores[event];
            bestAthlete = a.name;
          }
        });
      });

      const eventName = EVENT_NAMES[event];
      const bestStr = bestScore > 0 ? `Best: ${bestScore.toFixed(3)} (${bestAthlete})` : '';
      searchIndex.push({
        type: 'event',
        label: eventName,
        sublabel: `Season leaderboard · ${bestStr}`,
        action: `leaderboard:${event}`,
        searchText: `${eventName} event leaderboard season ${bestStr} ${event}`.toLowerCase(),
      });
    });

    // ---- Locations ----
    const locations = {};
    meets.forEach(meet => {
      const locKey = meet.location;
      if (!locations[locKey]) {
        locations[locKey] = { location: meet.location, homeCount: 0, totalCount: 0 };
      }
      locations[locKey].totalCount++;
      if (meet.isHome) locations[locKey].homeCount++;
    });

    Object.values(locations).forEach(loc => {
      const countStr = loc.homeCount > 0
        ? `${loc.homeCount} home meet${loc.homeCount !== 1 ? 's' : ''}`
        : `${loc.totalCount} meet${loc.totalCount !== 1 ? 's' : ''}`;
      searchIndex.push({
        type: 'location',
        label: loc.location,
        sublabel: countStr,
        action: loc.homeCount > 0 ? `filter:home` : `filter:away`,
        searchText: `${loc.location} location ${countStr}`.toLowerCase(),
      });
    });

    // ---- Individual Scores ----
    meets.forEach(meet => {
      meet.athletes.forEach(a => {
        ['vault', 'bars', 'beam', 'floor', 'aa'].forEach(event => {
          if (a.scores[event] === undefined) return;
          const score = a.scores[event];
          const eventName = EVENT_NAMES[event];
          const dateStr = formatDate(meet.date);
          searchIndex.push({
            type: 'score',
            label: `${a.name} · ${eventName} · ${score.toFixed(3)}`,
            sublabel: `vs ${meet.opponent} · ${dateStr}`,
            value: score,
            action: `meet:${meet.id}`,
            searchText: `${a.name} ${eventName} ${score.toFixed(3)} ${score} ${meet.opponent} ${dateStr} score`.toLowerCase(),
          });
        });
      });
    });

    indexBuilt = true;
  }

  // ===== Fuzzy Search Algorithm =====
  function scoreEntry(entry, tokens) {
    let totalScore = 0;
    const text = entry.searchText;
    const label = entry.label.toLowerCase();

    for (const token of tokens) {
      let tokenScore = 0;
      if (label === token) {
        tokenScore = 3;
      } else if (label.startsWith(token)) {
        tokenScore = 2;
      } else if (text.includes(token)) {
        tokenScore = 1;
      } else {
        return -1; // AND logic: all tokens must match
      }
      totalScore += tokenScore;
    }
    return totalScore;
  }

  function search(query) {
    if (!query || !query.trim()) return [];

    const tokens = query.trim().toLowerCase().split(/\s+/);
    const results = [];

    for (const entry of searchIndex) {
      const score = scoreEntry(entry, tokens);
      if (score > 0) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const pa = TYPE_PRIORITY[a.entry.type] != null ? TYPE_PRIORITY[a.entry.type] : 99;
      const pb = TYPE_PRIORITY[b.entry.type] != null ? TYPE_PRIORITY[b.entry.type] : 99;
      return pa - pb;
    });

    return results.slice(0, 10).map(r => r.entry);
  }

  // ===== Action Handler =====
  function handleResultAction(action) {
    if (!action) return;
    const [type, value] = action.split(':');

    if (type === 'gymnast') {
      // Navigate to gymnast profile
      if (global.OSUSearch && global.OSUSearch.onGymnastSelect) {
        global.OSUSearch.onGymnastSelect(value);
      }
    } else if (type === 'meet') {
      if (global.OSUSearch && global.OSUSearch.onMeetSelect) {
        global.OSUSearch.onMeetSelect(value);
      }
    } else if (type === 'leaderboard') {
      if (global.OSUSearch && global.OSUSearch.onLeaderboardSelect) {
        global.OSUSearch.onLeaderboardSelect(value);
      }
    } else if (type === 'filter') {
      if (global.OSUSearch && global.OSUSearch.onFilterSelect) {
        global.OSUSearch.onFilterSelect(value);
      }
    }
  }

  // ===== Type Icons =====
  const TYPE_ICONS = {
    gymnast: '🤸',
    meet: '📅',
    event: '🏅',
    location: '📍',
    score: '🔢',
  };

  const TYPE_LABELS = {
    gymnast: 'Gymnasts',
    meet: 'Meets',
    event: 'Events',
    location: 'Locations',
    score: 'Scores',
  };

  // ===== Search UI =====
  let dropdownEl = null;
  let inputEl = null;
  let debounceTimer = null;
  let activeIndex = -1;
  let currentResults = [];
  let isOpen = false;

  function createSearchUI() {
    // ---- Desktop search bar (injected into top nav) ----
    const desktopWrap = document.createElement('div');
    desktopWrap.className = 'global-search-wrap desktop-search';
    desktopWrap.innerHTML = `
      <div class="global-search-inner">
        <span class="search-icon">🔍</span>
        <input type="text" class="global-search-input" id="globalSearchInput"
               placeholder="Search gymnasts, meets, events… (press / to focus)"
               autocomplete="off" spellcheck="false" aria-label="Search" aria-autocomplete="list" aria-haspopup="listbox" role="combobox" aria-expanded="false">
        <span class="search-shortcut-hint">/</span>
        <div class="global-search-dropdown" id="globalSearchDropdown" role="listbox" aria-label="Search results"></div>
      </div>
    `;

    // ---- Mobile search bar (below top nav, above content) ----
    const mobileWrap = document.createElement('div');
    mobileWrap.className = 'global-search-wrap mobile-search';
    mobileWrap.innerHTML = `
      <div class="global-search-inner">
        <span class="search-icon">🔍</span>
        <input type="text" class="global-search-input" id="globalSearchInputMobile"
               placeholder="Search…"
               autocomplete="off" spellcheck="false" aria-label="Search" role="combobox" aria-expanded="false">
        <div class="global-search-dropdown" id="globalSearchDropdownMobile" role="listbox" aria-label="Search results"></div>
      </div>
    `;

    // Insert desktop search into top nav, between brand and links
    const topNav = document.getElementById('topNav');
    const navLinks = topNav.querySelector('.nav-links');
    topNav.insertBefore(desktopWrap, navLinks);

    // Insert mobile search before main#app
    const mainEl = document.getElementById('app');
    document.body.insertBefore(mobileWrap, mainEl);

    // Set references (use desktop input as primary, mobile as secondary)
    setupInputListeners(
      document.getElementById('globalSearchInput'),
      document.getElementById('globalSearchDropdown'),
      desktopWrap
    );
    setupInputListeners(
      document.getElementById('globalSearchInputMobile'),
      document.getElementById('globalSearchDropdownMobile'),
      mobileWrap
    );

    // Global '/' shortcut
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        // Focus visible input
        const desktopInput = document.getElementById('globalSearchInput');
        const mobileInput = document.getElementById('globalSearchInputMobile');
        if (window.innerWidth >= 768) {
          desktopInput.focus();
        } else {
          mobileInput.focus();
        }
      }
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('.global-search-wrap')) {
        closeAllDropdowns();
      }
    });
  }

  function setupInputListeners(input, dropdown, wrap) {
    if (!input || !dropdown) return;

    let localActiveIndex = -1;
    let localResults = [];

    function renderDropdown(results) {
      localResults = results;
      localActiveIndex = -1;
      input.setAttribute('aria-expanded', results.length > 0 ? 'true' : 'false');

      if (results.length === 0) {
        const q = input.value.trim();
        if (q.length === 0) {
          dropdown.innerHTML = '';
          dropdown.classList.remove('open');
          return;
        }
        dropdown.innerHTML = `
          <div class="search-no-results">
            <div class="no-results-icon">🔍</div>
            <div class="no-results-text">No results for "<strong>${escapeHtml(q)}</strong>"</div>
            <div class="no-results-tips">Tips: try a gymnast name, meet opponent, event (vault, bars…), score (9.95), or location</div>
          </div>`;
        dropdown.classList.add('open');
        return;
      }

      // Group by type
      const groups = {};
      results.forEach(r => {
        if (!groups[r.type]) groups[r.type] = [];
        groups[r.type].push(r);
      });

      const typeOrder = ['gymnast', 'meet', 'event', 'location', 'score'];
      let html = '';
      let globalIdx = 0;

      typeOrder.forEach(type => {
        if (!groups[type]) return;
        html += `<div class="search-group-header">${TYPE_LABELS[type] || type}</div>`;
        groups[type].forEach(entry => {
          const icon = TYPE_ICONS[entry.type] || '•';
          html += `
            <div class="search-result-item" role="option" data-idx="${globalIdx}" data-action="${escapeHtml(entry.action)}" tabindex="-1">
              <span class="result-icon">${icon}</span>
              <div class="result-text">
                <div class="result-label">${escapeHtml(entry.label)}</div>
                <div class="result-sublabel">${escapeHtml(entry.sublabel)}</div>
              </div>
              <span class="result-chevron">›</span>
            </div>`;
          globalIdx++;
        });
      });

      dropdown.innerHTML = html;
      dropdown.classList.add('open');

      // Click on result
      dropdown.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const action = item.dataset.action;
          closeAllDropdowns();
          input.value = '';
          handleResultAction(action);
        });
      });
    }

    function setActive(idx) {
      const items = dropdown.querySelectorAll('.search-result-item');
      items.forEach(i => i.classList.remove('active'));
      localActiveIndex = idx;
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    function doSearch(q) {
      const results = search(q);
      renderDropdown(results);
    }

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) {
        renderDropdown([]);
        return;
      }
      debounceTimer = setTimeout(() => doSearch(q), 80);
    });

    input.addEventListener('keydown', e => {
      const items = dropdown.querySelectorAll('.search-result-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(localActiveIndex + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(localActiveIndex - 1, 0));
      } else if (e.key === 'Enter') {
        if (localActiveIndex >= 0 && items[localActiveIndex]) {
          const action = items[localActiveIndex].dataset.action;
          closeAllDropdowns();
          input.value = '';
          handleResultAction(action);
        }
      } else if (e.key === 'Escape') {
        closeAllDropdowns();
        input.blur();
      }
    });

    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q && localResults.length > 0) {
        dropdown.classList.add('open');
      }
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.global-search-dropdown').forEach(d => {
      d.classList.remove('open');
      d.innerHTML = '';
    });
    document.querySelectorAll('.global-search-input').forEach(i => {
      i.setAttribute('aria-expanded', 'false');
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===== Public API =====
  global.OSUSearch = {
    buildIndex: buildSearchIndex,
    createUI: createSearchUI,
    // Navigation callbacks — set by app.js after init
    onGymnastSelect: null,
    onMeetSelect: null,
    onLeaderboardSelect: null,
    onFilterSelect: null,
  };

})(window);
