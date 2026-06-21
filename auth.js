/* auth.js — Firebase Auth: Google Sign-In, auth state, sign-out */

const Auth = (() => {

  let _user        = null;
  let _listeners   = [];
  let _resolved    = false;
  let _resolveFns  = [];

  /* Promise that resolves once Firebase has reported initial auth state */
  function whenResolved() {
    return new Promise(resolve => {
      if (_resolved) resolve(_user);
      else _resolveFns.push(resolve);
    });
  }

  /* ── Init — called once on app boot ── */
  function init() {
    if (typeof firebase === 'undefined') {
      console.warn('Auth: Firebase SDK not loaded');
      _resolved = true;
      _resolveFns.forEach(fn => fn(null));
      _resolveFns = [];
      return;
    }

    firebase.auth().onAuthStateChanged(user => {
      _user = user;
      _listeners.forEach(fn => fn(user));

      if (!_resolved) {
        _resolved = true;
        _resolveFns.forEach(fn => fn(user));
        _resolveFns = [];
      }
    });
  }

  /* ── Sign in with Google — popup-based.
        Requires the Cross-Origin-Opener-Policy meta tag in index.html
        (same-origin-allow-popups) or the popup's result message gets
        silently blocked by Chrome's default COOP policy. ── */
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
      /* onAuthStateChanged fires automatically on success */
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') return;
      if (err.code === 'auth/cancelled-popup-request') return;
      console.error('Sign-in error:', err?.code, err?.message);
      throw err;
    }
  }

  /* ── Generate a friendly random guest name — "Curious Badger" style.
        Stable per-browser (stored once) so a returning guest keeps
        the same display name across sessions. ── */
  const ADJECTIVES = ['Curious', 'Quiet', 'Wandering', 'Bright', 'Restless', 'Keen', 'Idle', 'Drifting', 'Sharp', 'Gentle'];
  const NOUNS      = ['Badger', 'Reader', 'Owl', 'Fox', 'Sparrow', 'Wanderer', 'Scholar', 'Magpie', 'Rabbit', 'Heron'];

  function generateGuestName() {
    const key = 'rh_guest_name';
    try {
      const existing = localStorage.getItem(key);
      if (existing) return existing;
    } catch {}

    const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num  = Math.floor(Math.random() * 90) + 10; /* 10-99 */
    const name = `${adj} ${noun} ${num}`;

    try { localStorage.setItem(key, name); } catch {}
    return name;
  }

  /* ── Anonymous sign-in — opt-in only, used so a guest can appear on
        the public leaderboard with a generated name. Never called
        automatically; only when the user explicitly chooses to. ── */
  async function signInAnonymously() {
    try {
      const result = await firebase.auth().signInAnonymously();
      /* Tag this session as a guest so leaderboard cleanup can find it */
      try { localStorage.setItem('rh_is_guest_leaderboard', '1'); } catch {}
      return result?.user || null;
    } catch (err) {
      console.error('Anonymous sign-in error:', err?.code, err?.message);
      throw err;
    }
  }

  function isAnonymous() {
    return !!_user?.isAnonymous;
  }

  /* ── Sign out ── */
  async function signOut() {
    await firebase.auth().signOut();
    /* Clear local data — revert to guest */
    ['rh_saves','rh_likes','rh_dislikes','rh_history','rh_is_guest_leaderboard'].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
  }

  /* ── Register auth state listener ── */
  function onChange(fn) {
    _listeners.push(fn);
    /* Fire immediately with current state */
    if (_user !== undefined) fn(_user);
  }

  /* ── Getters ── */
  function currentUser()  { return _user; }
  function isSignedIn()   { return !!_user; }
  function uid()          { return _user?.uid || null; }

  /* ── Minimal user record for Firestore ── */
  function userRecord() {
    if (!_user) return null;
    if (_user.isAnonymous) {
      return {
        displayName: generateGuestName(),
        email:       '',
        photoURL:    '',
        uid:         _user.uid,
        isGuest:     true,
      };
    }
    return {
      displayName: _user.displayName || '',
      email:       _user.email || '',
      photoURL:    _user.photoURL || '',
      uid:         _user.uid,
      isGuest:     false,
    };
  }

  return {
    init, signInWithGoogle, signInAnonymously, signOut, onChange,
    currentUser, isSignedIn, isAnonymous, uid, userRecord, whenResolved,
  };

})();
