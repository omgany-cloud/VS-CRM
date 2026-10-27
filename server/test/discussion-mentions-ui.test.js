const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../js/discussion-mentions.js'), 'utf8');
function ui() {
  const elements = new Map();
  for (const id of ['contractChatText','discussionMentionList','discussionMentionHint','discussionMentionMirror']) {
    elements.set(id, { value: '', selectionStart: 0, selectionEnd: 0, hidden: true, innerHTML: '', textContent: '', style: {},
      clientWidth: 400, clientHeight: 54, scrollTop: 0, scrollLeft: 0, attrs: {}, classes: new Set(),
      setAttribute(k,v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      focus() { ctx.document.activeElement = this; }, setSelectionRange(a,b) { this.selectionStart = a; this.selectionEnd = b; } });
  }
  const input = elements.get('contractChatText'); input.parentElement = { classList: { toggle(name,on) { if (on) input.classes.add(name); else input.classes.delete(name); } } };
  const state = { kind: 'room', engagementId: 7, mentions: [], mentionText: '', chat: { canPost: true }, data: { room: { members: [{ id: 1 }] } } };
  const ctx = vm.createContext({ document: { getElementById: id => elements.get(id), activeElement: input },
    contractApprovalUI: state, contractConversationOpen: s => s === state && !s.closed,
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    apiFetch: async () => ({ people: [] }), contractDiscussionStatus() {}, sendContractDiscussion() {},
  });
  vm.runInContext(source, ctx);
  const type = text => { input.value = text; input.setSelectionRange(text.length,text.length); return ctx.discussionInputChanged(input); };
  return { ctx, state, elements, input, type };
}
const people = [{ id: 2, name: 'Иван Петров', role: 'Юрист', member: false }, { id: 3, name: 'Иван Сидоров', role: 'CFO', member: true }];
test('ordinary names suggest people without @ and multiword fragments are replaced as a whole', () => {
  const { ctx } = ui();
  assert.equal(ctx.discussionNameMatches('Здравствуйте, Ива', 17, people).length, 2);
  const typed = 'Проверит Иван Пе', list = ctx.discussionNameMatches(typed, typed.length, people);
  assert.equal(list.length, 1); assert.equal(list[0].start, 'Проверит '.length); assert.equal(list[0].name, 'Иван Петров');
  assert.equal(ctx.discussionNameMatches('И',1,people).length,0);
  assert.equal(ctx.discussionNameMatches('mail@example.com',16,people).length,0);
});
test('name selection is a draft; Enter first selects and only the next Enter sends', async () => {
  const { ctx, state, input, type } = ui();
  let sends = 0; ctx.sendContractDiscussion = () => sends++; ctx.apiFetch = async () => ({ people });
  await type('Ива'); assert.equal(state.mentionOptions.length, 2);
  const key = key => ({ key, shiftKey: false, isComposing: false, preventDefault() {} });
  ctx.discussionComposerKey(key('Enter'), input);
  assert.equal(sends,0); assert.equal(input.value, 'Иван Петров '); assert.equal(state.mentions[0].userId,2);
  ctx.discussionComposerKey({ ...key('Enter'), shiftKey: true }, input); assert.equal(sends,0);
  ctx.discussionComposerKey({ ...key('Enter'), isComposing: true }, input); assert.equal(sends,0);
  ctx.discussionComposerKey(key('Enter'), input); assert.equal(sends,1);
  const refs = ctx.discussionMessageMentions(state, input.value); assert.equal(refs.length,1); assert.equal(refs[0].end,'Иван Петров'.length);
});
test('typing a complete name without selecting the suggestion does not create an invitation', async () => {
  const { ctx, state, input, type } = ui(); ctx.apiFetch = async () => ({ people });
  await type('Иван Петров'); assert.equal(state.mentionOptions.length, 1);
  ctx.hideDiscussionMentions(state); assert.equal(ctx.discussionMessageMentions(state, input.value).length,0);
});
test('editing a chosen name removes its identity; inserting before it safely shifts UTF-16 ranges', async () => {
  const { ctx, state, input, type } = ui(); ctx.apiFetch = async () => ({ people });
  await type('Ива'); ctx.selectDiscussionMention(0);
  ctx.reconcileDiscussionMentions(state, '💬 ' + input.value);
  assert.equal(state.mentions[0].start, 3); assert.equal(state.mentions[0].end, 3+'Иван Петров'.length);
  ctx.reconcileDiscussionMentions(state, '💬 Иван Петрович '); assert.equal(state.mentions.length,0);
});
test('highlighted names escape HTML, preserve normal text and mirror composer scrolling', async () => {
  const { ctx, state, input, elements, type } = ui(); ctx.apiFetch = async () => ({ people });
  await type('Ива'); ctx.selectDiscussionMention(0);
  assert.ok(input.classes.has('has-mentions'));
  assert.match(elements.get('discussionMentionMirror').innerHTML, /discussion-mentioned-name/);
  assert.match(elements.get('discussionMentionHint').textContent, /присоединится/);
  input.scrollTop = 18; ctx.syncDiscussionMentionMirror(state); assert.equal(elements.get('discussionMentionMirror').scrollTop,18);
  const html = ctx.renderMentionedText('<script> Иван', [{ start:9, end:13 }]);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('>Иван</span>'));
  ctx.clearDiscussionMentions(state); assert.equal(state.mentions.length,0); assert.equal(input.classes.has('has-mentions'),false);
});
test('late directory responses do not reopen a closed chat or overwrite a newer query', async () => {
  const { ctx, state, elements, type } = ui(); let release;
  ctx.apiFetch = () => new Promise(resolve => { release = resolve; });
  const pending = type('Ива'); state.closed = true; release({ people }); await pending;
  assert.equal(elements.get('discussionMentionList').hidden,true); assert.equal(state.mentionOptions,undefined);
});
test('new topic form only asks for a title, with no participant checkboxes', () => {
  const { ctx, elements } = ui();
  const main = { innerHTML: '' }; elements.set('discussionMain', main); elements.set('discussionTitle', { focus() {} });
  ctx.stopContractConversation = () => {};
  ctx.document.querySelector = () => ({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/discussions.js'), 'utf8'), ctx);
  ctx.newDiscussion(); assert.ok(main.innerHTML.includes('discussionTitle'));
  assert.ok(!main.innerHTML.includes('checkbox')); assert.ok(!main.innerHTML.includes('discussionPerson'));
});
