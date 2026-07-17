// ============================================================
//  i18n — Translation Dictionary
//  Turan Capital Fund LP CRM
// ============================================================
const i18n = {
  ru: {
    // NAV
    nav_overview: 'Обзор',
    nav_dashboard: 'Дашборд',
    nav_closing: 'First Closing',
    nav_investment: 'Инвестиционный цикл',
    nav_deals: 'Сделки / Pipeline',
    nav_portfolio: 'Портфель',
    nav_documents: 'Документы',
    nav_subscription: 'Подписка',
    // Documents
    doc_title: 'Документы',
    doc_sub: 'Загрузка файлов, шаблонов и комментарии по процессам',
    doc_upload_btn: 'Загрузить файл',
    doc_comment_ph: 'Оставить комментарий...',
    doc_add_comment: 'Добавить',
    // Subscription
    sub_title: 'Тарифные планы',
    sub_sub: 'Выберите план для вашей организации',
    sub_monthly: 'Ежемесячно',
    sub_annual: 'Ежегодно',
    sub_save: 'Скидка 20%',
    sub_current: 'Текущий план',
    sub_choose: 'Выбрать план',
    sub_contact: 'Связаться с нами',
    // Funds
    btn_add_fund_modal: 'Создать новый фонд',
    // Misc
    btn_save: 'Сохранить',
    btn_cancel: 'Отмена',
    general_info: 'Основная информация',
    phase_label: 'Investment Period · Year 2',
    all_funds: 'Все фонды',
  },
  en: {
    nav_overview: 'Overview',
    nav_dashboard: 'Dashboard',
    nav_closing: 'First Closing',
    nav_investment: 'Investment Cycle',
    nav_deals: 'Deals / Pipeline',
    nav_portfolio: 'Portfolio',
    nav_documents: 'Documents',
    nav_subscription: 'Subscription',
    doc_title: 'Documents',
    doc_sub: 'File uploads, templates and process comments',
    doc_upload_btn: 'Upload File',
    doc_comment_ph: 'Leave a comment...',
    doc_add_comment: 'Add',
    sub_title: 'Pricing Plans',
    sub_sub: 'Choose a plan for your organization',
    sub_monthly: 'Monthly',
    sub_annual: 'Annual',
    sub_save: 'Save 20%',
    sub_current: 'Current Plan',
    sub_choose: 'Choose Plan',
    sub_contact: 'Contact Us',
    btn_add_fund_modal: 'Create New Fund',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    general_info: 'General Information',
    phase_label: 'Investment Period · Year 2',
    all_funds: 'All Funds',
  }
};

let currentLang = 'ru';

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || (i18n['ru'][key]) || key;
}

function setLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    if (attr) el.setAttribute(attr, t(key));
    else el.textContent = t(key);
  });
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  // re-render dynamic parts
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderOnboardingTable === 'function') renderOnboardingTable(lpList);
  if (typeof renderKYCTable === 'function') renderKYCTable(lpList);
}
