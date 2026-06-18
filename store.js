/* store.js — localStorage persistence (guest layer) */

const Store = (() => {

  const K = {
    saves:      'rh_saves',
    likes:      'rh_likes',
    dislikes:   'rh_dislikes',
    history:    'rh_history',
    categories: 'rh_categories',
    onboarded:  'rh_onboarded',
    timeSpent:  'rh_time_spent_ms',
    maxDepth:   'rh_max_depth',
    visitDays:  'rh_visit_days',
  };

  const MAX_HISTORY = 200;

  function get(key)      { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
  function set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  /* ── Article record stored (minimal footprint) ── */
  function slim(article) {
    return {
      title:       article.title,
      description: article.description || '',
      extract:     (article.extract || '').slice(0, 280),
      thumbnail:   article.thumbnail?.source || null,
      url:         article.content_urls?.desktop?.page || '',
      savedAt:     Date.now(),
    };
  }

  function upsert(key, article) {
    const list = get(key).filter(a => a.title !== article.title);
    set(key, [slim(article), ...list]);
  }

  function remove(key, title) {
    set(key, get(key).filter(a => a.title !== title));
  }

  return {

    /* Saves */
    save:      a     => { upsert(K.saves, a);  typeof Sync !== 'undefined' && Sync.write('saves', slim(a)); },
    unsave:    title => { remove(K.saves, title); typeof Sync !== 'undefined' && Sync.remove('saves', title); },
    isSaved:   title => get(K.saves).some(a => a.title === title),
    getSaves:  ()    => get(K.saves),

    /* Likes */
    like:      a     => { upsert(K.likes, a);  typeof Sync !== 'undefined' && Sync.write('likes', slim(a)); },
    unlike:    title => { remove(K.likes, title); typeof Sync !== 'undefined' && Sync.remove('likes', title); },
    isLiked:   title => get(K.likes).some(a => a.title === title),
    getLikes:  ()    => get(K.likes),

    /* Dislikes */
    dislike:      title => {
      const d = get(K.dislikes);
      if (!d.includes(title)) {
        set(K.dislikes, [title, ...d].slice(0, 500));
        typeof Sync !== 'undefined' && Sync.write('dislikes', { title, savedAt: Date.now() });
      }
    },
    getDislikes: () => get(K.dislikes),

    /* Read history */
    addHistory: a => {
      const h = get(K.history).filter(x => x.title !== a.title);
      const entry = slim(a);
      set(K.history, [entry, ...h].slice(0, MAX_HISTORY));
      typeof Sync !== 'undefined' && Sync.write('history', entry);
      /* Evaluate badges on each read */
      typeof Badges !== 'undefined' && setTimeout(() => Badges.evaluate(), 100);
    },
    getHistory: () => get(K.history),

    /* Categories */
    setCategories: ids  => set(K.categories, ids),
    getCategories: ()   => get(K.categories),
    hasCategories: ()   => get(K.categories).length > 0,

    /* Onboarding */
    setOnboarded:  ()   => { try { localStorage.setItem(K.onboarded, '1'); } catch {} },
    isOnboarded:   ()   => { try { return !!localStorage.getItem(K.onboarded); } catch { return false; } },

    /* ── Time spent — rough estimate, accumulated across sessions ── */
    addTimeSpent: ms => {
      const total = Store.getTimeSpent() + ms;
      try { localStorage.setItem(K.timeSpent, String(total)); } catch {}
    },
    getTimeSpent: () => {
      try { return parseInt(localStorage.getItem(K.timeSpent) || '0', 10); } catch { return 0; }
    },

    /* ── Max reading depth — deepest rabbit-hole dive ever recorded ── */
    recordDepth: depth => {
      const current = Store.getMaxDepth();
      if (depth > current) {
        try { localStorage.setItem(K.maxDepth, String(depth)); } catch {}
      }
    },
    getMaxDepth: () => {
      try { return parseInt(localStorage.getItem(K.maxDepth) || '0', 10); } catch { return 0; }
    },

    /* ── Visit days — distinct calendar days the app was opened ──
          Used for streak calculation independent of "reading" an
          article — just opening the app counts as a visit. ── */
    recordVisitToday: () => {
      const days = get(K.visitDays);
      const today = new Date().toDateString();
      if (!days.includes(today)) {
        set(K.visitDays, [today, ...days].slice(0, 400));
      }
    },
    getVisitDays: () => get(K.visitDays),

  };

})();
