/* ============================================================
   TASKBOARD – app.js
   Supabase integration + full UI logic
   ============================================================ */

'use strict';

// ─── SUPABASE CONFIG ────────────────────────────────────────
const SUPABASE_URL = 'https://uxrnqrzbtjhtehyjthhu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4cm5xcnpidGpodGVoeWp0aGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODMzMTksImV4cCI6MjA4OTQ1OTMxOX0.LhvqnBvgHmkvw1vxJ_4RDd61gp4jlXMkY6AZ3BgOd4M';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── TABLE NAME ──────────────────────────────────────────────
const TABLE = 'todos';

// ─── STATE ───────────────────────────────────────────────────
let allTodos      = [];
let allLabels     = [];       // unique labels gathered from todos
let activeTodo    = null;     // the todo currently shown in detail modal
let editMode      = false;    // true when form is editing an existing todo
let editingId     = null;     // id of todo being edited
let activeLabel   = 'all';    // current sidebar label filter
let formTags      = [];       // tags in the add/edit form
let formChecklist = [];       // checklist items [{id, text, done}] in form

// ─── DOM REFS ────────────────────────────────────────────────
const todoGrid        = document.getElementById('todo-grid');
const emptyState      = document.getElementById('empty-state');
const loadingState    = document.getElementById('loading-state');
const searchInput     = document.getElementById('search-input');
const addTodoBtn      = document.getElementById('add-todo-btn');
const hamburgerBtn    = document.getElementById('hamburger-btn');
const sidebar         = document.getElementById('sidebar');
const sidebarOverlay  = document.getElementById('sidebar-overlay');
const closeSidebarBtn = document.getElementById('close-sidebar');
const labelFilterList = document.getElementById('label-filter-list');
const activeFilterBar = document.getElementById('active-filter-bar');
const activeFilterTxt = document.getElementById('active-filter-text');
const clearFilterBtn  = document.getElementById('clear-filter-btn');
const toast           = document.getElementById('toast');

// Add/Edit modal
const todoModal       = document.getElementById('todo-modal');
const modalTitle      = document.getElementById('modal-title');
const todoForm        = document.getElementById('todo-form');
const todoTitleInp    = document.getElementById('todo-title');
const todoDescInp     = document.getElementById('todo-description');
const tagInput        = document.getElementById('tag-input');
const selectedTagsEl  = document.getElementById('selected-tags');
const tagSuggestions  = document.getElementById('tag-suggestions');
const closeModalBtn   = document.getElementById('close-modal-btn');
const cancelModalBtn  = document.getElementById('cancel-modal-btn');

// Card detail modal
const cardModal        = document.getElementById('card-modal');
const cardDetailContent= document.getElementById('card-detail-content');
const closeCardModalBtn= document.getElementById('close-card-modal-btn');
const deleteTodoBtn    = document.getElementById('delete-todo-btn');
const editTodoBtn      = document.getElementById('edit-todo-btn');
const toggleDoneBtn    = document.getElementById('toggle-done-btn');

// Checklist form refs
const checklistNewInput = document.getElementById('checklist-new-item');
const checklistAddBtn   = document.getElementById('checklist-add-btn');
const checklistFormList = document.getElementById('checklist-form-list');
const checklistBadge    = document.getElementById('checklist-count-badge');

// ─── INIT ────────────────────────────────────────────────────
(async function init() {
  await ensureTableExists();
  await loadTodos();
  bindEvents();
})();

// ─── SUPABASE: ENSURE TABLE ──────────────────────────────────
async function ensureTableExists() {
  const { error } = await db.from(TABLE).select('id').limit(1);
  if (error) {
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      showToast('⚠️ Tabla "todos" no encontrada. Ejecuta el SQL del README en Supabase.', 8000);
    } else if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
      showToast('⚠️ Error de autenticación con Supabase.', 5000);
    }
  }
}

// ─── SUPABASE: LOAD TODOS ────────────────────────────────────
async function loadTodos() {
  showLoading(true);
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[loadTodos]', error);
    showToast('Error al cargar tareas: ' + error.message, 5000);
    showLoading(false);
    return;
  }

  allTodos = data || [];
  collectLabels();
  renderSidebarLabels();
  renderCards();
  showLoading(false);
}

// ─── SUPABASE: ADD TODO ───────────────────────────────────────
async function addTodo(title, description, tags, checklist = []) {
  const { data, error } = await db
    .from(TABLE)
    .insert({ title, description, tags, checklist, done: false })
    .select();

  if (error) {
    showToast('Error al guardar: ' + error.message, 5000);
    console.error('[addTodo]', error);
    return null;
  }
  return data && data[0] ? data[0] : null;
}

// ─── SUPABASE: UPDATE TODO ────────────────────────────────────
async function updateTodo(id, fields) {
  const { data, error } = await db
    .from(TABLE)
    .update(fields)
    .eq('id', id)
    .select();

  if (error) {
    showToast('Error al actualizar: ' + error.message, 5000);
    console.error('[updateTodo]', error);
    return null;
  }
  return data && data[0] ? data[0] : null;
}

// ─── SUPABASE: DELETE TODO ────────────────────────────────────
async function deleteTodo(id) {
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) {
    showToast('Error al eliminar: ' + error.message, 5000);
    console.error('[deleteTodo]', error);
    return false;
  }
  return true;
}

// ─── LABEL HELPERS ────────────────────────────────────────────
function collectLabels() {
  const set = new Set();
  allTodos.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
  allLabels = Array.from(set).sort();
}

function renderSidebarLabels() {
  // Remove old dynamic items (keep first «Todas»)
  const allItems = labelFilterList.querySelectorAll('li:not(:first-child)');
  allItems.forEach(el => el.remove());

  const colors = [
    'var(--c-rose-soft)', 'var(--c-sage-soft)', 'var(--c-teal-soft)',
    'var(--c-lav-soft)', '#e8d5a0', '#c8b5d8'
  ];

  allLabels.forEach((label, i) => {
    const li  = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'label-filter-btn' + (activeLabel === label ? ' active' : '');
    btn.dataset.label = label;
    btn.innerHTML = `<span class="dot" style="background:${colors[i % colors.length]}"></span> ${escHtml(label)}`;
    btn.addEventListener('click', () => setLabelFilter(label));
    li.appendChild(btn);
    labelFilterList.appendChild(li);
  });

  // Update «Todas» active state
  document.getElementById('filter-all').classList.toggle('active', activeLabel === 'all');
}

function setLabelFilter(label) {
  activeLabel = label;
  closeSidebar();
  renderSidebarLabels();
  renderCards();

  if (label === 'all') {
    activeFilterBar.classList.add('hidden');
  } else {
    activeFilterBar.classList.remove('hidden');
    activeFilterTxt.textContent = `Etiqueta: ${label}`;
  }
}

// ─── RENDER CARDS ────────────────────────────────────────────
function renderCards() {
  const q = searchInput.value.trim().toLowerCase();

  let filtered = allTodos.filter(t => {
    const matchLabel = activeLabel === 'all' || (t.tags || []).includes(activeLabel);
    const matchSearch = !q ||
      t.title.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(q));
    return matchLabel && matchSearch;
  });

  todoGrid.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    filtered.forEach(todo => {
      todoGrid.appendChild(buildCard(todo));
    });
  }
}

function buildCard(todo) {
  const card = document.createElement('div');
  card.className = 'todo-card' + (todo.done ? ' done' : '');
  card.dataset.id = todo.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Tarea: ${todo.title}`);

  const tagsHtml = (todo.tags || []).map(tag =>
    `<span class="tag-chip">${escHtml(tag)}</span>`
  ).join('');

  const dateStr = formatDate(todo.created_at);

  // ── Checklist preview (first 3 items) ──
  const cl = todo.checklist || [];
  let checklistHtml = '';
  if (cl.length > 0) {
    const doneCnt = cl.filter(i => i.done).length;
    const pct     = Math.round((doneCnt / cl.length) * 100);
    const preview = cl.slice(0, 3);
    const remaining = cl.length - 3;

    const itemsHtml = preview.map(item => `
      <div class="card-cl-item ${item.done ? 'cl-done' : ''}">
        <span class="cl-box">${item.done ? '✓' : ''}</span>
        <span class="cl-text">${escHtml(item.text)}</span>
      </div>
    `).join('');

    const moreHtml = remaining > 0
      ? `<p class="card-cl-more">+${remaining} más…</p>`
      : '';

    checklistHtml = `
      <div class="card-progress-wrap">
        <div class="card-progress-bar">
          <div class="card-progress-fill" style="width:${pct}%"></div>
        </div>
        <span class="card-progress-text">${doneCnt}/${cl.length}</span>
      </div>
      <div class="card-checklist-preview">${itemsHtml}${moreHtml}</div>
    `;
  }

  card.innerHTML = `
    <div class="card-top">
      <span class="done-icon">${todo.done ? '✅' : '⬜'}</span>
      <p class="card-title">${escHtml(todo.title)}</p>
    </div>
    ${todo.description ? `<p class="card-desc">${escHtml(todo.description)}</p>` : ''}
    ${checklistHtml}
    ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
    <div class="card-footer">
      <span class="card-date">🕐 ${dateStr}</span>
    </div>
  `;

  card.addEventListener('click', () => openCardDetail(todo));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openCardDetail(todo); });

  return card;
}

// ─── CARD DETAIL MODAL ────────────────────────────────────────
function openCardDetail(todo) {
  activeTodo = todo;
  const tagsHtml = (todo.tags || []).map(tag =>
    `<span class="tag-chip">${escHtml(tag)}</span>`
  ).join('');

  // ── Checklist section ──
  const cl = todo.checklist || [];
  let checklistSection = '';
  if (cl.length > 0) {
    const doneCnt = cl.filter(i => i.done).length;
    const allDone = doneCnt === cl.length;
    const itemsHtml = cl.map(item => `
      <li class="cl-item" data-item-id="${item.id}">
        <input type="checkbox" ${item.done ? 'checked' : ''}
          id="cl-detail-${item.id}" aria-label="${escHtml(item.text)}" />
        <label class="cl-item-label" for="cl-detail-${item.id}">${escHtml(item.text)}</label>
      </li>
    `).join('');
    checklistSection = `
      <div class="detail-checklist-wrap">
        <div class="detail-checklist-header">
          <span class="detail-checklist-title">☑ Subtareas</span>
          <span class="detail-checklist-progress" id="cl-progress-text">${doneCnt} / ${cl.length} completadas</span>
        </div>
        <ul class="detail-cl-list" id="detail-cl-list">
          <li class="cl-mark-all-row">
            <input type="checkbox" id="cl-mark-all" ${allDone ? 'checked' : ''} aria-label="Marcar todas" />
            <label class="cl-mark-all-label" for="cl-mark-all">Marcar todas</label>
          </li>
          ${itemsHtml}
        </ul>
      </div>`;
  }

  cardDetailContent.innerHTML = `
    <div class="detail-meta">
      <div class="detail-meta-row">
        <span>Estado</span>
        <span class="detail-status-badge ${todo.done ? 'badge-done' : 'badge-pending'}">
          ${todo.done ? '✅ Completada' : '⏳ Pendiente'}
        </span>
      </div>
      <div class="detail-meta-row">
        <span>📅 Creada:</span>
        <span>${formatDateLong(todo.created_at)}</span>
      </div>
    </div>
    <h3 class="detail-title">${escHtml(todo.title)}</h3>
    ${todo.description ? `<p class="detail-desc">${escHtml(todo.description)}</p>` : '<p style="color:var(--text-secondary);font-size:.85rem;opacity:.6">Sin descripción</p>'}
    ${checklistSection}
    ${tagsHtml ? `<div class="detail-tags">${tagsHtml}</div>` : ''}
  `;

  // ── Wire up checklist checkboxes (after innerHTML) ──
  if (cl.length > 0) {
    cardDetailContent.querySelectorAll('.detail-cl-list .cl-item').forEach(li => {
      const cb  = li.querySelector('input[type="checkbox"]');
      const iid = li.dataset.itemId;
      cb.addEventListener('change', () => toggleChecklistItem(todo, iid, cb.checked));
    });
    const markAllCb = cardDetailContent.querySelector('#cl-mark-all');
    markAllCb.addEventListener('change', () => toggleAllChecklistItems(todo, markAllCb.checked));
  }

  toggleDoneBtn.textContent = todo.done ? '↩ Marcar como pendiente' : '✔ Marcar como hecha';
  cardModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// Toggle a single checklist item and persist
async function toggleChecklistItem(todo, itemId, done) {
  const newCl = (todo.checklist || []).map(i => i.id === itemId ? { ...i, done } : i);
  const updated = await updateTodo(todo.id, { checklist: newCl });
  if (updated) {
    const idx = allTodos.findIndex(t => t.id === todo.id);
    if (idx !== -1) allTodos[idx] = updated;
    activeTodo = updated;
    const doneCnt = newCl.filter(i => i.done).length;
    const prog = cardDetailContent.querySelector('#cl-progress-text');
    if (prog) prog.textContent = `${doneCnt} / ${newCl.length} completadas`;
    const markAll = cardDetailContent.querySelector('#cl-mark-all');
    if (markAll) markAll.checked = doneCnt === newCl.length;
    renderCards();
  }
}

// Toggle ALL checklist items
async function toggleAllChecklistItems(todo, done) {
  const newCl = (todo.checklist || []).map(i => ({ ...i, done }));
  const updated = await updateTodo(todo.id, { checklist: newCl });
  if (updated) {
    const idx = allTodos.findIndex(t => t.id === todo.id);
    if (idx !== -1) allTodos[idx] = updated;
    activeTodo = updated;
    cardDetailContent.querySelectorAll('.detail-cl-list .cl-item input[type="checkbox"]')
      .forEach(cb => { cb.checked = done; });
    const doneCnt = done ? newCl.length : 0;
    const prog = cardDetailContent.querySelector('#cl-progress-text');
    if (prog) prog.textContent = `${doneCnt} / ${newCl.length} completadas`;
    renderCards();
  }
}

function closeCardModal() {
  cardModal.classList.add('hidden');
  document.body.style.overflow = '';
  activeTodo = null;
}

// ─── ADD/EDIT MODAL ───────────────────────────────────────────
function openAddModal() {
  editMode      = false;
  editingId     = null;
  formTags      = [];
  formChecklist = [];
  modalTitle.textContent = 'Nueva tarea';
  todoTitleInp.value    = '';
  todoDescInp.value     = '';
  renderFormTags();
  renderFormChecklist();
  tagSuggestions.classList.add('hidden');
  todoModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => todoTitleInp.focus(), 60);
}

function openEditModal(todo) {
  editMode      = true;
  editingId     = todo.id;
  formTags      = [...(todo.tags || [])];
  formChecklist = (todo.checklist || []).map(item => ({ ...item }));
  modalTitle.textContent = 'Editar tarea';
  todoTitleInp.value    = todo.title;
  todoDescInp.value     = todo.description || '';
  renderFormTags();
  renderFormChecklist();
  closeCardModal();
  todoModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => todoTitleInp.focus(), 60);
}

function closeAddModal() {
  todoModal.classList.add('hidden');
  document.body.style.overflow = '';
  tagSuggestions.classList.add('hidden');
  checklistNewInput.value = '';
}

// ─── CHECKLIST FORM HELPERS ───────────────────────────────────
function mkId() {
  return Math.random().toString(36).slice(2, 10);
}

function addChecklistItem(text) {
  const t = text.trim();
  if (!t) return;
  formChecklist.push({ id: mkId(), text: t, done: false });
  checklistNewInput.value = '';
  renderFormChecklist();
}

function removeChecklistItem(id) {
  formChecklist = formChecklist.filter(i => i.id !== id);
  renderFormChecklist();
}

function renderFormChecklist() {
  checklistFormList.innerHTML = '';
  const badge = checklistBadge;
  badge.textContent = formChecklist.length ? `${formChecklist.length}` : '';

  formChecklist.forEach(item => {
    const li = document.createElement('li');
    li.className = 'cl-item';
    li.innerHTML = `
      <input type="checkbox" ${item.done ? 'checked' : ''} disabled aria-label="${escHtml(item.text)}" />
      <span class="cl-item-label">${escHtml(item.text)}</span>
      <button type="button" class="cl-item-remove" data-id="${item.id}" aria-label="Quitar">✕</button>
    `;
    li.querySelector('.cl-item-remove').addEventListener('click', () => removeChecklistItem(item.id));
    checklistFormList.appendChild(li);
  });
}

// ─── FORM SUBMISSION ──────────────────────────────────────────
todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = todoTitleInp.value.trim();
  if (!title) { todoTitleInp.focus(); shake(todoTitleInp); return; }

  const description = todoDescInp.value.trim();
  const tags        = [...formTags];
  const checklist   = formChecklist.map(i => ({ ...i }));

  const saveBtn = document.getElementById('save-todo-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  let success = false;

  if (editMode) {
    const updated = await updateTodo(editingId, { title, description, tags, checklist });
    if (updated) {
      const idx = allTodos.findIndex(t => t.id === editingId);
      if (idx !== -1) allTodos[idx] = updated;
      showToast('✅ Tarea actualizada');
      success = true;
    }
  } else {
    const created = await addTodo(title, description, tags, checklist);
    if (created) {
      allTodos.unshift(created);
      showToast('✅ Tarea creada');
      success = true;
    }
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Guardar tarea';

  if (success) {
    closeAddModal();
    collectLabels();
    renderSidebarLabels();
    renderCards();
  }
});

// ─── TAG INPUT LOGIC ──────────────────────────────────────────
tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addFormTag(tagInput.value);
  } else if (e.key === 'Backspace' && tagInput.value === '' && formTags.length) {
    formTags.pop();
    renderFormTags();
  }
});

tagInput.addEventListener('input', () => {
  const q = tagInput.value.trim().toLowerCase();
  if (!q) { tagSuggestions.classList.add('hidden'); return; }
  const matches = allLabels.filter(l => l.toLowerCase().includes(q) && !formTags.includes(l));
  renderTagSuggestions(matches);
});

tagInput.addEventListener('blur', () => {
  setTimeout(() => tagSuggestions.classList.add('hidden'), 200);
});

function addFormTag(raw) {
  const tag = raw.trim().replace(/,/g, '').toLowerCase();
  if (!tag || formTags.includes(tag)) { tagInput.value = ''; return; }
  formTags.push(tag);
  tagInput.value = '';
  tagSuggestions.classList.add('hidden');
  renderFormTags();
}

function removeFormTag(tag) {
  formTags = formTags.filter(t => t !== tag);
  renderFormTags();
}

function renderFormTags() {
  selectedTagsEl.innerHTML = '';
  formTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip removable';
    chip.style.cssText = getTagStyle(i);
    chip.innerHTML = `${escHtml(tag)} <button type="button" aria-label="Quitar ${escHtml(tag)}">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => removeFormTag(tag));
    selectedTagsEl.appendChild(chip);
  });
}

function renderTagSuggestions(tags) {
  tagSuggestions.innerHTML = '';
  if (!tags.length) { tagSuggestions.classList.add('hidden'); return; }
  tags.slice(0, 8).forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-suggestion-item';
    item.textContent = tag;
    item.addEventListener('mousedown', () => { addFormTag(tag); });
    tagSuggestions.appendChild(item);
  });
  tagSuggestions.classList.remove('hidden');
}

function getTagStyle(i) {
  const styles = [
    'background:rgba(212,147,122,.28);color:#8b4a2e;',
    'background:rgba(143,171,148,.28);color:#3a6145;',
    'background:rgba(106,158,165,.28);color:#2e6870;',
    'background:rgba(158,143,181,.28);color:#5a4470;',
    'background:rgba(232,213,160,.45);color:#7a6020;',
    'background:rgba(197,186,216,.35);color:#5a4470;',
  ];
  return styles[i % styles.length];
}

// ─── TOGGLE DONE ──────────────────────────────────────────────
toggleDoneBtn.addEventListener('click', async () => {
  if (!activeTodo) return;
  const updated = await updateTodo(activeTodo.id, { done: !activeTodo.done });
  if (updated) {
    const idx = allTodos.findIndex(t => t.id === activeTodo.id);
    if (idx !== -1) allTodos[idx] = updated;
    showToast(updated.done ? '✅ Marcada como hecha' : '↩ Marcada como pendiente');
    closeCardModal();
    renderCards();
  }
});

// ─── DELETE ───────────────────────────────────────────────────
deleteTodoBtn.addEventListener('click', async () => {
  if (!activeTodo) return;
  if (!confirm(`¿Eliminar "${activeTodo.title}"?`)) return;
  const ok = await deleteTodo(activeTodo.id);
  if (ok) {
    allTodos = allTodos.filter(t => t.id !== activeTodo.id);
    showToast('🗑 Tarea eliminada');
    closeCardModal();
    collectLabels();
    renderSidebarLabels();
    renderCards();
  }
});

// ─── EDIT ─────────────────────────────────────────────────────
editTodoBtn.addEventListener('click', () => {
  if (activeTodo) openEditModal(activeTodo);
});

// ─── SIDEBAR ──────────────────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

document.getElementById('filter-all').addEventListener('click', () => setLabelFilter('all'));

// ─── EVENT BINDINGS ───────────────────────────────────────────
function bindEvents() {
  hamburgerBtn.addEventListener('click', openSidebar);
  closeSidebarBtn.addEventListener('click', closeSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  addTodoBtn.addEventListener('click', openAddModal);
  closeModalBtn.addEventListener('click', closeAddModal);
  cancelModalBtn.addEventListener('click', closeAddModal);

  closeCardModalBtn.addEventListener('click', closeCardModal);

  // Checklist form
  checklistAddBtn.addEventListener('click', () => addChecklistItem(checklistNewInput.value));
  checklistNewInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(checklistNewInput.value); }
  });

  // Close modals on overlay click
  todoModal.addEventListener('click', (e) => { if (e.target === todoModal) closeAddModal(); });
  cardModal.addEventListener('click', (e) => { if (e.target === cardModal) closeCardModal(); });

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!todoModal.classList.contains('hidden'))  closeAddModal();
      if (!cardModal.classList.contains('hidden'))  closeCardModal();
      if (sidebar.classList.contains('open'))        closeSidebar();
    }
  });

  // Search
  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderCards, 200);
  });

  // Clear filter
  clearFilterBtn.addEventListener('click', () => setLabelFilter('all'));
}

// ─── HELPERS ─────────────────────────────────────────────────
function showLoading(show) {
  loadingState.classList.toggle('hidden', !show);
  todoGrid.classList.toggle('hidden', show);
  if (show) emptyState.classList.add('hidden');
}

function showToast(msg, duration = 2800) {
  toast.classList.remove('hidden');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, duration);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLong(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    + ' a las ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake .35s ease';
  setTimeout(() => el.style.animation = '', 400);
}
