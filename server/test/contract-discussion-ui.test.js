const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../../js/contract-discussion.js'), 'utf8');

function ui() {
  const elements = new Map();
  for (const id of ['contractApprovalPanel', 'modal-engagement', 'contractChatFeed', 'contractChatOlder', 'contractChatText',
    'contractChatSend', 'contractChatAccess', 'contractChatDecisions', 'contractChatStatus', 'contractChatConnection']) {
    elements.set(id, { style: { display: 'flex' }, dataset: { engagementId: '7' }, value: '', innerHTML: '', textContent: '',
      scrollTop: 50, scrollHeight: 1000, clientHeight: 300 });
  }
  const timers = new Map(); let nextTimer = 0;
  const ctx = vm.createContext({ document: { getElementById: id => elements.get(id), visibilityState: 'visible' },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout: id => timers.delete(id),
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    contractVersionDate: value => value, contractApprovalLabel: value => value,
    renderContractApproval() {}, contractApprovalMessage() {}, contractApprovalUI: null,
  });
  vm.runInContext(code, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/discussion-mentions.js'), 'utf8'), ctx);
  ctx.contractApprovalUI = { panel: elements.get('contractApprovalPanel'), engagementId: 7, request: 0, keys: {}, busy: false,
    data: { userId: 1, cycles: [], summary: { frozen: false } },
    chat: { loaded: true, after: 0, before: null, messages: new Map(), documents: [], canPost: true, context: { cycleId: null, version: 1 } } };
  return { ctx, elements, timers, state: ctx.contractApprovalUI };
}

test('one timeline orders file/submission/decisions and never treats a chat message as an approval', () => {
  const { ctx, state } = ui();
  const now = '2026-10-27T14:00:00Z';
  state.chat.documents = [{ id: 4, version: 2, author: 'Author', createdAt: now, filename: 'contract.docx', note: 'Changed terms' }];
  state.chat.messages.set(12, { id: 12, createdAt: now, authorId: 1, author: 'Author', text: 'Согласен', version: 2 });
  state.data.cycles = [{ id: 8, number: 2, createdAt: now, initiator: 'Author', version: 2, note: 'Review this file',
    steps: [{ id: 9, name: 'Reviewer', status: 'approved', decidedAt: now, comment: 'Checked' }],
    closeReason: 'Rework', closeActor: 'Admin', invalidatedAt: '2026-10-27T15:00:00Z' }];
  const entries = ctx.contractDiscussionEntries(state.data, state.chat);
  assert.equal(entries.map(e => e.key).join(','), 'file-4,submitted-8,message-12,decision-9,closed-8');
  assert.equal(entries[2].kind, 'message'); assert.equal(entries[2].label, '');
  assert.equal(entries[3].text, 'Checked'); assert.equal(entries[4].author, 'Admin');
});

test('live feed updates escape messages and preserve the composer draft, caret and reading position', () => {
  const { ctx, elements, state } = ui();
  const composer = elements.get('contractChatText');
  composer.value = 'Unsent draft'; composer.selectionStart = 4; composer.selectionEnd = 7;
  state.feedSignature = 'previous';
  state.chat.messages.set(1, { id: 1, createdAt: '2026-10-27', authorId: 2, author: '<Reviewer>', text: '<img src=x onerror=alert(1)>', version: 1 });
  ctx.renderContractDiscussion(state);
  assert.equal(elements.get('contractChatText'), composer);
  assert.equal(composer.value, 'Unsent draft'); assert.equal(composer.selectionStart, 4); assert.equal(composer.selectionEnd, 7);
  assert.equal(elements.get('contractChatFeed').scrollTop, 50);
  assert.ok(elements.get('contractChatFeed').innerHTML.includes('&lt;img'));
  assert.equal(elements.get('contractChatFeed').innerHTML.includes('<img'), false);
  state.chat.canPost = false;
  ctx.renderContractDiscussion(state);
  assert.equal(composer.disabled, true); assert.equal(composer.value, 'Unsent draft');
});

test('polling fetches new messages automatically and a closed card rejects late responses', async () => {
  const { ctx, state, timers, elements } = ui();
  const calls = [];
  ctx.apiFetch = async url => {
    calls.push(url);
    return url.includes('/chat') ? { messages: [{ id: 5, author: 'Reviewer', text: 'New message', createdAt: '2026-10-27', version: 1 }],
      nextAfter: 5, nextBefore: null, hasMore: false, canPost: true, documents: [], context: { cycleId: null, version: 1 } } : state.data;
  };
  await ctx.loadContractConversation(7);
  assert.ok(calls.some(c => c.endsWith('/chat?after=0')));
  assert.ok(elements.get('contractChatFeed').innerHTML.includes('New message'));
  assert.ok([...timers.values()].some(t => t.ms === 3000));
  const releases = [];
  ctx.apiFetch = url => new Promise(resolve => releases.push(() => resolve(url.includes('/chat') ? { messages: [], nextAfter: 9, documents: [] } : state.data)));
  const pending = ctx.loadContractConversation(7);
  ctx.stopContractConversation();
  for (const release of releases) release();
  await pending;
  assert.equal(state.chat.after, 5); assert.equal(timers.size, 0);
});

test('hidden pages pause polling and independent message sends keep the exact review context', async () => {
  const { ctx, state, timers, elements } = ui();
  let captured;
  ctx.contractApprovalAction = (url, body) => { captured = { url, body }; };
  elements.get('contractChatText').value = ' Clarification ';
  state.chat.context = { cycleId: 12, version: 3 };
  ctx.sendContractDiscussion();
  assert.equal(captured.url, '/api/engagements/7/approvals/chat');
  assert.equal(captured.body.expectedCycleId, 12); assert.equal(captured.body.expectedVersion, 3); assert.equal(captured.body.text, 'Clarification');
  ctx.document.visibilityState = 'hidden';
  ctx.apiFetch = () => { throw new Error('Hidden page must not request'); };
  ctx.scheduleContractConversation(state);
  const timer = [...timers.values()][0];
  timer.fn();
  assert.equal(state.loading, undefined);
  ctx.stopContractConversation();
});

test('standalone free chat loads without a contract and stops when its page closes', async () => {
  const { ctx, state, elements, timers } = ui();
  let active = true;
  elements.set('page-discussions', { classList: { contains: () => active } });
  state.panel.dataset.surface = 'hub'; state.panel.dataset.kind = 'room'; state.kind = 'room';
  const calls = [];
  ctx.apiFetch = async url => {
    calls.push(url);
    return { room: { id: 7, title: 'Free topic', links: [], members: [] }, userId: 1,
      messages: [{ id: 1, text: 'No process needed', author: 'Colleague', attachments: [], createdAt: '2026-10-27' }],
      documents: [], canPost: true, nextAfter: 1, nextBefore: null, hasMore: false, context: {} };
  };
  await ctx.loadContractConversation(7);
  assert.deepEqual(calls, ['/api/discussions/7?after=0']);
  assert.ok(elements.get('contractChatFeed').innerHTML.includes('No process needed'));
  assert.ok(!elements.get('contractChatFeed').innerHTML.includes('Черновик'));
  active = false; [...timers.values()][0].fn(); assert.equal(calls.length, 1);
});

test('paperclip validates limits, escapes file labels and allows attachment-only messages', () => {
  const { ctx, state, elements } = ui();
  elements.set('discussionAttachments', { innerHTML: '' }); state.kind = 'room'; state.attachments = [];
  ctx.contractTemplateRequestKey = () => 'a-unique-key';
  const file = { name: '<review>.pdf', size: 20 };
  ctx.chooseDiscussionFiles({ files: [file], value: 'fake-path' });
  assert.equal(state.attachments.length, 1);
  assert.ok(elements.get('discussionAttachments').innerHTML.includes('&lt;review&gt;'));
  ctx.chooseDiscussionFiles({ files: [{ name: 'bad.exe', size: 5 }], value: '' });
  assert.equal(state.attachments.length, 1);
  let captured; ctx.contractApprovalAction = (url, body) => { captured = { url, body }; };
  ctx.sendContractDiscussion(); assert.equal(captured.url, '/api/discussions/7/messages'); assert.equal(captured.body.text, '');
  ctx.removeDiscussionAttachment(0); assert.equal(state.attachments.length, 0);
});

test('unsent text and selected files survive chat switching, scoped to account and room', () => {
  const { ctx, state, elements } = ui();
  ctx.getAuth = () => ({ user: { id: 1 }, tenant: { id: 1 } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/discussions.js'), 'utf8'), ctx);
  elements.set('discussionAttachments', { innerHTML: '' });
  state.kind = 'room'; state.attachments = [{ name: 'notes.txt', size: 4 }];
  elements.get('contractChatText').value = 'Pending draft'; ctx.saveDiscussionDraft(state);
  elements.get('contractChatText').value = ''; state.attachments = [];
  ctx.restoreDiscussionDraft(state);
  assert.equal(elements.get('contractChatText').value, 'Pending draft'); assert.equal(state.attachments[0].name, 'notes.txt');
  elements.get('contractChatText').value = ''; state.kind = 'contract'; ctx.restoreDiscussionDraft(state);
  assert.equal(elements.get('contractChatText').value, '');
  state.kind = 'room'; ctx.getAuth = () => ({ user: { id: 2 }, tenant: { id: 1 } }); ctx.restoreDiscussionDraft(state);
  assert.equal(elements.get('contractChatText').value, '');
});
