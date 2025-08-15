/* Preload guard */
if (!('api' in window)) {
  alert('Failed to load preload bridge. Buttons will not work.\nCheck main.js preload path.');
}

/* global api */
const state = {
  db: null,
  view: { type: 'today', projectId: null },
  showCompleted: false,
  searchQuery: '',
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
  console.log('Unlock flow started, security config:', state.security);
  
  // If biometrics are enabled, try them first without showing passcode modal
  if (state.security.useBiometrics && state.security.biometricsAvailable) {
    try {
      console.log('Attempting biometric unlock...');
      const res = await api.securityUnlock(null); // Pass null to try biometrics first
      console.log('Biometric unlock result:', res);
      if (res && res.ok === false && res.code === 'NO_BIO_KEY') {
        const choice = confirm(
          'Touch ID succeeded, but no decryption key was found in your Keychain.\n\nThis usually happens if encryption was enabled without saving the key to Keychain, or the item was deleted.\n\nClick OK to use your passcode this time (and reseed the Keychain), or Cancel to abort.'
        );
        if (!choice) return; // user canceled
        // fall through to passcode modal (do not auto-open without consent)
      } else if (res && res.ok === false && res.code === 'NEED_PASSCODE') {
        // Biometric path didn’t complete; proceed to passcode modal.
      } else if (res && res.ok === false) {
        alert(`Unlock failed: ${res.code || 'Unknown error'}`);
        return; // abort
      }
      if (res?.ok) {
        console.log('Biometric unlock successful');
        state.unlocked = true;
        return; // Exit here, don't show passcode modal
      }
    } catch (e) {
      console.log('Biometrics failed, falling back to passcode:', e.message);
      // Continue to passcode modal only if biometrics actually failed
    }
  }
  
  // Only show passcode modal if biometrics are not enabled or user agreed to use passcode after a biometric issue.
  console.log('Showing passcode modal...');
  const pass = await promptModal({
    title: 'Unlock',
    bodyHTML: `
      <p>Enter your passcode to decrypt your tasks.</p>
      <input id="pass" type="password" placeholder="Passcode" autofocus />
    `,
    okText: 'Unlock',
  });
  if (!pass) {
    await handleForgotPasscode();
    return;
  }

  try {
    const res = await api.securityUnlock(pass);
    if (res?.ok) {
      console.log('Passcode unlock successful');
      state.unlocked = true;
    }
  } catch (e) {
    console.error('Passcode unlock failed:', e);
    alert('Unlock failed.');
    await handleForgotPasscode();
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

async function handleForgotPasscode() {
  const choice = await promptModalWithReturn({
    title: 'Forgot Passcode?',
    bodyHTML: `
      <p>You can create a new empty environment or restore from a backup file.</p>
    `,
    okText: 'Create New',
    cancelText: 'Restore Backup',
  });

  if (choice.canceled) {
    // Restore from backup
    const res = await api.importBackup();
    if (res?.ok) {
      location.reload();
      return;
    }
  } else {
    // Create new environment
    const sure = confirm('This will erase your existing data. Continue?');
    if (sure) {
      await api.resetEnvironment();
      location.reload();
      return;
    }
  }

  // If we get here, user canceled restore/reset. Retry unlock flow.
  return unlockFlow();
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

    // Handle Enter key submission
    const handleKeyPress = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ok.click();
      }
    };

    // Add keypress listeners to all input fields
    const inputs = modal.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
      input.addEventListener('keypress', handleKeyPress);
    });

    // Focus the first input with autofocus or the first input available
    setTimeout(() => {
      const autofocusInput = modal.querySelector('[autofocus]');
      const firstInput = modal.querySelector('input, textarea, select');
      if (autofocusInput) {
        autofocusInput.focus();
      } else if (firstInput) {
        firstInput.focus();
      }
    }, 100);

    ok.onclick = () => {
      // Check for different input types
      const projectName = el('#project-name')?.value;
      const editTitle = el('#edit-title')?.value;
      const pass = el('#pass')?.value;
      
      // Return the appropriate value based on what's in the modal
      if (projectName !== undefined) finish(projectName);
      else if (editTitle !== undefined) finish(true); // For edit modals, just return true
      else if (pass !== undefined) finish(pass);
      else finish(true); // Default fallback
    };
    cancel.onclick = () => finish(null);

    // Clean up event listeners when modal is closed
    const cleanup = () => {
      inputs.forEach(input => {
        input.removeEventListener('keypress', handleKeyPress);
      });
    };
    
    // Store cleanup function on modal element for later use
    modal._cleanup = cleanup;
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
    const name = await promptModal({
      title: 'New Project',
      bodyHTML: `
        <div class="form-group">
          <label for="project-name">Project Name</label>
          <input id="project-name" type="text" placeholder="Enter project name" autofocus />
        </div>
      `,
      okText: 'Create',
    });
    
    if (!name) return; // user cancelled
    
    const trimmed = name.trim();
    if (!trimmed) {
      alert('Project name cannot be empty');
      return;
    }
    
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

  el('#view-completed-btn').addEventListener('click', () => {
    state.showCompleted = !state.showCompleted;
    el('#toggle-completed').checked = state.showCompleted;
    renderAll();
  });
  
}

function bindInputs() {
  // Handle search input
  const search = el('#search');
  search?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    renderTasks();
  });

  // Handle Enter key submission for new task
  el('#new-title').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      onAddTask();
    }
  });

  // Handle option button clicks
  bindOptionButtons();
}

function bindOptionButtons() {
  // Due date button
  el('#due-date-btn').addEventListener('click', () => {
    toggleOptionInput('due-date-input', 'due-date-btn');
  });
  
  // Priority button
  el('#priority-btn').addEventListener('click', () => {
    toggleOptionInput('priority-input', 'priority-btn');
  });
  
  // Tags button
  el('#tags-btn').addEventListener('click', () => {
    toggleOptionInput('tags-input', 'tags-btn');
  });
  
  // Project button
  el('#project-btn').addEventListener('click', () => {
    toggleOptionInput('project-input', 'project-btn');
  });
  
  // Close option inputs when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.option-group')) {
      closeAllOptionInputs();
    }
  });
}

function toggleOptionInput(inputId, buttonId) {
  const input = el(`#${inputId}`);
  const button = el(`#${buttonId}`);
  
  // Close all other inputs first
  closeAllOptionInputs();
  
  // Toggle this input
  if (input.style.display === 'none') {
    input.style.display = 'block';
    button.classList.add('active');
    
    // Focus the first input in the expanded section
    const firstInput = input.querySelector('input, select');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  } else {
    input.style.display = 'none';
    button.classList.remove('active');
  }
}

function closeAllOptionInputs() {
  const inputs = els('.option-input');
  const buttons = els('.option-btn');
  
  inputs.forEach(input => {
    input.style.display = 'none';
  });
  
  buttons.forEach(button => {
    button.classList.remove('active');
  });
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
  syncCompletedToggle();
}

function syncCompletedToggle() {
  // Only sync with the bottom toggle since we removed the top one
  // The bottom toggle is handled by the view-completed-btn click handler
  // No need to sync anything here anymore
}

function renderProjects() {
  const ul = el('#project-list');
  ul.innerHTML = '';
  const projects = [...(state.db?.projects || [])];
  
  projects.forEach((p) => {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.className = 'project-item';
    if (p.id === 'inbox') {
      btn.className += ' inbox-project';
      btn.title = 'Default project (cannot be deleted)';
    }
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
      const choice = await projectMenu(p.id === 'inbox');
      if (choice === 'rename') {
        const name = await promptModal({
          title: 'Rename Project',
          bodyHTML: `
            <div class="form-group">
              <label for="project-name">New Name</label>
              <input id="project-name" type="text" value="${p.name}" autofocus />
            </div>
          `,
          okText: 'Rename',
        });
        if (name && name.trim()) {
          const trimmed = name.trim();
          if (trimmed === p.name) return; // No change
          if (!trimmed) {
            alert('Project name cannot be empty');
            return;
          }
          await api.renameProject(p.id, trimmed);
          await loadAndRender();
        }
      } else if (choice === 'delete') {
        if (p.id === 'inbox') return; // This should never happen now, but safety check
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

function projectMenu(isInbox = false) {
  return new Promise((resolve) => {
    const modal = el('#modal');
    el('#modal-title').textContent = 'Project Action';
    el('#modal-body').innerHTML = `
      <p>Choose an action:</p>
      <div class="form-group" style="margin-top: 16px;">
        <button id="rename-action" class="modal-actions button" style="width: 100%; margin-bottom: 8px; padding: 12px;">Rename Project</button>
        <button id="delete-action" class="modal-actions button" style="width: 100%; padding: 12px; ${isInbox ? 'display: none;' : ''}">Delete Project</button>
      </div>
    `;
    modal.classList.remove('hidden');

    const renameBtn = el('#rename-action');
    const deleteBtn = el('#delete-action');
    const cancel = el('#modal-cancel');

    const finish = (choice) => {
      modal.classList.add('hidden');
      resolve(choice);
    };

    renameBtn.onclick = () => finish('rename');
    deleteBtn.onclick = () => finish('delete');
    cancel.onclick = () => finish(null);

    // Hide delete button for inbox project
    if (isInbox) {
      deleteBtn.style.display = 'none';
    }
  });
}

function renderNewTaskProjectSelect() {
  const sel = el('#new-project');
  sel.innerHTML = '';
  const projects = state.db?.projects || [];
  
  projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (state.view.type === 'project' && state.view.projectId) sel.value = state.view.projectId;
  else sel.value = 'inbox';
  
  // Set default due date to today only when on "Today" view
  const dueDateInput = el('#new-due');
  if (dueDateInput) {
    if (state.view.type === 'today') {
      dueDateInput.value = dateToYMD(new Date());
    } else {
      dueDateInput.value = ''; // No default for other views
    }
  }
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

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    const tasks = (state.db?.tasks || []).filter((t) =>
      t.title.toLowerCase().includes(q)
    );
    if (!tasks.length) {
      container.innerHTML = `<div style="padding:16px;color:#8a94a6;">No matching tasks.</div>`;
      return;
    }
    sortTasks(tasks).forEach((t) => container.appendChild(renderTaskItem(t)));
    return;
  }

  if (state.view.type === 'week') {
    return renderWeekList(container);
  }

  const tasks = getFilteredTasks();

  if (!tasks.length) {
    container.innerHTML = `<div style="padding:16px;color:#8a94a6;">No tasks yet.</div>`;
    return;
  }
  tasks.forEach((t) => container.appendChild(renderTaskItem(t)));
}

/* ---------- NEW: Vertical Week view ---------- */
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

    console.log(`Day ${ymd}: showCompleted=${state.showCompleted}, total tasks=${tasks.length}, completed=${tasks.filter(t => t.completed).length}`);

    // Add tasks first
    if (tasks.length > 0) {
      sortTasks(tasks).forEach((t) => body.appendChild(renderTaskItem(t)));
    }

    // Add task creation input inline (always show)
    const taskInput = document.createElement('div');
    taskInput.className = 'day-task-input';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a task...';
    input.className = 'day-task-title-input';
    
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.className = 'day-task-add-btn';
    addBtn.title = 'Add task';
    addBtn.disabled = true; // Start disabled
    
    // Handle task creation for this specific day
    const handleAddTask = async () => {
      const title = input.value.trim();
      if (!title) return;
      
      try {
        const created = await api.addTask({
          title,
          dueDate: ymd, // Set due date to this specific day
          priority: 0,
          tags: [],
          projectId: 'inbox'
        });
        
        // Clear input and refresh
        input.value = '';
        addBtn.disabled = true; // Disable button after clearing
        await loadAndRender();
        
        // No need to change view or re-render since we're already in week view
      } catch (err) {
        console.error('Failed to add task:', err);
        alert(`Failed to add task: ${err?.message || err}`);
      }
    };
    
    // Enable/disable button based on input text
    const updateButtonState = () => {
      addBtn.disabled = !input.value.trim();
    };
    
    input.addEventListener('input', updateButtonState);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        handleAddTask();
      }
    });
    
    addBtn.addEventListener('click', handleAddTask);
    
    taskInput.appendChild(input);
    taskInput.appendChild(addBtn);
    body.appendChild(taskInput);

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
  
  // Add priority indicator
  if (t.priority > 0) {
    const priorityIndicator = document.createElement('span');
    priorityIndicator.className = `priority-indicator p${t.priority}`;
    priorityIndicator.title = `Priority ${t.priority}`;
    meta.appendChild(priorityIndicator);
  }
  
  if (t.projectId) {
    const p = (state.db?.projects || []).find((x) => x.id === t.projectId);
    if (p) meta.appendChild(chip(p.name));
  }
  if (t.dueDate) meta.appendChild(chip(`Due ${formatYMD(t.dueDate)}`));
  if (t.priority > 0) {
    const priorityChip = chip(`P${t.priority}`);
    priorityChip.className += ` priority-${t.priority}`;
    meta.appendChild(priorityChip);
  }
  (t.tags || []).forEach((tag) => meta.appendChild(chip(`#${tag}`)));
  if (t.completed && t.dateCompleted)
    meta.appendChild(chip(`Done ${formatDateTime(t.dateCompleted)}`));

  const editBtn = node.querySelector('.edit-btn');
  const delBtn = node.querySelector('.delete-btn');

  editBtn.addEventListener('click', async () => {
    const editResult = await promptModal({
      title: 'Edit Task',
      bodyHTML: `
        <div class="form-group">
          <label for="edit-title">Title</label>
          <input id="edit-title" type="text" value="${t.title}" />
        </div>
        <div class="form-group">
          <label for="edit-description">Description</label>
          <textarea id="edit-description">${t.description || ''}</textarea>
        </div>
        <div class="form-group">
          <label for="edit-due">Due Date</label>
          <input id="edit-due" type="date" value="${t.dueDate || ''}" />
        </div>
        <div class="form-group">
          <label for="edit-priority">Priority</label>
          <select id="edit-priority">
            <option value="0" ${t.priority === 0 ? 'selected' : ''}>None</option>
            <option value="1" ${t.priority === 1 ? 'selected' : ''} style="color: var(--priority-1); font-weight: 600;">1</option>
            <option value="2" ${t.priority === 2 ? 'selected' : ''} style="color: var(--priority-2); font-weight: 600;">2</option>
            <option value="3" ${t.priority === 3 ? 'selected' : ''} style="color: var(--priority-3); font-weight: 600;">3</option>
          </select>
        </div>
        <div class="form-group">
          <label for="edit-tags">Tags (comma-separated)</label>
          <input id="edit-tags" type="text" value="${(t.tags || []).join(', ')}" />
        </div>
        <div class="form-group">
          <label for="edit-project">Project</label>
          <select id="edit-project">
            ${(state.db?.projects || []).map(p => 
              `<option value="${p.id}" ${p.id === t.projectId ? 'selected' : ''}>${p.name}</option>`
            ).join('')}
          </select>
        </div>
      `,
      okText: 'Save',
    });
    
    if (!editResult) return; // user cancelled
    
    const newTitle = el('#edit-title')?.value;
    const newDesc = el('#edit-description')?.value;
    const newDue = el('#edit-due')?.value;
    const newPriority = el('#edit-priority')?.value;
    const newTags = el('#edit-tags')?.value;
    const newProjectId = el('#edit-project')?.value;
    
    if (!newTitle || !newTitle.trim()) {
      alert('Title is required');
      return;
    }

    // Date picker validation is simpler - it's either empty or a valid date
    const dueTrim = newDue?.trim() || '';
    const dueValid = !dueTrim || /^\d{4}-\d{2}-\d{2}$/.test(dueTrim);
    if (!dueValid) {
      alert('Invalid date format.');
      return;
    }

    const pr = Number(newPriority);
    if (!Number.isInteger(pr) || pr < 0 || pr > 3) {
      alert('Priority must be an integer between 0 and 3.');
      return;
    }

    const updateData = {
      id: t.id,
      title: newTitle.trim(),
      description: newDesc || '',
      dueDate: dueTrim ? dueTrim : null,
      priority: pr,
      tags: newTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      projectId: newProjectId,
    };

    console.log('Updating task with data:', updateData);

    await api
      .updateTask(updateData)
      .catch((err) => {
        console.error('updateTask failed', err);
        alert('Failed to update task. Check console for details.');
      });
    
    // Close the modal and refresh the view
    await loadAndRender();
    
    // If we're in week view and the date changed, make sure to stay in week view
    if (state.view.type === 'week' && updateData.dueDate !== t.dueDate) {
      // The task might have moved to a different day, so refresh week view
      state.view = { type: 'week', projectId: null };
      renderAll();
    }
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
    const filtered = sortTasks(all.filter((t) => state.showCompleted || !t.completed));
    return filtered;
  }
  if (state.view.type === 'project') {
    const filtered = all.filter((t) => t.projectId === state.view.projectId);
    const result = sortTasks(filtered.filter((t) => state.showCompleted || !t.completed));
    return result;
  }
  if (state.view.type === 'today') {
    const ymd = dateToYMD(new Date());
    const filtered = all.filter((t) => {
      if (!state.showCompleted && t.completed) return false;
      if (t.dueDate) return t.dueDate <= ymd;
      return true;
    });
    const result = sortTasks(filtered);
    return result;
  }
  const result = sortTasks(all.filter((t) => state.showCompleted || !t.completed));
  return result;
}

/* ---------- Add Task ---------- */
async function onAddTask() {
  const title = el('#new-title').value.trim();
  if (!title) {
    alert('Title is required');
    return;
  }
  
  // Get values from option inputs (they might be hidden)
  const dueDate = el('#new-due')?.value || null;
  const priority = Number(el('#new-priority')?.value || '0');
  const tags = (el('#new-tags')?.value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const projectId = el('#new-project')?.value || 'inbox';

  // Basic validation for add
  // Date picker validation is simpler - it's either empty or a valid date
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    alert('Invalid date format.');
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

  // Clear inputs and close option panels
  el('#new-title').value = '';
  if (el('#new-due')) el('#new-due').value = ''; // Clear due date instead of setting to today
  if (el('#new-tags')) el('#new-tags').value = '';
  closeAllOptionInputs();
  
  await loadAndRender();

  // Don't change the view - stay on whatever view the user was on
  // renderAll(); // This is already called by loadAndRender()
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
  const sorted = arr.slice().sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) {
      if (a.dueDate < b.dueDate) return -1;
      if (a.dueDate > b.dueDate) return 1;
    } else if (a.dueDate && !b.dueDate) return -1;
    else if (!a.dueDate && b.dueDate) return 1;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  return sorted;
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
