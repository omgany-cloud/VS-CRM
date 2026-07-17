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
//   - The same moment focus moves into a modal, it also gets
//     role="dialog" + aria-modal="true" (+ aria-labelledby pointing at
//     its own heading, if one can be found) — none of the 17 modals had
//     any of this. Done here rather than by hand-editing 17 HTML blocks
//     because every modal-header block already follows the same
//     <h3>...</h3> convention, so it can be found generically.
//   - A beforeunload listener warns before closing the tab/window while
//     any modal is open (see below). Per-modal dirty-checking on close
//     itself lives in js/app.js's closeModal()/closeObNewModal().
// ============================================================

const MODAL_OVERLAY_IDS = [
  'modalOverlay', 'wfModalOverlay', 'icModalOverlay', 'obClientOverlay',
  'modal-ob-new', 'engagementOverlay', 'restrictedAddOverlay',
  'vaultPreviewOverlay', 'lpDetailOverlay',
  'capitalStatementOverlay', 'ccDetailOverlay', 'ccNewOverlay',
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

let _modalAriaIdCounter = 0;
function _applyDialogAria(box) {
  if (!box) return;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  if (box.hasAttribute('aria-label') || box.hasAttribute('aria-labelledby')) return;
  // Every modal-header block in this app follows the same <h3>...</h3>
  // title convention (confirmed across all 17); a handful build their
  // title dynamically via innerHTML instead of having one in the static
  // markup, so this re-checks on every open rather than assuming a
  // fixed id exists.
  const heading = box.querySelector('h1, h2, h3');
  if (!heading) return;
  if (!heading.id) heading.id = 'a11y-modal-title-' + (++_modalAriaIdCounter);
  box.setAttribute('aria-labelledby', heading.id);
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
      _applyDialogAria(box);
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

  // Warn on tab/window close while any modal is open — closing a modal
  // itself already warns if its fields were actually touched (closeModal()/
  // closeObNewModal(), js/app.js + js/onboarding.js), but a tab close skips
  // all of that, so this uses the simpler "a modal is open at all" signal
  // instead of re-deriving per-modal dirty state here.
  window.addEventListener('beforeunload', (e) => {
    if (!_topmostModalOverlay()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
