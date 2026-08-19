// ============================================================
//  distributions.js — Fund -> LP cash flow (the reverse of Capital Calls)
//  Populated at runtime by js/api-auth.js via GET /api/distributions
//  (distributionsLog, declared in js/lp-register.js). ROC splits pro-rata
//  by commitment (no carry); profit runs through the real waterfall
//  (server/waterfallEngine.js: preferred return -> GP catch-up -> carry
//  split) — the server computes the whole lineItems split automatically,
//  this page never builds one client-side. Status lifecycle mirrors
//  Capital Calls: Draft -> Sent (ccApprove permission, PUT status) ->
//  Paid (auto-set once every LP's line item is Confirmed); a line item
//  is Pending -> Confirmed (paymentConfirm permission, requires a real
//  wire reference + uploaded confirmation, same evidence bar as
//  markLPPayment()).
// ============================================================

let distFilter = '';   // search
let distStatusF = '';  // status filter
let activeDistId = null;

function renderDistributionsPage() {
  const el = document.getElementById('distributionsContent');
  if (!el) return;

  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  const fundDists = fundScoped ? distributionsLog.filter(d => d.fundId === activeFundId) : distributionsLog;
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));

  const nonDraft = fundDists.filter(d => d.status !== 'Draft');
  const totalNet   = nonDraft.reduce((s, d) => s + d.lineItems.reduce((ss, li) => ss + (li.netAmount || 0), 0), 0);
  const totalCarry = nonDraft.reduce((s, d) => s + d.lineItems.reduce((ss, li) => ss + (li.gpCarryAmount || 0), 0), 0);
  const draftCount = fundDists.filter(d => d.status === 'Draft').length;
  const pendingLineItems = fundDists.filter(d => d.status === 'Sent')
    .reduce((s, d) => s + d.lineItems.filter(li => li.status !== 'Confirmed').length, 0);

  let filtered = fundDists.filter(d => {
    if (distStatusF && d.status !== distStatusF) return false;
    if (distFilter && !d.distNumber.toLowerCase().includes(distFilter.toLowerCase()) &&
        !(d.notes || '').toLowerCase().includes(distFilter.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.noticeDate || b.paymentDate || 0) - new Date(a.noticeDate || a.paymentDate || 0));

  el.innerHTML = `
    <!-- KPI Row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${[
        { label:'Распределения (всего)', val: fundDists.length, sub:`${draftCount} черновиков`, color:'#22c55e', icon:'fa-hand-holding-usd' },
        { label:'Выплачено LP (нетто)',  val: fmtUSD(totalNet),  sub:'ROC + прибыль после carry', color:'#14b8a6', icon:'fa-arrow-down' },
        { label:'GP Carry',              val: fmtUSD(totalCarry), sub:'из отправленных распределений', color:'#8b5cf6', icon:'fa-percentage' },
        { label:'Ожидают подтверждения', val: pendingLineItems,  sub:'LP-строк без wire ref', color: pendingLineItems>0?'#f97316':'#22c55e', icon:'fa-clock' },
      ].map(k => `
        <div style="background:#1c3332;border-radius:10px;padding:14px 16px;border-top:3px solid ${k.color}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:30px;height:30px;background:${k.color}18;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <i class="fas ${k.icon}" style="color:${k.color};font-size:13px"></i>
            </div>
            <span style="font-size:11px;color:#8abfbb;font-weight:700;text-transform:uppercase">${k.label}</span>
          </div>
          <div style="font-size:20px;font-weight:800;color:#f1f5f9;margin-bottom:2px">${k.val}</div>
          <div style="font-size:11px;color:#64748b">${k.sub}</div>
        </div>`).join('')}
    </div>

    <!-- Toolbar -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px">
      <div style="position:relative;flex:1;min-width:180px">
        <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#4a5568;font-size:12px"></i>
        <input type="text" placeholder="Поиск распределений..." value="${distFilter}"
          oninput="distFilter=this.value;renderDistributionsPage()"
          style="width:100%;background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:8px 12px 8px 32px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
      </div>
      <select onchange="distStatusF=this.value;renderDistributionsPage()"
        style="background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px">
        <option value="">Все статусы</option>
        <option value="Draft"     ${distStatusF==='Draft'?'selected':''}>📝 Черновик</option>
        <option value="Sent"      ${distStatusF==='Sent'?'selected':''}>📤 Отправлено</option>
        <option value="Paid"      ${distStatusF==='Paid'?'selected':''}>✅ Оплачено</option>
      </select>
      <button onclick="openNewDistModal()"
        style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:9px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;white-space:nowrap">
        <i class="fas fa-plus" style="margin-right:6px"></i>Новое распределение
      </button>
    </div>

    <!-- Distributions Table -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-hand-holding-usd" style="color:#22c55e;margin-right:6px"></i>Журнал распределений</span>
        <span style="font-size:12px;color:#8abfbb">${filtered.length} записей</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Dist №</th>
              <th>Дата уведомления</th>
              <th>Дата платежа</th>
              <th>Сумма</th>
              <th>ROC</th>
              <th>Прибыль</th>
              <th>GP Carry</th>
              <th>Источник</th>
              <th>Статус</th>
              <th style="text-align:center">LP</th>
              <th style="text-align:center">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="11" style="text-align:center;padding:32px;color:#4a5568">Распределений не найдено</td></tr>` :
              filtered.map(d => {
                const carry = d.lineItems.reduce((s, li) => s + (li.gpCarryAmount || 0), 0);
                const confirmed = d.lineItems.filter(li => li.status === 'Confirmed').length;
                return `
                <tr onclick="openDistDetail(${d.id})" style="cursor:pointer">
                  <td style="font-size:11px;color:#22c55e;font-weight:700">${d.distNumber}</td>
                  <td style="font-size:12px;color:#94a3b8">${d.noticeDate || '—'}</td>
                  <td style="font-size:12px;color:#94a3b8">${d.paymentDate || '—'}</td>
                  <td style="font-size:13px;font-weight:700;color:#22c55e">${fmtUSD(d.totalAmount)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtUSD(d.rocAmount)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtUSD(d.profitAmount)}</td>
                  <td style="font-size:12px;color:#8b5cf6">${fmtUSD(carry)}</td>
                  <td style="font-size:11px;color:#94a3b8">${distSourceLabel(d.sourceType)}</td>
                  <td>${ccStatusBadge(d.status)}</td>
                  <td style="text-align:center">
                    <div style="display:flex;flex-direction:column;gap:2px;align-items:center">
                      <div style="font-size:11px;font-weight:700;color:#e2e8f0">${d.lineItems.length} LP</div>
                      <div style="font-size:10px;color:${confirmed===d.lineItems.length?'#22c55e':'#f97316'}">${confirmed}/${d.lineItems.length} подтвердили</div>
                    </div>
                  </td>
                  <td style="text-align:center">
                    <button onclick="event.stopPropagation();openDistDetail(${d.id})"
                      style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">
                      <i class="fas fa-list-ul"></i>
                    </button>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#0f1623;border-top:2px solid #2a4846">
              <td colspan="3" style="padding:10px 12px;font-size:11px;font-weight:700;color:#8abfbb;text-transform:uppercase">ИТОГО по журналу</td>
              <td style="padding:10px 12px;font-size:14px;font-weight:800;color:#22c55e">${fmtUSD(filtered.reduce((s,d)=>s+d.totalAmount,0))}</td>
              <td style="padding:10px 12px;font-size:12px;color:#94a3b8">${fmtUSD(filtered.reduce((s,d)=>s+d.rocAmount,0))}</td>
              <td style="padding:10px 12px;font-size:12px;color:#94a3b8">${fmtUSD(filtered.reduce((s,d)=>s+d.profitAmount,0))}</td>
              <td style="padding:10px 12px;font-size:12px;color:#8b5cf6">${fmtUSD(filtered.reduce((s,d)=>s+d.lineItems.reduce((ss,li)=>ss+(li.gpCarryAmount||0),0),0))}</td>
              <td colspan="2" style="padding:10px 12px;font-size:11px;color:#64748b">${filtered.length} распределений</td>
              <td style="padding:10px 12px;font-size:11px;color:#64748b;text-align:center">${filtered.reduce((s,d)=>s+d.lineItems.length,0)} LP-строк</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function distSourceLabel(sourceType) {
  return {
    dividend: 'Дивиденды', exit: 'Exit / Продажа', interest: 'Процентный доход',
    recap: 'Рекапитализация', other: 'Другое',
  }[sourceType] || (sourceType || '—');
}

/* ═══════════════════════════════════════════════════════════
   DISTRIBUTION DETAIL MODAL
═══════════════════════════════════════════════════════════ */

function openDistDetail(distId) {
  const d = distributionsLog.find(x => x.id === distId);
  if (!d) return;
  activeDistId = distId;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(d));

  const carry = d.lineItems.reduce((s, li) => s + (li.gpCarryAmount || 0), 0);
  const net   = d.lineItems.reduce((s, li) => s + (li.netAmount || 0), 0);

  const modal   = document.getElementById('modal-dist-detail');
  const overlay = document.getElementById('distDetailOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('distDetailContent').innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #2a4846">
      <div style="width:46px;height:46px;background:rgba(34,197,94,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center">
        <i class="fas fa-hand-holding-usd" style="color:#22c55e;font-size:18px"></i>
      </div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:17px;font-weight:800;color:#f1f5f9">${d.distNumber}</span>
          ${ccStatusBadge(d.status)}
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:3px">${distSourceLabel(d.sourceType)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:800;color:#22c55e">${fmtUSD(d.totalAmount)}</div>
        <div style="font-size:11px;color:#64748b">${fmtUSD(net)} нетто LP · ${fmtUSD(carry)} carry</div>
      </div>
    </div>

    ${d.status === 'Draft' ? (
      currentUserPermission('ccApprove')
        ? `<div style="background:rgba(100,116,139,0.08);border:1px solid rgba(100,116,139,0.3);border-radius:10px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div style="font-size:12px;color:#94a3b8"><i class="fas fa-file-signature" style="margin-right:6px;color:#94a3b8"></i>Черновик — ещё не отправлен ни одному LP. Проверьте сумму и разбивку перед подтверждением.</div>
            <button onclick="approveDist(${distId})"
              style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:7px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap">
              <i class="fas fa-check" style="margin-right:5px"></i>Подтвердить и отправить
            </button>
          </div>`
        : `<div style="background:rgba(100,116,139,0.08);border:1px solid rgba(100,116,139,0.3);border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:#94a3b8">
            <i class="fas fa-file-signature" style="margin-right:6px"></i>Черновик — ожидает подтверждения CFO/CEO перед отправкой LP.
          </div>`
    ) : ''}

    <!-- Summary Row -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
      ${[
        { label:'Дата уведомления', val:d.noticeDate||'—', color:'#94a3b8' },
        { label:'Дата платежа',     val:d.paymentDate||'—', color:'#22c55e' },
        { label:'Источник',         val:distSourceLabel(d.sourceType), color:'#8b5cf6' },
        { label:'Return of Capital', val:fmtUSD(d.rocAmount), color:'#14b8a6' },
        { label:'Прибыль (до waterfall)', val:fmtUSD(d.profitAmount), color:'#f97316' },
        { label:'Создал',           val:d.createdBy||'—', color:'#94a3b8' },
      ].map(k => `
        <div style="background:#0f1623;border-radius:8px;padding:8px 12px">
          <div style="font-size:10px;color:#5a8a85;text-transform:uppercase;font-weight:700;margin-bottom:2px">${k.label}</div>
          <div style="font-size:12px;font-weight:700;color:${k.color}">${k.val}</div>
        </div>`).join('')}
    </div>

    <!-- LP Line Items -->
    <div style="font-size:11px;font-weight:700;color:#22c55e;text-transform:uppercase;margin-bottom:10px">
      <i class="fas fa-users" style="margin-right:5px"></i>Разбивка по LP (${d.lineItems.length} участников)
      ${d.profitAmount > 0 ? '<span style="color:#8b5cf6;font-weight:400;text-transform:none;margin-left:6px">— прибыль прошла через waterfall (preferred return → GP catch-up → carry)</span>' : ''}
    </div>
    <div style="border-radius:10px;overflow:hidden;border:1px solid #2a4846;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse">
        <thead style="background:#131c2e">
          <tr style="font-size:10px;font-weight:700;color:#5a8a85;text-transform:uppercase">
            <th style="padding:8px 10px;text-align:left">LP</th>
            <th style="padding:8px 10px;text-align:right">%</th>
            <th style="padding:8px 10px;text-align:right">Gross</th>
            <th style="padding:8px 10px;text-align:right">GP Carry</th>
            <th style="padding:8px 10px;text-align:right">Net</th>
            <th style="padding:8px 10px;text-align:left">Дата платежа</th>
            <th style="padding:8px 10px;text-align:left">Wire Ref</th>
            <th style="padding:8px 10px;text-align:center">Статус</th>
          </tr>
        </thead>
        <tbody>
          ${d.lineItems.map((li, i) => `
            <tr style="border-top:1px solid #1e293b;${i%2===0?'':'background:rgba(255,255,255,0.01)'}">
              <td style="padding:8px 10px">
                <div style="font-size:12px;font-weight:700;color:#e2e8f0">${li.lpName}</div>
                <div style="font-size:10px;color:#64748b">LP-ID: ${li.lpId}</div>
              </td>
              <td style="padding:8px 10px;font-size:12px;color:#94a3b8;text-align:right">${(li.pct||0).toFixed(2)}%</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#e2e8f0;text-align:right">${fmtUSD(li.grossAmount)}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#8b5cf6;text-align:right">${li.gpCarryAmount>0?fmtUSD(li.gpCarryAmount):'—'}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#22c55e;text-align:right">${fmtUSD(li.netAmount)}</td>
              <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${li.paymentDate||'—'}</td>
              <td style="padding:8px 10px;font-size:10px;color:#64748b">
                ${li.wireRef||'—'}
                ${li.wireConfirmUrl ? `<i class="fas fa-eye" style="color:#a78bfa;margin-left:5px;cursor:pointer" onclick="_obOpenPreviewModal('${resolveDocUrl(li.wireConfirmUrl).replace(/'/g,"\\'")}','${resolveDocUrl(li.wireConfirmUrl).replace(/'/g,"\\'")}')" title="Открыть подтверждающий документ"></i>` : ''}
              </td>
              <td style="padding:8px 10px;text-align:center">
                ${li.status==='Pending' && d.status==='Sent'
                  ? (currentUserPermission('paymentConfirm')
                      ? `<button onclick="confirmDistPayment(${distId}, ${li.lpId})"
                          style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700">
                          Подтвердить ✓
                        </button>`
                      : `<span style="font-size:9px;color:#5a8a85;font-style:italic">Ожидает CFO/CEO</span>`)
                  : ccStatusBadge(li.status)}
              </td>
            </tr>`).join('')}
        </tbody>
        <tfoot style="background:#131c2e">
          <tr>
            <td colspan="2" style="padding:8px 10px;font-size:11px;font-weight:700;color:#8abfbb">ИТОГО</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#e2e8f0;text-align:right">${fmtUSD(d.lineItems.reduce((s,li)=>s+li.grossAmount,0))}</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#8b5cf6;text-align:right">${fmtUSD(carry)}</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#22c55e;text-align:right">${fmtUSD(net)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${d.notes ? `<div style="background:#1c3332;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#94a3b8;border-left:3px solid #22c55e"><i class="fas fa-sticky-note" style="margin-right:6px;color:#22c55e"></i>${escapeHtml(d.notes)}</div>` : ''}

    <!-- Footer -->
    <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;padding-top:14px;border-top:1px solid #2a4846">
      <div>
        ${d.status === 'Draft' ? `
        <button onclick="deleteDist(${distId})"
          style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-trash"></i> Удалить черновик
        </button>` : ''}
      </div>
      <button onclick="closeDistDetail()"
        style="background:#14b8a6;border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Закрыть</button>
    </div>`;

  modal.style.display = 'flex';
}

function closeDistDetail() {
  const modal   = document.getElementById('modal-dist-detail');
  const overlay = document.getElementById('distDetailOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function deleteDist(distId) {
  const d = distributionsLog.find(x => x.id === distId);
  if (!d) return;
  if (!confirm(`Удалить черновик распределения ${d.distNumber}? Возможно только для черновиков, ещё не отправленных LP.`)) return;
  try {
    await apiFetch(`/api/distributions/${distId}`, { method: 'DELETE' });
    distributionsLog = distributionsLog.filter(x => x.id !== distId);
    closeDistDetail();
    renderDistributionsPage();
    showToast('✅ Черновик распределения удалён', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

// Draft -> Sent is the moment a distribution becomes a real payment
// commitment to every LP on it — server-gated behind ccApprove (CEO/CFO
// by default, reused from Capital Calls, server/index.js), same as this
// button only rendering for those roles (openDistDetail()).
async function approveDist(distId) {
  const d = distributionsLog.find(x => x.id === distId);
  if (!d || d.status !== 'Draft') return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(d));
  if (!confirm(`Подтвердить и отправить распределение ${d.distNumber} на ${fmtUSD(d.totalAmount)} (${d.lineItems.length} LP)? Это реальная выплата LP — отменить нельзя.`)) return;

  try {
    const updated = await apiFetch(`/api/distributions/${distId}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });
    Object.assign(d, updated);
    showToast(`✅ Распределение ${d.distNumber} подтверждено и отправлено · ${fmtUSD(d.totalAmount)}`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось подтвердить распределение: ' + err.message, 'red');
    return;
  }
  openDistDetail(distId);
  renderDistributionsPage();
}

// Confirming a distribution payment is a bank-reconciliation judgment
// (paymentConfirm, CFO/CEO by default) and requires real evidence — a
// wire reference and a link to the payment order/SWIFT confirmation,
// same evidence bar as markLPPayment() (js/lp-register.js). Unlike a
// Capital Call line item, a distribution line item has no separate
// "paid amount" to enter — netAmount was already fixed at creation, this
// only flips Pending -> Confirmed and attaches proof.
async function confirmDistPayment(distId, lpId) {
  const d = distributionsLog.find(x => x.id === distId);
  if (!d) return;
  const li = d.lineItems.find(x => x.lpId === lpId);
  if (!li) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(d));

  if (!currentUserPermission('paymentConfirm')) {
    showToast('⛔ Подтверждать выплаты может только CFO/CEO', 'red');
    return;
  }

  const wireRef = prompt(`Номер платёжного поручения (wire reference) для выплаты ${li.lpName} на сумму ${fmtUSD(li.netAmount)}:`);
  if (!wireRef || !wireRef.trim()) { showToast('⚠ Отменено — номер платёжного поручения обязателен', 'red'); return; }

  showToast('📎 Выберите файл платёжного поручения (PDF/скан)...', 'blue');
  const file = await pickFile('.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx');
  if (!file) { showToast('⚠ Отменено — файл подтверждающего документа обязателен', 'red'); return; }

  let wireConfirmUrl;
  try {
    const uploaded = await uploadFile(file);
    wireConfirmUrl = uploaded.url;
  } catch (err) {
    showToast('⚠️ Не удалось загрузить файл: ' + err.message, 'red');
    return;
  }

  if (!confirm(`Подтвердить выплату ${li.lpName} на сумму ${fmtUSD(li.netAmount)}? Файл «${file.name}» будет прикреплён как подтверждение.`)) return;

  const lpName = li.lpName, netAmount = li.netAmount;
  try {
    const updated = await apiFetch(`/api/distributions/${distId}/line-items/${lpId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'Confirmed', paymentDate: today(),
        wireRef: wireRef.trim(), wireConfirmUrl: wireConfirmUrl.trim(),
      }),
    });
    Object.assign(d, updated);

    // No server-side auto-close on the parent (unlike Capital Calls'
    // Completed transition, which the server also leaves to the client)
    // — mirror the same pattern here once every LP has confirmed.
    const allConfirmed = d.lineItems.every(x => x.status === 'Confirmed');
    if (allConfirmed) {
      const closed = await apiFetch(`/api/distributions/${distId}`, { method: 'PUT', body: JSON.stringify({ status: 'Paid' }) });
      Object.assign(d, closed);
      showToast(`✅ Выплата ${lpName} · ${fmtUSD(netAmount)} · Распределение ${d.distNumber} закрыто — все LP подтвердили`, 'green');
    } else {
      const confirmed = d.lineItems.filter(x => x.status === 'Confirmed').length;
      showToast(`✅ Выплата подтверждена для ${lpName} · ${fmtUSD(netAmount)} · ${confirmed}/${d.lineItems.length} LP подтвердили`, 'green');
    }
  } catch (err) {
    showToast('⚠️ Не удалось сохранить выплату: ' + err.message, 'red');
    return;
  }
  openDistDetail(distId);
  renderDistributionsPage();
}

/* ═══════════════════════════════════════════════════════════
   NEW DISTRIBUTION — fund-level, no manual line items
   Scoped to the currently active fund (sidebar switcher), the same way
   the Distributions/Capital Calls pages themselves are scoped — no
   separate fund picker inside the modal. Line items are never entered
   here: the server always computes them (pro-rata for pure ROC, the real
   waterfall once profitAmount > 0 — see server/index.js's
   POST /api/distributions).
═══════════════════════════════════════════════════════════ */

function closeNewDistModal() {
  const modal   = document.getElementById('modal-dist-new');
  const overlay = document.getElementById('distNewOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

function openNewDistModal() {
  if (typeof activeFundId === 'undefined' || activeFundId == null) {
    showToast('⚠ Сначала выберите фонд в переключателе сверху', 'red');
    return;
  }
  const fund = getActiveFund();
  if (!fund) return;

  const noticeDate = today();
  const inpStyle = `width:100%;background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box`;
  const lblStyle = `font-size:11px;font-weight:700;color:#8abfbb;display:block;margin-bottom:4px;text-transform:uppercase`;
  const grpStyle = `margin-bottom:14px`;

  const scopedPortfolio = (typeof portfolio !== 'undefined' ? portfolio : []).filter(p => p.fundId === fund.id);
  const hasCarryTerms = fund.carriedInterest > 0;

  const modal   = document.getElementById('modal-dist-new');
  const overlay = document.getElementById('distNewOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('distNewContent').innerHTML = `
    <div style="font-size:16px;font-weight:800;color:#f1f5f9;margin-bottom:6px;display:flex;align-items:center;gap:10px">
      <i class="fas fa-hand-holding-usd" style="color:#22c55e"></i> Новое распределение — ${escapeHtml(fund.name)}
    </div>
    <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:11px;color:#94a3b8">
      <i class="fas fa-info-circle" style="margin-right:6px;color:#22c55e"></i>
      Разбивка по LP считается автоматически: Return of Capital — pro-rata по commitment; Прибыль — через waterfall
      (preferred return → GP catch-up → carry split).
      ${hasCarryTerms
        ? `Условия фонда: preferred return ${fund.preferredReturn||0}%, carry ${fund.carriedInterest}%, catch-up ${fund.catchUpPct!=null?fund.catchUpPct:100}%.`
        : `<span style="color:#f97316">Внимание: у фонда не задан carriedInterest — прибыль будет распределена без carry (100% LP).</span>`}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="${grpStyle}"><label style="${lblStyle}">Дата уведомления</label>
        <input type="date" id="dist_noticeDate" value="${noticeDate}" style="${inpStyle}" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Дата платежа</label>
        <input type="date" id="dist_payDate" value="${noticeDate}" style="${inpStyle}" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Return of Capital</label>
        <input type="number" id="dist_rocAmount" min="0" step="1000" value="0" style="${inpStyle}" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Прибыль (до waterfall)</label>
        <input type="number" id="dist_profitAmount" min="0" step="1000" value="0" style="${inpStyle}" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Источник</label>
        <select id="dist_sourceType" style="${inpStyle}">
          <option value="dividend">Дивиденды</option>
          <option value="exit">Exit / Продажа портфельной компании</option>
          <option value="interest">Процентный доход</option>
          <option value="recap">Рекапитализация</option>
          <option value="other">Другое</option>
        </select></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Портфельная компания (опционально)</label>
        <select id="dist_sourcePortfolioId" style="${inpStyle}">
          <option value="">—</option>
          ${scopedPortfolio.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select></div>

      <div style="${grpStyle};grid-column:1/-1"><label style="${lblStyle}">Примечание</label>
        <input type="text" id="dist_notes" style="${inpStyle}" placeholder="Доп. информация..." /></div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeNewDistModal()"
        style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveNewDist(${fund.id})"
        style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-file-signature" style="margin-right:6px"></i>Сохранить как черновик
      </button>
    </div>`;

  modal.style.display = 'flex';
}

async function saveNewDist(fundId) {
  const fund = (typeof funds !== 'undefined' ? funds : []).find(f => f.id === fundId);
  if (!fund) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(fundId));

  const rocAmount     = parseFloat(document.getElementById('dist_rocAmount')?.value) || 0;
  const profitAmount  = parseFloat(document.getElementById('dist_profitAmount')?.value) || 0;
  if (rocAmount <= 0 && profitAmount <= 0) { showToast('⚠ Укажите сумму ROC и/или прибыли', 'red'); return; }

  const noticeDate = document.getElementById('dist_noticeDate')?.value || today();
  const payDate    = document.getElementById('dist_payDate')?.value    || noticeDate;
  const sourceType = document.getElementById('dist_sourceType')?.value || 'other';
  const sourcePortfolioId = document.getElementById('dist_sourcePortfolioId')?.value || null;
  const notes      = document.getElementById('dist_notes')?.value      || '';

  // status/lineItems omitted on purpose: the server always forces Draft
  // and — since no lineItems is supplied — computes the pro-rata/waterfall
  // split itself (server/index.js, server/waterfallEngine.js).
  const newDist = {
    fundId, noticeDate, paymentDate: payDate,
    rocAmount, profitAmount, sourceType,
    sourcePortfolioId: sourcePortfolioId ? Number(sourcePortfolioId) : null,
    createdBy: currentUserDisplayName(), notes,
  };

  try {
    const created = await apiFetch('/api/distributions', { method: 'POST', body: JSON.stringify(newDist) });
    distributionsLog.push(created);
    closeNewDistModal();
    showToast(`📝 Распределение ${created.distNumber} сохранено как черновик · ${fmtUSD(created.totalAmount)} — требует подтверждения CFO/CEO`, 'blue');
    renderDistributionsPage();
    openDistDetail(created.id);
  } catch (err) {
    showToast('⚠️ Не удалось создать распределение: ' + err.message, 'red');
  }
}
