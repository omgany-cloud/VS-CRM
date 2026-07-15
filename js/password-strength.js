// Shared password-strength meter, attached to whichever password <input>
// wants one. A simple length + char-class heuristic (no external
// dependency) — not a rigorous entropy estimate, just a consistent visual
// signal across every password field in the app (registration,
// change-password, admin new/edit user), none of which had one before.

function passwordStrengthScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const PASSWORD_STRENGTH_LEVELS = [
  { label: 'Слишком короткий', color: '#ef4444' },
  { label: 'Слабый',           color: '#ef4444' },
  { label: 'Средний',          color: '#f97316' },
  { label: 'Хороший',          color: '#eab308' },
  { label: 'Надёжный',         color: '#22c55e' },
];

// Inserts a small meter bar right after `inputEl` and keeps it live via
// an 'input' listener. Safe to call again on the same input (e.g. a form
// rebuilt via innerHTML gets a fresh element each time anyway, but this
// also guards the case where the same live element is passed twice).
function attachPasswordStrengthMeter(inputEl) {
  if (!inputEl || !inputEl.parentElement) return;
  const prev = inputEl.parentElement.querySelector('.pw-strength-meter[data-for="' + inputEl.id + '"]');
  if (prev) prev.remove();

  const meter = document.createElement('div');
  meter.className = 'pw-strength-meter';
  meter.setAttribute('data-for', inputEl.id);
  meter.style.cssText = 'margin-top:4px';
  meter.innerHTML = '<div style="height:4px;border-radius:2px;background:#1e293b;overflow:hidden">'
    + '<div class="pw-strength-bar" style="height:100%;width:0;border-radius:2px;transition:width .15s ease,background .15s ease"></div></div>'
    + '<div class="pw-strength-label" style="font-size:10px;color:#5a6b8a;margin-top:3px"></div>';
  inputEl.insertAdjacentElement('afterend', meter);

  const bar = meter.querySelector('.pw-strength-bar');
  const label = meter.querySelector('.pw-strength-label');
  function update() {
    const score = passwordStrengthScore(inputEl.value);
    const level = PASSWORD_STRENGTH_LEVELS[score];
    bar.style.width = (inputEl.value ? (score + 1) * 20 : 0) + '%';
    bar.style.background = level.color;
    label.textContent = inputEl.value ? level.label : '';
    label.style.color = level.color;
  }
  inputEl.addEventListener('input', update);
  update();
}
