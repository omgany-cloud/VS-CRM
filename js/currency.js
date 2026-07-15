// ============================================================
//  currency.js — single source of truth for "what currency is
//  this amount actually in". Every fund carries a real
//  `currency` column (server/fundMapping.js); everything that
//  displays a fund-scoped amount should derive its symbol from
//  the OWNING fund, never hardcode one.
//
//  Loaded before every other app script (see index.html) so
//  funds.js and everything downstream can rely on it.
// ============================================================

const CURRENCIES = {
  USD: { symbol: '$', label: 'Доллар США (USD)' },
  EUR: { symbol: '€', label: 'Евро (EUR)' },
  KZT: { symbol: '₸', label: 'Тенге (KZT)' },
  RUB: { symbol: '₽', label: 'Рубль (RUB)' },
};
const DEFAULT_CURRENCY = 'USD';

function currencySymbol(currencyCode) {
  return (CURRENCIES[currencyCode] || CURRENCIES[DEFAULT_CURRENCY]).symbol;
}

// Same 3-tier magnitude formatting fmtUSD always used, just parameterized
// by currency code instead of a hardcoded '$'.
function fmtCurrency(amount, currencyCode) {
  if (amount == null || Number.isNaN(amount)) return '—';
  const sym = currencySymbol(currencyCode);
  if (Math.abs(amount) >= 1000000) return sym + (amount / 1000000).toFixed(2) + 'M';
  if (Math.abs(amount) >= 1000)    return sym + (amount / 1000).toFixed(0) + 'K';
  return sym + amount.toLocaleString();
}

// fundId -> currency code. Falls back to the first loaded fund's currency,
// then DEFAULT_CURRENCY, so this never throws or renders 'undefined' even
// before `funds` has loaded or if a fundId doesn't resolve.
function currencyForFundId(fundId) {
  if (fundId != null && typeof funds !== 'undefined') {
    const f = funds.find(x => x.id === fundId);
    if (f && f.currency) return f.currency;
  }
  if (typeof funds !== 'undefined' && funds.length && funds[0].currency) {
    return funds[0].currency;
  }
  return DEFAULT_CURRENCY;
}

// Convenience for any object that carries a `.fundId` (lp, deal, portfolio
// company, capital call, ...).
function currencyForEntity(entity) {
  return currencyForFundId(entity ? entity.fundId : null);
}
