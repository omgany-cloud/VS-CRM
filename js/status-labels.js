// Shared RU labels for short EN status/type/severity tokens that get
// stored as internal <select> values and object keys throughout the app
// (capital call status, risk rating, conflict-approval status, etc).
// statusLabel(v) returns the Russian display text but the caller keeps
// using the original English token as the value/key, so nothing that
// reads or filters on that value has to change.
//
// Deliberately NOT included here: finance-instrument/jargon terms
// (Equity, SAFE, M&A, IPO, fund-type taxonomy), job titles (CEO, CFO,
// Compliance Officer), and AFSA/CF&A classification terms (Advising,
// Arranging, Professional Client, Qualified Investor) — these read as
// established English finance vocabulary elsewhere in the app, not as
// generic UI chrome, so translating them would be a product judgment
// call rather than a straightforward localization bug.
const STATUS_LABELS = {
  // client / entity type
  'Individual': 'Физическое лицо',
  'Corporate': 'Юридическое лицо',
  // risk / severity
  'Low': 'Низкий',
  'Medium': 'Средний',
  'High': 'Высокий',
  'Critical': 'Критический',
  // generic lifecycle status
  'Active': 'Активен',
  'Draft': 'Черновик',
  'Completed': 'Завершён',
  'Terminated': 'Прекращён',
  'Pending': 'На рассмотрении',
  'Approved': 'Одобрено',
  'Approved with conditions': 'Одобрено с условиями',
  'Rejected': 'Отклонено',
  'Suspended': 'Приостановлен',
  'Exited': 'Вышел',
  'Overdue': 'Просрочено',
  'Pass': 'Пройдено',
  'Fail': 'Не пройдено',
  'Paid': 'Оплачено',
  'Default': 'Дефолт',
  // conflict-of-interest classification
  'Internal Client': 'Внутренний клиент',
  'Dual-Mandate': 'Двойной мандат',
  'Routine Conflict': 'Рядовой конфликт',
  'Other': 'Другое',
  // CF&A fee structure
  'Fixed Fee': 'Фиксированная плата',
  'Success Fee': 'Комиссия за успех',
  'Retainer': 'Абонентская плата',
};
function statusLabel(v) {
  return STATUS_LABELS[v] || v;
}
