/* app.js — orchestrator: wires API + Store + Gestures + DOM */

document.addEventListener('DOMContentLoaded', async () => {

  /* ══════════════════════════════════════════════════════
     DOM REFS
  ══════════════════════════════════════════════════════ */

  const feed       = document.getElementById('feed');
  const loader     = document.getElementById('loader');

  /* Cards */
  const cardCurrent = document.getElementById('card-current');
  const cardNext    = document.getElementById('card-next');
  const cardPrev    = document.getElementById('card-prev');

  /* Summary layer — current card */
  const titleEl    = document.getElementById('title-current');
  const catEl      = document.getElementById('cat-current');
  const bodyEl     = document.getElementById('body-current');
  const readMoreBtn= document.getElementById('readmore-current');

  /* Reader layer — current card */
  const readerEl        = document.getElementById('card-reader');
  const readerTitleEl   = document.getElementById('reader-title');
  const readerTitleSmEl = document.getElementById('reader-title-small');
  const readerCatEl     = document.getElementById('reader-cat');
  const readerBodyEl    = document.getElementById('reader-body');
  const backBtn         = document.getElementById('btn-back');

  /* Next / prev preview layers */
  const titleNext = document.getElementById('title-next');
  const catNext   = document.getElementById('cat-next');
  const bodyNext  = document.getElementById('body-next');
  const titlePrev = document.getElementById('title-prev');
  const catPrev   = document.getElementById('cat-prev');
  const bodyPrev  = document.getElementById('body-prev');

  /* Action buttons */
  const btnLike    = document.getElementById('btn-like');
  const btnSave    = document.getElementById('btn-save');
  const btnProfile = document.getElementById('btn-profile');

  /* Gallery */
  const gallery      = document.getElementById('gallery');
  const galleryClose = document.getElementById('gallery-close');
  // const galleryStage = document.getElementById('gallery-stage');

  /* Context menu */
  const contextMenu    = document.getElementById('context-menu');
  const contextOverlay = document.getElementById('context-overlay');

  /* ══════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════ */

  let isAnimating = false;   /* block rapid swipes mid-transition   */
  let isReaderOpen = false;  /* summary vs reader mode              */
  let currentArticle = null; /* the live article object             */

  /* ══════════════════════════════════════════════════════
     BOOT — prime the queue, populate cards
  ══════════════════════════════════════════════════════ */

  try {
    await API.prime();
    API.prefetchOne(); /* warm the pipeline immediately */
  } catch (err) {
    showToast('Could not load articles — check connection');
    loader.classList.add('loader--hidden');
    return;
  }

  renderCurrent();
  renderAdjacent();
  loader.classList.add('loader--hidden');

  /* ══════════════════════════════════════════════════════
     RENDER HELPERS
  ══════════════════════════════════════════════════════ */

  function renderCurrent() {
    const a = API.current();
    if (!a) return;
    currentArticle = a;

    titleEl.textContent = a.title;
    catEl.textContent   = a.description || '';
    bodyEl.innerHTML    = `<p>${a.extract || ''}</p>`;

    /* Sync action button states with store */
    btnLike.classList.toggle('action-btn--liked', Store.isLiked(a.title));
    btnSave.classList.toggle('action-btn--saved', Store.isSaved(a.title));

    /* Track history */
    Store.addHistory(a);
  }

  function renderAdjacent() {
    const n = API.next();
    const p = API.prev();

    if (n) {
      titleNext.textContent = n.title;
      catNext.textContent   = n.description || '';
      bodyNext.innerHTML    = `<p>${n.extract || ''}</p>`;
    }
    if (p) {
      titlePrev.textContent = p.title;
      catPrev.textContent   = p.description || '';
      bodyPrev.innerHTML    = `<p>${p.extract || ''}</p>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     CARD NAVIGATION
     Model: three fixed DOM slots (prev / current / next).
     On swipe, animate the transition, THEN update queue
     and re-render content into the same slots.
     No DOM element is ever re-classed to a different
     slot — content rotates, elements stay put.
  ══════════════════════════════════════════════════════ */

  const DUR = 360; /* ms — must match CSS --dur-card */

  async function goNext() {
    if (isAnimating) return;
    if (isReaderOpen) exitReader();
    isAnimating = true;

    /* 1. Disable transitions so position resets are instant */
    setTransitions(false);

    /* 2. Pre-position: next card already sits at translateY(100%).
          Bring it just off the bottom edge with no transition so
          the upcoming animated slide feels natural. (It's already
          there via CSS, this is a no-op safety reset.) */

    /* 3. Animate: current slides up off screen, next slides up into view.
          Cards are already partially dragged — transition continues from
          wherever the finger released. */
    setTransitions(true);
    cardCurrent.style.transform = 'translateY(-100%)';
    cardNext.style.transform    = 'translateY(0)';

    await sleep(DUR);

    /* 4. Advance the data queue */
    await API.advance();

    /* 5. Kill transitions FIRST, wait two frames to guarantee the
          browser has painted transition:none before we move anything,
          then re-render and snap positions — user never sees the snap. */
    setTransitions(false);

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    renderCurrent();
    renderAdjacent();
    cardCurrent.style.transform = '';
    cardNext.style.transform    = '';
    cardPrev.style.transform    = '';

    /* One more frame before re-enabling transitions */
    requestAnimationFrame(() => {
      setTransitions(true);
      isAnimating = false;
    });
  }

  async function goPrev() {
    if (isAnimating) return;
    if (isReaderOpen) exitReader();
    isAnimating = true;

    setTransitions(true);
    cardCurrent.style.transform = 'translateY(100%)';
    cardPrev.style.transform    = 'translateY(0)';

    await sleep(DUR);

    API.retreat();

    setTransitions(false);

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    renderCurrent();
    renderAdjacent();
    cardCurrent.style.transform = '';
    cardNext.style.transform    = '';
    cardPrev.style.transform    = '';

    requestAnimationFrame(() => {
      setTransitions(true);
      isAnimating = false;
    });
  }

  function setTransitions(on) {
    const val = on ? `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)` : 'none';
    cardCurrent.style.transition = val;
    cardNext.style.transition    = val;
    cardPrev.style.transition    = val;
  }

  /* ══════════════════════════════════════════════════════
     DRAG FEEDBACK (vertical peek during swipe)
  ══════════════════════════════════════════════════════ */

  Gestures.on('drag', ({ dy }) => {
    if (isAnimating || isReaderOpen) return;
    /* Disable CSS transition so drag follows finger instantly */
    setTransitions(false);
    cardCurrent.style.transform = `translateY(${dy}px)`;
    if (dy < 0) {
      /* Pulling up — peek next from below */
      cardNext.style.transform = `translateY(calc(100% + ${dy}px))`;
      cardPrev.style.transform = 'translateY(-100%)';
    } else {
      /* Pulling down — peek prev from above */
      cardPrev.style.transform = `translateY(calc(-100% + ${dy}px))`;
      cardNext.style.transform = 'translateY(100%)';
    }
  });

  function snapBack() {
    setTransitions(true);
    cardCurrent.style.transform = '';
    cardNext.style.transform    = '';
    cardPrev.style.transform    = '';
  }

  Gestures.on('dragEnd',    () => { /* swipe committed — goNext/goPrev takes over */ });
  Gestures.on('dragCancel', () => snapBack());

  /* ══════════════════════════════════════════════════════
     GESTURE ROUTING
  ══════════════════════════════════════════════════════ */

  Gestures.init(feed);

  Gestures.on('swipeUp', () => {
    if (!isReaderOpen) goNext();
  });

  Gestures.on('swipeDown', () => {
    if (!isReaderOpen) goPrev();
  });

  Gestures.on('swipeLeft',  () => {
    if (isReaderOpen) return;
    saveCurrentArticle();
    flashSave();
  });

  Gestures.on('swipeRight', () => {
    if (isReaderOpen) return;
    openGallery();
  });

  Gestures.on('doubleTap', ({ x, y }) => {
    toggleLike(x, y);
  });

  /* ══════════════════════════════════════════════════════
     READER MODE (Option B — mode swap)
  ══════════════════════════════════════════════════════ */

  readMoreBtn.addEventListener('click', () => enterReader());
  backBtn.addEventListener('click', () => exitReader());

  async function enterReader() {
    if (isReaderOpen || !currentArticle) return;
    isReaderOpen = true;

    readerTitleEl.textContent   = currentArticle.title;
    readerTitleSmEl.textContent = currentArticle.title;
    readerCatEl.textContent     = currentArticle.description || '';
    readerEl.scrollTop          = 0;

    /* Check cache first — likely already loaded */
    const cached = API.getCachedHTML(currentArticle.title);
    if (cached) {
      readerBodyEl.innerHTML = cleanHTML(cached);
      cardCurrent.classList.add('card--reader');
    } else {
      /* Not cached yet — show reader immediately with loading state */
      readerBodyEl.innerHTML = '<p style="opacity:0.4;font-family:var(--f-sans);font-size:0.85rem;letter-spacing:0.05em;">Loading…</p>';
      cardCurrent.classList.add('card--reader');
      try {
        const html = await API.fetchFullHTML(currentArticle.title);
        readerBodyEl.innerHTML = cleanHTML(html);
      } catch {
        readerBodyEl.innerHTML = `<p>Could not load full article. <a href="${currentArticle.content_urls?.desktop?.page || '#'}" target="_blank" rel="noopener">Read on Wikipedia →</a></p>`;
      }
    }
  }

  function exitReader() {
    if (!isReaderOpen) return;
    cardCurrent.classList.remove('card--reader');
    isReaderOpen = false;
    setTimeout(() => {
      readerBodyEl.innerHTML      = '';
      readerTitleEl.textContent   = '';
      readerTitleSmEl.textContent = '';
    }, 320);
  }

  function cleanHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll(
      '.infobox, table, sup, .mw-editsection, .reference, ' +
      '.navbox, .thumb, .metadata, .hatnote, .toc, ' +
      '.sistersitebox, .reflist, .mw-references-wrap, ' +
      '.mw-empty-elt, .noprint, style, script'
    ).forEach(el => el.remove());
    /* Fix relative image paths */
    div.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('//')) img.src = 'https:' + src;
    });
    return div.innerHTML;
  }

  /* ══════════════════════════════════════════════════════
     LIKE
  ══════════════════════════════════════════════════════ */

  btnLike.addEventListener('click', () => toggleLike());

  function toggleLike(tapX, tapY) {
    if (!currentArticle) return;
    const liked = Store.isLiked(currentArticle.title);
    if (liked) {
      Store.unlike(currentArticle.title);
      btnLike.classList.remove('action-btn--liked');
    } else {
      Store.like(currentArticle);
      btnLike.classList.add('action-btn--liked');
      burstLike(tapX, tapY);
    }
  }

  function burstLike(x, y) {
    /* Brief lightbulb glow burst — CSS handles the animation,
       we just retrigger it by removing/adding the class */
    btnLike.classList.remove('action-btn--liked');
    void btnLike.offsetWidth; /* force reflow */
    btnLike.classList.add('action-btn--liked');

    /* Optional: floating emoji burst at tap location */
    if (x && y) {
      const spark = document.createElement('span');
      spark.textContent = '💡';
      spark.style.cssText = `
        position:fixed; left:${x}px; top:${y}px;
        font-size:2rem; pointer-events:none; z-index:999;
        animation: sparkFloat 700ms ease-out forwards;
        transform: translate(-50%, -50%);
      `;
      document.body.appendChild(spark);
      setTimeout(() => spark.remove(), 750);
    }
  }

  /* ══════════════════════════════════════════════════════
     SAVE
  ══════════════════════════════════════════════════════ */

  btnSave.addEventListener('click', () => {
    const saved = Store.isSaved(currentArticle?.title);
    if (saved) {
      Store.unsave(currentArticle.title);
      btnSave.classList.remove('action-btn--saved');
      showToast('Removed from saves');
    } else {
      saveCurrentArticle();
      showToast('Saved');
    }
  });

  function saveCurrentArticle() {
    if (!currentArticle) return;
    Store.save(currentArticle);
    btnSave.classList.add('action-btn--saved');
  }

  function flashSave() {
    showToast('Saved');
  }

  /* ══════════════════════════════════════════════════════
     GALLERY — full-screen carousel
  ══════════════════════════════════════════════════════ */

  const galleryTrack   = document.getElementById('gallery-track');
  const galleryCounter = document.getElementById('gallery-counter');
  const galleryCaption = document.getElementById('gallery-caption');
  const galleryDots    = document.getElementById('gallery-dots');
  const galleryStage   = document.getElementById('gallery-stage');

  let galleryImages  = [];   /* [{src, caption}] */
  let galleryIndex   = 0;    /* current slide    */
  let galleryOpen    = false;

  /* Touch state for in-gallery horizontal swipe */
  let gStartX = 0, gDragging = false, gDragX = 0;

  galleryClose.addEventListener('click', closeGallery);

  /* Touch on the stage for carousel swiping */
  galleryStage.addEventListener('touchstart', e => {
    gStartX   = e.touches[0].clientX;
    gDragging = true;
    gDragX    = 0;
    galleryTrack.classList.add('gallery__track--dragging');
  }, { passive: true });

  galleryStage.addEventListener('touchmove', e => {
    if (!gDragging) return;
    gDragX = e.touches[0].clientX - gStartX;
    const base = -galleryIndex * 100;
    const drag = (gDragX / window.innerWidth) * 100;
    galleryTrack.style.transform = `translateX(calc(${base}% + ${gDragX}px))`;
  }, { passive: true });

  galleryStage.addEventListener('touchend', () => {
    if (!gDragging) return;
    gDragging = false;
    galleryTrack.classList.remove('gallery__track--dragging');

    const threshold = window.innerWidth * 0.25;

    if (gDragX < -threshold) {
      /* Swiped left — next image or close if at end */
      if (galleryIndex < galleryImages.length - 1) {
        setGalleryIndex(galleryIndex + 1);
      } else {
        closeGallery();
      }
    } else if (gDragX > threshold) {
      /* Swiped right — prev image or close if at start */
      if (galleryIndex > 0) {
        setGalleryIndex(galleryIndex - 1);
      } else {
        closeGallery();
      }
    } else {
      /* Didn't reach threshold — snap back */
      setGalleryIndex(galleryIndex);
    }
  }, { passive: true });

  async function openGallery() {
    if (!currentArticle || galleryOpen) return;
    galleryOpen = true;
    galleryIndex = 0;

    /* Show gallery immediately in loading state */
    gallery.classList.replace('overlay--hidden', 'overlay--visible');
    galleryTrack.innerHTML  = '';
    galleryDots.innerHTML   = '';
    galleryCounter.textContent = '';
    galleryCaption.textContent = '';
    galleryTrack.innerHTML  = buildLoadingSlide();
    console.log('Opening gallery for:', currentArticle.title);
    try {
      const images = await API.fetchImages(currentArticle.title);
      galleryImages = images;
      console.log('Fetched gallery images:', images);
      if (images.length === 0) {
        showEmptyGallery();
        return;
      }

      buildGallerySlides(images);
      setGalleryIndex(0);

    } catch {
      showEmptyGallery();
    }
  }

  function buildLoadingSlide() {
    return `<div class="gallery__slide">
      <p style="color:rgba(247,245,240,0.25);font-family:var(--f-sans);font-size:0.72rem;letter-spacing:0.1em;text-transform:uppercase;">Loading images…</p>
    </div>`;
  }

  function buildGallerySlides(images) {
    galleryTrack.innerHTML = '';
    galleryDots.innerHTML  = '';

    images.forEach((img, i) => {
      /* Slide */
      const slide = document.createElement('div');
      slide.className = 'gallery__slide';
      const im = document.createElement('img');
      im.alt     = img.caption || '';
      im.loading = i === 0 ? 'eager' : 'lazy';
      /* Use smaller srcset for first image, full for rest */
      //if (src.startsWith('//')) img.src = 'https:' + src;
      if (img.src.startsWith('//')) img.src = 'https:' + img.src;
      im.src = img.src;
      slide.appendChild(im);
      galleryTrack.appendChild(slide);

      /* Dot */
      const dot = document.createElement('div');
      dot.className = 'gallery__dot';
      dot.dataset.index = i;
      galleryDots.appendChild(dot);
    });

    /* Hide dots if only 1 image */
    galleryDots.style.display = images.length <= 1 ? 'none' : '';
  }

  function setGalleryIndex(i) {
    galleryIndex = Math.max(0, Math.min(i, galleryImages.length - 1));

    /* Slide track */
    galleryTrack.style.transform = `translateX(-${galleryIndex * 100}%)`;

    /* Counter */
    galleryCounter.textContent = galleryImages.length > 1
      ? `${galleryIndex + 1} / ${galleryImages.length}`
      : '';

    /* Caption */
    galleryCaption.textContent = galleryImages[galleryIndex]?.caption || '';

    /* Dots */
    galleryDots.querySelectorAll('.gallery__dot').forEach((d, idx) => {
      d.classList.toggle('gallery__dot--active', idx === galleryIndex);
    });
  }

  function showEmptyGallery() {
    galleryTrack.innerHTML  = '';
    galleryDots.innerHTML   = '';
    galleryCounter.textContent = '';
    galleryCaption.textContent = '';

    const tpl = document.getElementById('tpl-no-images');
    const empty = document.createElement('div');
    empty.className = 'gallery__empty';
    empty.appendChild(tpl.content.cloneNode(true));
    /* Inject directly into gallery (not track) */
    document.getElementById('gallery-stage').appendChild(empty);
  }

  function closeGallery() {
    if (!galleryOpen) return;
    galleryOpen = false;
    gallery.classList.replace('overlay--visible', 'overlay--hidden');

    /* Clean up after transition */
    setTimeout(() => {
      galleryTrack.innerHTML = '';
      galleryDots.innerHTML  = '';
      galleryCounter.textContent = '';
      galleryCaption.textContent = '';
      galleryImages = [];
      /* Remove empty state if it was shown */
      document.getElementById('gallery-stage')
        .querySelector('.gallery__empty')?.remove();
    }, 400);
  }

  /* ══════════════════════════════════════════════════════
     CONTEXT MENU (3-dot / not interested)
  ══════════════════════════════════════════════════════ */

  document.querySelectorAll('.card__menu').forEach(btn =>
    btn.addEventListener('click', openMenu)
  );
  document.getElementById('menu-cancel').addEventListener('click', closeMenu);
  contextOverlay.addEventListener('click', closeMenu);

  document.getElementById('menu-dislike').addEventListener('click', () => {
    if (currentArticle) Store.dislike(currentArticle.title);
    closeMenu();
    showToast('Got it — fewer like this');
    goNext();
  });

  document.getElementById('menu-share').addEventListener('click', () => {
    closeMenu();
    const url = currentArticle?.content_urls?.desktop?.page
      || `https://en.wikipedia.org/wiki/${encodeURIComponent(currentArticle?.title || '')}`;
    if (navigator.share) {
      navigator.share({ title: currentArticle?.title, url });
    } else {
      navigator.clipboard?.writeText(url).then(() => showToast('Link copied'));
    }
  });

  function openMenu() {
    contextMenu.classList.remove('context-menu--hidden');
    contextOverlay.classList.remove('context-overlay--hidden');
  }

  function closeMenu() {
    contextMenu.classList.add('context-menu--hidden');
    contextOverlay.classList.add('context-overlay--hidden');
  }

  /* ══════════════════════════════════════════════════════
     INJECT SPARKFLOAT KEYFRAME (used by double-tap burst)
  ══════════════════════════════════════════════════════ */

  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes sparkFloat {
      0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.6); }
      60%  { opacity: 1; transform: translate(-50%, -120%) scale(1.2); }
      100% { opacity: 0; transform: translate(-50%, -180%) scale(0.9); }
    }
  `;
  document.head.appendChild(styleSheet);

  /* ══════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════ */

  function showToast(msg) {
    let t = document.querySelector('.save-flash');
    if (!t) {
      t = document.createElement('div');
      t.className = 'save-flash';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('save-flash--visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('save-flash--visible'), 1800);
  }

  /* ══════════════════════════════════════════════════════
     UTILS
  ══════════════════════════════════════════════════════ */

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

});
