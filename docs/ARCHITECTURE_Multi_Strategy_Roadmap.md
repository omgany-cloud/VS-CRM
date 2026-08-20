# Архитектурная записка: мультистратегийность (PE / VC / REIT / Hedge Fund)

**Проект:** Turan Capital Fund CRM (Golden Leaves Ltd)
**Дата:** 2026-08-19
**Статус:** архитектурное решение зафиксировано, к разработке пока не приступать — этот документ фиксирует форму данных, чтобы `TZ_Distributions_and_Notifications.md` и всё, что пишется поверх него, сразу проектировалось совместимо с будущими VC/REIT/Hedge Fund, а не переписывалось с нуля.

---

## 1. Вывод одной фразой

**Общее ядро (chassis) одно на все стратегии. Экономических движков — два: closed-end (PE/VC/REIT) и open-end (Hedge Fund). "Актив внутри портфеля" — заменяемый модуль (компания / компания-с-раундами / объект недвижимости).** Hedge Fund не встраивается в существующие таблицы `capital_calls`/`distributions` — это архитектурно отдельная ветка, которая переиспользует только ядро.

Обоснование (структурная разница подтверждена и матчастью, и тем, как реально устроены рыночные платформы — см. предыдущее обсуждение в этом чате): PE, VC и частный REIT — все closed-end: commitment → capital call → owned asset → exit/rent → distribution → waterfall с carry, J-curve. Hedge Fund — open-end: subscription/redemption в любой момент по расписанию ликвидности, NAV считается периодически (mark-to-market), комиssия — performance fee + high-water mark, а не waterfall с carry. Показательно, что даже профильные вендоры (Allvue — "PE, VC, private credit" одной платформой) не заявляют hedge funds и REIT в том же продукте, что PE/VC — это не маркетинговая случайность, а следствие именно этой развилки.

---

## 2. Слой 1 — общее ядро (Chassis)

Уже реализовано в текущей кодовой базе и **не требует переделки** под мультистратегийность — оно и так не завязано на экономику конкретной стратегии:

| Компонент | Файлы/таблицы | Комментарий |
|---|---|---|
| Мультитенантность | `tenants`, `tenant_id` на каждой таблице, `server/auth.js` | Стратегия фонда тут не участвует. |
| Мультифондовость | `funds` (`server/db.js`), fund switcher в `index.html` | Уже поддерживает несколько фондов в одном тенанте — ключевая точка расширения (см. §4). |
| Инвесторы (LP) | `lp_register`, `server/lpMapping.js` | Общая сущность для LP закрытого фонда и инвестора хедж-фонда — набор полей (KYC, commitment) пересекается. |
| Роли и права | `roles`, `rolesRepo.js`, `rolesMapping.js`, конструктор ролей (`js/users.js`) | Гибкая ролевая модель уже не завязана на PE-специфику. |
| Workflow-согласования | `workflow_instances`, `server/wfDefinitions.js` | Движок общий; конкретные step-шаблоны (KYC, IC) — заменяемые определения, добавить новые под другую стратегию — это конфиг, не архитектура. |
| KYC/AML, Restricted List, COI | `ob_clients`, `restricted_list`, `coi_registry`, Chinese Wall (`server/chineseWall.js`) | Комплаенс-требования регулятора не зависят от того, PE это или hedge fund. |
| Документы/Vault | `documents`, `uploaded_files` | Универсально. |
| Compliance Calendar, экспорт | `js/export.js`, дашборд-виджеты | Универсально, только набор листов/полей расширяется. |

**Вывод:** всё, что писать в `TZ_Distributions_and_Notifications.md` — user/roles/workflow/documents — можно реализовывать как есть, это не придётся трогать при добавлении VC/REIT/Hedge Fund.

---

## 3. Слой 2 — экономический движок фонда (развилка)

Новое поле на уровне фонда, определяющее, какой движок применяется:

```sql
-- funds.type уже существует (server/db.js) как СВОБОДНЫЙ ТЕКСТ для отображения
-- ("Private Equity Fund" и т.п.) — сейчас нигде не используется для ветвления
-- логики (проверено: не встречается в js/funds.js). Предлагается:
ALTER TABLE funds ADD COLUMN operating_model TEXT NOT NULL DEFAULT 'closed-end';
  -- 'closed-end' | 'open-end'
ALTER TABLE funds ADD COLUMN asset_class TEXT NOT NULL DEFAULT 'pe';
  -- 'pe' | 'vc' | 'reit' | 'hedge_fund'
-- funds.type остаётся как есть (display-строка), asset_class — управляющий enum.
```

`operating_model` выводится из `asset_class` (`hedge_fund` → `open-end`, всё остальное → `closed-end`), но хранится отдельным полем, чтобы не завязывать код на строковое сравнение с `asset_class` в каждом месте — читается один раз при загрузке фонда, дальше UI/API ветвятся по `operating_model`.

### 3.1 Closed-end движок — PE / VC / REIT

Это ровно то, что описано в `TZ_Distributions_and_Notifications.md`: `capital_calls` → asset → `distributions` → `waterfallEngine.js` → IRR/DPI/TVPI/RVPI. Один движок на все три стратегии, различаются только:

| | PE (есть) | VC | REIT (частный) |
|---|---|---|---|
| Сущность-актив | `portfolio` (компания) | `portfolio` + раунды/cap table | новая сущность `properties` (объект недвижимости) |
| Специфичные поля | ковенанты, долг/LTV, EBITDA план/факт | ownership %, SAFE/convertible notes, раунды (Seed/A/B/…), board seat | rent roll, occupancy, cap rate, NOI |
| Доп. метрики поверх общих IRR/DPI/TVPI | — | — | FFO, AFFO, Cash-on-Cash |
| Deal pipeline / IC | `deals` + `ic_memos`, полноценный IC | тот же движок, обычно легче/быстрее по срокам | `deals` как "приобретение объекта", тот же IC |
| Периодичность distributions | обычно редко, по факту exit | обычно редко, по факту exit | чаще — квартально/ежемесячно из арендного дохода |

**Практический вывод:** VC — это на 90% параметризация существующего PE-модуля (переключить набор полей/лейблов по `asset_class`, добавить cap table как отдельную вложенную структуру в `portfolio`, как сейчас уже сделано с `financials`/`monitoring`/`compliance`/`exit` в 6-вкладочном модале). REIT — новый "асёт-модуль" `properties` параллельно `portfolio`, но подключённый к тому же `capital_calls`/`distributions`/`waterfallEngine.js` через тот же `fund_id`.

### 3.2 Open-end движок — Hedge Fund

Отдельная ветка, **не переиспользует** `capital_calls`/`distributions`/`waterfallEngine.js`. Новые таблицы (эскиз, не финальная схема — детализировать отдельным ТЗ, когда возьмётесь за этот трек):

```sql
CREATE TABLE IF NOT EXISTS hf_subscriptions (
  id, tenant_id, fund_id, lp_id, amount, nav_per_unit_at_entry,
  units_issued, effective_date, status  -- Pending | Processed
);

CREATE TABLE IF NOT EXISTS hf_redemptions (
  id, tenant_id, fund_id, lp_id, units_redeemed, nav_per_unit_at_exit,
  amount, request_date, effective_date, lockup_ok, gate_applied, status
);

CREATE TABLE IF NOT EXISTS hf_nav_history (
  id, tenant_id, fund_id, as_of_date, nav_total, nav_per_unit, units_outstanding
);

CREATE TABLE IF NOT EXISTS hf_investor_hwm (
  id, tenant_id, fund_id, lp_id, high_water_mark_per_unit, updated_at
  -- нужен ПОЛПОЗИЦИОННЫЙ high-water mark, т.к. разные LP заходили по разной NAV
);
```

Плюс отдельный расчётный модуль `server/performanceFeeEngine.js` (крystallизация performance fee относительно HWM конкретного инвестора, а не фонда в целом — это тонкое место, которое часто делают неправильно) — по объёму работы сопоставим с `waterfallEngine.js`, но не пересекается с ним по коду.

**Из ядра переиспользуется:** `lp_register` (с полем `commitment`, переосмысленным как "текущая сумма под управлением", а не drawdown-commitment), KYC/workflow/roles/documents/compliance calendar — всё как есть.

**Не переиспользуется:** `capital_calls`, `capital_call_line_items`, `distributions`, `distribution_line_items`, `waterfallEngine.js`, вся PE-специфика дашборда (J-curve, "Investment Period Years 1–5", лейблы "Инвестиционный период"/"Создание стоимости" в lifecycle-баре — это чисто closed-end понятия, для hedge fund они не имеют смысла и должны скрываться по `operating_model`).

---

## 4. Что это значит для UI

Сейчас сайдбар (`index.html`) и лейблы страниц статичны для одного фонда/одной стратегии ("Целевой IRR: 20–25%", "Investment Period · Years 1–5" — PE-специфичные подписи прямо в разметке дашборда и capital calls). При появлении второго `asset_class` в системе (даже просто VC-фонда рядом с PE-фондом у того же GP) эти подписи должны браться из `fund.asset_class`, а не быть захардкожены в HTML — то же самое место, где уже сегодня live-считается lifecycle-бар (`updateLifecycleBar()` в `js/app.js`), должно ветвиться и по `operating_model`: для `open-end` фонда весь блок "Онбординг → First Closing → Инвестирование → Создание стоимости" не подходит по смыслу и должен заменяться на свой набор стадий (например "Launch → Open for subscriptions → Track record").

Практически: пункты меню тоже должны показываться/скрываться по `activeFund.assetClass`/`operatingModel` — тот же паттерн, что уже используется для скрытия `vault`/`portfolio`/`users` по правам (`js/app.js`, функция настройки видимости nav-item), просто ключ не право пользователя, а тип активного фонда.

---

## 5. Порядок работ (высокоуровнево, без оценки сроков)

1. **Chassis** — уже готов, трогать не нужно.
2. **Closed-end движок: Distributions + Waterfall + IRR/DPI/TVPI** — по `TZ_Distributions_and_Notifications.md`, строить сразу с полем `asset_class` на фонде (даже если первое время используется только значение `'pe'`) — это дешевле, чем потом разводить PE/VC по всей кодовой базе задним числом.
3. **VC как second asset_class** — расширение `portfolio` (cap table/раунды), переключение лейблов по `asset_class`, лёгкий IC.
4. **REIT как asset-модуль `properties`** — новая сущность параллельно `portfolio`, те же `capital_calls`/`distributions`, + FFO/AFFO/NOI.
5. **Hedge Fund как отдельный трек** — `operating_model = 'open-end'`, новые таблицы (§3.2), `performanceFeeEngine.js`, свой набор экранов дашборда/lifecycle. Не зависит от пп. 2–4 и может разрабатываться параллельно отдельной командой/веткой, если это станет коммерческим приоритетом раньше REIT.

---

## 6. Открытые вопросы (решить перед стартом каждого трека)

- Нужны ли SPV/co-investment vehicles (отдельные юрлица под одну сделку, вне основного фонда) — актуально в первую очередь для VC. Сейчас в модели не заложено.
- REIT — подтвердить, что речь о частном фонде недвижимости для квалифицированных инвесторов (описанная выше модель), а не о фонде, инвестирующем в публично торгуемые REIT-акции (это была бы совсем другая, гораздо более простая задача — просто позиции в бумагах, а не собственные объекты).
- Hedge Fund — нужны ли side pockets (изоляция неликвидных позиций внутри в остальном ликвидного фонда) и multi-class share structure (разные классы юнитов с разной комиссией) — это стандартные, но не всегда обязательные усложнения open-end движка; если не нужны с первой итерации — явно вынести за скобки MVP.
- Готовы ли вы вести несколько `asset_class` под одним тенантом одновременно (как сейчас мультифондовость для нескольких PE-фондов), или на старте достаточно одного `asset_class` на тенанта — это влияет на то, насколько рано нужно ветвить UI по фонду, а не по глобальной настройке компании.
