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

/* ===== FIRST CLOSING STATE =====
   One row per fund (GET /api/first-closing, server/index.js) — used to be
   a single hardcoded object here with no backing store and no fund
   scoping at all. firstClosingList is populated by loadFirstClosingFromApi()
   (js/api-auth.js); currentFirstClosingState() (js/app.js) resolves the
   current fund's row, defaulting to a blank (never-yet-saved) state.
================================================================ */
let firstClosingList = [];
