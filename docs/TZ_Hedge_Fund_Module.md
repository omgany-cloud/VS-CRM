# Техническое задание

## Модуль Hedge Fund (open-end движок: subscriptions/redemptions/NAV/performance fee)

**Проект:** Turan Capital Fund CRM (Golden Leaves Ltd)
**Дата:** 2026-08-19
**Статус:** к реализации ПОСЛЕ того, как закрыт текущий PE-трек (Distributions Stage 2 + фронтенд). Опирается на `ARCHITECTURE_Multi_Strategy_Roadmap.md` §3.2 — читать сначала его.
**Важно:** это самый большой и самый рискованный по матчасти из всех обсуждавшихся треков — в отличие от Distributions (где просто не хватало модуля) и VC/REIT (параметризация существующего), тут придётся аккуратно спроектировать учёт performance fee по инвесторам с разными точками входа. Раздел 3 ниже — самое важное место документа, требует явного решения перед стартом кода.

---

## 0. Общие технические ограничения (те же, что в `TZ_Distributions_and_Notifications.md`)

1. Каждая новая таблица — `tenant_id`, каждый запрос фильтруется по `req.tenantId`.
2. Каждый новый роут — `requireAuth` + `requireInternal` + `requirePermission('accessFM')`, публикация NAV — дополнительно ограничена ролью (см. §2.3).
3. `loadXFromApi()` в `js/api-auth.js` под каждую новую сущность, вызов из `loadAllApiData()`.
4. Покрытие `server/test/tenant-isolation.test.js` + `delete-guards.test.js` для новых таблиц.
5. Сервер сам выводит вычисляемые поля (`nav_per_unit`, `fee_amount`, `lockup_ok`, `gate_applied`) — никогда не доверять клиенту.
6. Переиспользовать уже готовую инфраструктуру, а не дублировать: workflow-движок (`server/wfDefinitions.js`) для согласования NAV, уведомления (`server/notifications/`) для триггеров по этому модулю — обе системы уже спроектированы достаточно универсально, конкретно под это их строить не пришлось.

---

## 1. Проблема / контекст

Вся экономика фонда в текущей CRM спроектирована вокруг closed-end механики: LP делает commitment, GP зовёт капитал через Capital Calls, деньги возвращаются через Distributions по waterfall. Hedge fund устроен ровно наоборот:

- Инвестор не даёт commitment, который потом дёргают по частям — он **сразу вносит сумму** (subscription) и получает долю фонда в юнитах по текущей NAV на юнит.
- Может периодически **выходить** (redemption) — не только получать деньги, когда GP решит распределить прибыль.
- Стоимость его доли **пересчитывается регулярно** (NAV публикуется, например, ежемесячно), а не оценивается вручную раз в квартал, как портфельная компания.
- GP зарабатывает не carry через waterfall, а **performance fee**, которая ограничена **high-water mark** — платится только с прибыли сверх максимума, который эта конкретная позиция инвестора уже достигала.

Ни одна из существующих таблиц (`capital_calls`, `distributions`, `portfolio`, `waterfallEngine.js`) для этого не подходит и не должна дорабатываться под это — см. обоснование в архитектурной записке.

---

## 2. Модель данных

### 2.1 Настройки фонда

Расширить `funds` (поверх `operating_model`/`asset_class` из архитектурной записки):

```sql
ALTER TABLE funds ADD COLUMN performance_fee_pct REAL DEFAULT 20;
ALTER TABLE funds ADD COLUMN hf_hurdle_rate REAL DEFAULT 0;        -- опционально, 0 = нет hurdle перед performance fee
ALTER TABLE funds ADD COLUMN hwm_scope TEXT DEFAULT 'investor';    -- 'investor' | 'fund' — см. §3, почти всегда 'investor'
ALTER TABLE funds ADD COLUMN subscription_frequency TEXT DEFAULT 'monthly';   -- 'daily'|'monthly'|'quarterly'
ALTER TABLE funds ADD COLUMN redemption_frequency TEXT DEFAULT 'quarterly';
ALTER TABLE funds ADD COLUMN redemption_notice_days INTEGER DEFAULT 60;
ALTER TABLE funds ADD COLUMN lockup_months INTEGER DEFAULT 12;
ALTER TABLE funds ADD COLUMN gate_pct REAL DEFAULT 25;             -- макс. % NAV фонда, гасимый за одно окно
ALTER TABLE funds ADD COLUMN fee_crystallization_frequency TEXT DEFAULT 'annual'; -- 'quarterly'|'annual'
```

(`management_fee` уже существует и переиспользуется как есть — просто начисляется периодически на AUM вместо процента от committed capital.)

### 2.2 Подписки, погашения, NAV

```sql
CREATE TABLE IF NOT EXISTS hf_subscriptions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  fund_id             INTEGER REFERENCES funds(id),
  lp_id               INTEGER NOT NULL REFERENCES lp_register(id),
  sub_number          TEXT NOT NULL,
  request_date        TEXT,
  amount              REAL NOT NULL DEFAULT 0,
  nav_per_unit_at_entry REAL,          -- сервер подставляет из последней Published NAV на effective_date
  units_issued        REAL,            -- сервер считает: amount / nav_per_unit_at_entry
  effective_date      TEXT,
  lockup_until        TEXT,            -- сервер считает: effective_date + funds.lockup_months
  status              TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Processed | Cancelled
  created_by          TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hf_redemptions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  fund_id             INTEGER REFERENCES funds(id),
  lp_id               INTEGER NOT NULL REFERENCES lp_register(id),
  redemption_number   TEXT NOT NULL,
  request_date        TEXT,
  units_requested     REAL NOT NULL DEFAULT 0,
  notice_expires      TEXT,            -- сервер: request_date + funds.redemption_notice_days
  effective_date      TEXT,            -- следующее окно погашения после notice_expires
  nav_per_unit_at_exit REAL,
  amount              REAL,
  lockup_ok           INTEGER,         -- сервер проверяет против hf_subscriptions.lockup_until
  gate_applied        INTEGER NOT NULL DEFAULT 0,
  gate_pct_applied    REAL,            -- если gate сработал — какая доля от запроса реально погашена в этом окне
  status              TEXT NOT NULL DEFAULT 'Requested', -- Requested | Queued | Processed | Cancelled
  created_by          TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hf_nav_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  fund_id             INTEGER REFERENCES funds(id),
  as_of_date          TEXT NOT NULL,
  gross_asset_value   REAL NOT NULL DEFAULT 0,
  liabilities         REAL NOT NULL DEFAULT 0,
  nav_total           REAL,            -- сервер: gross_asset_value - liabilities
  units_outstanding   REAL,
  nav_per_unit        REAL,            -- сервер: nav_total / units_outstanding
  status              TEXT NOT NULL DEFAULT 'Draft',  -- Draft | Published
  entered_by          TEXT,
  published_by        TEXT,
  published_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.3 Позиции инвесторов и fee-крystallизация

```sql
CREATE TABLE IF NOT EXISTS hf_investor_positions (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                 INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                   INTEGER REFERENCES funds(id),
  lp_id                     INTEGER NOT NULL REFERENCES lp_register(id),
  units_held                REAL NOT NULL DEFAULT 0,
  high_water_mark_per_unit  REAL NOT NULL DEFAULT 0,
  last_fee_crystallization_date TEXT,
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, fund_id, lp_id)   -- одна текущая позиция на LP на фонд
);

CREATE TABLE IF NOT EXISTS hf_fee_crystallizations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  fund_id               INTEGER REFERENCES funds(id),
  lp_id                 INTEGER NOT NULL REFERENCES lp_register(id),
  period_start          TEXT,
  period_end            TEXT,
  nav_per_unit_start    REAL,
  nav_per_unit_end      REAL,
  hwm_before            REAL,
  hwm_after             REAL,
  gain_per_unit         REAL,          -- max(0, nav_per_unit_end - hwm_before)
  performance_fee_pct   REAL,
  fee_amount            REAL,
  units_deducted_for_fee REAL,         -- см. §3 — способ взимания
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Публикация NAV (`status: Draft → Published`) должна идти через **уже существующий workflow-движок**, а не через новый ad-hoc флаг: добавить в `server/wfDefinitions.js` новый тип `nav_publish` (`CFO вносит расчёт → CEO подтверждает`, тот же паттерн двух шагов, что и у остальных финансовых согласований) — это ровно тот случай, когда общее ядро из архитектурной записки реально экономит работу, а не просто красиво звучит в документе.

---

## 3. Самое сложное место: как считать performance fee у инвесторов с разными точками входа

**Это нужно явно решить до того, как писать код** — если пропустить этот раздел и просто взять единый `nav_per_unit` на всех, легко получить ситуацию, где инвестор, зашедший на пике и потерявший деньги, всё равно платит performance fee наравне с тем, кто зашёл на дне — это прямая (и частая в реальных системах) ошибка.

Два стандартных подхода в индустрии:

**A. Equalization (уравнительный счёт)** — все инвесторы держат юниты одного и того же "series" с единым `nav_per_unit`, но у каждого есть equalization credit/debit — виртуальный корректирующий баланс, который выравнивает то, что инвестор должен был бы заплатить как fee, будь у него отдельная серия. Стандарт для крупных администраторов, но существенно сложнее в реализации и в объяснении LP.

**B. Series accounting (учёт сериями)** — каждая подписка (или группа подписок за один период) создаёт новую "серию" юнитов с собственным HWM. В конце периода кристаллизации серия, у которой прошла кристаллизация, конвертируется в юниты основной ("зрелой") серии по текущему `nav_per_unit`. Концептуально проще: `hf_investor_positions` в §2.3 уже написана в духе этого подхода (HWM хранится на уровне LP, не на уровне фонда).

**Рекомендация для этого проекта: начинать с (B), Series accounting**, как более простого в реализации и объяснимого для LP — но именно это должно быть подтверждено (или отвергнуто) владельцем продукта/финансовым консультантом фонда до начала разработки, а не решено разработчиком по умолчанию. Схема в §2.3 совместима с обоими подходами на уровне таблиц, но бизнес-логика в `server/performanceFeeEngine.js` будет разной.

**Расчёт кристаллизации на конец периода (`fee_crystallization_frequency`), псевдокод для подхода B:**

```
for each hf_investor_positions row (lp, fund):
  gain_per_unit = max(0, current_nav_per_unit - hwm_before)
  if fund.hf_hurdle_rate > 0:
     gain_per_unit = max(0, gain_per_unit - hurdle_accrued_since_last_crystallization)
  fee_amount = gain_per_unit * units_held * fund.performance_fee_pct / 100
  units_deducted_for_fee = fee_amount / current_nav_per_unit
  units_held -= units_deducted_for_fee          -- инвестор "платит" юнитами, GP получает их отдельной позицией
  high_water_mark_per_unit = max(hwm_before, current_nav_per_unit)  -- HWM обновляется ДАЖЕ если fee не начислен (при просадке)
  записать hf_fee_crystallizations
```

**Тест-кейс, который обязателен для проверки корректности (реальный источник ошибок в индустрии):** инвестор заходит по NAV=100, к следующей кристаллизации NAV=90 (убыток — fee не начисляется, HWM остаётся 100), к следующей — NAV=95 (всё ещё ниже HWM=100 — fee всё ещё не начисляется, несмотря на рост от 90 к 95), к следующей — NAV=110 (fee начисляется только с (110-100)=10 на юнит, а не с (110-95)=15).

---

## 4. API (`server/index.js`)

```
GET/POST   /api/hf/subscriptions
PUT        /api/hf/subscriptions/:id           -- перевод Pending → Processed (сервер считает units_issued по последней Published NAV)
DELETE     /api/hf/subscriptions/:id           -- только Pending

GET/POST   /api/hf/redemptions
PUT        /api/hf/redemptions/:id             -- обработка, включая lockup/gate проверку — см. §2.2
DELETE     /api/hf/redemptions/:id             -- только Requested

GET        /api/hf/nav                          -- история NAV по фонду
POST       /api/hf/nav                          -- новая запись Draft (CFO)
PUT        /api/hf/nav/:id/publish              -- Draft → Published (CEO, через workflow nav_publish)

POST       /api/hf/fee-crystallization/run       -- ручной запуск кристаллизации за период (CEO/CFO), плюс автоматический вызов из `server/notifications/scheduler.js` по `fee_crystallization_frequency`

GET        /api/funds/:id/hf-metrics             -- { aum, navPerUnit, mtdReturn, ytdReturn, sinceInceptionReturn }
GET        /api/lp/:id/hf-position                -- { unitsHeld, currentValue, unrealizedGain, hwm, feesPaidToDate } — для LP-портала
```

Гейты — как в §0, публикация NAV — дополнительно только через workflow `nav_publish` (нельзя просто `PUT status=Published` напрямую, иначе смысла в согласовании нет).

---

## 5. Фронтенд

- Новые пункты меню (видны только когда `activeFund.operatingModel === 'open-end'` — см. §4 архитектурной записки про скрытие nav-item по типу фонда): «Подписки / Погашения», «NAV».
- Дашборд для открытого фонда — **отдельный набор KPI-карточек и без lifecycle-бара PE-образца**: AUM, NAV/юнит, MTD/YTD доходность, доходность с момента запуска — вместо "Целевой IRR"/"Committed %"/стадий "Онбординг → Инвестирование".
- LP-портал — форма заявки на подписку, форма заявки на погашение (с отображением, когда истекает lock-up и notice period), выписка по позиции: юниты, текущая стоимость, HWM, уплаченные fee.
- **Осознанно вне периметра MVP:** полноценный блоттер позиций/сделок (учёт конкретных ценных бумаг, P&L по инструментам) — это уже функциональность OMS/учётной системы трейдинга, а не CRM для LP-отношений. Предполагается, что GP ведёт торговлю и расчёт `gross_asset_value` где-то ещё (у брокера/администратора), а в эту CRM заносится только итоговое значение при публикации NAV. Если это предположение неверно — важно сказать сейчас, это меняет объём задачи на порядок.

---

## 6. Переиспользование уже готовой инфраструктуры

Явно, чтобы не задваивать работу:

- **Workflow** (`server/wfDefinitions.js`, `workflow_instances`) — публикация NAV идёт через него (см. §2.3), не через отдельный approve-флаг.
- **Уведомления** (`server/notifications/`) — новые триггеры добавляются в уже существующие `triggers.js`/`digestChecks.js`, а не в отдельный модуль:
  - Мгновенно: NAV опубликован → письмо LP с новой стоимостью их позиции; заявка на погашение обработана → письмо LP.
  - Дайджест: приближается конец lock-up периода у инвестора; приближается дата исполнения заявки на погашение (notice period истекает); близится дата кристаллизации fee.
- **KYC/AML, роли, документы, мультитенантность** — как есть, без изменений (см. §2 архитектурной записки).

---

## 7. Тесты и приёмка

- Тест-кейс из §3 (просадка → частичное восстановление ниже HWM → рост выше исходного HWM) — обязателен, это самое частое место ошибок в индустрии.
- Тест на gate: сумма запрошенных погашений превышает `gate_pct` от NAV фонда — часть заявок должна получить `status='Queued'` с корректно посчитанным `gate_pct_applied`, а не быть просто отклонённой или проведённой полностью.
- Тест на lock-up: погашение с `effective_date < lockup_until` должно быть отклонено сервером (`lockup_ok=0`), а не только скрыто в UI.
- Тест на связность units: сумма `units_issued` по всем subscriptions минус сумма `units_requested` по обработанным redemptions минус `units_deducted_for_fee` по всем кристаллизациям должна сходиться с `units_outstanding` последней Published NAV — тест-регрессия на "не потерялись ли юниты".
- `tenant-isolation.test.js` — покрытие всех новых таблиц.
- **Критерий приёмки:** LP-портал показывает инвестору корректную текущую стоимость его позиции и historical fee, посчитанные по опубликованным NAV, без единого захардкоженного числа.

---

## 8. Порядок работ

1. Схема + `funds.operating_model`/`asset_class` (из архитектурной записки) + базовый CRUD subscriptions/redemptions/NAV без бизнес-логики.
2. Публикация NAV через workflow + обработка subscriptions/redemptions против последней Published NAV (lock-up/gate проверки).
3. `performanceFeeEngine.js` — крystallизация fee по выбранному в §3 подходу, с обязательным тест-кейсом на просадку/восстановление.
4. Фронтенд: страницы, альтернативный дашборд, LP-портал.
5. Уведомления — новые триггеры в уже существующий `server/notifications/`.

## 9. Открытые вопросы — решить до старта

- **Equalization vs Series accounting (§3)** — самое важное решение документа, без него нельзя писать `performanceFeeEngine.js`.
- Нужен ли `hf_hurdle_rate` вообще для этого фонда, или performance fee считается с первого доллара прибыли выше HWM без hurdle?
- Нужны ли multi-class share structure и side pockets с первой итерации, или явно выносятся за скобки MVP (текущая схема в §2 их не поддерживает)?
- Кто по факту вычисляет `gross_asset_value` каждый период — сам GP вручную вводит агрегированную цифру, или это должно прийти от администратора/прайм-брокера через файл/интеграцию? От ответа зависит, нужен ли в MVP импорт NAV-файла или достаточно формы ручного ввода.
- Redemption in specie (выплата ценными бумагами вместо денег) — нужна ли поддержка, или считать вне периметра (обычная практика — не поддерживать в MVP).
