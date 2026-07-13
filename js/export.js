// ============================================================
//  export.js — Excel Export Module
//  Golden Leaves Ltd / Turan Capital Fund LP
//  AFSA-compliant reports via SheetJS (xlsx)
//  Generates: LP Register, KYC/AML, Capital Calls, Portfolio,
//             Deals, Tasks, CF&A Clients, Full CRM dump
// ============================================================

/* ── Утилиты ── */
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return d; }
}
function fmtMoney(v, suffix = '$M') {
  if (v == null || v === '') return '—';
  return `${parseFloat(v).toFixed(2)} ${suffix}`;
}
function fmtPct(v) {
  return v != null ? `${v}%` : '—';
}
function yesNo(v) {
  return v ? 'Да' : 'Нет';
}

/* ── Создать и скачать Excel-файл из массива листов ── */
function downloadExcel(sheets, filename) {
  if (typeof XLSX === 'undefined') {
    showToast('❌ Библиотека SheetJS не загружена', 'red');
    return;
  }
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, data, colWidths }) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Ширина колонок
    if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
    // Заморозить первую строку (заголовок)
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
  showToast(`📊 Файл "${filename}" скачан`, 'green');
}

/* ═══════════════════════════════════════════════════════════
   1. LP REGISTER — Реестр инвесторов (AFSA Rule 8.3)
═══════════════════════════════════════════════════════════ */
function exportLPRegister() {
  const header = [
    '№', 'Наименование / ФИО', 'Тип', 'Страна', 'Статус',
    'Commitment ($M)', 'Инвестировано ($M)', 'Capital Called ($M)',
    'Distributions ($M)', 'Квалифицирован', 'Sub. Agreement',
    'Дата Sub. Agreement', 'Контакт', 'Email', 'Телефон', 'RM'
  ];
  const rows = lpList.map((lp, i) => [
    i + 1,
    lp.name,
    lp.type,
    lp.country,
    lp.status,
    lp.commit,
    lp.invested,
    lp.capitalCalled,
    lp.distributions,
    lp.qualified,
    yesNo(lp.subAgreement),
    fmtDate(lp.subDate),
    lp.contact,
    lp.email,
    lp.phone,
    lp.manager,
  ]);

  // Итоги
  const totalCommit    = lpList.reduce((s, lp) => s + (lp.commit || 0), 0);
  const totalInvested  = lpList.reduce((s, lp) => s + (lp.invested || 0), 0);
  const totalCalled    = lpList.reduce((s, lp) => s + (lp.capitalCalled || 0), 0);
  const totalDistrib   = lpList.reduce((s, lp) => s + (lp.distributions || 0), 0);

  rows.push([]);
  rows.push(['', 'ИТОГО', '', '', '',
    totalCommit.toFixed(2), totalInvested.toFixed(2),
    totalCalled.toFixed(2), totalDistrib.toFixed(2),
    '', '', '', '', '', '', ''
  ]);

  downloadExcel([{
    name: 'LP Register',
    data: [header, ...rows],
    colWidths: [4, 32, 20, 16, 20, 16, 16, 16, 16, 14, 14, 18, 20, 28, 18, 20],
  }], `LP_Register_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   2. KYC/AML REPORT — Статус KYC всех LP (AFSA AML Rules)
═══════════════════════════════════════════════════════════ */
function exportKYCAML() {
  const header = [
    '№', 'LP / Инвестор', 'Тип', 'Страна', 'KYC Статус',
    'Паспорт/Устав', 'Адрес', 'Source of Funds', 'Tax ID',
    'PEP Check', 'AML Screening', 'UBO Верификация',
    'Дата KYC', 'Комментарий'
  ];
  const rows = lpList.map((lp, i) => [
    i + 1,
    lp.name,
    lp.type,
    lp.country,
    lp.kyc?.status || '—',
    yesNo(lp.kyc?.passport),
    yesNo(lp.kyc?.proofAddress),
    yesNo(lp.kyc?.sourceOfFunds),
    yesNo(lp.kyc?.taxId),
    yesNo(lp.kyc?.pepCheck),
    yesNo(lp.kyc?.amlScreening),
    yesNo(lp.kyc?.uboVerified),
    fmtDate(lp.kyc?.date),
    lp.kyc?.comment || '',
  ]);

  downloadExcel([{
    name: 'KYC-AML Report',
    data: [header, ...rows],
    colWidths: [4, 32, 20, 16, 18, 14, 10, 16, 10, 10, 14, 16, 14, 40],
  }], `KYC_AML_Report_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   3. CAPITAL CALLS — История Capital Call Notices
═══════════════════════════════════════════════════════════ */
function exportCapitalCalls() {
  const header = [
    '№', 'Дата уведомления', 'Дата платежа', 'Сумма ($)',
    '% от Commitment', 'Назначение', 'Статус', 'Получено ($)'
  ];
  const rows = capitalCalls.map((cc, i) => [
    i + 1,
    fmtDate(cc.noticeDate),
    fmtDate(cc.payDate),
    cc.amount,
    fmtPct(cc.pct),
    cc.purpose,
    cc.status,
    cc.received,
  ]);

  const totalAmount   = capitalCalls.reduce((s, cc) => s + (cc.amount || 0), 0);
  const totalReceived = capitalCalls.reduce((s, cc) => s + (cc.received || 0), 0);
  rows.push([]);
  rows.push(['', 'ИТОГО', '', totalAmount, '', '', '', totalReceived]);

  // Разбивка по LP
  const lpBreakdownHeader = [
    'LP', 'Commitment ($M)', ...capitalCalls.map((cc, i) => `CC#${i + 1} (${fmtDate(cc.noticeDate)})`), 'Итого Paid'
  ];
  const lpRows = lpList.map(lp => {
    const pct = capitalCalls.map(cc => cc.status === 'Завершён'
      ? `$${((lp.commit / lpList.reduce((s, l) => s + l.commit, 0)) * cc.amount / 1e6).toFixed(3)}M` : '—');
    return [lp.name, lp.commit, ...pct, `$${lp.capitalCalled}M`];
  });

  downloadExcel([
    {
      name: 'Capital Calls',
      data: [header, ...rows],
      colWidths: [4, 18, 16, 14, 12, 40, 14, 14],
    },
    {
      name: 'LP Breakdown',
      data: [lpBreakdownHeader, ...lpRows],
      colWidths: [32, 16, 14, 14, 14, 14, 16],
    }
  ], `Capital_Calls_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   4. PORTFOLIO REPORT — Портфельные компании
═══════════════════════════════════════════════════════════ */
function exportPortfolio() {
  const header = [
    '№', 'Компания', 'Сектор', 'Стадия', 'Инвестировано ($M)',
    'Текущая стоимость ($M)', 'MOIC', 'Unrealized Gain ($M)',
    'Дата входа', 'Стратегия выхода', 'Год выхода'
  ];
  const rows = portfolio.map((p, i) => [
    i + 1,
    p.name,
    p.sector,
    p.stage,
    p.invested,
    p.value,
    p.moic ? p.moic.toFixed(2) + 'x' : '—',
    p.value && p.invested ? (p.value - p.invested).toFixed(2) : '—',
    fmtDate(p.date),
    p.exitStrategy,
    p.exitYear || '—',
  ]);

  const totalInv  = portfolio.reduce((s, p) => s + (p.invested || 0), 0);
  const totalVal  = portfolio.reduce((s, p) => s + (p.value || 0), 0);
  const totalGain = totalVal - totalInv;
  rows.push([]);
  rows.push(['', 'ИТОГО', '', '', totalInv.toFixed(2), totalVal.toFixed(2),
    (totalVal / totalInv).toFixed(2) + 'x', totalGain.toFixed(2), '', '', '']);

  downloadExcel([{
    name: 'Portfolio',
    data: [header, ...rows],
    colWidths: [4, 28, 20, 20, 18, 22, 10, 20, 14, 20, 12],
  }], `Portfolio_Report_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   5. DEAL PIPELINE — Сделки инвестиционного комитета
═══════════════════════════════════════════════════════════ */
function exportDeals() {
  const header = [
    '№', 'Компания', 'Сектор', 'Стадия', 'Сумма ($M)',
    'Тип инструмента', 'Приоритет', 'IC Статус', 'Менеджер', 'Комментарий'
  ];
  const rows = deals.map((d, i) => [
    i + 1, d.company, d.sector, d.stage, d.amount,
    d.type, d.priority, d.ic, d.manager, d.comment,
  ]);

  const closed = deals.filter(d => d.stage === 'Закрыта');
  const pipeline = deals.filter(d => d.stage !== 'Закрыта' && d.stage !== 'Отклонена IC');
  rows.push([]);
  rows.push(['', `Закрыто сделок: ${closed.length}`, '', '', closed.reduce((s, d) => s + d.amount, 0).toFixed(1), '', '', '', '', '']);
  rows.push(['', `В пайплайне: ${pipeline.length}`, '', '', pipeline.reduce((s, d) => s + d.amount, 0).toFixed(1), '', '', '', '', '']);

  downloadExcel([{
    name: 'Deal Pipeline',
    data: [header, ...rows],
    colWidths: [4, 24, 20, 18, 12, 20, 12, 14, 24, 40],
  }], `Deal_Pipeline_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   6. TASKS REPORT — Задачи (по модулю Tasks)
═══════════════════════════════════════════════════════════ */
function exportTasks() {
  const header = [
    '№', 'Заголовок', 'Тип', 'Приоритет', 'Статус',
    'Исполнитель', 'Автор', 'Клиент', 'Дедлайн',
    'Дата создания', 'Кол-во комментариев', 'Описание'
  ];
  const priorityMap = { critical: 'Критично', high: 'Высокий', medium: 'Средний', low: 'Низкий' };
  const statusMap = { pending: 'Новая', in_progress: 'В работе', review: 'На проверке', completed: 'Выполнена', cancelled: 'Отменена' };

  const rows = tasksData.map((t, i) => [
    i + 1,
    t.title,
    t.type,
    priorityMap[t.priority] || t.priority,
    statusMap[t.status] || t.status,
    t.assignee,
    t.author,
    t.relatedClient || '—',
    fmtDate(t.deadline),
    fmtDate(t.created),
    t.comments?.length || 0,
    t.description || '',
  ]);

  // Сводка по статусам
  const summary = [
    [], ['СВОДКА ПО СТАТУСАМ'], ['Статус', 'Кол-во'],
    ...Object.entries(statusMap).map(([k, v]) => [v, tasksData.filter(t => t.status === k).length]),
    [], ['Просроченных', tasksData.filter(t => t.status !== 'completed' && t.deadline && new Date(t.deadline) < new Date()).length],
  ];

  downloadExcel([
    {
      name: 'Tasks',
      data: [header, ...rows],
      colWidths: [4, 40, 14, 12, 14, 28, 16, 28, 12, 12, 12, 40],
    },
    {
      name: 'Summary',
      data: summary,
      colWidths: [20, 10],
    }
  ], `Tasks_Report_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   7. CF&A CLIENTS — Клиенты Corporate Finance & Advisory
═══════════════════════════════════════════════════════════ */
function exportCFAClients() {
  const header = [
    '№', 'Клиент', 'Тип', 'Индустрия', 'Страна', 'Стадия',
    'KYC Статус', 'AML Статус', 'PEP', 'Гонорар ($M)',
    'RM', 'Контакт', 'Email', 'Телефон',
    'Услуги', 'С клиентом с', 'Заметки'
  ];
  const rows = cfaClients.map((c, i) => [
    i + 1, c.name, c.type, c.industry, c.country, c.stage,
    c.kycStatus, c.amlStatus, c.pepStatus, c.revenue,
    c.rmOwner, c.contact?.name, c.contact?.email, c.contact?.phone,
    c.services?.join(', '),
    fmtDate(c.engagementDate),
    c.notes || '',
  ]);

  // KYC чеклист отдельным листом
  const kycHeader = [
    'Клиент', 'Тип', 'KYC Статус', 'Загружено документов', 'Список документов', 'UBO', 'Дата создания'
  ];
  const kycRows = cfaClients.map(c => [
    c.name, c.type, c.kycStatus,
    c.documents?.length || 0,
    c.documents?.join('; ') || '—',
    c.ubo?.map(u => `${u.name} ${u.share}%`).join(', ') || '—',
    fmtDate(c.created),
  ]);

  downloadExcel([
    {
      name: 'CFA Clients',
      data: [header, ...rows],
      colWidths: [4, 32, 18, 22, 16, 14, 14, 14, 14, 12, 28, 22, 28, 18, 36, 14, 40],
    },
    {
      name: 'KYC Checklist',
      data: [kycHeader, ...kycRows],
      colWidths: [32, 18, 14, 16, 50, 30, 14],
    }
  ], `CFA_Clients_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   8. FUND OVERVIEW — Сводный отчёт по фонду (AFSA Annual)
═══════════════════════════════════════════════════════════ */
function exportFundOverview() {
  const p = FUND_PARAMS;
  const totalCommit  = lpList.reduce((s, lp) => s + (lp.commit || 0), 0);
  const totalCalled  = lpList.reduce((s, lp) => s + (lp.capitalCalled || 0), 0);
  const totalPortVal = portfolio.reduce((s, p) => s + (p.value || 0), 0);
  const totalInvest  = portfolio.reduce((s, p) => s + (p.invested || 0), 0);

  const fundInfo = [
    ['TURAN CAPITAL FUND — ОБЗОР ФОНДА'],
    ['Сформировано:', new Date().toLocaleDateString('ru-RU')],
    [],
    ['ПАРАМЕТРЫ ФОНДА'],
    ['Наименование фонда',       p.name],
    ['Генеральный партнёр',      p.gp],
    ['Лицензия AFSA',            p.license],
    ['Целевой размер фонда',     fmtMoney(p.targetSize)],
    ['Мин. commitment LP',       fmtMoney(p.minCommitment)],
    ['Management Fee',           fmtPct(p.managementFee)],
    ['Carried Interest',         fmtPct(p.carriedInterest)],
    ['Hurdle Rate',              fmtPct(p.preferredReturn)],
    ['Investment Period',        `${p.investmentPeriod} лет`],
    ['Срок фонда',               `${p.fundTerm} лет`],
    ['Целевой IRR',              `${p.targetIRR_min}–${p.targetIRR_max}%`],
    ['Целевой MOIC',             `${p.targetMOIC_min}–${p.targetMOIC_max}x`],
    [],
    ['ТЕКУЩЕЕ СОСТОЯНИЕ'],
    ['Инвесторов (LP)',          lpList.length],
    ['Всего Commitments',        fmtMoney(totalCommit)],
    ['Capital Called',           fmtMoney(totalCalled)],
    ['Uncalled Capital',         fmtMoney(totalCommit - totalCalled)],
    ['Портфельных компаний',     portfolio.length],
    ['Инвестировано',            fmtMoney(totalInvest)],
    ['NAV (текущая)',             fmtMoney(totalPortVal)],
    ['Gross MOIC',               `${(totalPortVal / totalInvest).toFixed(2)}x`],
    [],
    ['СДЕЛКИ'],
    ['Всего в базе',             deals.length],
    ['Закрыто',                  deals.filter(d => d.stage === 'Закрыта').length],
    ['В пайплайне',              deals.filter(d => !['Закрыта','Отклонена IC'].includes(d.stage)).length],
    ['Отклонено',                deals.filter(d => d.stage === 'Отклонена IC').length],
  ];

  // График капитал-коллов
  const ccHeader = ['Capital Call', 'Дата уведомления', 'Дата платежа', 'Сумма ($)', 'Получено ($)', 'Статус'];
  const ccRows = capitalCalls.map((cc, i) => [
    `CC #${i + 1}`, fmtDate(cc.noticeDate), fmtDate(cc.payDate), cc.amount, cc.received, cc.status,
  ]);

  downloadExcel([
    { name: 'Fund Overview', data: fundInfo, colWidths: [30, 28] },
    { name: 'Capital Calls', data: [ccHeader, ...ccRows], colWidths: [10, 16, 16, 14, 14, 14] },
  ], `Fund_Overview_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   9. AML REGISTER — Реестр AML проверок (AFSA AML Rules 5-6)
═══════════════════════════════════════════════════════════ */
function exportAMLRegister() {
  const lpHeader = [
    '№', 'Наименование', 'Тип', 'Страна', 'AML Статус',
    'PEP Check', 'Санкционный скрининг', 'Source of Funds', 'UBO', 'Дата проверки', 'Комментарий'
  ];
  const lpRows = lpList.map((lp, i) => [
    i + 1, lp.name, lp.type, lp.country,
    lp.kyc?.status || '—',
    yesNo(lp.kyc?.pepCheck),
    yesNo(lp.kyc?.amlScreening),
    yesNo(lp.kyc?.sourceOfFunds),
    yesNo(lp.kyc?.uboVerified),
    fmtDate(lp.kyc?.date),
    lp.kyc?.comment || '',
  ]);

  // CF&A клиенты
  const cfaHeader = [
    '№', 'Клиент CF&A', 'Тип', 'Страна', 'AML Статус', 'KYC Статус', 'PEP', 'Стадия', 'RM'
  ];
  const cfaRows = cfaClients.map((c, i) => [
    i + 1, c.name, c.type, c.country, c.amlStatus, c.kycStatus, c.pepStatus, c.stage, c.rmOwner,
  ]);

  const pendingAML = cfaClients.filter(c => c.amlStatus !== 'Пройден');
  const enhancedDD = cfaClients.filter(c => c.amlStatus === 'Enhanced DD');

  const summaryData = [
    ['AML REGISTER — СВОДКА'],
    ['Дата отчёта', new Date().toLocaleDateString('ru-RU')],
    ['Лицензия AFSA', FUND_PARAMS.license],
    [],
    ['LP — AML прошли', lpList.filter(lp => lp.kyc?.amlScreening).length],
    ['LP — AML ожидает', lpList.filter(lp => !lp.kyc?.amlScreening).length],
    ['CF&A — AML пройден', cfaClients.filter(c => c.amlStatus === 'Пройден').length],
    ['CF&A — Enhanced DD', enhancedDD.length],
    ['CF&A — Ожидает AML', pendingAML.length],
  ];

  downloadExcel([
    { name: 'Summary', data: summaryData, colWidths: [30, 24] },
    { name: 'LP AML', data: [lpHeader, ...lpRows], colWidths: [4, 32, 18, 14, 14, 12, 18, 16, 10, 14, 40] },
    { name: 'CFA AML', data: [cfaHeader, ...cfaRows], colWidths: [4, 32, 18, 14, 14, 14, 14, 14, 24] },
  ], `AML_Register_${todayStr()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════
   10. FULL CRM EXPORT — Полный дамп всех данных
═══════════════════════════════════════════════════════════ */
function exportFullCRM() {
  const genDate = new Date().toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const coverData = [
    ['TURAN CAPITAL FUND LIMITED PARTNERSHIP'],
    ['Генеральный партнёр: Golden Leaves Ltd'],
    ['Лицензия AFSA: ' + FUND_PARAMS.license],
    [''],
    ['ПОЛНЫЙ ЭКСПОРТ CRM'],
    ['Сформирован:', genDate],
    [''],
    ['Содержит листы:'],
    ['1. LP Register — реестр всех инвесторов'],
    ['2. KYC-AML — статус проверок KYC/AML'],
    ['3. Capital Calls — история capital call notices'],
    ['4. Portfolio — портфельные компании'],
    ['5. Deals — сделки инвестиционного пайплайна'],
    ['6. CFA Clients — клиенты CF&A'],
    ['7. Tasks — задачи CRM'],
    ['8. AML Register — реестр AML проверок'],
    [''],
    ['Предназначен для регуляторной отчётности AFSA,'],
    ['внутреннего аудита и отчётности перед LP.'],
  ];

  const lpHeader  = ['№','Наименование','Тип','Страна','Статус','Commitment ($M)','Capital Called ($M)','KYC Статус','Sub.Agreement'];
  const lpRows    = lpList.map((lp, i) => [i+1, lp.name, lp.type, lp.country, lp.status, lp.commit, lp.capitalCalled, lp.kyc?.status, yesNo(lp.subAgreement)]);

  const kycHeader = ['№','LP','Тип','AML','PEP','Source of Funds','UBO','Дата'];
  const kycRows   = lpList.map((lp, i) => [i+1, lp.name, lp.type, yesNo(lp.kyc?.amlScreening), yesNo(lp.kyc?.pepCheck), yesNo(lp.kyc?.sourceOfFunds), yesNo(lp.kyc?.uboVerified), fmtDate(lp.kyc?.date)]);

  const ccHeader  = ['№','Дата','Сумма ($)','%','Назначение','Статус'];
  const ccRows    = capitalCalls.map((cc, i) => [i+1, fmtDate(cc.noticeDate), cc.amount, fmtPct(cc.pct), cc.purpose, cc.status]);

  const portHeader = ['№','Компания','Сектор','Инвестировано ($M)','Стоимость ($M)','MOIC','Выход'];
  const portRows   = portfolio.map((p, i) => [i+1, p.name, p.sector, p.invested, p.value, p.moic ? p.moic.toFixed(2)+'x':'—', p.exitStrategy]);

  const dealHeader = ['№','Компания','Сектор','Стадия','Сумма ($M)','Тип','IC Статус'];
  const dealRows   = deals.map((d, i) => [i+1, d.company, d.sector, d.stage, d.amount, d.type, d.ic]);

  const cfaHeader = ['№','Клиент','Тип','Индустрия','Стадия','KYC','AML','Гонорар ($M)'];
  const cfaRows   = cfaClients.map((c, i) => [i+1, c.name, c.type, c.industry, c.stage, c.kycStatus, c.amlStatus, c.revenue]);

  const priorityMap = {critical:'Критично',high:'Высокий',medium:'Средний',low:'Низкий'};
  const statusMap   = {pending:'Новая',in_progress:'В работе',review:'На проверке',completed:'Выполнена',cancelled:'Отменена'};
  const taskHeader  = ['№','Задача','Тип','Приоритет','Статус','Исполнитель','Дедлайн'];
  const taskRows    = tasksData.map((t, i) => [i+1, t.title, t.type, priorityMap[t.priority], statusMap[t.status], t.assignee, fmtDate(t.deadline)]);

  const amlHeader = ['№','Наименование','Тип','Страна','AML','PEP','Source of Funds','UBO'];
  const amlLP     = lpList.map((lp, i) => [i+1, lp.name, lp.type, lp.country, yesNo(lp.kyc?.amlScreening), yesNo(lp.kyc?.pepCheck), yesNo(lp.kyc?.sourceOfFunds), yesNo(lp.kyc?.uboVerified)]);

  downloadExcel([
    { name: 'Cover', data: coverData, colWidths: [50, 40] },
    { name: 'LP Register', data: [lpHeader, ...lpRows], colWidths: [4,32,18,14,18,16,16,14,14] },
    { name: 'KYC-AML', data: [kycHeader, ...kycRows], colWidths: [4,32,18,12,10,14,10,14] },
    { name: 'Capital Calls', data: [ccHeader, ...ccRows], colWidths: [4,16,14,8,36,14] },
    { name: 'Portfolio', data: [portHeader, ...portRows], colWidths: [4,28,18,16,16,10,18] },
    { name: 'Deals', data: [dealHeader, ...dealRows], colWidths: [4,24,18,18,12,18,14] },
    { name: 'CFA Clients', data: [cfaHeader, ...cfaRows], colWidths: [4,32,16,20,14,14,14,14] },
    { name: 'Tasks', data: [taskHeader, ...taskRows], colWidths: [4,40,14,12,14,28,12] },
    { name: 'AML Register', data: [amlHeader, ...amlLP], colWidths: [4,32,18,14,10,10,14,10] },
  ], `TCF_FullExport_${todayStr()}.xlsx`);
}

/* ── Вспомогательная: сегодняшняя дата для имени файла ── */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

/* ═══════════════════════════════════════════════════════════
   RENDER — Панель экспорта (страница Reports)
═══════════════════════════════════════════════════════════ */
function renderExportPage() {
  const el = document.getElementById('exportContent');
  if (!el) return;

  const reports = [
    {
      id: 'lp',
      icon: 'fa-users',
      color: 'blue',
      title: 'LP Register',
      subtitle: 'Реестр всех инвесторов фонда',
      desc: 'Список LP с commitment, capital called, статусом и контактами. Обязательный документ AFSA (Rule 8.3).',
      fn: 'exportLPRegister()',
      tag: 'AFSA',
    },
    {
      id: 'kyc',
      icon: 'fa-shield-alt',
      color: 'purple',
      title: 'KYC / AML Report',
      subtitle: 'Статус проверок всех LP',
      desc: 'Чеклист KYC/AML по каждому инвестору: паспорт, адрес, source of funds, PEP, санкционный скрининг, UBO.',
      fn: 'exportKYCAML()',
      tag: 'AML',
    },
    {
      id: 'aml',
      icon: 'fa-search',
      color: 'red',
      title: 'AML Register',
      subtitle: 'Реестр AML-проверок LP и CF&A',
      desc: 'Полный AML-реестр: LP + клиенты CF&A. Enhanced DD, PEP, сводка нарушений. Требуется AFSA AML Rules 5–6.',
      fn: 'exportAMLRegister()',
      tag: 'AML',
    },
    {
      id: 'cc',
      icon: 'fa-money-bill-wave',
      color: 'green',
      title: 'Capital Calls',
      subtitle: 'История Capital Call Notices',
      desc: 'Все Capital Call уведомления: даты, суммы, статусы. Разбивка по LP. Приложение к отчёту AFSA.',
      fn: 'exportCapitalCalls()',
      tag: 'Finance',
    },
    {
      id: 'port',
      icon: 'fa-chart-pie',
      color: 'orange',
      title: 'Portfolio Report',
      subtitle: 'Портфельные компании и NAV',
      desc: 'Инвестированные суммы, текущая стоимость, MOIC, стратегии выхода. Для квартальной отчётности LP.',
      fn: 'exportPortfolio()',
      tag: 'Finance',
    },
    {
      id: 'deals',
      icon: 'fa-handshake',
      color: 'blue',
      title: 'Deal Pipeline',
      subtitle: 'Инвестиционный пайплайн',
      desc: 'Все сделки CRM: стадия, сумма, тип инструмента, статус IC, менеджер. Для отчётности IC и Board.',
      fn: 'exportDeals()',
      tag: 'Investment',
    },
    {
      id: 'cfa',
      icon: 'fa-building',
      color: 'purple',
      title: 'CF&A Clients',
      subtitle: 'Клиенты Corporate Finance & Advisory',
      desc: 'Реестр клиентов CF&A: KYC/AML статус, стадия онбординга, KYC чеклист документов, гонорары.',
      fn: 'exportCFAClients()',
      tag: 'CF&A',
    },
    {
      id: 'tasks',
      icon: 'fa-tasks',
      color: 'orange',
      title: 'Tasks Report',
      subtitle: 'Все задачи CRM + статусы',
      desc: 'Задачи по всем модулям: KYC, AML, онбординг, сделки, capital calls. Статистика выполнения.',
      fn: 'exportTasks()',
      tag: 'Internal',
    },
    {
      id: 'fund',
      icon: 'fa-landmark',
      color: 'green',
      title: 'Fund Overview',
      subtitle: 'Сводный отчёт по фонду',
      desc: 'Параметры фонда, сводка по LP, NAV, capital calls — одним файлом. Для регулятора и ежегодного отчёта.',
      fn: 'exportFundOverview()',
      tag: 'AFSA',
    },
    {
      id: 'full',
      icon: 'fa-database',
      color: 'red',
      title: 'Full CRM Export',
      subtitle: 'Полный дамп всех данных (9 листов)',
      desc: 'Все модули CRM одним файлом xlsx: LP, KYC/AML, Capital Calls, Portfolio, Deals, CF&A, Tasks. Для аудита.',
      fn: 'exportFullCRM()',
      tag: 'Full',
      featured: true,
    },
  ];

  const tagColor = {
    'AFSA':       { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa' },
    'AML':        { bg: 'rgba(239,68,68,0.15)',  color: '#f87171' },
    'Finance':    { bg: 'rgba(34,197,94,0.15)',  color: '#4ade80' },
    'Investment': { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
    'CF&A':       { bg: 'rgba(249,115,22,0.15)', color: '#fb923c' },
    'Internal':   { bg: 'rgba(100,116,139,0.15)','color': '#94a3b8' },
    'Full':       { bg: 'rgba(239,68,68,0.18)',  color: '#f87171' },
  };
  const iconColor = { blue:'#3b82f6', purple:'#8b5cf6', green:'#22c55e', orange:'#f97316', red:'#ef4444' };

  el.innerHTML = `
    <!-- Шапка -->
    <div class="export-header">
      <div>
        <h2 class="export-title"><i class="fas fa-file-excel" style="color:#22c55e"></i> Экспорт отчётов</h2>
        <p class="export-subtitle">Выгрузка данных CRM в Excel (.xlsx) для регулятора AFSA, внутреннего аудита и отчётности LP</p>
      </div>
      <button class="export-all-btn" onclick="exportFullCRM()">
        <i class="fas fa-download"></i> Скачать всё одним файлом
      </button>
    </div>

    <!-- Предупреждение: данные сессионные -->
    <div class="export-notice">
      <i class="fas fa-info-circle"></i>
      <span>Отчёты формируются из текущих данных CRM. Лицензия: <strong>${FUND_PARAMS.license}</strong> · GP: <strong>${FUND_PARAMS.gp}</strong></span>
    </div>

    <!-- Карточки отчётов -->
    <div class="export-grid">
      ${reports.map(r => {
        const tc = tagColor[r.tag] || tagColor['Internal'];
        const ic = iconColor[r.color] || '#3b82f6';
        return `
          <div class="export-card ${r.featured ? 'export-card-featured' : ''}">
            <div class="export-card-top">
              <div class="kpi-icon ${r.color}" style="width:44px;height:44px;font-size:18px;flex-shrink:0">
                <i class="fas ${r.icon}"></i>
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                  <span class="export-card-title">${r.title}</span>
                  <span class="export-tag" style="background:${tc.bg};color:${tc.color}">${r.tag}</span>
                </div>
                <div class="export-card-sub">${r.subtitle}</div>
              </div>
            </div>
            <p class="export-card-desc">${r.desc}</p>
            <button class="export-btn ${r.featured ? 'export-btn-featured' : ''}" onclick="${r.fn}">
              <i class="fas fa-file-excel"></i> Скачать .xlsx
            </button>
          </div>`;
      }).join('')}
    </div>

    <!-- Инфо о форматах -->
    <div class="export-footer-note">
      <i class="fas fa-info-circle"></i>
      Все файлы в формате <strong>.xlsx</strong> (Microsoft Excel). Открываются в Excel, Google Sheets, LibreOffice.
      При загрузке файлов в формы AFSA используйте листы с пометкой <span style="color:#a78bfa">AFSA</span> и <span style="color:#f87171">AML</span>.
    </div>`;
}
