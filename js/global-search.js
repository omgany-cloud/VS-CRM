// ============================================================
//  global-search.js — topbar search across LP Register, Deal Pipeline,
//  Portfolio, Engagements (Реестр договоров), Capital Calls,
//  Distributions, and Documents (via vault.js's own cross-module
//  aggregator). Purely client-side: every one of these arrays is already
//  loaded into memory for its own page's per-module filter (js/app.js's
//  filterDeals()/filterPortfolio(), js/lp-register.js's lpRegFilter/
//  ccFilter, js/distributions.js's distFilter, ...) — this just searches
//  across all of them at once instead of one at a time, so no new
//  backend endpoint is needed.
// ============================================================

let _globalSearchResults = []; // flat, index-addressable — see globalSearchResultClick()
let _globalSearchDebounceTimer = null;

// Documents need vault.js's async cross-module aggregator (bulk upload
// metadata fetch) — lazily triggered on first real use of global search,
// not on every page load, and cached the same way vault.js itself caches
// it (_vaultFilesCache, shared with the Vault page if the user opens it
// later — whichever runs first warms it for the other).
let _globalSearchVaultLoading = false;
async function ensureVaultCacheForGlobalSearch() {
  if (typeof _vaultFilesCache === 'undefined' || _vaultFilesCache.length > 0) return;
  if (_globalSearchVaultLoading || typeof vaultCollectAllFiles !== 'function') return;
  _globalSearchVaultLoading = true;
  try {
    _vaultFilesCache = await vaultCollectAllFiles();
  } catch (err) {
    console.error('Global search: failed to load documents:', err);
  }
  _globalSearchVaultLoading = false;
}

function computeGlobalSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];

  (typeof lpRegister !== 'undefined' ? lpRegister : []).forEach(lp => {
    if ((lp.name || '').toLowerCase().includes(q) || (lp.registerId || '').toLowerCase().includes(q)) {
      results.push({
        module: 'LP Register', color: '#14b8a6', icon: 'fa-book', title: lp.name, subtitle: lp.registerId,
        action: () => { navigateTo('lp-register'); setTimeout(() => openLPDetail(lp.id), 200); },
      });
    }
  });

  (typeof deals !== 'undefined' ? deals : []).forEach(d => {
    if ((d.company || '').toLowerCase().includes(q) || (d.sector || '').toLowerCase().includes(q)) {
      results.push({
        module: 'Сделки', color: '#f97316', icon: 'fa-handshake', title: d.company, subtitle: d.sector,
        action: () => { navigateTo('deals'); setTimeout(() => openDealDetailModal(d.id), 200); },
      });
    }
  });

  (typeof portfolio !== 'undefined' ? portfolio : []).forEach(p => {
    if ((p.name || '').toLowerCase().includes(q) || (p.sector || '').toLowerCase().includes(q)) {
      results.push({
        module: 'Portfolio', color: '#f97316', icon: 'fa-chart-pie', title: p.name, subtitle: p.sector,
        action: () => { navigateTo('portfolio'); setTimeout(() => openPortfolioModal(p.id), 200); },
      });
    }
  });

  (typeof engagements !== 'undefined' ? engagements : []).forEach(e => {
    if ((e.clientName || '').toLowerCase().includes(q) || (e.contractNum || '').toLowerCase().includes(q)) {
      results.push({
        module: 'Реестр договоров', color: '#22c55e', icon: 'fa-file-contract',
        title: e.clientName, subtitle: e.contractNum || e.serviceType || '',
        action: () => { navigateTo('engagements'); setTimeout(() => openEngagementModal(e.id), 200); },
      });
    }
  });

  (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : []).forEach(cc => {
    if ((cc.ccNumber || '').toLowerCase().includes(q) || (cc.purpose || '').toLowerCase().includes(q)) {
      results.push({
        module: 'Capital Calls', color: '#f97316', icon: 'fa-coins', title: cc.ccNumber, subtitle: cc.purpose,
        action: () => { navigateTo('lp-capital-calls'); setTimeout(() => openCCDetail(cc.id), 200); },
      });
    }
  });

  (typeof distributionsLog !== 'undefined' ? distributionsLog : []).forEach(d => {
    if ((d.distNumber || '').toLowerCase().includes(q)) {
      results.push({
        module: 'Distributions', color: '#22c55e', icon: 'fa-hand-holding-usd', title: d.distNumber,
        subtitle: typeof distSourceLabel === 'function' ? distSourceLabel(d.sourceType) : (d.sourceType || ''),
        action: () => { navigateTo('lp-distributions'); setTimeout(() => openDistDetail(d.id), 200); },
      });
    }
  });

  // Reuses each file's own goToSource() from vault.js's aggregator —
  // that already knows exactly how to get back to the right module/
  // record for every upload source (deals, portfolio, capital calls,
  // onboarding, ...), so global search doesn't need to reimplement it.
  (typeof _vaultFilesCache !== 'undefined' ? _vaultFilesCache : []).forEach(f => {
    if ((f.name || '').toLowerCase().includes(q) || (f.client || '').toLowerCase().includes(q)) {
      results.push({ module: 'Документы', color: '#14b8a6', icon: 'fa-folder-open', title: f.name, subtitle: f.client, action: f.goToSource });
    }
  });

  return results;
}

function onGlobalSearchInput(value) {
  clearTimeout(_globalSearchDebounceTimer);
  _globalSearchDebounceTimer = setTimeout(() => renderGlobalSearchResults(value), 150);
  // Warm the documents cache in the background — if it resolves while the
  // panel is still open with the same non-empty query, re-render to fold
  // document matches in without the user needing to type again.
  ensureVaultCacheForGlobalSearch().then(() => {
    const input = document.getElementById('globalSearchInput');
    if (input && input.value.trim()) renderGlobalSearchResults(input.value);
  });
}

function onGlobalSearchFocus() {
  const input = document.getElementById('globalSearchInput');
  if (input && input.value.trim()) renderGlobalSearchResults(input.value);
}

function closeGlobalSearchResults() {
  const panel = document.getElementById('globalSearchResults');
  if (panel) panel.style.display = 'none';
}

function renderGlobalSearchResults(query) {
  const panel = document.getElementById('globalSearchResults');
  if (!panel) return;
  if (!query.trim()) { panel.style.display = 'none'; return; }

  const results = computeGlobalSearchResults(query);
  results.forEach((r, i) => { r.idx = i; });
  _globalSearchResults = results;

  if (!results.length) {
    panel.innerHTML = `<div style="padding:16px;text-align:center;color:#64748b;font-size:12px">Ничего не найдено</div>`;
    panel.style.display = 'block';
    return;
  }

  const grouped = {};
  results.forEach(r => { (grouped[r.module] = grouped[r.module] || []).push(r); });
  const MAX_PER_GROUP = 6;

  panel.innerHTML = Object.entries(grouped).map(([module, items]) => `
    <div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:#5a8a85;text-transform:uppercase">${escapeHtml(module)} (${items.length})</div>
    ${items.slice(0, MAX_PER_GROUP).map(r => `
      <div onclick="globalSearchResultClick(${r.idx})"
        style="padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:10px"
        onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
        <i class="fas ${r.icon}" style="color:${r.color};width:16px;text-align:center;flex-shrink:0"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.title || '—')}</div>
          ${r.subtitle ? `<div style="font-size:10px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.subtitle)}</div>` : ''}
        </div>
      </div>
    `).join('')}
  `).join('');
  panel.style.display = 'block';
}

function globalSearchResultClick(idx) {
  const r = _globalSearchResults[idx];
  if (!r || typeof r.action !== 'function') return;
  closeGlobalSearchResults();
  const input = document.getElementById('globalSearchInput');
  if (input) input.value = '';
  r.action();
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('globalSearchWrap');
  if (wrap && !wrap.contains(e.target)) closeGlobalSearchResults();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeGlobalSearchResults();
});
