// KYC stays valid for two years from the client check conclusion (stage 2.2):
// owner's decision 28.10.2026, TZ 13.1 п. 8. Kept free of database access so
// the read-only data inventory can use the same rule.
const KYC_VALIDITY_MONTHS = 24;

// 'YYYY-MM-DD' (or an ISO timestamp) → the last day it is valid, or null.
function kycValidUntil(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const day = new Date(date.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(day.getTime())) return null;
  day.setUTCMonth(day.getUTCMonth() + KYC_VALIDITY_MONTHS);
  return day.toISOString().slice(0, 10);
}

function kycExpired(date, today) { const until = kycValidUntil(date); return !!until && until < today; }

module.exports = { KYC_VALIDITY_MONTHS, kycValidUntil, kycExpired };
