/* settings.js — settings pane, dark mode, font size,
   category editing, stats, onboarding trigger         */

const Settings = (() => {

  const FONT_STEPS  = [85, 92, 100, 108, 116, 125]; /* % of base */
  const FONT_KEY    = 'rh_fontsize';
  const DARK_KEY    = 'rh_dark';
  const MODE_KEY    = 'rh_default_mode';

  let fontIdx = 2; /* default: 100% */

  /* ── Read saved prefs on load ── */
  function applyStored() {
    /* Version number — single source of truth from version.js */
    const ver = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '';
    const splashV   = document.getElementById('splash-version');
    const settingsV = document.getElementById('settings-version');
    if (splashV)   splashV.textContent   = ver;
    if (settingsV) settingsV.textContent = ver;

    try {
      const fi = localStorage.getItem(FONT_KEY);
      if (fi !== null) fontIdx = parseInt(fi, 10);

      const dark = localStorage.getItem(DARK_KEY);
      if (dark === '1') {
        document.body.classList.add('dark');
        const toggle = document.getElementById('toggle-dark');
        if (toggle) toggle.checked = true;
        document.getElementById('theme-meta')?.setAttribute('content', '#111110');
      }

      /* Startup stats toggle — settings shows "show" (inverted from
         the stored "hide" flag) */
      const startupToggle = document.getElementById('toggle-startup-stats');
      if (startupToggle && typeof StartupStats !== 'undefined') {
        startupToggle.checked = !StartupStats.isHidden();
      }

      /* Default mode selector */
      const modeSelect = document.getElementById('select-default-mode');
      if (modeSelect) {
        modeSelect.value = localStorage.getItem(MODE_KEY) || 'home';
      }
    } catch {}
    applyFontSize();
  }

  /* Expose default mode for app.js boot to read */
  function getDefaultMode() {
    try { return localStorage.getItem(MODE_KEY) || 'home'; } catch { return 'home'; }
  }

  function applyFontSize() {
    const pct = FONT_STEPS[fontIdx] ?? 100;
    document.documentElement.style.setProperty('--font-scale', pct / 100);
    const valEl = document.getElementById('font-size-val');
    if (valEl) valEl.textContent = `${pct}%`;
    try { localStorage.setItem(FONT_KEY, fontIdx); } catch {}
  }

  /* Fire-and-forget preferences sync — only when signed in */
  function syncPreferencesIfSignedIn() {
    if (typeof Sync !== 'undefined' && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
      Sync.writePreferences();
    }
  }

  /* ── Init: wire up all settings controls ── */
  function init() {
    applyStored();

    const pane        = document.getElementById('settings');
    const closeBtn    = document.getElementById('settings-close');
    const darkToggle  = document.getElementById('toggle-dark');
    const fontControl = document.getElementById('font-size-control');
    const saveCatsBtn = document.getElementById('settings-save-cats');
    const resetBtn    = document.getElementById('settings-reset');
    const showOBBtn   = document.getElementById('settings-show-onboarding');
    const catGrid     = document.getElementById('settings-cat-grid');

    /* Gear icon → settings pane */
    document.getElementById('btn-settings')
      ?.addEventListener('click', () => openSettings());

    /* Profile icon → profile overlay */
    document.getElementById('btn-profile')
      ?.addEventListener('click', () => {
        if (typeof Profile !== 'undefined') Profile.open();
      });

    /* Close settings */
    closeBtn?.addEventListener('click', () => closeSettings());

    /* Dark mode toggle */
    darkToggle?.addEventListener('change', () => {
      const on = darkToggle.checked;
      document.body.classList.toggle('dark', on);
      document.getElementById('theme-meta')
        ?.setAttribute('content', on ? '#111110' : '#f7f5f0');
      try { localStorage.setItem(DARK_KEY, on ? '1' : '0'); } catch {}
      syncPreferencesIfSignedIn();
    });

    /* Startup stats toggle ("show" in settings = inverted "hide" flag) */
    const startupStatsToggle = document.getElementById('toggle-startup-stats');
    startupStatsToggle?.addEventListener('change', () => {
      const show = startupStatsToggle.checked;
      if (typeof StartupStats !== 'undefined') StartupStats.setHidden(!show);
    });

    /* Default launch mode */
    const modeSelect = document.getElementById('select-default-mode');
    modeSelect?.addEventListener('change', () => {
      try { localStorage.setItem(MODE_KEY, modeSelect.value); } catch {}
    });

    /* Font size +/- */
    fontControl?.addEventListener('click', e => {
      const btn = e.target.closest('[data-delta]');
      if (!btn) return;
      const delta = parseInt(btn.dataset.delta, 10);
      fontIdx = Math.max(0, Math.min(FONT_STEPS.length - 1, fontIdx + delta));
      applyFontSize();
      syncPreferencesIfSignedIn();
    });

    /* Category save */
    saveCatsBtn?.addEventListener('click', () => {
      const selected = [...catGrid.querySelectorAll('.cat-pill--selected')]
        .map(p => p.dataset.id);
      Store.setCategories(selected);
      API.reset().catch(() => {});
      closeSettings();
      showToast('Feed updated');
      syncPreferencesIfSignedIn();
    });

    /* Reset all data */
    resetBtn?.addEventListener('click', () => {
      if (!confirm('Clear all saved articles, likes, and history?')) return;
      ['rh_saves','rh_likes','rh_dislikes','rh_history',
       'rh_categories','rh_onboarded', FONT_KEY, DARK_KEY]
        .forEach(k => { try { localStorage.removeItem(k); } catch {} });
      location.reload();
    });

    /* Show onboarding again */
    showOBBtn?.addEventListener('click', () => {
      closeSettings();
      Onboarding.show();
    });
  }

  function openSettings() {
    const pane    = document.getElementById('settings');
    const catGrid = document.getElementById('settings-cat-grid');

    /* Render category pills with current selection */
    const selected = Store.getCategories();
    Categories.renderPills(catGrid, selected, () => {});

    /* Update stats */
    document.getElementById('stat-read').textContent  = Store.getHistory().length;
    document.getElementById('stat-saved').textContent = Store.getSaves().length;
    document.getElementById('stat-liked').textContent = Store.getLikes().length;

    /* Sync dark toggle */
    const toggle = document.getElementById('toggle-dark');
    if (toggle) toggle.checked = document.body.classList.contains('dark');

    pane?.classList.replace('overlay--hidden', 'overlay--visible');
  }

  function closeSettings() {
    document.getElementById('settings')
      ?.classList.replace('overlay--visible', 'overlay--hidden');
  }

  /* Toast — thin wrapper, real impl in app.js */
  function showToast(msg) {
    let t = document.querySelector('.save-flash');
    if (!t) { t = document.createElement('div'); t.className = 'save-flash'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('save-flash--visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('save-flash--visible'), 1800);
  }

  return { init, openSettings, closeSettings, applyStored, getDefaultMode };

})();

/* ── Onboarding controller ── */
const Onboarding = (() => {

  let currentPage = 0;
  const TOTAL_PAGES = 2;

  function show() {
    const el = document.getElementById('onboarding');
    if (!el) return;

    /* Reset to page 1 every time it's shown */
    currentPage = 0;
    goToPage(0);

    el.classList.add('onboarding--visible');

    document.getElementById('onboarding-next')
      ?.addEventListener('click', nextPage);
    document.getElementById('onboarding-dismiss')
      ?.addEventListener('click', dismiss);
  }

  function nextPage() {
    if (currentPage < TOTAL_PAGES - 1) {
      currentPage++;
      goToPage(currentPage);
    }
  }

  function goToPage(page) {
    const track    = document.getElementById('onboarding-track');
    const dots     = document.querySelectorAll('.onboarding__dot');
    const nextBtn  = document.getElementById('onboarding-next');
    const dismissBtn = document.getElementById('onboarding-dismiss');

    /* Slide track */
    if (track) {
      track.classList.toggle('onboarding__track--page1', page === 0);
      track.classList.toggle('onboarding__track--page2', page === 1);
    }

    /* Update dots */
    dots.forEach((dot, i) => {
      dot.classList.toggle('onboarding__dot--active', i === page);
    });

    /* On last page: hide Next, show Dismiss */
    const isLast = page === TOTAL_PAGES - 1;
    if (nextBtn)    nextBtn.style.display    = isLast ? 'none' : '';
    if (dismissBtn) dismissBtn.style.display = isLast ? ''     : 'none';
  }

  function dismiss() {
    const el = document.getElementById('onboarding');
    el?.classList.remove('onboarding--visible');
    /* Remove listeners to avoid duplicates if shown again */
    document.getElementById('onboarding-next')
      ?.removeEventListener('click', nextPage);
    document.getElementById('onboarding-dismiss')
      ?.removeEventListener('click', dismiss);
  }

  function showIfFirst() {
    if (!Store.isOnboarded()) show();
  }

  return { show, dismiss, showIfFirst };

})();
