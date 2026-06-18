/* notifications.js — local browser notifications (no backend).
   Used for in-the-moment events like badge unlocks. Permission
   is requested lazily, only when the first notification-worthy
   event happens — never on app load. */

const Notify = (() => {

  const PERMISSION_ASKED_KEY = 'rh_notif_asked';

  function isSupported() {
    return 'Notification' in window;
  }

  function permission() {
    return isSupported() ? Notification.permission : 'unsupported';
  }

  /* Ask once, lazily, the first time something worth notifying about
     happens. If the user denies, we don't ask again this session
     (and respect the browser's own re-ask cooldown). */
  async function ensurePermission() {
    if (!isSupported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    try {
      const result = await Notification.requestPermission();
      try { localStorage.setItem(PERMISSION_ASKED_KEY, '1'); } catch {}
      return result === 'granted';
    } catch {
      return false;
    }
  }

  /* Fire a local notification. Falls back silently if unsupported
     or permission isn't granted — the in-app toast already covers
     that case, so this is additive, not load-bearing. */
  async function fire(title, options = {}) {
    if (!isSupported()) return;

    const granted = await ensurePermission();
    if (!granted) return;

    /* Prefer firing through the service worker registration so the
       notification persists correctly on mobile (works even if the
       tab isn't focused), falling back to a direct Notification. */
    try {
      if (navigator.serviceWorker?.controller) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, {
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          ...options,
        });
      } else {
        new Notification(title, { icon: 'icons/icon-192.png', ...options });
      }
    } catch (err) {
      console.warn('Notify.fire error:', err);
    }
  }

  return { isSupported, permission, ensurePermission, fire };

})();
