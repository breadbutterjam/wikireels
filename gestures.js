/* gestures.js — touch handling for the feed
   Handles: swipe up/down (card nav), swipe left/right (save/gallery),
   double-tap (like), with drag-follow visual feedback. */

const Gestures = (() => {

  const SWIPE_THRESHOLD_Y  = 55;   /* px to commit vertical swipe   */
  const SWIPE_THRESHOLD_X  = 70;   /* px to commit horizontal swipe  */
  const DOUBLE_TAP_MS      = 280;  /* max ms between taps            */
  const TAP_MOVE_TOLERANCE = 12;   /* px — cancel tap if moved more  */
  const DRAG_RESISTANCE    = 0.38; /* rubber-band feel during drag   */

  let handlers = {};

  function on(event, fn) { handlers[event] = fn; }
  function emit(event, data) { if (handlers[event]) handlers[event](data); }

  function init(el) {
    let startX = 0, startY = 0;
    let lastTap = 0;
    let tracking = false;
    let axis = null;  /* 'x' | 'y' | null — locked once determined */
    let dragTarget = null;

    /* ── touchstart ── */
    el.addEventListener('touchstart', e => {
      const t = e.touches[0];
      startX   = t.clientX;
      startY   = t.clientY;
      tracking = true;
      axis     = null;
      dragTarget = el;
    }, { passive: true });

    /* ── touchmove — live drag feedback ── */
    el.addEventListener('touchmove', e => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);

      /* Lock axis on first significant movement */
      if (!axis) {
        if (absDx > 8 || absDy > 8) axis = absDx > absDy ? 'x' : 'y';
        return;
      }

      if (axis === 'y') {
        /* Drag card up/down with resistance */
        const drag = dy * DRAG_RESISTANCE;
        emit('drag', { dy: drag });
      }
      /* Horizontal: no drag preview for now — snaps on release */
    }, { passive: true });

    /* ── touchend ── */
    el.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;

      const t    = e.changedTouches[0];
      const dx   = t.clientX - startX;
      const dy   = t.clientY - startY;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      const now  = Date.now();

      /* Reset any drag visual */
      emit('dragEnd', {});

      /* Pure tap (barely moved) */
      if (absDx < TAP_MOVE_TOLERANCE && absDy < TAP_MOVE_TOLERANCE) {
        if (now - lastTap < DOUBLE_TAP_MS) {
          emit('doubleTap', { x: t.clientX, y: t.clientY });
          lastTap = 0;
        } else {
          lastTap = now;
        }
        return;
      }

      /* Directional swipe — dominant axis wins */
      if (axis === 'y' && absDy >= SWIPE_THRESHOLD_Y) {
        emit(dy < 0 ? 'swipeUp' : 'swipeDown', {});
      } else if (axis === 'x' && absDx >= SWIPE_THRESHOLD_X) {
        emit(dx < 0 ? 'swipeLeft' : 'swipeRight', {});
      } else {
        /* Didn't hit threshold — snap back */
        emit('dragCancel', {});
      }
    }, { passive: true });

    /* Finger lifted mid-gesture */
    el.addEventListener('touchcancel', () => {
      tracking = false;
      emit('dragCancel', {});
    }, { passive: true });
  }

  return { init, on };

})();
