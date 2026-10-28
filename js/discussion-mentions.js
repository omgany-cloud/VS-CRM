// Selected people are explicit text ranges. Merely typing a name never shares
// a chat; selecting a suggestion and sending does, in the message transaction.
function discussionAvatar(name, id=0) {
  const parts=String(name||'?').trim().split(/\s+/).filter(Boolean);
  const initials=(parts.length>1 ? [...parts[0]][0]+[...parts.at(-1)][0] : [...(parts[0]||'?')].slice(0,2).join('')).toLocaleUpperCase();
  return `<span class="discussion-person-avatar avatar-tone-${Math.abs(Number(id)||0)%5}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}
async function mentionDiscussionPerson(id) {
  const state=contractApprovalUI,input=document.getElementById('contractChatText');
  if(!contractConversationOpen(state)||!state.chat.canPost||state.busy)return;
  try {
    const person=(await discussionMentionPeople(state)).find(p=>p.id===id);
    if(!contractConversationOpen(state)||!person)return;
    input.focus();
    const at=input.value.length,space=at&&!/\s$/.test(input.value)?' ':'';
    if(input.value.length+space.length+person.name.length+1>4000)return contractDiscussionStatus('Сократите сообщение перед добавлением имени.',true);
    input.value+=space;reconcileDiscussionMentions(state,input.value);
    state.mentionOptions=[{...person,start:input.value.length,end:input.value.length,prefix:''}];
    selectDiscussionMention(0);
  }catch(err){if(contractConversationOpen(state))contractDiscussionStatus(err.message,true);}
}
function reconcileDiscussionMentions(state, value) {
  const old = state.mentionText || '', mentions = state.mentions || [];
  if (old === value) return;
  let start = 0;
  while (start < old.length && start < value.length && old[start] === value[start]) start++;
  let oldEnd = old.length, newEnd = value.length;
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === value[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  state.mentions = mentions.flatMap(m => {
    if (m.end <= start) return [m];
    if (m.start >= oldEnd) return [{ ...m, start: m.start + delta, end: m.end + delta }];
    return [];
  }).filter(m => value.slice(m.start, m.end) === m.label && !/[\p{L}\p{N}_]/u.test(value[m.start - 1] || '') && !/[\p{L}\p{N}_]/u.test(value[m.end] || ''));
  state.mentionText = value;
}
function discussionNameMatches(text, caret, people, mentions = []) {
  if (mentions.some(m => caret > m.start && caret <= m.end)) return [];
  const prefix = text.slice(0, caret);
  if (!/[\p{L}\p{N}_-]$/u.test(prefix) && !/(^|\s)@$/.test(prefix)) return [];
  const normalize = v => v.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  // Try complete name fragments before falling back to the last word.
  const startAt = Math.max(0, caret - 100, prefix.lastIndexOf('\n') + 1), tail = prefix.slice(startAt);
  const starts = [...tail.matchAll(/(?:^|[\s(,;:])(@?[\p{L}\p{N}_-]+|@)/gu)]
    .map(m => startAt + m.index + m[0].length - m[1].length);
  for (const start of starts) {
    const fragment = prefix.slice(start), query = normalize(fragment.replace(/^@/, ''));
    if ((query.length < 2 && !fragment.startsWith('@')) || mentions.some(m => start < m.end && caret > m.start)) continue;
    const matches = people.filter(p => normalize(p.name).includes(query)).slice(0, 8);
    if (matches.length) return matches.map(person => ({ ...person, start, end: caret, prefix: fragment.startsWith('@') ? '@' : '' }));
  }
  return [];
}
async function discussionMentionPeople(state) {
  if (state.mentionPeople && Date.now() - state.mentionPeopleAt < 15000) return state.mentionPeople;
  if (!state.mentionPeopleLoading) {
    const path = state.kind === 'room' ? `/api/discussions/${state.engagementId}/people` : `/api/engagements/${state.engagementId}/approvals/chat/people`;
    state.mentionPeopleLoading = apiFetch(path).then(data => {
      if (!contractConversationOpen(state)) return [];
      state.mentionPeople = data.people; state.mentionPeopleAt = Date.now(); return data.people;
    }).finally(() => { state.mentionPeopleLoading = null; });
  }
  return state.mentionPeopleLoading;
}
async function discussionInputChanged(input) {
  const state = contractApprovalUI;
  if (!contractConversationOpen(state)) return;
  reconcileDiscussionMentions(state, input.value); syncDiscussionMentionMirror(state); renderDiscussionMentionHint(state);
  const request = state.mentionRequest = (state.mentionRequest || 0) + 1;
  const value = input.value, caret = input.selectionStart;
  if (state.busy || !state.chat.canPost || input.selectionStart !== input.selectionEnd || !/(?:[\p{L}\p{N}_-]{2}|@)$/u.test(value.slice(0, caret))) return hideDiscussionMentions(state);
  try {
    const people = await discussionMentionPeople(state);
    if (!contractConversationOpen(state) || request !== state.mentionRequest || input.value !== value || input.selectionStart !== caret || document.activeElement !== input) return;
    state.mentionOptions = discussionNameMatches(value, caret, people, state.mentions); state.mentionIndex = 0;
    renderDiscussionMentions(state);
  } catch (err) { if (contractConversationOpen(state)) { hideDiscussionMentions(state); contractDiscussionStatus('Не удалось найти сотрудника: ' + err.message, true); } }
}
function hideDiscussionMentions(state = contractApprovalUI) {
  if (state) { state.mentionOptions = []; state.mentionRequest = (state.mentionRequest || 0) + 1; }
  const list = document.getElementById('discussionMentionList'); if (list) { list.hidden = true; list.innerHTML = ''; }
  const input = document.getElementById('contractChatText');
  input?.setAttribute?.('aria-expanded', 'false'); input?.removeAttribute?.('aria-activedescendant');
}
function renderDiscussionMentions(state) {
  const list = document.getElementById('discussionMentionList'), input = document.getElementById('contractChatText');
  if (!list) return;
  const options = state.mentionOptions || [];
  if (!options.length) return hideDiscussionMentions(state);
  list.hidden = false;
  list.innerHTML = options.map((p,i) => `<button type="button" role="option" id="discussionMentionOption${i}" aria-selected="${i === state.mentionIndex}" tabindex="-1" class="${i === state.mentionIndex ? 'selected' : ''}" onmousedown="event.preventDefault()" onclick="selectDiscussionMention(${i})">${discussionAvatar(p.name,p.id)}<span class="discussion-person-name"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.role || '')}</small></span><small>${p.member ? 'В задаче' : '+ Добавить'}</small></button>`).join('');
  input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-activedescendant', 'discussionMentionOption' + state.mentionIndex);
  document.getElementById('discussionMentionOption' + state.mentionIndex)?.scrollIntoView?.({ block: 'nearest' });
}
function selectDiscussionMention(index) {
  const state = contractApprovalUI, input = document.getElementById('contractChatText');
  if (!contractConversationOpen(state) || state.busy || !state.chat.canPost) return;
  const option = state.mentionOptions?.[index]; if (!option || input.value !== state.mentionText) return;
  const label = option.prefix + option.name, suffix = input.value.slice(option.end), space = /^\s/.test(suffix) ? '' : ' ';
  const next = input.value.slice(0, option.start) + label + space + suffix;
  if (next.length > 4000) return contractDiscussionStatus('Сообщение слишком длинное — сократите его перед добавлением имени.', true);
  reconcileDiscussionMentions(state, next);
  state.mentions = [...(state.mentions || []), { userId: option.id, name: option.name, label, start: option.start, end: option.start + label.length }].sort((a,b) => a.start-b.start);
  input.value = next; input.focus(); input.setSelectionRange(option.start + label.length + space.length, option.start + label.length + space.length);
  hideDiscussionMentions(state); syncDiscussionMentionMirror(state); renderDiscussionMentionHint(state);
}
function discussionComposerKey(event, input) {
  const state = contractApprovalUI;
  if (event.isComposing) return;
  if (state?.mentionOptions?.length) {
    if (event.key === 'Escape') { event.preventDefault(); hideDiscussionMentions(state); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); state.mentionIndex = (state.mentionIndex + (event.key === 'ArrowDown' ? 1 : -1) + state.mentionOptions.length) % state.mentionOptions.length;
      renderDiscussionMentions(state); return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); selectDiscussionMention(state.mentionIndex); return; }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendContractDiscussion(); }
}
function discussionMessageMentions(state, raw) {
  reconcileDiscussionMentions(state, raw);
  const trim = raw.length - raw.trimStart().length, end = raw.trimEnd().length;
  return (state.mentions || []).filter(m => m.start >= trim && m.end <= end).map(m => ({ userId: m.userId, start: m.start - trim, end: m.end - trim }));
}
function renderMentionedText(text, mentions = []) {
  let at = 0, html = '';
  for (const m of [...mentions].sort((a,b) => a.start-b.start)) {
    if (!Number.isSafeInteger(m.start) || !Number.isSafeInteger(m.end) || m.start < at || m.end > text.length || m.end <= m.start) continue;
    html += escapeHtml(text.slice(at, m.start)) + `<span class="discussion-mentioned-name">${escapeHtml(text.slice(m.start, m.end))}</span>`; at = m.end;
  }
  return html + escapeHtml(text.slice(at));
}
function syncDiscussionMentionMirror(state = contractApprovalUI) {
  const input = document.getElementById('contractChatText'), mirror = document.getElementById('discussionMentionMirror');
  if (!state || !input || !mirror) return;
  const selected = (state.mentions || []).filter(m => input.value.slice(m.start, m.end) === m.label);
  input.parentElement.classList.toggle('has-mentions', selected.length > 0);
  mirror.innerHTML = renderMentionedText(input.value, selected) + '\n';
  mirror.style.width = input.clientWidth + 'px'; mirror.style.height = input.clientHeight + 'px';
  mirror.scrollTop = input.scrollTop; mirror.scrollLeft = input.scrollLeft;
}
function renderDiscussionMentionHint(state) {
  const hint = document.getElementById('discussionMentionHint'); if (!hint) return;
  const names = [...new Map((state.mentions || []).filter(m => state.kind === 'room'
    ? !state.data?.room?.members.some(p => p.id === m.userId)
    : !state.chat.participants?.some(p => p.id === m.userId) && !state.mentionPeople?.find(p => p.id === m.userId)?.member).map(m => [m.userId, m.name])).values()];
  hint.textContent = names.length ? names.join(', ') + (names.length === 1 ? ' присоединится к задаче при отправке и увидит историю.' : ' присоединятся к задаче при отправке и увидят историю.') : '';
  hint.hidden = !names.length;
}
function initDiscussionMentions(state) {
  const input = document.getElementById('contractChatText');
  state.mentions ||= []; state.mentionText = input?.value || '';
  if (typeof ResizeObserver === 'function' && input) { state.mentionObserver = new ResizeObserver(() => syncDiscussionMentionMirror(state)); state.mentionObserver.observe(input); }
  syncDiscussionMentionMirror(state); renderDiscussionMentionHint(state);
}
function clearDiscussionMentions(state) {
  state.mentions = []; state.mentionText = ''; hideDiscussionMentions(state); syncDiscussionMentionMirror(state); renderDiscussionMentionHint(state);
}
