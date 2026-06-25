/* app.js — orchestrator: wires API + Store + Gestures + DOM */

/* ── Register service worker (app-shell offline caching) ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        /* A new worker was found and is installing */
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            /* 'installed' + an existing controller means this is an
               UPDATE (not the very first install) — show the prompt */
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(() => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              });
            }
          });
        });
      })
      .catch(err => console.warn('SW registration failed:', err));

    /* Reload once the new worker actually takes control */
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

function showUpdateToast(onUpdate) {
  const t = document.createElement('div');
  t.className = 'update-toast';
  t.innerHTML = `
    <span class="update-toast__text">A new version is ready</span>
    <button class="update-toast__btn">Refresh</button>
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('update-toast--visible'));

  t.querySelector('.update-toast__btn').addEventListener('click', () => {
    onUpdate();
    t.remove();
  });
}

document.addEventListener('DOMContentLoaded', async () => {

  /* ══════════════════════════════════════════════════════
     SESSION TIME TRACKING — rough estimate, flushed on
     visibility change / unload so backgrounded tabs don't
     silently accumulate time
  ══════════════════════════════════════════════════════ */

  let sessionStart = Date.now();

  function flushSessionTime() {
    const elapsed = Date.now() - sessionStart;
    if (elapsed > 0) Store.addTimeSpent(elapsed);
    sessionStart = Date.now();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushSessionTime();
      /* Page is still alive here (unlike beforeunload), so this is a
         safe place to fire the async Firestore stats write */
      if (typeof Sync !== 'undefined' && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
        Sync.writeStats();
      }
    } else {
      sessionStart = Date.now(); /* resume timing */
    }
  });

  window.addEventListener('beforeunload', flushSessionTime);
  window.addEventListener('pagehide', flushSessionTime);

  /* Record today as a visit day (independent of reading an article) */
  Store.recordVisitToday();

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
  const btnGallery = document.getElementById('btn-gallery');
  const btnSave    = document.getElementById('btn-save');
  const btnProfile = document.getElementById('btn-profile');

  /* Gallery */
  const gallery      = document.getElementById('gallery');
  const galleryClose = document.getElementById('gallery-close');
  const galleryStage = document.getElementById('gallery-stage');

  /* Context menu */
  const contextMenu    = document.getElementById('context-menu');
  const contextOverlay = document.getElementById('context-overlay');

  /* Category picker */
  const catPicker = document.getElementById('category-picker');
  const catGrid   = document.getElementById('cat-grid');
  const catStart  = document.getElementById('cat-start');
  const catSkip   = document.getElementById('cat-skip');

  /* ══════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════ */

  let isAnimating  = false;
  let isReaderOpen = false;
  let currentArticle = null;

  /* ══════════════════════════════════════════════════════
     CATEGORY PICKER — first visit only
     Return visits go straight to feed.
  ══════════════════════════════════════════════════════ */

  let pickerSelected = [...Store.getCategories()];

  if (Store.isOnboarded()) {
    /* Return visit — hide picker immediately, boot feed after splash */
    catPicker.classList.add('cat-picker--hidden');
  } else {
    /* First visit — render pills, wire buttons */
    Categories.renderPills(catGrid, pickerSelected, ids => {
      pickerSelected = ids;
      catStart.disabled = ids.length === 0;
    });
    catStart.disabled = pickerSelected.length === 0;
  }

  catStart.addEventListener('click', async () => {
    Store.setCategories(pickerSelected);
    Store.setOnboarded();
    await dismissPickerAndStart();
  });

  catSkip.addEventListener('click', async () => {
    Store.setCategories([]);
    Store.setOnboarded();
    await dismissPickerAndStart();
  });

  /* ══════════════════════════════════════════════════════
     BOOT SEQUENCE
     1. Settings.init() — apply stored prefs immediately
     2. Splash — show briefly, then fade
     3. If first visit: show onboarding, then category picker
     4. If return visit: category picker (or skip to feed)
  ══════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════
     BOOT SEQUENCE
     1. Settings.init() — apply stored prefs immediately
     2. Splash shows, waits for Auth to resolve
     3a. Signed in  → proceed straight to existing flow
     3b. Not signed in → show sign-in nudge, wait for choice
     4. Then: first visit → onboarding → category picker
        return visit → straight to feed
  ══════════════════════════════════════════════════════ */

  /* Apply stored appearance prefs immediately */
  Settings.init();

  /* Init auth, profile, leaderboard */
  Auth.init();
  Profile.init();
  Leaderboard.init();
  Stats.init();
  StartupStats.init();
  SavesOverlay.init();

  /* Init search — navigate callback opens reader for selected result */
  Search.init(title => ArticlePreview.open({ title, source: 'search' }));

  /* Listen for profile article-open events — show preview first */
  document.addEventListener('rh:openArticle', e => {
    ArticlePreview.open(e.detail);
  });

  /* Init today feed */
  Today.init();
  DateFeed.init();
  CuratedFeed.init();

  const splash        = document.getElementById('splash');
  const splashSpinner = document.getElementById('splash-spinner');
  const signinNudge    = document.getElementById('signin-nudge');
  const isFirstTime   = !Store.isOnboarded();
  const MIN_SPLASH     = isFirstTime ? 1600 : 800;
  const SPINNER_DELAY  = 500;

  function hideSplash() {
    splash?.classList.add('splash--hidden');
  }

  function showSigninNudge() {
    return new Promise(resolve => {
      signinNudge?.classList.add('signin-nudge--visible');

      const googleBtn = document.getElementById('nudge-google-signin');
      const guestBtn   = document.getElementById('nudge-continue-guest');

      const dismissNudge = () => {
        signinNudge?.classList.remove('signin-nudge--visible');
        googleBtn?.removeEventListener('click', onGoogle);
        guestBtn?.removeEventListener('click', onGuest);
        resolve();
      };

      const onGoogle = async () => {
        try {
          await Auth.signInWithGoogle();
        } catch (err) {
          console.error('Sign-in failed:', err?.code, err?.message, err);
        }
        dismissNudge();
      };

      const onGuest = () => dismissNudge();

      googleBtn?.addEventListener('click', onGoogle);
      guestBtn?.addEventListener('click', onGuest);
    });
  }

  function proceedAfterAuth() {
    if (isFirstTime) {
      setTimeout(() => Onboarding.show(), 500);
    } else {
      Categories.warmPools();
      const feedReady = bootFeed();
      let spinnerTimer = setTimeout(() => {
        splashSpinner?.classList.add('splash__spinner--visible');
      }, SPINNER_DELAY);
      feedReady.then(() => {
        clearTimeout(spinnerTimer);
        splashSpinner?.classList.remove('splash__spinner--visible');

        /* Apply default launch mode from settings */
        const defaultMode = Settings.getDefaultMode?.() || 'home';
        if (defaultMode !== 'home') {
          const navBtns = {
            news:    document.getElementById('nav-news'),
            today:   document.getElementById('nav-today'),
            curated: document.getElementById('nav-curated'),
          };
          navBtns[defaultMode]?.click();
        }

        StartupStats.maybeShow();
      });
    }
  }

  /* Minimum splash time runs in parallel with auth resolution */
  const splashTimer = new Promise(r => setTimeout(r, MIN_SPLASH));

  Promise.all([splashTimer, Auth.whenResolved()]).then(async ([, user]) => {
    hideSplash();

    if (user) {
      /* Signed in — skip nudge entirely */
      proceedAfterAuth();
    } else {
      /* Not signed in — always show the choice, every load */
      await showSigninNudge();
      proceedAfterAuth();
    }
  });

  document.getElementById('onboarding-dismiss')
    ?.addEventListener('click', () => Onboarding.dismiss());

  async function dismissPickerAndStart() {
    catPicker.classList.add('cat-picker--hidden');
    Categories.warmPools();
    await bootFeed();
  }

  /* ══════════════════════════════════════════════════════
     BOOT FEED — returns promise, resolves when first
     articles are rendered and ready to show
  ══════════════════════════════════════════════════════ */

  async function bootFeed() {
    try {
      await API.prime();
      API.prefetchOne();
    } catch (err) {
      showToast('Could not load articles — check connection');
      return;
    }
    renderCurrent();
    renderAdjacent();
    loader.classList.add('loader--hidden');
    /* Promise resolves here — caller (splash logic) can now reveal feed */
  }

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

  const DUR = 360;

  /* Actions div travels visually with card-current.
     We mirror the card's transform on it so it slides
     in/out in perfect sync, including during peek drag. */
  const actionsEl = document.getElementById('actions');

  function setActionsTransform(val) {
    actionsEl.style.transform = val;
  }

  async function goNext() {
    if (isAnimating) return;
    if (isReaderOpen) exitReader();
    isAnimating = true;

    setTransitions(false);
    setTransitions(true);
    cardCurrent.style.transform = 'translateY(-100%)';
    cardNext.style.transform    = 'translateY(0)';
    /* Icons slide out with current card */
    actionsEl.style.transition  = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
    actionsEl.style.transform   = 'translateY(-100%)';

    await sleep(DUR);
    await API.advance();

    setTransitions(false);
    actionsEl.style.transition = 'none';

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    renderCurrent();
    renderAdjacent();
    cardCurrent.style.transform = '';
    cardNext.style.transform    = '';
    cardPrev.style.transform    = '';
    /* Snap icons back with card-current — no transition, invisible */
    actionsEl.style.transform   = '';

    requestAnimationFrame(() => {
      setTransitions(true);
      actionsEl.style.transition = '';
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
    actionsEl.style.transition  = `transform ${DUR}ms cubic-bezier(0.22,1,0.36,1)`;
    actionsEl.style.transform   = 'translateY(100%)';

    await sleep(DUR);
    API.retreat();

    setTransitions(false);
    actionsEl.style.transition = 'none';

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    renderCurrent();
    renderAdjacent();
    cardCurrent.style.transform = '';
    cardNext.style.transform    = '';
    cardPrev.style.transform    = '';
    actionsEl.style.transform   = '';

    requestAnimationFrame(() => {
      setTransitions(true);
      actionsEl.style.transition = '';
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
    setTransitions(false);
    cardCurrent.style.transform = `translateY(${dy}px)`;
    actionsEl.style.transform   = `translateY(${dy}px)`;
    actionsEl.style.transition  = 'none';
    if (dy < 0) {
      cardNext.style.transform = `translateY(calc(100% + ${dy}px))`;
      cardPrev.style.transform = 'translateY(-100%)';
    } else {
      cardPrev.style.transform = `translateY(calc(-100% + ${dy}px))`;
      cardNext.style.transform = 'translateY(100%)';
    }
  });

  function snapBack() {
    setTransitions(true);
    cardCurrent.style.transform = '';
    cardNext.style.transform    = '';
    cardPrev.style.transform    = '';
    actionsEl.style.transform   = '';
    actionsEl.style.transition  = '';
  }

  Gestures.on('dragEnd',    () => { /* swipe committed — goNext/goPrev takes over */ });
  Gestures.on('dragCancel', () => snapBack());

  /* ══════════════════════════════════════════════════════
     GESTURE ROUTING
  ══════════════════════════════════════════════════════ */

  Gestures.init(feed);

  Gestures.on('swipeUp', () => {
    if (typeof closeNavMenu === 'function') closeNavMenu();
    if (currentMode === 'news')    { Today.handleSwipeUp();       return; }
    if (currentMode === 'today')   { DateFeed.handleSwipeUp();    return; }
    if (currentMode === 'curated') { CuratedFeed.handleSwipeUp(); return; }
    if (!isReaderOpen) goNext();
  });

  Gestures.on('swipeDown', () => {
    if (typeof closeNavMenu === 'function') closeNavMenu();
    if (currentMode === 'news')    { Today.handleSwipeDown();       return; }
    if (currentMode === 'today')   { DateFeed.handleSwipeDown();    return; }
    if (currentMode === 'curated') { CuratedFeed.handleSwipeDown(); return; }
    if (!isReaderOpen) goPrev();
  });

  Gestures.on('swipeLeft', () => {
    if (isReaderOpen) return;
    /* swipe left removed from save — explicit button only.
       Left edge reserved to avoid Safari back-gesture conflict. */
    openGallery();
  });

  Gestures.on('swipeRight', () => {
    if (isReaderOpen) return; /* in reader, horizontal swipes are for nav within links */
    // openGallery();
  });

  Gestures.on('doubleTap', ({ x, y }) => {
    toggleLike(x, y);
  });

  /* ══════════════════════════════════════════════════════
     READER MODE — with in-app link navigation stack
     Stack stores {title, html} entries.
     Back pops the stack. At depth 0, back exits reader.
  ══════════════════════════════════════════════════════ */

  const NAV_STACK_MAX = 10;
  let navStack = [];   /* [{title, scrollTop, article?}] — current article always at tail */

  readMoreBtn.addEventListener('click', () => enterReader());
  backBtn.addEventListener('click', () => navigateBack());

  async function enterReader(title = null) {
    const articleTitle = title || currentArticle?.title;
    if (!articleTitle) return;

    if (!isReaderOpen) {
      /* First entry — set up state */
      isReaderOpen = true;
      navStack = [];
      cardCurrent.classList.add('card--reader');
    }

    /* Push to stack — include article data if entering from card (title===null),
       otherwise it's a deep-dive link and we only have the title for now */
    navStack.push({
      title:   articleTitle,
      scrollTop: 0,
      article: title ? null : currentArticle,  /* null for deep-dive links */
    });
    Store.recordDepth(navStack.length);
    updateReaderHeader(articleTitle);
    readerEl.scrollTop = 0;

    /* Try cache first */
    const cached = title ? null : API.getCachedHTML(articleTitle);
    if (cached) {
      readerBodyEl.innerHTML = cleanHTML(cached);
      attachReaderLinks();
      return;
    }

    readerBodyEl.innerHTML = '<p class="reader-loading">Loading…</p>';

    try {
      /* For deep-dive links (title passed explicitly), fetch both the
         full HTML AND a summary so we have proper data if the user saves */
      const [html] = await Promise.all([
        API.fetchFullHTML(articleTitle),
        title ? enrichNavStackEntry(articleTitle) : Promise.resolve(),
      ]);
      readerBodyEl.innerHTML = cleanHTML(html);
      attachReaderLinks();
    } catch {
      readerBodyEl.innerHTML = `<p>Could not load article. <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle)}" target="_blank" rel="noopener">Open on Wikipedia →</a></p>`;
    }
  }

  /* Fetch a Wikipedia summary for a deep-dived article and store it
     in the matching navStack entry so saves have proper metadata.
     Fires in parallel with the full HTML fetch — silent on failure. */
  async function enrichNavStackEntry(title) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      /* Find the entry in navStack and patch its article field */
      const entry = navStack.find(e => e.title === title);
      if (entry) {
        entry.article = {
          title:       data.title || title,
          extract:     data.extract || '',
          description: data.description || '',
          thumbnail:   data.thumbnail?.source || null,
          savedAt:     Date.now(),
        };
      }
    } catch {
      /* Silent — the save will still work, just without thumbnail/extract */
    }
  }

  function updateReaderHeader(title) {
    readerTitleEl.textContent   = title;
    readerTitleSmEl.textContent = title;
    /* Category only meaningful for the root article */
    readerCatEl.textContent = navStack.length <= 1
      ? (currentArticle?.description || '')
      : '';

    /* Back button label: show depth if > 1 */
    backBtn.textContent = navStack.length > 1
      ? `← back · ${navStack.length - 1}`
      : '←';

    /* Save button reflects whether THIS article (not the root) is saved */
    btnSave.classList.toggle('action-btn--saved', Store.isSaved(title));
  }

  function navigateBack() {
    if (!isReaderOpen) return;

    navStack.pop();

    if (navStack.length === 0) {
      /* Exit reader entirely */
      exitReader();
    } else {
      /* Go back one level — re-fetch the previous article */
      const prev = navStack[navStack.length - 1];
      navStack.pop(); /* enterReader will re-push it */
      enterReader(prev.title);
    }
  }

  function exitReader() {
    cardCurrent.classList.remove('card--reader');
    isReaderOpen = false;
    navStack = [];
    setTimeout(() => {
      readerBodyEl.innerHTML      = '';
      readerTitleEl.textContent   = '';
      readerTitleSmEl.textContent = '';
      readerCatEl.textContent     = '';
      backBtn.textContent         = '←';
    }, 320);
  }

  /* Single delegated listener on readerBodyEl — attached once,
     handles all link clicks including dynamically loaded content.
     Wikipedia HTML API uses relative hrefs: ./Title, ../wiki/Title,
     /wiki/Title, and full https://en.wikipedia.org/wiki/Title      */
  readerBodyEl.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;

    e.preventDefault();
    e.stopPropagation();

    const href = a.getAttribute('href') || '';

    /* Extract Wikipedia article title from any href format */
    const title = extractWikiTitle(href);

    if (title) {
      if (navStack.length >= NAV_STACK_MAX) {
        showToast('Too deep — opening in Wikipedia');
        window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, '_blank', 'noopener');
        return;
      }
      /* Save scroll position of current level */
      if (navStack.length > 0) {
        navStack[navStack.length - 1].scrollTop = readerEl.scrollTop;
      }
      enterReader(title);
      return;
    }

    /* Non-article link (external, file, special page) — new tab */
    const fullHref = a.href || href;
    if (fullHref && fullHref.startsWith('http')) {
      window.open(fullHref, '_blank', 'noopener');
    }
  });

  function extractWikiTitle(href) {
    if (!href || href.startsWith('#')) return null;

    /* Relative: ./Title_Here or ./Title_Here#Section */
    const dotSlash = href.match(/^\.\/([^#?:]+)/);
    if (dotSlash) return decodeURIComponent(dotSlash[1]).replace(/_/g, ' ');

    /* /wiki/Title or https://en.wikipedia.org/wiki/Title */
    const wikiPath = href.match(/\/wiki\/([^#?:]+)/);
    if (wikiPath) {
      /* Skip special namespaces: File:, Help:, Wikipedia:, etc. */
      const raw = wikiPath[1];
      if (raw.includes(':')) return null;
      return decodeURIComponent(raw).replace(/_/g, ' ');
    }

    return null;
  }

  /* attachReaderLinks kept as no-op — delegation handles everything */
  function attachReaderLinks() {}

  function cleanHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll(
      '.infobox, table, sup, .mw-editsection, .reference, ' +
      '.navbox, .thumb, .metadata, .hatnote, .toc, ' +
      '.sistersitebox, .reflist, .mw-references-wrap, ' +
      '.mw-empty-elt, .noprint, style, script'
    ).forEach(el => el.remove());
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

  /* Returns the article that should be saved — the currently
     visible one. In reader mode that's the top of navStack
     (which may be a deep-dived article, not the root card).
     Outside reader mode it's the current card article.        */
  function getActiveArticle() {
    if (isReaderOpen && navStack.length > 0) {
      const top = navStack[navStack.length - 1];
      /* If we have full article data (entered from card), use it */
      if (top.article) return top.article;
      /* Deep-dived link — we only have the title. Build a minimal
         save record; thumbnail/extract will be blank but title is
         correct and the article is findable via search later.    */
      return { title: top.title, extract: '', thumbnail: null, description: '', savedAt: Date.now() };
    }
    return currentArticle;
  }

  btnSave.addEventListener('click', () => {
    const active = getActiveArticle();
    if (!active) return;

    const saved = Store.isSaved(active.title);
    if (saved) {
      Store.unsave(active.title);
      btnSave.classList.remove('action-btn--saved');
      showToast('Removed from saves');
    } else {
      Store.save(active);
      btnSave.classList.add('action-btn--saved');
      showToast('Saved');
    }
  });

  /* ══════════════════════════════════════════════════════
     GALLERY — full-screen carousel
  ══════════════════════════════════════════════════════ */

  const galleryTrack   = document.getElementById('gallery-track');
  const galleryCounter = document.getElementById('gallery-counter');
  const galleryCaption = document.getElementById('gallery-caption');
  const galleryDots    = document.getElementById('gallery-dots');
  // const galleryStage = document.getElementById('gallery-stage'); /* declared at top of DOM refs */

  let galleryImages  = [];   /* [{src, caption}] */
  let galleryIndex   = 0;    /* current slide    */
  let galleryOpen    = false;

  /* Touch state for in-gallery horizontal swipe */
  let gStartX = 0, gDragging = false, gDragX = 0;

  galleryClose.addEventListener('click', closeGallery);
  btnGallery.addEventListener('click', openGallery);

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
    if (galleryOpen) return;

    /* Use the currently visible article — top of navStack in reader
       mode, otherwise the base card article */
    const activeTitle = isReaderOpen && navStack.length > 0
      ? navStack[navStack.length - 1].title
      : currentArticle?.title;

    if (!activeTitle) return;
    galleryOpen = true;
    galleryIndex = 0;

    /* Show gallery immediately in loading state */
    gallery.classList.replace('overlay--hidden', 'overlay--visible');
    galleryTrack.innerHTML  = '';
    galleryDots.innerHTML   = '';
    galleryCounter.textContent = '';
    galleryCaption.textContent = '';
    galleryTrack.innerHTML  = buildLoadingSlide();

    try {
      const images = await API.fetchImages(activeTitle);
      galleryImages = images;

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
      if (img.src && img.src.startsWith('//')) img.src = 'https:' + img.src; /* clean up source */
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
     BOTTOM PIP + FLOATING NAV
  ══════════════════════════════════════════════════════ */

  const navPip      = document.getElementById('nav-pip');
  const navMenu     = document.getElementById('nav-menu');
  const navHome     = document.getElementById('nav-home');
  const navNews     = document.getElementById('nav-news');
  const navToday    = document.getElementById('nav-today');
  const navCurated  = document.getElementById('nav-curated');
  const topBarLabel = document.getElementById('top-bar-label');

  const MODE_LABELS = { home: '', news: 'News', today: 'Today', curated: 'Curated' };
  let   currentMode     = 'home';
  let   navMenuOpen     = false;
  let   navDismissTimer = null;

  const NAV_AUTO_DISMISS = 3000;

  function setMode(mode) {
    currentMode = mode;
    navPip.className = `nav-pip nav-pip--${mode}`;
    if (navMenuOpen) navPip.classList.add('nav-pip--open');
    navMenu.querySelectorAll('.nav-menu__item').forEach(btn => {
      btn.classList.toggle('nav-menu__item--active', btn.dataset.mode === mode);
    });
    if (topBarLabel) topBarLabel.textContent = MODE_LABELS[mode] || '';
  }

  function openNavMenu() {
    navMenuOpen = true;
    navMenu.classList.replace('nav-menu--hidden', 'nav-menu--visible');
    navPip.classList.add('nav-pip--open');
    scheduleNavDismiss();
  }

  function closeNavMenu() {
    navMenuOpen = false;
    navMenu.classList.replace('nav-menu--visible', 'nav-menu--hidden');
    navPip.classList.remove('nav-pip--open');
    clearTimeout(navDismissTimer);
  }

  function scheduleNavDismiss() {
    clearTimeout(navDismissTimer);
    navDismissTimer = setTimeout(closeNavMenu, NAV_AUTO_DISMISS);
  }

  navPip.addEventListener('click', () => {
    if (navMenuOpen) closeNavMenu();
    else openNavMenu();
  });

  /* Nav: Home */
  navHome?.addEventListener('click', () => {
    setMode('home');
    closeNavMenu();
    Today.hide();
    DateFeed.hide();
    CuratedFeed.hide();
    document.getElementById('feed').style.display = '';
  });

  /* Nav: News */
  navNews?.addEventListener('click', () => {
    setMode('news');
    closeNavMenu();
    document.getElementById('feed').style.display = 'none';
    DateFeed.hide();
    CuratedFeed.hide();
    Today.show();
  });

  /* Nav: Today (date-based — On This Day / Featured / Picture) */
  navToday?.addEventListener('click', () => {
    setMode('today');
    closeNavMenu();
    document.getElementById('feed').style.display = 'none';
    Today.hide();
    CuratedFeed.hide();
    DateFeed.show();
  });

  /* Nav: Curated (Poems / Biographies / Speeches / Major Events) */
  navCurated?.addEventListener('click', () => {
    setMode('curated');
    closeNavMenu();
    document.getElementById('feed').style.display = 'none';
    Today.hide();
    DateFeed.hide();
    CuratedFeed.show();
  });

  navMenu.addEventListener('pointerenter', () => clearTimeout(navDismissTimer));
  navMenu.addEventListener('pointerleave', () => scheduleNavDismiss());

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
     DESKTOP NAV ARROWS (#3)
     Only rendered on non-touch via CSS media query,
     but wired here unconditionally — harmless on mobile.
  ══════════════════════════════════════════════════════ */

  document.getElementById('desktop-prev')\n    ?.addEventListener('click', () => { if (!isReaderOpen) goPrev(); });
  document.getElementById('desktop-next')\n    ?.addEventListener('click', () => { if (!isReaderOpen) goNext(); });

  /* Also support keyboard arrow keys on desktop */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowDown' || e.key === 'j') { if (!isReaderOpen) goNext(); }
    if (e.key === 'ArrowUp'   || e.key === 'k') { if (!isReaderOpen) goPrev(); }
    if (e.key === 'Escape' && isReaderOpen)      { navigateBack(); }
  });

  /* ══════════════════════════════════════════════════════
     ARTICLE PREVIEW OVERLAY
     Shown when opening a saved article or search result.
     Displays summary + thumbnail with "read full article"
     button that then opens the full reader.
  ══════════════════════════════════════════════════════ */

  const ArticlePreview = (() => {
    const overlay   = document.getElementById('article-preview-overlay');
    const backBtn   = document.getElementById('article-preview-back');
    const sourceEl  = document.getElementById('article-preview-source');
    const thumbWrap = document.getElementById('article-preview-thumb-wrap');
    const thumbEl   = document.getElementById('article-preview-thumb');
    const titleEl_  = document.getElementById('article-preview-title');
    const extractEl = document.getElementById('article-preview-extract');
    const readBtn   = document.getElementById('article-preview-readmore');

    let currentTitle = null;

    function open(detail) {
      /* detail: { title, extract?, thumbnail?, description?, source? } */
      currentTitle = detail.title;
      const source = detail.source || 'saved';

      /* Populate immediately with whatever data we have */
      if (sourceEl) sourceEl.textContent = source === 'search' ? 'search result' : 'saved article';
      if (titleEl_) titleEl_.textContent = detail.title || '';
      if (extractEl) extractEl.textContent = detail.extract || detail.description || '';

      if (detail.thumbnail) {
        if (thumbEl) thumbEl.src = detail.thumbnail;
        if (thumbWrap) thumbWrap.style.display = '';
      } else {
        if (thumbWrap) thumbWrap.style.display = 'none';
        /* If no extract stored, fetch summary */
        if (!detail.extract && detail.title) fetchSummary(detail.title);
      }

      /* If opened from saves with no extract, we may need to fetch */
      if (!detail.extract && !detail.thumbnail && detail.title) {
        fetchSummary(detail.title);
      }

      overlay?.classList.replace('overlay--hidden', 'overlay--visible');
    }

    async function fetchSummary(title) {
      try {
        const res  = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (extractEl && !extractEl.textContent) {
          extractEl.textContent = data.extract || '';
        }
        if (data.thumbnail?.source && thumbWrap && thumbEl) {
          thumbEl.src = data.thumbnail.source;
          thumbWrap.style.display = '';
        }
      } catch {}
    }

    function close() {
      overlay?.classList.replace('overlay--visible', 'overlay--hidden');
      currentTitle = null;
    }

    backBtn?.addEventListener('click', close);

    readBtn?.addEventListener('click', () => {
      if (!currentTitle) return;
      close();
      enterReader(currentTitle);
    });

    return { open, close };
  })();

  /* ══════════════════════════════════════════════════════
     UTILS
  ══════════════════════════════════════════════════════ */

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

});
