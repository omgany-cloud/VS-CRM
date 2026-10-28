// Contract payments: the employee attaches the payment order and types its
// amount, date and number; "Оплачено" is the server's sum (server/contractPayments.js).
// The form is static in the panel so a refresh never drops a chosen file or typed values.
let contractPaymentsUI = null;

function contractPaymentsPanel(engagementId) {
  return `<section id="contractPaymentsPanel" class="contract-versions" data-engagement-id="${engagementId}">
    <div class="contract-versions-heading"><div><h3>Оплаты</h3>
      <p>Приложите платёжку и внесите её данные. «Оплачено» — сумма внесённых платёжек.</p></div>
      <button type="button" class="contract-secondary" onclick="loadContractPayments(${engagementId})">Обновить</button></div>
    <p id="contractPaymentsMessage" class="contract-message" role="status" aria-live="polite">Загрузка…</p>
    <div id="contractPaymentsSummary"></div>
    <details id="contractPaymentsAdd" class="contract-version-history" hidden><summary>Прикрепить платёжку</summary>
      <form class="contract-payment-form" onsubmit="event.preventDefault();recordContractPayment(${engagementId})">
        <label for="contractPaymentFile">Платёжка · PDF, JPG или PNG до 20 МиБ</label>
        <input id="contractPaymentFile" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required />
        <div class="contract-payment-grid">
          <div><label for="contractPaymentAmount">Сумма, <span id="contractPaymentCurrency"></span></label>
            <input id="contractPaymentAmount" inputmode="decimal" autocomplete="off" required placeholder="1 500 000,00" /></div>
          <div><label for="contractPaymentDate">Дата оплаты</label><input id="contractPaymentDate" type="date" required /></div>
          <div><label for="contractPaymentNumber">Номер платёжки</label><input id="contractPaymentNumber" maxlength="64" required /></div>
          <div><label for="contractPaymentPayer">Плательщик <span class="contract-empty">· необязательно</span></label><input id="contractPaymentPayer" maxlength="200" /></div>
        </div>
        <label for="contractPaymentNote">Комментарий <span class="contract-empty">· необязательно</span></label>
        <textarea id="contractPaymentNote" maxlength="1000" rows="2" placeholder="Например: аванс 50% по договору"></textarea>
        <button type="submit" class="contract-primary">Внести оплату</button>
      </form>
    </details>
    <div id="contractPaymentsList"></div>
  </section>`;
}

function contractPaymentsMessage(text, error = false) {
  const el = document.getElementById('contractPaymentsMessage');
  if (el) { el.textContent = text; el.className = error ? 'contract-message-error' : 'contract-message'; }
}
function contractPaymentsOpen(state) {
  return contractPaymentsUI === state && document.getElementById('contractPaymentsPanel') === state.panel;
}

function renderContractPayment(payment, data) {
  const voided = payment.status !== 'active';
  return `<article class="contract-version${voided ? '' : ' contract-version-current'}">
    <div class="contract-version-top"><strong>${voided ? 'Аннулирована · ' : ''}${escapeHtml(fmtCurrency(payment.amount, payment.currency))} · № ${escapeHtml(payment.paymentNumber)} от ${escapeHtml(contractSigningDay(payment.paidDate))}</strong>
      <span class="contract-payment-actions"><button type="button" class="contract-secondary" onclick="downloadContractPayment(${data.engagementId},${payment.id},this)">Скачать</button>
      ${!voided && data.canRecord ? `<button type="button" class="contract-secondary" onclick="voidContractPayment(${data.engagementId},${payment.id})">Аннулировать</button>` : ''}</span></div>
    <div class="contract-version-name">${escapeHtml(payment.name)} <span>· ${contractVersionSize(payment.size)}</span></div>
    <p class="contract-version-meta">${payment.payer ? 'Плательщик: ' + escapeHtml(payment.payer) + ' · ' : ''}внёс ${escapeHtml(payment.recordedBy)}, ${escapeHtml(contractVersionDate(payment.recordedAt))}</p>
    ${payment.note ? `<p class="contract-version-note">${escapeHtml(payment.note)}</p>` : ''}
    ${voided ? `<p class="contract-version-note">${escapeHtml(payment.voidedBy || '')} · ${escapeHtml(contractVersionDate(payment.voidedAt))}: ${escapeHtml(payment.voidReason)}</p>` : ''}
  </article>`;
}

function renderContractPayments(state) {
  const data = state.data, panel = state.panel;
  if (data.fm) {
    panel.querySelector('#contractPaymentsSummary').innerHTML = '<p class="contract-empty">Оплаты LP по Subscription Agreement учитываются в Capital Calls.</p>';
    panel.querySelector('#contractPaymentsAdd').hidden = true;
    panel.querySelector('#contractPaymentsList').innerHTML = '';
    return;
  }
  const money = value => escapeHtml(fmtCurrency(value, data.currency));
  const share = data.feeAmount > 0 ? Math.min(100, Math.round(data.paid / data.feeAmount * 100)) : 0;
  panel.querySelector('#contractPaymentsSummary').innerHTML = `<div class="contract-payment-totals">
      <div><small>Гонорар</small><strong>${money(data.feeAmount)}</strong></div>
      <div><small>Оплачено</small><strong class="paid">${money(data.paid)}</strong></div>
      <div><small>${data.balance < 0 ? 'Переплата' : 'Остаток'}</small><strong class="${data.balance > 0 ? 'due' : 'paid'}">${money(Math.abs(data.balance))}</strong></div>
    </div>
    <div class="contract-payment-progress" role="img" aria-label="Оплачено ${share}% гонорара"><span style="width:${share}%"></span></div>
    ${data.paidBefore > 0 ? `<p class="contract-empty">Из них внесено вручную до перехода на платёжки: ${money(data.paidBefore)}.</p>` : ''}`;
  panel.querySelector('#contractPaymentsAdd').hidden = !data.canRecord;
  panel.querySelector('#contractPaymentCurrency').textContent = data.currency;
  panel.querySelector('#contractPaymentDate').max = data.today;
  const active = data.payments.filter(p => p.status === 'active'), voided = data.payments.filter(p => p.status !== 'active');
  panel.querySelector('#contractPaymentsList').innerHTML = (active.length ? active.map(p => renderContractPayment(p, data)).join('') : '<p class="contract-empty">Платёжек пока нет.</p>')
    + (voided.length ? `<details class="contract-version-history"><summary>Аннулированные (${voided.length})</summary>${voided.map(p => renderContractPayment(p, data)).join('')}</details>` : '');
}

// Keep the cached registry row in step with the server's total.
function syncContractPaymentsRecord(data) {
  const engagement = typeof engagements !== 'undefined' && engagements.find(e => e.id === data.engagementId);
  if (engagement) engagement.paid = data.paid;
}

async function loadContractPayments(engagementId) {
  const panel = document.getElementById('contractPaymentsPanel');
  if (!panel || Number(panel.dataset.engagementId) !== engagementId) return;
  if (!contractPaymentsUI || contractPaymentsUI.panel !== panel) contractPaymentsUI = { engagementId, panel, data: null, busy: false, request: 0, keys: {} };
  const state = contractPaymentsUI;
  if (state.busy) return;
  const request = ++state.request;
  try {
    const data = await apiFetch(`/api/engagements/${engagementId}/payments`);
    if (!contractPaymentsOpen(state) || request !== state.request) return;
    state.data = data;
    syncContractPaymentsRecord(data);
    renderContractPayments(state);
    contractPaymentsMessage('');
  } catch (err) {
    if (contractPaymentsOpen(state) && request === state.request) contractPaymentsMessage('Не удалось загрузить оплаты: ' + err.message + '. Нажмите «Обновить».', true);
  }
}

// A retried request reuses its key, so a lost response cannot record a payment twice.
function contractPaymentKey(state, action, fingerprint) {
  if (state.keys[action]?.fingerprint !== fingerprint) state.keys[action] = { fingerprint, key: contractTemplateRequestKey() };
  return state.keys[action].key;
}

async function runContractPaymentAction(pending, request) {
  const state = contractPaymentsUI;
  if (!state?.data || state.busy) return;
  const controls = [...state.panel.querySelectorAll('button, input, textarea')];
  const before = controls.map(c => c.disabled);
  state.busy = true; ++state.request;
  controls.forEach(c => { c.disabled = true; });
  contractPaymentsMessage(pending);
  let data = null, error = '';
  try { data = await request(); }
  catch (err) { error = err.message; }
  finally { state.busy = false; controls.forEach((c, i) => { c.disabled = before[i]; }); }
  if (!contractPaymentsOpen(state)) return data ? null : showToast(error, 'red');
  if (!data) { contractPaymentsMessage(error, true); return; }
  state.keys = {}; state.data = data;
  syncContractPaymentsRecord(data);
  renderContractPayments(state);
  if (typeof renderEngagementsPage === 'function') renderEngagementsPage();
  return data;
}

function recordContractPayment(engagementId) {
  const state = contractPaymentsUI, data = state?.data;
  if (!data?.canRecord || state.engagementId !== engagementId) return;
  const field = id => state.panel.querySelector('#' + id);
  const file = field('contractPaymentFile').files[0];
  const values = { amount: field('contractPaymentAmount').value.trim(), paidDate: field('contractPaymentDate').value,
    paymentNumber: field('contractPaymentNumber').value.trim(), payer: field('contractPaymentPayer').value.trim(), note: field('contractPaymentNote').value.trim() };
  if (!file) return contractPaymentsMessage('Приложите платёжку', true);
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) return contractPaymentsMessage('Нужен PDF, JPG или PNG размером до 20 МиБ', true);
  if (!/^\d[\d\s ]*([.,]\d{1,2})?$/.test(values.amount) || !(Number(values.amount.replace(/[\s ]/g, '').replace(',', '.')) > 0)) return contractPaymentsMessage('Укажите сумму больше нуля, например 1 500 000,50', true);
  if (!values.paidDate || values.paidDate > data.today) return contractPaymentsMessage('Укажите дату оплаты — не позже сегодняшнего дня', true);
  if (!values.paymentNumber) return contractPaymentsMessage('Укажите номер платёжки', true);
  const requestKey = contractPaymentKey(state, 'record', JSON.stringify([file.name, file.size, file.lastModified, values]));
  return runContractPaymentAction('Сохраняем оплату…', async () => {
    const form = new FormData();
    for (const [name, value] of Object.entries(values)) form.append(name, value);
    form.append('requestKey', requestKey);
    form.append('file', file);
    const result = await (await contractDocumentFetch(`/api/engagements/${engagementId}/payments`, { method: 'POST', body: form })).json();
    state.panel.querySelector('.contract-payment-form').reset();
    const amount = Number(values.amount.replace(/[\s ]/g, '').replace(',', '.'));
    showToast(`Оплата ${fmtCurrency(amount, result.currency)} внесена. Оплачено всего: ${fmtCurrency(result.paid, result.currency)}`, 'green');
    return result;
  });
}

function voidContractPayment(engagementId, paymentId) {
  const state = contractPaymentsUI, payment = state?.data?.payments.find(p => p.id === paymentId);
  if (!state?.data?.canRecord || !payment || payment.status !== 'active') return;
  const reason = (prompt(`Аннулировать оплату № ${payment.paymentNumber} на ${fmtCurrency(payment.amount, payment.currency)}? Укажите причину — файл останется в истории.`) || '').trim();
  if (!reason) return;
  const requestKey = contractPaymentKey(state, 'void', JSON.stringify([paymentId, reason]));
  return runContractPaymentAction('Аннулируем оплату…', async () => {
    const result = await apiFetch(`/api/engagements/${engagementId}/payments/${paymentId}/void`, { method: 'POST', body: JSON.stringify({ reason, requestKey }) });
    showToast('Оплата аннулирована', 'orange');
    return result;
  });
}

async function downloadContractPayment(engagementId, paymentId, button) {
  const payment = contractPaymentsUI?.data?.payments.find(p => p.id === paymentId);
  if (!payment || button.disabled) return;
  button.disabled = true;
  try {
    const response = await contractDocumentFetch(`/api/engagements/${engagementId}/payments/${paymentId}/file`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = payment.name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { showToast('Не удалось скачать платёжку: ' + err.message, 'red'); }
  finally { button.disabled = false; }
}
