const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { isLocalDesktopRequest, dataRoomFolderPath, openDataRoomFolder } = require('../dataRoom');
const { createTestServer } = require('./helpers');

let server;
before(async () => { server = await createTestServer({ port: 4198 }); });
after(async () => { if (server) await server.stop(); });

test('desktop opening is allowed only for direct loopback requests', () => {
  const local = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host: 'localhost:4000' } };
  assert.equal(isLocalDesktopRequest(local), true);
  assert.equal(isLocalDesktopRequest({ ...local, socket: { remoteAddress: '192.168.1.5' } }), false);
  assert.equal(isLocalDesktopRequest({ ...local, headers: { host: 'crm.example.com' } }), false);
  assert.equal(isLocalDesktopRequest({ ...local, headers: { ...local.headers, 'x-forwarded-for': '192.168.1.5' } }), false);
});

test('Windows Copy-as-path quotes and network paths are supported; URLs/devices/relative paths are rejected', () => {
  assert.equal(dataRoomFolderPath(' "C:\\Nextcloud\\Data Room\\Компания" '), 'C:\\Nextcloud\\Data Room\\Компания');
  assert.equal(dataRoomFolderPath('\\\\server\\share\\Client'), '\\\\server\\share\\Client');
  for (const value of ['javascript:alert(1)', 'https://example.com', 'C:relative', '..\\Client', '\\\\?\\C:\\Windows', '\\\\?/C:/Windows', 'C:\\bad"path']) {
    assert.equal(dataRoomFolderPath(value), '', value);
  }
});

test('launch passes a directory containing spaces and & as one argument without a shell', async () => {
  const folder = 'C:\\Nextcloud\\GoldenLeaves Data Room\\Compliance&MLRO\\Компания';
  let captured;
  await openDataRoomFolder('"' + folder + '"', {
    platform: 'win32', stat: async value => { assert.equal(value, folder); return { isDirectory: () => true }; },
    launch: (exe, args, options) => {
      captured = { exe, args, options };
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  assert.match(captured.exe, /\\explorer\.exe$/i);
  assert.deepEqual(captured.args, [folder]);
  assert.equal(captured.options.shell, false);
});

test('files and missing folders never launch an application', async () => {
  const launch = () => assert.fail('must not launch');
  await assert.rejects(openDataRoomFolder('C:\\file.exe', { platform: 'win32', stat: async () => ({ isDirectory: () => false }), launch }), /ведёт к файлу/);
  await assert.rejects(openDataRoomFolder('C:\\missing', { platform: 'win32', stat: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); }, launch }), /не найдена/);
});

test('API requires authentication, tenant ownership, and a direct local request', async () => {
  const created = await server.apiFetch('/api/ob-clients', { method: 'POST', body: JSON.stringify({ name: 'Folder access test', direction: 'CF&A', dataRoomPath: 'C:\\DataRoom' }) });
  assert.equal(created.status, 201);
  const client = await created.json();
  const endpoint = '/api/ob-clients/' + client.id + '/open-data-room';
  assert.equal((await fetch(server.baseUrl + endpoint, { method: 'POST' })).status, 401);
  assert.equal((await server.apiFetch(endpoint, { method: 'POST', headers: { 'X-Forwarded-For': '192.168.1.5' } })).status, 403);
  assert.equal((await server.apiFetch('/api/ob-clients/999999/open-data-room', { method: 'POST' })).status, 404);
  const signup = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'Other data-room tenant', name: 'Test Admin', email: 'other@data-room.example', password: 'DataRoomTest123!' }),
  });
  assert.equal(signup.status, 201);
  const other = await signup.json();
  assert.equal((await server.apiFetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + other.token } })).status, 404);
});
