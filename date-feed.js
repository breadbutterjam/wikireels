/* date-feed.js — On This Day / Featured Article / Picture of the Day */

const DateFeed = (() => {

  const FEATURED_API = (y, m, d) =>
    `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`;

  const MAX_DAYS_BACK = 30;
  const DUR = 360;

  /* ── Shared date state (carried across pill switches) ── */
  let activeDate    = null;
  let activeSection = 'onthisday';
  let cache         = {}; /* keyed by 'YYYY-MM-DD' */

  /* ── Per-section state ── */
  let otdItems = [], otdIdx = 0, otdAnimating = false, otdReaderOpen = false;

  /* ── DOM refs ── */
  let datePrevBtn, dateNextBtn, dateLabelBtn, dateInput;

  const pad = n => String(n).padStart(2, '0');

  function dateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function isToday(d) {
    return d.toDateString() === new Date().toDateString();
  }

  function addDays(d, n) {
    const r = new Date(d); r.setDate(r.getDate() + n); return r;
  }

  function formatLabel(d) {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  function summarise(text, max = 300) {
    if (!text || text.length <= max) return text;
    const cut = text.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }

  /* ── Show / hide loading & end helpers ── */
  function showLoader(id)  { const el = document.getElementById(id); if(el){el.hidden=false; el.style.display='';} }
  function hideLoader(id)  { const el = document.getElementById(id); if(el){el.hidden=true;  el.style.display='none';} }
  function showEndEl(id)   { const el = document.getElementById(id); if(el){el.hidden=false; el.style.display='';} }
  function hideEndEl(id)   { const el = document.getElementById(id); if(el){el.hidden=true;  el.style.display='none';} }

  /* ── Update date picker UI ── */
  function updateDatePicker() {
    if (!activeDate) return;
    if (dateLabelBtn) dateLabelBtn.textContent = formatLabel(activeDate);

    const today  = new Date();
    const minD   = addDays(today, -MAX_DAYS_BACK);

    if (dateNextBtn) {
      dateNextBtn.disabled     = isToday(activeDate);
      dateNextBtn.style.opacity = isToday(activeDate) ? '0.25' : '';
    }
    if (datePrevBtn) {
      datePrevBtn.disabled      = activeDate <= minD;
      datePrevBtn.style.opacity  = activeDate <= minD ? '0.25' : '';
    }

    /* Sync native input max/min/value */
    if (dateInput) {
      dateInput.max   = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
      dateInput.min   = `${minD.getFullYear()}-${pad(minD.getMonth()+1)}-${pad(minD.getDate())}`;
      dateInput.value = dateKey(activeDate);
    }
  }

  /* ── Fetch data for a date (cached) ── */
  async function fetchDate(date) {
    const key = dateKey(date);
    if (cache[key]) return cache[key];

    const y = date.getFullYear(), m = pad(date.getMonth()+1), d = pad(date.getDate());
    const res  = await fetch(FEATURED_API(y, m, d));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cache[key] = data;
    return data;
  }

  /* ── Load a date (resets all sections) ── */
  async function loadDate(date) {
    activeDate = date;
    otdItems   = [];
    otdIdx     = 0;
    otdAnimating  = false;
    otdReaderOpen = false;

    updateDatePicker();

    /* Clear all sections */
    clearSection('otd-stack', 'otd-end', 'otd-loading');
    clearSingleCard('featured-card', 'featured-loading');
    clearSingleCard('picture-card',  'picture-loading');

    /* Show active section */
    await loadSection(activeSection);
  }

  function clearSection(stackId, endId, loaderId) {
    const s = document.getElementById(stackId); if (s) s.innerHTML = '';
    hideEndEl(endId);
    hideLoader(loaderId);
  }

  function clearSingleCard(cardId, loaderId) {
    const c = document.getElementById(cardId); if (c) c.innerHTML = '';
    hideLoader(loaderId);
  }

  async function loadSection(section) {
    activeSection = section;

    /* Update pill active state */
    document.querySelectorAll('.date-pill').forEach(p => {
      p.classList.toggle('date-pill--active', p.dataset.section === section);
    });

    /* Show/hide section containers */
    ['onthisday','featured','picture'].forEach(s => {
      const el = document.getElementById(`section-${s}`);
      if (el) el.classList.toggle('date-section--hidden', s !== section);
    });

    if (!activeDate) return;

    let data;
    try {
      data = await fetchDate(activeDate);
    } catch {
      if (section === 'onthisday') showEndEl('otd-end');
      return;
    }

    if (section === 'onthisday') renderOTD(data);
    if (section === 'featured')  renderFeatured(data);
    if (section === 'picture')   renderPicture(data);
  }

  /* ── ON THIS DAY ── */
  function renderOTD(data) {
    const raw = (data.onthisday || []).sort((a, b) => b.year - a.year);
    otdItems  = raw.map(item => {
      const link = (item.pages || [])[0] || {};
      return {
        year:      item.year,
        text:      item.text || '',
        title:     link.title || '',
        extract:   link.extract || item.text || '',
        thumbnail: link.thumbnail?.source || null,
        url:       link.content_urls?.desktop?.page || '',
      };
    }).filter(i => i.text);

    otdIdx = 0;
    const stack = document.getElementById('otd-stack');
    if (stack) stack.innerHTML = '';
    hideEndEl('otd-end');
    hideLoader('otd-loading');

    if (otdItems.length === 0) { showEndEl('otd-end'); return; }
    renderOTDCard(0, false);
    renderOTDCard(1, true);
  }

  function renderOTDCard(idx, isNext) {
    if (idx < 0 || idx >= otdItems.length) return;
    const stack = document.getElementById('otd-stack');
    if (!stack || stack.querySelector(`[data-idx="${idx}"]`)) return;

    const item = otdItems[idx];
    const card = document.createElement('article');
    card.className = `today-card ${isNext ? 'today-card--next' : 'today-card--current'}`;
    card.dataset.idx = idx;

    const summary = document.createElement('div');
    summary.className = 'today-card__summary';
    summary.innerHTML = `
      <div class="card__meta">
        <span class="card__category">${item.year}</span>
      </div>
      <h1 class="card__title">${escHtml(item.title || 'On This Day')}</h1>
      <div class="card__body"><p>${escHtml(summarise(item.text, 300))}</p></div>
      <div class="card__fade"></div>
      ${item.title ? '<button class="card__readmore">read more</button>' : ''}
    `;

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
      ?.addEventListener('click', () => enterOTDReader(card, item));
    reader.querySelector('.today-card__back-btn')
      ?.addEventListener('click', () => exitOTDReader(card));
  }

  async function enterOTDReader(card, item) {
    otdReaderOpen = true;
    card.classList.add('today-card--reader');
    const body = card.querySelector('.today-card__reader-body');
    body.innerHTML = '<p class="reader-loading">Loading…</p>';
    card.querySelector('.today-card__reader').scrollTop = 0;
    try {
      const html = await API.fetchFullHTML(item.title);
      body.innerHTML = cleanHTML(html);
    } catch {
      body.innerHTML = `<p>Could not load. <a href="${item.url}" target="_blank" rel="noopener">Open on Wikipedia →</a></p>`;
    }
  }

  function exitOTDReader(card) {
    card.classList.remove('today-card--reader');
    otdReaderOpen = false;
  }

  function isEndVisible() {
    const el = document.getElementById('otd-end');
    return el && el.style.display !== 'none';
  }

  function otdGoNext() {
    /* If end card showing — cycle back to first item */
    if (isEndVisible()) {
      hideEndEl('otd-end');
      const stack = document.getElementById('otd-stack');
      if (stack) stack.innerHTML = '';
      otdIdx = 0;
      renderOTDCard(0, false);
      renderOTDCard(1, true);
      return;
    }

    if (otdAnimating || otdReaderOpen) return;

    if (otdIdx >= otdItems.length - 1) {
      /* Last card — animate out then show end */
      const cur = document.getElementById('otd-stack')
        ?.querySelector(`[data-idx="${otdIdx}"]`);
      if (cur) {
        otdAnimating = true;
        cur.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
        cur.style.transform  = 'translateY(-100%)';
        setTimeout(() => { otdAnimating = false; showEndEl('otd-end'); }, DUR + 20);
      } else showEndEl('otd-end');
      return;
    }

    const from = otdIdx++;
    renderOTDCard(otdIdx, true);
    renderOTDCard(otdIdx + 1, true);
    animateCards('otd-stack', from, otdIdx, 'up');
  }

  function otdGoPrev() {
    /* If end card showing — go back to last item */
    if (isEndVisible()) {
      hideEndEl('otd-end');
      /* Last card should already be in stack, just show it */
      const stack = document.getElementById('otd-stack');
      const lastCard = stack?.querySelector(`[data-idx="${otdItems.length - 1}"]`);
      if (lastCard) {
        otdIdx = otdItems.length - 1;
        lastCard.style.transition = 'none';
        lastCard.style.transform  = 'translateY(0)';
        lastCard.classList.add('today-card--current');
      } else {
        /* Re-render if not in DOM */
        if (stack) stack.innerHTML = '';
        otdIdx = otdItems.length - 1;
        renderOTDCard(otdIdx, false);
      }
      return;
    }

    if (otdAnimating || otdReaderOpen) return;

    /* At first item — wrap to last */
    if (otdIdx === 0) {
      const stack = document.getElementById('otd-stack');
      if (stack) stack.innerHTML = '';
      otdIdx = otdItems.length - 1;
      renderOTDCard(otdIdx, false);
      if (otdIdx > 0) renderOTDCard(otdIdx - 1, true);
      return;
    }

    const from = otdIdx--;
    animateCards('otd-stack', from, otdIdx, 'down');
  }

  function animateCards(stackId, from, to, dir) {
    const stack = document.getElementById(stackId);
    if (!stack) return;
    const curCard  = stack.querySelector(`[data-idx="${from}"]`);
    const destCard = stack.querySelector(`[data-idx="${to}"]`);
    if (!curCard || !destCard) return;

    otdAnimating = true;
    destCard.style.transition = 'none';
    destCard.style.transform  = dir === 'up' ? 'translateY(100%)' : 'translateY(-100%)';
    destCard.classList.remove('today-card--next');
    destCard.classList.add('today-card--current');

    requestAnimationFrame(() => {
      curCard.style.transition  = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
      destCard.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
      curCard.style.transform   = dir === 'up' ? 'translateY(-100%)' : 'translateY(100%)';
      destCard.style.transform  = 'translateY(0)';
      setTimeout(() => { otdAnimating = false; }, DUR + 20);
    });
  }

  /* ── FEATURED ARTICLE ── */
  function renderFeatured(data) {
    hideLoader('featured-loading');
    const card = document.getElementById('featured-card');
    if (!card) return;
    const tfa = data.tfa;
    if (!tfa) { card.innerHTML = '<p class="date-empty">No featured article today.</p>'; return; }

    card.innerHTML = `
      ${tfa.thumbnail ? `<div class="date-single-card__thumb"><img src="${tfa.thumbnail.source}" alt=""/></div>` : ''}
      <div class="date-single-card__body">
        <div class="card__meta"><span class="card__category">Featured Article</span></div>
        <h1 class="card__title">${escHtml(tfa.title)}</h1>
        <div class="card__body"><p>${escHtml(summarise(tfa.extract, 400))}</p></div>
        <a class="date-single-card__link" href="${tfa.content_urls?.desktop?.page || '#'}" target="_blank" rel="noopener">read full article →</a>
      </div>
    `;
  }

  /* ── PICTURE OF THE DAY ── */
  function renderPicture(data) {
    hideLoader('picture-loading');
    const card = document.getElementById('picture-card');
    if (!card) return;
    const img = data.image;
    if (!img) { card.innerHTML = '<p class="date-empty">No picture today.</p>'; return; }

    const src = img.image?.source || img.thumbnail?.source || '';
    const desc = img.description?.text || img.title || '';

    card.innerHTML = `
      <div class="date-picture-card__img-wrap">
        <img src="${src}" alt="${escHtml(img.title || '')}" loading="lazy"/>
      </div>
      <div class="date-picture-card__caption">
        <p class="date-picture-card__title">${escHtml(img.title || 'Picture of the Day')}</p>
        <p class="date-picture-card__desc">${escHtml(summarise(desc, 200))}</p>
      </div>
    `;
  }

  /* ── Swipe handlers (called from app.js) ── */
  function handleSwipeUp() {
    if (activeSection === 'onthisday') otdGoNext();
  }
  function handleSwipeDown() {
    if (activeSection === 'onthisday') otdGoPrev();
  }

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
      const s = img.getAttribute('src') || '';
      if (s.startsWith('//')) img.src = 'https:' + s;
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
    document.getElementById('date-feed')
      ?.classList.replace('today-feed--hidden', 'today-feed--visible');
    if (!activeDate) loadDate(new Date());
  }

  function hide() {
    document.getElementById('date-feed')
      ?.classList.replace('today-feed--visible', 'today-feed--hidden');
  }

  /* ── Init ── */
  function init() {
    datePrevBtn  = document.getElementById('date-date-prev');
    dateNextBtn  = document.getElementById('date-date-next');
    dateLabelBtn = document.getElementById('date-date-label-btn');
    dateInput    = document.getElementById('date-date-input');

    /* Pill switching */
    document.querySelectorAll('.date-pill').forEach(pill => {
      pill.addEventListener('click', () => loadSection(pill.dataset.section));
    });

    /* Date prev/next */
    datePrevBtn?.addEventListener('click', () => {
      if (datePrevBtn.disabled || !activeDate) return;
      loadDate(addDays(activeDate, -1));
    });

    dateNextBtn?.addEventListener('click', () => {
      if (dateNextBtn.disabled || !activeDate) return;
      loadDate(addDays(activeDate, 1));
    });

    /* Date label → open native calendar */
    dateLabelBtn?.addEventListener('click', () => {
      dateInput?.showPicker?.();
      dateInput?.click();
    });

    /* Native date input change */
    dateInput?.addEventListener('change', () => {
      const [y, m, d] = dateInput.value.split('-').map(Number);
      if (y && m && d) loadDate(new Date(y, m - 1, d));
    });

    /* Touch swipes on date-feed */
    const feed = document.getElementById('date-feed');
    if (feed) {
      let sx = 0, sy = 0;
      feed.addEventListener('touchstart', e => {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      }, { passive: true });
      feed.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) {
          dy < 0 ? handleSwipeUp() : handleSwipeDown();
        }
      }, { passive: true });
    }
  }

  return { init, show, hide, handleSwipeUp, handleSwipeDown };

})();
