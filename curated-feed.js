/* curated-feed.js — Curated content feed controller
   Sections: Poems / Biographies / Speeches / Major Events
   Each section is a swipeable card stack, same pattern as
   On This Day, fed by CuratedContent (curated.js).            */

const CuratedFeed = (() => {

  const SUMMARY_TITLE = t => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;

  const DUR = 360;

  const SECTION_LABELS = {
    poems:       'Poem',
    biographies: 'Biography',
    speeches:    'Speech',
    majorEvents: 'Major Event',
  };

  const SECTION_ORDER = ['poems', 'biographies', 'speeches', 'majorEvents'];

  /* ── State (per section, cached once fetched) ── */
  let activeSection = 'poems';
  let cache = {}; /* sectionKey -> array of resolved items */
  let idx   = {}; /* sectionKey -> current index */
  let isAnimating = false;
  let readerOpen  = false;

  /* ── DOM refs ── */
  let stack, loadingEl, endEl;

  /* ── Extract Wikipedia page title from a full URL ── */
  function titleFromWikiLink(url) {
    try {
      const path = new URL(url).pathname; /* /wiki/Some_Title */
      const raw  = path.replace(/^\/wiki\//, '');
      return decodeURIComponent(raw).replace(/_/g, ' ');
    } catch {
      return null;
    }
  }

  function summarise(text, max = 300) {
    if (!text || text.length <= max) return text;
    const cut = text.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }

  function showEnd(headline, sub) {
    loadingEl.hidden = true;
    loadingEl.style.display = 'none';
    endEl.hidden = false;
    endEl.style.display = '';
    if (headline) endEl.querySelector('.today-end__headline').textContent = headline;
    if (sub)      endEl.querySelector('.today-end__sub').textContent      = sub;
  }

  function hideEnd() {
    endEl.hidden = true;
    endEl.style.display = 'none';
  }

  function isEndVisible() {
    return endEl.style.display !== 'none';
  }

  /* ── Fetch + resolve a section's items (cached after first load) ── */
  async function resolveSection(sectionKey) {
    if (cache[sectionKey]) return cache[sectionKey];

    const entries = CuratedContent[sectionKey] || [];
    const resolved = [];

    /* Fetch summaries in parallel — small lists, fine to fire all at once */
    const results = await Promise.allSettled(
      entries.map(async entry => {
        const title = titleFromWikiLink(entry.wikiLink);
        if (!title) return null;
        const res = await fetch(SUMMARY_TITLE(title));
        if (!res.ok) throw new Error(`Summary fetch failed for ${title}`);
        const data = await res.json();
        return {
          title:     data.title || title,
          summary:   summarise(data.extract || '', 300),
          extract:   data.extract || '',
          thumbnail: data.thumbnail?.source || null,
          url:       data.content_urls?.desktop?.page || entry.wikiLink,
        };
      })
    );

    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) resolved.push(r.value);
    });

    cache[sectionKey] = resolved;
    return resolved;
  }

  /* ── Load a section into the stack ── */
  async function loadSection(sectionKey) {
    activeSection = sectionKey;
    idx[sectionKey] = idx[sectionKey] ?? 0;
    isAnimating = false;
    readerOpen  = false;

    /* Update pill active state */
    document.querySelectorAll('.curated-pill').forEach(p => {
      p.classList.toggle('curated-pill--active', p.dataset.section === sectionKey);
    });

    stack.innerHTML = '';
    hideEnd();
    loadingEl.hidden = false;
    loadingEl.style.display = '';

    let items;
    try {
      items = await resolveSection(sectionKey);
    } catch {
      loadingEl.hidden = true;
      loadingEl.style.display = 'none';
      showEnd('Could not load this section.', 'Check your connection and try again.');
      return;
    }

    loadingEl.hidden = true;
    loadingEl.style.display = 'none';

    if (items.length === 0) {
      showEnd('Nothing here yet.', 'More coming soon.');
      return;
    }

    if (idx[sectionKey] >= items.length) idx[sectionKey] = 0;

    renderCard(sectionKey, idx[sectionKey], false);
    renderCard(sectionKey, idx[sectionKey] + 1, true);
  }

  /* ── Render one card ── */
  function renderCard(sectionKey, i, isNext) {
    const items = cache[sectionKey];
    if (!items || i < 0 || i >= items.length) return;
    if (stack.querySelector(`[data-idx="${i}"]`)) return;

    const item = items[i];
    const card = document.createElement('article');
    card.className = `today-card ${isNext ? 'today-card--next' : 'today-card--current'}`;
    card.dataset.idx = i;

    const summary = document.createElement('div');
    summary.className = 'today-card__summary';
    summary.innerHTML = `
      <div class="card__meta">
        <span class="card__category">${escHtml(SECTION_LABELS[sectionKey] || 'Curated')}</span>
      </div>
      <h1 class="card__title">${escHtml(item.title)}</h1>
      <div class="card__body"><p>${escHtml(item.summary)}</p></div>
      <div class="card__fade"></div>
      <button class="card__readmore">read more</button>
    `;

    if (item.thumbnail) {
      const thumb = document.createElement('div');
      thumb.className = 'today-card__thumb';
      thumb.innerHTML = `<img src="${item.thumbnail}" alt="" loading="lazy"/>`;
      summary.insertBefore(thumb, summary.querySelector('.card__body'));
    }

    const reader = document.createElement('div');
    reader.className = 'today-card__reader';
    reader.innerHTML = `
      <div class="today-card__reader-header">
        <button class="card__back today-card__back-btn">←</button>
        <span class="today-card__reader-title-sm">${escHtml(item.title)}</span>
      </div>
      <h1 class="today-card__reader-h1">${escHtml(item.title)}</h1>
      <div class="today-card__reader-body"></div>
    `;

    card.appendChild(summary);
    card.appendChild(reader);
    stack.appendChild(card);

    summary.querySelector('.card__readmore')
      .addEventListener('click', () => enterCardReader(card, item));
    reader.querySelector('.today-card__back-btn')
      .addEventListener('click', () => exitCardReader(card));
  }

  async function enterCardReader(card, item) {
    readerOpen = true;
    card.classList.add('today-card--reader');
    const body = card.querySelector('.today-card__reader-body');
    body.innerHTML = '<p class="reader-loading">Loading…</p>';
    card.querySelector('.today-card__reader').scrollTop = 0;

    try {
      const html = await API.fetchFullHTML(item.title);
      body.innerHTML = cleanHTML(html);
    } catch {
      body.innerHTML = `<p>Could not load article. <a href="${item.url}" target="_blank" rel="noopener">Open on Wikipedia →</a></p>`;
    }
  }

  function exitCardReader(card) {
    card.classList.remove('today-card--reader');
    readerOpen = false;
  }

  /* ── Navigation ── */
  function goNext() {
    const sectionKey = activeSection;
    const items = cache[sectionKey] || [];

    if (isEndVisible()) {
      idx[sectionKey] = 0;
      loadSection(sectionKey);
      return;
    }

    if (isAnimating || readerOpen) return;

    if (idx[sectionKey] >= items.length - 1) {
      const cur = stack.querySelector(`[data-idx="${idx[sectionKey]}"]`);
      if (cur) {
        isAnimating = true;
        cur.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
        cur.style.transform  = 'translateY(-100%)';
        setTimeout(() => { isAnimating = false; showEnd("that's everything for now.", 'try another category, or come back for more.'); }, DUR + 20);
      } else showEnd();
      return;
    }

    const from = idx[sectionKey];
    idx[sectionKey]++;
    const to = idx[sectionKey];

    renderCard(sectionKey, to, true);
    renderCard(sectionKey, to + 1, true);

    const curCard  = stack.querySelector(`[data-idx="${from}"]`);
    const nextCard = stack.querySelector(`[data-idx="${to}"]`);
    if (!curCard || !nextCard) return;

    isAnimating = true;
    nextCard.style.transition = 'none';
    nextCard.style.transform  = 'translateY(100%)';
    nextCard.classList.remove('today-card--next');
    nextCard.classList.add('today-card--current');

    requestAnimationFrame(() => {
      curCard.style.transition  = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
      nextCard.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
      curCard.style.transform   = 'translateY(-100%)';
      nextCard.style.transform  = 'translateY(0)';
      setTimeout(() => { isAnimating = false; }, DUR + 20);
    });
  }

  function goPrev() {
    const sectionKey = activeSection;
    const items = cache[sectionKey] || [];
    if (isAnimating || readerOpen) return;

    if (idx[sectionKey] === 0) {
      stack.innerHTML = '';
      idx[sectionKey] = items.length - 1;
      renderCard(sectionKey, idx[sectionKey], false);
      return;
    }

    const from = idx[sectionKey];
    idx[sectionKey]--;
    const to = idx[sectionKey];

    const curCard  = stack.querySelector(`[data-idx="${from}"]`);
    const prevCard = stack.querySelector(`[data-idx="${to}"]`);
    if (!curCard || !prevCard) return;

    isAnimating = true;
    prevCard.style.transition = 'none';
    prevCard.style.transform  = 'translateY(-100%)';
    prevCard.classList.remove('today-card--next');
    prevCard.classList.add('today-card--current');

    requestAnimationFrame(() => {
      curCard.style.transition  = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
      prevCard.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
      curCard.style.transform   = 'translateY(100%)';
      prevCard.style.transform  = 'translateY(0)';
      setTimeout(() => { isAnimating = false; }, DUR + 20);
    });
  }

  function handleSwipeUp()   { goNext(); }
  function handleSwipeDown() { goPrev(); }

  /* ── Utilities ── */
  function cleanHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll(
      '.infobox,table,sup,.mw-editsection,.reference,.navbox,' +
      '.thumb,.metadata,.hatnote,.toc,.sistersitebox,.reflist,' +
      '.mw-references-wrap,.mw-empty-elt,.noprint,style,script'
    ).forEach(el => el.remove());
    div.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('//')) img.src = 'https:' + src;
    });
    return div.innerHTML;
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Show / hide feed ── */
  function show() {
    document.getElementById('curated-feed')
      ?.classList.replace('today-feed--hidden', 'today-feed--visible');
    if (!cache[activeSection]) loadSection(activeSection);
  }

  function hide() {
    document.getElementById('curated-feed')
      ?.classList.replace('today-feed--visible', 'today-feed--hidden');
  }

  /* ── Init ── */
  function init() {
    stack     = document.getElementById('curated-stack');
    loadingEl = document.getElementById('curated-loading');
    endEl     = document.getElementById('curated-end');

    document.querySelectorAll('.curated-pill').forEach(pill => {
      pill.addEventListener('click', () => loadSection(pill.dataset.section));
    });

    const feed = document.getElementById('curated-feed');
    if (feed) {
      let sx = 0, sy = 0;
      feed.addEventListener('touchstart', e => {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      }, { passive: true });
      feed.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) {
          dy < 0 ? goNext() : goPrev();
        }
      }, { passive: true });
    }
  }

  return { init, show, hide, handleSwipeUp, handleSwipeDown };

})();
