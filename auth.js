/* auth.js — Firebase Auth: Google Sign-In, auth state, sign-out */

const Auth = (() => {

  let _user     = null;   /* current Firebase user or null */
  let _listeners = [];    /* callbacks notified on auth change */

  /* ── Init — called once on app boot ── */
  function init() {
    if (typeof firebase === 'undefined') {
      console.warn('Auth: Firebase SDK not loaded');
      return;
    }

    firebase.auth().onAuthStateChanged(user => {
      _user = user;
      _listeners.forEach(fn => fn(user));
    });
  }

  /* ── Sign in with Google popup ── */
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
      /* onAuthStateChanged fires automatically */
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') return;
      console.error('Sign-in error:', err);
      throw err;
    }
  }

  /* ── Sign out ── */
  async function signOut() {
    await firebase.auth().signOut();
    /* Clear local data — revert to guest */
    ['rh_saves','rh_likes','rh_dislikes','rh_history'].forEach(k => {
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
    return {
      displayName: _user.displayName || '',
      email:       _user.email || '',
      photoURL:    _user.photoURL || '',
      uid:         _user.uid,
    };
  }

  return { init, signInWithGoogle, signOut, onChange, currentUser, isSignedIn, uid, userRecord };

})();
