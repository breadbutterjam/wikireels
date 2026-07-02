/* auth.js — Firebase Auth: Google Sign-In, anonymous (guest) sign-in,
   auth state management.

   GUEST IDENTITY CUSTOMISATION — edit these arrays freely:
   Adding/removing entries here changes the pool the random name
   and avatar are drawn from. Paths in GUEST_AVATARS are relative
   to the repo root, matching the img/ folder you'll populate.     */

/* ── Guest name adjectives — edit to taste ── */
const GUEST_ADJECTIVES = [
  'wandering', 'curious', 'wise', 'strong', 'gentle',
  'brave', 'quiet', 'swift', 'bright', 'daring',
  'mighty', 'calm', 'jolly', 'keen', 'bold',
  'cute', 'sleepy', 'hungry', 'fuzzy', 'noble',
];

/* ── Guest animals — name must match the avatar filename exactly.
      Drop PNG files in img/avatars/ with these exact filenames.
      Adding a new animal: add an entry here, put the file in img/avatars/. */
const GUEST_ANIMALS = [
  'elephant',
  'hippo',
  'rhinoceros',
  'ant',
  'giraffe',
  'penguin',
  'panda',
  'koala',
  'capybara',
  'wombat',
  'platypus',
  'otter',
  'hedgehog',
  'sloth',
  'meerkat',
];

/* ── Guest avatar pool — auto-derived from GUEST_ANIMALS.
      All avatars live in img/avatars/ and are named {animal}.png.
      Change the base path or extension here if you move/rename files. */
const AVATAR_BASE = 'img/avatars/';
const GUEST_AVATARS = GUEST_ANIMALS.map(a => `${AVATAR_BASE}${a}.png`);

const Auth = (() => {

  let _user      = undefined;  /* undefined = not yet resolved; null = resolved, no user */
  let _listeners = [];
  let _resolved  = false;
  let _resolveFns = [];

  /* ── Promise resolving once Firebase reports first auth state ── */
  function whenResolved() {
    return new Promise(resolve => {
      if (_resolved) resolve(_user);
      else _resolveFns.push(resolve);
    });
  }

  /* ── Init ── */
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

  /* ── Google sign-in (popup) ── */
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') return;
      if (err.code === 'auth/cancelled-popup-request') return;
      console.error('Sign-in error:', err?.code, err?.message);
      throw err;
    }
  }

  /* ── Anonymous sign-in for guests ──
        Called automatically for guests on app boot so they're
        included in the leaderboard from day one. Firebase persists
        the anonymous credential in IndexedDB, so the same guest
        keeps their uid across page reloads — they only get a fresh
        one if they clear site data or switch browsers. ── */
  async function signInAnonymously() {
    try {
      await firebase.auth().signInAnonymously();
      /* onAuthStateChanged fires automatically */
    } catch (err) {
      console.error('Anonymous sign-in error:', err?.code, err?.message);
    }
  }

  /* ── Generate a stable random guest identity ──
        Name: "wandering-elephant-2131"
        Avatar: a path from GUEST_AVATARS, matched by index so
        the same animal always pairs with the same adjective/number
        for a given browser session.

        Both are persisted to localStorage so a returning guest
        always has the same name and avatar. ── */
  function _pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function generateGuestIdentity() {
    const NAME_KEY   = 'rh_guest_name';
    const AVATAR_KEY = 'rh_guest_avatar';
    /* Display overrides — separate from the identity key so the
       underlying uid/leaderboard-id stays stable */
    const DISPLAY_NAME_KEY   = 'rh_guest_display_name';
    const DISPLAY_AVATAR_KEY = 'rh_guest_display_avatar';

    let name, avatar;

    try {
      name   = localStorage.getItem(NAME_KEY);
      avatar = localStorage.getItem(AVATAR_KEY);
    } catch {}

    if (!name) {
      const adj    = _pickRandom(GUEST_ADJECTIVES);
      const animal = _pickRandom(GUEST_ANIMALS);
      const num    = String(Math.floor(Math.random() * 9000) + 1000);
      name = `${adj}-${animal}-${num}`;
      const animalIdx = GUEST_ANIMALS.indexOf(animal);
      avatar = GUEST_AVATARS[animalIdx] ?? GUEST_AVATARS[0];
      try {
        localStorage.setItem(NAME_KEY,   name);
        localStorage.setItem(AVATAR_KEY, avatar);
      } catch {}
    }

    if (!avatar) {
      const parts = name.split('-');
      const animal = parts[1] || '';
      const idx = GUEST_ANIMALS.indexOf(animal);
      avatar = idx >= 0 ? GUEST_AVATARS[idx] : GUEST_AVATARS[0];
      try { localStorage.setItem(AVATAR_KEY, avatar); } catch {}
    }

    /* Apply display overrides if the user has customised their look */
    let displayName   = name;
    let displayAvatar = avatar;
    try {
      displayName   = localStorage.getItem(DISPLAY_NAME_KEY)   || name;
      displayAvatar = localStorage.getItem(DISPLAY_AVATAR_KEY) || avatar;
    } catch {}

    return { name, avatar, displayName, displayAvatar };
  }

  /* ── Set guest display identity (chosen by user in the picker) ──
        Updates the display keys without touching the stable identity. */
  function setGuestDisplayIdentity(animal) {
    const idx = GUEST_ANIMALS.indexOf(animal);
    if (idx < 0) return;
    const avatar = GUEST_AVATARS[idx];
    /* Construct a display name: pick a random adjective + chosen animal + stable number
       (extract number from the original stored name so it stays consistent) */
    let num = '0000';
    try {
      const stored = localStorage.getItem('rh_guest_name') || '';
      const parts  = stored.split('-');
      num = parts[parts.length - 1] || '0000';
    } catch {}
    const adj  = _pickRandom(GUEST_ADJECTIVES);
    const displayName = `${adj}-${animal}-${num}`;
    try {
      localStorage.setItem('rh_guest_display_name',   displayName);
      localStorage.setItem('rh_guest_display_avatar', avatar);
    } catch {}
    return { displayName, displayAvatar: avatar };
  }

  /* ── Clear guest display overrides (revert to original random identity) ── */
  function clearGuestDisplayIdentity() {
    try {
      localStorage.removeItem('rh_guest_display_name');
      localStorage.removeItem('rh_guest_display_avatar');
    } catch {}
  }

  /* ── Sign out ── */
  async function signOut() {
    await firebase.auth().signOut();
    /* Clear local data. Guest name/avatar are intentionally kept —
       so if they sign back in as guest they keep the same identity. */
    [
      'rh_saves', 'rh_likes', 'rh_dislikes', 'rh_history',
    ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
  }

  /* ── Auth state listener ── */
  function onChange(fn) {
    _listeners.push(fn);
    if (_user !== undefined) {
      fn(_user);
    }
  }

  /* ── Getters ── */
  function currentUser() { return _user; }
  function isSignedIn()  { return !!_user; }
  function isAnonymous() { return !!_user?.isAnonymous; }
  function isGoogle()    { return !!_user && !_user.isAnonymous; }
  function uid()         { return _user?.uid || null; }

  /* ── User record for Firestore ──
        Provides consistent shape whether Google or guest. ── */
  function userRecord() {
    if (!_user) return null;

    if (_user.isAnonymous) {
      const { displayName, displayAvatar } = generateGuestIdentity();
      return {
        displayName: displayName,
        email:       '',
        photoURL:    displayAvatar,
        uid:         _user.uid,
        isGuest:     true,
      };
    }

    return {
      displayName: _user.displayName || '',
      email:       _user.email       || '',
      photoURL:    _user.photoURL    || '',
      uid:         _user.uid,
      isGuest:     false,
    };
  }

  return {
    init,
    signInWithGoogle,
    signInAnonymously,
    signOut,
    onChange,
    whenResolved,
    currentUser,
    isSignedIn,
    isAnonymous,
    isGoogle,
    uid,
    userRecord,
    generateGuestIdentity,
    setGuestDisplayIdentity,
    clearGuestDisplayIdentity,
    GUEST_ANIMALS,
    GUEST_AVATARS,
    AVATAR_BASE,
  };

})();
