// Regression coverage for the MCP layer (server/mcp.js) over the curated
// external API. Covers the real JSON-RPC handshake (initialize -> tools/list
// -> tools/call), per-tool scope enforcement (a key missing a scope gets a
// clean isError result, not a raw 403/500), tenant isolation (a tenant B key
// must never see tenant A's data through an MCP tool call), and that
// GET/DELETE on the stateless endpoint correctly 405 since this server
// never hands out a session id.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;

before(async () => {
  server = await createTestServer({ port: 4097 });
  // seed.js no longer creates any funds — the list_funds MCP tool tests
  // below need at least one real row to list.
  await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_FUND', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 }),
  });
});

after(async () => { await server.stop(); });

// The Streamable HTTP transport responds as an SSE stream ("event: message\ndata: {...}\n\n")
// even for a single-shot JSON-RPC response when the client's Accept header allows it — this
// pulls the JSON payload out of that framing so tests can assert on it normally.
function parseSseJson(text) {
  const line = text.split('\n').find(l => l.startsWith('data: '));
  if (!line) throw new Error('No SSE data line found in MCP response: ' + text.slice(0, 200));
  return JSON.parse(line.slice('data: '.length));
}

async function mcpCall(apiKey, body) {
  const res = await fetch(server.baseUrl + '/api/v1/external/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, rpc: res.ok ? parseSseJson(text) : null, rawText: text };
}

async function initHandshake(apiKey) {
  const init = await mcpCall(apiKey, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
  });
  assert.equal(init.status, 200);
  assert.equal(init.rpc.result.serverInfo.name, 'turan-crm');
}

test('MCP: full handshake, tools/list, and a scoped tools/call round-trip', async () => {
  const key = await (await server.apiFetch('/api/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ_MCP_FULL', scopes: ['read:funds', 'read:lp', 'read:deals', 'read:portfolio'] }),
  })).json();

  await initHandshake(key.key);

  const list = await mcpCall(key.key, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(list.status, 200);
  const toolNames = list.rpc.result.tools.map(t => t.name).sort();
  assert.deepEqual(toolNames, ['list_deals', 'list_funds', 'list_lp', 'list_portfolio']);

  const fundsCall = await mcpCall(key.key, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_funds', arguments: {} } });
  assert.equal(fundsCall.status, 200);
  assert.notEqual(fundsCall.rpc.result.isError, true);
  const funds = JSON.parse(fundsCall.rpc.result.content[0].text);
  assert.ok(Array.isArray(funds) && funds.length > 0, 'must return the fund created in before()');

  await server.apiFetch(`/api/api-keys/${key.id}/revoke`, { method: 'PUT' }).catch(() => {});
});

test('MCP: a tool call outside the key\'s scopes returns isError, not a raw failure', async () => {
  const key = await (await server.apiFetch('/api/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ_MCP_LIMITED', scopes: ['read:funds'] }),
  })).json();

  const call = await mcpCall(key.key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_deals', arguments: {} } });
  assert.equal(call.status, 200, 'the HTTP/JSON-RPC layer itself still succeeds');
  assert.equal(call.rpc.result.isError, true);
  assert.match(call.rpc.result.content[0].text, /read:deals/);

  await server.apiFetch(`/api/api-keys/${key.id}/revoke`, { method: 'PUT' }).catch(() => {});
});

test('MCP: tenant isolation — a tenant B key never sees tenant A\'s data via a tool call', async () => {
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ MCP Isolation Co', name: 'Tenant B Admin', email: 'mcp-tenantb@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const tenantB = await signupRes.json();

  const bKeyRes = await fetch(server.baseUrl + '/api/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tenantB.token },
    body: JSON.stringify({ name: 'ZZZ_MCP_TENANT_B', scopes: ['read:funds'] }),
  }).then(r => r.json());

  const aCall = await mcpCall((await (await server.apiFetch('/api/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ_MCP_TENANT_A', scopes: ['read:funds'] }),
  })).json()).key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_funds', arguments: {} } });
  const aFunds = JSON.parse(aCall.rpc.result.content[0].text);

  const bCall = await mcpCall(bKeyRes.key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_funds', arguments: {} } });
  const bFunds = JSON.parse(bCall.rpc.result.content[0].text);

  assert.ok(aFunds.length > 0, 'tenant A has the fund created in before()');
  assert.equal(bFunds.length, 0, 'tenant B is a fresh signup with no funds of its own');
  assert.ok(!bFunds.some(f => aFunds.some(af => af.id === f.id)), 'no fund id should ever appear in both tenants\' MCP results');
});

test('MCP: GET and DELETE on the stateless endpoint both 405', async () => {
  const key = await (await server.apiFetch('/api/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ_MCP_METHODS', scopes: ['read:funds'] }),
  })).json();
  const headers = { Authorization: 'Bearer ' + key.key };

  const getRes = await fetch(server.baseUrl + '/api/v1/external/mcp', { headers });
  assert.equal(getRes.status, 405);
  const delRes = await fetch(server.baseUrl + '/api/v1/external/mcp', { method: 'DELETE', headers });
  assert.equal(delRes.status, 405);

  await server.apiFetch(`/api/api-keys/${key.id}/revoke`, { method: 'PUT' }).catch(() => {});
});

test('MCP: missing or invalid API key is rejected the same as the REST routes', async () => {
  const noAuth = await fetch(server.baseUrl + '/api/v1/external/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(noAuth.status, 401);

  const badKey = await fetch(server.baseUrl + '/api/v1/external/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer sk_live_not_a_real_key' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(badKey.status, 401);
});
