// One-time seed: tenant #1 (Turan Capital), one admin user,
// and the 6 LP records already used as demo data in js/lp-register.js.
const path = require('path');
const { db, at } = require('./db');
const { dealToParams, INSERT_SQL: DEAL_INSERT_SQL } = require('./dealMapping');
const { portfolioToParams, INSERT_SQL: PORTFOLIO_INSERT_SQL } = require('./portfolioMapping');
const {
  restrictedToParams, RESTRICTED_INSERT_SQL,
  coiToParams, COI_INSERT_SQL,
  obClientToParams, OB_CLIENT_INSERT_SQL,
  obTaskToParams, OB_TASK_INSERT_SQL,
  engagementToParams, ENGAGEMENT_INSERT_SQL,
  conflictApprovalToParams, CONFLICT_APPROVAL_INSERT_SQL,
} = require('./onboardingMapping');
const { icMemoToParams, INSERT_SQL: IC_MEMO_INSERT_SQL } = require('./icMemoMapping');
const { documentToParams, INSERT_SQL: DOCUMENT_INSERT_SQL } = require('./documentMapping');
const { fundToParams, INSERT_SQL: FUND_INSERT_SQL } = require('./fundMapping');
const { extractArrayLiteral } = require('./extractFrontendData');
const { SYSTEM_ROLES } = require('./rolesSeed');
const { wfInstanceToParams, INSERT_SQL: WF_INSERT_SQL } = require('./workflowMapping');
const { upsertTenant, upsertRole, upsertUser } = require('./tenantProvisioning');

const SEED_EMAIL = 'admin@turancapital.kz';
const SEED_PASSWORD = 'TuranDemo2025!';

const FUNDS = [
  { name: 'Turan Capital Fund I LP', shortName: 'TCF-I', gp: 'Golden Leaves Ltd', license: 'AFSA-A-LA-2024-0038',
    type: 'Private Equity', currency: 'USD', targetSize: 50, vintage: 2024, status: 'active',
    phase: 'Investment Period', phaseYear: 2, fundTerm: 10, investmentPeriod: 5, managementFee: 2,
    carriedInterest: 20, preferredReturn: 8, targetIRR: '20–25%', targetMOIC: '2.5–3.5x',
    description: 'Первый фонд под управлением Golden Leaves Ltd. Инвестирует в компании среднего бизнеса в Казахстане и ЦА.',
    color: '#3b82f6', icon: 'fa-landmark', nav: 48 },
  { name: 'Turan Capital Fund II LP', shortName: 'TCF-II', gp: 'Golden Leaves Ltd', license: 'AFSA-A-LA-2025-XXXX',
    type: 'Growth Equity', currency: 'USD', targetSize: 100, vintage: 2026, status: 'fundraising',
    phase: 'Fundraising', phaseYear: 0, fundTerm: 10, investmentPeriod: 5, managementFee: 2,
    carriedInterest: 20, preferredReturn: 8, targetIRR: '22–28%', targetMOIC: '3.0–4.0x',
    description: 'Второй фонд. Фокус на Growth Equity в технологических компаниях ЦА и MENA.',
    color: '#8b5cf6', icon: 'fa-rocket', nav: 0 },
];

// Returns { [shortName]: id } for the tenant's funds, seeding them on first run.
function seedFunds(tenantId) {
  const existing = db.prepare('SELECT id, short_name FROM funds WHERE tenant_id = ? ORDER BY id').all(tenantId);
  if (existing.length > 0) {
    console.log(`funds already has ${existing.length} rows for tenant ${tenantId}, skipping seed.`);
    const ids = {};
    for (const row of existing) ids[row.short_name] = row.id;
    return ids;
  }
  const insert = db.prepare(FUND_INSERT_SQL);
  const ids = {};
  db.exec('BEGIN');
  try {
    for (const f of FUNDS) {
      const info = insert.run(at({ tenantId, ...fundToParams(f) }));
      ids[f.shortName] = info.lastInsertRowid;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${FUNDS.length} funds for tenant ${tenantId}.`);
  return ids;
}

const LP_RECORDS = [
  { registerId:'LP-2024-001', name:'Silk Steppe Capital LLP', type:'Corporate', lpType:'Institution', country:'Казахстан',
    address:'пр. Аль-Фараби 15, БЦ Esentai Tower, Алматы, 050059', taxId:'241040012345', contact:'Асанов Б.К.',
    email:'b.assanov@silksteppe.kz', phone:'+7 701 222 10 01', commitment:8000000, calledAmount:4281346, paidAmount:3792049,
    distributions:0, fundClass:'A', ownershipPct:24.46, professionalClient:'Deemed Professional Client', kycStatus:'Одобрен',
    kycDate:'2024-10-20', kycNextReview:'2026-10-20', riskRating:'Low', admissionDate:'2024-11-05', saNumber:'SA-2024-001',
    afsaNotified:true, lpacMember:true, status:'Active', exitDate:null,
    notes:'Полный пакет KYC получен и проверен. AML — чисто. Ownership >20% — AFSA уведомлён.', obClientId:null,
    rm:'Асанов Б.К. (RM)', identityVerified:true, proofAddressVerified:true, sofVerified:true, taxIdVerified:true,
    pepCheckCleared:true, amlScreeningCleared:true, uboVerified:true },
  { registerId:'LP-2024-002', name:'Отбасы Family Office', type:'Corporate', lpType:'Family Office', country:'Казахстан',
    address:'ул. Сатпаева 30, Алматы, 050040', taxId:'241040023456', contact:'Жаксыбекова А.Н.',
    email:'a.zhaksybekova@otbasyfo.kz', phone:'+7 701 222 10 02', commitment:6000000, calledAmount:3211008, paidAmount:2844036,
    distributions:0, fundClass:'A', ownershipPct:18.35, professionalClient:'Deemed Professional Client', kycStatus:'Одобрен',
    kycDate:'2024-10-25', kycNextReview:'2025-10-25', riskRating:'Medium', admissionDate:'2024-11-12', saNumber:'SA-2024-002',
    afsaNotified:false, lpacMember:true, status:'Active', exitDate:null,
    notes:'KYC подтверждён комплаенс-офицером. Family Office структура — стандартная due diligence.', obClientId:null,
    rm:'Жаксыбекова А.Н. (RM)', identityVerified:true, proofAddressVerified:true, sofVerified:true, taxIdVerified:true,
    pepCheckCleared:true, amlScreeningCleared:true, uboVerified:true },
  { registerId:'LP-2024-003', name:'АО «Каспий Инвест»', type:'Corporate', lpType:'Institution', country:'Казахстан',
    address:'пр. Азаттық 79, Атырау, 060011', taxId:'020840034567', contact:'Молдабеков Т.С.',
    email:'t.moldabekov@kaspiinvest.kz', phone:'+7 701 222 10 03', commitment:10000000, calledAmount:5351683, paidAmount:4740062,
    distributions:0, fundClass:'A', ownershipPct:30.58, professionalClient:'Deemed Professional Client', kycStatus:'Одобрен',
    kycDate:'2024-10-18', kycNextReview:'2026-10-18', riskRating:'Low', admissionDate:'2024-11-01', saNumber:'SA-2024-003',
    afsaNotified:true, lpacMember:true, status:'Active', exitDate:null,
    notes:'Крупнейший LP фонда, институциональный инвестор. Ownership >20% — AFSA уведомлён.', obClientId:null,
    rm:'Асанов Б.К. (RM)', identityVerified:true, proofAddressVerified:true, sofVerified:true, taxIdVerified:true,
    pepCheckCleared:true, amlScreeningCleared:true, uboVerified:true },
  { registerId:'LP-2024-004', name:'Eurasia Bridge Partners LLP', type:'Corporate', lpType:'Institution', country:'Казахстан',
    address:'пр. Мәңгілік Ел 55/22, Астана, 010000', taxId:'241140045678', contact:'Ким Виктория Олеговна',
    email:'v.kim@eurasiabridge.kz', phone:'+7 701 222 10 04', commitment:7500000, calledAmount:4013762, paidAmount:3555046,
    distributions:0, fundClass:'A', ownershipPct:22.94, professionalClient:'Deemed Professional Client', kycStatus:'Одобрен',
    kycDate:'2024-11-20', kycNextReview:'2026-11-20', riskRating:'Low', admissionDate:'2024-12-01', saNumber:'SA-2024-004',
    afsaNotified:false, lpacMember:true, status:'Active', exitDate:null,
    notes:'KYC пройден без замечаний. Ownership >20% — уведомление AFSA ожидается (10 р.д.).', obClientId:null,
    rm:'Жаксыбекова А.Н. (RM)', identityVerified:true, proofAddressVerified:true, sofVerified:true, taxIdVerified:true,
    pepCheckCleared:true, amlScreeningCleared:true, uboVerified:true },
  { registerId:'LP-2024-005', name:'Нурланов Ерлан Тимурович', type:'Individual', lpType:'HNWI', country:'Казахстан',
    address:'мкр. Самал-2, д. 111, Алматы', taxId:'870614300521', contact:'Нурланов Е.Т.',
    email:'e.nurlanov@gmail.com', phone:'+7 701 333 20 05', commitment:1200000, calledAmount:642201, paidAmount:568807,
    distributions:0, fundClass:'B', ownershipPct:3.67, professionalClient:'Assessed Professional Client', kycStatus:'Одобрен',
    kycDate:'2024-12-05', kycNextReview:'2025-12-05', riskRating:'Medium', admissionDate:'2024-12-10', saNumber:'SA-2024-005',
    afsaNotified:false, lpacMember:false, status:'Active', exitDate:null,
    notes:'Индивидуальный квалифицированный инвестор. Собственные средства подтверждены.', obClientId:null,
    rm:'Асанов Б.К. (RM)', identityVerified:true, proofAddressVerified:true, sofVerified:true, taxIdVerified:true,
    pepCheckCleared:true, amlScreeningCleared:true, uboVerified:false },
  { registerId:'LP-2024-006', name:'Байжанова Динара Сериковна', type:'Individual', lpType:'HNWI', country:'Казахстан',
    address:'ул. Кенесары 40, Астана', taxId:'901215400987', contact:'Байжанова Д.С.',
    email:'d.baizhanova@gmail.com', phone:'+7 701 333 20 06', commitment:750000, calledAmount:0, paidAmount:0,
    distributions:0, fundClass:'B', ownershipPct:0, professionalClient:'Assessed Professional Client', kycStatus:'В процессе',
    kycDate:null, kycNextReview:null, riskRating:'High', admissionDate:null, saNumber:null,
    afsaNotified:false, lpacMember:false, status:'Onboarding', exitDate:null,
    notes:'KYC в процессе — ожидается Source of Funds и AML screening.', obClientId:null,
    rm:'Жаксыбекова А.Н. (RM)', identityVerified:true, proofAddressVerified:true, sofVerified:false, taxIdVerified:true,
    pepCheckCleared:true, amlScreeningCleared:false, uboVerified:false },
];

function seedLpRegister(tenantId, fundId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM lp_register WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`lp_register already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }
  const insert = db.prepare(`
    INSERT INTO lp_register
      (tenant_id, fund_id, register_id, name, type, lp_type, country, address, tax_id, contact, email, phone,
       commitment, called_amount, paid_amount, distributions, fund_class, ownership_pct, professional_client,
       kyc_status, kyc_date, kyc_next_review, risk_rating, admission_date, sa_number, afsa_notified, lpac_member,
       status, exit_date, notes, ob_client_id, rm, identity_verified, proof_address_verified, sof_verified,
       tax_id_verified, pep_check_cleared, aml_screening_cleared, ubo_verified)
    VALUES
      (@tenantId, @fundId, @registerId, @name, @type, @lpType, @country, @address, @taxId, @contact, @email, @phone,
       @commitment, @calledAmount, @paidAmount, @distributions, @fundClass, @ownershipPct, @professionalClient,
       @kycStatus, @kycDate, @kycNextReview, @riskRating, @admissionDate, @saNumber, @afsaNotified, @lpacMember,
       @status, @exitDate, @notes, @obClientId, @rm, @identityVerified, @proofAddressVerified, @sofVerified,
       @taxIdVerified, @pepCheckCleared, @amlScreeningCleared, @uboVerified)
  `);
  db.exec('BEGIN');
  try {
    for (const r of LP_RECORDS) {
      insert.run(at({
        tenantId,
        fundId,
        ...r,
        afsaNotified: r.afsaNotified ? 1 : 0,
        lpacMember: r.lpacMember ? 1 : 0,
        identityVerified: r.identityVerified ? 1 : 0,
        proofAddressVerified: r.proofAddressVerified ? 1 : 0,
        sofVerified: r.sofVerified ? 1 : 0,
        taxIdVerified: r.taxIdVerified ? 1 : 0,
        pepCheckCleared: r.pepCheckCleared ? 1 : 0,
        amlScreeningCleared: r.amlScreeningCleared ? 1 : 0,
        uboVerified: r.uboVerified ? 1 : 0,
      }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${LP_RECORDS.length} LP records for tenant ${tenantId}.`);
}

const CAPITAL_CALLS = [
  { ccNumber:'CC-2024-001', noticeDate:'2024-11-15', paymentDate:'2024-12-02', totalAmount:4500000, pctOfCommit:13.76,
    purpose:'Инвестиция в NomadTech Solutions', purposeType:'Investment', status:'Completed', managementFee:false,
    bankRef:'CC-2024-001-TCF', createdBy:'CFO (Amankulov Zhanibek)',
    notes:'Первый Capital Call фонда. Средства направлены на закрытие сделки NomadTech Solutions. Все LP оплатили в срок.',
    lineItems: [
      { lpId:1, commitment:8000000,  pct:13.76, called:1100917, paid:1100917, paymentDate:'2024-12-02', status:'Paid', wireRef:'SSC-CC001', amlOk:true },
      { lpId:2, commitment:6000000,  pct:13.76, called:825688,  paid:825688,  paymentDate:'2024-12-02', status:'Paid', wireRef:'OFO-CC001', amlOk:true },
      { lpId:3, commitment:10000000, pct:13.76, called:1376147, paid:1376147, paymentDate:'2024-12-02', status:'Paid', wireRef:'KI-CC001',  amlOk:true },
      { lpId:4, commitment:7500000,  pct:13.76, called:1032110, paid:1032110, paymentDate:'2024-12-02', status:'Paid', wireRef:'EBP-CC001', amlOk:true },
      { lpId:5, commitment:1200000,  pct:13.76, called:165138,  paid:165138,  paymentDate:'2024-12-02', status:'Paid', wireRef:'NET-CC001', amlOk:true },
    ] },
  { ccNumber:'CC-2025-001', noticeDate:'2025-02-10', paymentDate:'2025-02-28', totalAmount:5000000, pctOfCommit:15.29,
    purpose:'Инвестиция в VitaMed Astana', purposeType:'Investment', status:'Completed', managementFee:false,
    bankRef:'CC-2025-001-TCF', createdBy:'CFO (Amankulov Zhanibek)',
    notes:'Средства направлены на закрытие сделки VitaMed Astana.',
    lineItems: [
      { lpId:1, commitment:8000000,  pct:15.29, called:1223242, paid:1223242, paymentDate:'2025-02-28', status:'Paid', wireRef:'SSC-CC002', amlOk:true },
      { lpId:2, commitment:6000000,  pct:15.29, called:917431,  paid:917431,  paymentDate:'2025-02-28', status:'Paid', wireRef:'OFO-CC002', amlOk:true },
      { lpId:3, commitment:10000000, pct:15.29, called:1529052, paid:1529052, paymentDate:'2025-02-28', status:'Paid', wireRef:'KI-CC002',  amlOk:true },
      { lpId:4, commitment:7500000,  pct:15.29, called:1146789, paid:1146789, paymentDate:'2025-02-28', status:'Paid', wireRef:'EBP-CC002', amlOk:true },
      { lpId:5, commitment:1200000,  pct:15.29, called:183486,  paid:183486,  paymentDate:'2025-02-28', status:'Paid', wireRef:'NET-CC002', amlOk:true },
    ] },
  { ccNumber:'CC-2025-002', noticeDate:'2025-05-05', paymentDate:'2025-05-22', totalAmount:6000000, pctOfCommit:18.35,
    purpose:'Инвестиция в Dala Agro Holding', purposeType:'Investment', status:'Completed', managementFee:false,
    bankRef:'CC-2025-002-TCF', createdBy:'CFO (Amankulov Zhanibek)',
    notes:'Средства направлены на финансирование Dala Agro Holding (Convertible Note).',
    lineItems: [
      { lpId:1, commitment:8000000,  pct:18.35, called:1467890, paid:1467890, paymentDate:'2025-05-22', status:'Paid', wireRef:'SSC-CC003', amlOk:true },
      { lpId:2, commitment:6000000,  pct:18.35, called:1100917, paid:1100917, paymentDate:'2025-05-22', status:'Paid', wireRef:'OFO-CC003', amlOk:true },
      { lpId:3, commitment:10000000, pct:18.35, called:1834863, paid:1834863, paymentDate:'2025-05-22', status:'Paid', wireRef:'KI-CC003',  amlOk:true },
      { lpId:4, commitment:7500000,  pct:18.35, called:1376147, paid:1376147, paymentDate:'2025-05-22', status:'Paid', wireRef:'EBP-CC003', amlOk:true },
      { lpId:5, commitment:1200000,  pct:18.35, called:220183,  paid:220183,  paymentDate:'2025-05-22', status:'Paid', wireRef:'NET-CC003', amlOk:true },
    ] },
  { ccNumber:'CC-2025-003', noticeDate:'2025-07-01', paymentDate:'2025-07-21', totalAmount:2000000, pctOfCommit:6.12,
    purpose:'Пополнение операционного резерва фонда', purposeType:'Operating Reserve', status:'Pending', managementFee:false,
    bankRef:'CC-2025-003-TCF', createdBy:'CFO (Amankulov Zhanibek)',
    notes:'Пополнение операционного резерва фонда для покрытия текущих операционных расходов GP. Оплата ожидается.',
    lineItems: [
      { lpId:1, commitment:8000000,  pct:6.12, called:489297, paid:0, paymentDate:'2025-07-21', status:'Pending', wireRef:'', amlOk:null },
      { lpId:2, commitment:6000000,  pct:6.12, called:366972, paid:0, paymentDate:'2025-07-21', status:'Pending', wireRef:'', amlOk:null },
      { lpId:3, commitment:10000000, pct:6.12, called:611621, paid:0, paymentDate:'2025-07-21', status:'Pending', wireRef:'', amlOk:null },
      { lpId:4, commitment:7500000,  pct:6.12, called:458716, paid:0, paymentDate:'2025-07-21', status:'Pending', wireRef:'', amlOk:null },
      { lpId:5, commitment:1200000,  pct:6.12, called:73394,  paid:0, paymentDate:'2025-07-21', status:'Pending', wireRef:'', amlOk:null },
    ] },
];

function seedCapitalCalls(tenantId, fundId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM capital_calls WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`capital_calls already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const insertCall = db.prepare(`
    INSERT INTO capital_calls
      (tenant_id, fund_id, cc_number, notice_date, payment_date, total_amount, pct_of_commit, purpose, purpose_type,
       status, management_fee, bank_ref, created_by, notes)
    VALUES
      (@tenantId, @fundId, @ccNumber, @noticeDate, @paymentDate, @totalAmount, @pctOfCommit, @purpose, @purposeType,
       @status, @managementFee, @bankRef, @createdBy, @notes)
  `);
  const insertItem = db.prepare(`
    INSERT INTO capital_call_line_items
      (tenant_id, call_id, lp_id, commitment, pct, called, paid, payment_date, status, wire_ref, aml_ok)
    VALUES
      (@tenantId, @callId, @lpId, @commitment, @pct, @called, @paid, @paymentDate, @status, @wireRef, @amlOk)
  `);

  db.exec('BEGIN');
  try {
    for (const c of CAPITAL_CALLS) {
      const { lineItems, ...ccFields } = c;
      const info = insertCall.run(at({ tenantId, fundId, ...ccFields, managementFee: c.managementFee ? 1 : 0 }));
      const callId = info.lastInsertRowid;
      for (const li of lineItems) {
        insertItem.run(at({
          tenantId, callId,
          ...li,
          amlOk: li.amlOk === null ? null : (li.amlOk ? 1 : 0),
        }));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${CAPITAL_CALLS.length} capital calls for tenant ${tenantId}.`);
}

// NOTE: deals used to be extracted at seed time from js/data.js's `deals`
// array via extractArrayLiteral() — but that array has since been emptied
// out (js/data.js now loads deals from this same seed via the API instead),
// so the 7 deals are hardcoded here directly, same as LP_RECORDS/CAPITAL_CALLS.
const DEALS = [
  {
    id: 1, company: 'NomadTech Solutions', sector: 'Технологии', stage: 'Закрыта', amount: 4.5,
    type: 'Equity', priority: 'Высокий', manager: 'Investment Manager', ic: 'Одобрено',
    tags: ['SaaS','B2B'], nextAction: '', nextActionDate: '', updatedAt: '2024-11-20',
    country: 'Казахстан', companyStage: 'Growth Stage', preMoney: 15,
    dealSource: 'Партнёр', firstContactDate: '2024-06-10', revenue: '$70K MRR', roundSize: '$4.5M', checkSize: 4.5,
    description: 'SaaS-платформа автоматизации бухучёта для МСБ Казахстана. Быстрый рост клиентской базы, высокая маржинальность.',
    founderContacts: [{ role:'CEO', name:'Алибек Сейтов', phone:'+7 701 555 10 01', email:'a.seitov@nomadtech.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [{ v:'v1', date:'2024-09-15', url:'' }],
    signedDocsUrls: [{ name:'SHA', url:'' }, { name:'SPA', url:'' }],
    wireConfirmUrl: '', otherDocs: [],
    instrument: 'Equity', coInvestors: '', icDecision: 'Одобрено', icDate: '2024-10-05',
    icVotes: [{ member:'CEO', vote:'Yes' }, { member:'CFO', vote:'Yes' }, { member:'Investment Manager', vote:'Yes' }],
    icRisks: ['Зависимость от одного co-founder\'а в разработке'],
    ddDeadline: '2024-09-20', tsFundLawyer: 'GRATA International', dataRoomUrl: '',
    ddLegal: [{ item:'Устав и корп. структура', status:'OK' }],
    ddFinancial: [{ item:'Финотчётность 2022-2024', status:'OK' }],
    ddTech: [{ item:'Код-аудит платформы', status:'OK' }],
    ddCommercial: [{ item:'Анализ клиентской базы', status:'OK' }],
    ddRedFlags: [], ddConsultants: [{ name:'Deloitte Kazakhstan', role:'Financial DD', status:'Завершено' }],
    comments: [
      { id:1, author:'Investment Manager', date:'2024-11-20', text:'Сделка закрыта, средства перечислены. Компания переведена в портфель.' },
      { id:2, author:'CEO', date:'2024-10-06', text:'IC единогласно одобрил инвестицию.' },
    ],
  },
  {
    id: 2, company: 'VitaMed Astana', sector: 'Здравоохранение', stage: 'Закрыта', amount: 5,
    type: 'Equity', priority: 'Высокий', manager: 'Investment Manager', ic: 'Одобрено',
    tags: ['Telemedicine','HealthTech'], nextAction: '', nextActionDate: '', updatedAt: '2025-02-28',
    country: 'Казахстан', companyStage: 'Expansion', preMoney: 18,
    dealSource: 'Inbound', firstContactDate: '2024-09-01', revenue: '$90K MRR', roundSize: '$5M', checkSize: 5,
    description: 'Платформа телемедицины для отдалённых регионов Казахстана. Партнёрства с региональными клиниками.',
    founderContacts: [{ role:'CEO', name:'Айгерим Нурова', phone:'+7 701 555 10 02', email:'a.nurova@vitamed.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [{ v:'v1', date:'2024-12-10', url:'' }],
    signedDocsUrls: [{ name:'SHA', url:'' }],
    wireConfirmUrl: '', otherDocs: [],
    instrument: 'Equity', coInvestors: '', icDecision: 'Одобрено', icDate: '2025-01-15',
    icVotes: [{ member:'CEO', vote:'Yes' }, { member:'CFO', vote:'Yes' }, { member:'Investment Manager', vote:'Yes' }],
    icRisks: ['Регуляторные изменения в сфере телемедицины'],
    ddDeadline: '2025-01-05', tsFundLawyer: 'Dentons', dataRoomUrl: '',
    ddLegal: [{ item:'Лицензии МЗ РК', status:'OK' }],
    ddFinancial: [{ item:'Финотчётность 2023-2024', status:'OK' }],
    ddTech: [{ item:'Аудит платформы и данных пациентов', status:'OK' }],
    ddCommercial: [{ item:'Партнёрская сеть клиник', status:'OK' }],
    ddRedFlags: [], ddConsultants: [{ name:'KPMG Kazakhstan', role:'Legal & Financial DD', status:'Завершено' }],
    comments: [
      { id:1, author:'Investment Manager', date:'2025-02-28', text:'Сделка закрыта. Компания переведена в портфель.' },
    ],
  },
  {
    id: 3, company: 'Dala Agro Holding', sector: 'АПК', stage: 'Закрыта', amount: 6,
    type: 'Convertible Note', priority: 'Средний', manager: 'CEO', ic: 'Одобрено',
    tags: ['Agriculture','Grain'], nextAction: '', nextActionDate: '', updatedAt: '2025-05-22',
    country: 'Казахстан', companyStage: 'Expansion', preMoney: 22,
    dealSource: 'Рекомендация', firstContactDate: '2024-11-15', revenue: '$3.2M годовая выручка', roundSize: '$6M', checkSize: 6,
    description: 'Зерновой холдинг в Костанайской области. Собственный земельный банк 50K га, экспортные контракты в Центральную Азию.',
    founderContacts: [{ role:'CEO', name:'Серик Байтасов', phone:'+7 701 555 10 03', email:'s.baitasov@dalaagro.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [{ v:'v1', date:'2025-03-01', url:'' }],
    signedDocsUrls: [{ name:'Convertible Note Agreement', url:'' }],
    wireConfirmUrl: '', otherDocs: [],
    instrument: 'Convertible Note', coInvestors: '', icDecision: 'Одобрено', icDate: '2025-04-10',
    icVotes: [{ member:'CEO', vote:'Yes' }, { member:'CFO', vote:'Yes' }, { member:'Investment Manager', vote:'No' }],
    icRisks: ['Погодные и урожайные риски', 'Волатильность экспортных цен на зерно'],
    ddDeadline: '2025-03-25', tsFundLawyer: 'GRATA International', dataRoomUrl: '',
    ddLegal: [{ item:'Права на земельные паи', status:'OK' }],
    ddFinancial: [{ item:'Финотчётность 2022-2024', status:'OK' }],
    ddTech: [{ item:'Состояние сельхозтехники', status:'Получен' }],
    ddCommercial: [{ item:'Экспортные контракты', status:'OK' }],
    ddRedFlags: ['Высокая долговая нагрузка у операционной компании'],
    ddConsultants: [{ name:'BDO Kazakhstan', role:'Financial DD', status:'Завершено' }],
    comments: [
      { id:1, author:'CEO', date:'2025-05-22', text:'Сделка закрыта, конвертируемый заём выдан. Компания переведена в портфель.' },
    ],
  },
  {
    id: 4, company: 'Steppe Logistics KZ', sector: 'Промышленность', stage: 'Due Diligence', amount: 5.5,
    type: 'Equity', priority: 'Высокий', manager: 'Investment Manager', ic: 'На рассмотрении',
    tags: ['Logistics','B2B'], nextAction: 'Завершить финансовый DD', nextActionDate: '2025-08-05', updatedAt: '2025-07-01',
    country: 'Казахстан', companyStage: 'Growth Stage', preMoney: 20,
    dealSource: 'Конференция', firstContactDate: '2025-03-20', revenue: '$1.1M годовая выручка', roundSize: '$5.5M', checkSize: 5.5,
    description: 'Логистический оператор — мультимодальные перевозки между Казахстаном, Китаем и странами Центральной Азии.',
    founderContacts: [{ role:'CEO', name:'Тимур Ахметов', phone:'+7 701 555 10 04', email:'t.akhmetov@steppelogistics.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [], signedDocsUrls: [], wireConfirmUrl: '', otherDocs: [],
    instrument: 'Equity', coInvestors: '', icDecision: 'На рассмотрении', icDate: '',
    icVotes: [], icRisks: ['Концентрация на 2 крупных клиентах'],
    ddDeadline: '2025-08-05', tsFundLawyer: 'GRATA International', dataRoomUrl: '',
    ddLegal: [{ item:'Корпоративная структура', status:'OK' }, { item:'Лицензии на перевозки', status:'В процессе' }],
    ddFinancial: [{ item:'Финотчётность 2023-2024', status:'Получен' }, { item:'Управленческая отчётность 2025', status:'Запрошен' }],
    ddTech: [{ item:'IT-система трекинга грузов', status:'В процессе' }],
    ddCommercial: [{ item:'Клиентская концентрация', status:'В процессе' }],
    ddRedFlags: [], ddConsultants: [{ name:'Deloitte Kazakhstan', role:'Financial DD', status:'В процессе' }],
    comments: [
      { id:1, author:'Investment Manager', date:'2025-07-01', text:'Data room открыт, финансовый DD в процессе.' },
    ],
  },
  {
    id: 5, company: 'Green Energy Almaty', sector: 'Энергетика', stage: 'IC Review', amount: 7,
    type: 'Equity', priority: 'Средний', manager: 'CFO', ic: 'Подано',
    tags: ['Renewables','Solar'], nextAction: 'Подготовить IC меморандум', nextActionDate: '2025-07-20', updatedAt: '2025-07-05',
    country: 'Казахстан', companyStage: 'Development/Construction', preMoney: 25,
    dealSource: 'Прямой outreach', firstContactDate: '2025-04-05', revenue: 'Пре-выручка (стадия строительства)', roundSize: '$7M', checkSize: 7,
    description: 'Разработчик солнечных электростанций для промышленных потребителей в Алматинской области.',
    founderContacts: [{ role:'CEO', name:'Данияр Оспанов', phone:'+7 701 555 10 05', email:'d.ospanov@greenenergy.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [], signedDocsUrls: [], wireConfirmUrl: '', otherDocs: [],
    instrument: 'Equity', coInvestors: 'AIFC Green Fund (в переговорах)', icDecision: 'Подано', icDate: '2025-07-20',
    icVotes: [], icRisks: ['Разрешительная документация на землю не завершена'],
    ddDeadline: '2025-07-15', tsFundLawyer: '', dataRoomUrl: '',
    ddLegal: [{ item:'Права на земельный участок', status:'В процессе' }],
    ddFinancial: [{ item:'Финансовая модель проекта', status:'Получен' }],
    ddTech: [{ item:'Технико-экономическое обоснование', status:'OK' }],
    ddCommercial: [{ item:'PPA с промышленными потребителями', status:'В процессе' }],
    ddRedFlags: [], ddConsultants: [],
    comments: [
      { id:1, author:'CFO', date:'2025-07-05', text:'Готовим материалы к заседанию IC 20 июля.' },
    ],
  },
  {
    id: 6, company: 'FinBridge Kazakhstan', sector: 'Финансы', stage: 'Скрининг', amount: 3,
    type: 'SAFE', priority: 'Низкий', manager: 'Analyst', ic: 'Не подано',
    tags: ['Fintech','Payments'], nextAction: 'Первичный звонок с фаундерами', nextActionDate: '2025-07-18', updatedAt: '2025-07-10',
    country: 'Казахстан', companyStage: 'Growth Stage', preMoney: 10,
    dealSource: 'Ивент', firstContactDate: '2025-07-08', revenue: '$40K MRR', roundSize: '$3M', checkSize: 3,
    description: 'B2B-платформа платежей и эквайринга для интернет-магазинов Казахстана и Узбекистана.',
    founderContacts: [{ role:'CEO', name:'Ержан Тулегенов', phone:'+7 701 555 10 06', email:'e.tulegenov@finbridge.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [], signedDocsUrls: [], wireConfirmUrl: '', otherDocs: [],
    instrument: 'SAFE', coInvestors: '', icDecision: 'Не подано', icDate: '',
    icVotes: [], icRisks: [],
    ddDeadline: '', tsFundLawyer: '', dataRoomUrl: '',
    ddLegal: [], ddFinancial: [], ddTech: [], ddCommercial: [],
    ddRedFlags: [], ddConsultants: [],
    comments: [
      { id:1, author:'Analyst', date:'2025-07-10', text:'Первичный скрининг — интересный рынок, запланирован звонок.' },
    ],
  },
  {
    id: 7, company: 'Retail Hub Karaganda', sector: 'Ритейл', stage: 'Отклонена IC', amount: 2.5,
    type: 'Equity', priority: 'Низкий', manager: 'Analyst', ic: 'Отклонено',
    tags: ['Retail','Regional'], nextAction: '', nextActionDate: '', updatedAt: '2025-06-01',
    country: 'Казахстан', companyStage: 'Growth Stage', preMoney: 8,
    dealSource: 'Партнёр', firstContactDate: '2025-04-01', revenue: '$25K MRR', roundSize: '$2.5M', checkSize: 2.5,
    description: 'Сеть региональных магазинов формата «у дома» в Карагандинской области.',
    founderContacts: [{ role:'CEO', name:'Марат Игенов', phone:'+7 701 555 10 07', email:'m.igenov@retailhub.kz' }],
    pitchDeckUrl:'', icMemoUrl:'', icMinutesUrl:'',
    tsVersions: [], signedDocsUrls: [], wireConfirmUrl: '', otherDocs: [],
    instrument: 'Equity', coInvestors: '', icDecision: 'Отклонено', icDate: '2025-05-28',
    icVotes: [{ member:'CEO', vote:'No' }, { member:'CFO', vote:'No' }, { member:'Investment Manager', vote:'Yes' }],
    icRisks: ['Слишком узкая региональная ниша', 'Низкая маржинальность ритейла'],
    ddDeadline: '2025-05-20', tsFundLawyer: '', dataRoomUrl: '',
    ddLegal: [{ item:'Корпоративная структура', status:'OK' }],
    ddFinancial: [{ item:'Финотчётность 2023-2024', status:'OK' }],
    ddTech: [], ddCommercial: [{ item:'Рыночная ниша и масштабируемость', status:'Red Flag' }],
    ddRedFlags: ['Модель не масштабируется за пределы одного региона'],
    ddConsultants: [],
    rejectCategory: 'Рынок', canReturn: 'Через 12 месяцев', rejectFollowUpDate: '2026-06-01',
    rejectDecisionBy: 'IC Chair', rejectComment: 'Слишком нишевый региональный рынок, недостаточный потенциал масштабирования для мандата фонда.',
    comments: [
      { id:1, author:'Investment Manager', date:'2025-06-01', text:'IC отклонил сделку. Возможен возврат к рассмотрению через 12 месяцев при расширении географии.' },
    ],
  },
];

function seedDeals(tenantId, fundId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM deals WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`deals already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const insert = db.prepare(DEAL_INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const d of DEALS) {
      insert.run(at({ tenantId, ...dealToParams(d), fundId }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${DEALS.length} deals for tenant ${tenantId}.`);
}

// NOTE: same lesson as DEALS above — js/data.js's `portfolio` array has
// since been emptied out (it now loads from this seed via the API), so
// the 3 portfolio companies are hardcoded here directly rather than
// extracted from the frontend file.
const PORTFOLIO = [
  {
    id: 1, name: 'NomadTech Solutions', sector: 'Технологии', stage: 'Value Creation',
    bin: '210540019283', invested: 4.5, value: 6.8, date: '2024-11-20',
    exitStrategy: 'M&A', exitYear: 2028, moic: 1.51,
    fundShare: 24.5, manager: 'Investment Manager', status: 'Active',
    nextAction: 'Провести Q2 2025 мониторинговый визит', nextActionDate: '2025-07-25',
    lastUpdated: '2025-06-15',
    financials: {
      quarters: ['Q4 2024','Q1 2025','Q2 2025'],
      revenue:   { plan:[210, 230, 250], actual:[205, 235, 260] },
      ebitda:    { plan:[35, 42, 48],    actual:[32, 44, 51]    },
      netProfit: { plan:[18, 22, 26],    actual:[16, 23, 28]    },
      employees: { plan:[24, 27, 30],    actual:[23, 28, 31]    },
      avgSalary: 480000, taxContrib: 21000000,
      totalDebt: 0, fundDebt: 0, debtService: 0,
      collateral: 'Доля 24.5% в компании (equity)',
      collateralVal: 0, collateralStatus: 'Не применимо (equity-сделка)',
      covenants: [
        { name:'Ежеквартальная отчётность', ok: true },
        { name:'Согласование крупных сделок >$300K', ok: true },
      ],
      overduePayment: false, overdueAmount: 0,
      paymentSchedule: [],
    },
    monitoring: {
      lastVisitDate: '2025-05-28',
      frequency: 'Ежеквартально',
      meetings: [
        { date:'2025-05-28', format:'Визит', participants:'Investment Manager, Алибек Сейтов',
          points:'Рост MRR до $85K. Запуск модуля для розничной торговли.',
          decisions:'Утвердить наём 3 разработчиков в Q3 2025.',
          actions:[{text:'Предоставить обновлённый cap table',deadline:'2025-06-15',resp:'Алибек Сейтов'}] },
      ],
      reportReceivedDate: '2025-06-10',
      auditStatus: 'Завершён',
      covenantViolations: '',
      riskLevel: 'Низкий',
      riskComment: 'Стабильный рост MRR, положительная unit-экономика.',
    },
    documents: {
      driveUrl: '',
      files: [
        { type:'SHA / Shareholders Agreement', name:'SHA_NomadTech_2024.pdf', date:'2024-11-20', period:'', uploadedBy:'CEO', expiryDate:'', status:'OK' },
        { type:'Финотчётность Q2 2025', name:'FS_Q2_2025_NomadTech.xlsx', date:'2025-06-10', period:'Q2 2025', uploadedBy:'Алибек Сейтов', expiryDate:'', status:'OK' },
      ],
    },
    compliance: {
      programName: 'Цифровой Казахстан — ИТ субсидирование',
      programType: 'government', subsidizedRate: 7, grantAmount: 0, grantConditions: '',
      programs: ['Damu'],
      reportingDeadlines: [
        { program:'Damu', deadline:'2025-08-01', description:'Полугодовой отчёт', done:false },
      ],
      esg: {
        jobsCreatedPlan:8, jobsCreatedActual:9, jobsPreservedPlan:22, jobsPreservedActual:23,
        womenLeadership:true, womenPct:45, regionType:'Городской центр',
        environmentalNotes:'Безбумажный офис, облачная инфраструктура.',
        socialImpact:'Автоматизация учёта для 600+ МСБ, снижение расходов на бухучёт на 35%.',
      },
    },
    exit: {
      exitType: 'M&A', plannedDate: '2028-Q4', targetValuation: 18, prepProgress: 15,
      checklist: [
        { item:'Финансовый аудит завершён', done:true },
        { item:'Юридическая структура очищена', done:true },
        { item:'Management team готова', done:false },
        { item:'Финансовая модель подготовлена', done:false },
        { item:'Потенциальные покупатели определены', done:false },
      ],
      buyers: [], notes: 'Стратегический интерес со стороны регионального финтех-холдинга — предварительные переговоры.',
    },
    history: [
      { type:'comment', date:'2025-06-15', author:'Investment Manager', text:'Q2 2025 мониторинг завершён. Все показатели выше плана.' },
      { type:'status', date:'2024-11-20', author:'System', text:'Статус изменён: Active' },
      { type:'doc', date:'2025-06-10', author:'Алибек Сейтов', text:'Загружена финотчётность Q2 2025' },
    ],
  },
  {
    id: 2, name: 'VitaMed Astana', sector: 'Здравоохранение', stage: 'Value Creation',
    bin: '250240038172', invested: 5, value: 7.4, date: '2025-02-28',
    exitStrategy: 'Strategic Sale', exitYear: 2029, moic: 1.48,
    fundShare: 21.8, manager: 'Investment Manager', status: 'Active',
    nextAction: 'Проверка лицензий МЗ РК', nextActionDate: '2025-08-10',
    lastUpdated: '2025-06-20',
    financials: {
      quarters: ['Q1 2025','Q2 2025'],
      revenue:   { plan:[280, 310], actual:[275, 320] },
      ebitda:    { plan:[55, 65],   actual:[52, 68]   },
      netProfit: { plan:[28, 34],   actual:[26, 36]   },
      employees: { plan:[38, 42],   actual:[37, 43]   },
      avgSalary: 410000, taxContrib: 18500000,
      totalDebt: 0, fundDebt: 0, debtService: 0,
      collateral: 'Доля 21.8% в компании (equity)',
      collateralVal: 0, collateralStatus: 'Не применимо (equity-сделка)',
      covenants: [
        { name:'Лицензии МЗ актуальны', ok: true },
        { name:'Ежеквартальная отчётность', ok: true },
      ],
      overduePayment: false, overdueAmount: 0,
      paymentSchedule: [],
    },
    monitoring: {
      lastVisitDate: '2025-06-12',
      frequency: 'Ежеквартально',
      meetings: [
        { date:'2025-06-12', format:'Онлайн', participants:'Investment Manager, Айгерим Нурова',
          points:'Рост MAU до 95K. Запущены партнёрства с 8 новыми клиниками.',
          decisions:'Расширение в Шымкент в Q4 2025.',
          actions:[{text:'Подготовить бизнес-план по Шымкенту',deadline:'2025-07-15',resp:'Айгерим Нурова'}] },
      ],
      reportReceivedDate: '2025-06-05',
      auditStatus: 'В процессе',
      covenantViolations: '',
      riskLevel: 'Низкий',
      riskComment: 'Регуляторная среда стабильна, лицензии продлены на плановой основе.',
    },
    documents: {
      driveUrl: '',
      files: [
        { type:'SHA / Shareholders Agreement', name:'SHA_VitaMed_2025.pdf', date:'2025-02-28', period:'', uploadedBy:'CEO', expiryDate:'', status:'OK' },
        { type:'Лицензия МЗ РК', name:'License_MOH_2025.pdf', date:'2025-01-15', period:'2025', uploadedBy:'Айгерим Нурова', expiryDate:'2026-01-14', status:'OK' },
      ],
    },
    compliance: {
      programName: 'Цифровое здравоохранение 2025',
      programType: 'government', subsidizedRate: 6, grantAmount: 40000000,
      grantConditions: 'Создание 8 новых рабочих мест, охват 2 регионов',
      programs: ['Damu','QazIndustry'],
      reportingDeadlines: [
        { program:'Damu', deadline:'2025-09-01', description:'Квартальный отчёт по занятости', done:false },
      ],
      esg: {
        jobsCreatedPlan:8, jobsCreatedActual:8, jobsPreservedPlan:35, jobsPreservedActual:35,
        womenLeadership:true, womenPct:58, regionType:'Городской центр',
        environmentalNotes:'Минимизация бумажного документооборота.',
        socialImpact:'Доступная телемедицина для 95K казахстанцев в отдалённых районах.',
      },
    },
    exit: {
      exitType: 'Strategic Sale', plannedDate: '2029-Q2', targetValuation: 22, prepProgress: 10,
      checklist: [
        { item:'Финансовый аудит завершён', done:false },
        { item:'Юридическая структура очищена', done:true },
        { item:'Management team готова', done:true },
        { item:'Финансовая модель подготовлена', done:false },
        { item:'Потенциальные покупатели определены', done:false },
      ],
      buyers: [], notes: 'Интерес со стороны региональных медицинских холдингов на раннем этапе.',
    },
    history: [
      { type:'comment', date:'2025-06-12', author:'Investment Manager', text:'Q2 2025 — все показатели выше плана. Расширение в Шымкент согласовано.' },
      { type:'status', date:'2025-02-28', author:'System', text:'Статус изменён: Active' },
    ],
  },
  {
    id: 3, name: 'Dala Agro Holding', sector: 'АПК', stage: 'Активная',
    bin: '200640027651', invested: 6, value: 6.9, date: '2025-05-22',
    exitStrategy: 'IPO', exitYear: 2030, moic: 1.15,
    fundShare: 19.4, manager: 'CEO', status: 'Monitoring',
    nextAction: 'Получить отчёт за Q2 2025', nextActionDate: '2025-08-01',
    lastUpdated: '2025-06-25',
    financials: {
      quarters: ['Q2 2025'],
      revenue:   { plan:[850],  actual:[790] },
      ebitda:    { plan:[170],  actual:[150] },
      netProfit: { plan:[75],   actual:[62]  },
      employees: { plan:[135],  actual:[131] },
      avgSalary: 290000, taxContrib: 24000000,
      totalDebt: 180000000, fundDebt: 60000000, debtService: 14000000,
      collateral: 'Залог земельных паёв 50K га + сельхозтехника',
      collateralVal: 260000000, collateralStatus: 'Зарегистрирован',
      covenants: [
        { name:'Debt/EBITDA ≤ 5.0x', ok: true },
        { name:'Минимальный урожай 140K т', ok: true },
        { name:'Ежеквартальная отчётность', ok: false },
      ],
      overduePayment: false, overdueAmount: 0,
      paymentSchedule: [
        { date:'2025-09-01', amount:1400000, type:'Проценты', status:'Предстоит' },
        { date:'2025-12-01', amount:3200000, type:'Основной долг', status:'Предстоит' },
      ],
    },
    monitoring: {
      lastVisitDate: '2025-06-18',
      frequency: 'Ежемесячно',
      meetings: [
        { date:'2025-06-18', format:'Визит', participants:'CEO, Серик Байтасов',
          points:'Посевная завершена в срок. Прогноз урожая на уровне плана.',
          decisions:'Продолжить мониторинг в ежемесячном режиме до сбора урожая.',
          actions:[{text:'Предоставить отчёт по ходу уборочной кампании',deadline:'2025-07-15',resp:'Серик Байтасов'}] },
      ],
      reportReceivedDate: '',
      auditStatus: 'Не требуется',
      covenantViolations: 'Квартальный отчёт Q2 2025 ещё не предоставлен.',
      riskLevel: 'Средний',
      riskComment: 'Свежая сделка, стандартные для АПК погодные риски. Отслеживаем плотно.',
    },
    documents: {
      driveUrl: '',
      files: [
        { type:'Convertible Note Agreement', name:'ConvNote_DalaAgro_2025.pdf', date:'2025-05-22', period:'', uploadedBy:'CEO', expiryDate:'', status:'OK' },
        { type:'Залоговые документы', name:'Land_Pledge_2025.pdf', date:'2025-05-27', period:'', uploadedBy:'CFO', expiryDate:'', status:'OK' },
      ],
    },
    compliance: {
      programName: 'КазАгро — субсидирование АПК',
      programType: 'government', subsidizedRate: 5, grantAmount: 70000000,
      grantConditions: 'Сохранение рабочих мест, урожайность ≥ 140K т',
      programs: ['KazAgro'],
      reportingDeadlines: [
        { program:'KazAgro', deadline:'2025-08-15', description:'Отчёт по урожайности и занятости', done:false },
      ],
      esg: {
        jobsCreatedPlan:4, jobsCreatedActual:2, jobsPreservedPlan:129, jobsPreservedActual:131,
        womenLeadership:false, womenPct:16, regionType:'Сельский',
        environmentalNotes:'Precision farming — снижение использования химикатов на 12%.',
        socialImpact:'Обеспечение занятости в Костанайской области — 131 рабочее место в сельской местности.',
      },
    },
    exit: {
      exitType: 'IPO on KASE', plannedDate: '2030-Q1', targetValuation: 30, prepProgress: 5,
      checklist: [
        { item:'Финансовый аудит завершён', done:false },
        { item:'Юридическая структура очищена', done:false },
        { item:'Management team готова', done:false },
        { item:'Финансовая модель подготовлена', done:false },
        { item:'Потенциальные покупатели определены', done:false },
      ],
      buyers: [], notes: 'IPO на KASE — долгосрочная цель. Приоритет — прохождение первого сезона мониторинга.',
    },
    history: [
      { type:'comment', date:'2025-06-18', author:'CEO', text:'Посевная завершена в срок, прогноз урожая на уровне плана.' },
      { type:'status', date:'2025-05-22', author:'System', text:'Статус изменён: Monitoring' },
    ],
  },
];

function seedPortfolio(tenantId, fundId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM portfolio WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`portfolio already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const insert = db.prepare(PORTFOLIO_INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const p of PORTFOLIO) {
      insert.run(at({ tenantId, ...portfolioToParams(p), fundId }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${PORTFOLIO.length} portfolio companies for tenant ${tenantId}.`);
}

/* ===== Onboarding / KYC-AML ===== */

// Faithful reproduction of js/onboarding.js's obAddBizDays() + the task-
// generation rules inside createOnboardingTasks() (lines 5573 and 263),
// so seeded obTasks match exactly what the browser would generate on
// first load — see the audit notes above seedOnboarding().
function obAddBizDays(date, days) {
  let d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

const OB_TASK_TEMPLATES_CFA = [
  { num: '1.1', title: 'Conflict Pre-Check (Go/No-Go)',  phase: 1, role: 'RM', dayEnd: 2,  formKey: 'conflict_precheck' },
  { num: '2.1', title: 'Documentation Collection',       phase: 2, role: 'RM', dayEnd: 5,  formKey: 'doc_collection' },
  { num: '2.2', title: 'Client Due Diligence Outcome',   phase: 2, role: 'CO', dayEnd: 7,  formKey: 'dd_outcome' },
  { num: '3.1', title: 'Client Classification (AFSA)',   phase: 3, role: 'RM', dayEnd: 9,  formKey: 'classification' },
  { num: '3.2', title: 'Suitability / Appropriateness',  phase: 3, role: 'RM', dayEnd: 10, formKey: 'suitability' },
  { num: '4.1', title: 'Draft & Sign Engagement Letter', phase: 4, role: 'RM', dayEnd: 13, formKey: 'engagement_letter' },
  { num: '5.1', title: 'Client Activation',              phase: 5, role: 'RM', dayEnd: 15, formKey: 'activation' },
];
const OB_TASK_TEMPLATES_FM = [
  { num: '1.1', title: 'Conflict Pre-Check (Go/No-Go)',   phase: 1, role: 'RM', dayEnd: 2,  formKey: 'conflict_precheck' },
  { num: '2.1', title: 'Documentation Collection (LP)',   phase: 2, role: 'RM', dayEnd: 5,  formKey: 'doc_collection' },
  { num: '2.2', title: 'AML / KYC Due Diligence',         phase: 2, role: 'CO', dayEnd: 7,  formKey: 'dd_outcome' },
  { num: '3.1', title: 'LP Qualification Check',          phase: 3, role: 'RM', dayEnd: 9,  formKey: 'lp_qualification' },
  { num: '3.2', title: 'Investment Profile & Suitability', phase: 3, role: 'RM', dayEnd: 10, formKey: 'lp_investment_profile' },
  { num: '4.1', title: 'Subscription Agreement',          phase: 4, role: 'RM', dayEnd: 13, formKey: 'subscription_agreement' },
  { num: '5.1', title: 'LP Activation',                   phase: 5, role: 'RM', dayEnd: 15, formKey: 'activation' },
];
function getTaskTemplates(direction) { return direction === 'FM' ? OB_TASK_TEMPLATES_FM : OB_TASK_TEMPLATES_CFA; }

function buildTasksForClient(client) {
  const start = new Date(client.startDate);
  const clientPhase = client.phase || 1;
  return getTaskTemplates(client.direction).map(tpl => {
    const dueDate = obAddBizDays(start, tpl.dayEnd);
    let status;
    if (client.activated) status = 'completed';
    else if (tpl.phase < clientPhase) status = 'completed';
    else if (tpl.phase === clientPhase) status = 'open';
    else status = 'locked';
    return {
      taskNum: tpl.num, title: tpl.title, phase: tpl.phase, role: tpl.role, formKey: tpl.formKey,
      dueDate: dueDate.toISOString().slice(0, 10), status, formData: {},
      completedAt: client.activated ? client.startDate : (tpl.phase < clientPhase ? client.startDate : null),
      completedBy: client.activated ? 'CEO' : (tpl.phase < clientPhase ? 'RM (Relationship Manager)' : null),
    };
  });
}

// NOTE: same lesson as DEALS/PORTFOLIO above — js/onboarding.js's 4 arrays
// have since been emptied out, so they're hardcoded here directly.
const RESTRICTED_LIST = [
  { id: 1, company: 'Arman Steel Group',     sector: 'Металлургия', fund: 'TCF-I', ownershipPct: 45, restrictionType: 'Full Restriction',  cfaAllowed: false, requiresApproval: true,  addedAt: '2024-02-10', addedBy: 'CO' },
  { id: 2, company: 'Baikonur Data Systems', sector: 'Технологии',  fund: 'TCF-I', ownershipPct: 30, restrictionType: 'Requires Approval', cfaAllowed: true,  requiresApproval: true,  addedAt: '2025-04-18', addedBy: 'CO' },
  { id: 3, company: 'Kentau Mining LLP',     sector: 'Горнодобыча', fund: 'TCF-I', ownershipPct: 55, restrictionType: 'Full Restriction',  cfaAllowed: false, requiresApproval: false, addedAt: '2024-11-02', addedBy: 'MLRO' },
];

const COI_REGISTRY = [
  {
    id: 1, coiId: 'COI-2025-001', date: '2025-04-20',
    conflictType: 'Restricted List Match', parties: 'Baikonur Data Systems / Golden Leaves Ltd.',
    severity: 'Medium', status: 'Resolved',
    description: 'CF&A клиент запросил консультационные услуги по сделке с Baikonur Data Systems — портфельной компанией TCF-I (30% владения).',
    measures: 'Согласовано CCO. Услуги оказаны с раскрытием конфликта и информационным барьером (Chinese wall) между FM и CF&A командами.',
    responsible: 'CCO', reviewDate: '2025-07-20', resolution: 'Конфликт раскрыт клиенту, услуги оказаны в рамках согласованных ограничений.',
    linkedClientId: null,
  },
  {
    id: 2, coiId: 'COI-2025-002', date: '2025-06-02',
    conflictType: 'Outside Business Interest', parties: 'Асанов Б.К. (RM) / АО «Каспий Инвест»',
    severity: 'Low', status: 'Resolved',
    description: 'RM Асанов Б.К. сообщил, что его супруга занимает должность в АО «Каспий Инвест» — действующем LP фонда TCF-I.',
    measures: 'Асанов Б.К. отстранён от вопросов капитала и отчётности данного LP; курирование напрямую передано CCO.',
    responsible: 'CCO', reviewDate: '2025-09-02', resolution: 'Раскрытие принято, назначен альтернативный контакт для LP.',
    linkedClientId: 5,
  },
];

const OB_CLIENTS = [
  {
    id: 1, clientId: 'CL-2026-001',
    name: 'Нурлан Абенов', type: 'Individual',
    classification: 'Professional Client',
    serviceType: 'Advising',
    direction: 'CF&A',
    rm: 'Жаксыбекова А.Н. (RM)',
    phase: 3, onboardingStatus: 'On Track', riskRating: 'Low',
    startDate: '2026-06-25', targetDate: '2026-07-17',
    nextAction: 'Awaiting CO approval on Classification',
    notes: 'HNWI-инвестор. Консультационные услуги по сделке M&A.',
    restrictedMatch: false, activated: false,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2026-07-03',
    professionalClientVerified: false,
  },
  {
    id: 2, clientId: 'CL-2026-002',
    name: 'Meridian Trade LLP', type: 'Corporate',
    classification: 'Market Counterparty',
    serviceType: 'Arranging',
    direction: 'CF&A',
    rm: 'Асанов Б.К. (RM)',
    phase: 2, onboardingStatus: 'At Risk', riskRating: 'Medium',
    startDate: '2026-06-10', targetDate: '2026-07-02',
    nextAction: 'Documentation pending — UBO passport required',
    notes: 'BVI-зарегистрированная холдинговая структура. Несколько UBO.',
    restrictedMatch: false, activated: false,
    identityVerified: false, pepStatus: null, sanctionsCleared: false, sanctionsCheckedAt: null,
    professionalClientVerified: false,
  },
  {
    id: 3, clientId: 'CL-2024-001',
    name: 'Silk Steppe Capital LLP', type: 'Corporate',
    classification: 'Qualified Investor',
    serviceType: 'LP Investment',
    lpType: 'Corporate',
    commitment: 8000000,
    direction: 'FM',
    rm: 'Асанов Б.К. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Low',
    startDate: '2024-10-10', targetDate: '2024-11-05',
    nextAction: '—',
    notes: 'Полный пакет KYC получен и проверен. Commitment $8M.',
    restrictedMatch: false, activated: true,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2024-10-18',
    sofVerified: true, sowVerified: true, professionalClientVerified: true,
  },
  {
    id: 4, clientId: 'CL-2024-002',
    name: 'Отбасы Family Office', type: 'Corporate',
    classification: 'Qualified Investor',
    serviceType: 'LP Investment',
    lpType: 'Family Office',
    commitment: 6000000,
    direction: 'FM',
    rm: 'Жаксыбекова А.Н. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Low',
    startDate: '2024-10-17', targetDate: '2024-11-12',
    nextAction: '—',
    notes: 'KYC подтверждён комплаенс-офицером. Commitment $6M.',
    restrictedMatch: false, activated: true,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2024-10-25',
    sofVerified: true, sowVerified: true, professionalClientVerified: true,
  },
  {
    id: 5, clientId: 'CL-2024-003',
    name: 'АО «Каспий Инвест»', type: 'Corporate',
    classification: 'Qualified Investor',
    serviceType: 'LP Investment',
    lpType: 'Institution',
    commitment: 10000000,
    direction: 'FM',
    rm: 'Асанов Б.К. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Low',
    startDate: '2024-10-06', targetDate: '2024-11-01',
    nextAction: '—',
    notes: 'Крупнейший LP фонда, институциональный инвестор. Commitment $10M.',
    restrictedMatch: false, activated: true,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2024-10-14',
    sofVerified: true, sowVerified: true, professionalClientVerified: true,
  },
  {
    id: 6, clientId: 'CL-2024-004',
    name: 'Eurasia Bridge Partners LLP', type: 'Corporate',
    classification: 'Qualified Investor',
    serviceType: 'LP Investment',
    lpType: 'Corporate',
    commitment: 7500000,
    direction: 'FM',
    rm: 'Жаксыбекова А.Н. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Low',
    startDate: '2024-11-06', targetDate: '2024-12-01',
    nextAction: '—',
    notes: 'KYC пройден без замечаний. Commitment $7.5M.',
    restrictedMatch: false, activated: true,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2024-11-14',
    sofVerified: true, sowVerified: true, professionalClientVerified: true,
  },
  {
    id: 7, clientId: 'CL-2024-005',
    name: 'Нурланов Ерлан Тимурович', type: 'Individual',
    classification: 'Qualified Investor',
    serviceType: 'LP Investment',
    lpType: 'HNWI',
    commitment: 1200000,
    direction: 'FM',
    rm: 'Асанов Б.К. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Low',
    startDate: '2024-11-15', targetDate: '2024-12-10',
    nextAction: '—',
    notes: 'Индивидуальный квалифицированный инвестор. Commitment $1.2M.',
    restrictedMatch: false, activated: true,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2024-11-22',
    sofVerified: true, sowVerified: true, professionalClientVerified: true,
  },
  {
    id: 8, clientId: 'CL-2026-003',
    name: 'Байжанова Динара Сериковна', type: 'Individual',
    classification: 'Qualified Investor',
    serviceType: 'LP Investment',
    lpType: 'HNWI',
    commitment: 750000,
    direction: 'FM',
    rm: 'Жаксыбекова А.Н. (RM)',
    phase: 2, onboardingStatus: 'On Track', riskRating: 'Medium',
    startDate: '2026-07-01', targetDate: '2026-07-22',
    nextAction: 'AML / KYC Due Diligence (2.2) — ожидается Source of Funds и AML screening',
    notes: 'Индивидуальный инвестор. Commitment $0.75M. Паспорт и подтверждение адреса получены, PEP check пройден, Source of Funds и AML screening в процессе.',
    restrictedMatch: false, activated: false,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: false, sanctionsCheckedAt: null,
    sofVerified: false, sowVerified: false, professionalClientVerified: false,
  },
  // -- "Internal Client" demo (COI Addendum Section C): the CF&A client IS
  // itself a portfolio company of a fund managed by this GP — self-dealing
  // risk requiring CF Deal Committee + Compliance pre-approval regardless
  // of deal size. Linked via internalPortfolioId to portfolio.id=1.
  {
    id: 9, clientId: 'CL-2026-004',
    name: 'NomadTech Solutions', type: 'Corporate',
    classification: 'Professional Client',
    serviceType: 'Advising',
    direction: 'CF&A',
    rm: 'Асанов Б.К. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Medium',
    startDate: '2026-05-04', targetDate: '2026-05-26',
    nextAction: '—',
    notes: 'Internal Client: портфельная компания TCF-I запросила Advising по подготовке к следующему раунду капитала (Fairness Opinion). Одобрено CF Deal Committee с независимой оценкой и мониторингом volume cap.',
    restrictedMatch: false, activated: true,
    isInternalClient: true, internalPortfolioId: 1,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2026-05-10',
    professionalClientVerified: true,
  },
  // -- Repeat client with multiple, unrelated engagements over time PLUS a
  // Dual-Mandate scenario (COI Addendum Section D: Advising + Arranging on
  // the SAME transaction) — see engagements 7/8/9 below sharing deal_ref.
  {
    id: 10, clientId: 'CL-2025-006',
    name: 'Zhetysu Trading LLP', type: 'Corporate',
    classification: 'Professional Client',
    serviceType: 'Both',
    direction: 'CF&A',
    rm: 'Жаксыбекова А.Н. (RM)',
    phase: 5, onboardingStatus: 'Completed', riskRating: 'Medium',
    startDate: '2025-08-11', targetDate: '2025-09-02',
    nextAction: '—',
    notes: 'Повторный клиент CF&A: первый мандат (business valuation, 2025) завершён; второй мандат (2026) — параллельные Advising + Arranging на одной сделке (Dual-Mandate), одобрено CF Deal Committee единогласно с сегрегацией команд.',
    restrictedMatch: false, activated: true,
    identityVerified: true, pepStatus: 'Не PEP', sanctionsCleared: true, sanctionsCheckedAt: '2025-08-15',
    professionalClientVerified: true,
  },
];

// Одна Subscription Agreement на каждого завершённого FM LP — feeAmount =
// commitment, invoiced/paid зеркалят calledAmount/paidAmount из LP_RECORDS выше.
const ENGAGEMENTS = [
  { id: 1, engId: 'ENG-2024-001', clientId: 3, clientName: 'Silk Steppe Capital LLP',
    serviceType: 'LP Investment (FM)', contractNum: 'SA-2024-001', date: '2024-11-05', signedDate: '2024-11-05', status: 'Active',
    feeType: 'Management Fee + Carry', feeAmount: 8000000, successFee: 20, retainer: null, payTerms: 'По Capital Call',
    invoiced: 3600000, paid: 3600000, startDate: '2024-11-05', endDate: '2034-11-05',
    rm: 'Асанов Б.К. (RM)', notes: 'FM LP Subscription. Commitment: $8.00M.', direction: 'FM',
    activationDate: '2024-11-11', activatedBy: 'CO (Compliance Officer)',
    lpaUrl: '', lpSignedDate: '2024-11-05', capitalCallDate: '2024-11-30', amendments: '[]' },
  { id: 2, engId: 'ENG-2024-002', clientId: 4, clientName: 'Отбасы Family Office',
    serviceType: 'LP Investment (FM)', contractNum: 'SA-2024-002', date: '2024-11-12', signedDate: '2024-11-12', status: 'Active',
    feeType: 'Management Fee + Carry', feeAmount: 6000000, successFee: 20, retainer: null, payTerms: 'По Capital Call',
    invoiced: 2700000, paid: 2700000, startDate: '2024-11-12', endDate: '2034-11-12',
    rm: 'Жаксыбекова А.Н. (RM)', notes: 'FM LP Subscription. Commitment: $6.00M.', direction: 'FM',
    activationDate: '2024-11-18', activatedBy: 'CO (Compliance Officer)',
    lpaUrl: '', lpSignedDate: '2024-11-12', capitalCallDate: '2024-11-30', amendments: '[]' },
  { id: 3, engId: 'ENG-2024-003', clientId: 5, clientName: 'АО «Каспий Инвест»',
    serviceType: 'LP Investment (FM)', contractNum: 'SA-2024-003', date: '2024-11-01', signedDate: '2024-11-01', status: 'Active',
    feeType: 'Management Fee + Carry', feeAmount: 10000000, successFee: 20, retainer: null, payTerms: 'По Capital Call',
    invoiced: 4500000, paid: 4500000, startDate: '2024-11-01', endDate: '2034-11-01',
    rm: 'Асанов Б.К. (RM)', notes: 'FM LP Subscription. Commitment: $10.00M. Крупнейший LP фонда.', direction: 'FM',
    activationDate: '2024-11-07', activatedBy: 'CO (Compliance Officer)',
    lpaUrl: '', lpSignedDate: '2024-11-01', capitalCallDate: '2024-11-30', amendments: '[]' },
  { id: 4, engId: 'ENG-2024-004', clientId: 6, clientName: 'Eurasia Bridge Partners LLP',
    serviceType: 'LP Investment (FM)', contractNum: 'SA-2024-004', date: '2024-12-01', signedDate: '2024-12-01', status: 'Active',
    feeType: 'Management Fee + Carry', feeAmount: 7500000, successFee: 20, retainer: null, payTerms: 'По Capital Call',
    invoiced: 3400000, paid: 3400000, startDate: '2024-12-01', endDate: '2034-12-01',
    rm: 'Жаксыбекова А.Н. (RM)', notes: 'FM LP Subscription. Commitment: $7.50M.', direction: 'FM',
    activationDate: '2024-12-07', activatedBy: 'CO (Compliance Officer)',
    lpaUrl: '', lpSignedDate: '2024-12-01', capitalCallDate: '2024-12-31', amendments: '[]' },
  { id: 5, engId: 'ENG-2024-005', clientId: 7, clientName: 'Нурланов Ерлан Тимурович',
    serviceType: 'LP Investment (FM)', contractNum: 'SA-2024-005', date: '2024-12-10', signedDate: '2024-12-10', status: 'Active',
    feeType: 'Management Fee + Carry', feeAmount: 1200000, successFee: 20, retainer: null, payTerms: 'По Capital Call',
    invoiced: 540000, paid: 540000, startDate: '2024-12-10', endDate: '2034-12-10',
    rm: 'Асанов Б.К. (RM)', notes: 'FM LP Subscription. Commitment: $1.20M. Индивидуальный квалифицированный инвестор.', direction: 'FM',
    activationDate: '2024-12-16', activatedBy: 'CO (Compliance Officer)',
    lpaUrl: '', lpSignedDate: '2024-12-10', capitalCallDate: '2024-12-31', amendments: '[]' },
  // -- Internal Client engagement (NomadTech Solutions, ob_clients id 9) --
  { id: 6, engId: 'ENG-2026-001', clientId: 9, clientName: 'NomadTech Solutions',
    serviceType: 'Advising', contractNum: 'ADV-2026-001', date: '2026-05-04', signedDate: '2026-05-06', status: 'Active',
    feeType: 'Fixed Fee', feeAmount: 150000, successFee: null, retainer: null, payTerms: '50% upfront / 50% on delivery',
    invoiced: 75000, paid: 75000, startDate: '2026-05-06', endDate: '2026-08-06',
    rm: 'Асанов Б.К. (RM)', notes: 'Internal Client — Fairness Opinion для следующего раунда капитала. Независимая оценка обязательна.',
    direction: 'CF&A', activationDate: '2026-05-06', activatedBy: 'CF Deal Committee',
    lpaUrl: '', lpSignedDate: '', capitalCallDate: '', amendments: '[]', dealRef: 'DEAL-NTS-2026-CAP' },
  // -- Repeat client, matter #1: completed Advising (unrelated to matter #2 below) --
  { id: 7, engId: 'ENG-2025-007', clientId: 10, clientName: 'Zhetysu Trading LLP',
    serviceType: 'Advising', contractNum: 'ADV-2025-007', date: '2025-08-11', signedDate: '2025-08-13', status: 'Completed',
    feeType: 'Fixed Fee', feeAmount: 60000, successFee: null, retainer: null, payTerms: 'On delivery',
    invoiced: 60000, paid: 60000, startDate: '2025-08-13', endDate: '2025-09-30',
    rm: 'Жаксыбекова А.Н. (RM)', notes: 'Business valuation для внутренних целей клиента. Мандат №1, закрыт.',
    direction: 'CF&A', activationDate: '2025-08-13', activatedBy: 'Compliance Officer',
    lpaUrl: '', lpSignedDate: '', capitalCallDate: '', amendments: '[]', dealRef: 'DEAL-ZHT-2025-VAL' },
  // -- Repeat client, matter #2: Dual-Mandate — Advising AND Arranging on the SAME deal_ref --
  { id: 8, engId: 'ENG-2026-002', clientId: 10, clientName: 'Zhetysu Trading LLP',
    serviceType: 'Advising', contractNum: 'ADV-2026-002', date: '2026-03-02', signedDate: '2026-03-05', status: 'Active',
    feeType: 'Fixed Fee', feeAmount: 90000, successFee: null, retainer: null, payTerms: '50% upfront / 50% on delivery',
    invoiced: 45000, paid: 45000, startDate: '2026-03-05', endDate: '2026-09-05',
    rm: 'Жаксыбекова А.Н. (RM)', notes: 'Dual-Mandate: independent fairness opinion workstream (segregated from Arranging team below).',
    direction: 'CF&A', activationDate: '2026-03-05', activatedBy: 'CF Deal Committee',
    lpaUrl: '', lpSignedDate: '', capitalCallDate: '', amendments: '[]', dealRef: 'DEAL-ZHT-2026-CAP' },
  { id: 9, engId: 'ENG-2026-003', clientId: 10, clientName: 'Zhetysu Trading LLP',
    serviceType: 'Arranging', contractNum: 'ARR-2026-003', date: '2026-03-02', signedDate: '2026-03-05', status: 'Active',
    feeType: 'Success Fee', feeAmount: 0, successFee: 4, retainer: null, payTerms: 'On completion',
    invoiced: 0, paid: 0, startDate: '2026-03-05', endDate: '2026-09-05',
    rm: 'Жаксыбекова А.Н. (RM)', notes: 'Dual-Mandate: private placement arranging workstream (segregated from Advising above).',
    direction: 'CF&A', activationDate: '2026-03-05', activatedBy: 'CF Deal Committee',
    lpaUrl: '', lpSignedDate: '', capitalCallDate: '', amendments: '[]', dealRef: 'DEAL-ZHT-2026-CAP' },
];

function seedOnboarding(tenantId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM ob_clients WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`ob_clients already has ${count} rows for tenant ${tenantId}, skipping onboarding seed.`); return; }

  const restrictedList = RESTRICTED_LIST;
  const coiRegistry = COI_REGISTRY;
  const obClients = OB_CLIENTS;
  const engagements = ENGAGEMENTS;

  const insertRestricted = db.prepare(RESTRICTED_INSERT_SQL);
  const insertCoi = db.prepare(COI_INSERT_SQL);
  const insertObClient = db.prepare(OB_CLIENT_INSERT_SQL);
  const insertObTask = db.prepare(OB_TASK_INSERT_SQL);
  const insertEngagement = db.prepare(ENGAGEMENT_INSERT_SQL);

  db.exec('BEGIN');
  try {
    for (const r of restrictedList) insertRestricted.run(at({ tenantId, ...restrictedToParams(r) }));

    // Map original obClients[].id -> real DB-assigned id, so every
    // downstream FK (obTasks, coiRegistry.linkedClientId, engagements.clientId)
    // is correct even if insertion order ever stops matching literal ids.
    const clientIdMap = {};
    for (const c of obClients) {
      const info = insertObClient.run(at({ tenantId, ...obClientToParams(c) }));
      clientIdMap[c.id] = info.lastInsertRowid;
      for (const t of buildTasksForClient(c)) {
        insertObTask.run(at({ tenantId, ...obTaskToParams(t), clientId: info.lastInsertRowid }));
      }
    }

    for (const c of coiRegistry) {
      const mappedLinkedId = c.linkedClientId != null ? clientIdMap[c.linkedClientId] : null;
      insertCoi.run(at({ tenantId, ...coiToParams({ ...c, linkedClientId: mappedLinkedId }) }));
    }

    for (const e of engagements) {
      const mappedClientId = e.clientId != null ? clientIdMap[e.clientId] : null;
      insertEngagement.run(at({ tenantId, ...engagementToParams({ ...e, clientId: mappedClientId }) }));
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded onboarding: ${restrictedList.length} restricted, ${coiRegistry.length} COI, ${obClients.length} clients (+tasks), ${engagements.length} engagements for tenant ${tenantId}.`);
}

// Digital audit trail matching GL-ONB-CF&A-001 Section 4.7 (Decision
// Matrix) / COI Addendum Section E.1 (Escalation Matrix). Must run AFTER
// seedOnboarding — relies on ob_clients ids 9/10 and engagements ids 6-9
// already existing (safe: this table starts empty, so AUTOINCREMENT
// assigns ids 1..N in insertion order matching these literals exactly,
// same reasoning documented throughout this file for the other tables).
const CONFLICT_APPROVALS = [
  { clientId: 9, engagementId: 6, dealRef: 'DEAL-NTS-2026-CAP',
    decisionType: 'Internal Client', riskLevel: 'Medium', feeAmount: 150000,
    decisionMaker: 'CF Deal Committee', escalatedTo: null, requiredTimeline: 'Next quarterly meeting',
    status: 'Approved with conditions',
    description: 'NomadTech Solutions — портфельная компания TCF-I, запросившая Advising у CF&A. Self-dealing risk по Section C аддендума.',
    rationale: 'Условия сделки на рыночных условиях (arm\'s length), подтверждено независимой оценкой. Объём операции учтён в квартальном мониторинге 20% cap по внутренним клиентам. Раскрыто инвесторам фонда в квартальной отчётности.',
    decidedAt: '2026-05-05' },
  { clientId: 10, engagementId: 7, dealRef: 'DEAL-ZHT-2025-VAL',
    decisionType: 'Routine Conflict', riskLevel: 'Low', feeAmount: 60000,
    decisionMaker: 'Compliance Officer', escalatedTo: null, requiredTimeline: 'N/A (Log in Register)',
    status: 'Approved',
    description: 'Стандартный Advising-мандат (business valuation), конфликтов не выявлено.',
    rationale: 'Проверка по Restricted List и COI Register — чисто. Стандартное одобрение Compliance Officer.',
    decidedAt: '2025-08-12' },
  { clientId: 10, engagementId: 8, dealRef: 'DEAL-ZHT-2026-CAP',
    decisionType: 'Dual-Mandate', riskLevel: 'High', feeAmount: 90000,
    decisionMaker: 'CF Deal Committee', escalatedTo: null, requiredTimeline: 'Convened within 48 hours',
    status: 'Approved with conditions',
    description: 'Zhetysu Trading LLP получает Advising и Arranging по одной сделке (DEAL-ZHT-2026-CAP) одновременно — Dual-Mandate по Section D аддендума.',
    rationale: 'Клиентское письменное согласие получено. Сегрегация команд: разные лиды на Advising и Arranging workstreams. Независимый Four-Eyes review Advising-документов Senior Director, не участвующим в Arranging. Fee structure не завязана на успешность размещения для Advising-части.',
    decidedAt: '2026-03-04' },
  { clientId: 10, engagementId: 9, dealRef: 'DEAL-ZHT-2026-CAP',
    decisionType: 'Dual-Mandate', riskLevel: 'High', feeAmount: 0,
    decisionMaker: 'CF Deal Committee', escalatedTo: null, requiredTimeline: 'Convened within 48 hours',
    status: 'Approved with conditions',
    description: 'Arranging-часть того же Dual-Mandate решения (см. engagement 8) — единое решение CF Deal Committee покрывает оба мандата.',
    rationale: 'См. рациональ engagement 8 — единогласное решение CF Deal Committee по обоим мандатам одновременно.',
    decidedAt: '2026-03-04' },
];

function seedConflictApprovals(tenantId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM conflict_approvals WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`conflict_approvals already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const insert = db.prepare(CONFLICT_APPROVAL_INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const a of CONFLICT_APPROVALS) {
      insert.run(at({ tenantId, ...conflictApprovalToParams(a) }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${CONFLICT_APPROVALS.length} conflict approvals for tenant ${tenantId}.`);
}

// NOTE: same lesson as DEALS/PORTFOLIO/onboarding above — js/modules.js's
// `icMemos` array has since been emptied out, so it's hardcoded here.
// IC voting composition matches Constitution Section 7: 2 GP representatives,
// 1 Independent Member, 1 LP Representative (4 voting members; quorum = 3
// incl. the Independent Member). The Risk Manager sits outside this vote —
// an independent veto/conclusion per Section 7.7 (Template 3), not a vote.
const IC_MEMOS = [
  { id: 1, dealId: 1, company: 'NomadTech Solutions', sector: 'Технологии', amount: 4.5, type: 'Equity', stage: 'Закрыта',
    author: 'Investment Manager', createdAt: '2024-09-15', status: 'approved', meetingDate: '2024-10-05',
    thesis: "SaaS-платформа автоматизации бухучёта для МСБ Казахстана. $70K MRR, быстрый рост клиентской базы, высокая маржинальность. Pre-money $15M.",
    risks: "Зависимость от одного co-founder'а в разработке. Конкуренция со стороны международных SaaS-игроков.",
    financials: 'Round size $4.5M (Equity). Выручка $70K MRR на момент сделки. Финансовый DD проведён Deloitte Kazakhstan — без замечаний.',
    exitPlan: 'M&A, целевой год выхода 2028.',
    votes: [
      { role: 'GP Rep 1', name: 'Omirserikov Gaini (CEO)', vote: 'approve', comment: 'Соответствует стратегии фонда.' },
      { role: 'GP Rep 2', name: 'Amankulov Zhanibek (CFO)', vote: 'approve', comment: 'Финансовые показатели в норме.' },
      { role: 'Independent Member', name: 'Мукашев Ерлан Т.', vote: 'approve', comment: 'Объективных возражений нет.' },
      { role: 'LP Rep', name: 'Байжанова Динара Сериковна', vote: 'approve', comment: 'Поддерживаю сделку.' },
    ],
    quorumMet: true, riskVeto: false, riskConclusion: 'No Objection',
    resolution: 'Инвестиция одобрена единогласно (4 за). Сумма $4.5M Equity. Сделка закрыта 2024-11-20.' },
  { id: 2, dealId: 2, company: 'VitaMed Astana', sector: 'Здравоохранение', amount: 5, type: 'Equity', stage: 'Закрыта',
    author: 'Investment Manager', createdAt: '2024-12-05', status: 'approved', meetingDate: '2025-01-15',
    thesis: 'Платформа телемедицины для отдалённых регионов Казахстана. $90K MRR, партнёрства с региональными клиниками. Pre-money $18M.',
    risks: 'Регуляторные изменения в сфере телемедицины.',
    financials: 'Round size $5M (Equity). Выручка $90K MRR на момент сделки. Legal & Financial DD проведён KPMG Kazakhstan — без замечаний.',
    exitPlan: 'Strategic Sale, целевой год выхода 2029.',
    votes: [
      { role: 'GP Rep 1', name: 'Omirserikov Gaini (CEO)', vote: 'approve', comment: 'Сильная команда, растущий рынок телемедицины.' },
      { role: 'GP Rep 2', name: 'Amankulov Zhanibek (CFO)', vote: 'approve', comment: 'Юнит-экономика положительная.' },
      { role: 'Independent Member', name: 'Мукашев Ерлан Т.', vote: 'approve', comment: 'Объективных возражений нет.' },
      { role: 'LP Rep', name: 'Байжанова Динара Сериковна', vote: 'approve', comment: 'Поддерживаю сделку.' },
    ],
    quorumMet: true, riskVeto: false, riskConclusion: 'No Objection',
    resolution: 'Инвестиция одобрена единогласно (4 за). Сумма $5M Equity. Сделка закрыта 2025-02-28.' },
  { id: 3, dealId: 3, company: 'Dala Agro Holding', sector: 'АПК', amount: 6, type: 'Convertible Note', stage: 'Закрыта',
    author: 'CEO', createdAt: '2025-03-10', status: 'approved', meetingDate: '2025-04-10',
    thesis: 'Зерновой холдинг в Костанайской области. Собственный земельный банк 50K га, экспортные контракты в Центральную Азию. Pre-money $22M.',
    risks: 'Погодные и урожайные риски. Волатильность экспортных цен на зерно. Высокая долговая нагрузка у операционной компании.',
    financials: 'Round size $6M (Convertible Note). Годовая выручка $3.2M. Financial DD проведён BDO Kazakhstan.',
    exitPlan: 'IPO on KASE, целевой год выхода 2030.',
    votes: [
      { role: 'GP Rep 1', name: 'Omirserikov Gaini (CEO)', vote: 'approve', comment: 'Стратегический актив для фонда, сильный земельный банк.' },
      { role: 'GP Rep 2', name: 'Amankulov Zhanibek (CFO)', vote: 'approve', comment: 'Приемлемая долговая нагрузка при текущих ковенантах.' },
      { role: 'Independent Member', name: 'Мукашев Ерлан Т.', vote: 'reject', comment: 'Долговая нагрузка операционной компании выше комфортного уровня.' },
      { role: 'LP Rep', name: 'Байжанова Динара Сериковна', vote: 'abstain', comment: 'Нет достаточной экспертизы в АПК, воздерживаюсь.' },
    ],
    quorumMet: true, riskVeto: false, riskConclusion: 'Conditional Approval',
    resolution: 'Инвестиция одобрена большинством (2 за, 1 против, 1 воздержался). Risk Manager: Conditional Approval — требуется мониторинг долговой нагрузки операционной компании ежеквартально. Сумма $6M Convertible Note. Сделка закрыта 2025-05-22.' },
  { id: 4, dealId: 5, company: 'Green Energy Almaty', sector: 'Энергетика', amount: 7, type: 'Equity', stage: 'IC Review',
    author: 'CFO', createdAt: '2025-07-05', status: 'pending', meetingDate: '2025-07-20',
    thesis: 'Разработчик солнечных электростанций для промышленных потребителей в Алматинской области. Pre-revenue (стадия строительства). Pre-money $25M.',
    risks: 'Разрешительная документация на землю не завершена.',
    financials: 'Round size $7M (Equity). Со-инвестор AIFC Green Fund в переговорах.',
    exitPlan: 'Стратегическая продажа энергетическому холдингу, срок не определён.',
    votes: [
      { role: 'GP Rep 1', name: 'Omirserikov Gaini (CEO)', vote: null, comment: '' },
      { role: 'GP Rep 2', name: 'Amankulov Zhanibek (CFO)', vote: 'approve', comment: 'Автор меморандума.' },
      { role: 'Independent Member', name: 'Мукашев Ерлан Т.', vote: null, comment: '' },
      { role: 'LP Rep', name: 'Байжанова Динара Сериковна', vote: null, comment: '' },
    ],
    quorumMet: false, riskVeto: false, riskConclusion: null,
    resolution: '' },
  { id: 5, dealId: 7, company: 'Retail Hub Karaganda', sector: 'Ритейл', amount: 2.5, type: 'Equity', stage: 'Отклонена IC',
    author: 'Analyst', createdAt: '2025-05-10', status: 'rejected', meetingDate: '2025-05-28',
    thesis: 'Сеть региональных магазинов формата «у дома» в Карагандинской области. Pre-money $8M.',
    risks: 'Слишком узкая региональная ниша. Низкая маржинальность ритейла. Модель не масштабируется за пределы одного региона.',
    financials: 'Round size $2.5M (Equity). Выручка $25K MRR.',
    exitPlan: 'Не определён.',
    votes: [
      { role: 'GP Rep 1', name: 'Omirserikov Gaini (CEO)', vote: 'reject', comment: 'Недостаточный потенциал масштабирования для мандата фонда.' },
      { role: 'GP Rep 2', name: 'Amankulov Zhanibek (CFO)', vote: 'reject', comment: 'Низкая маржинальность сектора.' },
      { role: 'Independent Member', name: 'Мукашев Ерлан Т.', vote: null, comment: 'Отсутствовал на заседании.' },
      { role: 'LP Rep', name: 'Байжанова Динара Сериковна', vote: 'approve', comment: 'Видит потенциал в региональной экспансии.' },
    ],
    quorumMet: false, riskVeto: false, riskConclusion: null,
    resolution: 'Инвестиция отклонена (2 против, 1 за). Независимый член на заседании отсутствовал — формально кворум по Constitution Section 7 не набран, решение носит предварительный характер. Возможен возврат к рассмотрению через 12 месяцев (не ранее 2026-06-01) при расширении географии и повторном созыве IC с участием независимого члена.' },
];

function seedIcMemos(tenantId, fundId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM ic_memos WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`ic_memos already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const icMemos = IC_MEMOS;
  const insert = db.prepare(IC_MEMO_INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const m of icMemos) {
      insert.run(at({ tenantId, ...icMemoToParams(m), fundId }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${icMemos.length} IC memos for tenant ${tenantId}.`);
}

// NOTE: same lesson as DEALS/PORTFOLIO/IC_MEMOS above — js/workflow.js's
// `workflowInstances` array has since been emptied out (populated at
// runtime from the API), so it's hardcoded here from the last-known
// extraction.
const WORKFLOW_INSTANCES = [
  { type: 'deal_ic', entityId: 1, entityName: 'NomadTech Solutions', entityType: 'Deal',
    createdAt: '2024-09-15T09:00:00', createdBy: 'Analyst', currentStep: 3, status: 'approved',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2024-09-20T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Инвестиционный меморандум готов, метрики SaaS сильные.' },
      { role:'RELATIONSHIP_MANAGER', label:'RM — коммерческая оценка', action:'review',  completedAt:'2024-09-28T14:00:00', completedBy:'RM', decision:'approved', comment:'Условия сделки согласованы с фаундерами.' },
      { role:'CEO', label:'IC — решение комитета', action:'approve', completedAt:'2024-10-05T10:00:00', completedBy:'CEO', decision:'approved', comment:'IC единогласно одобрил инвестицию.' },
    ] },
  { type: 'deal_ic', entityId: 2, entityName: 'VitaMed Astana', entityType: 'Deal',
    createdAt: '2024-12-18T09:00:00', createdBy: 'Analyst', currentStep: 3, status: 'approved',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2024-12-22T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум завершён, DD по лицензиям МЗ РК пройден.' },
      { role:'RELATIONSHIP_MANAGER', label:'RM — коммерческая оценка', action:'review',  completedAt:'2025-01-06T15:00:00', completedBy:'RM', decision:'approved', comment:'Коммерческие условия и pre-money согласованы.' },
      { role:'CEO', label:'IC — решение комитета', action:'approve', completedAt:'2025-01-15T10:00:00', completedBy:'CEO', decision:'approved', comment:'IC одобрил сделку, средства к перечислению.' },
    ] },
  { type: 'deal_ic', entityId: 3, entityName: 'Dala Agro Holding', entityType: 'Deal',
    createdAt: '2025-03-18T09:00:00', createdBy: 'Analyst', currentStep: 3, status: 'approved',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2025-03-22T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум по земельному банку и экспортным контрактам готов.' },
      { role:'RELATIONSHIP_MANAGER', label:'RM — коммерческая оценка', action:'review',  completedAt:'2025-04-01T15:00:00', completedBy:'RM', decision:'approved', comment:'Условия convertible note согласованы.' },
      { role:'CEO', label:'IC — решение комитета', action:'approve', completedAt:'2025-04-10T10:00:00', completedBy:'CEO', decision:'approved', comment:'IC одобрил сделку большинством голосов (Investment Manager воздержался/против).' },
    ] },
  { type: 'deal_ic', entityId: 7, entityName: 'Retail Hub Karaganda', entityType: 'Deal',
    createdAt: '2025-05-05T09:00:00', createdBy: 'Analyst', currentStep: 2, status: 'rejected',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2025-05-10T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум готов, узкая региональная ниша отмечена как риск.' },
      { role:'RELATIONSHIP_MANAGER', label:'RM — коммерческая оценка', action:'review',  completedAt:'2025-05-20T15:00:00', completedBy:'RM', decision:'approved', comment:'Коммерческая оценка завершена, масштабируемость под вопросом.' },
      { role:'CEO', label:'IC — решение комитета', action:'approve', completedAt:'2025-05-28T10:00:00', completedBy:'CEO', decision:'rejected', comment:'Слишком нишевый региональный рынок, недостаточный потенциал масштабирования для мандата фонда.' },
    ] },
  { type: 'deal_ic', entityId: 5, entityName: 'Green Energy Almaty', entityType: 'Deal',
    createdAt: '2025-07-05T09:00:00', createdBy: 'Analyst', currentStep: 2, status: 'active',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2025-07-08T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум по солнечной электростанции готов, риски по земле отмечены.' },
      { role:'RELATIONSHIP_MANAGER', label:'RM — коммерческая оценка', action:'review',  completedAt:'2025-07-12T15:00:00', completedBy:'RM', decision:'approved', comment:'Коммерческие условия и PPA-переговоры в норме.' },
      { role:'CEO', label:'IC — решение комитета', action:'approve', completedAt:null, completedBy:null, decision:null, comment:'' },
    ] },
  { type: 'kyc_lp', entityId: 6, entityName: 'Байжанова Динара Сериковна', entityType: 'LP',
    createdAt: '2025-06-10T09:00:00', createdBy: 'RM', currentStep: 1, status: 'active',
    steps: [
      { role:'COMPLIANCE_OFFICER', label:'CO проверка документов', action:'review',  completedAt:'2025-06-18T11:20:00', completedBy:'CO', decision:'approved', comment:'Паспорт и подтверждение адреса получены. Ожидается Source of Funds.' },
      { role:'MLRO', label:'MLRO — AML скрининг', action:'approve', completedAt:null, completedBy:null, decision:null, comment:'' },
      { role:'CEO', label:'CEO — финальное одобрение', action:'approve', completedAt:null, completedBy:null, decision:null, comment:'' },
    ] },
];

function seedWorkflowInstances(tenantId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM workflow_instances WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`workflow_instances already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const insert = db.prepare(WF_INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const w of WORKFLOW_INSTANCES) {
      insert.run(at({ tenantId, ...wfInstanceToParams(w) }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${WORKFLOW_INSTANCES.length} workflow instances for tenant ${tenantId}.`);
}

// NOTE: same lesson as DEALS/PORTFOLIO/IC_MEMOS above — js/documents.js's
// `docFiles` array has since been emptied out (it's now populated at
// runtime from the API), so it's hardcoded here from the last-known
// extraction.
const DOC_FILES = [
  { id: 1, fundId: 'TCF1', name: 'KYC_Checklist_Template.pdf', category: 'KYC/AML', size: '328 KB', date: '2024-10-01', uploader: 'CCO',
    comments: [{ id: 1, author: 'CCO', date: '2024-10-02', text: 'Шаблон утверждён для всех физических лиц.' }] },
  { id: 2, fundId: 'TCF1', name: 'First_Closing_Templates.pdf', category: 'First Closing', size: '199 KB', date: '2024-11-01', uploader: 'CEO',
    comments: [{ id: 2, author: 'CEO', date: '2024-11-02', text: 'Все шаблоны готовы к использованию на Closing Day.' }] },
  { id: 3, fundId: 'TCF1', name: 'Investment_Harvesting_Templates.pdf', category: 'Сделки', size: '261 KB', date: '2024-11-15', uploader: 'CFO',
    comments: [] },
  { id: 4, fundId: 'TCF1', name: 'Full_Business_Process_Guide.pdf', category: 'Прочее', size: '444 KB', date: '2024-12-01', uploader: 'GP',
    comments: [{ id: 3, author: 'GP', date: '2024-12-02', text: 'Полный регламент бизнес-процессов, версия 1.0. Обязателен к изучению.' }] },
];

function seedDocuments(tenantId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM documents WHERE tenant_id = ?').get(tenantId).c;
  if (count > 0) { console.log(`documents already has ${count} rows for tenant ${tenantId}, skipping seed.`); return; }

  const docFiles = DOC_FILES;
  const insert = db.prepare(DOCUMENT_INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const d of docFiles) {
      insert.run(at({ tenantId, ...documentToParams(d) }));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Seeded ${docFiles.length} documents for tenant ${tenantId}.`);
}

const tenant = upsertTenant('turan-capital', 'Turan Capital Holding Limited Partnership');
for (const r of SYSTEM_ROLES) upsertRole(tenant.id, r);
const user = upsertUser(tenant.id, SEED_EMAIL, SEED_PASSWORD, 'CEO', 'Omirserikov Gaini');

// Real accounts for every named individual referenced elsewhere in this
// codebase's regulatory-alignment work (IC_ROLE_DEFS in js/modules.js,
// GL-ONB-CF&A-001 RM assignments in OB_CLIENTS/LP_RECORDS below), plus the
// two external IC seats (Independent Member, LP Rep — real accounts per
// explicit product decision, not text labels) and generic placeholders for
// the roles no specific individual was named for (Analyst, MLRO, CIO).
// All seeded accounts share SEED_PASSWORD — fine for a demo, never do this
// in production.
const SEED_USERS = [
  { email: 'z.amankulov@turancapital.kz', role: 'CFO', name: 'Amankulov Zhanibek' },
  { email: 'n.tasbolatov@turancapital.kz', role: 'COMPLIANCE_OFFICER', name: 'Tasbolatov Nurbek' },
  { email: 's.kezhenev@turancapital.kz', role: 'RISK_MANAGER', name: 'Kezhenev Sabit' },
  // Reuses her existing LP contact email — she genuinely is both LP-2024-006 and the IC's LP Rep seat.
  { email: 'd.baizhanova@gmail.com', role: 'IC_LP_REP', name: 'Байжанова Динара Сериковна' },
  { email: 'e.mukashev@turancapital.kz', role: 'IC_INDEPENDENT', name: 'Мукашев Ерлан Т.' },
  // Dedicated RM accounts — deliberately NOT the LP contact emails from LP_RECORDS
  // (b.assanov@silksteppe.kz / a.zhaksybekova@otbasyfo.kz belong to the LPs' own
  // staff, different people from this fund's RMs despite the matching names).
  { email: 'b.assanov@turancapital.kz', role: 'RELATIONSHIP_MANAGER', name: 'Асанов Б.К.' },
  { email: 'a.zhaksybekova@turancapital.kz', role: 'RELATIONSHIP_MANAGER', name: 'Жаксыбекова А.Н.' },
  { email: 'analyst@turancapital.kz', role: 'ANALYST', name: 'Demo Analyst' },
  { email: 'mlro@turancapital.kz', role: 'MLRO', name: 'Demo MLRO' },
  { email: 'cio@turancapital.kz', role: 'CIO', name: 'Demo CIO' },
];
for (const u of SEED_USERS) upsertUser(tenant.id, u.email, SEED_PASSWORD, u.role, u.name);

const fundIds = seedFunds(tenant.id);
const fund1Id = fundIds['TCF-I'];
for (const d of DOC_FILES) d.fundId = fund1Id;

seedLpRegister(tenant.id, fund1Id);
seedCapitalCalls(tenant.id, fund1Id);
seedDeals(tenant.id, fund1Id);
seedPortfolio(tenant.id, fund1Id);
seedOnboarding(tenant.id);
seedConflictApprovals(tenant.id);
seedIcMemos(tenant.id, fund1Id);
seedWorkflowInstances(tenant.id);
seedDocuments(tenant.id);

console.log('--- Seed complete ---');
console.log('Tenant:', tenant.slug, '(id', tenant.id + ')');
console.log('All seeded accounts share the password:', SEED_PASSWORD);
console.log('Logins:');
console.log(' ', SEED_EMAIL, '(CEO)');
for (const u of SEED_USERS) console.log(' ', u.email, '(' + u.role + ')');
