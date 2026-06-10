/* api.js — Wikipedia fetch + 3-article prefetch queue */

const API = (() => {

  const SUMMARY_RANDOM = 'https://en.wikipedia.org/api/rest_v1/page/random/summary';
  const SUMMARY_TITLE  = t => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
  const HTML_TITLE     = t => `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(t)}`;
  const MEDIA_TITLE    = t => `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(t)}`;

  /* ── Fetch a random article summary ── */
  async function fetchRandom() {
    const res = await fetch(SUMMARY_RANDOM);
    if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
    return res.json();
    /*
      Returns shape:
      {
        title, displaytitle, description,
        extract          — lead paragraph plain text
        thumbnail?       — { source, width, height }
        originalimage?   — { source }
        content_urls.desktop.page  — canonical Wikipedia URL
      }
    */
  }

  /* ── Fetch full article HTML for reader mode ── */
  async function fetchFullHTML(title) {
    const res = await fetch(HTML_TITLE(title));
    if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
    return res.text();
  }

  /* ── Fetch image list for gallery ── */
  async function fetchImages(title) {
    const res = await fetch(MEDIA_TITLE(title));
    if (!res.ok) return [];
    const data = await res.json();
    /* Filter to actual images, exclude icons/logos/flags (small files) */
    return (data.items || []).filter(item =>
      item.type === 'image' &&
      item.srcset?.length > 0 &&
      !item.title.match(/flag|icon|logo|symbol|map|coa|coat/i) &&
      (item.original?.width || 0) > 200
    ).map(item => ({
      src:     item.srcset[item.srcset.length - 1]?.src || item.original?.source,
      caption: item.caption?.text || item.title.replace(/^File:/i, '').replace(/\.[^.]+$/, ''),
      width:   item.original?.width,
      height:  item.original?.height,
    }));
  }

  /* ── HTML preload cache ── */
  const htmlCache = new Map(); /* title → html string */

  async function preloadHTML(title) {
    if (!title || htmlCache.has(title)) return;
    try {
      const html = await fetchFullHTML(title);
      htmlCache.set(title, html);
    } catch { /* silent — reader will retry on demand */ }
  }

  function getCachedHTML(title) {
    return htmlCache.get(title) || null;
  }
  /*    Always keeps [prev, current, next] loaded.
     queue[0] = prev, queue[1] = current, queue[2] = next
     On swipe forward: shift left, fetch new tail.
     On swipe back:    unshift, discard tail.
  ══════════════════════════════════════════════════════ */

  const queue   = [];   /* resolved article objects */
  const pending = [];   /* in-flight fetch promises  */

  async function prime() {
    const fetches = [fetchRandom(), fetchRandom(), fetchRandom()];
    const results = await Promise.allSettled(fetches);
    results.forEach(r => {
      if (r.status === 'fulfilled') queue.push(r.value);
    });
    if (queue.length === 0) throw new Error('Could not load any articles');
    while (queue.length < 3) queue.push(queue[0]);
    /* Preload full HTML for the current article immediately */
    preloadHTML(current()?.title);
  }

  function prefetchOne() {
    /* Fire a fetch and push the promise; resolve later */
    const p = fetchRandom().catch(() => fetchRandom()); /* one retry */
    pending.push(p);
  }

  async function advance() {
    queue.shift();
    if (pending.length > 0) {
      const next = await pending.shift();
      queue.push(next);
    } else {
      queue.push(await fetchRandom());
    }
    prefetchOne();
    /* Preload full HTML for the new current article */
    preloadHTML(current()?.title);
  }

  function retreat() {
    /* Called after swipe-down (previous article) — no new fetch needed,
       we reconstruct by rotating: move tail to head as new "prev".
       Since we never truly have a prev beyond 1 step, we just
       reload a random as the new tail to keep the queue full. */
    const tail = queue.pop();
    queue.unshift(tail);
    prefetchOne();
  }

  function current()  { return queue[1] || queue[0]; }
  function next()     { return queue[2]; }
  function prev()     { return queue[0]; }

  return {
    prime,
    prefetchOne,
    advance,
    retreat,
    current,
    next,
    prev,
    fetchFullHTML,
    fetchImages,
    getCachedHTML,
    preloadHTML,
  };

})();
