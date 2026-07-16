// ============================================================
//  Turan Capital Fund LP — Data Store
//  General Partner: Golden Leaves Ltd
//  License: AFSA-A-LA-2024-0038
// ============================================================

const COLORS = [
  '#3b82f6','#22c55e','#8b5cf6','#f97316',
  '#14b8a6','#ef4444','#eab308','#06b6d4',
  '#ec4899','#84cc16'
];
function getColor(i) { return COLORS[i % COLORS.length]; }

/* ===== FUND PARAMETERS ===== */
const FUND_PARAMS = {
  // Fund identity
  name:     'Turan Capital Holding Limited Partnership',
  fundShort:'Turan Capital Holding',
  gp:       'Golden Leaves Ltd.',
  gpFull:   'Частная компания «Golden Leaves Ltd.»',
  gpCEO:    'Омирсериков Г.М.',
  gpCEOen:  'G.M. Omirserikov',
  gpTitle:  'SEO / Главный управляющий директор',
  license:  'AFSA-A-LA-2024-0038',
  // Registered address
  gpAddress:   'Республика Казахстан, Z05T8M2, г. Нур-Султан, район Есиль, ул. Гейдар Алиева 1, нп.1',
  gpAddressEn: 'Republic of Kazakhstan, Z05T8M2, Nur-Sultan, Yesil district, Heydar Aliyev Street 1, premises 1',
  gpBIN:    '201040900197',
  // Bank details — Golden Leaves Ltd
  gpBankName: 'АГФ АО «Банк Центр Кредит»',
  gpBIC:      'KCJBKZKX',
  gpIBANkzt:  'KZ468562203110674595',
  gpIBANusd:  'KZ29 8562 2032 1183 5910',
  gpCurrencyKZT: 'KZT',
  gpCurrencyUSD: 'USD',
  // Fund economics
  targetSize: 50,       // $M
  minCommitment: 0.5,   // $M (min $500K per LP)
  minSubscription: 50000, // $50K per AIFC CIS V8
  maxLPShare: 50,       // % max per LP
  firstClosingMin: 5,   // $M minimum for First Closing
  gpContribution: 1,    // % GP commitment
  lpContribution: 99,   // % LP commitment
  managementFee: 2,     // % per annum of AUM
  managementFeeFreq: 'semi-annually',
  carriedInterest: 20,  // %
  preferredReturn: 9,   // % Hurdle Rate (per document)
  catchUpRate: 100,     // % catch-up to GP
  investmentPeriod: 5,  // years
  fundTerm: 10,         // years
  extensionYears: 2,    // max 2×1-year extensions
  lockInPeriod: 5,      // years
  earlyExitFeeMin: 2,   // %
  earlyExitFeeMax: 5,   // %
  redemptionDates: 'June 30 / December 31',
  redemptionNotice: 30, // calendar days
  geoFocusKZ: 70,       // % min Kazakhstan
  geoFocusCA: 30,       // % max Central Asia
  maxSingleInv: 25,     // % of total commitments
  maxSectorAlloc: 10,   // % per sector
  maxDebtEquity: 70,    // % debt/equity
  maxDebtEBITDA: 3.0,
  maxFundLeverage: 30,  // % of NAV
  orgExpCap: 1,         // % org expenses cap
  capitalCallDays: 30,  // calendar days to fund
  recordRetention: 6,   // years
  navFreq: 'semi-annual', // June 30, Dec 31
  targetIRR_min: 20,    // %
  targetIRR_max: 25,    // %
  targetMOIC_min: 2.5,
  targetMOIC_max: 3.5,
  targetCompanies_min: 8,
  targetCompanies_max: 12,
  currentPhase: 'Investment Period',
  currentYear: 2,
  // AIFC / legal
  regBody:    'AIFC Registrar of Companies',
  regAddress: 'Astana International Financial Centre',
  governingLaw: 'AIFC / Republic of Kazakhstan',
  court:      'AIFC Court',
  arbitration:'International Arbitration Center of AIFC, Astana',
  arbLanguage:'English',
};


/* ===== DEALS / PIPELINE ===== */
let deals = [];  // populated at runtime by js/api-auth.js via GET /api/deals (see server/index.js)
let dealIdCounter = 8;

/* ===== PORTFOLIO COMPANIES ===== */
let portfolio = [];  // populated at runtime by js/api-auth.js via GET /api/portfolio (see server/index.js)
let portfolioIdCounter = 4;

/* ===== HARVESTING / EXIT ===== */
let harvestingList = [
  { id: 1, name: 'NomadTech Solutions', exitStrategy: 'M&A',            invested: 4.5, exitValue: 0, moic: 0, irr: 0, status: 'Мониторинг', exitDate: '2028-12-31' },
  { id: 2, name: 'VitaMed Astana',      exitStrategy: 'Strategic Sale', invested: 5,   exitValue: 0, moic: 0, irr: 0, status: 'Мониторинг', exitDate: '2029-06-30' },
  { id: 3, name: 'Dala Agro Holding',   exitStrategy: 'IPO',            invested: 6,   exitValue: 0, moic: 0, irr: 0, status: 'Мониторинг', exitDate: '2030-03-31' },
];

/* ===== CAPITAL CALLS ===== */
let capitalCalls = [
  { id: 1, noticeDate: '2024-11-15', payDate: '2024-12-02', amount: 4500000, pct: 13.5, purpose: 'Инвестиция в NomadTech Solutions',  status: 'Завершён', received: 4500000 },
  { id: 2, noticeDate: '2025-02-10', payDate: '2025-02-28', amount: 5000000, pct: 15,   purpose: 'Инвестиция в VitaMed Astana',        status: 'Завершён', received: 5000000 },
  { id: 3, noticeDate: '2025-05-05', payDate: '2025-05-22', amount: 6000000, pct: 18,   purpose: 'Инвестиция в Dala Agro Holding',      status: 'Завершён', received: 6000000 },
  { id: 4, noticeDate: '2025-07-01', payDate: '2025-07-21', amount: 2000000, pct: 6,    purpose: 'Пополнение операционного резерва фонда', status: 'Ожидается', received: 0 },
];

/* ===== DISTRIBUTIONS =====
   Пока пусто — фонд на 2-м году инвестиционного периода, реализованных выходов ещё не было. */
let distributions = [];

/* ===== CLOSING CHECKLIST ===== */
const closingChecklist = [
  { id: 'cl1',  done: true,  text: 'Минимальные обязательства >$5M подтверждены',          resp: 'CEO' },
  { id: 'cl2',  done: true,  text: 'KYC/AML завершён для всех LP',                          resp: 'CCO' },
  { id: 'cl3',  done: true,  text: 'Subscription Agreements подписаны LP',                  resp: 'CCO' },
  { id: 'cl4',  done: true,  text: 'Board Resolution подготовлен',                           resp: 'CFO + CEO' },
  { id: 'cl5',  done: true,  text: 'Closing Certificates подготовлены',                      resp: 'CFO' },
  { id: 'cl6',  done: true,  text: 'Банк уведомлён о First Closing',                         resp: 'CFO' },
  { id: 'cl7',  done: true,  text: 'Board Meeting проведён (День 0)',                         resp: 'GP Board' },
  { id: 'cl8',  done: true,  text: 'Closing Certificates подписаны GP',                      resp: 'GP Board' },
  { id: 'cl9',  done: true,  text: 'Capital Call Notice отправлен (+7 дней)',                 resp: 'CFO' },
  { id: 'cl10', done: true,  text: 'Средства получены на счёт фонда',                        resp: 'CFO' },
  { id: 'cl11', done: false, text: 'Welcome Letter отправлен всем LP',                       resp: 'CEO' },
  { id: 'cl12', done: false, text: 'LP Register обновлён, Reg.Agent уведомлён',              resp: 'CEO + Reg.Agent' },
];

/* ===== FIRST CLOSING STATE =====
   One row per fund (GET /api/first-closing, server/index.js) — used to be
   a single hardcoded object here with no backing store and no fund
   scoping at all. firstClosingList is populated by loadFirstClosingFromApi()
   (js/api-auth.js); currentFirstClosingState() (js/app.js) resolves the
   current fund's row, defaulting to a blank (never-yet-saved) state.
================================================================ */
let firstClosingList = [];


const closingDocuments = [
  { name: 'Board Resolution (First Closing)',        status: 'Подписан',   template: 'Template 2' },
  { name: 'Closing Certificate',                     status: 'Подписан',   template: 'Template 3' },
  { name: 'Capital Call Notice #1',                  status: 'Отправлен',  template: 'Template 4' },
  { name: 'Welcome Letter LP',                       status: 'В процессе', template: 'Template 5' },
  { name: 'LP Register (обновлённый)',                status: 'В процессе', template: 'Template 6' },
  { name: 'AFSA Notification (First Closing)',        status: 'Подготовлен',template: 'Template 8' },
  { name: 'Subscription Agreement (все LP)',          status: 'Подписан',   template: 'Template 1' },
];

/* ===== REPORT SCHEDULE ===== */
const reportSchedule = [
  { period: 'Q4 2024',   deadline: '2025-02-14', type: 'Квартальный',  status: 'Отправлен',  resp: 'CFO' },
  { period: 'FY 2024',   deadline: '2025-03-31', type: 'Годовой',      status: 'В процессе', resp: 'CFO + Аудитор' },
  { period: 'Q1 2025',   deadline: '2025-05-15', type: 'Квартальный',  status: 'Ожидается',  resp: 'CFO' },
  { period: 'Q2 2025',   deadline: '2025-08-14', type: 'Квартальный',  status: 'Ожидается',  resp: 'CFO' },
  { period: 'Q3 2025',   deadline: '2025-11-14', type: 'Квартальный',  status: 'Ожидается',  resp: 'CFO' },
  { period: 'FY 2025',   deadline: '2026-03-31', type: 'Годовой',      status: 'Ожидается',  resp: 'CFO + Аудитор' },
];

/* ===== TODAY'S TASKS ===== */
let todayTasks = [
  { id: 1, text: 'Продлить KYC для Silk Steppe Capital LLP (истекает через 45 дней)', priority: 'Средний',  done: false, page: 'kyc' },
  { id: 2, text: 'Загрузить финотчётность Q2 2025 — NomadTech Solutions',              priority: 'Высокий',  done: false, page: 'portfolio' },
  { id: 3, text: 'Подготовить Capital Call Notice №4 к рассылке LP',                   priority: 'Высокий',  done: false, page: 'lp' },
];


/* ===== CHART DATA ===== */
const chartData = {
  jcurve: {
    labels: ['2024','2025','2026','2027','2028','2029','2030','2031','2032','2033'],
    cashflow: [-4.5, -13, -10, -5, 6, 18, 38, 65, 92, 120],
  },
  nav: {
    labels: ['Q4\'24','Q1\'25','Q2\'25','Q3\'25','Q4\'25','Q1\'26','Q2\'26'],
    nav:    [4.5, 9.5, 15.9, 17.0, 19.0, 21.5, 24.0],
  },
  sectors: {
    labels: ['Технологии','Здравоохранение','АПК','Энергетика','Финансы'],
    data:   [4.5, 5, 6, 0, 0],
  },
  lpTypes: {
    labels: ['Юридическое лицо','Семейный офис','Физическое лицо','Институциональный'],
    data:   [0, 6, 1.95, 25.5],
  }
};
