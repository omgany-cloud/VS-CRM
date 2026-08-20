# Техническое задание

## Модуль Distributions (IRR/DPI/TVPI/Waterfall) + проактивные email-уведомления

**Проект:** Turan Capital Fund CRM (Golden Leaves Ltd)
**Репозиторий:** `crm 3` (Express + `node:sqlite` бэкенд, ванильный JS фронтенд)
**Дата:** 2026-08-19
**Статус:** к реализации

Документ написан под конкретную кодовую базу — со ссылками на реальные файлы, таблицы и паттерны, которые уже есть в проекте, чтобы разработчик (или AI-агент в VS Code) мог реализовать задачу, следуя тем же соглашениям, что и остальной код. Общий рецепт расширения сущности уже описан в `server/README.md` → раздел «Extending further»; это ТЗ — его конкретизация под две новые фичи.

---

## 0. Общие технические ограничения (для обоих блоков)

Соблюдать существующие соглашения проекта:

1. Каждая новая таблица — с колонкой `tenant_id INTEGER NOT NULL REFERENCES tenants(id)`, и **каждый** запрос к ней должен фильтроваться по `req.tenantId` (см. `server/auth.js`, `server/db.js`). Никаких запросов без этого фильтра.
2. Каждый новый роут — `requireAuth` + `requireInternal` + `requirePermission('accessFM')` (тот же гейт, что у `/api/capital-calls`, `/api/lp`, `/api/portfolio`) — см. `server/index.js`.
3. Для каждой новой сущности — функция `loadXFromApi()` в `js/api-auth.js` (по образцу `loadCapitalCallsFromApi()`, строка ~477) и вызов из `loadAllApiData()`.
4. Обязательно добавить покрытие в `server/test/tenant-isolation.test.js` (`assertEntityIsolation()`) — арендатор B не должен видеть/писать данные арендатора A. Если сущность поддерживает удаление — покрытие в `server/test/delete-guards.test.js`.
5. Никогда не доверять клиенту вычисляемые/статусные поля — сервер сам выводит `status`/производные суммы (тот же принцип, что уже применён в `PUT /api/ic-memos/:id`, где `status`/`resolution`/`quorumMet` выводятся из массива голосов, а не берутся из тела запроса).
6. RU-локализация текстов остаётся такой же, как везде в приложении (toast-сообщения, лейблы).

---

## 1. Distributions + IRR / DPI / TVPI / Waterfall

### 1.1 Проблема

В приложении есть только Capital Calls (деньги LP → фонд). Обратного потока (фонд → LP) нет вообще — модуль был ранее удалён (см. комментарий в `js/app.js` ~строка 365). Из-за этого:

- `kpiIrrCurrent` на дашборде всегда показывает «Расчёт недоступен — нет данных о распределениях» (`js/app.js`, функция обновления дашборда).
- `kpiMoicCurrent` считается только по портфелю (`value / invested`), это не настоящий fund-level мультипликатор.
- J-Curve (`buildRealJCurveData()`, `js/app.js`) строит только нисходящую ветку (calls), без притока.
- В `funds` таблице (`server/db.js`, строки 64–89) уже есть колонки `carried_interest` и `preferred_return` — они существуют, но нигде не используются в расчётах, потому что нечего распределять.

### 1.2 Модель данных

Новая таблица `distributions` (по аналогии с `capital_calls`) — головная запись одного события распределения:

```sql
CREATE TABLE IF NOT EXISTS distributions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  fund_id            INTEGER REFERENCES funds(id),
  dist_number        TEXT NOT NULL,          -- напр. "DIST-2026-01"
  notice_date        TEXT,
  payment_date       TEXT,
  total_amount       REAL NOT NULL DEFAULT 0,
  source_type        TEXT,                   -- 'exit' | 'dividend' | 'interest' | 'recycled' | 'other'
  source_portfolio_id INTEGER REFERENCES portfolio(id),  -- nullable, если не привязано к конкретной компании
  roc_amount         REAL NOT NULL DEFAULT 0, -- Return of Capital (не облагается carry)
  profit_amount      REAL NOT NULL DEFAULT 0, -- Profit (участвует в waterfall)
  status             TEXT NOT NULL DEFAULT 'Draft',  -- Draft | Sent | Paid
  created_by         TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distribution_line_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  distribution_id  INTEGER NOT NULL REFERENCES distributions(id),
  lp_id            INTEGER NOT NULL REFERENCES lp_register(id),
  pct              REAL NOT NULL DEFAULT 0,   -- % от commitment на момент распределения
  gross_amount     REAL NOT NULL DEFAULT 0,   -- доля LP до вычета carry
  gp_carry_amount  REAL NOT NULL DEFAULT 0,   -- сколько из этой доли уходит GP как carry (считает сервер)
  net_amount       REAL NOT NULL DEFAULT 0,   -- фактически выплачено LP (gross - carry, если применимо)
  payment_date     TEXT,
  status           TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Sent | Confirmed
  wire_ref         TEXT,
  wire_confirm_url TEXT
);
```

Расширить таблицу `funds` (`server/db.js`) двумя недостающими параметрами экономики фонда — `carried_interest` и `preferred_return` уже есть, не хватает:

```sql
ALTER TABLE funds ADD COLUMN catch_up_pct REAL DEFAULT 100;      -- % GP catch-up (обычно 100 = full catch-up)
ALTER TABLE funds ADD COLUMN waterfall_type TEXT DEFAULT 'european'; -- 'european' | 'american'
```
(следовать уже принятому в проекте паттерну guarded `ALTER TABLE` под существующим `CREATE TABLE` — см. комментарий в `server/db.js`).

> Примечание: убрать зависимость от захардкоженных `lockInPeriod`/`extensionYears` в `FUND_PARAMS` (`js/data.js`) в рамках этой же задачи не требуется, но если waterfall_type/catch_up_pct не заданы для фонда — использовать дефолты выше, тем же способом, что и `fundParamsFor()` в `js/funds.js` уже делает для других полей.

> **Важно — реконсиляция с существующей схемой:** в `lp_register` (`server/db.js`, строка 93) уже есть колонка `distributions REAL NOT NULL DEFAULT 0`. Судя по всему, это заглушка под будущий функционал, которая сейчас либо не используется, либо заполняется вручную. После внедрения этого модуля она должна стать **производным/кэшируемым полем**, пересчитываемым как `SUM(distribution_line_items.net_amount)` по LP, а не отдельным источником правды — иначе будут расхождения между этим полем и реальными записями `distribution_line_items`. Явно решить на этапе разработки: либо пересчитывать `lp_register.distributions` при каждом изменении line item (триггер в коде роута), либо убрать колонку из бизнес-логики и считать её live-запросом в `computeLpMetrics()`.

### 1.3 Расчётная логика (бэкенд, новый файл `server/waterfallEngine.js`)

**Waterfall на уровне одного Distribution** (вызывается при `POST /api/distributions` и при пересчёте):

1. `roc_amount` распределяется между LP пропорционально их доле участия — carry не начисляется.
2. `profit_amount` прогоняется через ступени:
   - Return of capital (уже выше) → LP.
   - Preferred return / hurdle (`funds.preferred_return`, годовых, накопительно от даты каждого call LP) → LP, пока не выбран.
   - GP catch-up (`funds.catch_up_pct`) → GP, пока GP не догонит `carried_interest`-долю от прибыли выше return-of-capital.
   - Остаток делится `(100 - carried_interest)% → LP` / `carried_interest% → GP`.
3. Результат — по каждому `lp_id`: `gross_amount`, `gp_carry_amount`, `net_amount` — записываются в `distribution_line_items`.
4. Для `waterfall_type = 'american'` (deal-by-deal) — расчёт делается в разрезе `source_portfolio_id` независимо от прочих сделок фонда; для `'european'` (whole-fund) — hurdle считается кумулятивно по всем call/distribution фонда. Реализовать сначала `european` (проще и чаще встречается у небольших GP), `american` — вторым этапом, явно пометить в UI, если не реализован.

**IRR/DPI/TVPI/RVPI** (новая функция `computeFundMetrics(fundId)` и `computeLpMetrics(fundId, lpId)`):

- Собрать датированный ряд денежных потоков: каждый `capital_call_line_items.called` (по `payment_date` или `capital_calls.notice_date`) как отрицательный поток, каждый `distribution_line_items.net_amount` (по `payment_date`) как положительный поток, плюс на сегодняшнюю дату — терминальный условный положительный поток = текущий NAV LP (доля от `portfolio.value`, если not exited) — для **Net IRR** (после carry) использовать `net_amount`, для **Gross IRR** — `gross_amount`.
- IRR — методом Ньютона или бисекции по формуле NPV(rate) = 0 (готовые лёгкие реализации XIRR есть, например небольшая функция без внешних зависимостей — тянуть новый npm-пакет не нужно, задача решается ~40 строками кода).
- `DPI = Σ net_amount (LP) / Σ called (LP)`.
- `TVPI = (Σ net_amount + текущий NAV LP) / Σ called (LP)`.
- `RVPI = текущий NAV LP / Σ called (LP)`.
- Считать и на уровне фонда (сумма по всем LP), и на уровне отдельного LP — разные даты входа дают разный IRR у разных LP, это ожидаемо и должно быть видно.

### 1.4 API (`server/index.js`, зеркалит `/api/capital-calls`)

```
GET    /api/distributions                       — список по фонду
POST   /api/distributions                        — создать (сервер сам считает waterfall и создаёт line items)
PUT    /api/distributions/:id                     — редактировать шапку (до статуса Paid)
DELETE /api/distributions/:id                     — только Draft
PUT    /api/distributions/:id/line-items/:lpId    — подтверждение оплаты конкретному LP (wire_ref/wire_confirm_url, по аналогии с capital-calls line-items, доступ CFO/CEO)
GET    /api/funds/:id/metrics                     — { irr, dpi, tvpi, rvpi } на уровне фонда
GET    /api/lp/:id/metrics                        — то же на уровне конкретного LP (для LP-портала)
```

Все — `requireAuth, requireInternal, requirePermission('accessFM')`, кроме `GET /api/lp/:id/metrics`, который дополнительно должен быть доступен через `requireLpPortalAuth` (LP видит только свои метрики — см. `server/index.js`, роуты `/api/portal/lp/*`).

### 1.5 Фронтенд

- Новый пункт меню «Распределения» в сайдбаре `index.html` (`data-page="distributions"`), рядом с `lp-capital-calls`, тот же паттерн `<a class="nav-item" data-page="...">`.
- Новая страница/модуль `js/distributions.js` (по образцу `js/funds.js`/капитал-коллов в `js/app.js`): таблица распределений, форма создания (сумма, источник, ROC/Profit split), кнопка «Рассчитать waterfall» → превью по LP до сохранения, статусы Draft/Sent/Paid, подтверждение оплаты по LP.
- `loadDistributionsFromApi()` в `js/api-auth.js`, вызов из `loadAllApiData()`.
- Дашборд (`js/app.js`, функция рендера KPI): заменить `moicCurrentEl`/`irrCurrentEl`/тексты-заглушки на вызов `GET /api/funds/:id/metrics` и показать реальные DPI/TVPI/IRR (можно добавить отдельные KPI-карточки «DPI» и «TVPI» рядом с существующими).
- `buildRealJCurveData()` — добавить положительную ветку из `distribution_line_items.net_amount` по годам, рядом с уже существующей отрицательной веткой calls.
- LP-портал (`portal.html` / соответствующий JS): новая вкладка «Capital Account Statement» — called / distributed / DPI / TVPI / IRR конкретно для этого LP, через `GET /api/lp/:id/metrics`.
- Экспорт (`js/export.js`): добавить `exportDistributions()` (новый лист, тот же паттерн, что `exportCapitalCalls()`), и добавить этот лист в `exportFullCRM()` (сейчас «9 листов» → станет 10).

### 1.6 Тесты и приёмка

- `server/test/tenant-isolation.test.js` — покрытие для `distributions`/`distribution_line_items`.
- Юнит-тесты для `waterfallEngine.js`: (а) распределение без hurdle/catch-up (простая пропорция), (б) распределение, где прибыль не превышает hurdle — GP получает 0, (в) распределение, полностью проходящее через catch-up, (г) сумма всех `net_amount` + `gp_carry_amount` по всем LP строго равна `total_amount` распределения (защита от ошибок округления/потери денег).
- Юнит-тесты для IRR-функции на известных наборах денежных потоков со сверкой против Excel `XIRR()`.
- **Критерий приёмки:** на дашборде и в LP-портале вместо «Расчёт недоступен» показываются реальные DPI/TVPI/IRR после того, как в системе создано хотя бы одно Capital Call и одно Distribution.

---

## 2. Проактивные email-уведомления

### 2.1 Проблема

В `server/index.js` нет ни одной интеграции с почтой (SMTP/nodemailer) и нет фонового планировщика (cron/scheduler). Всё оповещение — только `showToast()` в UI (видно, пока человек уже в приложении) и виджеты, которые перерисовываются при заходе на дашборд (`renderDashboardObWidget`, `renderDashboardCoiWidget`, `renderKYCStatus` и т.д. в `js/app.js`). Человек, который не зашёл в CRM, ни о чём не узнает.

### 2.2 Инфраструктура

**Новый модуль `server/notifications/mailer.js`:**
- Обёртка над `nodemailer` (добавить как зависимость в `server/package.json`), конфиг через `.env` (по аналогии с `JWT_SECRET`/`PORTAL_DEMO_PASSWORD` в `.env.example`):

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="Turan Capital Fund CRM <noreply@...>"
```
- Если переменные не заданы — модуль логирует в консоль вместо реальной отправки (то же поведение «безопасный дефолт», что уже принято в проекте для `JWT_SECRET`), чтобы локальная разработка не ломалась без настроенного SMTP.
- Обновить `DEPLOYMENT.md`, добавив шаг настройки `SMTP_*` в раздел конфигурации `.env` (шаг 4).

**Новая таблица `notification_log`** (идемпотентность — не слать одно и то же дважды):

```sql
CREATE TABLE IF NOT EXISTS notification_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  event_type    TEXT NOT NULL,      -- 'kyc_renewal_due' | 'capital_call_created' | ...
  entity_type   TEXT NOT NULL,      -- 'lp_register' | 'capital_calls' | 'workflow_instances' | ...
  entity_id     INTEGER NOT NULL,
  recipient_id  INTEGER NOT NULL REFERENCES users(id),
  sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Перед отправкой — проверка «не отправляли ли уже это `event_type`+`entity_id`+`recipient_id` за последние N дней» (N зависит от типа события, см. таблицу ниже).

**Планировщик `server/notifications/scheduler.js`:**
- Без новых тяжёлых зависимостей — `setInterval` с проверкой раз в час достаточно (сервер и так держит долгоживущий процесс под systemd — см. `deploy/crm.service`); внутри — фильтр «сейчас 08:00–09:00 по времени тенанта» для дайджестов, чтобы не слать письма ночью.
- Отдельная функция на каждый триггер (см. 2.3), вызываются последовательно, ошибка одной не должна ронять остальные (try/catch на каждую).

### 2.3 Триггеры

| Событие | Источник | Тип | Получатель (по праву/роли) |
|---|---|---|---|
| Приближается KYC renewal (LP) | `lp_register.kyc_next_review` (колонка уже есть в схеме) | Дайджест, за 30/14/7 дней | `COMPLIANCE_OFFICER`, `MLRO` |
| Приближается KYC renewal (CF&A клиент) | `ob_clients` | Дайджест, 30/14/7 дней | ответственный RM + `COMPLIANCE_OFFICER` |
| Создан Capital Call | `POST /api/capital-calls` | Мгновенно | LP (email из `lp_register`), копия CFO/CEO |
| Создано Distribution | `POST /api/distributions` (новый) | Мгновенно | затронутые LP, копия CFO |
| Ваш шаг в согласовании (workflow) | `workflow_instances`, текущий незавершённый step | Мгновенно при создании/переходе на следующий step | пользователи с ролью `steps[current].role` |
| Ждёт вашего голоса в IC | `ic_memos`, voting массив | Мгновенно при создании меморандума | владельцы 4 IC-мест, чей голос ещё `null` |
| Просрочен платёж портфельной компании | `portfolio.paymentSchedule[].status = 'Просрочен'` | Дайджест, ежедневно пока не оплачено | RM компании, `CFO` |
| Истекает обязательный документ портфеля (≤30 дней) | `portfolio.documents.files[].expiryDate` | Дайджест, 30/14/7 дней | RM компании |
| Дедлайн отчётности регулятору | `afsa_reports` | Дайджест, 14/7/1 день | `CEO`, `COMPLIANCE_OFFICER` |
| Решение по конфликту/Restricted List не принято N дней | `conflict_approvals` | Дайджест | `COMPLIANCE_OFFICER`, `MLRO`, `CEO` |

Получатели резолвятся так же, как в существующей проверке прав: выбрать всех `active=1` пользователей тенанта, чья роль в таблице `roles` имеет нужный булев флаг/код (тот же принцип, что `requirePermission`/`requireRole` в `server/auth.js`) — никакой отдельной подписочной модели на MVP не требуется.

### 2.4 Приёмка

- Письмо реально приходит на реальный SMTP при выполнении условия (проверить на тестовом ящике).
- Одно и то же событие не шлётся повторно (проверка через `notification_log`).
- Отключение SMTP в `.env` не роняет сервер — просто ничего не отправляется, событие логируется в консоль.
- Юнит-тесты на функции резолва условий («есть ли LP с KYC, истекающим через 14 дней» и т.п.) без реальной отправки почты (замокать `mailer.send`).

---

## 3. Предлагаемая последовательность работ

1. **Distributions — данные и API** (таблицы, роуты CRUD, без waterfall-математики — просто ручной ввод сумм по LP).
2. **Waterfall engine + IRR/DPI/TVPI** — расчётная логика и `/metrics` роуты.
3. **Фронтенд Distributions** — страница, дашборд, LP-портал, экспорт.
4. **Notifications — инфраструктура** (mailer, scheduler, notification_log) + два самых ценных триггера первыми: «создан Capital Call» и «ваш шаг в согласовании» (они мгновенные, проще всего проверить вручную).
5. **Notifications — дайджесты** (KYC, документы, дедлайны регулятора).

## 4. Открытые вопросы (уточнить перед стартом)

- Какой SMTP-провайдер использовать (свой корпоративный SMTP / SendGrid / Postmark / AWS SES)?
- European или American waterfall нужен по умолчанию для текущего фонда Turan Capital Fund LP? (Из README/данных фонда пока не видно явного указания.)
- Часовой пояс тенанта для тайминга дайджестов — брать ли системный TZ сервера или per-tenant настройку?

> Снято с открытых вопросов: e-mail для рассылки LP уже есть — колонка `lp_register.email` существует в схеме (`server/db.js`, строка 105), отдельно её добавлять не нужно.
