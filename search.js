/* search.js — Wikipedia search overlay
   Search input → opensearch API → results list with thumbnails
   Recent searches stored in localStorage via Store             */

const Search = (() => {

  const SEARCH_API = q =>
    `https://en.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(q)}&srlimit=15&srprop=snippet` +
    `&prop=pageimages&piprop=thumbnail&pithumbsize=60` +
    `&format=json&origin=*`;

  /* Separate call to get thumbnails for the result titles */
  const THUMB_API = titles =>
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}` +
    `&prop=pageimages&piprop=thumbnail&pithumbsize=80&format=json&origin=*`;

  const RECENT_KEY  = 'rh_recent_searches';
  const MAX_RECENT  = 8;
  const DEBOUNCE_MS = 320;

  /* ── Recent searches via localStorage ── */
  const Recent = {
    get:    ()    => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } },
    add:    q     => {
      const list = Recent.get().filter(r => r !== q);
      localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...list].slice(0, MAX_RECENT)));
    },
    remove: q     => localStorage.setItem(RECENT_KEY, JSON.stringify(Recent.get().filter(r => r !== q))),
    clear:  ()    => localStorage.removeItem(RECENT_KEY),
  };

  /* ── DOM refs ── */
  let overlay, searchInput, searchClear, searchClose,
      recentSection, recentList, clearHistoryBtn,
      resultsSection, resultsList, loadingEl, emptyEl;

  let debounceTimer = null;
  let onNavigate    = null; /* callback(title) injected from app.js */

  function init(navigateCallback) {
    onNavigate = navigateCallback;

    overlay        = document.getElementById('search-overlay');
    searchInput    = document.getElementById('search-input');
    searchClear    = document.getElementById('search-clear');
    searchClose    = document.getElementById('search-close');
    recentSection  = document.getElementById('search-recent');
    recentList     = document.getElementById('search-recent-list');
    clearHistoryBtn= document.getElementById('search-clear-history');
    resultsSection = document.getElementById('search-results');
    resultsList    = document.getElementById('search-results-list');
    loadingEl      = document.getElementById('search-loading');
    emptyEl        = document.getElementById('search-empty');

    /* Wire up btn-search in action column */
    document.getElementById('btn-search')
      ?.addEventListener('click', open);

    searchClose.addEventListener('click', close);

    /* Clear input button */
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.hidden = true;
      showRecent();
      searchInput.focus();
    });

    /* Clear all history */
    clearHistoryBtn.addEventListener('click', () => {
      Recent.clear();
      renderRecent();
    });

    /* Input handler — debounced search */
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      searchClear.hidden = q.length === 0;

      clearTimeout(debounceTimer);
      if (q.length === 0) {
        showRecent();
        return;
      }
      if (q.length < 2) return;

      debounceTimer = setTimeout(() => doSearch(q), DEBOUNCE_MS);
    });

    /* Enter key — immediate search */
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        if (q) doSearch(q);
      }
      if (e.key === 'Escape') close();
    });

    /* Dismiss on backdrop tap */
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });
  }

  /* ── Open ── */
  function open() {
    overlay.classList.remove('search-overlay--hidden');
    overlay.classList.add('search-overlay--visible');
    searchInput.value = '';
    searchClear.hidden = true;
    showRecent();
    /* Delay focus so iOS keyboard doesn't glitch during transition */
    setTimeout(() => searchInput.focus(), 320);
  }

  /* ── Close ── */
  function close() {
    overlay.classList.remove('search-overlay--visible');
    overlay.classList.add('search-overlay--hidden');
    searchInput.blur();
    clearTimeout(debounceTimer);
  }

  /* ── Show recent searches panel ── */
  function showRecent() {
    resultsSection.hidden = true;
    recentSection.hidden  = false;
    renderRecent();
  }

  function renderRecent() {
    const recents = Recent.get();
    recentList.innerHTML = '';

    if (recents.length === 0) {
      recentList.innerHTML = `<li class="search-list__empty">No recent searches</li>`;
      return;
    }

    recents.forEach(q => {
      const li = document.createElement('li');
      li.className = 'search-list__item search-list__item--recent';
      li.innerHTML = `
        <div class="search-list__thumb search-list__thumb--icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>
        <div class="search-list__text">
          <span class="search-list__title">${escHtml(q)}</span>
        </div>
        <button class="search-list__remove" aria-label="Remove" data-query="${escHtml(q)}">✕</button>
      `;
      /* Tap item — run search */
      li.addEventListener('click', e => {
        if (e.target.closest('.search-list__remove')) return;
        searchInput.value = q;
        searchClear.hidden = false;
        doSearch(q);
      });
      /* Remove individual recent */
      li.querySelector('.search-list__remove').addEventListener('click', e => {
        e.stopPropagation();
        Recent.remove(q);
        renderRecent();
      });
      recentList.appendChild(li);
    });
  }

  /* ── Do search ── */
  async function doSearch(q) {
    recentSection.hidden  = true;
    resultsSection.hidden = false;
    resultsList.innerHTML = '';
    emptyEl.hidden        = true;
    loadingEl.hidden      = false;

    try {
      const res  = await fetch(SEARCH_API(q));
      const data = await res.json();
      const hits = data.query?.search || [];

      loadingEl.hidden = true;

      if (hits.length === 0) {
        emptyEl.hidden = false;
        return;
      }

      /* Fetch thumbnails in one batch call */
      const titleStr = hits.map(h => h.title).join('|');
      const thumbMap = await fetchThumbs(titleStr);

      renderResults(hits, thumbMap, q);

    } catch {
      loadingEl.hidden = true;
      emptyEl.hidden   = false;
    }
  }

  async function fetchThumbs(titleStr) {
    try {
      const res  = await fetch(THUMB_API(titleStr));
      const data = await res.json();
      const pages = data.query?.pages || {};
      const map = {};
      Object.values(pages).forEach(p => {
        if (p.thumbnail) map[p.title] = p.thumbnail.source;
      });
      return map;
    } catch { return {}; }
  }

  /* ── Render results list ── */
  function renderResults(hits, thumbMap, query) {
    resultsList.innerHTML = '';

    hits.forEach(hit => {
      const li  = document.createElement('li');
      li.className = 'search-list__item';

      const thumb = thumbMap[hit.title];
      const thumbHTML = thumb
        ? `<img class="search-list__thumb-img" src="${thumb}" alt="" loading="lazy" />`
        : `<div class="search-list__thumb-placeholder"></div>`;

      /* Strip HTML from snippet */
      const div = document.createElement('div');
      div.innerHTML = hit.snippet || '';
      const desc = div.textContent || '';

      li.innerHTML = `
        <div class="search-list__thumb">${thumbHTML}</div>
        <div class="search-list__text">
          <span class="search-list__title">${escHtml(hit.title)}</span>
          <span class="search-list__desc">${escHtml(desc.slice(0, 80))}…</span>
        </div>
      `;

      li.addEventListener('click', () => {
        Recent.add(query);
        close();
        if (onNavigate) onNavigate(hit.title);
      });

      resultsList.appendChild(li);
    });
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, open, close };

})();
