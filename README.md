# Turan Capital Fund CRM — Golden Leaves Ltd (GP)
**Version 6.9** · License: AFSA-A-LA-2024-0038 · Build: GL-CRM-PYRUS-TZ-009

---

## What's New in v6.9 — Role constructor, Workflow backend, security hardening

Three follow-on passes to v6.8's RBAC work.

### Dynamic role constructor
Permissions moved from hardcoded role-code checks in ~5 files into a `roles`
DB table (`server/db.js`) with 7 boolean capability flags (`internal`,
`manageUsers`, `manageRoles`, `accessFM`, `decideConflicts`, `authorICMemo`,
`riskVeto`) + a nullable `icSeat` enum. `requireAuth` resolves the caller's
permissions from this table on every request (`server/rolesRepo.js`,
`server/rolesMapping.js`) — a permission edit takes effect on the next
request, no re-login needed. New "Роли" tab in "Команда / Пользователи"
(`js/users.js`) lets the CEO create custom roles with a checkbox-driven
permission set and an IC-seat picker — a brand-new role works everywhere
in the app immediately, zero code changes. The 10 built-in roles are
`is_system=1`: code is immutable and the row is undeletable, but every
permission stays editable.

### Hybrid user deletion
`DELETE /api/users/:id` — hard-delete is only allowed for "empty" accounts
with no footprint in the audit trail (`server/userFootprint.js` checks
`ob_tasks.completed_by`, `capital_calls.created_by`, `restricted_list.added_by`,
`engagements.activated_by`, `ic_memos.author`, `documents.uploader`).
Anyone with real history gets a 409 pointing at the existing deactivate
flow instead.

### Workflow (согласования) — real backend
The approval-workflow engine (KYC CO→MLRO→CEO, IC deal review, Capital
Call and Subscription Agreement sign-off) was the last major module still
100% client-side. New `workflow_instances` table, `GET/POST /api/workflow`,
`PUT /api/workflow/:id` (approve/reject the current step — 403 unless the
caller's role matches, 409 on an already-resolved instance, 400 on a
rejection with no comment), `POST /api/workflow/:id/withdraw`. Step
templates are derived server-side (`server/wfDefinitions.js`) — a caller
can never hand itself every step's role by supplying its own `steps` array.

### Security hardening (from a full audit of the above)
- IC memo `PUT /api/ic-memos/:id` no longer merges the whole request body
  once a vote passes its legality check — a vote-caster could otherwise
  smuggle arbitrary field overwrites (status/resolution/amount) through.
  `status`/`resolution`/`quorumMet` are now derived server-side from the
  votes array, never trusted from the client.
- Chinese Wall (`accessFM`) is now enforced on `/api/lp`, `/api/deals`,
  `/api/portfolio`, `/api/capital-calls`, and `GET /api/ic-memos` — these
  were previously `requireInternal`-only, so an `accessFM=false` role
  (e.g. RM) could read the full LP register/deal pipeline/IC memos.
- Fixed a role-reassignment path that could leave a tenant with zero
  users able to manage users/roles (mirrors the existing self-deactivate
  guard).
- Fixed stored XSS in the Users/Roles admin UI — every admin-entered field
  (name, email, role code/label/icon/color) is now HTML-escaped before
  rendering.
- Self-service password change (`PUT /api/users/me/password`, "Сменить
  пароль" in the account menu) — previously only the CEO could reset
  another user's password; there was no way to change your own.
- Document uploads (`js/documents.js`) now actually persist via
  `POST /api/documents` with a server-stamped `uploader` — previously the
  upload button only mutated an in-memory array and never saved anything,
  so files disappeared on reload.

---

## What's New in v6.8 — Real Access Control

Replaced the old self-selectable role dropdown (`currentUserRole` used to be a
freely reassignable variable defaulting to `'CEO'`, never persisted) with real
login accounts and server-enforced authorization.

### Role catalogue (`server/roles.js` / `js/roles.js`)
Unambiguous codes, not abbreviations — `RISK_MANAGER` is a distinct code from
`RELATIONSHIP_MANAGER`, avoiding the RM/RM collision the old short labels had:
`CEO, CFO, CIO, RELATIONSHIP_MANAGER, COMPLIANCE_OFFICER, MLRO, ANALYST,
RISK_MANAGER, IC_INDEPENDENT, IC_LP_REP`. The last two are external IC voting
seats (Independent Member, LP Rep) — real accounts with restricted access,
not just text labels in `IC_ROLE_DEFS`.

### Backend enforcement (`server/auth.js`, `server/index.js`)
- `requireAuth` re-reads `role`/`active` from the `users` table on every
  request (not just the JWT claim) — a role change or deactivation takes
  effect on the user's very next request.
- `requireRole(...codes)` / `requireInternal` gate every route: bulk data
  routes (`/api/lp`, `/api/deals`, `/api/portfolio`, etc.) require an
  internal role; restricted-list/conflict-approval decisions require
  `COMPLIANCE_OFFICER`/`MLRO`/`CEO`; IC memo authorship requires
  `CEO`/`CFO`/`CIO`/`ANALYST`.
- IC memo voting (`PUT /api/ic-memos/:id`) is enforced per-seat: each of the
  4 IC seats maps 1:1 to a role (`server/icMemoMapping.js`'s
  `IC_SEAT_ROLE_CODES`) — you can only write your own seat's vote.
  `riskVeto`/`riskConclusion` require `RISK_MANAGER`.
- Chinese Wall (`server/chineseWall.js`) filters `GET /api/onboarding` and
  guards the ob-clients/ob-tasks/engagements write routes server-side, not
  just in the UI — RM never sees or can write FM-direction data via the API,
  even with devtools.
- Reopening a completed onboarding task is blocked for RM server-side
  (`PUT /api/ob-tasks/:id`), not just hidden in the UI.

### User management (`GET/POST/PUT /api/users`, CEO-only)
New "Команда / Пользователи" page (`js/users.js`) — create accounts,
change role/name, deactivate (no hard delete — this is an audit-trail
system; `active=0` revokes access immediately via the `requireAuth` re-check
above).

### Frontend
`currentUserRole` is now a read-only function backed by the logged-in
account (`getAuth().user.role`), not a mutable variable — it can no longer
be used to self-escalate. The sidebar avatar menu now shows the real
logged-in user and a working Logout (`apiLogout()`, previously defined but
never wired to any button).

### Not in this pass
`js/workflow.js`'s step-approval engine has no backend at all yet
(`workflowInstances` is still a local-only array) — its role checks now use
the real logged-in role instead of the fake dropdown, which is strictly
better than before, but aren't enforced server-side. Giving Workflow a real
backend (mirroring `ic_memos`/`conflict_approvals`) is a follow-up on the
scale of the onboarding migration, not a bolt-on to this pass.

---

## What's New in v6.7

### ✅ 1. Portfolio Module — Полный редизайн

#### Данные (`js/data.js`) — новая структура `portfolio[]`

3 полностью заполненных портфельных компании с богатыми вложенными данными:

| ID | Компания | Статус | Сектор |
|---|---|---|---|
| 1 | TechHub Almaty | Active | Технологии |
| 2 | MedPoint KZ | Active | Медицина |
| 3 | GrainTech Partners | Monitoring | АПК (просроченный платёж) |

Каждая компания содержит **6 вложенных разделов**:

| Раздел | Ключевые поля |
|---|---|
| `financials` | quarters[], revenue{plan,actual}, ebitda{plan,actual}, netProfit, employees, avgSalary, taxContrib, totalDebt, fundDebt, debtService, collateral, covenants[], overduePayment, overdueAmount, paymentSchedule[] |
| `monitoring` | lastVisitDate, frequency, meetings[{date,format,participants,points,decisions,actions[]}], reportReceivedDate, auditStatus, covenantViolations, riskLevel, riskComment |
| `documents` | driveUrl, files[{type,name,date,period,uploadedBy,expiryDate,status}] |
| `compliance` | programName, programType, subsidizedRate, grantAmount, grantConditions, programs[], reportingDeadlines[{program,deadline,description,done}], esg{jobsCreatedPlan,jobsCreatedActual,jobsPreservedPlan,jobsPreservedActual,womenLeadership,womenPct,regionType,environmentalNotes,socialImpact} |
| `exit` | exitType, plannedDate, targetValuation, prepProgress, checklist[{item,done}], buyers[{name,type,contact,status}], notes |
| `history` | [{type:'comment'\|'status'\|'doc', date, author, text}] |

Добавлен `portfolioIdCounter = 4`.

---

#### Карточки портфеля (`renderPortfolio()`)

Компактные карточки с:
- Цветная статусная полоса (Active=зелёный, Monitoring=жёлтый, Problem=красный)
- MOIC (автоматически из `value / invested`)
- Следующее действие + дата
- «Days since» — дней с последнего обновления
- Оранжевое предупреждение при просроченных платежах (`overduePayment`)

---

#### Portfolio Detail Modal (`#modal-port-detail`)

**6-вкладочный модал 1000px**, z-index 10400 (`#portDetailOverlay` на 10300):

**Вкладка 1 — Финансы:**
- 4 KPI-карточки: MOIC, Debt/EBITDA, DSCR, Просрочка
- Таблица план/факт по кварталам (Revenue + EBITDA + Net Profit + Сотрудники)
- 2 Chart.js bar-чарта (Revenue + EBITDA, план vs факт, уничтожение/создание по паттерну)
- Панель долга: кредит фонда, залог, статус, LTV
- 5 ковенантов с галочками ✓/✗
- График платежей с цветными бейджами (Оплачено/Ожидает/Просрочен)
- Форма ввода квартального отчёта (вручную, не PDF) — `savePortQuarterlyReport(id)`

**Вкладка 2 — Мониторинг:**
- 3 KPI: последний визит, следующее мониторинг, дней с последнего отчёта
- Настройки: частота мониторинга, дедлайн отчёта, уровень риска, нарушения ковенантов
- Журнал встреч с actions per meeting
- Форма добавления встречи → автоматически создаёт задачу в `todayTasks[]`

**Вкладка 3 — Документы:**
- Ссылка на Google Drive папку
- Чеклист обязательных документов (6 видов) с badges состояния + авто-предупреждение при истечении за 30 дней
- Список всех документов с датами, периодами, загрузившим
- Форма добавления → авто-задача при expiryDate ≤ today+30d

**Вкладка 4 — Соответствие:**
- Информация о программе (название, тип, субсидированная ставка, грант)
- Мульти-выбор программ (Damu, KAZAKH INVEST, ESG Program, Baiterek, Sovereign Fund)
- Отчётные дедлайны с 14-дневным предупреждением + галочки выполнения
- ESG-блок: рабочие места (план/факт), сохранённые рабочие места, женщины в руководстве %, тип региона, экологические заметки, соц. импакт

**Вкладка 5 — Стратегия выхода:**
- Параметры выхода: тип, плановая дата, целевая оценка
- SVG круговой прогресс-ринг (% завершения чеклиста)
- Чеклист выхода с галочками
- Список потенциальных покупателей (add/delete)
- Заметки

**Вкладка 6 — История:**
- Timeline-лента событий (comment/status/doc) с иконками
- Форма добавления комментария

---

#### Автоматизация

| Триггер | Действие |
|---|---|
| `paymentSchedule[].status='Просрочен'` | `portAutoStatus()` → Monitoring или Problem |
| Просрочка >30 дней | Статус → Monitoring (жёлтый) |
| Просрочка >90 дней | Статус → Problem (красный) |
| `portChangeStatus(id, 'Problem')` | Создаёт urgent task в `todayTasks[]` |
| `savePortMeeting()` | Создаёт follow-up task в `todayTasks[]` |
| `addPortDoc()` с `expiryDate ≤ today+30d` | Создаёт предупреждение-задачу |
| `reportingDeadlines[].deadline ≤ today+14d` | Жёлтый badge + предупреждение |

---

#### Helper-функции (`js/app.js`)

15 новых функций:

| Функция | Описание |
|---|---|
| `portAutoStatus(p)` | Авто-статус из paymentSchedule |
| `portStatusColor(s)` / `portStatusLabel(s)` | Цвет и RU-лейбл статуса |
| `portMOIC(p)` | value / invested |
| `portDocBadge(p)` | Кол-во недостающих обязательных документов |
| `daysSince(dateStr)` | Дней от даты до сегодня |
| `portChangeStatus(id, status)` | Смена статуса + urgent task при Problem |
| `portNestedField(id, section, field, value)` | Обновление вложенного поля |
| `portNestedNestedField(id, section, subsection, field, value)` | Двойное вложение |
| `portESGField(id, key, value)` | ESG поля |
| `savePortQuarterlyReport(id)` | Сохранение квартального отчёта |
| `savePortMeeting(id)` | Сохранение встречи + auto-task |
| `addPortDoc(id)` / `deletePortDoc(id, i)` | Документы + auto-task |
| `togglePortProgram(id, prog)` | Мульти-выбор программ |
| `portToggleReportDL(id, i, checked)` / `addPortReportDeadline(id)` | Дедлайны отчётности |
| `portExitCheck(id, i, checked)` | Чеклист выхода |
| `addPortBuyer(id)` / `deletePortBuyer(id, i)` | Покупатели |
| `addPortHistoryComment(id)` | История/комментарии |

---

#### `savePortfolio()` — обновлён

Создаёт полный объект с **6 вложенными разделами** и всеми дефолтными значениями массивов (quarters, paymentSchedule, meetings, files, reportingDeadlines, esg, checklist, buyers, history).

---

### ✅ 2. Company Portal (`portal.html`) — создан

Автономный портал самообслуживания для портфельных компаний (49 KB):

**Аутентификация:**
- Вход по БИН + пароль
- Демо-доступ: БИН `180340021847` / пароль `demo123` (TechHub Almaty)
- `COMPANIES{}` — словарь с данными 3 компаний

**5 вкладок:**

| Вкладка | Описание |
|---|---|
| Обзор | KPI карточки (Инвестировано, Оценка, MOIC, Доля фонда) + ковенанты + описание деятельности |
| Финансовый отчёт | Форма ручного ввода квартального отчёта (Revenue, EBITDA, Net Profit, Cash Flow, Сотрудники, Зарплата, Налоги) + журнал поданных отчётов |
| Документы | Список обязательных документов с статусами + форма добавления ссылки + журнал всех загруженных документов |
| График платежей | Таблица плановых платежей с кнопкой «Подтвердить оплату» → форма с авто-заполнением суммы/даты |
| ESG | Форма ввода ESG показателей (рабочие места, сохранённые места, женщины в руководстве, зарплата, налоги, программы, экология, соц. импакт) + журнал |

**Технические детали:**
- In-memory state: `finReports[]`, `uploadedDocs[]`, `esgReports[]`, `payConfirms[]`
- Toast-уведомления при успешных действиях
- `submitDocument()` автоматически отмечает обязательный документ как выполненный если название совпадает
- `prefillPayment(amount, date)` → авто-заполняет форму подтверждения оплаты
- Тёмная тема (consistent with main CRM)
- Нет зависимостей от `app.js` / `data.js` — полностью автономный файл

---

### ✅ 3. `index.html` — добавлен Portal overlay

```html
<!-- Portfolio Detail Overlay (z-index:10300) -->
<div id="portDetailOverlay" onclick="closePortfolioModal()" ...></div>

<!-- Portfolio Detail Modal (z-index:10400) -->
<div id="modal-port-detail" ...>
  <div id="portDetailContent" ...></div>
</div>
```

Z-index стек (полный):
- Deal overlay: 10100 / Deal modal: 10200
- Port overlay: 10300 / Port modal: 10400
- Toast: 99990

---

### ✅ 4. Playwright — 0 ошибок ✅

- `index.html`: 0 console errors ✅
- `portal.html`: 0 console errors ✅ (только безвредный DOM password-field info)

---

## What's New in v6.6

### ✅ 1. Стадии компании — 5 PE-специфичных

Заменены VC-стадии на 5 стадий, специфичных для PE-фонда:

| Было | Стало |
|---|---|
| Series A / Series B / Seed / Growth / Bridge | `Growth Stage` / `Expansion` / `Scale-up` / `Distressed/Turnaround` / `Development/Construction` |

Обновлено: select в модале сделки + `companyStage` в `saveDeal()` (default: `'Growth Stage'`) + все 9 сделок в `data.js`.

---

### ✅ 2. Data Room URL — новое поле в DD-вкладке

Синяя выделенная панель в вкладке Due Diligence:
- Иконка `fa-database` + label «Data Room — ссылка для DD»
- Input для URL + кнопка «Открыть» (только если URL заполнен)
- Поле `dataRoomUrl: ''` добавлено в `saveDeal()` и все 9 сделок

---

### ✅ 3. Документы — удаление версий и подписанных документов

| Элемент | Функция |
|---|---|
| Версии Term Sheet | `deleteTSVersion(id, i)` — с confirm диалогом |
| Подписанные документы | `deleteSignedDoc(id, i)` — с confirm диалогом |

Красные кнопки `fa-trash` добавлены в каждую строку.

---

### ✅ 4. Новый раздел «Прочие документы»

В вкладке Документы добавлен свободный раздел:
- `addOtherDoc(id)` — добавляет пустую строку {name, url}
- `dealOtherDocName(id, i, val)` / `dealOtherDocUrl(id, i, url)` — inline редактирование
- `deleteOtherDoc(id, i)` — удаление строки с confirm
- `otherDocs: []` добавлено в `saveDeal()` и все 9 сделок

---

### ✅ 5. Удалена вкладка «Переговоры»

Было: 6 вкладок (Обзор, Документы, IC, DD, Переговоры, История)
Стало: **5 вкладок** (Обзор, Документы, IC, Due Dil., История)

Функция-обработчик переименована в `negotiation_DISABLED` (dead code, не вызывается).

---

### ✅ 6. IC Rejection Block — всегда видим

Блок отклонения IC теперь **всегда отображается** (не только при `stage === 'Отклонена IC'`):

- Красная граница при `stage === 'Отклонена IC'` или `icDecision === 'Отклонено'`
- Серая граница в остальных случаях
- **5 полей:** Причина отказа (select: Рынок/Команда/Финансы/Правовые/Оценка/Стратегия), Детальный комментарий (textarea), Возможность вернуться (select), Дата follow-up (date), Кто принял решение (input)

---

### ✅ 7. `saveDeal()` — дефолты обновлены

- `companyStage: 'Growth Stage'` (было `'Growth Stage'`)
- `dataRoomUrl: ''` — новое поле
- `otherDocs: []` — новый массив
- Все остальные 40+ полей сохранены

---

### ✅ 8. `data.js` — 9 сделок обновлены

Все 9 сделок получили:
- Новый `companyStage` (маппинг VC→PE стадии)
- `dataRoomUrl: ''`
- `otherDocs: []`

Маппинг стадий:
| Старое | Новое |
|---|---|
| Series A | Growth Stage |
| Series B | Development/Construction или Scale-up |
| Growth | Expansion |
| Seed | Distressed/Turnaround |

---

## What's New in v6.5

### ✅ 1. Deal Pipeline — Variant A (полный рефакторинг)

**Deal cards** (`dealCard`) переписаны с расширенным отображением:
- Компания, сектор · страна · стадия компании
- Сумма $M · тип · pre-money
- IC badge + теги (до 3), ответственный, счётчик комментариев, дата обновления
- Жёлтая полоска «Следующий action» с датой дедлайна
- Click → `openDealDetailModal(id)` → 6-вкладочный модал

**Deal Detail Modal** (`#modal-deal-detail` + `#dealDetailOverlay`):
- Sticky header: название, стадия, приоритет, прогресс-бар
- Dropdown смены стадии + кнопка закрытия
- **5 вкладок** (Переговоры удалена в v6.6):

| Вкладка | Содержимое |
|---|---|
| Обзор | Страна, companyStage, dealSource, контакты, revenue, roundSize, checkSize, ответственный, описание, теги, nextAction, founderContacts |
| Документы | pitchDeck, icMemo, icMinutes URL; Term Sheet версии (add/preview/delete); Подписанные документы (add/preview/delete); Прочие документы (add/edit/delete); wireConfirmUrl |
| IC | preMoney, instrument, checkSize, coInvestors, icDecision, icDate, голосование IC, ключевые риски (add/edit/remove), блок отклонения (всегда видим, 5 полей) |
| Due Diligence | ddDeadline, Data Room URL, юрист фонда; 4 DD-блока с `cycleDDStatus`; Red Flags; консультанты |
| История | Список комментариев (reversed) + форма добавления нового |

**12 helper-функций:** `dealField`, `dealMoveStage`, `dealAddRisk`, `dealRisk`, `dealRemoveRisk`, `cycleDDStatus`, `dealAddComment`, `dealAddMeeting`, `addTSVersion`, `dealTSVersionUrl`, `addSignedDoc`, `dealSignedDocUrl`, `addFounderContact`

---

### ✅ 2. `saveDeal()` — полная инициализация 40+ полей

При создании новой сделки через «Новая сделка» теперь генерируется полный объект deal со всеми полями:
- Использует `dealIdCounter` (++, не `Date.now()`)
- `description` вместо `comment`
- Все массивы: `tags[]`, `icRisks[]`, `icVotes[]`, `ddLegal[]`, `ddFinancial[]`, `ddTech[]`, `ddCommercial[]`, `ddConsultants[]`, `ddRedFlags[]`, `tsVersions[]`, `signedDocsUrls[]`, `founderContacts[]`, `negMeetings[]`, `negDisputedItems[]`, `negBlockers[]`, `comments[]`
- Новая сделка открывается в Deal Detail Modal с тем же 6-вкладочным интерфейсом

---

### ✅ 3. `filterDeals()` — расширенный поиск

Поиск теперь ищет по: `company`, `sector`, `description`, `country`, `tags[]` (через `.some()`).

---

### ✅ 4. `data.js` — 9 сделок с полной структурой

Все 9 сделок (id: 1–9) имеют 40+ полей, включая:
- IC голосования, ключевые риски, DD-блоки с itemized статусами
- Term Sheet версии, подписанные документы, лог встреч
- Контакты основателей, KPI на 6/12 месяцев
- Данные об отклонении (для `Отклонена IC`)
- `dealIdCounter = 10`

---

## Live URL
`https://540f2a53-ff3e-4e4f-bc23-479e385ac3ef.vip.gensparksite.com/`

---

## What's New in v6.4

### ✅ 1. Удалена кнопка «Уведомить всех LP» из CC Detail

Footer `openCCDetail` — убрана кнопка `generateCCNoticeAll`.
Остались: «Закрыть CC (все оплатили)» + «Закрыть».
Индивидуальная кнопка **Notice** в каждой строке LP сохранена.

---

### ✅ 2. Итоговая строка под Журналом Capital Calls

В модале `openCapitalAccountStatement` после таблицы транзакций добавлена сводная панель **4 карточки**:

| Карточка | Значение | Цвет |
|---|---|---|
| Вызвано (Called) | `totalCalled` | Оранжевый |
| Оплачено (Paid) | `totalPaid` | Зелёный |
| Не оплачено | `totalCalled − totalPaid` | Красный если > 0, иначе зелёный |
| Остаток Commitment | `unfunded` | Фиолетовый |

---

### ✅ 3. Individual Capital Call — CC на конкретного LP

**Проблема:** Если один LP не оплатил CC пока все остальные заплатили — не было возможности создать отдельный вызов только для него.

**Решение:**

#### Кнопка «+ Доп. CC» в таблице LP в CC Detail
- 10-я колонка «Доп. CC» в `openCCDetail`
- Кнопка отображается только для LP со статусом **Pending**
- `onclick="openIndividualCCModal(lpId)"`

#### `openIndividualCCModal(lpId)` — форма
- Использует тот же `modal-cc-new` (не требует новых HTML-элементов)
- Показывает карточку LP: Commitment / Unfunded / **Задолженность** (красным если > 0)
- Список неоплаченных CC (`pendingItems`) с предупреждением
- Поля: сумма (pre-filled = задолженность или 5% commitment), тип, цель, bankRef, notes
- Live `%` от Commitment при вводе суммы
- По умолчанию назначение: «Погашение задолженности по предыдущим Capital Calls»

#### `saveIndividualCC(lpId)` — сохранение
- Создаёт CC с суффиксом **`-IND`** в номере: `CC-2026-004-IND`
- `lineItems` содержит только одного LP
- Флаг `individualLP: true` на объекте CC
- Валидация: сумма не превышает Commitment LP
- Обновляет `lp.calledAmount`

#### Визуальные маркеры
- В таблице Журнала CC: оранжевый badge **IND** рядом с типом
- В шапке `openCCDetail`: оранжевый badge **Individual LP** рядом со статусом

#### Исправление
- Удалён дублирующий `</td>` в строке LP lineItems таблицы (баг предыдущей сессии)

---

## What's New in v6.3

### ✅ Capital Account Statement PDF — полная сводка лицевого счёта

PDF переработан с нуля — теперь содержит **5 разделов** с полными данными из модала:

| Раздел | Содержание |
|---|---|
| **1. LP Profile / Идентификация** | name, type, lpType, country, address, taxId, contact, phone, email, professionalClient, admissionDate, ownershipPct |
| **2. Account Summary** | Commitment, Called, Paid, Unfunded, Distributions, NAV/unit, Call Rate, Fund Term Remaining, **Net Position** |
| **Progress Bar** | Визуальный градиентный прогресс-бар called vs remaining |
| **3. KYC / AML / Compliance** | kycStatus (с цветом), kycDate, kycNextReview, riskRating (цветной), afsaNotified, lpacMember |
| **4. Transaction Log** | 9 колонок: CC №, Notice Date, Payment Date, Purpose, Called, Paid, Wire Ref, AML (✓/✗/Pending), Status (✓ Paid / ○ Pending) + tfoot с AML-счётчиком |
| **5. Signature Block** | Блок подписи GP CEO + поле для печати (М.П.) |

**Технические улучшения:**
- CSS секции с чёткими `border-left` заголовками
- CONFIDENTIAL badge (красный) в шапке
- Документ ID: `CAS-LP-YYYY-NNN-YYYYMMDD`
- Net Position строка в summary (выделена синим фоном)
- AML счётчик в tfoot: `N из M AML ✓`
- `pagebreak` перед разделом 4 для корректного PDF
- Окно открывается 1020×820 (было 960×740)
- Footer: BIN + Bank + BIC + IBAN USD + IBAN KZT + дата генерации

---

## What's New in v6.2

### ✅ Capital Call Notice — per-LP и batch отправка

#### В модале `openCCDetail` (Capital Call Detail)
| Изменение | Описание |
|---|---|
| Новая колонка **Notice** | Добавлена 9-я колонка в таблицу LP line items |
| Кнопка **📨 Notice** (в строке) | `generateCCNotice(ccId, lpId)` — CC Notice для конкретного LP → print/PDF |
| Кнопка **📨 Уведомить всех LP** (footer) | `generateCCNoticeAll(ccId)` — последовательно открывает окна для всех LP с задержкой 400ms |
| Заменён stub-тост | Старый `showToast(...)` заменён на реальный вызов `generateCCNoticeAll` |
| `colspan` footer исправлен | 8 колонок → 9, `colspan="5"` в tfoot |

### ✅ LP Welcome Letter — документ о принятии в фонд

- Кнопка **Welcome Letter** в footer LP Detail Modal
- `generateLPWelcomeLetter(lpId)` — двуязычное (EN/RU) официальное письмо
- Содержит: реквизиты GP, таблицу Key Terms, список обязанностей LP, блок подписей
- Генерация: `window.open()` → `document.write(html)` → `setTimeout(print, 600)`
- Данные из `FUND_PARAMS`: `gpCEO`, `gpBIN`, `gpIBANusd`, `gpBankName`, `managementFee`, `preferredReturn`, `carriedInterest`, `fundTerm`

### ✅ Capital Account Statement — скачать PDF

- Кнопка **📄 Скачать PDF** (зелёная) в footer модала Capital Account Statement
- `printCapitalAccountStatement(lpId)` — чистая print-версия с Arial шрифтом
- Включает: полную историю транзакций, сводку (Commitment / Called / Paid / Balance), юридический дисклеймер
- Использует `capitalCallsLog[]` для полного журнала

### ✅ Исправление SyntaxError

- Удалён лишний `}` после `closeCapitalAccountStatement()` (строка ~934 в `lp-register.js`)
- Playwright: **0 ошибок ✅**

---

## What's New in v6.1

### ✅ Реестр договоров — полный рефакторинг

#### Таблица
| Колонка | Описание |
|---|---|
| ID | `engId` + `contractNum` под ним |
| Клиент | Имя + RM |
| Направление | Цветной badge: **FM · LP** (синий) / **CF&A** (фиолетовый) + тип услуги |
| Статус | Badge Active/Draft/Completed/Terminated + дата активации если есть |
| Подписан | `signedDate` → `date` → `—` |
| Сумма / Fee | `feeAmount` + тип fee |
| Инвойс. / Оплачено / Остаток | финансы |
| Документ | Кнопка 📄 (фиолетовая) → `_obOpenPreviewModal` — только если есть `lpaUrl`/`contractUrl` |

#### Фильтры
- Поиск по клиенту / договору / engId
- Фильтр по статусу (Active / Draft / Completed / Terminated)
- Фильтр по направлению (CF&A / FM)
- Кнопка «Сбросить» при активных фильтрах
- Счётчик `N из M`

#### Кнопка «Новый договор» — **удалена**
Договоры создаются автоматически: из task 4.1 (Engagement Letter / SA) и task 5.1 (Activation).

---

### ✅ Task 5.1 Activation → Реестр договоров (CF&A + FM)

**Проблема была:** код только обновлял существующую запись из 4.1. Если 4.1 была пропущена — ничего не происходило.

**Теперь:** fallback-создание записи при отсутствии, плюс обогащение новыми полями:

| Поле | CF&A 5.1 | FM 5.1 |
|---|---|---|
| `status` | → `Active` | → `Active` |
| `activationDate` | `f_activationDate` | `f_activationDate` |
| `activatedBy` | `f_activatedBy` | `f_activatedBy` |
| `signedDate` | `f_contractDate` | `f_contractDate` |
| `contractUrl` | `f_contractUrl` | — |
| `lpaUrl` | — | `f_lpaUrl` |
| `amendments` | `f_amendments` | `f_amendments` |
| `lpSignedDate` | — | `f_lpSignedDate` |
| `capitalCallDate` | — | `f_capitalCallDate` |
| `direction` | `CF&A` | `FM` |

---

### ✅ Engagement Modal — обогащён

- **Динамические строки** — появляются только если поле заполнено: `activationDate`, `activatedBy`, `LP подписал`, `Первый CC`
- **Блок документа** (фиолетовый) — LPA / договор с кнопкой «Открыть» → `_obOpenPreviewModal`
- **Раздел Доп. соглашений** — таблица: номер · дата · описание · ссылка

---

### ✅ Z-index всплывающих окон — полный аудит

| Элемент | Было | Стало |
|---|---|---|
| `.task-overlay` | 1000 | **10100** |
| `.task-modal-wide` | 1002 | **10200** |
| `#modal-lp-new` etc | 1001 | **10200** |
| named overlays | 1000 | **10100** |
| `modal-ob-new` | 10000 | **10200** |
| **toast** | **999** ← под модалами | **99990** |
| `_obOpenPreviewModal` | 99999 | без изменений |

**Toast теперь всегда поверх всех модалов** — виден при любом состоянии UI.

---

## What's New in v6.0

### ✅ LP Register — Auto-Registration from FM Onboarding
- После сабмита FM Task 5.1 (LP Activation) LP **автоматически** добавляется в `lpRegister`
- `actTask` — третий параметр `registerLPFromOnboarding(client, saTask, actTask)`
- **Auto-navigate**: через 900 мс SPA переходит на страницу LP Register
- **Highlight scroll**: новая строка подсвечивается зелёным + плавный скролл
- **Root cause fix**: модал клиента закрывается (`closeObClientModal()`) перед `navigateTo` — иначе перекрывал LP Register страницу

### ✅ LP Register Table — data-lp-id + LPA button
- `<tr data-lp-id="${lp.id}">` — адресация строки при highlight
- Actions: фиолетовая кнопка LPA (только если `lp.lpaUrl` задан)

### ✅ LP Detail Modal — LPA URL + Contract №
- Блок «LP Agreement (LPA)» с кнопкой «Открыть LPA»
- Footer: кнопка «Открыть LPA» рядом с Capital Account Statement

### ✅ SA PDF Banner — кнопка «SA PDF» (оранжевая, fa-file-contract)

---


## What's New in v5.9

### ✅ CF&A Task 5.1 — Contract Link + Amendments + Activation
- **4-section form**: Contract Key Terms · Document Link (URL) · Amendments · Activation
- `f_contractUrl` — URL поля для ссылки на подписанный PDF договор
- `obViewContract()` — iframe preview modal с Google Drive auto-conversion (`/view` → `/preview`) + X-Frame-Options fallback
- `_obOpenPreviewModal(previewUrl, originalUrl)` — reusable modal с кнопкой «Открыть в новой вкладке»
- Dynamic amendments: `_obAmendments[]` runtime array, `obAddAmendment(taskId)` / `obRemoveAmendment(idx)` / `_obRenderAmendments(taskId)`
- `_obRenderSavedAmendments(arr, isCompleted)` — helper для рендера сохранённых ДС в template literal
- `collectFormData` special case `'activation'` → serializes `_obAmendments` to JSON
- `submitObTask` CF&A activation: contractUrl + amendments → engagement record → status `Active`
- Completed banner: зелёная кнопка «Открыть договор» через `obViewContractFromTask(taskId)`

### ✅ FM Task 4.1 — Subscription Agreement PDF (замена Word)
- `obGenerateSubscriptionAgreement` полностью переписана: `window.open()` + `window.print()` (PDF via browser print)
- Двуязычный EN/RU формат (bilingual two-column table), 14 секций, Appendix A (3.1) + Appendix B (3.2)
- Golden Leaves реквизиты из `FUND_PARAMS`: BIN, IBAN KZT/USD, Bank, BIC, адрес, CEO
- LP CEO/Title/Address/Bank details — ручной ввод через форму (f_lpCEO, f_lpSignerTitle, f_lpAddress, f_bankName...)
- **Completed banner**: кнопка «SA PDF» (оранжевый, fa-file-contract) вместо старого «Скачать Word»

### ✅ FM Task 5.1 — LP Activation (зеркало CF&A 5.1)
- **4-section form** через `_obBuildFmActivationSections()` helper (строковая конкатенация, без вложенных backtick'ов):
  - Секция 1: f_lpaUrl + `obViewLpaContract()` preview button
  - Секция 2: f_contractNum, f_contractDate, f_contractExpiry, f_commitmentConfirmed, f_lpSignedDate, f_capitalCallDate, f_capitalCallSchedule
  - Секция 3: Amendments (f_amendments, reuse `_obRenderSavedAmendments` + obAddAmendment/obRemoveAmendment)
  - Секция 4: f_activationDate, f_activatedBy, f_docsVerified, f_activationNotes
- `obViewLpaContract()` — reads `f_lpaUrl` input, Google Drive auto-conversion, iframe preview
- `obViewLpaFromTask(taskId)` — reads from saved `formData.f_lpaUrl` for completed banner
- `submitObTask` FM activation: lpaUrl + amendments + key LPA params → SA engagement record → `Active`
- `client.lpaUrl` stored for quick banner access
- Completed banner: зелёная кнопка «Открыть LPA» через `obViewLpaFromTask(taskId)`

### ✅ FUND_PARAMS — полные реквизиты Golden Leaves
```js
gpCEO: 'Омирсериков Г.М.', gpBIN: '201040900197',
gpIBANkzt: 'KZ468562203110674595', gpIBANusd: 'KZ29 8562 2032 1183 5910',
gpBankName: 'АГФ АО «Банк Центр Кредит»', gpBIC: 'KCJBKZKX',
gpAddress: 'Z05T8M2, г. Нур-Султан, район Есиль, ул. Гейдар Алиева 1',
preferredReturn: 9  // скорректировано с 8% → 9% per LPA Section 12.3
```

---

## What's New in v5.7

### ✅ Task 2.2 — PDF Export (Client Due Diligence Outcome Form)

**`obGenerateDDReport(taskId)`** — полный PDF-отчёт на английском языке:

- **Кнопка "Сохранить PDF"** появляется только на **выполненной** задаче `dd_outcome` (Task 2.2) в баннере completed
- Открывает `window.open()` с форматированным HTML → автоматически вызывает `window.print()` → пользователь сохраняет как PDF

**Структура документа:**
| Раздел | Содержимое |
|--------|-----------|
| Header | "CLIENT DUE DILIGENCE OUTCOME FORM" · Ref `DD-YYYY-NNN` · Дата · Статус |
| Section 1 | Corporate / LP Identification (имя, тип, классификация, верификация) |
| Section 2 | Sanctions Screening — UN, OFAC, EU, UK (OFSI) по отдельности + итог |
| Section 3 | PEP Screening — клиент/LP + директора/UBO |
| Section 4 *(FM only)* | Source of Funds / Wealth Verification |
| Section 4/5 | Adverse Media Check |
| Section 5/6 | Risk Rating Table — 5 категорий с цветовым кодом |
| Section 6/7 | Conclusion — цветной блок (зелёный=Approve / красный=Reject / жёлтый=EDD) |
| Comments | Additional Comments / Observations (из `f_coComment`) |
| Signatures | Blank signature line + initials box + printed name + date line для CCO и MLRO |

**Особенности:**
- Английский язык в PDF, русские метки в UI формы
- `@media print` CSS: корректная печать, скрытие кнопки Print
- Физическая подпись + инициалы — ставятся вручную после распечатки
- Номер документа генерируется автоматически: `DD-{year}-{taskId:03d}`

### ✅ Обновлена форма dd_outcome (Task 2.2)

- **Заключение**: билингвальные опции — `'Одобрить — Approve'`, `'Отказать — Reject'`, `'Расширенная проверка (EDD)'`
  - Routing-логика (`.includes('Отказать')`, `.includes('EDD')`) продолжает работать корректно
- **Поле комментария**: переименовано в "Additional Comments / Observations" + подсказка "(будет включён в PDF-отчёт)"
- **Блок подписей**: переименован "Имя CCO" / "Имя MLRO" с примечанием "физическая подпись ставится вручную после печати"
- Оба поля обёрнуты в информационный блок `rgba(59,130,246,0.06)`

---

## What's New in v5.6

### ✅ Исправлен фильтр "Просроченных задач" (KPI card → board/list)
- **Проблема**: клик на карточку "Просроченных задач (6)" устанавливал `obStatusFilter='Delayed'`, что проверяло `client.onboardingStatus === 'Delayed'` — но клиенты с просроченными задачами имеют статус `'On Track'` или `'At Risk'`, не `'Delayed'`
- **Исправление**: новый специальный фильтр `__overdue__` — проверяет наличие хотя бы одной задачи с `status='open'` и `dueDate < today` через `obTasks.some()`
- KPI-карточка теперь корректно подсвечивается красной рамкой при активном фильтре
- В выпадающем списке статусов добавлена опция **⏰ С просроченными задачами**
- Фазовая доска и табличный реестр показывают ровно тех клиентов, у которых реально есть просроченные задачи

---

## What's New in v5.5

### ✅ Редактирование выполненных задач онбординга
- На любой выполненной задаче (статус `completed`) появляется кнопка **✏️ Редактировать**
- Доступно для ролей: CEO, CO (Compliance Officer), MLRO, Analyst
- **RM не может** редактировать выполненные задачи (блокировка по роли)
- При нажатии: snapshot предыдущих данных сохраняется в `task.previousFormData`, статус возвращается в `open`, форма открывается в режиме редактирования
- После повторного завершения (`submitObTask`) — стандартная логика routing/unlock

### ✅ Удалены все старые модули (v5.5 clean-up)
Удалены страницы и nav-пункты, заменённые новыми модулями:

| Удалено | Заменено на |
|---------|-------------|
| `page-onboarding` + «Онбординг LP» nav | `page-ob-clients` (FM + CF&A) |
| `page-kyc` + «KYC / AML» nav | KYC-формы в onboarding tasks 2.1/2.2 |
| `page-capitalcalls` (старый) | `page-lp-capital-calls` (новый модуль) |
| `page-distributions` (статичный) | `page-distributions` (renderDistributionPage) |
| `page-reports` + «Отчёты LP» nav | Capital Account Statement в LP Register |
| `page-lpreports` + «LP Выписки» nav | `openCapitalAccountStatement()` в lp-register.js |
| `page-clients` + «CF&A Pipeline (архив)» | `page-ob-clients` CF&A-вкладка |

---

## What's New in v5.4

### ✅ LP Register + Capital Call Module + Unfunded Commitment Tracking

Три взаимосвязанных блока по Constitution §3.8, §3.9 — полный операционный цикл фонда после onboarding.

---

#### 📋 LP Register (`js/lp-register.js` → `page-lp-register`)

**Официальный Реестр ограниченных партнёров** по Constitution §3.8.2:

| Поле | Описание |
|------|----------|
| `registerId` | LP-YYYY-NNN — уникальный номер в реестре |
| `name`, `type`, `lpType` | ФИО/наименование, тип (Individual/Corporate), категория (HNWI/Institution/Family Office/Corporate) |
| `commitment` | Общая сумма обязательства (USD) |
| `calledAmount` | Вызвано к уплате (accumulated capital calls) |
| `paidAmount` | Фактически получено |
| `distributions` | Выплаченные дистрибуции |
| `fundClass` | Класс паёв (A/B/C/Founder) |
| `ownershipPct` | Доля в фонде (%) — пересчитывается при каждом добавлении LP |
| `professionalClient` | Deemed / Assessed Professional Client (AFSA COB Rules) |
| `kycStatus` | Одобрен / Одобрен (EDD) / В процессе |
| `kycNextReview` | Авто-расчёт: Low=24мес, Medium=12мес, High=6мес |
| `riskRating` | Low / Medium / High |
| `admissionDate` | Дата официального вступления LP |
| `saNumber` | Номер Subscription Agreement |
| `afsaNotified` | Уведомлён ли AFSA (обязательно если ownershipPct > 20%) |
| `lpacMember` | Участник LPAC (авто: commitment ≥ $3M) |
| `status` | Active / Exited / Suspended |
| `obClientId` | Ссылка на клиента из onboarding (если создан через активацию) |

**Функции страницы:**
- AFSA Custodian Trigger алерт (LP count ≥ 20 или AUM ≥ $50M)
- AFSA уведомление алерт (LP с долей >20% без уведомления)
- 4 KPI-карточки: Active LP, Total Commitment, Called, Unfunded
- Fund Commitment Progress Bar (Called / Total Commitment)
- Таблица с KYC-сроками, risk-badges, AFSA-статусом, unfunded per LP
- `openLPDetail(id)` → детальный модал: Capital Account + CC History
- `openCapitalAccountStatement(id)` → официальная выписка (Capital Account Statement)
- `markAfsaNotified(id)` → помечает AFSA уведомлённым
- `openNewLPModal()` → форма добавления LP с валидацией ($500K minimum, $50M cap)
- `recalcOwnershipPcts()` → пересчёт % после добавления LP

---

#### 💰 Capital Calls Module (`page-lp-capital-calls`)

**Журнал Capital Call уведомлений** по Constitution §3.9.1:

| Поле | Описание |
|------|----------|
| `ccNumber` | CC-YYYY-NNN |
| `noticeDate` | Дата уведомления |
| `paymentDate` | Дата платежа (+10 рабочих дней авто-расчёт) |
| `totalAmount` | Общая сумма CC |
| `pctOfCommit` | % от Commitment (pro-rata база) |
| `purpose` | Цель (Investment / Management Fee) |
| `managementFee` | bool — флаг Management Fee call |
| `lineItems[]` | Pro-rata строки по каждому LP |
| `lineItems[].paid` | Фактически получено от LP |
| `lineItems[].amlOk` | AML входящего платежа (отправитель = KYC) |
| `lineItems[].wireRef` | Wire reference для аудита |

**Функции:**
- Overdue Alert (дата платежа прошла, статус Pending)
- 4 KPI: всего CC, вызвано, Management Fee, просроченных
- Таблица с цветовой индикацией Paid/Unpaid/Overdue
- `openCCDetail(id)` → детальный модал с pro-rata таблицей по LP
- `markLPPayment(ccId, lpId)` → получение платежа от LP + обновление LP Register
- `completeCCIfAllPaid(ccId)` → закрытие CC если все оплатили
- `openNewCCModal()` → форма нового CC с live pro-rata preview
- `addBusinessDays(date, n)` → расчёт +10 р.д. для paymentDate
- `updateCCProRata()` → live пересчёт при изменении % в форме

---

#### 📊 Unfunded Commitment Tracking

- Сводная таблица в нижней части `page-lp-capital-calls`
- Per-LP: Commitment / Called / Paid / Unfunded / Call Rate progress bar / %
- Footer ИТОГО по всем активным LP
- Клик по строке → `openLPDetail()` 

---

#### 🔗 Auto-registration от Onboarding Activation

```javascript
// В submitObTask(), после client.activated = true (FM direction):
if (client.direction === 'FM' && typeof registerLPFromOnboarding === 'function') {
  const saTask = obTasks.find(t => t.clientId === client.id && t.formKey === 'subscription_agreement');
  registerLPFromOnboarding(client, saTask);
}
```

`registerLPFromOnboarding(client, saTask)`:
- Берёт `client.commitment`, `saTask.formData.f_fundClass`, `f_subNum`
- Определяет `kycNextReview` по riskRating из задачи 2.2
- Авто-расчёт `ownershipPct`, `lpacMember` (≥$3M)
- Проверка `afsaNotified` (>20% → toast-предупреждение)
- Duplicate guard по `obClientId`
- Вызывает `recalcOwnershipPcts()` для пересчёта всех LP

---

#### 📈 Dashboard Widget — LP Register & Capital Calls

```html
<div id="dashLPWidget"></div>  <!-- в page-dashboard -->
```

`renderDashboardLPWidget()`:
- 3 mini-KPI: Active LP / Total Commitment + Unfunded / Pending CC
- Capital Called progress bar
- 4 LP quick-list (клик → openLPDetail)
- KYC Due Soon алерт (60 дней)
- Кнопки навигации → LP Register / Capital Calls

---

## Navigation Pages (updated)

| Page ID | Nav Label | Render Function |
|---------|-----------|-----------------|
| `page-lp-register` | LP Register | `renderLPRegisterPage()` |
| `page-lp-capital-calls` | Capital Calls | `renderCapitalCallsPage()` |
| `page-dashboard` | Дашборд | `renderDashboard()` |
| `page-ob-clients` | Клиенты (FM + CF&A) | `renderOnboardingPage()` |
| `page-ob-restricted` | Restricted List / COI | `renderRestrictedListPage()` |
| `page-engagements` | Реестр договоров | `renderEngagementsPage()` |
| `page-conflict-approvals` | Конфликты / Одобрения — CF Deal Committee | `renderConflictApprovalsPage()` |

---

## Dashboard Widgets (updated)

| Widget ID | Function | Description |
|-----------|----------|-------------|
| `dashLPWidget` | `renderDashboardLPWidget()` | LP Register KPI + CC progress + quick list |
| `dashObWidget` | `renderDashboardObWidget()` | On Track/At Risk/Delayed + client timeline |
| `dashCoiWidget` | `renderDashboardCoiWidget()` | Active COI conflicts |
| `dashRmWidget` | `renderDashboardRmWidget()` | RM workload cards |
| `kycStatusList` | `renderKYCStatus()` | LP KYC status |

---

## Data Models (v5.4)

### lpRegister[] (новый)
```js
{
  id, registerId,          // LP-YYYY-NNN
  name, type, lpType,      // Individual/Corporate; HNWI/Institution/Family Office/Corporate
  country, address, taxId,
  contact, email, phone,
  commitment,              // USD total commitment
  calledAmount,            // USD called to date (accumulated)
  paidAmount,              // USD actually received
  distributions,           // USD total distributions
  fundClass,               // A/B/C/Founder
  ownershipPct,            // % of total commitments (auto-recalculated)
  professionalClient,      // Deemed / Assessed
  kycStatus, kycDate, kycNextReview,
  riskRating,              // Low/Medium/High
  admissionDate,           // Date of GP acceptance
  saNumber,                // Subscription Agreement №
  afsaNotified,            // bool — >20% requires AFSA notification within 10 biz days
  lpacMember,              // bool — auto: commitment >= $3M
  status,                  // Active / Exited / Suspended
  exitDate,
  notes,
  obClientId,              // link to obClients[] if from onboarding
}
```

### capitalCallsLog[] (новый)
```js
{
  id, ccNumber,            // CC-YYYY-NNN
  noticeDate,              // Date notice sent
  paymentDate,             // +10 business days
  totalAmount,             // USD total
  pctOfCommit,             // % base for pro-rata
  purpose, purposeType,    // Investment / Management Fee
  status,                  // Completed / Pending / Draft / Overdue
  managementFee,           // bool
  bankRef, createdBy, notes,
  lineItems: [{
    lpId, lpName,
    commitment,            // LP's total commitment
    pct,                   // same as CC pct
    called,                // = commitment × pct / 100
    paid,                  // actually received
    paymentDate,           // actual payment date
    status,                // Paid / Pending / Default
    wireRef,               // wire reference for AML audit
    amlOk,                 // bool | null
  }]
}
```

---

## Pending / Future Work

- [ ] Distribution Module — Waterfall calculator (Return of Capital → Preferred Return 9% → GP Catch-up → 80/20 Carry)
- [ ] AFSA Notification Tracker — автоматические триггеры с deadlines
- [ ] NAV Calculation Workflow — полугодовой цикл CFO → Valuator → Auditor
- [ ] LP Exit / Secondary Transfer log (2-5% exit fee)
- [ ] Winding-Up / Liquidation checklist
- [ ] LP Reporting Schedule per LP (quarterly / semi-annual / annual)
- [ ] Tax forms tracker: CRS Self-Certification, W-8BEN (if US assets)
- [ ] IC Approval для крупных LP (>10% fund size или >20% ownership)
- [ ] engagements[] + obClients[] + lpRegister[] persistence via Table API

## Live URL
`https://540f2a53-ff3e-4e4f-bc23-479e385ac3ef.vip.gensparksite.com/`

---

## What's New in v5.3

### ✅ FM vs CF&A Form Architecture — Complete

All 3 early-phase onboarding forms are now fully direction-aware:

**Form 1.1 — Conflict Pre-Check (all directions)**
- FM LP: shows extra fields — `f_portfolioConflict` (Portfolio Company conflict), `f_relatedParty` (LP = Related Party to GP)
- CF&A: shows `f_dealConflict` (Mandate conflict check)
- Direction header banner (blue for FM, purple for CF&A) with context note

**Form 2.1 — Documentation Collection**
- **FM Corporate LP**: Certificate of Incorporation, Charter, UBO Declaration + Passports (≥10%), Board Resolution to Invest, Audited Financials (2yr), Bank Reference, LP Questionnaire, Source of Funds
- **FM Individual LP**: Passport, Address Confirmation, SoF Declaration, SoW Declaration, LP Questionnaire, Tax ID/TIN, Bank Reference, PEP Self-Declaration
- **CF&A Corporate**: Certificate of Incorporation, Charter, Directors Register, UBO Declaration, Financials, Address (existing, unchanged)
- **CF&A Individual**: Passport, Address, SoF, SoW, PEP Declaration, CV (existing, unchanged)
- Documents split into **Required** (red header) and **Additional** (grey header) sections
- FM-specific `f_lpqVersion` field (LP Questionnaire version)
- Direction-colored header banner with type sub-label

**Form 2.2 — DD Outcome / AML-KYC Due Diligence**
- Direction header banner carries over doc_collection status from Task 2.1
- Section 1 (Identification): FM shows `f_lpDocsVerified` + `f_uboVerified` (Corporate LP only)
- Section 4 (new, FM only): Source of Funds/Wealth verification: `f_sofVerified`, `f_sowVerified`, `f_bankRefOk`, `f_taxIdVerified`
- Section labels renumbered for FM (4→5→6→7)
- FM-specific PEP labels ("LP (физлицо)" vs "UBO / Директоров")
- FM-specific risk label: "Риск источника средств LP" instead of "Риск бизнес-деятельности"
- `f_mlroNote` (MLRO commentary field) for FM
- CO comment placeholder adapted per direction

**KPI Bar (renderObKPIs) — direction-aware**
- When a direction tab (CF&A / FM) is active → KPI pool is filtered to that direction
- When "All" tab → shows 5th KPI card: "CF&A / FM" split with clickable counts + total FM LP commitment

---

## What's New in v5.2

### ✅ Items implemented (Items 6–11):

**Item 6 — Client Classification (3.1) + Suitability/Appropriateness (3.2)**
- Full form redesign with AFSA Professional Client score card (2-of-3 criteria)
- Market Counterparty criteria block
- Data carry-over from task 2.2 (DD risk + conclusion banner in 3.1)
- Classification carry-over from 3.1 → 3.2 banner
- `submitObTask()` now updates `client.classification` from `f_proposedClass` on completion

**Item 7 — Реестр договоров (Engagement Letter auto-push)**
- Task 4.1 form completion **automatically creates** a record in `engagements[]`
- Duplicate guard (by contractNum + clientId)
- Toast: `📄 Договор ENG-XXXX-NNN автоматически добавлен в Реестр`
- Status is `Active` if `f_clientSigned === 'Да'`, otherwise `Draft`

**Item 8 — Dashboard: On Track / At Risk / Delayed widget**
- Segmented status bar (green/orange/red proportional)
- Phase mini-chart + client timeline rows (tasks done/7, days left, status badge)

**Item 9 — Client Activation (5.1)**
- Hard blocker: all prior tasks must be `completed`/`escalated`
- On success: `client.activated=true`, `onboardingStatus='Completed'`, calculates `amlReviewDate` + `reClassDate`

**Item 10 — Chinese Wall (FM vs CF&A)**
- `chineseWallCheck(client)` → `{ allowed: bool, reason: string }`
- RM blocked from FM-direction clients; CEO/CO/MLRO/Analyst have full access
- Submit buttons disabled when wall active; `submitObTask()` aborted

**Item 11 — RM Workload Widget on Dashboard**
- `renderDashboardRmWidget()`: per-RM cards with load level badge (Low/Medium/High)

### ✅ FM vs CF&A architectural separation (v5.2 base):
- `OB_TASK_TEMPLATES_CFA` + `OB_TASK_TEMPLATES_FM` + `getTaskTemplates(direction)`
- FM-specific forms: `lp_qualification` (3.1), `lp_investment_profile` (3.2), `subscription_agreement` (4.1)
- `submitObTask()` routing for all FM forms incl. qualification gate + SA auto-push to `engagements[]`
- Direction-aware new client modal with CF&A / FM toggle buttons
- Direction-aware client card info grid, table detail lines, phase board badges

---

## Architecture

### SPA Pattern
- `<section id="page-*" class="page">` toggled via `navigateTo()` in `app.js`
- Active page class: `.active`

### Modal System
- All modals: `class="task-modal-wide"` + `position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1001`
- Inline task form: `openObTaskForm()` replaces `#obClientModalContent` innerHTML (no second modal)
- Back button: `closeObTaskForm()` restores client card view

### Onboarding Data Flow
```
obClients[] ──→ createOnboardingTasks() ──→ obTasks[]
                                              │
                openObTaskForm(taskId)         │
                buildTaskForm(task, client) ←──┘
                  ↳ conflict_precheck  [FM/CF&A direction header + LP-specific checks]
                  ↳ doc_collection     [FM LP vs CF&A docs, req/optional split]
                  ↳ dd_outcome         [FM AML/KYC LP + SoF/SoW section vs CF&A DD]
                  ↳ classification     [CF&A only — AFSA score cards]
                  ↳ suitability        [CF&A only — suitability/appropriateness]
                  ↳ lp_qualification   [FM only — Qualified Investor gate]
                  ↳ lp_investment_profile [FM only — fund suitability]
                  ↳ engagement_letter  [CF&A → engagements[] auto-push]
                  ↳ subscription_agreement [FM → engagements[] auto-push with commitment]
                  ↳ activation         [both — hard blocker + client.activated=true]
                submitObTask(taskId)
                  │
                  ├─ checkWallBeforeSubmit()  → Chinese Wall abort if RM+FM
                  ├─ classification           → client.classification update
                  ├─ lp_qualification         → qualification gate (blocks if Не квалифицирован)
                  ├─ lp_investment_profile    → fund fit gate (blocks if Нет — отказ)
                  ├─ engagement_letter        → engagements[] auto-push (CF&A)
                  ├─ subscription_agreement   → engagements[] auto-push (FM)
                  ├─ activation              → hard blocker check → client.activated=true
                  └─ all                     → unlockNextTask() → updateClientPhase()
```

### Chinese Wall Rules
| Role | CF&A Clients | FM Clients |
|------|-------------|-----------|
| CEO | ✅ Full access | ✅ Full access |
| CO (Compliance Officer) | ✅ Full access | ✅ Full access |
| MLRO | ✅ Full access | ✅ Full access |
| Analyst | ✅ Full access | ✅ Full access |
| RM (Relationship Manager) | ✅ Full access | 🔴 Blocked |

### Direction Business Logic
| Aspect | CF&A | FM |
|--------|------|----|
| Client is | Company/Person seeking advisory | Limited Partner investing in fund |
| serviceType | `Advising` / `Arranging` / `Both` | `LP Investment` |
| Classification | AFSA: Professional Client / Market Counterparty / Retail | Qualified Investor / Professional Investor |
| Key Doc 3.1 | Client Classification (formKey: `classification`) | LP Qualification Check (formKey: `lp_qualification`) |
| Key Doc 3.2 | Suitability/Appropriateness (formKey: `suitability`) | Investment Profile & Suitability (formKey: `lp_investment_profile`) |
| Key Doc 4.1 | Engagement Letter → `ENG-YYYY-NNN` | Subscription Agreement → `SA-YYYY-NNN` |
| Activation | Client Activation | LP Activation |
| Financial fields | feeAmount (advisory), successFee (%), retainer | commitment ($), Management Fee + 20% carry |

---

## File Index

| File | Role |
|------|------|
| `index.html` | SPA shell: all pages, modals, nav, scripts |
| `portal.html` | **Портал** компании-портфеля: самообслуживание (квартальные отчёты, документы, платежи, ESG) |
| `css/style.css` | Styles: modal centering, overlays, KPI cards |
| `js/app.js` | Navigation, dashboard render, badges, user role; Deal Pipeline modal (5 tabs); Portfolio module (6-tab modal, 20+ functions) |
| `js/onboarding.js` | **Core**: ob clients, 7 tasks, all forms (FM+CF&A), submit routing, engagements, dashboard widgets, Chinese Wall |
| `js/data.js` | Static data: deals (9 полных), portfolio (3 rich companies), chartData |
| `js/workflow.js` | Approval workflows |
| `js/modules.js` | IC Memos, KYC Renewal, Compliance Calendar, LP Reports |
| `js/vault.js` | File vault |
| `js/export.js` | 10 Excel reports via SheetJS 0.18.5 |
| `js/trading.js` | Trading analytics |
| `js/funds.js` | Fund switcher (TCF-I/II/III) |
| `js/documents.js` | Document management |

---

## Dashboard Widgets (page-dashboard)

| Widget ID | Function | Description |
|-----------|----------|-------------|
| `dashObWidget` | `renderDashboardObWidget()` | On Track/At Risk/Delayed status bar + client timeline |
| `dashCoiWidget` | `renderDashboardCoiWidget()` | Active COI conflicts |
| `dashRmWidget` | `renderDashboardRmWidget()` | RM workload cards (Low/Medium/High load) |
| `kycStatusList` | `renderKYCStatus()` | LP KYC status |

---

## Onboarding Task Sequences

### CF&A Task Sequence
```
1.1  Conflict Pre-Check (Go/No-Go)          Phase 1  formKey: conflict_precheck
2.1  Documentation Collection               Phase 2  formKey: doc_collection    [CF&A Individual/Corporate docs]
2.2  Client Due Diligence Outcome           Phase 2  formKey: dd_outcome        [CF&A KYC/AML]
3.1  Client Classification (AFSA)           Phase 3  formKey: classification    [Professional/Market Counterparty/Retail]
3.2  Suitability / Appropriateness          Phase 3  formKey: suitability
4.1  Draft & Sign Engagement Letter         Phase 4  formKey: engagement_letter → engagements[] ENG-YYYY-NNN
5.1  Client Activation                      Phase 5  formKey: activation
```

### FM Task Sequence
```
1.1  Conflict Pre-Check (Go/No-Go)          Phase 1  formKey: conflict_precheck [LP + Portfolio Conflict checks]
2.1  Documentation Collection (LP)          Phase 2  formKey: doc_collection    [FM LP Individual/Corporate docs]
2.2  AML / KYC Due Diligence               Phase 2  formKey: dd_outcome        [FM AML/KYC + SoF/SoW section]
3.1  LP Qualification Check                 Phase 3  formKey: lp_qualification  [Qualified Investor gate]
3.2  Investment Profile & Suitability       Phase 3  formKey: lp_investment_profile
4.1  Subscription Agreement                 Phase 4  formKey: subscription_agreement → engagements[] SA-YYYY-NNN
5.1  LP Activation                          Phase 5  formKey: activation
```

**Unlock sequence**: 1.1 → 2.1 → 2.2 → {3.1, 3.2} → 4.1 → 5.1  
**Activation hard blocker**: 5.1 cannot complete unless all 1.1–4.1 are `completed` or `escalated`

---

## Data Models

### obClient
```js
// Common fields
{ id, clientId, name, type,    // type: 'Individual' | 'Corporate'
  direction,                    // 'CF&A' | 'FM'
  classification, rm, phase,
  onboardingStatus,             // 'On Track' | 'At Risk' | 'Delayed' | 'Completed'
  riskRating,                   // 'Low' | 'Medium' | 'High'
  startDate, targetDate, nextAction, notes,
  restrictedMatch, activated,
  amlReviewDate?, reClassDate?  // set on activation
}

// CF&A only
{ serviceType: 'Advising' | 'Arranging' | 'Both' }

// FM only
{ serviceType: 'LP Investment',
  lpType: 'HNWI' | 'Family Office' | 'Institution' | 'Corporate',
  commitment: number }           // USD commitment amount
```

### obTask
```js
{ id, clientId, taskNum, title, phase, role, formKey,
  dueDate, status,              // 'locked' | 'open' | 'completed' | 'escalated'
  formData: {},                 // all f_* field values
  completedAt, completedBy, comments }
```

### engagement (from engagements[])
```js
// CF&A Engagement Letter (4.1)
{ engId: 'ENG-YYYY-NNN', serviceType: 'Advising'|'Arranging',
  feeType, feeAmount, successFee, retainer, payTerms, ... }

// FM Subscription Agreement (4.1)
{ engId: 'SA-YYYY-NNN', serviceType: 'LP Investment (FM)',
  feeType: 'Management Fee + Carry',
  feeAmount: commitment,       // USD LP commitment
  successFee: 20,              // 20% carry standard
  payTerms: 'По Capital Call', ... }
```

---

## Sample Data (4 clients at startup)

| ID | Name | Direction | Type | Phase | Status |
|----|------|-----------|------|-------|--------|
| CL-2026-001 | Asel Nurmagambetova | CF&A | Individual | 3 | On Track |
| CL-2026-002 | Omega Capital LLP | CF&A | Corporate | 2 | At Risk |
| CL-2026-003 | Bauyrzhan Seitkali | FM | Individual | 5 | Completed ✅ |
| CL-2026-004 | Sovereign Wealth Partners Ltd | FM | Corporate | 2 | On Track |

---

## Pending / Future Work

- [ ] Export: FM-specific Subscription Agreement PDF template
- [ ] Dashboard: FM AUM / Capital Calls summary widget
- [ ] KYC Renewal: direction-aware renewal flow (AFSA re-classification vs LP re-qualification)
- [ ] engagements[] persistence: connect to Table API for cross-session storage
- [ ] obClients[] persistence: connect to Table API (currently in-memory only)

## Live URL
`https://540f2a53-ff3e-4e4f-bc23-479e385ac3ef.vip.gensparksite.com/`

---

## What's New in v5.2

### ✅ Items implemented this session:

**Item 6 — Client Classification (3.1) + Suitability/Appropriateness (3.2)**
- Full form redesign with AFSA Professional Client score card (2-of-3 criteria)
- Market Counterparty criteria block
- Data carry-over from task 2.2 (DD risk + conclusion banner in 3.1)
- Classification carry-over from 3.1 → 3.2 banner
- `submitObTask()` now updates `client.classification` from `f_proposedClass` on completion

**Item 7 — Реестр договоров (Engagement Letter auto-push)**
- Task 4.1 form completion **automatically creates** a record in `engagements[]`
- Duplicate guard (by contractNum + clientId) prevents double-push on re-submit
- Toast: `📄 Договор ENG-XXXX-NNN автоматически добавлен в Реестр`
- Status is `Active` if `f_clientSigned === 'Да'`, otherwise `Draft`
- Full financial fields: feeType, feeAmount, successFee, retainer, payTerms, engExpiry

**Item 8 — Dashboard: On Track / At Risk / Delayed widget**
- Replaced old KPI grid with a full **segmented status bar** (green/orange/red proportional)
- Legend row with click-to-filter links to `ob-clients` page filtered by status
- **Phase mini-chart** (bar chart, proportional height per phase)
- **Client timeline rows**: each shows mini progress bar (tasks done/7), days remaining, status badge
- Overdue task counter with alert indicator

**Item 9 — Client Activation (5.1)**
- `submitObTask('activation')` now has a **hard blocker**: if any prior task is not `completed` or `escalated`, activation is reverted to `open` and a toast lists the blockers
- On success: sets `client.activated=true`, `onboardingStatus='Completed'`, `phase=5`, calculates `amlReviewDate` (+6 or +12 months), `reClassDate` (+1 year)

**Item 10 — Chinese Wall (FM vs CF&A)**
- New function: `chineseWallCheck(client)` → `{ allowed: bool, reason: string }`
- Rule: `RM (Relationship Manager)` role → blocked from FM-direction clients
- `CEO`, `CO (Compliance Officer)`, `MLRO`, `Analyst` → full access to both directions
- `renderChineseWallBanner(client)` — displays a red warning panel inside task form
- `checkWallBeforeSubmit(client)` — called at top of `submitObTask()`, aborts if blocked
- Submit/Draft buttons are disabled (greyed out + lock icon) when wall is active
- Role can be switched via the user avatar in the sidebar footer

**Item 11 — RM Workload Widget on Dashboard**
- New function: `renderDashboardRmWidget()` in `onboarding.js`
- Shows per-RM card: Active clients, Open tasks, At Risk/Delayed count, Completed this month
- Load level badge: `Low` / `Medium` / `High` (based on active client count)
- Red alert if any overdue tasks exist for that RM
- Wired into `renderDashboard()` in `app.js`
- HTML: `<div id="dashRmWidget">` added to `page-dashboard` in `index.html`

---

## Architecture

### SPA Pattern
- `<section id="page-*" class="page">` toggled via `navigateTo()` in `app.js`
- Active page class: `.active`

### Modal System
- All modals: `class="task-modal-wide"` + `position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1001; opacity:1`
- Inline task form: `openObTaskForm()` replaces `#obClientModalContent` innerHTML (no second modal)
- Back button: `closeObTaskForm()` restores client card view

### Onboarding Data Flow
```
obClients[] ──→ createOnboardingTasks() ──→ obTasks[]
                                              │
                openObTaskForm(taskId)         │
                buildTaskForm(task, client) ←──┘
                submitObTask(taskId)
                  │
                  ├─ classification → client.classification update
                  ├─ engagement_letter → engagements[] auto-push
                  ├─ activation → blocker check → client.activated=true
                  └─ all → unlockNextTask() → updateClientPhase()
```

### Chinese Wall
```
currentUserRole() = 'RELATIONSHIP_MANAGER'
  + client.direction = 'FM'
  → chineseWallCheck() returns { allowed: false }       (client-side fast-fail)
  → renderChineseWallBanner() shows red panel
  → submit buttons disabled
  → submitObTask() aborted via checkWallBeforeSubmit()

  Also enforced server-side (authoritative): server/chineseWall.js filters
  GET /api/onboarding and guards the ob-clients/ob-tasks/engagements write
  routes the same way — see "What's New in v6.8" above.
```

---

## File Index

| File | Role |
|------|------|
| `index.html` | SPA shell: all pages, modals, nav, scripts |
| `portal.html` | **Портал** компании-портфеля: самообслуживание |
| `css/style.css` | Styles: modal centering, overlays, KPI cards |
| `js/app.js` | Navigation, dashboard render, badges, user role; Deal Pipeline (5 tabs); Portfolio module |
| `js/onboarding.js` | **Core**: ob clients, 7 tasks, forms, submit routing, engagements, dashboard widgets, Chinese Wall |
| `js/data.js` | Static data: deals (9), portfolio (3 rich), chartData |
| `js/workflow.js` | Approval workflows |
| `js/modules.js` | IC Memos, KYC Renewal, Compliance Calendar, LP Reports |
| `js/vault.js` | File vault: global file viewer |
| `js/export.js` | 10 Excel reports via SheetJS 0.18.5 |
| `js/trading.js` | Trading analytics |
| `js/funds.js` | Fund switcher (TCF-I/II/III) |
| `js/documents.js` | Document management |
| `js/i18n.js` | RU/EN translations |
| `js/subscription.js` | Subscription management |

---

## Dashboard Widgets (page-dashboard)

| Widget ID | Function | Description |
|-----------|----------|-------------|
| `dashObWidget` | `renderDashboardObWidget()` | On Track/At Risk/Delayed status bar + client timeline rows |
| `dashCoiWidget` | `renderDashboardCoiWidget()` | Active COI conflicts list |
| `dashRmWidget` | `renderDashboardRmWidget()` | RM workload cards per RM |
| `kycStatusList` | `renderKYCStatus()` | LP KYC status |

---

## Navigation Pages

| Page ID | Nav Label | Render Function |
|---------|-----------|-----------------|
| `page-dashboard` | Дашборд | `renderDashboard()` |
| `page-ob-clients` | Клиенты (FM + CF&A) | `renderOnboardingPage()` |
| `page-ob-restricted` | Restricted List / COI | `renderRestrictedListPage()` |
| `page-engagements` | Реестр договоров | `renderEngagementsPage()` |
| `page-conflict-approvals` | Конфликты / Одобрения — CF Deal Committee | `renderConflictApprovalsPage()` |
| `page-workflow` | Согласования | `renderWorkflowPage()` |
| `page-vault` | Хранилище файлов | `renderVaultPage()` |
| `page-export` | Экспорт Excel | `renderExportPage()` |

---

## Onboarding Task Sequence

```
Task 1.1  Conflict Pre-Check (Go/No-Go)           Phase 1  formKey: conflict_precheck
Task 2.1  Documentation Collection                 Phase 2  formKey: doc_collection
Task 2.2  Client Due Diligence Outcome             Phase 2  formKey: dd_outcome
Task 3.1  Client Classification (AFSA)            Phase 3  formKey: classification
Task 3.2  Suitability / Appropriateness           Phase 3  formKey: suitability
Task 4.1  Draft & Sign Engagement Letter          Phase 4  formKey: engagement_letter → engagements[]
Task 5.1  Client Activation                       Phase 5  formKey: activation → client.activated=true
```

**Unlock sequence**: 1.1→2.1→2.2→{3.1,3.2}→4.1→5.1
**Activation blocker**: 5.1 cannot complete unless all 1.1–4.1 are `completed` or `escalated`

---

## Data Models

### obClient
```js
{ id, clientId, name, type, classification, serviceType, direction,
  rm, phase, onboardingStatus, riskRating, startDate, targetDate,
  nextAction, notes, restrictedMatch, activated,
  amlReviewDate?, reClassDate? }
```
`onboardingStatus`: `'On Track'` | `'At Risk'` | `'Delayed'` | `'Completed'`

### obTask
```js
{ id, clientId, taskNum, title, phase, role, formKey,
  dueDate, status, formData: {}, completedAt, completedBy, comments }
```
`status`: `'locked'` | `'open'` | `'completed'` | `'rejected'` | `'escalated'`

### engagement
```js
{ id, engId, clientId, clientName, serviceType, contractNum,
  date, status, feeType, feeAmount, successFee, retainer,
  payTerms, invoiced, paid, startDate, endDate, rm, notes }
```
`status`: `'Draft'` | `'Active'` | `'Completed'` | `'Terminated'`

---

## Chinese Wall Rules

| Role | FM clients | CF&A clients |
|------|-----------|--------------|
| CEO | ✅ Full access | ✅ Full access |
| CO (Compliance Officer) | ✅ Full access | ✅ Full access |
| MLRO | ✅ Full access | ✅ Full access |
| Analyst | ✅ Full access | ✅ Full access |
| RM (Relationship Manager) | ❌ Blocked (wall) | ✅ Full access |

---

## Build Status

- **Console errors**: 0 ✅ (verified via Playwright — index.html + portal.html)
- **Libraries**: Chart.js (CDN), SheetJS 0.18.5, Font Awesome 6.4.0, Google Inter
- **Browser**: Static HTML/CSS/JS — no server required
- **Version**: 6.7 (Deal Pipeline v6.6 + Portfolio module + Portal)
- **Live URL**: `https://540f2a53-ff3e-4e4f-bc23-479e385ac3ef.vip.gensparksite.com/`
- **Portal**: `https://540f2a53-ff3e-4e4f-bc23-479e385ac3ef.vip.gensparksite.com/portal.html`
