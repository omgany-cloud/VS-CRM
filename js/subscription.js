// ============================================================
//  subscription.js — Pricing & Plans
// ============================================================

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price_monthly: 299,
    price_annual: 239,
    currency: '$',
    period: '/мес',
    color: '#3b82f6',
    icon: 'fa-seedling',
    tag: null,
    features: [
      '1 фонд',
      'До 10 LP',
      'KYC / AML модуль',
      'Pipeline сделок (до 20)',
      'Capital Calls',
      'Базовые отчёты',
      'Загрузка файлов (5 GB)',
      'Email поддержка',
    ],
    disabled: ['Мультифондовость', 'API доступ', 'White-label'],
    current: false,
  },
  {
    id: 'professional',
    name: 'Professional',
    price_monthly: 799,
    price_annual: 639,
    currency: '$',
    period: '/мес',
    color: '#8b5cf6',
    icon: 'fa-chart-line',
    tag: 'Популярный',
    features: [
      'До 5 фондов',
      'Неограниченно LP',
      'KYC / AML + AML Screening',
      'Pipeline (неограниченно)',
      'Capital Calls',
      'Квартальные отчёты LP',
      'Загрузка файлов (50 GB)',
      'Двуязычный интерфейс',
      'Приоритетная поддержка',
    ],
    disabled: ['API доступ', 'White-label'],
    current: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price_monthly: null,
    price_annual: null,
    currency: '$',
    period: '/мес',
    color: '#22c55e',
    icon: 'fa-building-columns',
    tag: 'Индивидуально',
    features: [
      'Неограниченно фондов',
      'Неограниченно LP',
      'Полный KYC/AML пакет',
      'Compliance-отчёты для регулятора',
      'White-label брендинг',
      'REST API интеграция',
      'Настраиваемые дашборды',
      'Безлимитное хранилище',
      'Выделенный менеджер',
      'SLA 99.9%',
      'On-premise опция',
    ],
    disabled: [],
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
      Помесячно
    </button>
    <button class="plan-cycle-btn ${billingCycle === 'annual' ? 'active' : ''}" onclick="setBillingCycle('annual')">
      Ежегодно <span class="save-badge">Экономия 20%</span>
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
    const price = plan.price_monthly === null ? null : (billingCycle === 'annual' ? plan.price_annual : plan.price_monthly);
    const isCustom = price === null;

    return `
      <div class="plan-card ${plan.current ? 'current' : ''}" style="--plan-color:${plan.color}">
        ${plan.tag ? `<div class="plan-tag" style="background:${plan.color}">${plan.tag}</div>` : ''}
        <div class="plan-header">
          <div class="plan-icon" style="background:${plan.color}20;color:${plan.color}"><i class="fas ${plan.icon}"></i></div>
          <div class="plan-name">${plan.name}</div>
          <div class="plan-price">
            ${isCustom
              ? `<span class="plan-price-custom">По запросу</span>`
              : `<span class="plan-price-num">${plan.currency}${price}</span><span class="plan-price-period">${plan.period}</span>`
            }
            ${billingCycle === 'annual' && !isCustom ? `<div class="plan-annual-note">при оплате за год</div>` : ''}
          </div>
        </div>
        <div class="plan-features">
          ${plan.features.map(f => `<div class="plan-feature on"><i class="fas fa-check"></i><span>${f}</span></div>`).join('')}
          ${plan.disabled.map(f => `<div class="plan-feature off"><i class="fas fa-times"></i><span>${f}</span></div>`).join('')}
        </div>
        <div class="plan-footer">
          ${plan.current
            ? `<button class="btn-plan-current" disabled><i class="fas fa-check-circle"></i> Текущий план</button>`
            : isCustom
              ? `<button class="btn-plan" style="background:${plan.color}" onclick="contactSales()">Связаться с продажами</button>`
              : `<button class="btn-plan" style="background:${plan.color}" onclick="choosePlan('${plan.id}')">Выбрать план</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function renderFAQ() {
  const faqs = [
    { q: 'Можно ли изменить план в любое время?', a: 'Да, вы можете повысить или понизить план в любое время. Изменения вступают в силу немедленно.' },
    { q: 'Что происходит с данными при отмене подписки?', a: 'После отмены подписки у вас есть 30 дней для экспорта всех данных. Затем данные удаляются.' },
    { q: 'Поддерживается ли compliance-отчётность для регулятора?', a: 'Да, планы Professional и Enterprise включают инструменты соответствия регуляторным требованиям.' },
    { q: 'Есть ли пробный период?', a: 'Да, мы предлагаем 14-дневный бесплатный пробный период для планов Starter и Professional.' },
  ];
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
  const name = plan ? plan.name : planId;
  showToast(`✅ План активирован: ${name}`);
}

function contactSales() {
  showToast('📧 Запрос отправлен команде продаж');
}
