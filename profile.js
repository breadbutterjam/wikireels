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
    { id: 'rabbit_hole',   icon: '🐇', label: 'Down the Rabbit Hole',desc: 'Follow 5 links deep in one dive',    check: () => Store.getMaxDepth() >= 5 },
    { id: 'deep_diver',    icon: '🕳️', label: 'Deep Diver',          desc: 'Follow 10 links deep in one dive',   check: () => Store.getMaxDepth() >= 10 },
    { id: 'newsreader',    icon: '📰', label: 'Newsreader',          desc: 'Read 10 news articles',              check: () => (Store.getNewsCount?.() || 0) >= 10 },
    { id: 'historian',     icon: '🏛️', label: 'Historian',          desc: 'Read 10 On This Day articles',       check: () => (Store.getOTDCount?.() || 0) >= 10 },
    { id: 'polymath',      icon: '🌐', label: 'Polymath',            desc: 'Like articles in 5+ categories',    check: () => likedCategories() >= 5 },
    { id: 'hour_in',       icon: '⏱️', label: 'Settling In',         desc: 'Spend 1 hour in the app',            check: () => Store.getTimeSpent() >= 3600000 },
    { id: 'five_hours',    icon: '⏳', label: 'Time Flies',          desc: 'Spend 5 hours in the app',           check: () => Store.getTimeSpent() >= 18000000 },
    { id: 'regular',       icon: '📅', label: 'Regular',             desc: 'Visit on 7 different days',          check: () => Store.getVisitDays().length >= 7 },
    { id: 'loyal',         icon: '🗓️', label: 'Loyal',               desc: 'Visit on 30 different days',         check: () => Store.getVisitDays().length >= 30 },
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
      /* Sync to Firestore if signed in — fire and forget */
      if (typeof Sync !== 'undefined' && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
        Sync.writeBadges();
      }
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

    /* Also fire a local notification — works even if the tab is
       backgrounded. Silently no-ops if permission isn't granted. */
    if (typeof Notify !== 'undefined') {
      Notify.fire(`${badge.icon} Badge unlocked`, {
        body: `${badge.label} — ${badge.desc}`,
        tag: `badge-${badge.id}`, /* prevents duplicate stacking */
      });
    }
  }

  /* ── Streak calculation (reading-based, existing) ── */
  /* ── Current streak — consecutive days up to and including today/yesterday,
        based on visit days (app opened). Uses the SAME data source as
        longestStreak() below — they must agree, since "current" is by
        definition never greater than "longest". ── */
  function currentStreak() {
    const days = [...new Set(Store.getVisitDays())]
      .map(s => new Date(s))
      .sort((a, b) => b - a); /* newest first */

    if (days.length === 0) return 0;

    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = (days[i-1] - days[i]) / (1000 * 60 * 60 * 24);
      if (diff <= 1.5) streak++;
      else break;
    }
    return streak;
  }

  /* ── Longest streak ever, based on visit days (app opened, not
        necessarily an article read) — used on the detailed stats screen ── */
  function longestStreak() {
    const days = [...new Set(Store.getVisitDays())]
      .map(s => new Date(s))
      .sort((a, b) => a - b);

    if (days.length === 0) return 0;

    let longest = 1, current = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = (days[i] - days[i-1]) / (1000 * 60 * 60 * 24);
      if (diff <= 1.5) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }
    return longest;
  }

  function likedCategories() {
    const likes = Store.getLikes();
    const cats  = new Set(likes.map(a => a.description || '').filter(Boolean));
    return cats.size;
  }

  return { evaluate, earned, currentStreak, longestStreak, DEFS };

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

    document.getElementById('btn-delete-leaderboard')
      ?.addEventListener('click', () => showDeleteConfirm());

    document.getElementById('delete-lb-cancel')
      ?.addEventListener('click', () => hideDeleteConfirm());

    document.getElementById('delete-lb-confirm')
      ?.addEventListener('click', async () => {
        hideDeleteConfirm();
        await performDeleteAndSignOut();
      });

    document.getElementById('btn-view-all-saves')
      ?.addEventListener('click', () => {
        close();
        SavesOverlay.open();
      });

    document.getElementById('btn-leaderboard')
      ?.addEventListener('click', () => {
        close();
        Leaderboard.open();
      });

    document.getElementById('btn-detailed-stats')
      ?.addEventListener('click', () => {
        close();
        Stats.open();
      });

    /* Top bar direct-access icons (same destinations as the in-profile links) */
    document.getElementById('btn-stats-topbar')
      ?.addEventListener('click', () => Stats.open());

    document.getElementById('btn-leaderboard-topbar')
      ?.addEventListener('click', () => Leaderboard.open());

    /* React to auth state changes — refresh profile whenever auth settles */
    Auth.onChange(user => {
      // console.log("Profile observed auth change, user:", user);
      updateTopBarAvatar(user);
      if (user) {
        onSignedIn(user);
        refresh(); /* ensure account section shows immediately */
      } else {
        onGuest();
        refresh(); /* ensure guest state is shown correctly */
      }
    });
  }

  function updateTopBarAvatar(user) {
    // console.log("updateTopBarAvatar user:", user);
    const img  = document.getElementById('top-bar-avatar');
    const icon = document.getElementById('top-bar-avatar-icon');
    if (!img || !icon) return;

    /* For anonymous guests, use the generated avatar path.
       For Google users, use the Google photo URL. */
    let photoURL = user?.photoURL || '';
    // console.log("Initial photoURL:", photoURL);
    if (!user || user?.isAnonymous) {
      const identity = Auth.generateGuestIdentity();
      photoURL = identity.avatar;
    }

    // console.log("Final photoURL:", photoURL);
    if (photoURL) {
      img.src    = photoURL;
      img.hidden = false;
      // icon.style.display = 'none';
      icon.classList.add('hdn');
      img.onerror = () => {
        /* Avatar image not found yet — fall back to person icon */
        console.log("Avatar image failed to load, hiding img and showing icon");
        img.hidden = true;
        // icon.style.display = '';
        icon.classList.remove('hdn');
      };
    } else {
      img.hidden = true;
      // icon.style.display = '';
      icon.classList.remove('hdn');
    }
  }

  async function onSignedIn(user) {
    /* Anonymous guests: push their leaderboard entry right away
       (no private data to sync, just the public score). */
    if (user.isAnonymous) {
      await Sync.updateLeaderboard();
      Badges.evaluate();
      return;
    }
    /* Google: full two-way sync */
    await Sync.onSignIn(user.uid);
    await Sync.updateLeaderboard();
    Badges.evaluate();
  }

  function onGuest() {
    /* Should not reach here now that anonymous auth fires for all guests */
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

    //

    /* Auth hasn't resolved yet — don't touch visibility */
    if (user === undefined) {
      //
      return;
    }

    const accountEl = document.getElementById('profile-account-section');
    const signinEl  = document.getElementById('profile-signin-strip');
    const signoutEl = document.getElementById('profile-signout-section');

    //

    function show(el) {
      if (!el) return;
      el.classList.remove('profile-section--hidden');
      el.style.display = '';
    }
    function hide(el) {
      if (!el) return;
      el.classList.add('profile-section--hidden');
      el.style.display = 'none';
    }

    if (user) {
      show(accountEl);
      hide(signinEl);
      show(signoutEl);

      const photo   = document.getElementById('profile-photo');
      const nameEl  = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');

      if (user.isAnonymous) {
        /* Guest — show generated name and animal avatar */
        const identity = Auth.generateGuestIdentity();
        if (photo) {
          photo.src = identity.avatar;
          photo.style.display = '';
          photo.onerror = () => { photo.style.display = 'none'; };
        }
        if (nameEl)  nameEl.textContent  = identity.name;
        if (emailEl) emailEl.textContent = 'guest';
      } else {
        /* Google account */
        if (photo) {
          photo.src = user.photoURL || '';
          photo.style.display = user.photoURL ? '' : 'none';
        }
        if (nameEl)  nameEl.textContent  = user.displayName || '';
        if (emailEl) emailEl.textContent = user.email       || '';
      }
    } else {
      //
      

      show(accountEl);
      hide(signoutEl);
      show(signinEl);

      /* Guest — show generated name and animal avatar */ 
      renderGuestPhotoAndName()
    
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

  function renderTopBarAvatar() {
    const photo = document.getElementById('top-bar-avatar');
    const identity = Auth.generateGuestIdentity();
    photo.src = identity.avatar;
    photo.style.display = '';
    photo.onerror = () => { photo.style.display = 'none'; };
  }

  function renderGuestPhotoAndName() {
    const photo   = document.getElementById('profile-photo');
    const nameEl  = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    
    const identity = Auth.generateGuestIdentity();
    if (photo) {
      photo.src = identity.avatar;
      photo.style.display = '';
      photo.onerror = () => { photo.style.display = 'none'; };
    }
    if (nameEl)  nameEl.textContent  = identity.name;
    if (emailEl) emailEl.textContent = 'guest';
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
    /* Show only 5 in the profile — full list in the saves overlay */
    saves.slice(0, 5).forEach(article => {
      const el = document.createElement('div');
      el.className = 'profile-save-item';
      el.innerHTML = `
        ${article.thumbnail ? `<img class="profile-save-item__thumb" src="${article.thumbnail}" alt="" loading="lazy"/>` : '<div class="profile-save-item__thumb profile-save-item__thumb--empty"></div>'}
        <div class="profile-save-item__text">
          <p class="profile-save-item__title">${escHtml(article.title)}</p>
          <p class="profile-save-item__desc">${escHtml((article.extract || article.description || '').slice(0, 80))}</p>
        </div>
      `;
      el.addEventListener('click', () => {
        close();
        document.dispatchEvent(new CustomEvent('rh:openArticle', { detail: article }));
      });
      container.appendChild(el);
    });

    /* If there are more than 5, the "view all →" button is already in HTML */
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

  function showDeleteConfirm() {
  const user  = Auth.currentUser();
  const msgEl = document.getElementById('delete-lb-msg');
  if (msgEl) {
    if (user?.isAnonymous) {
      msgEl.textContent =
        'This will remove your guest entry from the leaderboard and sign you out. ' +
        'Your next visit will generate a fresh guest identity. ' +
        'Your saves and reading history on this device are not affected.';
    } else {
      msgEl.textContent =
        'This will remove your entry from the leaderboard and sign you out. ' +
        'Your saves, likes, and reading history are not deleted. ' +
        'Signing back in will add you to the leaderboard again automatically.';
    }
  }
  document.getElementById('delete-lb-dialog')
    ?.classList.replace('confirm-dialog--hidden', 'confirm-dialog--visible');
}

function hideDeleteConfirm() {
  document.getElementById('delete-lb-dialog')
    ?.classList.replace('confirm-dialog--visible', 'confirm-dialog--hidden');
}

async function performDeleteAndSignOut() {
  const isGuest = Auth.isAnonymous();
  await Sync.deleteLeaderboardEntry();
  if (isGuest) {
    try {
      localStorage.removeItem('rh_guest_name');
      localStorage.removeItem('rh_guest_animal');
    } catch {}
  }
  await Auth.signOut();
  close();
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

/* ══════════════════════════════════════════════════════
   DETAILED STATS SCREEN
══════════════════════════════════════════════════════ */

const Stats = (() => {

  function init() {
    document.getElementById('stats-close')
      ?.addEventListener('click', close);
  }

  function open() {
    document.getElementById('stats-overlay')
      ?.classList.replace('overlay--hidden', 'overlay--visible');
    refresh();
    /* Keep the cloud copy fresh whenever the user actually looks at stats */
    if (typeof Sync !== 'undefined' && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
      Sync.writeStats();
    }
  }

  function close() {
    document.getElementById('stats-overlay')
      ?.classList.replace('overlay--visible', 'overlay--hidden');
  }

  function refresh() {
    /* Streak block */
    const current = Badges.currentStreak();
    const longest = Math.max(current, Badges.longestStreak());
    setText('stats-current-streak', current);
    setText('stats-longest-streak', longest);
    setText('stats-total-days',     Store.getVisitDays().length);

    /* Time spent — include current live session for accuracy */
    setText('stats-time-total', formatDuration(Store.getTimeSpent()));

    /* Depth */
    setText('stats-max-depth',     Store.getMaxDepth());
    setText('stats-articles-read', Store.getHistory().length);
  }

  function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0 && minutes === 0) return 'less than a minute';
    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours} hr`;
    return `${hours} hr ${minutes} min`;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  return { init, open, close, refresh };

})();

/* ══════════════════════════════════════════════════════
   STARTUP STATS SCREEN — simplified glanceable summary,
   shown on app open unless the user has dismissed it via
   the settings toggle.
══════════════════════════════════════════════════════ */

const StartupStats = (() => {

  const PREF_KEY = 'rh_hide_startup_stats';

  function shouldShow() {
    try { return localStorage.getItem(PREF_KEY) !== '1'; } catch { return true; }
  }

  function setHidden(hidden) {
    try { localStorage.setItem(PREF_KEY, hidden ? '1' : '0'); } catch {}
  }

  function isHidden() {
    try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return false; }
  }

  function init() {
    document.getElementById('startup-stats-close')
      ?.addEventListener('click', close);

    const checkbox = document.getElementById('startup-stats-dismiss-pref');
    checkbox?.addEventListener('change', () => {
      setHidden(checkbox.checked);
      /* Keep the settings-pane toggle in sync (inverted: "show" vs "hide") */
      const settingsToggle = document.getElementById('toggle-startup-stats');
      if (settingsToggle) settingsToggle.checked = !checkbox.checked;
    });
  }

  /* Called once at boot, after the rest of the app has initialised.
     Only shows if there's something worth showing (avoids an empty
     screen for a brand new user with zero stats). */
  function maybeShow() {
    if (!shouldShow()) return;
    if (Store.getHistory().length === 0) return; /* nothing to show yet */

    refresh();
    document.getElementById('startup-stats')
      ?.classList.add('startup-stats--visible');
  }

  function refresh() {
    setText('ss-streak', Badges.currentStreak());
    setText('ss-read',   Store.getHistory().length);
    setText('ss-badges', Badges.earned().length);

    /* Reflect current preference state in the checkbox */
    const checkbox = document.getElementById('startup-stats-dismiss-pref');
    if (checkbox) checkbox.checked = isHidden();
  }

  function close() {
    document.getElementById('startup-stats')
      ?.classList.remove('startup-stats--visible');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  return { init, maybeShow, close, shouldShow, setHidden, isHidden };


})();

/* ══════════════════════════════════════════════════════
   SAVES OVERLAY — full list of saved articles
   Shows all saves with summary + read more interaction
══════════════════════════════════════════════════════ */

const SavesOverlay = (() => {

  function init() {
    document.getElementById('saves-close')
      ?.addEventListener('click', close);
  }

  function open() {
    document.getElementById('saves-overlay')
      ?.classList.replace('overlay--hidden', 'overlay--visible');
    render();
  }

  function close() {
    document.getElementById('saves-overlay')
      ?.classList.replace('overlay--visible', 'overlay--hidden');
  }

  function render() {
    const body  = document.getElementById('saves-overlay-body');
    if (!body) return;

    const saves = Store.getSaves();

    if (saves.length === 0) {
      body.innerHTML = '<p class="profile-saves__empty" style="padding:2rem var(--pad-x)">nothing saved yet.</p>';
      return;
    }

    body.innerHTML = '';

    saves.forEach(article => {
      const el = document.createElement('div');
      el.className = 'saves-card';
      el.innerHTML = `
        ${article.thumbnail
          ? `<img class="saves-card__thumb" src="${escHtml(article.thumbnail)}" alt="" loading="lazy"/>`
          : ''}
        <div class="saves-card__body">
          <p class="saves-card__title">${escHtml(article.title)}</p>
          ${article.extract || article.description
            ? `<p class="saves-card__extract">${escHtml((article.extract || article.description || '').slice(0, 200))}${(article.extract || '').length > 200 ? '…' : ''}</p>`
            : ''}
          <div class="saves-card__actions">
            <button class="saves-card__readmore">read more</button>
            <button class="saves-card__unsave">remove</button>
          </div>
        </div>
      `;

      el.querySelector('.saves-card__readmore').addEventListener('click', () => {
        close();
        document.dispatchEvent(new CustomEvent('rh:openArticle', { detail: article }));
      });

      el.querySelector('.saves-card__unsave').addEventListener('click', () => {
        Store.unsave(article.title);
        el.remove();
        /* Show empty state if no more saves */
        if (!body.querySelector('.saves-card')) {
          body.innerHTML = '<p class="profile-saves__empty" style="padding:2rem var(--pad-x)">nothing saved yet.</p>';
        }
      });

      body.appendChild(el);
    });
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, open, close };

})();
