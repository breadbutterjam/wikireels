/* categories.js — category definitions, pill rendering,
   Wikipedia search-based article fetching per category   */

const Categories = (() => {

  /* ── Category definitions ── */
  const ALL = [
    { id: 'cricket',    label: 'Cricket',              icon: '🏏', query: 'cricket sport history' },
    { id: 'tennis',     label: 'Tennis',               icon: '🎾', query: 'tennis tournament player' },
    { id: 'bollywood',  label: 'Bollywood',            icon: '🎬', query: 'bollywood hindi cinema film' },
    { id: 'indhistory', label: 'Indian History',       icon: '🏛️', query: 'history of india ancient medieval' },
    { id: 'whistory',   label: 'World History',        icon: '🌍', query: 'world history civilization empire' },
    { id: 'politics',   label: 'Politics',             icon: '⚖️', query: 'politics government democracy' },
    { id: 'science',    label: 'Science',              icon: '🔬', query: 'science discovery research' },
    { id: 'space',      label: 'Space',                icon: '🚀', query: 'space astronomy universe NASA' },
    { id: 'cars',       label: 'Cars',                 icon: '🚗', query: 'automobile car engineering' },
    { id: 'f1',         label: 'Formula One',          icon: '🏎️', query: 'formula one racing grand prix' },
    { id: 'ai',         label: 'Artificial Intelligence', icon: '🤖', query: 'artificial intelligence machine learning' },
  ];

  /* ── Article pool cache — per category ── */
  /* Map<categoryId, {pool: Article[], cursor: number, fetching: bool}> */
  const pools = new Map();

  const SEARCH_BASE = 'https://en.wikipedia.org/w/api.php?' + [
    'action=query',
    'list=search',
    'format=json',
    'origin=*',
    'srlimit=50',          /* fetch 50 results per query */
    'srnamespace=0',       /* articles only              */
    'srprop=snippet',
  ].join('&');

  const SUMMARY_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

  /* ── Fetch a pool of article titles for a category ── */
  async function fetchPool(catId) {
    const cat = ALL.find(c => c.id === catId);
    if (!cat) return [];

    const url = `${SEARCH_BASE}&srsearch=${encodeURIComponent(cat.query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.query?.search || []).map(r => r.title);
  }

  /* ── Get a random article summary from a category ── */
  async function fetchFromCategory(catId) {
    /* Ensure pool exists */
    if (!pools.has(catId)) {
      pools.set(catId, { titles: [], cursor: 0, ready: false });
      const titles = await fetchPool(catId);
      /* Shuffle for randomness */
      const shuffled = titles.sort(() => Math.random() - 0.5);
      pools.set(catId, { titles: shuffled, cursor: 0, ready: true });
    }

    const pool = pools.get(catId);

    /* Wait for pool if it's mid-fetch */
    if (!pool.ready) {
      await new Promise(r => setTimeout(r, 300));
      return fetchFromCategory(catId);
    }

    if (pool.titles.length === 0) {
      /* Pool empty — fallback to random */
      return null;
    }

    /* Round-robin with wrap */
    const title = pool.titles[pool.cursor % pool.titles.length];
    pool.cursor++;

    /* Fetch summary for chosen title */
    try {
      const res = await fetch(`${SUMMARY_BASE}${encodeURIComponent(title)}`);
      if (!res.ok) throw new Error();
      return await res.json();
    } catch {
      /* Skip this title — try next */
      return fetchFromCategory(catId);
    }
  }

  /* ── Fetch from a random one of the selected categories ── */
  async function fetchFromSelected() {
    const selected = Store.getCategories();
    if (!selected || selected.length === 0) return null; /* fall through to random */

    const catId = selected[Math.floor(Math.random() * selected.length)];
    return fetchFromCategory(catId);
  }

  /* ── Pre-warm pools for all selected categories ── */
  async function warmPools() {
    const selected = Store.getCategories();
    if (!selected || selected.length === 0) return;
    /* Fire and forget — don't await, just start loading */
    selected.forEach(id => {
      if (!pools.has(id)) fetchPool(id).then(titles => {
        pools.set(id, {
          titles: titles.sort(() => Math.random() - 0.5),
          cursor: 0,
          ready: true,
        });
      });
    });
  }

  /* ── Render pill grid into a container element ── */
  function renderPills(container, selectedIds = [], onChange) {
    container.innerHTML = '';
    ALL.forEach(cat => {
      const pill = document.createElement('button');
      pill.className = 'cat-pill' + (selectedIds.includes(cat.id) ? ' cat-pill--selected' : '');
      pill.dataset.id = cat.id;
      pill.setAttribute('aria-pressed', selectedIds.includes(cat.id));
      pill.innerHTML = `<span class="cat-pill__icon">${cat.icon}</span><span class="cat-pill__label">${cat.label}</span>`;
      pill.addEventListener('click', () => {
        const active = pill.classList.toggle('cat-pill--selected');
        pill.setAttribute('aria-pressed', active);
        const nowSelected = [...container.querySelectorAll('.cat-pill--selected')]
          .map(p => p.dataset.id);
        if (onChange) onChange(nowSelected);
      });
      container.appendChild(pill);
    });
  }

  return {
    ALL,
    fetchFromSelected,
    fetchFromCategory,
    warmPools,
    renderPills,
  };

})();
