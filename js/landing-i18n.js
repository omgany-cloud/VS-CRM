// RU/EN toggle for the public marketing site (company.html — the single
// public-facing page, serving as the homepage) — a separate, deliberately
// simple mechanism from the CRM app itself (index.html), which dropped its
// own language switcher earlier and is Russian-only by design for internal
// staff. This one exists because the marketing site's audience includes
// both local and international investors.
//
// Elements opt in with data-i18n="key" (textContent swap) or
// data-i18n-html="key" (innerHTML swap, only for entries that need a <br/>,
// <strong>, or <a> — every string below is a fixed literal, never user
// input, so this is safe). Preference persists in localStorage under
// LANDING_LANG_KEY and applies immediately on load, before first paint of
// visible content, to avoid an English-then-Russian flash.
const LANDING_LANG_KEY = 'gl_landing_lang';

const LANDING_TRANSLATIONS = {
  hero_badge: { ru: 'Лицензировано AFSA', en: 'Licensed by AFSA' },
  hero_title: { ru: 'Golden <em>Leaves</em> Ltd', en: 'Golden <em>Leaves</em> Ltd' },
  hero_tagline: { ru: 'Управление фондами и консалтинг в области корпоративных финансов', en: 'Fund management and corporate finance consulting' },
  hero_btn_contact: { ru: 'Связаться с нами', en: 'Contact Us' },
  hero_btn_license: { ru: 'Посмотреть лицензию', en: 'View License' },

  stat1_label: { ru: 'Основана на МФЦА', en: 'Established at AIFC' },
  stat2_label: { ru: 'Лицензированных вида деятельности', en: 'Licensed activities' },

  services_eyebrow: { ru: 'Чем мы занимаемся', en: 'What We Do' },
  about_title: { ru: 'Лицензированные виды деятельности', en: 'Licensed Activities' },
  about_body: {
    ru: 'Golden Leaves была основана в 2020 году для предоставления качественных услуг по управлению фондами и финансово-юридическому консультированию.',
    en: 'Golden Leaves was established in 2020 to provide high-quality fund management and financial and legal consulting services.',
  },

  activity1_title: { ru: 'Управление инвестициями', en: 'Investment Management' },
  activity1_li1: { ru: 'Разработка инвестиционной стратегии', en: 'Investment strategy development' },
  activity1_li3: { ru: 'Управление фондами на МФЦА', en: 'Fund management at AIFC' },

  activity2_title: { ru: 'Консультирование', en: 'Advising' },
  activity2_li1: { ru: 'Независимые мнения (Fairness Opinions) и оценка', en: 'Fairness Opinions and valuation' },
  activity2_li2: { ru: 'Финансовое моделирование', en: 'Financial modeling' },
  activity2_li3: { ru: 'Стратегический консалтинг', en: 'Strategic consulting' },
  activity2_li4: { ru: 'Сопровождение сделок и Due Diligence', en: 'Deal support and Due Diligence' },

  activity3_title: { ru: 'Организация сделок', en: 'Arranging Deals' },
  activity3_li1: { ru: 'Привлечение акционерного капитала (Private Placements)', en: 'Equity capital raising (Private Placements)' },
  activity3_li2: { ru: 'Привлечение долгового капитала (DCM)', en: 'Debt capital raising (DCM)' },
  activity3_li3: { ru: 'Координация проектного финансирования', en: 'Project financing coordination' },
  activity3_li4: { ru: 'Исполнение сделок M&A', en: 'M&A deal execution' },

  team_title: { ru: 'Наша команда', en: 'Our Team' },

  member1_role: { ru: '| Главный исполнительный директор', en: '| SEO' },
  member1_li1: { ru: 'Экспертиза в операционном управлении, стратегическом планировании и реализации сделок M&A', en: 'Expertise in operational management, strategic planning, and M&A deal execution' },
  member1_li2: { ru: 'Работал в KPMG, занимал руководящие позиции (CEO, COO)', en: 'Worked at KPMG and held executive positions (CEO, COO)' },
  member1_li3: { ru: 'Выпускник КазНУ им. аль-Фараби · опыт 21 год', en: 'Graduate of KazNU named after Al-Farabi · 21 years experience' },

  member2_role: { ru: '| Финансовый директор (CFO)', en: '| CFO' },
  member2_li1: { ru: 'Обладатель CFA с 2018 года, экспертиза в управлении финансовыми рисками', en: 'CFA holder since 2018, expertise in financial risk management' },
  member2_li2: { ru: 'Работал в AK Алтыналмас, KAZ Minerals и Самрук-Казына', en: 'Worked at AK Altynalmas, KAZ Minerals, and Samruk-Kazyna' },
  member2_li3: { ru: 'Опыт работы: 15 лет', en: '15 years experience' },

  member3_role: { ru: '| Legal & Операционный директор', en: '| Legal & Operations Director' },
  member3_li1: { ru: 'Экспертиза в гражданском праве, договорном сопровождении и судебных спорах', en: 'Expertise in civil law, contract support, and litigation' },
  member3_li2: { ru: 'Магистр права (KIMEP, 2024)', en: 'Master of Law (KIMEP, 2024)' },
  member3_li3: { ru: 'Опыт работы: 12 лет', en: '12 years experience' },

  member4_role: { ru: '| Директор по комплаенс (CCO)', en: '| CCO' },
  member4_li1: { ru: 'Специализация в комплаенс, ПОД/ФТ и автоматизации процессов', en: 'Specialization in compliance, AML/CFT, and process automation' },
  member4_li2: { ru: 'Экспертиза в разработке регуляторной документации', en: 'Expertise in regulatory documentation development' },
  member4_li3: { ru: 'Опыт работы: 16 лет', en: '16 years experience' },

  member5_role: { ru: '| Риск-менеджер', en: '| Risk Manager' },
  member5_li1: { ru: 'Экспертиза в выявлении, мониторинге и минимизации операционных рисков', en: 'Expertise in identifying, monitoring, and minimizing operational risks' },
  member5_li2: { ru: 'Разработка и внедрение систем управления рисками', en: 'Development and implementation of risk management systems' },
  member5_li3: { ru: 'Опыт работы: 13 лет', en: '13 years experience' },

  member6_role: { ru: '| Ответственный за ПОД/ФТ (MLRO)', en: '| MLRO' },
  member6_li1: { ru: 'Специализация в ПОД/ФТ и финансовом мониторинге', en: 'Specialization in AML/CFT and financial monitoring' },
  member6_li2: { ru: 'Магистр права (KIMEP), свободно владеет четырьмя языками', en: 'Master of Law (KIMEP), fluent in four languages' },
  member6_li3: { ru: 'Опыт работы: 5 лет', en: '5 years experience' },

  member7_role: { ru: '| Независимый директор', en: '| Independent Director' },
  member7_li1: { ru: 'Экспертиза в привлечении иностранных инвестиций, переговорах с правительством и структурировании крупных инвестиционных соглашений', en: 'Expertise in attracting foreign investment, government negotiations, and structuring major investment agreements' },
  member7_li2: { ru: 'Заместитель Председателя Правления АО «Kazakh Invest»; независимый директор СЭЗ Хоргос и СЭЗ Жибек Жолы', en: 'Deputy Chairman of the Management Board at Kazakh Invest; independent director at SEZ Khorgos and SEZ Zhibek Zholy' },
  member7_li3: { ru: 'Магистр делового администрирования (University of East Anglia, Великобритания) · опыт 13 лет', en: "Master's in Business Management (University of East Anglia, UK) · 13 years experience" },

  member8_role: { ru: '| Независимый директор', en: '| Independent Director' },
  member8_li1: { ru: 'Специализация в корпоративных финансах и сделках M&A, включая работу в AIFC и Sozak Oil & Gas', en: 'Specialization in corporate finance and M&A transactions, including work at AIFC and Sozak Oil & Gas' },
  member8_li2: { ru: 'Магистр в области корпоративных финансов (Bayes Business School)', en: "Master's in Corporate Finance (Bayes Business School)" },
  member8_li3: { ru: 'Опыт работы: 15 лет', en: '15 years experience' },

  footer_address: {
    ru: 'ул. Гейдара Алиева 1, офис 1<br />Есильский район, Астана Z05T8M2<br />Республика Казахстан',
    en: '1 Heydar Aliyev St, Office 1<br />Yesil District, Astana Z05T8M2<br />Republic of Kazakhstan',
  },
  risk_warning: {
    ru: 'Инвестиции сопряжены с риском. Прошлые результаты не гарантируют будущих. Подходит только для профессиональных клиентов.',
    en: 'Investments carry risk. Past performance does not guarantee future results. Suitable for Professional Clients only.',
  },
  footer_bottom: {
    ru: 'Лицензия AFSA: <strong>AFSA-A-LA-2024-0038</strong> (<a href="docs/AFSA-License-Golden-Leaves.pdf" target="_blank">PDF</a>) | &copy; 2026 Golden Leaves Ltd. Все права защищены.',
    en: 'AFSA License: <strong>AFSA-A-LA-2024-0038</strong> (<a href="docs/AFSA-License-Golden-Leaves.pdf" target="_blank">PDF</a>) | &copy; 2026 Golden Leaves Ltd. All rights reserved.',
  },
};

function setLandingLang(lang) {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const entry = LANDING_TRANSLATIONS[el.getAttribute('data-i18n')];
    if (entry && entry[lang]) el.textContent = entry[lang];
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const entry = LANDING_TRANSLATIONS[el.getAttribute('data-i18n-html')];
    if (entry && entry[lang]) el.innerHTML = entry[lang];
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
  });
  document.documentElement.lang = lang;
  try { localStorage.setItem(LANDING_LANG_KEY, lang); } catch (e) { /* private-browsing / storage disabled */ }
}

(function initLandingLang() {
  let saved = 'ru';
  try { saved = localStorage.getItem(LANDING_LANG_KEY) || 'ru'; } catch (e) { /* ignore */ }
  document.addEventListener('DOMContentLoaded', () => setLandingLang(saved));
})();
