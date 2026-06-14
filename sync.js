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

      /* Push any local items not yet in Firestore (gap fill) */
      await pushLocalToFirestore(uid);

    } catch (err) {
      console.warn('Sync.onSignIn error:', err);
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

  /* ── Fetch leaderboard ── */
  async function fetchLeaderboard(metric = 'read', limit = 20) {
    if (!db()) return [];
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

  return { onSignIn, write, remove, updateLeaderboard, fetchLeaderboard };

})();
