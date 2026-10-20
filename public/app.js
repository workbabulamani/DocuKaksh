const state = { user: null, persons: [], personId: null, folderId: null, query: '', view: 'files' };
let renderToken = 0;
let searchTimer = null;
let dragDepth = 0;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const FOLDER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;
const ROLE_LABELS = { super_admin: 'Super admin', user: 'User' };

// ---- Helpers ------------------------------------------------------------

async function api(path, { method = 'GET', body, form } = {}) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (form) {
    options.body = form;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, options);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDate(sqlDate) {
  // SQLite stores UTC as "YYYY-MM-DD HH:MM:SS"
  const date = new Date(`${sqlDate.replace(' ', 'T')}Z`);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function extBadge(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? esc(name.slice(dot + 1, dot + 5).toUpperCase()) : 'FILE';
}

const endpoint = (kind) => (kind === 'folder' ? 'folders' : 'files');
const currentPerson = () => state.persons.find((p) => p.id === state.personId);
const can = (permission) => Boolean(state.user?.permissions?.includes(permission));
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

function parseRoute() {
  if (location.hash === '#/users') return { view: 'users' };
  const match = location.hash.match(/^#\/p\/(\d+)(?:\/f\/(\d+))?$/);
  return match
    ? { view: 'files', personId: Number(match[1]), folderId: match[2] ? Number(match[2]) : null }
    : { view: 'files', personId: null, folderId: null };
}

const personHash = (personId, folderId = null) =>
  (personId ? `#/p/${personId}${folderId ? `/f/${folderId}` : ''}` : '#/');

// Navigation lives in the URL hash, so reload and the back button both work.
function navigate(hash) {
  closeDrawer();
  state.query = '';
  $('#search').value = '';
  if (location.hash === hash) return render();
  location.hash = hash; // the hashchange listener renders
}

const go = (personId, folderId = null) => navigate(personHash(personId, folderId));

// ---- Overlays: dialogs, sheets and preview -----------------------------------

function openOverlay(html, setup) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const close = (value = null) => {
      document.removeEventListener('keydown', onKey);
      root.innerHTML = '';
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    root.innerHTML = `<div class="backdrop">${html}</div>`;
    root.querySelector('.backdrop').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) close();
    });
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
    document.addEventListener('keydown', onKey);
    setup?.(root, close);
  });
}

function formModal({ title, message = '', fields = [], submit = 'Save', danger = false }) {
  const inputs = fields.map((f) => {
    if (f.type === 'select') {
      const options = f.options
        .map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
      return `<label class="field"><span>${esc(f.label)}</span><select name="${f.name}">${options}</select></label>`;
    }
    const type = f.type || 'text';
    const value = type === 'password' ? '' : esc(f.value ?? '');
    const minlength = type === 'password' ? ' minlength="8"' : '';
    return `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${type}" value="${value}"${minlength} required autocomplete="${type === 'password' ? 'new-password' : 'off'}"></label>`;
  }).join('');

  return openOverlay(`
    <form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>
      ${message ? `<p class="muted">${esc(message)}</p>` : ''}
      ${inputs}
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button>
      </div>
    </form>`, (root, close) => {
    const form = root.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close(Object.fromEntries(new FormData(form)));
    });
    form.querySelector('input, select')?.focus();
  });
}

// A menu of actions. Resolves with the chosen value, or null if dismissed.
function openSheet(title, items) {
  const buttons = items
    .map((i) => `<button class="sheet-item${i.danger ? ' danger-text' : ''}" type="button" data-value="${esc(i.value)}">${esc(i.label)}</button>`)
    .join('');
  return openOverlay(`
    <div class="sheet" role="menu" aria-label="${esc(title)}">
      <p class="sheet-title">${esc(title)}</p>
      ${buttons}
      <button class="sheet-item cancel" type="button" data-close>Cancel</button>
    </div>`, (root, close) => {
    root.querySelectorAll('[data-value]').forEach((b) => b.addEventListener('click', () => close(b.dataset.value)));
  });
}

async function openPreview(id) {
  const file = await api(`/files/${id}`);
  const src = `/api/files/${id}/content`;
  let body;
  if (!PREVIEWABLE.test(file.mime_type)) {
    body = '<p class="muted center">No preview for this file type. Use Download instead.</p>';
  } else if (file.mime_type.startsWith('image/')) {
    body = `<img src="${src}" alt="${esc(file.name)}">`;
  } else {
    body = `<iframe src="${src}" title="${esc(file.name)}"></iframe>`;
  }
  await openOverlay(`
    <div class="preview" role="dialog" aria-modal="true" aria-label="${esc(file.name)}">
      <header>
        <strong class="ellipsis">${esc(file.name)}</strong>
        <span class="muted small">${formatSize(file.size)}</span>
        <span class="grow"></span>
        <a class="btn" href="${src}?download=1">Download</a>
        <button class="btn" type="button" data-close>Close</button>
      </header>
      <div class="preview-body">${body}</div>
    </div>`);
}

// ---- Drawer (mobile navigation) ------------------------------------------------

function openDrawer() {
  $('#app').classList.add('drawer-open');
}

function closeDrawer() {
  $('#app').classList.remove('drawer-open');
}

// ---- Auth ----------------------------------------------------------------

async function boot() {
  const status = await api('/auth/status');
  if (!status.user) return showAuth(status.setupRequired);
  state.user = status.user;
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#admin-section').classList.toggle('hidden', !can('users:manage'));
  $('#account-btn').textContent = status.user.email;

  const route = parseRoute();
  state.view = route.view === 'users' && !can('users:manage') ? 'files' : route.view;
  state.personId = route.personId;
  state.folderId = route.folderId;
  await refreshPersons();
  if (state.view === 'files' && !state.persons.some((p) => p.id === state.personId)) {
    state.personId = state.persons[0]?.id ?? null;
    state.folderId = null;
  }
  history.replaceState(null, '', state.view === 'users' ? '#/users' : personHash(state.personId, state.folderId));
  await render();
}

function showAuth(setupRequired) {
  $('#app').classList.add('hidden');
  const el = $('#auth');
  el.classList.remove('hidden');
  el.innerHTML = `
    <form class="auth-card">
      <div class="brand big"><span class="logo">D</span>DocuKaksh</div>
      <h1>${setupRequired ? 'Create the super admin' : 'Sign in'}</h1>
      <p class="muted">${setupRequired
        ? 'This is a new install. The account you create here is the super admin, who can add other users.'
        : 'Enter your email and password to continue.'}</p>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="${setupRequired ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary wide" type="submit">${setupRequired ? 'Create account' : 'Sign in'}</button>
      <p class="error" role="alert"></p>
    </form>`;
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errorEl = form.querySelector('.error');
    errorEl.textContent = '';
    try {
      const body = Object.fromEntries(new FormData(form));
      await api(setupRequired ? '/auth/setup' : '/auth/login', { method: 'POST', body });
      await boot();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  state.user = null;
  state.persons = [];
  closeDrawer();
  history.replaceState(null, '', location.pathname);
  boot();
}

// ---- Persons -------------------------------------------------------------

async function refreshPersons() {
  state.persons = await api('/persons');
}

function renderPersons() {
  const nav = $('#person-list');
  if (!state.persons.length) {
    nav.innerHTML = '<p class="muted small pad">No persons yet</p>';
  } else {
    nav.innerHTML = state.persons.map((p) => `
      <button class="person${state.view === 'files' && p.id === state.personId ? ' active' : ''}" type="button" data-person="${p.id}">
        <span class="dot" data-color="${esc(p.color)}"></span>
        <span class="pname">${esc(p.name)}</span>
        <span class="count">${p.file_count}</span>
      </button>`).join('');
    nav.querySelectorAll('.dot').forEach((dot) => { dot.style.background = dot.dataset.color; });
  }
  $('#nav-users').classList.toggle('active', state.view === 'users');
}

async function newPerson() {
  const result = await formModal({
    title: 'New person',
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'color', label: 'Colour', type: 'color', value: '#4f46e5' },
    ],
    submit: 'Create',
  });
  if (!result) return;
  try {
    const person = await api('/persons', { method: 'POST', body: result });
    toast(`Created ${person.name}`);
    await refreshPersons();
    go(person.id, null);
  } catch (err) {
    toast(err.message, true);
  }
}

async function editPerson() {
  const person = currentPerson();
  if (!person) return;
  const result = await formModal({
    title: 'Edit person',
    fields: [
      { name: 'name', label: 'Name', value: person.name },
      { name: 'color', label: 'Colour', type: 'color', value: person.color },
    ],
    submit: 'Save',
  });
  if (!result) return;
  try {
    await api(`/persons/${person.id}`, { method: 'PATCH', body: result });
    await refreshPersons();
    toast('Saved');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deletePerson() {
  const person = currentPerson();
  if (!person) return;
  const result = await formModal({
    title: `Delete ${person.name}?`,
    message: 'This permanently deletes this person and every folder and file under it.',
    submit: 'Delete',
    danger: true,
  });
  if (!result) return;
  try {
    await api(`/persons/${person.id}`, { method: 'DELETE' });
    await refreshPersons();
    toast('Person deleted');
    go(state.persons[0]?.id ?? null, null);
  } catch (err) {
    toast(err.message, true);
  }
}

async function personMenu() {
  const choice = await openSheet(currentPerson()?.name ?? 'Person', [
    { value: 'edit', label: 'Edit name and colour' },
    { value: 'delete', label: 'Delete person', danger: true },
  ]);
  if (choice === 'edit') return editPerson();
  if (choice === 'delete') return deletePerson();
}

// ---- Rendering -----------------------------------------------------------

async function render() {
  const token = ++renderToken;
  renderPersons();
  const isUsers = state.view === 'users';
  const hasPersons = state.persons.length > 0;
  $('#toolbar').classList.toggle('hidden', isUsers || !hasPersons);
  $('#users-toolbar').classList.toggle('hidden', !isUsers);
  $('#search').classList.toggle('hidden', isUsers);
  $('#crumbs').innerHTML = '';

  if (isUsers) return renderUsers(token);
  if (state.query) return renderSearch(token);
  if (!hasPersons) return renderEmpty();

  try {
    const qs = state.folderId ? `?folder_id=${state.folderId}` : '';
    const data = await api(`/persons/${state.personId}/browse${qs}`);
    if (token !== renderToken) return;
    renderCrumbs(data);
    renderBrowse(data);
  } catch (err) {
    if (token !== renderToken) return;
    if (err.status === 401) return showAuth(false);
    if (err.status === 404 && state.folderId) return go(state.personId, null);
    if (err.status === 404) {
      await refreshPersons();
      return go(state.persons[0]?.id ?? null, null);
    }
    toast(err.message, true);
  }
}

function renderCrumbs({ person, breadcrumb }) {
  const parts = [`<button class="crumb" type="button" data-crumb="">${esc(person.name)}</button>`];
  for (const c of breadcrumb) {
    parts.push(`<span class="sep">/</span><button class="crumb" type="button" data-crumb="${c.id}">${esc(c.name)}</button>`);
  }
  $('#crumbs').innerHTML = parts.join('');
}

// One row layout for files, folders, search results and users.
function rowHtml({ kind, id, icon, iconClass = '', label, meta, col1 = '', col2 = '', attrs = '' }) {
  return `
    <div class="row" data-kind="${kind}" data-id="${id}" tabindex="0" ${attrs}>
      <span class="name">
        <span class="icon ${iconClass}">${icon}</span>
        <span class="text"><span class="label">${esc(label)}</span><span class="meta">${meta}</span></span>
      </span>
      <span class="col">${col1}</span>
      <span class="col">${col2}</span>
      <button class="kebab" type="button" data-kebab aria-label="More actions for ${esc(label)}">⋯</button>
    </div>`;
}

function listHtml(headers, rows) {
  return `
    <div class="list">
      <div class="row head"><span class="name">${headers[0]}</span><span class="col">${headers[1]}</span><span class="col">${headers[2]}</span><span class="kebab-spacer"></span></div>
      ${rows}
    </div>`;
}

function renderBrowse({ folders, files }) {
  const content = $('#content');
  if (!folders.length && !files.length) {
    content.innerHTML = `
      <div class="empty">
        <h2>This folder is empty</h2>
        <p class="muted">Upload files, or create a subfolder to keep things organised.</p>
      </div>`;
    return;
  }
  const folderRows = folders.map((f) => rowHtml({
    kind: 'folder',
    id: f.id,
    icon: FOLDER_ICON,
    iconClass: 'folder',
    label: f.name,
    meta: `Folder · ${esc(formatDate(f.created_at))}`,
    col1: 'Folder',
    col2: esc(formatDate(f.created_at)),
  })).join('');
  const fileRows = files.map((f) => rowHtml({
    kind: 'file',
    id: f.id,
    icon: extBadge(f.name),
    label: f.name,
    meta: `${esc(formatSize(f.size))} · ${esc(formatDate(f.created_at))}`,
    col1: esc(formatSize(f.size)),
    col2: esc(formatDate(f.created_at)),
  })).join('');
  content.innerHTML = listHtml(['Name', 'Size', 'Added'], folderRows + fileRows);
}

function renderEmpty() {
  $('#content').innerHTML = `
    <div class="empty">
      <h2>Welcome to DocuKaksh</h2>
      <p class="muted">Start by creating a person or category, for example "Papa", "Office" or "Car". Each one gets its own folders and files.</p>
      <button class="btn primary" type="button" data-action="new-person">Create a person</button>
    </div>`;
}

async function renderSearch(token) {
  const results = await api(`/search?q=${encodeURIComponent(state.query)}`);
  if (token !== renderToken) return;
  $('#crumbs').innerHTML = `<span class="crumb-static">Results for “${esc(state.query)}”</span>`;
  if (!results.length) {
    $('#content').innerHTML = '<div class="empty"><h2>No matching files</h2><p class="muted">Try a different name.</p></div>';
    return;
  }
  const rows = results.map((f) => {
    const where = [f.person_name, f.folder_name].filter(Boolean).join(' / ');
    return rowHtml({
      kind: 'file',
      id: f.id,
      icon: extBadge(f.name),
      label: f.name,
      meta: `${esc(where)} · ${esc(formatSize(f.size))}`,
      col1: esc(where),
      col2: esc(formatDate(f.created_at)),
      attrs: `data-search="1" data-person="${f.person_id}" data-folder="${f.folder_id ?? ''}"`,
    });
  }).join('');
  $('#content').innerHTML = listHtml(['Name', 'Location', 'Added'], rows);
}

async function renderUsers(token) {
  $('#crumbs').innerHTML = '<span class="crumb-static">Users</span>';
  const users = await api('/users');
  if (token !== renderToken) return;
  const rows = users.map((u) => {
    const self = u.id === state.user.id;
    const roleLabel = ROLE_LABELS[u.role] ?? u.role;
    const status = u.active ? 'Active' : 'Disabled';
    const counts = `${u.person_count} persons · ${u.file_count} files`;
    return rowHtml({
      kind: 'user',
      id: u.id,
      icon: esc(u.email.charAt(0)),
      iconClass: 'user',
      label: self ? `${u.email} (you)` : u.email,
      meta: `${esc(roleLabel)} · ${status} · ${counts}`,
      col1: `<span class="badge${u.role === 'super_admin' ? ' admin' : ''}">${esc(roleLabel)}</span>`,
      col2: u.active ? `<span class="muted">${status}</span>` : '<span class="badge off">Disabled</span>',
      attrs: `data-email="${esc(u.email)}" data-role="${u.role}" data-active="${u.active}" data-self="${self ? 1 : 0}"`,
    });
  }).join('');
  $('#content').innerHTML = listHtml(['Account', 'Role', 'Status'], rows);
}

// ---- Item actions ----------------------------------------------------------

async function rename(kind, id, row) {
  const current = row.querySelector('.label').textContent.trim();
  const result = await formModal({
    title: `Rename ${kind}`,
    fields: [{ name: 'name', label: 'Name', value: current }],
    submit: 'Save',
  });
  if (!result || result.name.trim() === current) return;
  await api(`/${endpoint(kind)}/${id}`, { method: 'PATCH', body: { name: result.name } });
  toast('Renamed');
  render();
}

function descendantIds(tree, rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of tree) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

async function move(kind, id) {
  const tree = await api(`/persons/${state.personId}/tree`);
  const byId = new Map(tree.map((f) => [f.id, f]));
  const pathOf = (folder) => {
    const parts = [];
    for (let cur = folder; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : null) parts.unshift(cur.name);
    return parts.join(' / ');
  };
  const excluded = kind === 'folder' ? descendantIds(tree, id) : new Set();
  const options = [
    { value: '', label: 'Person root' },
    ...tree.filter((f) => !excluded.has(f.id)).map((f) => ({ value: String(f.id), label: pathOf(f) })),
  ];
  const result = await formModal({
    title: `Move ${kind}`,
    fields: [{ name: 'target', label: 'Move to', type: 'select', value: '', options }],
    submit: 'Move',
  });
  if (!result) return;
  const target = result.target === '' ? null : Number(result.target);
  const body = kind === 'folder' ? { parent_id: target } : { folder_id: target };
  await api(`/${endpoint(kind)}/${id}`, { method: 'PATCH', body });
  toast('Moved');
  render();
}

async function remove(kind, id) {
  const result = await formModal({
    title: `Delete ${kind}?`,
    message: kind === 'folder'
      ? 'This permanently deletes the folder, its subfolders and every file inside.'
      : 'This permanently deletes the file.',
    submit: 'Delete',
    danger: true,
  });
  if (!result) return;
  await api(`/${endpoint(kind)}/${id}`, { method: 'DELETE' });
  toast('Deleted');
  render();
}

// Menu for a file or folder row. Search results offer fewer actions.
function documentMenuItems(row) {
  const kind = row.dataset.kind;
  if (row.dataset.search) {
    return [
      { value: 'preview', label: 'Preview' },
      { value: 'download', label: 'Download' },
      { value: 'reveal', label: 'Open folder' },
      { value: 'delete', label: 'Delete', danger: true },
    ];
  }
  const edit = [{ value: 'rename', label: 'Rename' }, { value: 'move', label: 'Move' }];
  const del = [{ value: 'delete', label: 'Delete', danger: true }];
  if (kind === 'folder') return [...edit, ...del];
  return [{ value: 'preview', label: 'Preview' }, { value: 'download', label: 'Download' }, ...edit, ...del];
}

function userMenuItems(row) {
  if (row.dataset.self === '1') return [];
  const items = [{ value: 'reset', label: 'Reset password' }];
  items.push({ value: 'toggle', label: row.dataset.active === '1' ? 'Disable account' : 'Enable account' });
  items.push({
    value: 'role',
    label: row.dataset.role === 'super_admin' ? 'Remove super admin role' : 'Make super admin',
  });
  items.push({ value: 'delete', label: 'Delete account and all its data', danger: true });
  return items;
}

async function openRowMenu(row) {
  const isUser = row.dataset.kind === 'user';
  const title = isUser ? row.dataset.email : row.querySelector('.label').textContent.trim();
  const items = isUser ? userMenuItems(row) : documentMenuItems(row);
  if (!items.length) return toast('No actions available for your own account', true);
  const choice = await openSheet(title, items);
  if (!choice) return;
  if (isUser) return userAction(choice, row);
  return rowAction(choice, row);
}

async function rowAction(action, row) {
  const kind = row.dataset.kind;
  const id = Number(row.dataset.id);
  try {
    if (action === 'preview') return await openPreview(id);
    if (action === 'download') return (location.href = `/api/files/${id}/content?download=1`);
    if (action === 'reveal') {
      return go(Number(row.dataset.person), row.dataset.folder ? Number(row.dataset.folder) : null);
    }
    if (action === 'rename') return await rename(kind, id, row);
    if (action === 'move') return await move(kind, id);
    if (action === 'delete') return await remove(kind, id);
  } catch (err) {
    toast(err.message, true);
  }
}

async function newUser() {
  const result = await formModal({
    title: 'New user',
    fields: [
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'password', label: 'Temporary password (8+ characters)', type: 'password' },
      {
        name: 'role',
        label: 'Role',
        type: 'select',
        value: 'user',
        options: [
          { value: 'user', label: 'User (manages own documents)' },
          { value: 'super_admin', label: 'Super admin (also manages users)' },
        ],
      },
    ],
    submit: 'Create user',
  });
  if (!result) return;
  try {
    await api('/users', { method: 'POST', body: result });
    toast('User created. Share the temporary password securely.');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function userAction(action, row) {
  const id = Number(row.dataset.id);
  const email = row.dataset.email;
  try {
    if (action === 'reset') {
      const result = await formModal({
        title: `Reset password for ${email}`,
        message: 'Their existing sessions will be signed out.',
        fields: [{ name: 'password', label: 'New password (8+ characters)', type: 'password' }],
        submit: 'Reset password',
      });
      if (!result) return;
      await api(`/users/${id}/password`, { method: 'POST', body: result });
      toast('Password reset');
    } else if (action === 'toggle') {
      const enable = row.dataset.active !== '1';
      await api(`/users/${id}`, { method: 'PATCH', body: { active: enable } });
      toast(enable ? 'Account enabled' : 'Account disabled');
    } else if (action === 'role') {
      const role = row.dataset.role === 'super_admin' ? 'user' : 'super_admin';
      await api(`/users/${id}`, { method: 'PATCH', body: { role } });
      toast('Role updated');
    } else if (action === 'delete') {
      const result = await formModal({
        title: `Delete ${email}?`,
        message: 'This permanently deletes the account and every person, folder and file it owns.',
        submit: 'Delete account',
        danger: true,
      });
      if (!result) return;
      await api(`/users/${id}`, { method: 'DELETE' });
      toast('Account deleted');
    }
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function changePassword() {
  const result = await formModal({
    title: 'Change password',
    message: 'Other devices will be signed out.',
    fields: [
      { name: 'current', label: 'Current password', type: 'password' },
      { name: 'password', label: 'New password (8+ characters)', type: 'password' },
    ],
    submit: 'Change password',
  });
  if (!result) return;
  try {
    await api('/auth/password', { method: 'POST', body: result });
    toast('Password changed');
  } catch (err) {
    toast(err.message, true);
  }
}

async function accountMenu() {
  const choice = await openSheet(state.user.email, [
    { value: 'password', label: 'Change password' },
    { value: 'logout', label: 'Sign out', danger: true },
  ]);
  if (choice === 'password') return changePassword();
  if (choice === 'logout') return logout();
}

// ---- Upload ----------------------------------------------------------------

function uploadFiles(fileList) {
  if (state.view !== 'files') return toast('Open a person to upload files', true);
  if (!state.personId) return toast('Create a person first', true);
  const files = [...fileList];
  if (!files.length) return;

  const form = new FormData();
  form.append('person_id', String(state.personId));
  if (state.folderId) form.append('folder_id', String(state.folderId));
  for (const file of files) form.append('files', file);

  const bar = $('#upload-progress');
  const fill = bar.querySelector('.bar');
  bar.classList.remove('hidden');
  fill.style.width = '0%';
  bar.querySelector('span').textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) fill.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
  };
  xhr.onload = () => {
    bar.classList.add('hidden');
    let data = {};
    try {
      data = JSON.parse(xhr.responseText);
    } catch {
      // Non-JSON error bodies fall through to the generic message below.
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      toast(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
      refreshPersons().then(render);
    } else if (xhr.status === 401) {
      showAuth(false);
    } else {
      toast(data.error || 'Upload failed', true);
    }
  };
  xhr.onerror = () => {
    bar.classList.add('hidden');
    toast('Network error during upload', true);
  };
  xhr.send(form);
}

async function newFolder() {
  const result = await formModal({
    title: 'New folder',
    fields: [{ name: 'name', label: 'Folder name' }],
    submit: 'Create',
  });
  if (!result) return;
  try {
    await api('/folders', {
      method: 'POST',
      body: { person_id: state.personId, parent_id: state.folderId, name: result.name },
    });
    toast('Folder created');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Event wiring ----------------------------------------------------------

window.addEventListener('hashchange', () => {
  const route = parseRoute();
  state.view = route.view === 'users' && !can('users:manage') ? 'files' : route.view;
  if (state.view === 'files') {
    state.personId = route.personId;
    state.folderId = route.folderId;
    if (!route.personId && state.persons.length) return go(state.persons[0].id, null);
  }
  render();
});

$('#menu-btn').addEventListener('click', () => {
  if ($('#app').classList.contains('drawer-open')) closeDrawer();
  else openDrawer();
});
$('#scrim').addEventListener('click', closeDrawer);
$('#account-btn').addEventListener('click', accountMenu);

$('#new-person').addEventListener('click', newPerson);
$('#person-more').addEventListener('click', personMenu);
$('#new-folder').addEventListener('click', newFolder);
$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  uploadFiles(e.target.files);
  e.target.value = '';
});
$('#new-user').addEventListener('click', newUser);

$('#person-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-person]');
  if (button) go(Number(button.dataset.person), null);
});
$('#nav-users').addEventListener('click', () => navigate('#/users'));

$('#crumbs').addEventListener('click', (e) => {
  const crumb = e.target.closest('[data-crumb]');
  if (crumb) go(state.personId, crumb.dataset.crumb ? Number(crumb.dataset.crumb) : null);
});

$('#content').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="new-person"]')) return newPerson();
  const row = e.target.closest('.row[data-kind]');
  if (!row) return;
  if (e.target.closest('[data-kebab]')) return openRowMenu(row);
  if (row.dataset.kind === 'user') return;
  if (row.dataset.kind === 'folder') return go(state.personId, Number(row.dataset.id));
  return rowAction('preview', row);
});

$('#content').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.row[data-kind]') && e.target.dataset.kind !== 'user') e.target.click();
});

$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    render();
  }, 250);
});

// Drag and drop on desktop browsers.
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $('#drop-hint').classList.remove('hidden');
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop-hint').classList.add('hidden');
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-hint').classList.add('hidden');
  uploadFiles(e.dataTransfer.files);
});

boot().catch((err) => toast(err.message, true));
