// ============================================================
//  subscription.js — Pricing & Plans
// ============================================================

const PLANS = [
  {
    id: 'starter',
    name_ru: 'Starter', name_en: 'Starter',
    price_monthly: 299,
    price_annual: 239,
    currency: '$',
    period_ru: '/мес', period_en: '/mo',
    color: '#3b82f6',
    icon: 'fa-seedling',
    tag_ru: null, tag_en: null,
    features_ru: [
      '1 фонд',
      'До 10 LP',
      'KYC / AML модуль',
      'Pipeline сделок (до 20)',
      'Capital Calls',
      'Базовые отчёты',
      'Загрузка файлов (5 GB)',
      'Email поддержка',
    ],
    features_en: [
      '1 fund',
      'Up to 10 LPs',
      'KYC / AML module',
      'Deal Pipeline (up to 20)',
      'Capital Calls',
      'Basic reports',
      'File storage (5 GB)',
      'Email support',
    ],
    disabled_ru: ['Мультифондовость', 'Distributions Waterfall', 'API доступ', 'White-label'],
    disabled_en: ['Multi-fund', 'Distributions Waterfall', 'API access', 'White-label'],
    current: false,
  },
  {
    id: 'professional',
    name_ru: 'Professional', name_en: 'Professional',
    price_monthly: 799,
    price_annual: 639,
    currency: '$',
    period_ru: '/мес', period_en: '/mo',
    color: '#8b5cf6',
    icon: 'fa-chart-line',
    tag_ru: 'Популярный', tag_en: 'Popular',
    features_ru: [
      'До 5 фондов',
      'Неограниченно LP',
      'KYC / AML + AML Screening',
      'Pipeline (неограниченно)',
      'Capital Calls + Distributions',
      'Waterfall расчёты',
      'Квартальные отчёты LP',
      'Загрузка файлов (50 GB)',
      'Двуязычный интерфейс',
      'Приоритетная поддержка',
    ],
    features_en: [
      'Up to 5 funds',
      'Unlimited LPs',
      'KYC / AML + AML Screening',
      'Pipeline (unlimited)',
      'Capital Calls + Distributions',
      'Waterfall calculations',
      'Quarterly LP reports',
      'File storage (50 GB)',
      'Bilingual interface',
      'Priority support',
    ],
    disabled_ru: ['API доступ', 'White-label'],
    disabled_en: ['API access', 'White-label'],
    current: true,
  },
  {
    id: 'enterprise',
    name_ru: 'Enterprise', name_en: 'Enterprise',
    price_monthly: null,
    price_annual: null,
    currency: '$',
    period_ru: '/мес', period_en: '/mo',
    color: '#22c55e',
    icon: 'fa-building-columns',
    tag_ru: 'Индивидуально', tag_en: 'Custom',
    features_ru: [
      'Неограниченно фондов',
      'Неограниченно LP',
      'Полный KYC/AML пакет',
      'AFSA Compliance отчёты',
      'White-label брендинг',
      'REST API интеграция',
      'Настраиваемые дашборды',
      'Безлимитное хранилище',
      'Выделенный менеджер',
      'SLA 99.9%',
      'On-premise опция',
    ],
    features_en: [
      'Unlimited funds',
      'Unlimited LPs',
      'Full KYC/AML package',
      'AFSA Compliance reports',
      'White-label branding',
      'REST API integration',
      'Custom dashboards',
      'Unlimited storage',
      'Dedicated account manager',
      'SLA 99.9%',
      'On-premise option',
    ],
    disabled_ru: [],
    disabled_en: [],
    current: false,
  },
];

let billingCycle = 'monthly'; // monthly | annual

function renderSubscriptionPage() {
  renderPlanToggle();
  renderPlanCards();
  renderFAQ();
}

function renderPlanToggle() {
  const el = document.getElementById('planToggle');
  if (!el) return;
  el.innerHTML = `
    <button class="plan-cycle-btn ${billingCycle === 'monthly' ? 'active' : ''}" onclick="setBillingCycle('monthly')">
      ${t('sub_monthly')}
    </button>
    <button class="plan-cycle-btn ${billingCycle === 'annual' ? 'active' : ''}" onclick="setBillingCycle('annual')">
      ${t('sub_annual')} <span class="save-badge">${t('sub_save')}</span>
    </button>
  `;
}

function setBillingCycle(cycle) {
  billingCycle = cycle;
  renderSubscriptionPage();
}

function renderPlanCards() {
  const container = document.getElementById('planCards');
  if (!container) return;
  container.innerHTML = PLANS.map(plan => {
    const name = currentLang === 'ru' ? plan.name_ru : plan.name_en;
    const features = currentLang === 'ru' ? plan.features_ru : plan.features_en;
    const disabled = currentLang === 'ru' ? plan.disabled_ru : plan.disabled_en;
    const tag = currentLang === 'ru' ? plan.tag_ru : plan.tag_en;
    const price = plan.price_monthly === null ? null : (billingCycle === 'annual' ? plan.price_annual : plan.price_monthly);
    const isCustom = price === null;
    const period = currentLang === 'ru' ? plan.period_ru : plan.period_en;

    return `
      <div class="plan-card ${plan.current ? 'current' : ''}" style="--plan-color:${plan.color}">
        ${tag ? `<div class="plan-tag" style="background:${plan.color}">${tag}</div>` : ''}
        <div class="plan-header">
          <div class="plan-icon" style="background:${plan.color}20;color:${plan.color}"><i class="fas ${plan.icon}"></i></div>
          <div class="plan-name">${name}</div>
          <div class="plan-price">
            ${isCustom
              ? `<span class="plan-price-custom">${currentLang === 'ru' ? 'По запросу' : 'Contact Us'}</span>`
              : `<span class="plan-price-num">${plan.currency}${price}</span><span class="plan-price-period">${period}</span>`
            }
            ${billingCycle === 'annual' && !isCustom ? `<div class="plan-annual-note">${currentLang === 'ru' ? 'при оплате за год' : 'billed annually'}</div>` : ''}
          </div>
        </div>
        <div class="plan-features">
          ${features.map(f => `<div class="plan-feature on"><i class="fas fa-check"></i><span>${f}</span></div>`).join('')}
          ${disabled.map(f => `<div class="plan-feature off"><i class="fas fa-times"></i><span>${f}</span></div>`).join('')}
        </div>
        <div class="plan-footer">
          ${plan.current
            ? `<button class="btn-plan-current" disabled><i class="fas fa-check-circle"></i> ${t('sub_current')}</button>`
            : isCustom
              ? `<button class="btn-plan" style="background:${plan.color}" onclick="contactSales()">${t('sub_contact')}</button>`
              : `<button class="btn-plan" style="background:${plan.color}" onclick="choosePlan('${plan.id}')">${t('sub_choose')}</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function renderFAQ() {
  const faqData = {
    ru: [
      { q: 'Можно ли изменить план в любое время?', a: 'Да, вы можете повысить или понизить план в любое время. Изменения вступают в силу немедленно.' },
      { q: 'Что происходит с данными при отмене подписки?', a: 'После отмены подписки у вас есть 30 дней для экспорта всех данных. Затем данные удаляются.' },
      { q: 'Поддерживается ли AFSA Compliance?', a: 'Да, планы Professional и Enterprise включают инструменты соответствия требованиям AFSA.' },
      { q: 'Есть ли пробный период?', a: 'Да, мы предлагаем 14-дневный бесплатный пробный период для планов Starter и Professional.' },
    ],
    en: [
      { q: 'Can I change my plan at any time?', a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.' },
      { q: 'What happens to my data if I cancel?', a: 'After cancellation, you have 30 days to export all your data. After that, data is deleted.' },
      { q: 'Is AFSA Compliance supported?', a: 'Yes, Professional and Enterprise plans include AFSA compliance tools.' },
      { q: 'Is there a free trial?', a: 'Yes, we offer a 14-day free trial for Starter and Professional plans.' },
    ],
  };
  const faqs = faqData[currentLang];
  const container = document.getElementById('faqContainer');
  if (!container) return;
  container.innerHTML = faqs.map((f, i) => `
    <div class="faq-item" id="faq_${i}">
      <div class="faq-q" onclick="toggleFAQ(${i})">
        <span>${f.q}</span>
        <i class="fas fa-chevron-down faq-arrow"></i>
      </div>
      <div class="faq-a">${f.a}</div>
    </div>
  `).join('');
}

function toggleFAQ(i) {
  const item = document.getElementById('faq_' + i);
  if (item) item.classList.toggle('open');
}

function choosePlan(planId) {
  const plan = PLANS.find(p => p.id === planId);
  PLANS.forEach(p => p.current = false);
  if (plan) plan.current = true;
  renderPlanCards();
  const name = plan ? (currentLang === 'ru' ? plan.name_ru : plan.name_en) : planId;
  showToast(`✅ ${currentLang === 'ru' ? 'План активирован' : 'Plan activated'}: ${name}`);
}

function contactSales() {
  showToast(currentLang === 'ru' ? '📧 Запрос отправлен команде продаж' : '📧 Request sent to sales team');
}
