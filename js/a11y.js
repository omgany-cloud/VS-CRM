// ============================================================
//  a11y.js — generic accessibility sweep, applied across the whole
//  app the same way the read-only dimming and double-submit guards
//  in js/api-auth.js are: a MutationObserver reacts to the app's
//  innerHTML-template rendering style instead of requiring every
//  render function (there are hundreds) to be edited individually.
//
//  Covers two concrete, mechanical gaps found across the app:
//   1. Icon-only controls (a <button> or [onclick] element whose only
//      content is an <i> icon) that have a `title` tooltip but no
//      `aria-label` — screen readers announce these as an unnamed
//      "button", not what the icon means. Mirrors `title` into
//      `aria-label` wherever that's true.
//   2. Non-native clickable elements (a <div>/<span>/<tr>/<td> with an
//      onclick handler, standing in for a button) that have no
//      `role="button"`, no `tabindex`, and no keyboard handler — a
//      keyboard-only user cannot Tab to them or activate them at all.
//      Gets `role="button"` + `tabindex="0"`; a single delegated
//      keydown listener makes Enter/Space activate them the same way
//      a real <button> already does natively.
//
//  Deliberately NOT touched here (much larger, separate undertakings,
//  not a mechanical sweep): associating every form <label> with its
//  input via for/id, table header scope, landmark regions. Flagging
//  rather than silently leaving the impression this is a complete pass.
// ============================================================

const A11Y_NATIVE_INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);

function _a11yLabelIconOnlyControls(root) {
  root.querySelectorAll('[title]:not([aria-label])').forEach(el => {
    if (!el.hasAttribute('onclick') && el.tagName !== 'BUTTON') return;
    // Icon-only: no visible text content at all (an <i> icon has none of
    // its own). Don't touch controls that already have real visible
    // text — a native accessible name from that text is already fine.
    if (el.textContent.trim() === '') {
      el.setAttribute('aria-label', el.getAttribute('title'));
    }
  });
}

function _a11yFixNonNativeClickables(root) {
  root.querySelectorAll('[onclick]').forEach(el => {
    if (A11Y_NATIVE_INTERACTIVE_TAGS.has(el.tagName)) return;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });
}

let _a11ySweepScheduled = false;
function _scheduleA11ySweep() {
  if (_a11ySweepScheduled) return;
  _a11ySweepScheduled = true;
  requestAnimationFrame(() => {
    _a11ySweepScheduled = false;
    _a11yLabelIconOnlyControls(document.body);
    _a11yFixNonNativeClickables(document.body);
  });
}

if (typeof document !== 'undefined') {
  new MutationObserver(_scheduleA11ySweep)
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'onclick'] });
  _scheduleA11ySweep();

  // Enter/Space activates any element the sweep above marked
  // role="button" — matches native <button> keyboard behavior, which
  // these elements don't get for free since they aren't real buttons.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[role="button"][tabindex]');
    if (!el || A11Y_NATIVE_INTERACTIVE_TAGS.has(el.tagName)) return;
    e.preventDefault();
    el.click();
  });
}
