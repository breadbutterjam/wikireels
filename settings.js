/* settings.js — settings pane, dark mode, font size,
   category editing, stats, onboarding trigger         */

const Settings = (() => {

  const FONT_STEPS  = [85, 92, 100, 108, 116, 125]; /* % of base */
  const FONT_KEY    = 'rh_fontsize';
  const DARK_KEY    = 'rh_dark';

  let fontIdx = 2; /* default: 100% */

  /* ── Read saved prefs on load ── */
  function applyStored() {
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
    } catch {}
    applyFontSize();
  }

  function applyFontSize() {
    const pct = FONT_STEPS[fontIdx] ?? 100;
    document.documentElement.style.setProperty('--font-scale', pct / 100);
    const valEl = document.getElementById('font-size-val');
    if (valEl) valEl.textContent = `${pct}%`;
    try { localStorage.setItem(FONT_KEY, fontIdx); } catch {}
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
    });

    /* Font size +/- */
    fontControl?.addEventListener('click', e => {
      const btn = e.target.closest('[data-delta]');
      if (!btn) return;
      const delta = parseInt(btn.dataset.delta, 10);
      fontIdx = Math.max(0, Math.min(FONT_STEPS.length - 1, fontIdx + delta));
      applyFontSize();
    });

    /* Category save */
    saveCatsBtn?.addEventListener('click', () => {
      const selected = [...catGrid.querySelectorAll('.cat-pill--selected')]
        .map(p => p.dataset.id);
      Store.setCategories(selected);
      API.reset().catch(() => {});
      closeSettings();
      showToast('Feed updated');
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

  return { init, openSettings, closeSettings, applyStored };

})();

/* ── Onboarding controller ── */
const Onboarding = (() => {

  function show() {
    const el = document.getElementById('onboarding');
    if (!el) return;
    el.classList.add('onboarding--visible');

    document.getElementById('onboarding-dismiss')
      ?.addEventListener('click', dismiss, { once: true });
  }

  function dismiss() {
    const el = document.getElementById('onboarding');
    el?.classList.remove('onboarding--visible');
  }

  function showIfFirst() {
    /* Show only on very first session (before onboarded flag is set) */
    if (!Store.isOnboarded()) show();
  }

  return { show, dismiss, showIfFirst };

})();
