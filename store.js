/* store.js — localStorage persistence (guest layer) */

const Store = (() => {

  const K = {
    saves:    'rh_saves',
    likes:    'rh_likes',
    dislikes: 'rh_dislikes',
    history:  'rh_history',
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
    save:      a     => upsert(K.saves, a),
    unsave:    title => remove(K.saves, title),
    isSaved:   title => get(K.saves).some(a => a.title === title),
    getSaves:  ()    => get(K.saves),

    /* Likes */
    like:      a     => upsert(K.likes, a),
    unlike:    title => remove(K.likes, title),
    isLiked:   title => get(K.likes).some(a => a.title === title),
    getLikes:  ()    => get(K.likes),

    /* Dislikes (topic suppression seeds) */
    dislike:      title => {
      const d = get(K.dislikes);
      if (!d.includes(title)) set(K.dislikes, [title, ...d].slice(0, 500));
    },
    getDislikes: () => get(K.dislikes),

    /* Read history */
    addHistory: a => {
      const h = get(K.history).filter(x => x.title !== a.title);
      set(K.history, [slim(a), ...h].slice(0, MAX_HISTORY));
    },
    getHistory: () => get(K.history),

  };

})();
