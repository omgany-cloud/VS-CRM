// ============================================================
//  modal-a11y.js — Escape-to-close + focus management, applied
//  generically across all of the app's modal systems.
//
//  Three independent, hand-rolled modal systems exist in this app:
//   1. A class-toggled #modalOverlay/.modal pair (js/app.js's
//      openModal(name)/closeModal()), shared by many "new X" forms
//      (fund, user, role, ...).
//   2. ~14 individual *Overlay + modal-* element pairs, each with its
//      own dedicated open*/close* function (workflow, IC, deal detail,
//      portfolio detail, LP detail, capital calls, engagements, ...).
//   3. The single self-backdropped #modal-ob-new, reused as the body
//      for every onboarding "new X" form (new client, new engagement,
//      new conflict approval, ...).
//
//  None of the three ever handled Escape, and none moved focus on
//  open/close. Rather than merge three systems into one, this adds
//  both behaviors on top of the existing code without touching any
//  individual modal's own open/close logic:
//   - Escape closes the topmost visible modal by clicking its own
//     overlay element — every one of the overlays below already closes
//     on a backdrop click (that's how "click outside to close" already
//     works for mouse users), so this reuses that instead of needing to
//     know each modal's specific close function name.
//   - A MutationObserver watches all the same overlay elements for
//     visibility changes (style/class) and reacts generically: when a
//     new topmost overlay appears, remember whatever had focus and
//     move focus into the modal; when the topmost overlay disappears,
//     restore focus to what was remembered. This handles modals
//     stacking on top of each other (e.g. a "new conflict approval"
//     form opened from within a task detail modal) via a small stack,
//     not just a single open/closed flag.
// ============================================================

const MODAL_OVERLAY_IDS = [
  'modalOverlay', 'wfModalOverlay', 'icModalOverlay', 'obClientOverlay',
  'obTaskOverlay', 'modal-ob-new', 'engagementOverlay', 'restrictedAddOverlay',
  'vaultPreviewOverlay', 'lpReportOverlay', 'lpDetailOverlay',
  'capitalStatementOverlay', 'lpNewOverlay', 'ccDetailOverlay', 'ccNewOverlay',
  'dealDetailOverlay', 'portDetailOverlay',
];

function _modalOverlayIsVisible(el) {
  return !!el && getComputedStyle(el).display !== 'none';
}

function _topmostModalOverlay() {
  const visible = MODAL_OVERLAY_IDS
    .map(id => document.getElementById(id))
    .filter(_modalOverlayIsVisible);
  if (!visible.length) return null;
  return visible.reduce((top, el) => {
    const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    const topZ = parseInt(getComputedStyle(top).zIndex, 10) || 0;
    return z >= topZ ? el : top;
  });
}

// The overlay itself is just the backdrop — find the actual content box
// to move focus into. System 2's overlay+modal pairs are always adjacent
// siblings in the HTML (overlay div immediately followed by the modal
// div); System 1 (#modalOverlay) is shared by many .modal elements, so
// the one currently marked .active is the target; System 3
// (#modal-ob-new) is self-backdropped, so it's already the right target.
function _modalBoxFor(overlayEl) {
  if (overlayEl.id === 'modalOverlay') return document.querySelector('.modal.active');
  if (overlayEl.id === 'modal-ob-new') return overlayEl;
  return overlayEl.nextElementSibling;
}

let _modalFocusStack = []; // [{ overlay, returnEl }], topmost last

function _reconcileModalFocusStack() {
  // Pop entries whose overlay is no longer visible (closed), restoring
  // focus for each as we go — topmost (most recently opened) first, so
  // closing a stacked modal returns focus to the one still open beneath
  // it, not all the way back past it.
  while (_modalFocusStack.length && !_modalOverlayIsVisible(_modalFocusStack[_modalFocusStack.length - 1].overlay)) {
    const entry = _modalFocusStack.pop();
    if (entry.returnEl && document.body.contains(entry.returnEl) && typeof entry.returnEl.focus === 'function') {
      entry.returnEl.focus({ preventScroll: true });
    }
  }

  // Push a new entry if a new topmost overlay just appeared — either the
  // first modal opening, or a second one stacking on top of an already
  // -open one.
  const topmostNow = _topmostModalOverlay();
  const currentTop = _modalFocusStack.length ? _modalFocusStack[_modalFocusStack.length - 1].overlay : null;
  if (topmostNow && topmostNow !== currentTop) {
    _modalFocusStack.push({ overlay: topmostNow, returnEl: document.activeElement });
    requestAnimationFrame(() => {
      const box = _modalBoxFor(topmostNow);
      if (!box) return;
      if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
      box.focus({ preventScroll: true });
    });
  }
}

if (typeof document !== 'undefined') {
  const observer = new MutationObserver(_reconcileModalFocusStack);
  MODAL_OVERLAY_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = _topmostModalOverlay();
    if (overlay) overlay.click();
  });
}
