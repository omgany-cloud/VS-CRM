// Two halves to the XSS fix from the P0 pass: the server stores free-text
// fields verbatim (correct — escaping is a render-time concern, not a
// storage concern), and js/*.js's escapeHtml() escapes them at render
// time. node:test runs outside a browser, so only the first half is
// testable here; escapeHtml() itself is a pure function tested directly
// below as a regression guard. The render-time half (does the DOM
// actually show escaped text) can only be verified via the CDP checks
// this project already uses (see this session's manual verification of
// the P0 XSS fixes) — not automatable under node:test without adding a
// browser-automation dependency, which is out of scope here.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createTestServer } = require('./helpers');

let server;
let fundId;
const PAYLOAD = '<img src=x onerror="window.__xss=1">';

before(async () => {
  server = await createTestServer({ port: 4093 });
  const res = await server.apiFetch('/api/funds');
  const { funds } = await res.json();
  fundId = funds[0].id;
});

after(async () => { await server.stop(); });

test('LP name round-trips verbatim through the API (server does not mangle or reject it)', async () => {
  const created = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: PAYLOAD, notes: PAYLOAD, type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'XSS-1' }),
  })).json();
  assert.equal(created.name, PAYLOAD);
  assert.equal(created.notes, PAYLOAD);

  const fetched = (await (await server.apiFetch('/api/lp')).json()).lp.find(l => l.id === created.id);
  assert.equal(fetched.name, PAYLOAD, 'stored value must be exact — escaping happens at render time, not storage time');

  await server.apiFetch(`/api/lp/${created.id}`, { method: 'DELETE' });
});

test('escapeHtml() (js/users.js) neutralizes HTML metacharacters — pure-function regression guard', () => {
  // js/users.js is a plain browser <script> (no module.exports, globals
  // via `function` declarations) — load it into a throwaway VM context
  // rather than require() it, so this test doesn't need a DOM/browser.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'users.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  // users.js references browser globals (document, etc.) at points other
  // than escapeHtml() itself, but function declarations are hoisted and
  // nothing else in the file executes at parse time, so running the
  // whole file here is safe — only escapeHtml is actually called below.
  vm.runInContext(src, sandbox);

  assert.equal(sandbox.escapeHtml(PAYLOAD), '&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;');
  assert.equal(sandbox.escapeHtml(`<script>alert(1)</script>`), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(sandbox.escapeHtml(`a & b`), 'a &amp; b');
  assert.equal(sandbox.escapeHtml(null), '', 'must not throw or return "null" for a null/undefined field');
  assert.equal(sandbox.escapeHtml(undefined), '');
});
