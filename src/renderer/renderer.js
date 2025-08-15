/* Preload guard */
if (!('api' in window)) {
  alert('Failed to load preload bridge. Buttons will not work.\nCheck main.js preload path.');
}

/* global api */
const state = {
  db: null,
  view: { type: 'today', projectId: null },
  showCompleted: false,
  security: { encryptionEnabled: false, useBiometrics: false, biometricsAvailable: false },
  unlocked: false,
};

const el = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

/* ---- Titlebar window controls ---- */
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.querySelector('.tb-close');
  const minBtn = document.querySelector('.tb-min');
  const maxBtn = document.querySelector('.tb-max');
  const bar = document.getElementById('titlebar');

  closeBtn?.addEventListener('click', () => api.windowControls.close());
  minBtn?.addEventListener('click', () => api.windowControls.minimize());
  maxBtn?.addEventListener('click', () => api.windowControls.toggleMaximize());
  bar?.addEventListener('dblclick', () => api.windowControls.toggleMaximize());
});

document.addEventListener('DOMContentLoaded', init);

async function init() {
  state.security = await api.securityGetConfig();

  if (state.security.encryptionEnabled) {
    await unlockFlow();
  } else {
    // Offer to enable encryption on first run
    await maybeEnableEncryptionFlow();
  }

  await loadAndRender();
  bindNav();
  bindInputs();
}

/* ---------- Security flows ---------- */
async function unlockFlow() {
  // Simple passcode modal; if biometrics is enabled, Touch ID prompt will appear in main before unlocking.
  const pass = await promptModal({
    title: 'Unlock',
    bodyHTML: `
      <p>Enter your passcode to decrypt your tasks.</p>
      <input id="pass" type="password" placeholder="Passcode" autofocus />
    `,
    okText: 'Unlock',
  });
  if (!pass) return; // user cancelled — they’ll see empty UI; can refresh to retry

  try {
    const res = await api.securityUnlock(pass);
    if (res?.ok) state.unlocked = true;
  } catch (e) {
    alert('Unlock failed. Try again.');
    return unlockFlow();
  }
}

async function maybeEnableEncryptionFlow() {
  const yes = confirm(
    'Encrypt your data at rest? (Recommended)\nYou can enable this later in code, but doing it now is best.',
  );
  if (!yes) return;
  const { value: pass, canceled } = await promptModalWithReturn({
    title: 'Enable Encryption',
    bodyHTML: `
      <p>Create a passcode (min 4 chars). Don’t forget it — you’ll need it to unlock and restore backups.</p>
      <input id="pass" type="password" placeholder="Passcode" autofocus />
      <label><input id="bio" type="checkbox" /> Use Touch ID on this Mac</label>
    `,
    okText: 'Enable',
  });
  if (canceled) return;
  const useBio = el('#bio')?.checked || false;
  const p = String(pass || '').trim();
  if (p.length < 4) {
    alert('Passcode must be at least 4 characters.');
    return maybeEnableEncryptionFlow();
  }
  await api.securityEnable(p, useBio);
  state.unlocked = true;
}

/* ---------- Modal helpers ---------- */
function promptModal({ title, bodyHTML, okText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const modal = el('#modal');
    el('#modal-title').textContent = title;
    el('#modal-body').innerHTML = bodyHTML;
    modal.classList.remove('hidden');

    const ok = el('#modal-ok');
    const cancel = el('#modal-cancel');
    ok.textContent = okText;
    cancel.textContent = cancelText;

    const finish = (val) => {
      modal.classList.add('hidden');
      resolve(val);
    };

    ok.onclick = () => {
      const pass = el('#pass')?.value;
      finish(pass ?? true);
    };
    cancel.onclick = () => finish(null);
  });
}
function promptModalWithReturn(opts) {
  return new Promise((resolve) => {
    const modal = el('#modal');
    el('#modal-title').textContent = opts.title;
    el('#modal-body').innerHTML = opts.bodyHTML;
    modal.classList.remove('hidden');

    const ok = el('#modal-ok');
    const cancel = el('#modal-cancel');
    ok.textContent = opts.okText || 'OK';
    cancel.textContent = opts.cancelText || 'Cancel';

    const finish = (value, canceled = false) => {
      modal.classList.add('hidden');
      resolve({ value, canceled });
    };
    ok.onclick = () => finish(el('#pass')?.value ?? '');
    cancel.onclick = () => finish('', true);
  });
}

/* ---------- Binding ---------- */
function bindNav() {
  els('.nav-item').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.view;
      if (v === 'today' || v === 'week' || v === 'all') {
        state.view = { type: v, projectId: null };
        renderAll();
      }
    });
  });

  el('#add-project-btn').addEventListener('click', async () => {
    const name = prompt('New project name:');
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    try {
      const created = await api.addProject(trimmed);
      await loadAndRender();
      if (created?.id) {
        state.view = { type: 'project', projectId: created.id };
        renderAll();
      }
    } catch (err) {
      console.error('addProject failed:', err);
      alert(`Failed to add project: ${err?.message || err}`);
    }
  });

  el('#export-btn').addEventListener('click', async () => {
    const res = await api.exportBackup();
    if (res?.ok) alert(`Backup saved to:\n${res.filePath}`);
  });

  el('#import-btn').addEventListener('click', async () => {
    const res = await api.importBackup();
    if (res?.ok) {
      await loadAndRender();
      alert('Backup restored.');
    }
  });

  el('#toggle-completed').addEventListener('change', (e) => {
    state.showCompleted = !!e.target.checked;
    renderTasks();
  });

  el('#view-completed-btn').addEventListener('click', () => {
    state.showCompleted = !state.showCompleted;
    el('#toggle-completed').checked = state.showCompleted;
    renderTasks();
  });
}

function bindInputs() {
  el('#add-task-btn').addEventListener('click', onAddTask);
}

/* ---------- Data ---------- */
async function loadAndRender() {
  state.db = await api.loadDB();
  renderAll();
}

/* ---------- Rendering ---------- */
function renderAll() {
  renderProjects();
  renderNewTaskProjectSelect();
  renderHeaderTitle();
  renderTasks();
}

function renderProjects() {
  const ul = el('#project-list');
  ul.innerHTML = '';
  const projects = [...(state.db?.projects || [])];

  projects.forEach((p) => {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.className = 'project-item';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      state.view = { type: 'project', projectId: p.id };
      renderAll();
    });

    const kebab = document.createElement('button');
    kebab.textContent = '⋯';
    kebab.title = 'Project menu';
    kebab.addEventListener('click', async (e) => {
      e.stopPropagation();
      const choice = projectMenu();
      if (choice === 'rename') {
        const name = prompt('Rename project:', p.name);
        if (name && name.trim()) {
          await api.renameProject(p.id, name.trim());
          await loadAndRender();
        }
      } else if (choice === 'delete') {
        if (p.id === 'inbox') return alert('Cannot delete Inbox');
        const ok = confirm(`Delete "${p.name}"? Tasks will move to Inbox.`);
        if (ok) {
          await api.deleteProject(p.id);
          await loadAndRender();
        }
      }
    });

    li.appendChild(btn);
    li.appendChild(kebab);
    ul.appendChild(li);
  });
}

function projectMenu() {
  const r = prompt('Project action: type "rename" or "delete"');
  if (r === 'rename' || r === 'delete') return r;
  return null;
}

function renderNewTaskProjectSelect() {
  const sel = el('#new-project');
  sel.innerHTML = '';
  (state.db?.projects || []).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (state.view.type === 'project' && state.view.projectId) sel.value = state.view.projectId;
  else sel.value = 'inbox';
}

function renderHeaderTitle() {
  const h = el('#view-title');
  if (state.view.type === 'today') h.textContent = 'Today';
  else if (state.view.type === 'week') h.textContent = 'Week';
  else if (state.view.type === 'all') h.textContent = 'All tasks';
  else {
    const p = (state.db?.projects || []).find((x) => x.id === state.view.projectId);
    h.textContent = p ? p.name : 'Project';
  }
}

function renderTasks() {
  const container = el('#task-container');
  container.innerHTML = '';

  if (state.view.type === 'week') return renderWeekList(container);

  const tasks = getFilteredTasks();
  if (!tasks.length) {
    container.innerHTML = `<div style="padding:16px;color:#8a94a6;">No tasks yet.</div>`;
    return;
  }
  tasks.forEach((t) => container.appendChild(renderTaskItem(t)));
}

/* ---------- NEW: Todoist-like vertical Week view ---------- */
function renderWeekList(container) {
  const list = document.createElement('div');
  list.className = 'week-list';

  const today = startOfDay(new Date());

  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const ymd = dateToYMD(d);

    const section = document.createElement('section');
    section.className = 'day-section';

    const header = document.createElement('header');
    header.className = 'day-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'day-name';
    nameSpan.textContent = d.toLocaleDateString(undefined, { weekday: 'short' });

    const dateSpan = document.createElement('span');
    dateSpan.className = 'day-date';
    dateSpan.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    header.appendChild(nameSpan);
    header.appendChild(dateSpan);
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'day-body';

    const tasks = (state.db?.tasks || [])
      .filter((t) => (state.showCompleted ? true : !t.completed))
      .filter((t) => t.dueDate === ymd);

    if (!tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.textContent = '—';
      body.appendChild(empty);
    } else {
      sortTasks(tasks).forEach((t) => body.appendChild(renderTaskItem(t)));
    }

    section.appendChild(body);
    list.appendChild(section);
  }

  container.appendChild(list);
}

/* ---------- Task item ---------- */
function renderTaskItem(t) {
  const tpl = el('#task-item-template');
  const node = tpl.content.firstElementChild.cloneNode(true);

  const cb = node.querySelector('.complete-checkbox');
  cb.checked = !!t.completed;
  cb.addEventListener('change', async () => {
    await api.updateTask({ id: t.id, completed: cb.checked });
    await loadAndRender();
  });

  node.querySelector('.task-title').textContent = t.title;

  const meta = node.querySelector('.task-meta');
  meta.innerHTML = '';
  if (t.projectId) {
    const p = (state.db?.projects || []).find((x) => x.id === t.projectId);
    if (p) meta.appendChild(chip(p.name));
  }
  if (t.dueDate) meta.appendChild(chip(`Due ${formatYMD(t.dueDate)}`));
  if (t.priority) meta.appendChild(chip(`P${t.priority}`));
  (t.tags || []).forEach((tag) => meta.appendChild(chip(`#${tag}`)));
  if (t.completed && t.dateCompleted)
    meta.appendChild(chip(`Done ${formatDateTime(t.dateCompleted)}`));

  const editBtn = node.querySelector('.edit-btn');
  const delBtn = node.querySelector('.delete-btn');

  editBtn.addEventListener('click', async () => {
    const newTitle = prompt('Title:', t.title);
    if (newTitle == null) return;
    const newDesc = prompt('Description:', t.description || '');
    if (newDesc == null) return;
    const newDue = prompt('Due date (YYYY-MM-DD or blank):', t.dueDate || '');
    const newPriority = prompt('Priority (0-3):', String(t.priority ?? 0));
    const newTags = prompt('Tags (comma-separated):', (t.tags || []).join(', '));
    const projName = prompt('Project (type exact name):', getProjectName(t.projectId));

    const projectId = projectIdByName(projName?.trim()) ?? t.projectId;

    const dueTrim = (newDue ?? '').trim();
    const dueValid = !dueTrim || /^\d{4}-\d{2}-\d{2}$/.test(dueTrim);
    if (!dueValid) {
      alert('Invalid date. Use YYYY-MM-DD or leave blank.');
      return;
    }

    const pr = Number(newPriority);
    if (!Number.isInteger(pr) || pr < 0 || pr > 3) {
      alert('Priority must be an integer between 0 and 3.');
      return;
    }

    await api
      .updateTask({
        id: t.id,
        title: newTitle,
        description: newDesc,
        dueDate: dueTrim ? dueTrim : null,
        priority: pr,
        tags: (newTags || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        projectId,
      })
      .catch((err) => {
        console.error('updateTask failed', err);
        alert('Failed to update task. Check console for details.');
      });
    await loadAndRender();
  });

  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this task?')) return;
    await api.deleteTask(t.id);
    await loadAndRender();
  });

  return node;
}

function chip(text) {
  const span = document.createElement('span');
  span.className = 'chip';
  span.textContent = text;
  return span;
}

/* ---------- Filtering ---------- */
function getFilteredTasks() {
  const all = state.db?.tasks || [];
  if (state.view.type === 'all') {
    return sortTasks(all.filter((t) => state.showCompleted || !t.completed));
  }
  if (state.view.type === 'project') {
    const filtered = all.filter((t) => t.projectId === state.view.projectId);
    return sortTasks(filtered.filter((t) => state.showCompleted || !t.completed));
  }
  if (state.view.type === 'today') {
    const ymd = dateToYMD(new Date());
    const filtered = all.filter((t) => {
      if (!state.showCompleted && t.completed) return false;
      if (t.dueDate) return t.dueDate <= ymd;
      return true;
    });
    return sortTasks(filtered);
  }
  return sortTasks(all.filter((t) => state.showCompleted || !t.completed));
}

/* ---------- Add Task ---------- */
async function onAddTask() {
  const title = el('#new-title').value.trim();
  if (!title) {
    alert('Title is required');
    return;
  }
  const dueDate = el('#new-due').value || null;
  const priority = Number(el('#new-priority').value || '0');
  const tags = (el('#new-tags').value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const projectId = el('#new-project').value || 'inbox';

  // Basic validation for add
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    alert('Invalid date. Use YYYY-MM-DD or leave blank.');
    return;
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 3) {
    alert('Priority must be an integer between 0 and 3.');
    return;
  }

  let created;
  try {
    created = await api.addTask({ title, dueDate, priority, tags, projectId });
  } catch (e) {
    console.error('addTask failed', e);
    alert('Failed to add task. See console for details.');
    return;
  }

  el('#new-title').value = '';
  el('#new-due').value = '';
  el('#new-tags').value = '';
  await loadAndRender();

  if (created?.dueDate) {
    const todayYMD = dateToYMD(new Date());
    const inNext7 =
      created.dueDate >= todayYMD && created.dueDate <= dateToYMD(addDays(new Date(), 6));
    if (inNext7) {
      state.view = { type: 'week', projectId: null };
    } else {
      state.view = { type: 'project', projectId: created.projectId || 'inbox' };
    }
  } else {
    // No due date -> All is safest to ensure visibility
    state.view = { type: 'all', projectId: null };
  }
  renderAll();
}

/* ---------- Utilities ---------- */
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function dateToYMD(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatYMD(s) {
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}
function formatDateTime(s) {
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return s;
  }
}
function sortTasks(arr) {
  return arr.slice().sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) {
      if (a.dueDate < b.dueDate) return -1;
      if (a.dueDate > b.dueDate) return 1;
    } else if (a.dueDate && !b.dueDate) return -1;
    else if (!a.dueDate && b.dueDate) return 1;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}
function getProjectName(id) {
  return (state.db?.projects || []).find((p) => p.id === id)?.name || 'Inbox';
}
function projectIdByName(name) {
  if (!name) return null;
  const p = (state.db?.projects || []).find((p) => p.name.toLowerCase() === name.toLowerCase());
  return p?.id || null;
}

/* Global error surfacing */
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  alert('Something went wrong. Check the console for details.');
});
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error || e.message);
});
