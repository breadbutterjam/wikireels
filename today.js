/* today.js — News feed + date-based feed (On This Day, Featured, Picture) */

const Today = (() => {

  const FEATURED_API = (y, m, d) =>
    `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`;

  /* ── State ── */
  let newsItems   = [];
  let currentIdx  = 0;
  let isAnimating = false;
  let isLoaded    = false;
  let readerOpen  = false;

  /* ── DOM refs ── */
  let stack, loadingEl, endEl;

  const pad = n => String(n).padStart(2, '0');

  /* ── Truncate extract to summary length ── */
  function summarise(text, maxChars = 320) {
    if (!text || text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    return cut.slice(0, lastSpace) + '…';
  }

  /* ── Fetch & process ── */
  async function load() {
    if (isLoaded) return;

    const now = new Date();
    loadingEl.hidden = false;
    endEl.hidden = true;
    endEl.style.display = 'none';
    
    stack.innerHTML = '';

    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());

    let data;
    try {
      const res = await fetch(FEATURED_API(y, m, d));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      loadingEl.hidden = true;
      showEnd('Could not load news.', 'Check your connection and try again.');
      return;
    }

    /* Wikipedia news items — each has story (HTML) + links[] */
    const raw = (data.news || []);

    newsItems = [];
    for (const item of raw) {
      /* Strip HTML from story to get plain text */
      const tmp = document.createElement('div');
      tmp.innerHTML = item.story || '';
      const story = tmp.textContent.trim();
      if (!story) continue;

      /* Use first link as primary article, fall back gracefully */
      const link = (item.links || [])[0] || {};
      const title = link.title || 'In the News';

      newsItems.push({
        title,
        summary:   summarise(story, 300),
        extract:   link.extract || story,
        thumbnail: link.thumbnail?.source || null,
        url:       link.content_urls?.desktop?.page
                   || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      });
    }

    isLoaded = true;
    loadingEl.hidden = true;

    if (newsItems.length === 0) {
      showEnd('No news today.', 'Check back later.');
      return;
    }

    currentIdx = 0;
    renderCard(0, false);
    renderCard(1, true);
    
  }

  /* ── Render one card ── */
  function renderCard(idx, isNext) {
    if (idx < 0 || idx >= newsItems.length) return;
    if (stack.querySelector(`[data-idx="${idx}"]`)) return;

    const item = newsItems[idx];
    const card = document.createElement('article');
    card.className = `today-card ${isNext ? 'today-card--next' : 'today-card--current'}`;
    card.dataset.idx = idx;

    /* ── Summary layer ── */
    const summary = document.createElement('div');
    summary.className = 'today-card__summary';
    summary.innerHTML = `
      <div class="card__meta">
        <span class="card__category">In the news</span>
      </div>
      <h1 class="card__title">${escHtml(item.title)}</h1>
      <div class="card__body"><p>${escHtml(item.summary)}</p></div>
      <div class="card__fade"></div>
      <button class="card__readmore">read more</button>
    `;
    /* Thumbnail below title if available */
    if (item.thumbnail) {
      const thumb = document.createElement('div');
      thumb.className = 'today-card__thumb';
      thumb.innerHTML = `<img src="${item.thumbnail}" alt="" loading="lazy"/>`;
      summary.insertBefore(thumb, summary.querySelector('.card__body'));
    }

    /* ── Reader layer ── */
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

    /* Wire read more */
    summary.querySelector('.card__readmore').addEventListener('click', () => enterCardReader(card, item));
    reader.querySelector('.today-card__back-btn').addEventListener('click', () => exitCardReader(card));
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
  const DUR = 360;

  function goNext() {
    /* Cycle back from end card — always allowed regardless of animation state */
    if (!endEl.hidden) {
      endEl.hidden = true;
      endEl.style.display = 'none';
      stack.innerHTML = '';
      currentIdx = 0;
      renderCard(0, false);
      renderCard(1, true);
      return;
    }

    if (isAnimating || readerOpen) return;

    if (currentIdx >= newsItems.length - 1) {
      /* Animate last card out then show end */
      const cur = stack.querySelector(`[data-idx="${currentIdx}"]`);
      if (cur) {
        isAnimating = true;
        cur.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
        cur.style.transform  = 'translateY(-100%)';
        setTimeout(() => { isAnimating = false; showEnd(); }, DUR + 20);
      } else { showEnd(); }
      return;
    }

    const from = currentIdx;
    currentIdx++;
    const to = currentIdx;

    renderCard(to, true);
    renderCard(to + 1, true);

    const curCard  = stack.querySelector(`[data-idx="${from}"]`);
    const nextCard = stack.querySelector(`[data-idx="${to}"]`);
    if (!curCard || !nextCard) return;

    isAnimating = true;
    nextCard.style.transform = 'translateY(100%)';
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
    if (isAnimating || readerOpen || currentIdx === 0) return;

    const from = currentIdx;
    currentIdx--;
    const to = currentIdx;

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

  function showEnd(headline, sub) {
    // console.log('showEnd', headline, sub);
    loadingEl.hidden = true;
    endEl.hidden = false;
    endEl.style.display = '';
    if (headline) endEl.querySelector('.today-end__headline').textContent = headline;
    if (sub) endEl.querySelector('.today-end__sub').textContent = sub;
  }

  /* ── Gesture handlers called from app.js ── */
  function handleSwipeUp()   { goNext(); }
  function handleSwipeDown() { goPrev(); }
  function isReaderOpen()    { return readerOpen; }

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
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Show / hide ── */
  function show() {
    document.getElementById('today-feed').classList.replace('today-feed--hidden','today-feed--visible');
    if (!isLoaded) load();
  }

  function hide() {
    document.getElementById('today-feed').classList.replace('today-feed--visible','today-feed--hidden');
  }

  function init() {
    stack     = document.getElementById('today-stack');
    loadingEl = document.getElementById('today-loading');
    endEl     = document.getElementById('today-end');

    /* Wire touch on the whole today-feed container so swipes work
       on the end card and loading state too, not just card stack */
    const feed = document.getElementById('today-feed');
    if (feed) {
      let sx = 0, sy = 0;
      feed.addEventListener('touchstart', e => {
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
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

  return { init, show, hide, handleSwipeUp, handleSwipeDown, isReaderOpen };

})();
