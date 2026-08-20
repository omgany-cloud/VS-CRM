// ============================================================
//  bank-reconciliation.js — CSV bank statement import + matching
//  against open Capital Call line items ("Сверка с выпиской" button,
//  Capital Calls page). Purely client-side parsing/matching
//  (capitalCallsLog is already loaded in memory for that page's own
//  table); confirming a match goes through the EXISTING
//  PUT /api/capital-calls/:id/line-items/:lpId route unchanged — same
//  evidence requirement (wireRef + wireConfirmUrl) as a manually
//  confirmed payment (markLPPayment(), same file), just filled in from
//  the imported statement instead of typed by hand: wireRef is the
//  bank's own transaction reference, wireConfirmUrl is the ONE uploaded
//  statement file shared across every match confirmed from it (the
//  statement itself is the evidence for all of them).
// ============================================================

let _bankReconTransactions = []; // parsed rows + suggested/chosen match, index-addressable
let _bankReconOpenItems = [];
let _bankReconStatementUrl = null;

/* ── CSV parsing ──────────────────────────────────────────── */

// Auto-detects delimiter (comma vs semicolon — KZ/RU-locale exports often
// use ';' since Excel reserves ',' as the decimal separator there) and
// column headers by common name in either English or Russian. No fixed
// bank format assumed on purpose — this is a flexible, "any bank's CSV
// export" reader, not a parser tied to one specific bank's layout.
function parseBankStatementCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const splitRow = (line) => line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));

  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const findCol = (...names) => header.findIndex(h => names.some(n => h.includes(n)));
  const dateCol = findCol('date', 'дата');
  const amountCol = findCol('amount', 'сумма', 'credit', 'кредит', 'приход', 'поступлен');
  const refCol = findCol('reference', 'referen', 'референс', 'назначение', 'описание', 'details', 'purpose', 'комментарий');

  if (dateCol === -1 || amountCol === -1) return []; // can't parse without at least date+amount

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length <= Math.max(dateCol, amountCol)) continue;
    const rawAmount = (cells[amountCol] || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const amount = parseFloat(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue; // ignore outgoing/zero/unparseable rows
    rows.push({
      date: normalizeBankDate(cells[dateCol]),
      amount,
      reference: refCol !== -1 ? (cells[refCol] || '') : '',
      raw: cells.join(' '),
    });
  }
  return rows;
}

// Accepts YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY — the shapes a KZ/RU bank
// export or a plain ISO date are actually likely to use. Falls back to
// the original string if nothing matches (still usable for display/
// reference-text matching even if date-proximity scoring can't use it).
function normalizeBankDate(raw) {
  const s = (raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

/* ── Matching ─────────────────────────────────────────────── */

// Only Pending (sent, real) Capital Calls count — a Draft was never sent
// to any LP (same "Draft = not real yet" convention used throughout this
// app), and only line items not already Paid are candidates.
function getOpenCapitalCallLineItems() {
  const items = [];
  (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : [])
    .filter(cc => cc.status === 'Pending')
    .forEach(cc => {
      (cc.lineItems || []).forEach(li => {
        if (li.status === 'Paid') return;
        items.push({ ccId: cc.id, ccNumber: cc.ccNumber, lpId: li.lpId, lpName: li.lpName, called: li.called, paymentDate: cc.paymentDate });
      });
    });
  return items;
}

function _bankReconDaysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

// Deterministic, explainable score — no fuzzy-matching library, just
// amount + reference-text + date-proximity signals, each independently
// hand-verifiable from the matched pair. >=5 is auto-checked in the
// review table ("high confidence"); 1-4 is suggested but left for the
// admin to confirm; 0 means no real candidate.
function scoreBankMatch(txn, item) {
  let score = 0;
  const amountDiff = Math.abs(txn.amount - item.called);
  if (amountDiff < 0.01) score += 3;
  else if (item.called > 0 && amountDiff / item.called < 0.01) score += 1;

  const ref = (txn.reference || txn.raw || '').toLowerCase();
  if (item.ccNumber && ref.includes(item.ccNumber.toLowerCase())) score += 3;
  if (item.lpName && ref.includes(item.lpName.toLowerCase())) score += 2;

  if (txn.date && item.paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
    if (_bankReconDaysBetween(txn.date, item.paymentDate) <= 15) score += 1;
  }
  return score;
}

// Greedy assignment: score every (transaction, open line item) pair,
// assign highest-scoring pairs first, each transaction and each line
// item used at most once — avoids two different transactions both
// claiming the same open call, or one transaction "matching" two calls.
function matchTransactionsToLineItems(transactions, openItems) {
  const pairs = [];
  transactions.forEach((txn, tIdx) => {
    openItems.forEach((item, iIdx) => {
      const score = scoreBankMatch(txn, item);
      if (score > 0) pairs.push({ tIdx, iIdx, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const usedTxn = new Set(), usedItem = new Set();
  const assigned = new Map(); // tIdx -> { item, score }
  pairs.forEach(p => {
    if (usedTxn.has(p.tIdx) || usedItem.has(p.iIdx)) return;
    usedTxn.add(p.tIdx); usedItem.add(p.iIdx);
    assigned.set(p.tIdx, { item: openItems[p.iIdx], score: p.score });
  });

  return transactions.map((txn, tIdx) => {
    const match = assigned.get(tIdx);
    return {
      ...txn,
      suggestedItem: match ? match.item : null,
      score: match ? match.score : 0,
      confidence: !match ? 'none' : match.score >= 5 ? 'high' : 'medium',
    };
  });
}

/* ── Modal / review UI ────────────────────────────────────── */

function closeBankReconciliationModal() {
  const modal = document.getElementById('modal-bank-recon');
  const overlay = document.getElementById('bankReconOverlay');
  if (modal) modal.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function openBankReconciliationModal() {
  if (!currentUserPermission('paymentConfirm')) {
    showToast('⛔ Сверка платежей доступна только CFO/CEO', 'red');
    return;
  }
  _bankReconTransactions = [];
  _bankReconOpenItems = [];
  _bankReconStatementUrl = null;

  const modal = document.getElementById('modal-bank-recon');
  const overlay = document.getElementById('bankReconOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  renderBankReconStep1();
  modal.style.display = 'flex';
}

function renderBankReconStep1() {
  document.getElementById('bankReconContent').innerHTML = `
    <div style="text-align:center;padding:32px 16px">
      <i class="fas fa-file-csv" style="font-size:36px;color:#a78bfa;margin-bottom:14px"></i>
      <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:6px">Загрузите банковскую выписку (CSV)</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:20px;max-width:480px;margin-left:auto;margin-right:auto">
        Нужны колонки: дата, сумма поступления, референс/назначение платежа. Разделитель (запятая или точка с запятой) и формат даты определяются автоматически.
      </div>
      <button onclick="pickBankStatementFile()"
        style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);border:none;color:#fff;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-upload" style="margin-right:8px"></i>Выбрать файл
      </button>
    </div>`;
}

async function pickBankStatementFile() {
  const file = await pickFile('.csv,.txt');
  if (!file) return;

  const text = await file.text();
  const rows = parseBankStatementCsv(text);
  if (!rows.length) {
    showToast('⚠ Не удалось распознать колонки даты/суммы в файле', 'red');
    return;
  }

  document.getElementById('bankReconContent').innerHTML = `<div style="text-align:center;padding:32px;color:#8abfbb"><i class="fas fa-spinner fa-spin" style="margin-right:8px"></i>Загрузка и сопоставление...</div>`;

  try {
    const uploaded = await uploadFile(file);
    _bankReconStatementUrl = uploaded.url;
  } catch (err) {
    showToast('⚠️ Не удалось загрузить файл выписки: ' + err.message, 'red');
    renderBankReconStep1();
    return;
  }

  _bankReconOpenItems = getOpenCapitalCallLineItems();
  _bankReconTransactions = matchTransactionsToLineItems(rows, _bankReconOpenItems).map((t, i) => ({
    ...t, idx: i, selected: t.confidence === 'high', chosenItem: t.suggestedItem,
  }));
  renderBankReconReview();
}

function bankReconToggleRow(idx, checked) {
  const t = _bankReconTransactions[idx];
  if (!t) return;
  t.selected = checked;
}

function bankReconChooseItem(idx, itemIdxStr) {
  const t = _bankReconTransactions[idx];
  if (!t) return;
  const itemIdx = itemIdxStr === '' ? -1 : parseInt(itemIdxStr, 10);
  t.chosenItem = itemIdx >= 0 ? _bankReconOpenItems[itemIdx] : null;
  t.selected = !!t.chosenItem;
  renderBankReconReview();
}

function renderBankReconReview() {
  const fmtUSD = (n) => (typeof fmtCurrency === 'function' ? fmtCurrency(n, 'USD') : ('$' + Number(n).toLocaleString()));
  const confidenceBadge = (c) => ({
    high:   '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(34,197,94,0.12);color:#22c55e">Высокая</span>',
    medium: '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(234,179,8,0.12);color:#eab308">Возможно</span>',
    none:   '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(100,116,139,0.12);color:#94a3b8">Не найдено</span>',
  })[c] || '';

  const matchedCount = _bankReconTransactions.filter(t => t.selected && t.chosenItem).length;

  document.getElementById('bankReconContent').innerHTML = `
    <div style="font-size:12px;color:#94a3b8;margin-bottom:14px">
      Строк в выписке: <b style="color:#e2e8f0">${_bankReconTransactions.length}</b> ·
      Открытых позиций Capital Call: <b style="color:#e2e8f0">${_bankReconOpenItems.length}</b> ·
      Готово к подтверждению: <b style="color:#22c55e">${matchedCount}</b>
    </div>
    <div style="border-radius:10px;overflow:hidden;border:1px solid #2a4846;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse">
        <thead style="background:#131c2e">
          <tr style="font-size:10px;font-weight:700;color:#5a8a85;text-transform:uppercase">
            <th style="padding:8px 10px;text-align:center">✓</th>
            <th style="padding:8px 10px;text-align:left">Дата</th>
            <th style="padding:8px 10px;text-align:right">Сумма</th>
            <th style="padding:8px 10px;text-align:left">Референс из выписки</th>
            <th style="padding:8px 10px;text-align:left">Совпадение (LP · CC)</th>
            <th style="padding:8px 10px;text-align:center">Уверенность</th>
          </tr>
        </thead>
        <tbody>
          ${_bankReconTransactions.map(t => `
            <tr style="border-top:1px solid #1e293b">
              <td style="padding:8px 10px;text-align:center">
                <input type="checkbox" ${t.selected ? 'checked' : ''} ${!t.chosenItem ? 'disabled' : ''}
                  onchange="bankReconToggleRow(${t.idx}, this.checked)" />
              </td>
              <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${escapeHtml(t.date || '—')}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#22c55e;text-align:right">${fmtUSD(t.amount)}</td>
              <td style="padding:8px 10px;font-size:11px;color:#64748b;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.reference || t.raw || '')}">${escapeHtml(t.reference || t.raw || '—')}</td>
              <td style="padding:8px 10px;font-size:12px">
                <select onchange="bankReconChooseItem(${t.idx}, this.value)"
                  style="background:#0f1623;border:1px solid #2a4846;border-radius:6px;padding:4px 8px;color:#e2e8f0;font-size:11px;max-width:230px">
                  <option value="">— не выбрано —</option>
                  ${_bankReconOpenItems.map((it, ii) => `<option value="${ii}" ${t.chosenItem && t.chosenItem.ccId === it.ccId && t.chosenItem.lpId === it.lpId ? 'selected' : ''}>${escapeHtml(it.lpName)} · ${escapeHtml(it.ccNumber)} · ${fmtUSD(it.called)}</option>`).join('')}
                </select>
              </td>
              <td style="padding:8px 10px;text-align:center">${confidenceBadge(t.confidence)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeBankReconciliationModal()"
        style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="confirmBankReconMatches()"
        style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-check-double" style="margin-right:6px"></i>Подтвердить выбранные (${matchedCount})
      </button>
    </div>`;
}

// Confirms each checked+matched row through the EXISTING, unchanged
// PUT /api/capital-calls/:id/line-items/:lpId route (same evidence
// requirement as markLPPayment()) — this file never talks to a new
// endpoint, it just fills that same form's fields in bulk from the
// statement. Mirrors markLPPayment()'s own "auto-close the Capital Call
// once every LP has paid" step for every call touched in this batch.
async function confirmBankReconMatches() {
  const toConfirm = _bankReconTransactions.filter(t => t.selected && t.chosenItem);
  if (!toConfirm.length) { showToast('⚠ Нет выбранных совпадений для подтверждения', 'red'); return; }
  if (!_bankReconStatementUrl) { showToast('⚠ Файл выписки не загружен', 'red'); return; }
  if (!confirm(`Подтвердить ${toConfirm.length} платеж(ей) по выписке? Каждый будет отмечен как оплаченный.`)) return;

  let ok = 0, failed = 0;
  const touchedCcIds = new Set();
  for (const t of toConfirm) {
    try {
      await apiFetch(`/api/capital-calls/${t.chosenItem.ccId}/line-items/${t.chosenItem.lpId}`, {
        method: 'PUT',
        body: JSON.stringify({
          paid: t.chosenItem.called, status: 'Paid', paymentDate: t.date || today(),
          wireRef: t.reference || t.raw || ('Bank import ' + (t.date || today())),
          wireConfirmUrl: _bankReconStatementUrl,
        }),
      });
      touchedCcIds.add(t.chosenItem.ccId);
      ok++;
    } catch (err) {
      failed++;
    }
  }

  await loadCapitalCallsFromApi();
  await loadLpRegisterFromApi();

  let closedCount = 0;
  for (const ccId of touchedCcIds) {
    const cc = capitalCallsLog.find(c => c.id === ccId);
    if (cc && cc.status !== 'Completed' && cc.lineItems.length && cc.lineItems.every(l => l.status === 'Paid')) {
      try {
        await apiFetch(`/api/capital-calls/${ccId}`, { method: 'PUT', body: JSON.stringify({ status: 'Completed' }) });
        closedCount++;
      } catch (err) { /* non-fatal — CC just stays Pending, still fully reflects reality */ }
    }
  }
  if (closedCount) await loadCapitalCallsFromApi();

  closeBankReconciliationModal();
  renderCapitalCallsPage();
  showToast(`✅ Подтверждено платежей: ${ok}${closedCount ? ` · закрыто CC: ${closedCount}` : ''}${failed ? ` · ошибок: ${failed}` : ''}`, failed ? 'orange' : 'green');
}
