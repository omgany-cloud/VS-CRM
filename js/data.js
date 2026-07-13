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

/* ===== LP / INVESTORS ===== */
let lpList = [];  // добавляйте реальных LP через форму «+ Добавить LP»

/* ===== DEALS / PIPELINE ===== */
let deals = [];  // добавляйте реальные сделки через кнопку «+ Новая сделка»
let dealIdCounter = 1;

/* ===== PORTFOLIO COMPANIES ===== */
let portfolio = [];  // добавляйте компании через кнопку «+ Добавить в портфель»
let portfolioIdCounter = 1;

/* ===== HARVESTING / EXIT ===== */
let harvestingList = [];

/* ===== CAPITAL CALLS ===== */
let capitalCalls = [];

/* ===== DISTRIBUTIONS ===== */
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
      taxContrib:    28000000,
      totalDebt:     120000000,
      fundDebt:      80000000,
      debtService:   18000000,
      collateral:    'Залог оборудования + доля 22.2% в компании',
      collateralVal: 150000000,
      collateralStatus: 'Зарегистрирован',
      covenants: [
        { name:'Debt/EBITDA ≤ 4.0x',       ok: true  },
        { name:'DSCR ≥ 1.2x',               ok: true  },
        { name:'Минимальный Revenue $800K', ok: true  },
        { name:'Ежеквартальная отчётность', ok: true  },
        { name:'Согласование крупных сделок >$500K', ok: true },
      ],
      overduePayment: false, overdueAmount: 0,
      paymentSchedule: [
        { date:'2025-07-15', amount:1500000, type:'Основной долг', status:'Предстоит' },
        { date:'2025-08-15', amount:900000,  type:'Проценты',      status:'Предстоит' },
        { date:'2025-10-15', amount:1500000, type:'Основной долг', status:'Предстоит' },
        { date:'2026-01-15', amount:1500000, type:'Основной долг', status:'Предстоит' },
      ],
    },
    // ── Monitoring ──
    monitoring: {
      lastVisitDate: '2025-05-20',
      frequency: 'Ежеквартально',
      meetings: [
        { date:'2025-05-20', format:'Визит', participants:'CEO, CFO, Алибек Сейтов',
          points:'Обсуждение Q1 2025 результатов. ARR $1.18M (+4% vs план).',
          decisions:'Утвердить план найма Q2. Ускорить enterprise pipeline.',
          actions:[{text:'Предоставить обновлённый cap table',deadline:'2025-06-01',resp:'Алибек Сейтов'}] },
        { date:'2025-02-15', format:'Онлайн', participants:'Investment Manager, CFO компании',
          points:'Промежуточный мониторинг Q4 2024.',
          decisions:'Показатели в норме. Долговая нагрузка приемлема.',
          actions:[] },
      ],
      reportReceivedDate: '2025-05-10',
      auditStatus: 'Завершён',
      covenantViolations: '',
      riskLevel: 'Низкий',
      riskComment: 'Стабильный рост, диверсифицированная клиентская база.',
    },
    // ── Documents ──
    documents: {
      driveUrl: '',
      files: [
        { type:'SHA / Кредитное соглашение', name:'SHA_TechHub_2024.pdf',    date:'2024-03-15', period:'', uploadedBy:'CEO',                expiryDate:'',          status:'OK'      },
        { type:'Залоговые документы',         name:'Collateral_Tech_2024.pdf',date:'2024-03-20', period:'', uploadedBy:'CFO',                expiryDate:'',          status:'OK'      },
        { type:'Финотчётность Q1 2025',       name:'FS_Q1_2025.xlsx',         date:'2025-05-10', period:'Q1 2025', uploadedBy:'Алибек Сейтов', expiryDate:'',        status:'OK'      },
        { type:'Финотчётность Q4 2024',       name:'FS_Q4_2024.xlsx',         date:'2025-02-10', period:'Q4 2024', uploadedBy:'Алибек Сейтов', expiryDate:'',        status:'OK'      },
        { type:'Страховой полис',             name:'Insurance_2025.pdf',      date:'2025-01-10', period:'2025', uploadedBy:'CFO',             expiryDate:'2025-12-31',status:'OK'      },
        { type:'Лицензия на деятельность',    name:'License_IT_2025.pdf',     date:'2025-01-15', period:'2025', uploadedBy:'CEO',             expiryDate:'2026-01-14',status:'OK'      },
      ],
    },
    // ── Compliance ──
    compliance: {
      programName: 'Цифровой Казахстан — ИТ субсидирование',
      programType: 'government',
      subsidizedRate: 7,
      grantAmount: 0,
      grantConditions: '',
      programs: ['Damu'],
      reportingDeadlines: [
        { program:'Damu', deadline:'2025-08-01', description:'Полугодовой отчёт', done: false },
        { program:'Damu', deadline:'2026-02-01', description:'Годовой отчёт',     done: false },
      ],
      esg: {
        jobsCreatedPlan:10, jobsCreatedActual:12,
        jobsPreservedPlan:44, jobsPreservedActual:44,
        womenLeadership: true, womenPct: 40,
        regionType: 'Городской центр',
        environmentalNotes: 'Безбумажный офис. Облачная инфраструктура.',
        socialImpact: 'Автоматизация 880 МСБ. Сокращение расходов на бухучёт на 40%.',
      },
    },
    // ── Exit Strategy ──
    exit: {
      exitType: 'Buyback founder',
      plannedDate: '2028-Q4',
      targetValuation: 20,
      prepProgress: 45,
      checklist: [
        { item:'Финансовый аудит завершён',          done: true  },
        { item:'Юридическая структура очищена',      done: true  },
        { item:'Management team готова',             done: false },
        { item:'Финансовая модель подготовлена',     done: false },
        { item:'Потенциальные покупатели определены',done: false },
      ],
      buyers: [
        { name:'AIFC Ventures', type:'PE Fund', contact:'ventures@aifc.kz', status:'Предварительный интерес' },
      ],
      notes: 'Основатель имеет опцион на выкуп по цене $18M. Стратегический покупатель — предпочтительный вариант.',
    },
    // ── History ──
    history: [
      { type:'comment', date:'2025-05-20', author:'Investment Manager', text:'Q1 2025 мониторинг завершён. Все ковенанты соблюдены.' },
      { type:'status',  date:'2024-12-01', author:'System', text:'Статус изменён: Active' },
      { type:'doc',     date:'2025-05-10', author:'Алибек Сейтов', text:'Загружена финотчётность Q1 2025' },
    ],
  },
  {
    id: 2, name: 'MedPoint KZ', sector: 'Здравоохранение', stage: 'Value Creation',
    bin: '200140023451', invested: 5, value: 9.5, date: '2024-05-20',
    exitStrategy: 'Strategic Sale', exitYear: 2029, moic: 1.9,
    fundShare: 21.7, manager: 'Investment Manager', status: 'Active',
    nextAction: 'Проверка лицензий МЗ РК', nextActionDate: '2025-07-15',
    lastUpdated: '2025-06-08',
    financials: {
      quarters: ['Q1 2024','Q2 2024','Q3 2024','Q4 2024','Q1 2025'],
      revenue:   { plan:[1000,1100,1150,1200,1300], actual:[980,1080,1180,1250,1290] },
      ebitda:    { plan:[200,230,240,260,280],       actual:[190,220,250,270,275]    },
      netProfit: { plan:[100,120,125,135,145],       actual:[95,115,130,140,140]     },
      employees: { plan:[60,63,65,68,70],            actual:[59,62,66,68,71]         },
      avgSalary: 420000, taxContrib: 35000000,
      totalDebt: 180000000, fundDebt: 100000000, debtService: 22000000,
      collateral: 'Залог медоборудования + доля 21.7%',
      collateralVal: 200000000, collateralStatus: 'Зарегистрирован',
      covenants: [
        { name:'Debt/EBITDA ≤ 4.0x',       ok: true  },
        { name:'DSCR ≥ 1.2x',               ok: true  },
        { name:'Лицензии МЗ актуальны',     ok: true  },
        { name:'Ежеквартальная отчётность', ok: true  },
      ],
      overduePayment: false, overdueAmount: 0,
      paymentSchedule: [
        { date:'2025-07-20', amount:2000000, type:'Основной долг', status:'Предстоит' },
        { date:'2025-09-20', amount:1200000, type:'Проценты',      status:'Предстоит' },
        { date:'2025-11-20', amount:2000000, type:'Основной долг', status:'Предстоит' },
      ],
    },
    monitoring: {
      lastVisitDate: '2025-06-05',
      frequency: 'Ежеквартально',
      meetings: [
        { date:'2025-06-05', format:'Визит', participants:'Investment Manager, Айгерим Нурова',
          points:'Рост MAU до 280K. Партнёрства с 15 клиниками.',
          decisions:'Расширение в Астану в Q3 2025.',
          actions:[{text:'Предоставить бизнес-план по Астане',deadline:'2025-07-01',resp:'Айгерим Нурова'}] },
      ],
      reportReceivedDate: '2025-05-15',
      auditStatus: 'В процессе',
      covenantViolations: '',
      riskLevel: 'Низкий',
      riskComment: 'Регуляторная среда стабильна. МЗ РК продление лицензий плановое.',
    },
    documents: {
      driveUrl: '',
      files: [
        { type:'SHA / Кредитное соглашение', name:'SHA_MedPoint_2024.pdf',  date:'2024-05-20', period:'',       uploadedBy:'CEO',            expiryDate:'',          status:'OK' },
        { type:'Залоговые документы',         name:'Collateral_Med_2024.pdf',date:'2024-05-25', period:'',       uploadedBy:'CFO',            expiryDate:'',          status:'OK' },
        { type:'Финотчётность Q1 2025',       name:'FS_Q1_2025_Med.xlsx',   date:'2025-05-15', period:'Q1 2025',uploadedBy:'Айгерим Нурова', expiryDate:'',          status:'OK' },
        { type:'Лицензия МЗ РК',              name:'License_MOH_2025.pdf',  date:'2025-02-01', period:'2025',   uploadedBy:'Айгерим Нурова', expiryDate:'2025-12-31',status:'OK' },
      ],
    },
    compliance: {
      programName: 'Цифровое здравоохранение 2025',
      programType: 'government',
      subsidizedRate: 6,
      grantAmount: 50000000,
      grantConditions: 'Создание 10 новых рабочих мест, охват 3 регионов',
      programs: ['Damu','QazIndustry'],
      reportingDeadlines: [
        { program:'Damu', deadline:'2025-09-01', description:'Квартальный отчёт по занятости', done:false },
      ],
      esg: {
        jobsCreatedPlan:10, jobsCreatedActual:11,
        jobsPreservedPlan:59, jobsPreservedActual:59,
        womenLeadership:true, womenPct:55,
        regionType:'Городской центр',
        environmentalNotes:'Минимизация бумажного документооборота.',
        socialImpact:'Доступная телемедицина для 280K казахстанцев. Охват отдалённых районов.',
      },
    },
    exit: {
      exitType: 'Strategic Sale',
      plannedDate: '2029-Q2',
      targetValuation: 25,
      prepProgress: 30,
      checklist: [
        { item:'Финансовый аудит завершён',          done: true  },
        { item:'Юридическая структура очищена',      done: false },
        { item:'Management team готова',             done: true  },
        { item:'Финансовая модель подготовлена',     done: false },
        { item:'Потенциальные покупатели определены',done: false },
      ],
      buyers: [],
      notes: 'Интерес со стороны региональных медицинских холдингов.',
    },
    history: [
      { type:'comment', date:'2025-06-05', author:'Investment Manager', text:'Q1 2025 — все показатели в норме. Расширение в Астану согласовано.' },
      { type:'doc',     date:'2025-05-15', author:'Айгерим Нурова',     text:'Загружена финотчётность Q1 2025' },
      { type:'status',  date:'2024-06-01', author:'System',             text:'Статус изменён: Active' },
    ],
  },
  {
    id: 3, name: 'GrainTech Partners', sector: 'АПК', stage: 'Активная',
    bin: '190240034562', invested: 6, value: 7.2, date: '2024-07-10',
    exitStrategy: 'IPO', exitYear: 2030, moic: 1.2,
    fundShare: 21.4, manager: 'CEO', status: 'Monitoring',
    nextAction: 'Получить отчёт за Q1 2025', nextActionDate: '2025-06-25',
    lastUpdated: '2025-05-30',
    financials: {
      quarters: ['Q1 2024','Q2 2024','Q3 2024','Q4 2024','Q1 2025'],
      revenue:   { plan:[700,900,1200,900,750],   actual:[680,870,1150,820,710]   },
      ebitda:    { plan:[140,200,280,180,140],     actual:[130,185,260,160,125]    },
      netProfit: { plan:[60,90,130,80,60],         actual:[50,80,115,65,48]        },
      employees: { plan:[120,125,135,130,125],     actual:[118,122,132,128,124]    },
      avgSalary: 280000, taxContrib: 42000000,
      totalDebt: 320000000, fundDebt: 180000000, debtService: 38000000,
      collateral: 'Залог земельных паёв 50K га + сельхозтехника',
      collateralVal: 450000000, collateralStatus: 'Зарегистрирован',
      covenants: [
        { name:'Debt/EBITDA ≤ 5.0x',       ok: true  },
        { name:'DSCR ≥ 1.2x',               ok: false },
        { name:'Минимальный урожай 150K т', ok: true  },
        { name:'Ежеквартальная отчётность', ok: false },
        { name:'Страхование урожая',        ok: true  },
      ],
      overduePayment: true, overdueAmount: 8500000,
      paymentSchedule: [
        { date:'2025-06-01', amount:3800000, type:'Основной долг', status:'Просрочен' },
        { date:'2025-07-01', amount:2200000, type:'Проценты',      status:'Предстоит' },
        { date:'2025-09-01', amount:3800000, type:'Основной долг', status:'Предстоит' },
        { date:'2025-12-01', amount:3800000, type:'Основной долг', status:'Предстоит' },
      ],
    },
    monitoring: {
      lastVisitDate: '2025-05-10',
      frequency: 'Ежемесячно',
      meetings: [
        { date:'2025-05-10', format:'Визит', participants:'CEO, Серик Байтасов',
          points:'Задержка посевной из-за погодных условий. Прогноз урожая снижен на 8%.',
          decisions:'Обсудить реструктуризацию платежа за июнь.',
          actions:[
            {text:'Запросить страховой акт по погодным рискам',deadline:'2025-05-25',resp:'Серик Байтасов'},
            {text:'Подготовить заявку на реструктуризацию',   deadline:'2025-05-31',resp:'CFO фонда'},
          ] },
      ],
      reportReceivedDate: '',
      auditStatus: 'Не требуется',
      covenantViolations: 'DSCR 1.05x — ниже порога 1.2x. Квартальный отчёт Q1 не предоставлен.',
      riskLevel: 'Высокий',
      riskComment: 'Погодные риски реализовались. Просрочка 45 дней. Ведутся переговоры по реструктуризации.',
    },
    documents: {
      driveUrl: '',
      files: [
        { type:'SHA / Кредитное соглашение',  name:'ConvNote_GrainTech_2024.pdf', date:'2024-07-10', period:'',   uploadedBy:'CEO',          expiryDate:'',          status:'OK'       },
        { type:'Залоговые документы',          name:'Land_Pledge_2024.pdf',        date:'2024-07-15', period:'',   uploadedBy:'CFO',          expiryDate:'',          status:'OK'       },
        { type:'Страховой полис (урожай)',     name:'CropInsurance_2025.pdf',      date:'2025-03-01', period:'2025',uploadedBy:'Серик Байтасов',expiryDate:'2025-10-31',status:'OK'      },
      ],
    },
    compliance: {
      programName: 'КазАгро — субсидирование АПК',
      programType: 'government',
      subsidizedRate: 5,
      grantAmount: 80000000,
      grantConditions: 'Сохранение рабочих мест, урожайность ≥ 150K т',
      programs: ['KazAgro'],
      reportingDeadlines: [
        { program:'KazAgro', deadline:'2025-07-15', description:'Отчёт по урожайности и занятости', done:false },
      ],
      esg: {
        jobsCreatedPlan:5,  jobsCreatedActual:3,
        jobsPreservedPlan:118, jobsPreservedActual:118,
        womenLeadership:false, womenPct:18,
        regionType:'Сельский',
        environmentalNotes:'Precision farming — снижение химикатов на 15%.',
        socialImpact:'Обеспечение занятости в Северном Казахстане. 118 рабочих мест в сельской местности.',
      },
    },
    exit: {
      exitType: 'IPO on KASE',
      plannedDate: '2030-Q1',
      targetValuation: 35,
      prepProgress: 10,
      checklist: [
        { item:'Финансовый аудит завершён',          done: false },
        { item:'Юридическая структура очищена',      done: false },
        { item:'Management team готова',             done: false },
        { item:'Финансовая модель подготовлена',     done: false },
        { item:'Потенциальные покупатели определены',done: false },
      ],
      buyers: [],
      notes: 'IPO на KASE — долгосрочная цель. Текущий приоритет — стабилизация финансовых показателей.',
    },
    history: [
      { type:'comment', date:'2025-05-10', author:'CEO',    text:'Просрочка 45 дней. Ведём переговоры по реструктуризации платежа.' },
      { type:'status',  date:'2025-04-01', author:'System', text:'Статус изменён: Monitoring (просрочка > 30 дней)' },
      { type:'comment', date:'2025-04-01', author:'CFO',    text:'Погодные риски реализовались. Урожай ниже плана на 8%.' },
    ],
  },
];
let portfolioIdCounter = 1;

/* ===== HARVESTING / EXIT ===== */
let harvestingList = [];

/* ===== CAPITAL CALLS ===== */
let capitalCalls = [];

/* ===== DISTRIBUTIONS ===== */
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
   Хранит URL загруженных документов и операционные данные
   Board Resolution, Closing Certificate, AFSA Notification
   welcomeLetterLog — какие LP уже получили Welcome Letter
================================================================ */
let firstClosingState = {
  boardResolutionUrl:  '',   // Template 2 — URL загруженного Board Resolution
  closingCertUrl:      '',   // Template 3 — URL Closing Certificate
  closingDate:         '2025-01-15',  // фактическая дата Closing Day
  firstCCId:           null, // id первого Capital Call (CC-2024-001)
  afsaNotifDate:       '',   // дата отправки уведомления в AFSA
  afsaNotifNum:        '',   // номер письма / reference
  afsaConfirmUrl:      '',   // URL подтверждения от AFSA
  welcomeLetterLog:    [],   // [lpId, lpId, ...] — кому уже сгенерирован Welcome Letter
};


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
let todayTasks = [];

/* ===== KYC FIELDS ===== */
const KYC_FIELDS_INDIVIDUAL = [
  { key: 'passport',       label: 'Паспорт / ИД (заверенная копия)' },
  { key: 'proofAddress',   label: 'Proof of Address (< 3 месяцев)' },
  { key: 'sourceOfFunds',  label: 'Source of Funds (документальное подтверждение)' },
  { key: 'taxId',          label: 'Tax ID / ИИН' },
  { key: 'pepCheck',       label: 'PEP Check (политически значимое лицо)' },
  { key: 'amlScreening',   label: 'AML Screening (санкционные списки)' },
];

const KYC_FIELDS_ENTITY = [
  { key: 'passport',       label: 'Устав / Certificate of Incorporation' },
  { key: 'proofAddress',   label: 'Proof of Registered Address' },
  { key: 'sourceOfFunds',  label: 'Source of Funds + Financial Statements' },
  { key: 'taxId',          label: 'Tax ID / BIN организации' },
  { key: 'pepCheck',       label: 'PEP Check директоров/бенефициаров' },
  { key: 'amlScreening',   label: 'AML Screening организации' },
  { key: 'uboVerified',    label: 'UBO (Ultimate Beneficial Owner) верификация' },
];

/* ===== CHART DATA ===== */
const chartData = {
  jcurve: {
    labels: ['2024','2025','2026','2027','2028','2029','2030','2031','2032','2033'],
    cashflow: [-5, -12, -8, -3, 8, 22, 45, 72, 98, 125],
  },
  nav: {
    labels: ['Q4\'24','Q1\'25','Q2\'25','Q3\'25','Q4\'25','Q1\'26','Q2\'26'],
    nav:    [35, 36.5, 38.2, 40.1, 42.0, 45.5, 48.0],
  },
  sectors: {
    labels: ['Технологии','Здравоохранение','АПК','Энергетика','Финансы'],
    data:   [4, 5, 6, 0, 0],
  },
  lpTypes: {
    labels: ['Юридическое лицо','Семейный офис','Физическое лицо','Институциональный'],
    data:   [11, 15, 2, 10],
  }
};
