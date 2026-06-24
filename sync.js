/* sync.js — Firestore ↔ localStorage bidirectional sync */

const Sync = (() => {

  const COLLECTIONS = ['saves', 'likes', 'dislikes', 'history'];

  function db() {
    return typeof firebase !== 'undefined' ? firebase.firestore() : null;
  }

  function userRef(uid) {
    return db()?.collection('users').doc(uid);
  }

  /* ── On sign-in: pull Firestore into localStorage, then push local gaps ── */
  async function onSignIn(uid) {
    const firestore = db();
    if (!firestore) return;

    /* Guest (anonymous) users don't sync reading data — they only
       appear on the leaderboard. Skip all the collection sync and
       go straight to updating the leaderboard entry. */
    if (Auth.isAnonymous()) {
      await updateLeaderboard();
      return;
    }

    try {
      /* Pull each sub-collection from Firestore */
      for (const col of COLLECTIONS) {
        const snap = await userRef(uid).collection(col)
          .orderBy('savedAt', 'desc').limit(500).get();

        if (snap.empty) continue;

        const remote = snap.docs.map(d => d.data());
        const local  = Store[`get${capitalise(col)}`]?.() || [];

        /* Merge: prefer whichever entry has the later savedAt */
        const merged = mergeByTitle(remote, local);
        const storeKey = `rh_${col}`;
        try { localStorage.setItem(storeKey, JSON.stringify(merged)); } catch {}
      }

      /* Pull preferences */
      const profSnap = await userRef(uid).get();
      if (profSnap.exists) {
        const prefs = profSnap.data()?.preferences || {};
        if (prefs.categories) Store.setCategories(prefs.categories);
      }

      /* Pull + merge badges, stats, preferences (separate sub-documents) */
      await pullBadges(uid);
      await pullStats(uid);
      await pullPreferences(uid);

      /* Push any local items not yet in Firestore (gap fill) */
      await pushLocalToFirestore(uid);

    } catch (err) {
      console.warn('Sync.onSignIn error:', err);
    }
  }

  /* ── Pull badges — union of remote + local (never lose an earned badge) ── */
  async function pullBadges(uid) {
    try {
      const snap = await userRef(uid).collection('meta').doc('badges').get();
      if (!snap.exists) return;

      const remoteIds = snap.data()?.earned || [];
      const localIds  = JSON.parse(localStorage.getItem('rh_badges') || '[]');
      const merged     = [...new Set([...remoteIds, ...localIds])];

      localStorage.setItem('rh_badges', JSON.stringify(merged));
    } catch (err) {
      console.warn('Sync.pullBadges error:', err);
    }
  }

  /* ── Pull stats — take the higher value for each metric, union visit days ── */
  async function pullStats(uid) {
    try {
      const snap = await userRef(uid).collection('meta').doc('stats').get();
      if (!snap.exists) return;

      const remote = snap.data() || {};

      const localTime  = Store.getTimeSpent();
      const localDepth = Store.getMaxDepth();
      const localDays  = Store.getVisitDays();

      if ((remote.timeSpentMs || 0) > localTime) {
        localStorage.setItem('rh_time_spent_ms', String(remote.timeSpentMs));
      }
      if ((remote.maxDepth || 0) > localDepth) {
        localStorage.setItem('rh_max_depth', String(remote.maxDepth));
      }
      if (Array.isArray(remote.visitDays)) {
        const mergedDays = [...new Set([...remote.visitDays, ...localDays])].slice(0, 400);
        localStorage.setItem('rh_visit_days', JSON.stringify(mergedDays));
      }
    } catch (err) {
      console.warn('Sync.pullStats error:', err);
    }
  }

  /* ── Pull preferences — settings follow the user to a new device ── */
  async function pullPreferences(uid) {
    try {
      const snap = await userRef(uid).collection('meta').doc('preferences').get();
      if (!snap.exists) return;

      const prefs = snap.data() || {};

      if (typeof prefs.darkMode === 'boolean') {
        localStorage.setItem('rh_dark', prefs.darkMode ? '1' : '0');
      }
      if (typeof prefs.fontSize === 'number') {
        localStorage.setItem('rh_fontsize', String(prefs.fontSize));
      }
      if (Array.isArray(prefs.categories) && prefs.categories.length > 0) {
        Store.setCategories(prefs.categories);
      }
      /* Re-apply visual settings immediately so a fresh sign-in on a
         new device reflects the synced theme/font without a reload */
      if (typeof Settings !== 'undefined') Settings.applyStored?.();
    } catch (err) {
      console.warn('Sync.pullPreferences error:', err);
    }
  }

  /* ── Push local localStorage → Firestore (batch) ── */
  async function pushLocalToFirestore(uid) {
    const firestore = db();
    if (!firestore || !uid) return;

    try {
      const batch = firestore.batch();
      let ops = 0;

      for (const col of ['saves', 'likes', 'history']) {
        const items = Store[`get${capitalise(col)}`]?.() || [];
        for (const item of items.slice(0, 200)) {
          const ref = userRef(uid).collection(col).doc(sanitiseId(item.title));
          batch.set(ref, { ...item, uid }, { merge: true });
          ops++;
          if (ops >= 490) break; /* Firestore batch limit is 500 */
        }
        if (ops >= 490) break;
      }

      if (ops > 0) await batch.commit();

      /* Push preferences */
      await userRef(uid).set({
        uid,
        ...Auth.userRecord(),
        preferences: {
          categories: Store.getCategories(),
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    } catch (err) {
      console.warn('Sync.push error:', err);
    }
  }

  /* ── Write a single item to Firestore (called after every save/like) ── */
  async function write(collection, item) {
    const uid = Auth.uid();
    if (!uid) return;
    try {
      await userRef(uid).collection(collection)
        .doc(sanitiseId(item.title))
        .set({ ...item, uid }, { merge: true });
    } catch (err) {
      console.warn(`Sync.write(${collection}) error:`, err);
    }
  }

  /* ── Delete a single item from Firestore ── */
  async function remove(collection, title) {
    const uid = Auth.uid();
    if (!uid) return;
    try {
      await userRef(uid).collection(collection)
        .doc(sanitiseId(title)).delete();
    } catch (err) {
      console.warn(`Sync.remove(${collection}) error:`, err);
    }
  }

  /* ── Write badges — called once when a new badge is earned ── */
  async function writeBadges() {
    const uid = Auth.uid();
    if (!uid || !db()) return;
    try {
      const earned = JSON.parse(localStorage.getItem('rh_badges') || '[]');
      await userRef(uid).collection('meta').doc('badges').set({
        earned,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.warn('Sync.writeBadges error:', err);
    }
  }

  /* ── Write stats — called once per session (on hide/unload), not on
        every increment, since these change frequently and a session-end
        flush is accurate enough for this kind of metric ── */
  async function writeStats() {
    const uid = Auth.uid();
    if (!uid || !db()) return;
    try {
      await userRef(uid).collection('meta').doc('stats').set({
        timeSpentMs: Store.getTimeSpent(),
        maxDepth:    Store.getMaxDepth(),
        visitDays:   Store.getVisitDays().slice(0, 400),
        totalRead:   Store.getHistory().length,
        totalSaved:  Store.getSaves().length,
        totalLiked:  Store.getLikes().length,
        lastSeenAt:  firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.warn('Sync.writeStats error:', err);
    }
  }

  /* ── Write preferences — called when a setting changes ── */
  async function writePreferences() {
    const uid = Auth.uid();
    if (!uid || !db()) return;
    try {
      await userRef(uid).collection('meta').doc('preferences').set({
        darkMode:   localStorage.getItem('rh_dark') === '1',
        fontSize:   parseInt(localStorage.getItem('rh_fontsize') || '2', 10),
        categories: Store.getCategories(),
        updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.warn('Sync.writePreferences error:', err);
    }
  }

  /* ── Leaderboard: write public score ── */
  async function updateLeaderboard() {
    const uid = Auth.uid();
    if (!uid || !db()) return;
    try {
      const streak = Badges.currentStreak();
      const badges = Badges.earned().length;
      await db().collection('leaderboard').doc(uid).set({
        uid,
        displayName: Auth.userRecord()?.displayName || 'Anonymous',
        photoURL:    Auth.userRecord()?.photoURL    || '',
        isGuest:     Auth.isAnonymous(),
        read:        Store.getHistory().length,
        saved:       Store.getSaves().length,
        liked:       Store.getLikes().length,
        streak,
        badges,
        score:       Store.getHistory().length + (streak * 3) + (badges * 5),
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.warn('Sync.updateLeaderboard error:', err);
    }
  }

  /* ── Fetch leaderboard — waits for auth to resolve first,
        since Firestore read rules require request.auth != null ── */
  async function fetchLeaderboard(metric = 'read', limit = 20) {
    if (!db()) return [];

    /* Wait for auth to settle before querying — the leaderboard
       read rule requires request.auth != null, so an unauthenticated
       read will always fail with permission-denied */
    try {
      await Auth.whenResolved();
    } catch {}

    /* If still not authenticated after resolution (should not happen
       in normal flow), sign in anonymously so the read can proceed */
    if (!firebase.auth().currentUser) {
      try {
        await firebase.auth().signInAnonymously();
      } catch (err) {
        console.warn('Sync.fetchLeaderboard: anonymous sign-in failed:', err?.code);
        return [];
      }
    }

    try {
      const snap = await db().collection('leaderboard')
        .orderBy(metric, 'desc').limit(limit).get();
      return snap.docs.map((d, i) => ({ rank: i + 1, ...d.data() }));
    } catch (err) {
      console.warn('Sync.fetchLeaderboard error:', err);
      return [];
    }
  }

  /* ── Helpers ── */
  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function sanitiseId(title) {
    /* Firestore doc IDs can't contain / */
    return (title || 'unknown').replace(/\//g, '_').slice(0, 500);
  }

  function mergeByTitle(remote, local) {
    const map = new Map();
    [...remote, ...local].forEach(item => {
      const existing = map.get(item.title);
      if (!existing || (item.savedAt || 0) > (existing.savedAt || 0)) {
        map.set(item.title, item);
      }
    });
    return [...map.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  async function deleteLeaderboardEntry() {
    const uid = Auth.uid();
    if (!uid || !db()) return false;
    try {
      await db().collection('leaderboard').doc(uid).delete();
      return true;
    } catch (err) {
      console.warn('Sync.deleteLeaderboardEntry error:', err?.code, err?.message);
      return false;
    }
  }

  return {
    onSignIn, write, remove,
    writeBadges, writeStats, writePreferences,
    updateLeaderboard, fetchLeaderboard, deleteLeaderboardEntry,
  };

})();
