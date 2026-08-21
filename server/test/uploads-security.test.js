// Regression coverage for the GET /api/uploads/:id IDOR fix (QA audit,
// 2026-08-21): this route used to accept ANY valid tenant token —
// internal staff, portfolio-portal, or LP-portal — to fetch ANY file in
// the tenant, because uploaded_files never recorded which portfolio
// company a portal file actually belongs to. Covers: a portfolio company
// can fetch its own uploaded file, but NOT another portfolio company's;
// an LP-portal token is rejected outright (no legitimate use of this
// route exists); a deactivated internal user's still-unexpired token can
// no longer download.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4121 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'UPLOADS_SEC_FUND' }),
  })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

async function uploadAsStaff() {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('staff file')], { type: 'application/pdf' }), 'staff.pdf');
  const res = await fetch(server.baseUrl + '/api/uploads', {
    method: 'POST', headers: { Authorization: 'Bearer ' + server.token }, body: form,
  });
  assert.equal(res.status, 201);
  return res.json();
}

async function portalLogin(bin, password) {
  const res = await fetch(server.baseUrl + '/api/portal/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bin, password }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

async function uploadAsPortal(portalToken) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('portal file')], { type: 'application/pdf' }), 'portal.pdf');
  const res = await fetch(server.baseUrl + '/api/portal/uploads', {
    method: 'POST', headers: { Authorization: 'Bearer ' + portalToken }, body: form,
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('a portfolio company can fetch its own portal-uploaded file, but NOT another portfolio company\'s', async () => {
  const coA = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'ZZZ_UPLOADS_CO_A', bin: 'BINA001', invested: 0, value: 0 }),
  })).json();
  const coB = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'ZZZ_UPLOADS_CO_B', bin: 'BINB001', invested: 0, value: 0 }),
  })).json();

  const { password: pwA } = await (await server.apiFetch(`/api/portfolio/${coA.id}/portal-password`, { method: 'PUT' })).json();
  const { password: pwB } = await (await server.apiFetch(`/api/portfolio/${coB.id}/portal-password`, { method: 'PUT' })).json();
  const tokenA = await portalLogin('BINA001', pwA);
  const tokenB = await portalLogin('BINB001', pwB);

  const fileA = await uploadAsPortal(tokenA);

  // Company A can fetch its own file.
  const ownFetch = await fetch(server.baseUrl + fileA.url, { headers: { Authorization: 'Bearer ' + tokenA } });
  assert.equal(ownFetch.status, 200);

  // Company B — a completely different portal identity — must NOT be
  // able to fetch company A's file by id. This is the core IDOR regression.
  const crossFetch = await fetch(server.baseUrl + fileA.url, { headers: { Authorization: 'Bearer ' + tokenB } });
  assert.equal(crossFetch.status, 403);

  // Also blocked via the ?token= query-param path (used by <a href> links).
  const crossFetchQuery = await fetch(server.baseUrl + fileA.url + '?token=' + encodeURIComponent(tokenB));
  assert.equal(crossFetchQuery.status, 403);
});

test('an internal staff member can fetch a staff-uploaded file (portal_portfolio_id is NULL)', async () => {
  const file = await uploadAsStaff();
  const res = await fetch(server.baseUrl + file.url, { headers: { Authorization: 'Bearer ' + server.token } });
  assert.equal(res.status, 200);
});

test('an LP-portal token is rejected outright — no legitimate use of this route exists today', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'ZZZ_UPLOADS_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'UPL-LP', email: 'uploads-lp@example.com' }),
  })).json();
  const { password } = await (await server.apiFetch(`/api/lp/${lp.id}/portal-password`, { method: 'PUT' })).json();
  const loginRes = await fetch(server.baseUrl + '/api/portal/lp/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'uploads-lp@example.com', password }),
  });
  assert.equal(loginRes.status, 200);
  const { token: lpToken } = await loginRes.json();

  const file = await uploadAsStaff();
  const res = await fetch(server.baseUrl + file.url, { headers: { Authorization: 'Bearer ' + lpToken } });
  assert.equal(res.status, 403);
});

test('a deactivated internal user\'s still-unexpired token can no longer download a file', async () => {
  const file = await uploadAsStaff();

  const userRes = await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ Uploads Deactivate Test', email: 'uploads-deactivate@example.com', role: 'CFO', password: 'TempPassword123!' }),
  });
  assert.equal(userRes.status, 201);

  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'uploads-deactivate@example.com', password: 'TempPassword123!' }),
  });
  assert.equal(loginRes.status, 200);
  const { token: deactivatedToken } = await loginRes.json();

  // Confirm the fresh token works before deactivation.
  const beforeRes = await fetch(server.baseUrl + file.url, { headers: { Authorization: 'Bearer ' + deactivatedToken } });
  assert.equal(beforeRes.status, 200);

  const newUser = await (await server.apiFetch('/api/users')).json();
  const target = newUser.users.find(u => u.email === 'uploads-deactivate@example.com');
  const deactivateRes = await server.apiFetch(`/api/users/${target.id}`, { method: 'PUT', body: JSON.stringify({ active: false }) });
  assert.equal(deactivateRes.status, 200);

  const afterRes = await fetch(server.baseUrl + file.url, { headers: { Authorization: 'Bearer ' + deactivatedToken } });
  assert.equal(afterRes.status, 401);
});

test('tenant isolation still holds: a fresh tenant cannot fetch another tenant\'s file', async () => {
  const file = await uploadAsStaff();
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ Uploads Isolation Co', name: 'Tenant B Admin', email: 'tenantb-uploads@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token } = await signupRes.json();
  const res = await fetch(server.baseUrl + file.url, { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(res.status, 404);
});
