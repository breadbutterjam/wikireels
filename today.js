/* today.js — News feed: Wikipedia "In the News" + RSS sources */

const Today = (() => {

  const FEATURED_API = (y, m, d) =>
    `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`;

  const RSS_WORKER_URL = "https://damp-cherry-8c0b.jamtests101.workers.dev/";

  const MAX_DAYS_BACK = 30;
  const DUR = 360;

  /* ── State ── */
  let newsItems    = [];
  let currentIdx   = 0;
  let isAnimating  = false;
  let isLoaded     = false;
  let readerOpen   = false;
  let activeDate   = null;
  let activeSource = 'wikinews'; /* 'wikinews' or an RSS feed URL */

  /* ── DOM refs ── */
  let stack, loadingEl, endEl, datePrevBtn, dateNextBtn, dateLabelEl, sourceSelect, sourceBar, datePickerWrap;

  const pad = n => String(n).padStart(2, '0');

  function isToday(date) {
    return date.toDateString() === new Date().toDateString();
  }

  function formatDateLabel(date) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function summarise(text, max = 300) {
    if (!text || text.length <= max) return text;
    const cut = text.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }

  /* ── Show / hide helpers (explicit display toggle — hidden attr alone
        is unreliable with absolutely-positioned siblings) ── */
  function showEnd(headline, sub) {
    loadingEl.hidden = true;
    loadingEl.style.display = 'none';
    endEl.hidden = false;
    endEl.style.display = '';
    updateDatePicker();
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

  /* ── Date picker UI (only relevant for Wikipedia source) ── */
  function updateDatePicker() {
    if (!datePickerWrap) return;

    /* Date picker only makes sense for Wikipedia News */
    const showPicker = activeSource === 'wikinews';
    datePickerWrap.style.display = showPicker ? '' : 'none';
    if (!showPicker || !activeDate) return;

    if (dateLabelEl) dateLabelEl.textContent = formatDateLabel(activeDate);

    const today   = new Date();
    const minDate = addDays(today, -MAX_DAYS_BACK);

    if (dateNextBtn) {
      dateNextBtn.disabled      = isToday(activeDate);
      dateNextBtn.style.opacity = isToday(activeDate) ? '0.25' : '';
    }
    if (datePrevBtn) {
      datePrevBtn.disabled      = activeDate <= minDate;
      datePrevBtn.style.opacity = activeDate <= minDate ? '0.25' : '';
    }

    const dateInput = document.getElementById('today-date-input');
    if (dateInput) {
      dateInput.max   = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
      dateInput.min   = `${minDate.getFullYear()}-${pad(minDate.getMonth()+1)}-${pad(minDate.getDate())}`;
      dateInput.value = `${activeDate.getFullYear()}-${pad(activeDate.getMonth()+1)}-${pad(activeDate.getDate())}`;
    }
  }

  /* ══════════════════════════════════════════════════════
     SOURCE: WIKIPEDIA "IN THE NEWS"
  ══════════════════════════════════════════════════════ */

  async function loadWikiNews(date) {
    activeDate = date;
    const y = date.getFullYear(), m = pad(date.getMonth() + 1), d = pad(date.getDate());

    let data;
    try {
      const res = await fetch(FEATURED_API(y, m, d));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch {
      throw new Error('network');
    }

    const items = [];
    for (const item of (data.news || [])) {
      const tmp = document.createElement('div');
      tmp.innerHTML = item.story || '';
      const story = tmp.textContent.trim();
      if (!story) continue;

      const link  = (item.links || [])[0] || {};
      const title = link.title || 'In the News';

      items.push({
        title,
        summary:   summarise(story, 300),
        extract:   link.extract || story,
        thumbnail: link.thumbnail?.source || null,
        url:       link.content_urls?.desktop?.page
                   || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        isRSS: false,
      });
    }
    return items;
  }

  /* ══════════════════════════════════════════════════════
     SOURCE: RSS FEEDS
  ══════════════════════════════════════════════════════ */

  async function loadRSSFeed(feedUrl) {
    let xmlText;
    try {
      const res = await fetch(`${RSS_WORKER_URL}?feed=${encodeURIComponent(feedUrl)}`);
      xmlText = await res.text();
    } catch {
      throw new Error('network');
    }

    const parsed = parseRSS(xmlText);
    return parsed.map(item => ({
      title:       item.title,
      summary:     summarise(item.description, 300),
      extract:     item.description, /* full description, shown in read-more */
      thumbnail:   item.image,       /* deferred — only shown in read-more */
      url:         item.link,
      isRSS:       true,
      pubDateText: timeAgo(item.pubDate),
    }));
  }

  function parseRSS(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");

    return [...xmlDoc.querySelectorAll("item")].map(item => {
      const enclosure       = item.querySelector("enclosure[type^='image']");
      const mediaThumbnail  = item.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "thumbnail")[0];
      const mediaContent    = item.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "content")[0];

      const image =
        enclosure?.getAttribute("url") ||
        mediaThumbnail?.getAttribute("url") ||
        mediaContent?.getAttribute("url") ||
        extractImgFromHtml(item.querySelector("description")?.textContent) ||
        null;

      const rawDesc = item.querySelector("description")?.textContent || "";
      const description = stripHtml(rawDesc).trim().replace(/\s+/g, " ");

      return {
        title:   item.querySelector("title")?.textContent || "",
        link:    item.querySelector("link")?.textContent || "",
        pubDate: item.querySelector("pubDate")?.textContent || "",
        description,
        image,
      };
    });
  }

  function stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  function extractImgFromHtml(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }

  function timeAgo(dateString) {
    const date = new Date(dateString);
    if (isNaN(date)) return "";
    const seconds = Math.floor((Date.now() - date) / 1000);
    const intervals = [
      [31536000, "year"], [2592000, "month"], [86400, "day"],
      [3600, "hour"], [60, "minute"],
    ];
    for (const [secs, label] of intervals) {
      const n = Math.floor(seconds / secs);
      if (n >= 1) return `${n} ${label}${n > 1 ? "s" : ""} ago`;
    }
    return "just now";
  }

  /* ══════════════════════════════════════════════════════
     UNIFIED LOAD — dispatches to the right source
  ══════════════════════════════════════════════════════ */

  async function loadSource(source, date) {
    activeSource = source;
    isLoaded     = false;
    newsItems    = [];
    currentIdx   = 0;
    isAnimating  = false;

    stack.innerHTML = '';
    hideEnd();
    loadingEl.hidden = false;
    loadingEl.style.display = '';

    try {
      if (source === 'wikinews') {
        newsItems = await loadWikiNews(date || new Date());
      } else {
        newsItems = await loadRSSFeed(source);
      }
    } catch {
      loadingEl.hidden = true;
      loadingEl.style.display = 'none';
      showEnd('Could not load this source.', 'Check your connection and try again.');
      return;
    }

    isLoaded = true;
    loadingEl.hidden = true;
    loadingEl.style.display = 'none';
    updateDatePicker();

    if (newsItems.length === 0) {
      showEnd('No stories right now.', 'Try a different source.');
      return;
    }

    renderCard(0, false);
    renderCard(1, true);
  }

  /* For Wikipedia date navigation specifically */
  async function loadDate(date) {
    await loadSource('wikinews', date);
  }

  async function load() {
    if (isLoaded) return;
    await loadSource(activeSource, new Date());
  }

  /* ── Render one card ── */
  function renderCard(idx, isNext) {
    if (idx < 0 || idx >= newsItems.length) return;
    if (stack.querySelector(`[data-idx="${idx}"]`)) return;

    const item = newsItems[idx];
    const card = document.createElement('article');
    card.className = `today-card ${isNext ? 'today-card--next' : 'today-card--current'}`;
    card.dataset.idx = idx;

    const summary = document.createElement('div');
    summary.className = 'today-card__summary';
    summary.innerHTML = `
      <div class="card__meta">
        <span class="card__category">${item.isRSS ? 'News' : 'In the news'}</span>
        ${item.pubDateText ? `<span class="today-card__pubdate">${escHtml(item.pubDateText)}</span>` : ''}
      </div>
      <h1 class="card__title">${escHtml(item.title)}</h1>
      <div class="card__body"><p>${escHtml(item.summary)}</p></div>
      <div class="card__fade"></div>
      <button class="card__readmore">read more</button>
    `;

    /* Wikipedia items show thumbnail on card face (existing behaviour).
       RSS items defer images to read-more per requirement. */
    if (item.thumbnail && !item.isRSS) {
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

  /* ── Reader: branches by source type ── */
  async function enterCardReader(card, item) {
    readerOpen = true;
    card.classList.add('today-card--reader');
    const body = card.querySelector('.today-card__reader-body');
    card.querySelector('.today-card__reader').scrollTop = 0;

    if (item.isRSS) {
      /* RSS: no full-article endpoint available. Show full description,
         the (now-revealed) image, and a link to the original source. */
      body.innerHTML = `
        ${item.thumbnail ? `<div class="today-card__reader-image"><img src="${item.thumbnail}" alt="" loading="lazy"/></div>` : ''}
        <p class="today-card__reader-extract">${escHtml(item.extract)}</p>
        <a class="today-card__reader-original" href="${item.url}" target="_blank" rel="noopener">read original →</a>
      `;
      return;
    }

    /* Wikipedia: fetch full article HTML */
    body.innerHTML = '<p class="reader-loading">Loading…</p>';
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

  /* ── Navigation (unchanged) ── */
  function goNext() {
    if (isEndVisible()) {
      loadSource(activeSource, activeDate || new Date());
      return;
    }

    if (isAnimating || readerOpen) return;

    if (currentIdx >= newsItems.length - 1) {
      const cur = stack.querySelector(`[data-idx="${currentIdx}"]`);
      if (cur) {
        isAnimating = true;
        cur.style.transition = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
        cur.style.transform  = 'translateY(-100%)';
        setTimeout(() => { isAnimating = false; showEnd(); }, DUR + 20);
      } else showEnd();
      return;
    }

    const from = currentIdx;
    currentIdx++;
    renderCard(currentIdx, true);
    renderCard(currentIdx + 1, true);

    const curCard  = stack.querySelector(`[data-idx="${from}"]`);
    const nextCard = stack.querySelector(`[data-idx="${currentIdx}"]`);
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
    if (isAnimating || readerOpen) return;

    if (currentIdx === 0) {
      stack.innerHTML = '';
      currentIdx = newsItems.length - 1;
      renderCard(currentIdx, false);
      return;
    }

    const from = currentIdx;
    currentIdx--;

    const curCard  = stack.querySelector(`[data-idx="${from}"]`);
    const prevCard = stack.querySelector(`[data-idx="${currentIdx}"]`);
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
  function isReaderOpenFn()  { return readerOpen; }

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
    document.getElementById('today-feed')
      .classList.replace('today-feed--hidden', 'today-feed--visible');
    if (!isLoaded) load();
  }

  function hide() {
    document.getElementById('today-feed')
      .classList.replace('today-feed--visible', 'today-feed--hidden');
  }

  /* ── Init ── */
  function init() {
    stack        = document.getElementById('today-stack');
    loadingEl    = document.getElementById('today-loading');
    endEl        = document.getElementById('today-end');
    datePrevBtn  = document.getElementById('today-date-prev');
    dateNextBtn  = document.getElementById('today-date-next');
    dateLabelEl  = document.getElementById('today-date-label-btn');
    sourceSelect = document.getElementById('today-source-select');
    sourceBar    = document.getElementById('today-source-bar');
    datePickerWrap = document.getElementById('today-datepicker');

    hideEnd();

    /* Source dropdown change */
    sourceSelect?.addEventListener('change', () => {
      const val = sourceSelect.value || 'wikinews';
      loadSource(val, new Date());
    });

    /* Date prev/next — only meaningful for wikinews */
    datePrevBtn?.addEventListener('click', () => {
      if (!activeDate || datePrevBtn.disabled || activeSource !== 'wikinews') return;
      loadDate(addDays(activeDate, -1));
    });

    dateNextBtn?.addEventListener('click', () => {
      if (!activeDate || dateNextBtn.disabled || activeSource !== 'wikinews') return;
      loadDate(addDays(activeDate, 1));
    });

    dateLabelEl?.addEventListener('click', () => {
      if (activeSource !== 'wikinews') return;
      const dateInput = document.getElementById('today-date-input');
      dateInput?.showPicker?.();
      dateInput?.click();
    });

    document.getElementById('today-date-input')?.addEventListener('change', (e) => {
      const [y, m, d] = e.target.value.split('-').map(Number);
      if (y && m && d) loadDate(new Date(y, m - 1, d));
    });

    /* Touch swipes on entire today-feed */
    const feed = document.getElementById('today-feed');
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

  return {
    init, show, hide,
    handleSwipeUp, handleSwipeDown,
    isReaderOpen: isReaderOpenFn,
  };

})();
