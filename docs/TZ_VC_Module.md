# Техническое задание

## Модуль VC (второй closed-end asset_class) + SPV / co-investment vehicles

**Проект:** Turan Capital Fund CRM (Golden Leaves Ltd)
**Дата:** 2026-08-21
**Статус:** к реализации. Опирается на `ARCHITECTURE_Multi_Strategy_Roadmap.md` §3.1 и §5 п.3 — читать сначала его. В отличие от Hedge Fund (`TZ_Hedge_Fund_Module.md`), это в основном параметризация уже готового closed-end движка — рискованная и полностью новая часть тут только одна: SPV.
**Важно:** REIT сознательно не в скоупе. «Лёгкий IC» (упрощённый workflow согласования сделок для VC) сознательно не в скоупе v1 — см. §9.

---

## 0. Общие технические ограничения (те же, что в `TZ_Hedge_Fund_Module.md` §0)

1. Каждая новая таблица — `tenant_id`, каждый запрос фильтруется по `req.tenantId`.
2. Каждый новый роут — `requireAuth` + `requireInternal` + `requirePermission('accessFM')`.
3. `loadXFromApi()` в `js/api-auth.js` под каждую новую сущность, вызов из `loadAllApiData()`.
4. Покрытие `server/test/tenant-isolation.test.js` + `delete-guards.test.js` для новых таблиц.
5. Сервер сам выводит вычисляемые поля (`ownership_pct_post`, метрики SPV) — никогда не доверять клиенту.
6. Переиспользовать готовую инфраструктуру, а не дублировать: `server/waterfallEngine.js` для расчёта carry/IRR/DPI/TVPI SPV, `capital_calls`/`distributions` — паттерн (не таблицы напрямую, см. §3) для SPV-леджера.

---

## 1. Проблема / контекст

VC — это тот же closed-end движок, что и PE (commitment → capital call → owned asset → exit → distribution → waterfall), с двумя практическими отличиями:

- Портфельная компания проходит несколько раундов финансирования (Seed/A/B/…) с разными инвесторами, и доля фонда **размывается** по ходу раундов — этого сегодня никто не считает: `deals` фиксирует только условия входа самого фонда, а не полный cap table компании.
- Часто отдельная сделка проводится не напрямую через фонд, а через **SPV** — отдельное юрлицо под одну сделку, куда могут зайти как LP фонда (co-invest), так и внешние инвесторы, не являющиеся LP. Это архитектурно новая сущность — сегодня в модели нет ничего у́же, чем `funds`.

`capital_calls`/`distributions`/`waterfallEngine.js`/`deals`/`ic_memos` при этом **не меняются** — они уже asset-class-agnostic (капитал-коллы и дистрибьюции не завязаны на PE-специфику, `waterfallEngine.js` — чистая функция от `preferred_return`/`catch_up_pct`/`carried_interest` и леджера) и уже VC-по-форме (`deals.instrument` включает SAFE/Convertible Note, есть `pre_money`/`post_money`/`founder_contacts_json`).

---

## 2. Модель данных

### 2.1 Фонд

Изменений в `funds` не требуется. `asset_class`/`operating_model` уже существуют (`server/db.js:1145-1146`), `'vc'` уже легальное значение (`server/index.js:887`). `operating_model` для `'vc'` уже выводится как `'closed-end'` (`server/fundMapping.js:33-34`) — но **не различает VC и PE**, поэтому вся VC-ветка UI/API должна проверять `asset_class === 'vc'` напрямую, а не `operating_model`.

### 2.2 Cap table портфельной компании

```sql
CREATE TABLE IF NOT EXISTS portfolio_rounds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  portfolio_id      INTEGER NOT NULL REFERENCES portfolio(id),
  round_name        TEXT,               -- 'Seed','Series A',...
  round_date        TEXT,
  instrument        TEXT,               -- Equity/SAFE/Convertible Note/Debt — тот же словарь, что deals.instrument
  pre_money         REAL,
  post_money        REAL,
  amount_raised     REAL,
  price_per_share   REAL,
  is_fund_round     INTEGER DEFAULT 0,  -- 1 = раунд, в котором заходил именно этот фонд/SPV
  source_deal_id    INTEGER REFERENCES deals(id),  -- опциональная связь на deals для своего раунда входа
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolio_round_investors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  round_id            INTEGER NOT NULL REFERENCES portfolio_rounds(id),
  investor_name       TEXT NOT NULL,      -- внешние инвесторы — свободный текст, не lp_register
  investor_type       TEXT,               -- 'Lead'|'Follow'|'Fund'|'SPV'|'Founder'|'Other'
  is_own_fund         INTEGER DEFAULT 0,  -- 1 только для строки, представляющей долю нашего фонда/SPV
  spv_id              INTEGER REFERENCES spvs(id),  -- заполнено, если наша доля в этом раунде шла через SPV
  amount              REAL,
  shares              REAL,
  ownership_pct_post  REAL,               -- СЕРВЕР считает кумулятивно по всем раундам компании, не клиент
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.3 SPV / co-investment vehicles

```sql
CREATE TABLE IF NOT EXISTS spvs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                INTEGER NOT NULL REFERENCES funds(id),   -- спонсирующий фонд
  portfolio_id           INTEGER REFERENCES portfolio(id),
  deal_id                INTEGER REFERENCES deals(id),
  name                   TEXT NOT NULL,
  legal_entity_name      TEXT,
  jurisdiction           TEXT,
  formation_date         TEXT,
  status                 TEXT NOT NULL DEFAULT 'Forming',  -- Forming|Open|Closed|Fully Called|Wound Down
  target_size            REAL,
  currency               TEXT DEFAULT 'USD',
  management_fee_pct     REAL DEFAULT 0,
  carried_interest_pct   REAL DEFAULT 20,
  preferred_return_pct   REAL DEFAULT 0,
  catch_up_pct           REAL DEFAULT 100,
  gp_entity              TEXT,
  notes                  TEXT,
  created_by             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spv_investors (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  spv_id           INTEGER NOT NULL REFERENCES spvs(id),
  lp_id            INTEGER REFERENCES lp_register(id),  -- заполнено, если это co-invest существующего LP фонда
  name             TEXT NOT NULL,       -- всегда заполнено, внешним инвесторам не нужна строка в lp_register
  investor_type    TEXT,                -- 'Fund LP'|'External'|'Founder'|'GP Co-invest'
  email            TEXT,
  contact          TEXT,
  commitment       REAL,
  called_amount    REAL DEFAULT 0,
  paid_amount      REAL DEFAULT 0,
  distributions    REAL DEFAULT 0,
  kyc_status       TEXT DEFAULT 'Pending',  -- тот же словарь, что lp_register.kyc_status, но простое поле — без workflow (см. §9)
  status            TEXT NOT NULL DEFAULT 'Active',
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Леджер SPV — **колонка-в-колонку зеркало** существующих `capital_calls`/`capital_call_line_items`/`distributions`/`distribution_line_items` (`server/db.js:141-221`), с заменой `fund_id`→`spv_id` и `lp_id`→`spv_investor_id`:

```sql
CREATE TABLE IF NOT EXISTS spv_capital_calls (
  id, tenant_id, spv_id NOT NULL REFERENCES spvs(id),
  cc_number, notice_date, payment_date, total_amount, pct_of_commit,
  purpose, purpose_type, status DEFAULT 'Pending', management_fee,
  bank_ref, created_by, notes, created_at, updated_at
);
CREATE TABLE IF NOT EXISTS spv_capital_call_line_items (
  id, tenant_id, call_id REFERENCES spv_capital_calls(id),
  spv_investor_id NOT NULL REFERENCES spv_investors(id),
  commitment, pct, called, paid, payment_date, status, wire_ref, wire_confirm_url, aml_ok
);
CREATE TABLE IF NOT EXISTS spv_distributions (
  id, tenant_id, spv_id NOT NULL REFERENCES spvs(id),
  dist_number, notice_date, payment_date, total_amount, source_type,
  source_portfolio_id REFERENCES portfolio(id), roc_amount, profit_amount,
  status DEFAULT 'Draft', created_by, notes, created_at, updated_at
);
CREATE TABLE IF NOT EXISTS spv_distribution_line_items (
  id, tenant_id, distribution_id REFERENCES spv_distributions(id),
  spv_investor_id NOT NULL REFERENCES spv_investors(id),
  pct, gross_amount, gp_carry_amount, net_amount, payment_date, status, wire_ref, wire_confirm_url
);
```

**Почему не переиспользовать существующие `capital_calls`/`distributions` через nullable `spv_id`, а зеркалить таблицы:**
1. `capital_call_line_items.lp_id` — `NOT NULL REFERENCES lp_register`. SPV-инвесторы часто НЕ являются LP фонда (внешние ко-инвесторы, фаундеры) — пришлось бы либо создавать им фиктивные `lp_register` строки (загрязняя реальный LP-реестр и его KYC-процессы), либо ослаблять `NOT NULL`, что в SQLite требует пересборки таблицы (create-copy-drop-rename), а не guarded `ALTER TABLE ADD COLUMN`, как везде в `db.js`.
2. Все существующие агрегации по `fund_id` (дашборд-KPI, `waterfallEngine.js`, страница капитал-коллов) пришлось бы обвешивать `AND spv_id IS NULL`, чтобы суммы SPV не утекали в показатели фонда — широкий, легко забываемый аудит по всей кодовой базе ради фичи, которая должна быть чисто аддитивной.

---

## 3. Самое сложное место: переиспользование `waterfallEngine.js` для SPV

В отличие от Hedge Fund (где carry считался принципиально по-новому из-за HWM на разных точках входа), здесь сложность минимальна именно благодаря зеркальной схеме из §2.3: `server/waterfallEngine.js` — уже подтверждённо чистая функция от `(preferred_return, catch_up_pct, carried_interest)` фонда + ленты капитал-коллов/дистрибьюций этого фонда. Для SPV нужен только новый call site:

```
GET /api/spvs/:id/metrics:
  waterfallEngine.compute({
    preferredReturn: spv.preferred_return_pct,
    catchUpPct: spv.catch_up_pct,
    carriedInterest: spv.carried_interest_pct,
    capitalCalls: spv_capital_calls WHERE spv_id = :id,
    distributions: spv_distributions WHERE spv_id = :id,
  })
```

Никакого нового расчётного модуля (в отличие от `performanceFeeEngine.js` у Hedge Fund) писать не нужно — единственный риск здесь в том, чтобы не перепутать параметры фонда (`funds.carried_interest`) с параметрами SPV (`spvs.carried_interest_pct`) при вызове, и в тесте на это стоит явно проверить, что carry SPV считается по СВОИМ preferred return/carry, а не по родительского фонда (см. §7).

---

## 4. API (`server/index.js`)

```
GET/POST   /api/portfolio/:id/rounds            -- создание раунда сразу со всеми инвесторами, в одной транзакции
PUT        /api/portfolio/rounds/:id            -- полная замена полей раунда + инвесторов (delete-then-reinsert)
DELETE     /api/portfolio/rounds/:id

GET/POST   /api/spvs
GET/PUT/DELETE /api/spvs/:id

GET/POST   /api/spvs/:id/investors
PUT/DELETE /api/spv-investors/:id

GET/POST   /api/spvs/:id/capital-calls
PUT/DELETE /api/spv-capital-calls/:id           -- создаёт line items по investors через pct_of_commit, как у фонда

GET/POST   /api/spvs/:id/distributions
PUT/DELETE /api/spv-distributions/:id

GET        /api/spvs/:id/metrics                -- см. §3
```

Все роуты: `requireAuth` + `requireInternal` + `requirePermission('accessFM')`, tenant-фильтр — без исключений из §0.

---

## 5. Фронтенд

- Новый `js/vc.js`, по форме `js/hf.js`. Хук в `js/funds.js:127` — второй duck-typed вызов рядом с существующим:
  ```js
  if (typeof updateDashboardForOperatingModel === 'function') updateDashboardForOperatingModel(f);
  if (typeof updateDashboardForAssetClass === 'function') updateDashboardForAssetClass(f);
  ```
  `updateDashboardForAssetClass(fund)` проверяет `fund.assetClass === 'vc'`, показывает/прячет nav-item `spvs` — по аналогии с `.nav-item[data-page="..."]` в `js/hf.js:25-50`. **В отличие от Hedge Fund, дашборд НЕ подменяется** — `lifecycleBar`/`peKpiGrid`/J-curve одинаково осмысленны для VC, их трогать не нужно.
- `renderSpvsPage()` — KPI-строка (число SPV, всего committed/called, число активных) + таблица + кнопка «New SPV».
- `openSpvDetailModal(id)` — модалка: список инвесторов, лог капитал-коллов/дистрибьюций, метрики из `GET /api/spvs/:id/metrics`.
- Cap table — новая секция в `_renderPortfolioModal()` (`js/app.js:2765-2990`), добавляется в существующий скроллящийся div **только при `fund.assetClass === 'vc'`** — модалка для PE не меняется визуально ни на пиксель. Таблица раундов (название/дата/pre/post/сумма/наша доля %) + кнопка «Добавить раунд» с формой на повторяемые строки инвесторов, `POST /api/portfolio/:id/rounds`.
- Новый nav item «SPV» + page shell в `index.html`, по образцу существующих hf-страниц.

---

## 6. Переиспользование уже готовой инфраструктуры

- **`waterfallEngine.js`** — переиспользуется без изменений для метрик SPV (см. §3).
- **`capital_calls`/`distributions`** — переиспользуются как ПАТТЕРН (структура таблиц и логика обработки), не как таблицы напрямую — см. обоснование в §2.3.
- **`deals`/`ic_memos`** — не меняются, уже VC-по-форме.
- **KYC/AML, роли, документы, мультитенантность, workflow-движок** — как есть, без изменений.
- **Не строится в этом треке:** параметризация `IC_SEATS` (`server/rolesRepo.js:8`) под asset_class — «лёгкий IC» явно отложен, см. §9.

---

## 7. Тесты и приёмка

- `vc-cap-table.test.js` — CRUD раундов/инвесторов, корректность `ownership_pct_post` после нескольких последовательных раундов (обязательный тест: дилюция при добавлении нового раунда должна пересчитывать процент владения предыдущих инвесторов).
- `spv-crud.test.js` — CRUD SPV/инвесторов.
- `spv-processing.test.js` — обработка капитал-коллов/дистрибьюций SPV, called/paid tracking по образцу существующей логики для `capital_calls`.
- `spv-metrics.test.js` — **обязательный тест**, что `GET /api/spvs/:id/metrics` использует параметры carry/preferred return САМОГО SPV, а не родительского фонда (см. §3) — завести SPV и фонд с разным `carried_interest_pct`/`preferred_return_pct`, убедиться, что метрики SPV не совпадают с метриками фонда при одинаковой ленте платежей.
- `tenant-isolation.test.js` / `delete-guards.test.js` — расширить на все 6 новых таблиц.
- **Критерий приёмки (end-to-end на реальном dev-сервере):**
  1. Создать VC-фонд → `peKpiGrid`/`lifecycleBar` не меняются, появляется nav «SPV»; переключиться на существующий PE-фонд → nav «SPV» пропадает, данные SPV/cap table не текут между фондами.
  2. Портфельная компания под VC-фондом → 2 раунда с несколькими инвесторами каждый → `ownership_pct_post` корректен после обоих раундов.
  3. SPV, связанный со сделкой/портфельной компанией → 2 внешних инвестора + 1 существующий LP фонда → капитал-колл → пометить paid → дистрибьюция → `GET /api/spvs/:id/metrics` возвращает разумные IRR/DPI/TVPI/carry.
  4. Полный набор тестов зелёный, включая расширенное покрытие tenant-isolation/delete-guards.

---

## 8. Порядок работ

1. **Схема + голый CRUD** — все 6 новых таблиц, базовые роуты без бизнес-логики, `loadXFromApi()` в `loadAllApiData()`. Пустые страницы рендерятся, `tenant-isolation.test.js`/`delete-guards.test.js` расширены.
2. **Бизнес-логика** — серверный расчёт `ownership_pct_post` (кумулятивно по раундам компании), обработка SPV капитал-коллов/дистрибьюций (called/paid tracking).
3. **Переиспользование движка** — `GET /api/spvs/:id/metrics` через `waterfallEngine.js` (см. §3), с обязательным тестом на неперепутанные параметры SPV/фонда.
4. **Фронтенд** — `js/vc.js` (хук, страница/модалка SPV, cap table в модалке портфельной компании), nav item, page shell.
5. **Уведомления** (низкий приоритет, можно отгрузить без этого) — новые триггеры в `server/notifications/` на новый капитал-колл SPV / новый раунд.

---

## 9. Открытые вопросы — решить до старта (не блокируют начало Этапа 1)

- Автозаполнение первого раунда `portfolio_rounds` из данных `deals` при конвертации сделки в портфель, или ручной ввод в v1? **Рекомендация: ручной ввод в v1** — избегает угадывания, какие поля `deals` маппить в раунд.
- Крystallизация carry SPV — тот же принцип, что у PE/VC-фонда (расчёт по каждой дистрибьюции через `waterfallEngine.js`), без отдельного тайминга/периодичности? **Рекомендация: да, тот же принцип.**
- `spv_investors.kyc_status` — простое поле в v1, без формального workflow-гейта (в отличие от `kyc_lp`)? **Рекомендация: да, простое поле** — внешние ко-инвесторы SPV обычно проходят упрощённый KYC силами GP, не через тот же процесс, что LP фонда.
- «Лёгкий IC» для VC-сделок (упрощение `IC_SEATS`/workflow под меньшее число согласующих) — **сознательно отложено на фазу 2**, не входит в подтверждённые решения по этому треку. Требует переделки глобального `IC_SEATS` (`server/rolesRepo.js:8`) под параметризацию по фонду/asset_class — отдельная задача вне этого ТЗ.
