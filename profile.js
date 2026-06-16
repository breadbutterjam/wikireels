/* profile.js — Profile overlay, badge engine, leaderboard */

/* ══════════════════════════════════════════════════════
   BADGE ENGINE
══════════════════════════════════════════════════════ */

const Badges = (() => {

  const DEFS = [
    { id: 'first_read',    icon: '📖', label: 'First Read',          desc: 'Read your first article',            check: () => Store.getHistory().length >= 1 },
    { id: 'ten_reads',     icon: '🔟', label: 'Avid Reader',         desc: 'Read 10 articles',                   check: () => Store.getHistory().length >= 10 },
    { id: 'century',       icon: '💯', label: 'Century',             desc: 'Read 100 articles',                  check: () => Store.getHistory().length >= 100 },
    { id: 'first_save',    icon: '🔖', label: 'Bookmarked',          desc: 'Save your first article',            check: () => Store.getSaves().length >= 1 },
    { id: 'curator',       icon: '🗂️', label: 'Curator',            desc: 'Save 25 articles',                   check: () => Store.getSaves().length >= 25 },
    { id: 'first_like',    icon: '💡', label: 'Curious',             desc: 'Like your first article',            check: () => Store.getLikes().length >= 1 },
    { id: 'opinionated',   icon: '🧠', label: 'Opinionated',         desc: 'Like 50 articles',                   check: () => Store.getLikes().length >= 50 },
    { id: 'streak_3',      icon: '🔥', label: '3-Day Streak',        desc: 'Read on 3 consecutive days',         check: () => currentStreak() >= 3 },
    { id: 'streak_7',      icon: '⚡', label: 'Week Warrior',        desc: 'Read on 7 consecutive days',         check: () => currentStreak() >= 7 },
    { id: 'streak_30',     icon: '🏆', label: 'Obsessed',            desc: 'Read on 30 consecutive days',        check: () => currentStreak() >= 30 },
    { id: 'rabbit_hole',   icon: '🐇', label: 'Down the Rabbit Hole',desc: 'Follow 5 links in one session',      check: () => (Store.getSessionDepth?.() || 0) >= 5 },
    { id: 'newsreader',    icon: '📰', label: 'Newsreader',          desc: 'Read 10 news articles',              check: () => (Store.getNewsCount?.() || 0) >= 10 },
    { id: 'historian',     icon: '🏛️', label: 'Historian',          desc: 'Read 10 On This Day articles',       check: () => (Store.getOTDCount?.() || 0) >= 10 },
    { id: 'polymath',      icon: '🌐', label: 'Polymath',            desc: 'Like articles in 5+ categories',    check: () => likedCategories() >= 5 },
  ];

  const EARNED_KEY = 'rh_badges';

  function getEarned() {
    try { return JSON.parse(localStorage.getItem(EARNED_KEY) || '[]'); } catch { return []; }
  }

  function setEarned(ids) {
    try { localStorage.setItem(EARNED_KEY, JSON.stringify(ids)); } catch {}
  }

  /* Check all badges and award newly earned ones */
  function evaluate() {
    const earned    = new Set(getEarned());
    const newlyEarned = [];

    DEFS.forEach(def => {
      if (!earned.has(def.id) && def.check()) {
        earned.add(def.id);
        newlyEarned.push(def);
      }
    });

    if (newlyEarned.length > 0) {
      setEarned([...earned]);
      newlyEarned.forEach(showBadgeToast);
    }

    return newlyEarned;
  }

  function earned() {
    const ids = new Set(getEarned());
    return DEFS.filter(d => ids.has(d.id));
  }

  function showBadgeToast(badge) {
    const t = document.createElement('div');
    t.className = 'badge-toast';
    t.innerHTML = `<span class="badge-toast__icon">${badge.icon}</span>
                   <span class="badge-toast__text">Badge unlocked: <strong>${badge.label}</strong></span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('badge-toast--visible'));
    setTimeout(() => {
      t.classList.remove('badge-toast--visible');
      setTimeout(() => t.remove(), 400);
    }, 3000);
  }

  /* ── Streak calculation ── */
  function currentStreak() {
    const history = Store.getHistory();
    if (history.length === 0) return 0;

    const days = [...new Set(
      history.map(h => new Date(h.savedAt).toDateString())
    )].map(s => new Date(s)).sort((a, b) => b - a);

    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = (days[i-1] - days[i]) / (1000 * 60 * 60 * 24);
      if (diff <= 1.5) streak++;
      else break;
    }
    return streak;
  }

  function likedCategories() {
    const likes = Store.getLikes();
    const cats  = new Set(likes.map(a => a.description || '').filter(Boolean));
    return cats.size;
  }

  return { evaluate, earned, currentStreak, DEFS };

})();

/* ══════════════════════════════════════════════════════
   PROFILE OVERLAY
══════════════════════════════════════════════════════ */

const Profile = (() => {

  function init() {
    /* Open profile from settings icon — handled in settings.js.
       Also wire close buttons. */
    document.getElementById('profile-close')
      ?.addEventListener('click', close);

    document.getElementById('btn-google-signin')
      ?.addEventListener('click', async () => {
        try {
          await Auth.signInWithGoogle();
        } catch {
          /* error already logged in auth.js */
        }
      });

    document.getElementById('btn-signout')
      ?.addEventListener('click', async () => {
        await Auth.signOut();
        close();
      });

    document.getElementById('btn-leaderboard')
      ?.addEventListener('click', () => {
        close();
        Leaderboard.open();
      });

    /* React to auth state changes */
    Auth.onChange(user => {
      updateTopBarAvatar(user);
      if (user) {
        onSignedIn(user);
      } else {
        onGuest();
      }
    });
  }

  function updateTopBarAvatar(user) {
    const img  = document.getElementById('top-bar-avatar');
    const icon = document.getElementById('top-bar-avatar-icon');
    if (!img || !icon) return;
    if (user?.photoURL) {
      img.src    = user.photoURL;
      img.hidden = false;
      icon.style.display = 'none';
    } else {
      img.hidden = true;
      icon.style.display = '';
    }
  }

  async function onSignedIn(user) {
    /* Sync data */
    await Sync.onSignIn(user.uid);
    await Sync.updateLeaderboard();

    /* Evaluate badges */
    Badges.evaluate();
  }

  function onGuest() {
    /* Nothing to sync — guest mode */
  }

  function open() {
    const overlay = document.getElementById('profile-overlay');
    overlay?.classList.replace('overlay--hidden', 'overlay--visible');
    refresh();
  }

  function close() {
    document.getElementById('profile-overlay')
      ?.classList.replace('overlay--visible', 'overlay--hidden');
  }

  function refresh() {
    const user = Auth.currentUser();

    /* Account section — signed in only */
    const accountEl  = document.getElementById('profile-account-section');
    const signinEl   = document.getElementById('profile-signin-strip');
    const signoutEl  = document.getElementById('profile-signout-section');

    if (user) {
      accountEl?.classList.remove('profile-section--hidden');
      signinEl?.classList.add('profile-section--hidden');
      signoutEl?.classList.remove('profile-section--hidden');
      const photo = document.getElementById('profile-photo');
      if (photo) {
        photo.src = user.photoURL || '';
        photo.style.display = user.photoURL ? '' : 'none';
      }
      const nameEl  = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');
      if (nameEl)  nameEl.textContent  = user.displayName || '';
      if (emailEl) emailEl.textContent = user.email || '';
    } else {
      accountEl?.classList.add('profile-section--hidden');
      signinEl?.classList.remove('profile-section--hidden');
      signoutEl?.classList.add('profile-section--hidden');
    }

    /* Stats — always, from localStorage */
    const history = Store.getHistory();
    const saves   = Store.getSaves();
    const likes   = Store.getLikes();
    const streak  = Badges.currentStreak();

    setText('pstat-read',   history.length);
    setText('pstat-saved',  saves.length);
    setText('pstat-liked',  likes.length);
    setText('pstat-streak', streak);

    /* Badges — always */
    Badges.evaluate();
    renderBadges();

    /* Saved articles — always */
    renderSaves(saves);
  }

  function renderBadges() {
    const grid    = document.getElementById('profile-badges');
    const countEl = document.getElementById('profile-badges-count');
    if (!grid) return;

    /* Evaluate once — this is the single source of truth for this render */
    Badges.evaluate();
    const earnedIds = new Set(Badges.earned().map(b => b.id));

    if (countEl) {
      countEl.textContent = `[${earnedIds.size} of ${Badges.DEFS.length}]`;
    }

    /* Sort: earned badges first (in their original order),
       then locked badges (in their original order) —
       guarantees all earned badges surface on the first page */
    const sortedDefs = [
      ...Badges.DEFS.filter(d => earnedIds.has(d.id)),
      ...Badges.DEFS.filter(d => !earnedIds.has(d.id)),
    ];

    grid.innerHTML = '';

    sortedDefs.forEach(def => {
      const earned = earnedIds.has(def.id);
      const el = document.createElement('div');
      el.className = `profile-badge ${earned ? 'profile-badge--earned' : 'profile-badge--locked'}`;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${def.label} — ${def.desc}`);
      el.innerHTML = `
        <span class="profile-badge__icon">${def.icon}</span>
        <span class="profile-badge__label">${def.label}</span>
      `;
      el.addEventListener('click', e => {
        e.stopPropagation();
        showBadgePopover(def, earned, el);
      });
      grid.appendChild(el);
    });

    /* Wire prev/next nav buttons */
    const prevBtn = document.getElementById('badge-nav-prev');
    const nextBtn = document.getElementById('badge-nav-next');

    if (prevBtn && nextBtn) {
      function updateNav() {
        prevBtn.disabled = grid.scrollLeft <= 0;
        nextBtn.disabled = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 1;
      }

      prevBtn.onclick = () => { grid.scrollBy({ left: -grid.clientWidth, behavior: 'smooth' }); };
      nextBtn.onclick = () => { grid.scrollBy({ left: grid.clientWidth, behavior: 'smooth' }); };
      grid.addEventListener('scroll', updateNav, { passive: true });
      requestAnimationFrame(updateNav);
    }
  }

  /* ── Badge popover ── */
  function showBadgePopover(def, earned, anchorEl) {
    /* Remove any existing popover */
    document.querySelector('.badge-popover')?.remove();

    const pop = document.createElement('div');
    pop.className = 'badge-popover';
    pop.innerHTML = `
      <div class="badge-popover__header">
        <span class="badge-popover__icon">${def.icon}</span>
        <div>
          <p class="badge-popover__name">${escHtml(def.label)}</p>
          <p class="badge-popover__status ${earned ? 'badge-popover__status--earned' : 'badge-popover__status--locked'}">
            ${earned ? '✓ earned' : 'not yet earned'}
          </p>
        </div>
      </div>
      <p class="badge-popover__desc">${escHtml(def.desc)}</p>
    `;

    /* Position below anchor */
    document.body.appendChild(pop);
    const rect = anchorEl.getBoundingClientRect();
    const popW = 220;
    let left = rect.left + rect.width / 2 - popW / 2;
    /* Keep within viewport */
    left = Math.max(12, Math.min(left, window.innerWidth - popW - 12));
    pop.style.left = `${left}px`;
    pop.style.top  = `${rect.bottom + window.scrollY + 8}px`;

    /* Animate in */
    requestAnimationFrame(() => pop.classList.add('badge-popover--visible'));

    /* Dismiss on next tap anywhere */
    const dismiss = () => {
      pop.classList.remove('badge-popover--visible');
      setTimeout(() => pop.remove(), 200);
      document.removeEventListener('click', dismiss);
    };
    setTimeout(() => document.addEventListener('click', dismiss), 10);
  }

  function renderSaves(saves) {
    const container = document.getElementById('profile-saves');
    if (!container) return;

    if (saves.length === 0) {
      container.innerHTML = '<p class="profile-saves__empty">nothing saved yet.</p>';
      return;
    }

    container.innerHTML = '';
    saves.slice(0, 30).forEach(article => {
      const el = document.createElement('div');
      el.className = 'profile-save-item';
      el.innerHTML = `
        ${article.thumbnail ? `<img class="profile-save-item__thumb" src="${article.thumbnail}" alt="" loading="lazy"/>` : '<div class="profile-save-item__thumb profile-save-item__thumb--empty"></div>'}
        <div class="profile-save-item__text">
          <p class="profile-save-item__title">${escHtml(article.title)}</p>
          <p class="profile-save-item__desc">${escHtml((article.description || '').slice(0, 60))}</p>
        </div>
      `;
      /* Tapping a saved article opens it in the reader */
      el.addEventListener('click', () => {
        close();
        /* enterReader is on app.js scope — use a custom event */
        document.dispatchEvent(new CustomEvent('rh:openArticle', { detail: { title: article.title } }));
      });
      container.appendChild(el);
    });
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, open, close, refresh };

})();

/* ══════════════════════════════════════════════════════
   LEADERBOARD
══════════════════════════════════════════════════════ */

const Leaderboard = (() => {

  let activeMetric = 'read';

  function init() {
    document.getElementById('leaderboard-close')
      ?.addEventListener('click', close);

    document.querySelectorAll('.leaderboard-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeMetric = tab.dataset.metric;
        document.querySelectorAll('.leaderboard-tab').forEach(t =>
          t.classList.toggle('leaderboard-tab--active', t === tab)
        );
        load(activeMetric);
      });
    });
  }

  function open() {
    document.getElementById('leaderboard-overlay')
      ?.classList.replace('overlay--hidden', 'overlay--visible');
    load(activeMetric);
  }

  function close() {
    document.getElementById('leaderboard-overlay')
      ?.classList.replace('overlay--visible', 'overlay--hidden');
  }

  async function load(metric) {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.innerHTML = '<p class="leaderboard-loading">Loading…</p>';

    const rows = await Sync.fetchLeaderboard(metric, 20);
    const uid  = Auth.uid();

    if (rows.length === 0) {
      list.innerHTML = '<p class="leaderboard-empty">No scores yet — be the first!</p>';
      return;
    }

    list.innerHTML = '';
    rows.forEach(row => {
      const isYou = row.uid === uid;
      const el = document.createElement('div');
      el.className = `leaderboard-row ${isYou ? 'leaderboard-row--you' : ''}`;
      el.innerHTML = `
        <span class="leaderboard-row__rank">${row.rank}</span>
        ${row.photoURL ? `<img class="leaderboard-row__photo" src="${row.photoURL}" alt="" loading="lazy"/>` : '<div class="leaderboard-row__photo leaderboard-row__photo--empty"></div>'}
        <span class="leaderboard-row__name">${escHtml(row.displayName || 'Anonymous')}${isYou ? ' <span class="leaderboard-row__you-tag">you</span>' : ''}</span>
        <span class="leaderboard-row__val">${row[metric] ?? '—'}</span>
      `;
      list.appendChild(el);
    });

    /* Show your rank if not in top 20 */
    const youEl = document.getElementById('leaderboard-you');
    if (youEl) {
      const youRow = rows.find(r => r.uid === uid);
      youEl.hidden = !!youRow;
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, open, close };

})();
