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

    /* Surface any redirect sign-in errors (e.g. unauthorised domain) */
    firebase.auth().getRedirectResult().catch(err => {
      console.error('Redirect sign-in error:', err?.code, err?.message);
    });

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

  /* ── Sign in with Google — redirect-based (avoids popup/COOP issues) ── */
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithRedirect(provider);
      /* Page navigates away here — execution stops until redirect back */
    } catch (err) {
      console.error('Sign-in redirect error:', err);
      throw err;
    }
  }

  /* ── Check for a pending redirect result on boot ──
        Must be called once after init(); resolves once Firebase
        has processed any pending redirect sign-in. ── */
  async function checkRedirectResult() {
    if (typeof firebase === 'undefined') return null;
    try {
      const result = await firebase.auth().getRedirectResult();
      return result?.user || null;
    } catch (err) {
      console.error('Redirect result error:', err?.code, err?.message);
      return null;
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

  return { init, signInWithGoogle, signOut, onChange, currentUser, isSignedIn, uid, userRecord, whenResolved, checkRedirectResult };

})();
