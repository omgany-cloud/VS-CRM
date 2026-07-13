// ============================================================
//  tasks.js — Task Management Module (Pyrus-style) v2
//  FIXED: modal open/close, comments, create, delete
// ============================================================

/* ── Data ── */
let tasksData = [
  {
    id: 1,
    title: 'Собрать Source of Funds — KYC-досье Байжановой Динары Сериковны',
    type: 'KYC', priority: 'critical', status: 'in_progress',
    assignee: 'CO (Compliance Officer)', author: 'MLRO',
    relatedClient: 'Байжанова Динара Сериковна', relatedModule: 'kyc',
    deadline: '2025-07-22', created: '2025-07-02',
    description: 'KYC-досье в процессе оформления. Требуется подтверждение источника происхождения средств (Source of Funds) — банковские выписки, справка о доходах.',
    comments: [
      { id: 1, author: 'CO', date: '2025-07-03', text: 'Запрос направлен клиенту, ожидаем документы.' },
      { id: 2, author: 'MLRO', date: '2025-07-08', text: 'Получены частичные документы, нужна справка о доходах за последний год.' }
    ], attachments: []
  },
  {
    id: 2,
    title: 'AML-скрининг — Байжанова Динара Сериковна',
    type: 'AML', priority: 'high', status: 'pending',
    assignee: 'MLRO', author: 'CO (Compliance Officer)',
    relatedClient: 'Байжанова Динара Сериковна', relatedModule: 'kyc',
    deadline: '2025-07-24', created: '2025-07-02',
    description: 'Провести проверку по санкционным спискам и PEP-базам перед допуском инвестора к подписанию Subscription Agreement.',
    comments: [], attachments: []
  },
  {
    id: 3,
    title: 'Subscription Agreement — Eurasia Bridge Partners LLP',
    type: 'Онбординг', priority: 'high', status: 'pending',
    assignee: 'RM (Relationship Manager)', author: 'CEO',
    relatedClient: 'Eurasia Bridge Partners LLP', relatedModule: 'onboarding',
    deadline: '2025-07-28', created: '2025-07-10',
    description: 'Подготовить и направить на подпись Subscription Agreement на сумму, согласованную в term sheet.',
    comments: [
      { id: 1, author: 'RM', date: '2025-07-11', text: 'Проект соглашения отправлен на юридическую проверку.' }
    ], attachments: []
  },
  {
    id: 4,
    title: 'Финансовый Due Diligence — Steppe Logistics KZ',
    type: 'Сделка', priority: 'critical', status: 'in_progress',
    assignee: 'Analyst', author: 'Investment Manager',
    relatedClient: 'Steppe Logistics KZ', relatedModule: 'deals',
    deadline: '2025-08-05', created: '2025-07-01',
    description: 'Финансовый DD в процессе: анализ отчётности за 3 года, проверка долговой нагрузки и денежных потоков. Дедлайн — 05.08.2025.',
    comments: [
      { id: 1, author: 'Analyst', date: '2025-07-09', text: 'Получены аудированные отчёты за 2023–2024.' },
      { id: 2, author: 'Investment Manager', date: '2025-07-12', text: 'Нужен доступ к management accounts за 2025 год.' }
    ], attachments: []
  },
  {
    id: 5,
    title: 'Подготовить IC-меморандум — Green Energy Almaty',
    type: 'Сделка', priority: 'high', status: 'review',
    assignee: 'Analyst', author: 'CEO',
    relatedClient: 'Green Energy Almaty', relatedModule: 'deals',
    deadline: '2025-07-19', created: '2025-06-25',
    description: 'Инвестиционный меморандум для Investment Committee. Заседание IC назначено на 20.07.2025.',
    comments: [
      { id: 1, author: 'Analyst', date: '2025-07-05', text: 'Черновик меморандума готов, отправлен на ревью.' },
      { id: 2, author: 'CEO', date: '2025-07-10', text: 'Добавить сценарный анализ по возврату инвестиций.' }
    ], attachments: []
  },
  {
    id: 6,
    title: 'Подготовка к первому звонку — FinBridge Kazakhstan',
    type: 'Сделка', priority: 'medium', status: 'pending',
    assignee: 'RM (Relationship Manager)', author: 'CEO',
    relatedClient: 'FinBridge Kazakhstan', relatedModule: 'deals',
    deadline: '2025-07-18', created: '2025-07-11',
    description: 'Скрининг новой сделки: подготовить вопросы к первому звонку с основателями, назначенному на 18.07.2025.',
    comments: [], attachments: []
  },
  {
    id: 7,
    title: 'Capital Call — подготовка уведомлений для LP',
    type: 'Capital Call', priority: 'medium', status: 'pending',
    assignee: 'CO (Compliance Officer)', author: 'CFO',
    relatedClient: 'Все LP', relatedModule: 'capitalcalls',
    deadline: '2025-08-01', created: '2025-07-10',
    description: 'Подготовить Capital Call Notice для всех LP фонда. Срок оплаты — 10 рабочих дней с даты уведомления.',
    comments: [], attachments: []
  },
  {
    id: 8,
    title: 'Продлить страховой полис — VitaMed Astana',
    type: 'Договор', priority: 'medium', status: 'pending',
    assignee: 'CO (Compliance Officer)', author: 'CCO',
    relatedClient: 'VitaMed Astana', relatedModule: 'portfolio',
    deadline: '2025-08-10', created: '2025-07-12',
    description: 'Истекает срок действия договора страхования профессиональной ответственности портфельной компании. Требуется продление и загрузка обновлённого документа.',
    comments: [], attachments: []
  },
  {
    id: 9,
    title: 'Плановый визит мониторинга — NomadTech Solutions',
    type: 'Прочее', priority: 'low', status: 'pending',
    assignee: 'RM (Relationship Manager)', author: 'CEO',
    relatedClient: 'NomadTech Solutions', relatedModule: 'portfolio',
    deadline: '2025-08-15', created: '2025-07-13',
    description: 'Плановый квартальный визит для мониторинга операционных показателей портфельной компании.',
    comments: [], attachments: []
  },
  {
    id: 10,
    title: 'Отправить квартальный отчёт LP — Q2 2025',
    type: 'Отчётность', priority: 'medium', status: 'completed',
    assignee: 'RM (Relationship Manager)', author: 'CEO',
    relatedClient: 'Все LP', relatedModule: 'reports',
    deadline: '2025-07-10', created: '2025-06-15',
    description: 'Подготовить и разослать квартальный отчёт всем LP: NAV, IRR, статус портфеля, комментарии GP.',
    comments: [
      { id: 1, author: 'CEO', date: '2025-07-10', text: 'Согласован и разослан всем LP.' }
    ], attachments: []
  },
];

let taskIdCounter = 11;
let tasksFilter   = { status: '', type: '', assignee: '' };
let tasksView     = 'board';
let activeTaskId  = null;

const TASK_TYPES     = ['KYC','AML','Онбординг','Сделка','Capital Call','Отчётность','Договор','Юридическое','Прочее'];
const TASK_ASSIGNEES = ['RM (Relationship Manager)','CO (Compliance Officer)','MLRO','CEO','Analyst','Admin'];
const TASK_PRIORITIES = { critical:'Критично', high:'Высокий', medium:'Средний', low:'Низкий' };
const TASK_STATUSES  = {
  pending:     { label:'Новая',       color:'#94a3b8', bg:'rgba(100,116,139,0.15)' },
  in_progress: { label:'В работе',    color:'#3b82f6', bg:'rgba(59,130,246,0.15)'  },
  review:      { label:'На проверке', color:'#f97316', bg:'rgba(249,115,22,0.15)'  },
  completed:   { label:'Выполнена',   color:'#22c55e', bg:'rgba(34,197,94,0.15)'   },
  cancelled:   { label:'Отменена',    color:'#ef4444', bg:'rgba(239,68,68,0.15)'   },
};

/* ─────────────────────────────────────────
   RENDER
───────────────────────────────────────── */
function renderTasksPage() {
  renderTasksKPIs();
  if (tasksView === 'board') renderTasksBoard();
  else renderTasksList();
}

function renderTasksKPIs() {
  const el = document.getElementById('tasksKPIs');
  if (!el) return;
  const total   = tasksData.length;
  const inProg  = tasksData.filter(t => t.status === 'in_progress').length;
  const done    = tasksData.filter(t => t.status === 'completed').length;
  const overdue = tasksData.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.deadline && new Date(t.deadline) < new Date()).length;
  const crit    = tasksData.filter(t => t.priority === 'critical' && t.status !== 'completed').length;

  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon blue"><i class="fas fa-tasks"></i></div>
      <div class="kpi-body"><span class="kpi-label">Всего задач</span>
        <span class="kpi-value">${total}</span>
        <span class="kpi-delta up">${done} выполнено</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon orange"><i class="fas fa-spinner"></i></div>
      <div class="kpi-body"><span class="kpi-label">В работе</span>
        <span class="kpi-value">${inProg}</span>
        <span class="kpi-delta">активных</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon red"><i class="fas fa-clock"></i></div>
      <div class="kpi-body"><span class="kpi-label">Просроченные</span>
        <span class="kpi-value" style="color:${overdue>0?'#ef4444':'#22c55e'}">${overdue}</span>
        <span class="kpi-delta ${overdue>0?'down':'up'}">${overdue>0?'Внимание!':'Всё в срок'}</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon red"><i class="fas fa-fire"></i></div>
      <div class="kpi-body"><span class="kpi-label">Критичных</span>
        <span class="kpi-value" style="color:${crit>0?'#ef4444':'#22c55e'}">${crit}</span>
        <span class="kpi-delta ${crit>0?'down':'up'}">${crit>0?'Срочно!':'Нет'}</span></div>
    </div>`;
}

/* ── Kanban Board ── */
function renderTasksBoard() {
  const container = document.getElementById('tasksBoard');
  if (!container) return;
  container.style.display = 'grid';
  const listEl = document.getElementById('tasksList');
  if (listEl) listEl.style.display = 'none';

  const cols = ['pending','in_progress','review','completed'];
  container.innerHTML = cols.map(status => {
    const items = getFilteredTasks().filter(t => t.status === status);
    const cfg   = TASK_STATUSES[status];
    return `
      <div class="task-col">
        <div class="task-col-header">
          <span class="task-col-title" style="color:${cfg.color}">${cfg.label}</span>
          <span class="task-col-count" style="background:${cfg.bg};color:${cfg.color}">${items.length}</span>
        </div>
        <div class="task-col-body">
          ${items.length ? items.map(t => renderTaskCard(t)).join('') : '<div class="task-empty-col">Нет задач</div>'}
        </div>
      </div>`;
  }).join('');
}

function renderTaskCard(t) {
  const prioColor = { critical:'#ef4444', high:'#f97316', medium:'#3b82f6', low:'#94a3b8' };
  const prioIcon  = { critical:'fa-fire',  high:'fa-arrow-up', medium:'fa-minus', low:'fa-arrow-down' };
  const isOverdue = t.status !== 'completed' && t.deadline && new Date(t.deadline) < new Date();
  const daysLeft  = t.deadline ? Math.ceil((new Date(t.deadline) - new Date()) / 86400000) : null;
  const dStr      = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}) : '—';
  return `
    <div class="task-card ${isOverdue?'overdue':''}" onclick="openTaskModal(${t.id})" style="cursor:pointer">
      <div class="task-card-top">
        <span class="task-type-badge">${t.type}</span>
        <i class="fas ${prioIcon[t.priority]}" style="color:${prioColor[t.priority]};font-size:12px"></i>
      </div>
      <div class="task-card-title">${t.title}</div>
      ${t.relatedClient ? `<div class="task-card-client"><i class="fas fa-user" style="font-size:10px"></i> ${t.relatedClient}</div>` : ''}
      <div class="task-card-footer">
        <div class="task-card-assignee">
          <div class="task-avatar">${getInitials(t.assignee)}</div>
          <span style="font-size:11px;color:#8a9bbf">${t.assignee.split(' ')[0]}</span>
        </div>
        <div class="task-deadline ${isOverdue?'overdue':''}">
          <i class="fas fa-calendar-alt" style="font-size:10px"></i> ${dStr}
          ${daysLeft !== null && t.status !== 'completed'
            ? `<span class="days-left ${daysLeft<0?'neg':daysLeft<=2?'warn':''}">${daysLeft<0?Math.abs(daysLeft)+'д просрочено':daysLeft+'д'}</span>`
            : ''}
        </div>
      </div>
      ${t.comments.length ? `<div class="task-card-meta"><i class="fas fa-comment" style="font-size:10px"></i> ${t.comments.length}</div>` : ''}
    </div>`;
}

/* ── List View ── */
function renderTasksList() {
  const board = document.getElementById('tasksBoard');
  if (board) board.style.display = 'none';
  const listEl = document.getElementById('tasksList');
  if (!listEl) return;
  listEl.style.display = 'block';
  const items = getFilteredTasks();
  const prioColor = { critical:'#ef4444', high:'#f97316', medium:'#3b82f6', low:'#94a3b8' };
  listEl.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Задача</th><th>Тип</th><th>Исполнитель</th><th>Приоритет</th><th>Дедлайн</th><th>Статус</th><th></th></tr></thead>
        <tbody>${items.map(t => {
          const cfg = TASK_STATUSES[t.status];
          const overdue = t.status !== 'completed' && t.deadline && new Date(t.deadline) < new Date();
          return `
            <tr style="cursor:pointer">
              <td onclick="openTaskModal(${t.id})">
                <div style="font-weight:600;color:var(--text-primary)">${t.title}</div>
                ${t.relatedClient?`<div style="font-size:11px;color:#8a9bbf">${t.relatedClient}</div>`:''}
              </td>
              <td onclick="openTaskModal(${t.id})"><span class="task-type-badge">${t.type}</span></td>
              <td onclick="openTaskModal(${t.id})" style="font-size:12px">${t.assignee}</td>
              <td onclick="openTaskModal(${t.id})" style="color:${prioColor[t.priority]};font-weight:700;font-size:12px">${TASK_PRIORITIES[t.priority]}</td>
              <td onclick="openTaskModal(${t.id})" style="font-size:12px;color:${overdue?'#ef4444':'var(--text-secondary)'}">
                ${t.deadline?new Date(t.deadline).toLocaleDateString('ru-RU'):'—'}
              </td>
              <td onclick="openTaskModal(${t.id})">
                <span class="task-status-pill" style="background:${cfg.bg};color:${cfg.color}">${cfg.label}</span>
              </td>
              <td>
                <button onclick="quickDeleteTask(${t.id})" style="background:none;border:1px solid #ef4444;color:#ef4444;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

function getFilteredTasks() {
  return tasksData.filter(t => {
    if (tasksFilter.status   && t.status   !== tasksFilter.status)              return false;
    if (tasksFilter.type     && t.type     !== tasksFilter.type)                return false;
    if (tasksFilter.assignee && !t.assignee.toLowerCase().includes(tasksFilter.assignee.toLowerCase())) return false;
    return true;
  });
}

/* ─────────────────────────────────────────
   MODAL — OPEN / CLOSE
───────────────────────────────────────── */
function openTaskModal(id) {
  activeTaskId = id || null;
  const overlay = document.getElementById('taskModalOverlay');
  const modal   = document.getElementById('modal-task');
  if (!modal) return;

  if (overlay) overlay.style.display = 'block';
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  if (id) {
    const t = tasksData.find(x => x.id === id);
    if (t) renderTaskModalView(t);
  } else {
    renderTaskModalCreate(null);
  }
}

function closeTaskModal() {
  const overlay = document.getElementById('taskModalOverlay');
  const modal   = document.getElementById('modal-task');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.style.display   = 'none';
  document.body.style.overflow = '';
  activeTaskId = null;
}

/* ── View Mode ── */
function renderTaskModalView(t) {
  const cfg = TASK_STATUSES[t.status];
  const prioColor = { critical:'#ef4444', high:'#f97316', medium:'#3b82f6', low:'#94a3b8' };
  const isOverdue = t.status !== 'completed' && t.deadline && new Date(t.deadline) < new Date();

  const statusBtns = Object.entries(TASK_STATUSES).map(([k,v]) => `
    <button onclick="changeTaskStatus(${t.id},'${k}')"
      style="font-size:11px;font-weight:700;padding:5px 12px;border-radius:6px;cursor:pointer;
             background:${t.status===k?v.bg:'transparent'};
             color:${t.status===k?v.color:'#8a9bbf'};
             border:1px solid ${t.status===k?v.color:'#2a3448'}">
      ${v.label}
    </button>`).join('');

  const commentItems = t.comments.length ? t.comments.map(c => `
    <div style="display:flex;gap:10px;margin-bottom:10px">
      <div style="width:28px;height:28px;border-radius:8px;background:#8b5cf6;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0">${getInitials(c.author)}</div>
      <div style="flex:1;background:#1c2333;border-radius:8px;padding:8px 12px">
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <span style="font-size:12px;font-weight:700;color:#e2e8f0">${c.author}</span>
          <span style="font-size:11px;color:#8a9bbf">${new Date(c.date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</span>
        </div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.5">${c.text}</div>
      </div>
    </div>`).join('')
    : '<div style="color:#8a9bbf;font-size:12px;padding:8px 0">Нет комментариев</div>';

  document.getElementById('taskModalContent').innerHTML = `
    <!-- Header -->
    <div style="margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <span class="task-type-badge">${t.type}</span>
        <span style="background:${cfg.bg};color:${cfg.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">${cfg.label}</span>
        <span style="font-size:12px;font-weight:700;color:${prioColor[t.priority]}">${TASK_PRIORITIES[t.priority]}</span>
        ${isOverdue?'<span style="background:rgba(239,68,68,0.15);color:#ef4444;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">⚠️ Просрочено</span>':''}
      </div>
      <h2 style="font-size:16px;font-weight:800;color:#f1f5f9;margin:0;line-height:1.4">${t.title}</h2>
    </div>

    <!-- Meta -->
    <div style="display:flex;flex-direction:column;gap:0;margin-bottom:16px;background:#1c2333;border-radius:10px;overflow:hidden">
      ${[
        ['Исполнитель', t.assignee],
        ['Автор',       t.author],
        ['Клиент',      t.relatedClient||'—'],
        ['Дедлайн',     t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}) : '—'],
        ['Создана',     t.created  ? new Date(t.created).toLocaleDateString('ru-RU') : '—'],
      ].map(([label,val]) => `
        <div style="display:flex;gap:12px;padding:9px 14px;border-bottom:1px solid #2a3448;font-size:13px">
          <span style="min-width:110px;color:#8a9bbf;font-weight:600;flex-shrink:0">${label}</span>
          <span style="color:#e2e8f0">${val}</span>
        </div>`).join('')}
    </div>

    ${t.description ? `<div style="font-size:13px;color:#94a3b8;line-height:1.6;background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:16px">${t.description}</div>` : ''}

    <!-- Status change -->
    <div style="background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:#8a9bbf;margin-bottom:8px">Сменить статус:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${statusBtns}</div>
    </div>

    <!-- Comments -->
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <i class="fas fa-comments" style="color:#3b82f6"></i> Комментарии (${t.comments.length})
      </div>
      <div id="taskCommentsList">${commentItems}</div>
      <div style="display:flex;gap:8px;align-items:center;background:#1c2333;border-radius:10px;padding:8px 12px;border:1px solid #2a3448;margin-top:10px">
        <div style="width:28px;height:28px;border-radius:8px;background:#3b82f6;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0">CO</div>
        <input id="newTaskComment" type="text" placeholder="Написать комментарий... (Enter для отправки)"
          style="flex:1;background:none;border:none;outline:none;color:#e2e8f0;font-size:13px"
          onkeydown="if(event.key==='Enter'){addTaskComment(${t.id});}" />
        <button onclick="addTaskComment(${t.id})"
          style="background:#3b82f6;border:none;border-radius:6px;color:#fff;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
    </div>

    <!-- Footer buttons -->
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:14px;border-top:1px solid #2a3448">
      <button onclick="openEditTaskModal(${t.id})"
        style="background:none;border:1px solid #2a3448;color:#94a3b8;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">
        <i class="fas fa-edit"></i> Редактировать
      </button>
      <button onclick="deleteTask(${t.id})"
        style="background:rgba(239,68,68,0.1);border:1px solid #ef4444;color:#ef4444;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">
        <i class="fas fa-trash"></i> Удалить
      </button>
      <button onclick="closeTaskModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        Закрыть
      </button>
    </div>`;
}

/* ── Create / Edit Mode ── */
function renderTaskModalCreate(prefill) {
  const t = prefill || {};
  document.getElementById('taskModalContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div class="kpi-icon blue" style="width:42px;height:42px;font-size:16px"><i class="fas fa-plus"></i></div>
      <h2 style="font-size:16px;font-weight:800;color:#f1f5f9;margin:0">${prefill?'Редактировать задачу':'Новая задача'}</h2>
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Заголовок *</label>
        <input id="tf_title" type="text" placeholder="Что нужно сделать?" value="${t.title||''}" />
      </div>
      <div class="form-group">
        <label>Тип задачи</label>
        <select id="tf_type">
          ${TASK_TYPES.map(tt => `<option ${(t.type||'')==tt?'selected':''}>${tt}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Приоритет</label>
        <select id="tf_priority">
          ${Object.entries(TASK_PRIORITIES).map(([k,v]) => `<option value="${k}" ${(t.priority||'medium')===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Исполнитель</label>
        <select id="tf_assignee">
          ${TASK_ASSIGNEES.map(a => `<option ${(t.assignee||'')==a?'selected':''}>${a}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Дедлайн</label>
        <input id="tf_deadline" type="date" value="${t.deadline||''}" />
      </div>
      <div class="form-group full">
        <label>Клиент / Компания</label>
        <input id="tf_client" type="text" placeholder="Название клиента" value="${t.relatedClient||''}" />
      </div>
      <div class="form-group full">
        <label>Описание</label>
        <textarea id="tf_desc" rows="3" placeholder="Подробное описание...">${t.description||''}</textarea>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:4px">
      <button onclick="closeTaskModal()"
        style="background:none;border:1px solid #2a3448;color:#94a3b8;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">
        Отмена
      </button>
      <button onclick="${prefill?`saveEditTask(${prefill.id})`:'saveNewTask()'}"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-check"></i> ${prefill?'Сохранить':'Создать'}
      </button>
    </div>`;
}

function openEditTaskModal(id) {
  const t = tasksData.find(x => x.id === id);
  if (!t) return;
  renderTaskModalCreate(t);
}

/* ─────────────────────────────────────────
   CRUD
───────────────────────────────────────── */
function saveNewTask() {
  const title = (document.getElementById('tf_title')?.value || '').trim();
  if (!title) { showToast('Введите заголовок задачи', 'red'); return; }
  const newTask = {
    id:            taskIdCounter++,
    title,
    type:          document.getElementById('tf_type')?.value     || 'Прочее',
    priority:      document.getElementById('tf_priority')?.value || 'medium',
    status:        'pending',
    assignee:      document.getElementById('tf_assignee')?.value || 'CO (Compliance Officer)',
    author:        currentUserRole || 'CO',
    relatedClient: document.getElementById('tf_client')?.value   || '',
    relatedModule: '',
    deadline:      document.getElementById('tf_deadline')?.value || '',
    created:       new Date().toISOString().split('T')[0],
    description:   document.getElementById('tf_desc')?.value     || '',
    comments:      [],
    attachments:   [],
  };
  tasksData.unshift(newTask);
  closeTaskModal();
  renderTasksPage();
  if (typeof updateBadges === 'function') updateBadges();
  showToast('✅ Задача создана: ' + title, 'green');
}

function addTask(fields) {
  fields = fields || {};
  const newTask = {
    id:            taskIdCounter++,
    title:         fields.title || 'Задача',
    type:          fields.type || 'Прочее',
    priority:      fields.priority || 'medium',
    status:        fields.status || 'pending',
    assignee:      fields.assignee || 'CO (Compliance Officer)',
    author:        fields.author || (typeof currentUserRole !== 'undefined' ? currentUserRole : 'CO'),
    relatedClient: fields.relatedClient || '',
    relatedModule: fields.relatedModule || '',
    deadline:      fields.deadline || '',
    created:       fields.created || today(),
    description:   fields.description || '',
    comments:      fields.comments || [],
    attachments:   fields.attachments || [],
  };
  tasksData.unshift(newTask);
  renderDashboardTasks();
  if (typeof updateBadges === 'function') updateBadges();
  return newTask;
}

function saveEditTask(id) {
  const t = tasksData.find(x => x.id === id);
  if (!t) return;
  const title = (document.getElementById('tf_title')?.value || '').trim();
  if (!title) { showToast('Введите заголовок', 'red'); return; }
  t.title         = title;
  t.type          = document.getElementById('tf_type')?.value     || t.type;
  t.priority      = document.getElementById('tf_priority')?.value || t.priority;
  t.assignee      = document.getElementById('tf_assignee')?.value || t.assignee;
  t.deadline      = document.getElementById('tf_deadline')?.value || t.deadline;
  t.relatedClient = document.getElementById('tf_client')?.value   || t.relatedClient;
  t.description   = document.getElementById('tf_desc')?.value     || t.description;
  closeTaskModal();
  renderTasksPage();
  showToast('✅ Задача обновлена', 'blue');
}

function changeTaskStatus(id, newStatus) {
  const t = tasksData.find(x => x.id === id);
  if (!t) return;
  t.status = newStatus;
  renderTaskModalView(t);
  renderTasksPage();
  if (typeof updateBadges === 'function') updateBadges();
  showToast('Статус: ' + TASK_STATUSES[newStatus].label, 'blue');
}

function quickChangeStatus(id) {
  const t = tasksData.find(x => x.id === id);
  if (!t) return;
  const order = ['pending','in_progress','review','completed'];
  const idx = order.indexOf(t.status);
  t.status = order[(idx + 1) % order.length];
  renderTasksPage();
  if (typeof updateBadges === 'function') updateBadges();
  showToast('Статус: ' + TASK_STATUSES[t.status].label, 'blue');
}

function addTaskComment(id) {
  const t     = tasksData.find(x => x.id === id);
  const input = document.getElementById('newTaskComment');
  if (!t || !input) return;
  const text = input.value.trim();
  if (!text) return;
  t.comments.push({
    id:     Date.now(),
    author: (typeof currentUserRole !== 'undefined' ? currentUserRole : 'CO').split(' ')[0],
    date:   new Date().toISOString().split('T')[0],
    text,
  });
  input.value = '';
  renderTaskModalView(t);
  showToast('💬 Комментарий добавлен', 'green');
}

function deleteTask(id) {
  if (!confirm('Удалить задачу?')) return;
  tasksData = tasksData.filter(t => t.id !== id);
  closeTaskModal();
  renderTasksPage();
  if (typeof updateBadges === 'function') updateBadges();
  showToast('🗑 Задача удалена', 'red');
}

function quickDeleteTask(id) {
  if (!confirm('Удалить задачу?')) return;
  tasksData = tasksData.filter(t => t.id !== id);
  renderTasksPage();
  if (typeof updateBadges === 'function') updateBadges();
  showToast('🗑 Задача удалена', 'red');
}

/* ─────────────────────────────────────────
   FILTERS & VIEW
───────────────────────────────────────── */
function setTasksView(view) {
  tasksView = view;
  document.querySelectorAll('.task-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderTasksPage();
}

function filterTasks(key, val) {
  tasksFilter[key] = val;
  renderTasksPage();
}

function searchTasksQ(q) {
  // filter inline without persistent state
  const all = tasksData.filter(t =>
    !q ||
    t.title.toLowerCase().includes(q.toLowerCase()) ||
    (t.relatedClient||'').toLowerCase().includes(q.toLowerCase())
  );
  // temporarily render with filtered data
  const saved = tasksData;
  tasksData = all;
  renderTasksPage();
  tasksData = saved;
}

/* ─────────────────────────────────────────
   DASHBOARD WIDGET
───────────────────────────────────────── */
function renderDashboardTasks() {
  const el = document.getElementById('dashTasksList');
  if (!el) return;
  const prioWeight = { critical:4, high:3, medium:2, low:1 };
  const urgent = tasksData
    .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
    .sort((a,b) => (prioWeight[b.priority]||0) - (prioWeight[a.priority]||0))
    .slice(0, 5);

  if (!urgent.length) {
    el.innerHTML = '<div style="color:#8a9bbf;font-size:12px;padding:16px">Нет активных задач</div>';
    return;
  }
  const prioColor = { critical:'#ef4444', high:'#f97316', medium:'#3b82f6', low:'#94a3b8' };
  el.innerHTML = urgent.map(t => {
    const cfg = TASK_STATUSES[t.status];
    const isOverdue = t.deadline && new Date(t.deadline) < new Date();
    return `
      <div class="dash-task-item" onclick="navigateTo('tasks');setTimeout(()=>openTaskModal(${t.id}),200)" style="cursor:pointer">
        <div class="dash-task-prio" style="background:${prioColor[t.priority]}"></div>
        <div class="dash-task-body">
          <div class="dash-task-title">${t.title}</div>
          <div class="dash-task-meta">
            <span style="color:${cfg.color};font-size:11px">${cfg.label}</span>
            <span style="color:#8a9bbf;font-size:11px"> · ${t.assignee.split(' ')[0]}</span>
            ${isOverdue?'<span style="color:#ef4444;font-size:11px"> · Просрочено!</span>':''}
          </div>
        </div>
        <div class="dash-task-deadline" style="color:${isOverdue?'#ef4444':'#8a9bbf'}">
          ${t.deadline?new Date(t.deadline).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}):''}
        </div>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function getInitials(name) {
  if (!name) return '?';
  return name.split(/[\s(]+/).slice(0,2).map(p => p[0]||'').join('').toUpperCase();
}
