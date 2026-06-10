/* api.js — Wikipedia fetch + prefetch queue */

const API = (() => {

  const SUMMARY_RANDOM = 'https://en.wikipedia.org/api/rest_v1/page/random/summary';
  const SUMMARY_TITLE  = t => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
  const HTML_TITLE     = t => `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(t)}`;
  const MEDIA_TITLE    = t => `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(t)}`;

  /* ── Fully random article ── */
  async function fetchRandom() {
    const res = await fetch(SUMMARY_RANDOM);
    if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
    return res.json();
  }

  /* ── One article — category-aware if categories selected ── */
  async function fetchOne() {
    if (typeof Categories !== 'undefined' && Store.hasCategories()) {
      try {
        const article = await Categories.fetchFromSelected();
        if (article) return article;
      } catch {}
    }
    return fetchRandom();
  }

  /* ── Full article HTML for reader ── */
  async function fetchFullHTML(title) {
    const res = await fetch(HTML_TITLE(title));
    if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
    return res.text();
  }

  /* ── Image list for gallery ── */
  async function fetchImages(title) {
    const res = await fetch(MEDIA_TITLE(title));
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).filter(item =>
      item.type === 'image' &&
      item.srcset?.length > 0
    ).map(item => ({
      src:     item.srcset[item.srcset.length - 1]?.src || item.original?.source,
      caption: item.caption?.text || item.title.replace(/^File:/i, '').replace(/\.[^.]+$/, ''),
      width:   item.original?.width,
      height:  item.original?.height,
    }));
  }

  /* ── HTML preload cache ── */
  const htmlCache = new Map();

  async function preloadHTML(title) {
    if (!title || htmlCache.has(title)) return;
    try {
      const html = await fetchFullHTML(title);
      htmlCache.set(title, html);
    } catch {}
  }

  function getCachedHTML(title) {
    return htmlCache.get(title) || null;
  }

  /* ══════════════════════════════════════════════════════
     PREFETCH QUEUE
     queue[0]=prev  queue[1]=current  queue[2]=next
  ══════════════════════════════════════════════════════ */

  const queue   = [];
  const pending = [];

  function prefetchOne() {
    const p = fetchOne().catch(() => fetchOne());
    pending.push(p);
  }

  async function prime() {
    const results = await Promise.allSettled([fetchOne(), fetchOne(), fetchOne()]);
    results.forEach(r => { if (r.status === 'fulfilled') queue.push(r.value); });
    if (queue.length === 0) throw new Error('Could not load any articles');
    while (queue.length < 3) queue.push(queue[0]);
    preloadHTML(current()?.title);
  }

  async function advance() {
    queue.shift();
    if (pending.length > 0) {
      queue.push(await pending.shift());
    } else {
      queue.push(await fetchOne());
    }
    prefetchOne();
    preloadHTML(current()?.title);
  }

  function retreat() {
    const tail = queue.pop();
    queue.unshift(tail);
    prefetchOne();
  }

  /* Flush queue and reprime — called when categories change */
  async function reset() {
    queue.length   = 0;
    pending.length = 0;
    htmlCache.clear();
    await prime();
    prefetchOne();
  }

  function current() { return queue[1] || queue[0]; }
  function next()    { return queue[2]; }
  function prev()    { return queue[0]; }

  return {
    prime, prefetchOne, advance, retreat, reset,
    current, next, prev,
    fetchFullHTML, fetchImages,
    getCachedHTML, preloadHTML,
  };

})();
