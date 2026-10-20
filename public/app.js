// ---- State and constants ------------------------------------------------------

const THEMES = [
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn' },
];

const state = {
  user: null,
  persons: [],
  personId: null,
  folderId: null,
  view: 'files',
  query: '',
  sort: readStore('dk-sort', { key: 'name', dir: 'asc' }),
};

let renderToken = 0;
let searchTimer = null;
let dragDepth = 0;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const FOLDER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ROLE_LABELS = { super_admin: 'Super admin', user: 'User' };
const ITEM_TYPE = 'application/x-dk-item';
const PERSON_TYPE = 'application/x-dk-person';

// Storage can be blocked (private windows). Preferences are conveniences, so failures are ignored.
function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignored: the preference simply will not persist.
  }
}

// ---- Helpers ------------------------------------------------------------------

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
    err.code = data?.code;
    throw err;
  }
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 3200);
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

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS"; ISO strings are used for client-provided dates.
function parseStamp(value) {
  if (!value) return null;
  const date = new Date(/T|Z|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
const formatDate = (value) => parseStamp(value)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—';
const formatDateTime = (value) => parseStamp(value)?.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '—';

function extBadge(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? esc(name.slice(dot + 1, dot + 5).toUpperCase()) : 'FILE';
}

const endpoint = (kind) => (kind === 'folder' ? 'folders' : 'files');
const currentPerson = () => state.persons.find((p) => p.id === state.personId);
const can = (permission) => Boolean(state.user?.permissions?.includes(permission));
const isAdmin = () => can('persons:manage');
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
const hasType = (e, type) => [...(e.dataTransfer?.types ?? [])].includes(type);
const initial = (email) => esc((email || '?').charAt(0));

function applyTheme(theme) {
  document.documentElement.dataset.theme = THEMES.some((t) => t.id === theme) ? theme : 'day';
}

// ---- Routing --------------------------------------------------------------------

function parseRoute() {
  if (location.hash === '#/users') return { view: 'users' };
  if (location.hash === '#/recovery') return { view: 'recovery' };
  if (location.hash === '#/trash') return { view: 'trash' };
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

// ---- Overlays: dialogs, action sheets, preview, settings -------------------------

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

// Fields: { name, label, type, value, options, optional }. type 'checkboxes' returns an array.
function formModal({ title, message = '', fields = [], submit = 'Save', danger = false }) {
  const inputs = fields.map((f) => {
    if (f.type === 'select') {
      const options = f.options
        .map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
      return `<label class="field"><span>${esc(f.label)}</span><select name="${f.name}">${options}</select></label>`;
    }
    if (f.type === 'checkboxes') {
      const selected = new Set((f.value ?? []).map(String));
      const items = f.options.map((o) => `
        <label><input type="checkbox" name="${f.name}" value="${esc(o.value)}"${selected.has(String(o.value)) ? ' checked' : ''}> ${esc(o.label)}</label>`).join('');
      return `<div class="field"><span>${esc(f.label)}</span><div class="check-list">${items || '<p class="muted small">No persons yet.</p>'}</div></div>`;
    }
    const type = f.type || 'text';
    const value = type === 'password' ? '' : esc(f.value ?? '');
    const required = f.optional ? '' : ' required';
    const minlength = type === 'password' ? ' minlength="8"' : '';
    const placeholder = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    return `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${type}" value="${value}"${minlength}${placeholder}${required} autocomplete="${type === 'password' ? 'new-password' : 'off'}"></label>`;
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
      const result = Object.fromEntries(new FormData(form));
      for (const f of fields.filter((x) => x.type === 'checkboxes')) {
        result[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value);
      }
      close(result);
    });
    form.querySelector('input:not([type="checkbox"]), select')?.focus();
  });
}

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
  const preview = `/api/files/${id}/preview`;
  let body;
  switch (file.preview) {
    case 'pdf': body = `<iframe src="${src}" title="${esc(file.name)}"></iframe>`; break;
    case 'image': body = `<img src="${src}" alt="${esc(file.name)}">`; break;
    case 'converted-image': body = `<img src="${preview}" alt="${esc(file.name)}">`; break;
    case 'video': body = `<video controls src="${src}"></video>`; break;
    case 'audio': body = `<audio controls src="${src}"></audio>`; break;
    case 'document': {
      const check = await fetch(preview, { credentials: 'same-origin' });
      if (check.ok) {
        body = `<iframe src="${preview}" title="${esc(file.name)}"></iframe>`;
      } else {
        const data = await check.json().catch(() => ({}));
        body = `<p class="note">${esc(data.error || 'This file cannot be previewed.')}</p>`;
      }
      break;
    }
    default: body = '<p class="note">No preview for this file type. Use Download to open it.</p>';
  }

  const path = file.path.length ? file.path.join(' / ') : 'Person root';
  const details = `
    <h3>Details</h3>
    <dl>
      <dt>Name</dt><dd>${esc(file.name)}</dd>
      <dt>Type</dt><dd>${esc(file.mime_type)}</dd>
      <dt>Size</dt><dd>${esc(formatSize(file.size))}</dd>
      <dt>Uploaded by</dt><dd>${esc(file.uploaded_by_email || 'Deleted account')}</dd>
      <dt>Uploaded</dt><dd>${esc(formatDateTime(file.created_at))}</dd>
      <dt>File created</dt><dd>${esc(file.doc_created_at ? formatDateTime(file.doc_created_at) : '—')}</dd>
      <dt>Person</dt><dd>${esc(file.person_name)}</dd>
      <dt>Location</dt><dd>${esc(path)}</dd>
      <dt>Checksum</dt><dd title="${esc(file.sha256)}"><code>${esc(file.sha256.slice(0, 16))}…</code></dd>
    </dl>
    <h3>Tags</h3>
    <div class="tags">${file.tags.length ? file.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('') : '<span class="muted small">No tags</span>'}</div>
    <div><button class="btn small" type="button" data-edit-tags>Edit tags</button></div>`;

  await openOverlay(`
    <div class="preview" role="dialog" aria-modal="true" aria-label="${esc(file.name)}">
      <header>
        <strong class="ellipsis">${esc(file.name)}</strong>
        <span class="muted small">${esc(formatSize(file.size))}</span>
        <span class="grow"></span>
        <button class="btn ghost details-toggle" type="button" data-details>Details</button>
        <a class="btn" href="${src}?download=1">Download</a>
        <button class="btn" type="button" data-close>Close</button>
      </header>
      <div class="preview-layout">
        <div class="preview-body">${body}</div>
        <aside class="details" id="details">${details}</aside>
      </div>
    </div>`, (root, close) => {
    root.querySelector('[data-details]')?.addEventListener('click', () => root.querySelector('#details').classList.toggle('open'));
    root.querySelector('[data-edit-tags]')?.addEventListener('click', async () => {
      close();
      await editTags(file.id, file.tags);
      openPreview(file.id);
    });
  });
}

async function editTags(fileId, currentTags) {
  const result = await formModal({
    title: 'Tags',
    message: 'Separate tags with commas. Tags help you find files with search (type #tag).',
    fields: [{ name: 'tags', label: 'Tags', value: currentTags.join(', '), optional: true, placeholder: 'e.g. tax, 2026, insurance' }],
    submit: 'Save tags',
  });
  if (!result) return;
  try {
    await api(`/files/${fileId}/tags`, { method: 'PUT', body: { tags: result.tags } });
    toast('Tags saved');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Drawer and sidebar --------------------------------------------------------

function openDrawer() {
  $('#app').classList.add('drawer-open');
}

function closeDrawer() {
  $('#app').classList.remove('drawer-open');
}

function applySidebarState(collapsed) {
  $('#app').classList.toggle('sidebar-collapsed', collapsed);
  const btn = $('#collapse-btn');
  btn.textContent = collapsed ? '»' : '«';
  btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

// ---- Auth screens -----------------------------------------------------------------

function showAuthCard(html) {
  $('#app').classList.add('hidden');
  const el = $('#auth');
  el.classList.remove('hidden');
  el.innerHTML = html;
  return el;
}

const brandHtml = () => '<div class="brand big"><span class="logo">D</span>DocuKaksh</div>';

async function boot() {
  const status = await api('/auth/status');
  if (!status.user) return status.setupRequired ? showSetup() : showLogin();
  state.user = status.user;
  applyTheme(status.user.theme);
  if (status.user.mustChangePassword) return showForcedChange();

  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#admin-section').classList.toggle('hidden', !isAdmin());
  $('#new-person').classList.toggle('hidden', !isAdmin());
  $('#account-email').textContent = status.user.email;
  $('#avatar').textContent = initial(status.user.email);
  applySidebarState(readStore('dk-sidebar', false) && window.innerWidth > 900);
  updateRecoveryCount(status.user.pendingRequests);

  const route = parseRoute();
  state.view = route.view;
  state.personId = route.personId;
  state.folderId = route.folderId;
  if (!viewAllowed(state.view)) state.view = 'files';
  await refreshPersons();
  if (state.view === 'files' && !state.persons.some((p) => p.id === state.personId)) {
    state.personId = state.persons[0]?.id ?? null;
    state.folderId = null;
  }
  history.replaceState(null, '', currentHash());
  await render();
}

const viewAllowed = (view) => view === 'files' || (isAdmin() && ['users', 'recovery', 'trash'].includes(view));
const currentHash = () => (state.view === 'files' ? personHash(state.personId, state.folderId) : `#/${state.view}`);

function showSetup() {
  const el = showAuthCard(`
    <form class="auth-card">
      ${brandHtml()}
      <h1>Create the super admin</h1>
      <p class="muted">This is a new install. The account you create here can add users, persons and recover accounts.</p>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Password (8+ characters)</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary wide" type="submit">Create account</button>
      <p class="error" role="alert"></p>
    </form>`);
  submitForm(el.querySelector('form'), '/auth/setup', () => boot());
}

function showLogin() {
  const el = showAuthCard(`
    <form class="auth-card">
      ${brandHtml()}
      <h1>Sign in</h1>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary wide" type="submit">Sign in</button>
      <p class="error" role="alert"></p>
      <div class="auth-links"><button class="link-btn" type="button" data-forgot>Forgot password?</button></div>
    </form>`);
  submitForm(el.querySelector('form'), '/auth/login', () => boot());
  el.querySelector('[data-forgot]').addEventListener('click', showRecovery);
}

function showRecovery() {
  const el = showAuthCard(`
    <form class="auth-card">
      ${brandHtml()}
      <h1>Request a new password</h1>
      <p class="muted">Enter your email. The super admin will review the request and send you a temporary password.</p>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Note for the admin (optional)</span><input name="note" type="text" maxlength="500" autocomplete="off"></label>
      <button class="btn primary wide" type="submit">Send request</button>
      <p class="error" role="alert"></p>
      <div class="auth-links"><button class="link-btn" type="button" data-back>Back to sign in</button></div>
    </form>`);
  el.querySelector('[data-back]').addEventListener('click', showLogin);
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      const data = await api('/auth/recovery', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.innerHTML = `${brandHtml()}<h1>Request sent</h1><p class="muted">${esc(data.message)}</p>
        <button class="btn wide" type="button" data-back>Back to sign in</button>`;
      form.querySelector('[data-back]').addEventListener('click', showLogin);
    } catch (err) {
      form.querySelector('.error').textContent = err.message;
    }
  });
}

// Shown after a super admin approves a request or resets the password. Cannot be skipped.
function showForcedChange() {
  const el = showAuthCard(`
    <form class="auth-card">
      ${brandHtml()}
      <h1>Choose a new password</h1>
      <p class="muted">You signed in with a temporary password. Choose your own password to continue.</p>
      <label class="field"><span>Temporary password</span><input name="current" type="password" required autocomplete="current-password"></label>
      <label class="field"><span>New password (8+ characters)</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary wide" type="submit">Save and continue</button>
      <p class="error" role="alert"></p>
      <div class="auth-links"><button class="link-btn" type="button" data-logout>Sign out</button></div>
    </form>`);
  el.querySelector('[data-logout]').addEventListener('click', logout);
  submitForm(el.querySelector('form'), '/auth/password', () => boot());
}

function submitForm(form, path, onSuccess) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('.error');
    errorEl.textContent = '';
    try {
      await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      await onSuccess();
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

// ---- Settings and account ---------------------------------------------------------

function openSettings() {
  const current = state.user.theme || 'day';
  const themes = THEMES.map((t) => `
    <button class="theme-option${t.id === current ? ' selected' : ''}" type="button" data-theme-choice="${t.id}">
      <span class="swatch" data-t="${t.id}"></span>${esc(t.label)}
    </button>`).join('');
  openOverlay(`
    <div class="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="settings-row"><h2 class="grow">Settings</h2><button class="btn" type="button" data-close>Close</button></div>
      <h3>Appearance</h3>
      <div class="theme-grid">${themes}</div>
      <h3>Account</h3>
      <p class="muted small">${esc(state.user.email)} · ${esc(ROLE_LABELS[state.user.role] ?? state.user.role)}</p>
      <div class="settings-row">
        <button class="btn" type="button" data-change-password>Change password</button>
        <button class="btn danger" type="button" data-logout>Sign out</button>
      </div>
    </div>`, (root, close) => {
    root.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.themeChoice;
        applyTheme(id);
        root.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.toggle('selected', b === button));
        state.user.theme = id;
        try {
          await api('/auth/me', { method: 'PATCH', body: { theme: id } });
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    root.querySelector('[data-change-password]').addEventListener('click', () => {
      close();
      changePassword();
    });
    root.querySelector('[data-logout]').addEventListener('click', () => {
      close();
      logout();
    });
  });
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

// ---- Persons ------------------------------------------------------------------------

async function refreshPersons() {
  state.persons = await api('/persons');
}

function renderPersons() {
  const nav = $('#person-list');
  if (!state.persons.length) {
    nav.innerHTML = `<p class="muted small pad">${isAdmin() ? 'No persons yet' : 'No persons assigned to you yet'}</p>`;
  } else {
    nav.innerHTML = state.persons.map((p) => `
      <button class="person${state.view === 'files' && p.id === state.personId ? ' active' : ''}" type="button"
        data-person="${p.id}" title="${esc(p.name)}" ${isAdmin() ? 'draggable="true"' : ''}>
        <span class="dot" data-color="${esc(p.color)}"></span>
        <span class="pname">${esc(p.name)}</span>
        <span class="count">${p.file_count}</span>
      </button>`).join('');
    nav.querySelectorAll('.dot').forEach((dot) => { dot.style.background = dot.dataset.color; });
  }
  for (const id of ['nav-users', 'nav-recovery', 'nav-trash']) {
    const view = id.replace('nav-', '');
    $(`#${id}`).classList.toggle('active', state.view === view);
  }
}

function updateRecoveryCount(count) {
  const badge = $('#recovery-count');
  badge.textContent = count || '';
  badge.classList.toggle('hidden', !count);
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
    title: `Move ${person.name} to the recycle bin?`,
    message: 'The person and everything under it is hidden from everyone. You can restore it from the recycle bin.',
    submit: 'Move to recycle bin',
    danger: true,
  });
  if (!result) return;
  try {
    await api(`/persons/${person.id}`, { method: 'DELETE' });
    await refreshPersons();
    toast('Moved to the recycle bin');
    go(state.persons[0]?.id ?? null, null);
  } catch (err) {
    toast(err.message, true);
  }
}

async function personSettings() {
  const person = currentPerson();
  if (!person) return;
  if (!isAdmin()) {
    return openOverlay(`
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(person.name)}">
        <h2>${esc(person.name)}</h2>
        <p class="muted">${person.file_count} document${person.file_count === 1 ? '' : 's'} in this person.</p>
        <p class="muted small">Only the super admin can rename, recolour, or remove a person.</p>
        <div class="modal-actions"><button class="btn primary" type="button" data-close>Close</button></div>
      </div>`);
  }
  const choice = await openSheet(person.name, [
    { value: 'edit', label: 'Edit name and colour' },
    { value: 'delete', label: 'Move to recycle bin', danger: true },
  ]);
  if (choice === 'edit') return editPerson();
  if (choice === 'delete') return deletePerson();
}

// Dragging persons in the sidebar sets their display order (super admin only).
async function reorderPersons(draggedId, targetId) {
  const ids = state.persons.map((p) => p.id).filter((id) => id !== draggedId);
  const index = ids.indexOf(targetId);
  ids.splice(index < 0 ? ids.length : index, 0, draggedId);
  try {
    await api('/persons/order', { method: 'PUT', body: { ids } });
    await refreshPersons();
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Rendering --------------------------------------------------------------------

async function render() {
  const token = ++renderToken;
  renderPersons();
  const isFiles = state.view === 'files';
  const hasPersons = state.persons.length > 0;
  $('#toolbar').classList.toggle('hidden', !isFiles || !hasPersons);
  $('#users-toolbar').classList.toggle('hidden', state.view !== 'users');
  $('#search').closest('.search-box').classList.toggle('hidden', !isFiles);
  $('#person-settings').classList.toggle('hidden', !isFiles || !state.personId);
  $('#crumbs').innerHTML = '';
  $('#item-count').textContent = '';
  $('#content').classList.toggle('hidden', false);

  if (state.view === 'users') return renderUsers(token);
  if (state.view === 'recovery') return renderRecovery(token);
  if (state.view === 'trash') return renderTrash(token);
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
    if (err.status === 401) return showLogin();
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

function staticCrumb(text) {
  $('#crumbs').innerHTML = `<span class="crumb-static">${esc(text)}</span>`;
}

const tagsHtml = (tags = []) => (tags.length
  ? `<span class="tags">${tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}</span>`
  : '');

// One row layout for files, folders, search results, users, requests and bin items.
function rowHtml({ kind, id, icon, iconClass = '', label, meta, col1 = '', col2 = '', tags = [], attrs = '', draggable = false }) {
  return `
    <div class="row" data-kind="${kind}" data-id="${id}" tabindex="0" ${draggable ? 'draggable="true"' : ''} ${attrs}>
      <span class="name">
        <span class="icon ${iconClass}">${icon}</span>
        <span class="text"><span class="label">${esc(label)}</span><span class="meta">${meta}</span>${tagsHtml(tags)}</span>
      </span>
      <span class="col">${col1}</span>
      <span class="col">${col2}</span>
      <button class="kebab" type="button" data-kebab aria-label="More actions for ${esc(label)}">⋯</button>
    </div>`;
}

// Column headers. Clicking a header sorts; the same header again reverses the order.
function headerHtml(columns) {
  const cells = columns.map(([key, label]) => {
    const active = state.sort.key === key;
    const aria = active ? ` aria-sort="${state.sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
    const arrow = active ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<span class="${key === 'name' ? 'name' : 'col'}"><button class="sort-btn" type="button" data-sort="${key}"${aria}>${esc(label)}${arrow}</button></span>`;
  }).join('');
  return `<div class="row head">${cells}<span class="kebab-spacer"></span></div>`;
}

function sortItems(folders, files) {
  const { key, dir } = state.sort;
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const compare = key === 'size'
    ? (a, b) => (a.size ?? 0) - (b.size ?? 0)
    : key === 'added'
      ? (a, b) => String(a.created_at).localeCompare(String(b.created_at))
      : byName;
  const sortList = (list) => [...list].sort((a, b) => sign * compare(a, b) || byName(a, b));
  return { folders: sortList(folders), files: sortList(files) };
}

function renderBrowse({ folders, files }) {
  const content = $('#content');
  const total = folders.length + files.length;
  $('#item-count').textContent = `${total} item${total === 1 ? '' : 's'}`;
  if (!total) {
    content.innerHTML = `
      <div class="empty">
        <h2>This folder is empty</h2>
        <p class="muted">Upload files, or create a subfolder to keep things organised.</p>
      </div>`;
    return;
  }
  const sorted = sortItems(folders, files);
  const draggable = true;
  const folderRows = sorted.folders.map((f) => rowHtml({
    kind: 'folder',
    id: f.id,
    icon: FOLDER_ICON,
    iconClass: 'folder',
    label: f.name,
    meta: `Folder · ${esc(formatDate(f.created_at))}`,
    col1: 'Folder',
    col2: esc(formatDate(f.created_at)),
    draggable,
  })).join('');
  const fileRows = sorted.files.map((f) => rowHtml({
    kind: 'file',
    id: f.id,
    icon: extBadge(f.name),
    label: f.name,
    meta: `${esc(formatSize(f.size))} · ${esc(formatDate(f.created_at))}`,
    col1: esc(formatSize(f.size)),
    col2: esc(formatDate(f.created_at)),
    tags: f.tags,
    draggable,
  })).join('');
  content.innerHTML = `<div class="list">${headerHtml([['name', 'Name'], ['size', 'Size'], ['added', 'Added']])}${folderRows}${fileRows}</div>`;
}

function renderEmpty() {
  $('#content').innerHTML = `
    <div class="empty">
      <h2>${isAdmin() ? 'Welcome to DocuKaksh' : 'No persons assigned yet'}</h2>
      <p class="muted">${isAdmin()
        ? 'Start by creating a person or category, for example "Papa", "Office" or "Car". Then assign it to the users who should see it.'
        : 'Ask the super admin to assign a person to your account.'}</p>
      ${isAdmin() ? '<button class="btn primary" type="button" data-action="new-person">Create a person</button>' : ''}
    </div>`;
}

async function renderSearch(token) {
  const q = state.query;
  const results = await api(`/search?q=${encodeURIComponent(q)}`);
  if (token !== renderToken) return;
  staticCrumb(`Results for “${q}”`);
  $('#item-count').textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
  if (!results.length) {
    $('#content').innerHTML = '<div class="empty"><h2>No matching files</h2><p class="muted">Try another name, or search a tag with #tag.</p></div>';
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
      tags: f.tags,
      attrs: `data-search="1" data-person="${f.person_id}" data-folder="${f.folder_id ?? ''}"`,
    });
  }).join('');
  $('#content').innerHTML = `<div class="list">${rows}</div>`;
}

async function renderUsers(token) {
  staticCrumb('Users');
  const users = await api('/users');
  if (token !== renderToken) return;
  $('#item-count').textContent = `${users.length} account${users.length === 1 ? '' : 's'}`;
  const rows = users.map((u) => {
    const self = u.id === state.user.id;
    const roleLabel = ROLE_LABELS[u.role] ?? u.role;
    const status = u.active ? 'Active' : 'Disabled';
    const counts = `${u.person_count} person${u.person_count === 1 ? '' : 's'} · ${u.file_count} file${u.file_count === 1 ? '' : 's'}`;
    const flags = [u.must_change_password ? 'Must change password' : null].filter(Boolean).join(' · ');
    return rowHtml({
      kind: 'user',
      id: u.id,
      icon: initial(u.email),
      iconClass: 'user',
      label: self ? `${u.email} (you)` : u.email,
      meta: `${esc(roleLabel)} · ${status} · ${counts}${flags ? ` · ${esc(flags)}` : ''}`,
      col1: `<span class="badge${u.role === 'super_admin' ? ' admin' : ''}">${esc(roleLabel)}</span>`,
      col2: u.active ? `<span class="muted">${status}</span>` : '<span class="badge off">Disabled</span>',
      attrs: `data-email="${esc(u.email)}" data-role="${u.role}" data-active="${u.active ? 1 : 0}" data-self="${self ? 1 : 0}" data-person-ids="${esc(u.person_ids ?? '')}"`,
    });
  }).join('');
  $('#content').innerHTML = rows
    ? `<div class="list">${rows}</div>`
    : '<div class="empty"><h2>No accounts</h2></div>';
}

async function renderRecovery(token) {
  staticCrumb('Recovery requests');
  const requests = await api('/recovery');
  if (token !== renderToken) return;
  const pending = requests.filter((r) => r.status === 'pending').length;
  updateRecoveryCount(pending);
  $('#item-count').textContent = `${pending} pending`;
  if (!requests.length) {
    $('#content').innerHTML = '<div class="empty"><h2>No requests</h2><p class="muted">When someone forgets their password and asks for help, the request appears here.</p></div>';
    return;
  }
  const rows = requests.map((r) => {
    const badge = r.status === 'pending' ? '<span class="badge admin">Pending</span>'
      : r.status === 'approved' ? '<span class="badge">Approved</span>' : '<span class="badge off">Rejected</span>';
    return rowHtml({
      kind: 'recovery',
      id: r.id,
      icon: initial(r.email),
      iconClass: 'user',
      label: r.email,
      meta: `${r.note ? `“${esc(r.note)}” · ` : ''}${esc(formatDateTime(r.created_at))}`,
      col1: badge,
      col2: esc(formatDate(r.created_at)),
      attrs: `data-status="${r.status}" data-email="${esc(r.email)}"`,
    });
  }).join('');
  $('#content').innerHTML = `<div class="list">${rows}</div>`;
}

async function renderTrash(token) {
  staticCrumb('Recycle bin');
  const items = await api('/trash');
  if (token !== renderToken) return;
  $('#item-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    $('#content').innerHTML = '<div class="empty"><h2>The recycle bin is empty</h2><p class="muted">Deleted persons, folders and files appear here until you restore them or delete them for good.</p></div>';
    return;
  }
  const rows = items.map((item) => {
    const isFile = item.kind === 'file';
    const kindLabel = item.kind === 'person' ? 'Person' : item.kind === 'folder' ? 'Folder' : 'File';
    const where = item.kind === 'person' ? 'Person' : item.person_name;
    return rowHtml({
      kind: 'trash',
      id: item.id,
      icon: item.kind === 'folder' ? FOLDER_ICON : item.kind === 'person' ? initial(item.name) : extBadge(item.name),
      iconClass: item.kind === 'folder' ? 'folder' : item.kind === 'person' ? 'user' : '',
      label: item.name,
      meta: `${kindLabel} · ${esc(where)} · deleted ${esc(formatDateTime(item.deleted_at))}${item.deleted_by_email ? ` by ${esc(item.deleted_by_email)}` : ''}`,
      col1: item.kind === 'person' ? 'Whole person' : `${esc(kindLabel)} · ${esc(where)}`,
      col2: esc(formatDate(item.deleted_at)),
      attrs: `data-item="${item.kind}" data-name="${esc(item.name)}" data-file="${isFile ? 1 : 0}"`,
    });
  }).join('');
  const header = '<div class="row head"><span class="name">Item</span><span class="col">Location</span><span class="col">Deleted</span><span class="kebab-spacer"></span></div>';
  $('#content').innerHTML = `<div class="list">${header}${rows}</div>`;
}

// ---- Item actions ---------------------------------------------------------------------

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
  await moveTo(kind, id, result.target === '' ? null : Number(result.target));
}

// Shared by the Move dialog and drag and drop.
async function moveTo(kind, id, targetFolderId) {
  const body = kind === 'folder' ? { parent_id: targetFolderId } : { folder_id: targetFolderId };
  await api(`/${endpoint(kind)}/${id}`, { method: 'PATCH', body });
  toast('Moved');
  render();
}

async function remove(kind, id) {
  const result = await formModal({
    title: `Move this ${kind} to the recycle bin?`,
    message: kind === 'folder'
      ? 'The folder and everything inside it is hidden. A super admin can restore it from the recycle bin.'
      : 'The file is hidden. A super admin can restore it from the recycle bin.',
    submit: 'Move to recycle bin',
    danger: true,
  });
  if (!result) return;
  await api(`/${endpoint(kind)}/${id}`, { method: 'DELETE' });
  toast('Moved to the recycle bin');
  render();
}

function documentMenuItems(row) {
  const kind = row.dataset.kind;
  if (row.dataset.search) {
    return [
      { value: 'preview', label: 'Preview and details' },
      { value: 'download', label: 'Download' },
      { value: 'tags', label: 'Edit tags' },
      { value: 'reveal', label: 'Open folder' },
    ];
  }
  if (kind === 'folder') {
    return [
      { value: 'rename', label: 'Rename' },
      { value: 'move', label: 'Move' },
      { value: 'delete', label: 'Move to recycle bin', danger: true },
    ];
  }
  return [
    { value: 'preview', label: 'Preview and details' },
    { value: 'download', label: 'Download' },
    { value: 'tags', label: 'Edit tags' },
    { value: 'rename', label: 'Rename' },
    { value: 'move', label: 'Move' },
    { value: 'delete', label: 'Move to recycle bin', danger: true },
  ];
}

function userMenuItems(row) {
  if (row.dataset.self === '1') return [];
  const items = [
    { value: 'persons', label: 'Manage persons' },
    { value: 'reset', label: 'Reset password' },
    { value: 'toggle', label: row.dataset.active === '1' ? 'Disable account' : 'Enable account' },
    { value: 'role', label: row.dataset.role === 'super_admin' ? 'Remove super admin role' : 'Make super admin' },
    { value: 'delete', label: 'Delete login (documents are kept)', danger: true },
  ];
  return items;
}

function recoveryMenuItems(row) {
  if (row.dataset.status !== 'pending') return [];
  return [
    { value: 'approve', label: 'Approve and create temporary password' },
    { value: 'reject', label: 'Reject request', danger: true },
  ];
}

function trashMenuItems() {
  return [
    { value: 'restore', label: 'Restore' },
    { value: 'purge', label: 'Delete forever', danger: true },
  ];
}

async function openRowMenu(row) {
  const kind = row.dataset.kind;
  const titles = {
    user: () => row.dataset.email,
    recovery: () => row.dataset.email,
    trash: () => row.dataset.name,
  };
  const title = titles[kind]?.() ?? row.querySelector('.label').textContent.trim();
  const items = {
    user: () => userMenuItems(row),
    recovery: () => recoveryMenuItems(row),
    trash: () => trashMenuItems(),
  }[kind]?.() ?? documentMenuItems(row);
  if (!items.length) return toast('No actions available for this row', true);
  const choice = await openSheet(title, items);
  if (!choice) return;
  if (kind === 'user') return userAction(choice, row);
  if (kind === 'recovery') return recoveryAction(choice, row);
  if (kind === 'trash') return trashAction(choice, row);
  return rowAction(choice, row);
}

async function rowAction(action, row) {
  const kind = row.dataset.kind;
  const id = Number(row.dataset.id);
  try {
    if (action === 'preview') return await openPreview(id);
    if (action === 'download') return (location.href = `/api/files/${id}/content?download=1`);
    if (action === 'tags') {
      const file = await api(`/files/${id}`);
      return await editTags(id, file.tags);
    }
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
    message: 'The user signs in with this temporary password and must choose their own at first sign-in.',
    fields: [
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'password', label: 'Temporary password (8+ characters)', type: 'password' },
      {
        name: 'role',
        label: 'Role',
        type: 'select',
        value: 'user',
        options: [
          { value: 'user', label: 'User (works with assigned persons)' },
          { value: 'super_admin', label: 'Super admin (manages everything)' },
        ],
      },
      {
        name: 'personIds',
        label: 'Persons this user can access',
        type: 'checkboxes',
        value: [],
        options: state.persons.map((p) => ({ value: p.id, label: p.name })),
      },
    ],
    submit: 'Create user',
  });
  if (!result) return;
  try {
    await api('/users', {
      method: 'POST',
      body: { email: result.email, password: result.password, role: result.role, personIds: result.personIds.map(Number) },
    });
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
    if (action === 'persons') {
      const assigned = row.dataset.personIds ? row.dataset.personIds.split(',').map(Number) : [];
      const result = await formModal({
        title: `Persons for ${email}`,
        message: 'Users only see the persons ticked here, and can add and change documents in them.',
        fields: [{
          name: 'personIds',
          label: 'Assigned persons',
          type: 'checkboxes',
          value: assigned,
          options: state.persons.map((p) => ({ value: p.id, label: p.name })),
        }],
        submit: 'Save',
      });
      if (!result) return;
      await api(`/users/${id}/persons`, { method: 'PUT', body: { personIds: result.personIds.map(Number) } });
      toast('Persons updated');
    } else if (action === 'reset') {
      const result = await formModal({
        title: `Reset password for ${email}`,
        message: 'They must choose a new password at their next sign-in. Their current sessions are signed out.',
        fields: [{ name: 'password', label: 'Temporary password (8+ characters)', type: 'password' }],
        submit: 'Reset password',
      });
      if (!result) return;
      await api(`/users/${id}/password`, { method: 'POST', body: result });
      toast('Temporary password set');
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
        title: `Delete the login for ${email}?`,
        message: 'The account can no longer sign in. Persons they created go to you, and the documents they uploaded are kept.',
        submit: 'Delete login',
        danger: true,
      });
      if (!result) return;
      await api(`/users/${id}`, { method: 'DELETE' });
      toast('Login deleted');
    }
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

async function recoveryAction(action, row) {
  const id = Number(row.dataset.id);
  try {
    if (action === 'reject') {
      await api(`/recovery/${id}/reject`, { method: 'POST' });
      toast('Request rejected');
      return render();
    }
    if (action === 'approve') {
      const result = await api(`/recovery/${id}/approve`, { method: 'POST' });
      await showTemporaryPassword(result.email, result.temporaryPassword);
      render();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

// Shows a generated password exactly once. It is not stored anywhere in readable form.
function showTemporaryPassword(email, password) {
  return openOverlay(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="Temporary password">
      <h2>Temporary password for ${esc(email)}</h2>
      <p class="muted">Send this to the user through a channel you trust. It is shown only once. They will be asked to choose a new password at sign-in.</p>
      <div class="copy-box"><span>${esc(password)}</span><button class="btn small" type="button" data-copy>Copy</button></div>
      <div class="modal-actions"><button class="btn primary" type="button" data-close>Done</button></div>
    </div>`, (root) => {
    root.querySelector('[data-copy]').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(password);
        e.currentTarget.textContent = 'Copied';
      } catch {
        toast('Copy is not available here. Select the password and copy it manually.', true);
      }
    });
  });
}

async function trashAction(action, row) {
  const kind = row.dataset.item;
  const id = Number(row.dataset.id);
  try {
    if (action === 'restore') {
      await api(`/trash/${kind}/${id}/restore`, { method: 'POST' });
      toast('Restored');
    } else if (action === 'purge') {
      const result = await formModal({
        title: `Delete ${row.dataset.name} forever?`,
        message: 'This cannot be undone. The file contents are removed from the server.',
        submit: 'Delete forever',
        danger: true,
      });
      if (!result) return;
      await api(`/trash/${kind}/${id}`, { method: 'DELETE' });
      toast('Deleted forever');
    }
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Upload -----------------------------------------------------------------------

async function uploadFiles(fileList) {
  if (state.view !== 'files') return toast('Open a person to upload files', true);
  if (!state.personId) return toast('Create a person first', true);
  const files = [...fileList];
  if (!files.length) return;

  // Snapshot everything before any await: the file input is cleared after the change event.
  const dates = files.map((f) => f.lastModified);
  const personId = state.personId;
  const folderId = state.folderId;
  const tagResult = await formModal({
    title: `Upload ${files.length} file${files.length > 1 ? 's' : ''}`,
    message: files.map((f) => f.name).slice(0, 5).join(', ') + (files.length > 5 ? ` and ${files.length - 5} more` : ''),
    fields: [{ name: 'tags', label: 'Tags (optional)', optional: true, placeholder: 'e.g. tax, 2026' }],
    submit: 'Upload',
  });
  if (!tagResult) return;

  const form = new FormData();
  form.append('person_id', String(personId));
  if (folderId) form.append('folder_id', String(folderId));
  form.append('tags', tagResult.tags || '');
  form.append('file_dates', JSON.stringify(dates));
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
      showLogin();
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

// ---- Sorting ----------------------------------------------------------------------

function setSort(key, dir) {
  state.sort = { key, dir };
  writeStore('dk-sort', state.sort);
  render();
}

function sortSheet() {
  return openSheet('Sort by', [
    { value: 'name:asc', label: 'Name, A to Z' },
    { value: 'name:desc', label: 'Name, Z to A' },
    { value: 'size:desc', label: 'Size, largest first' },
    { value: 'size:asc', label: 'Size, smallest first' },
    { value: 'added:desc', label: 'Added, newest first' },
    { value: 'added:asc', label: 'Added, oldest first' },
  ]).then((choice) => {
    if (!choice) return;
    const [key, dir] = choice.split(':');
    setSort(key, dir);
  });
}

// ---- Drag and drop -------------------------------------------------------------

function wireDragAndDrop() {
  const content = $('#content');
  content.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row[data-kind="file"], .row[data-kind="folder"]');
    if (!row || row.dataset.search) return e.preventDefault();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(ITEM_TYPE, JSON.stringify({ kind: row.dataset.kind, id: Number(row.dataset.id) }));
    row.classList.add('dragging');
  });
  content.addEventListener('dragend', (e) => {
    e.target.closest?.('.row')?.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  });
  content.addEventListener('dragover', (e) => {
    if (!hasType(e, ITEM_TYPE)) return;
    const row = e.target.closest('.row[data-kind="folder"]');
    if (!row) return;
    e.preventDefault();
    row.classList.add('drop-target');
  });
  content.addEventListener('dragleave', (e) => {
    e.target.closest?.('.row')?.classList.remove('drop-target');
  });
  content.addEventListener('drop', (e) => {
    if (!hasType(e, ITEM_TYPE)) return;
    const row = e.target.closest('.row[data-kind="folder"]');
    if (!row) return;
    e.preventDefault();
    row.classList.remove('drop-target');
    dropItemOn(JSON.parse(e.dataTransfer.getData(ITEM_TYPE)), Number(row.dataset.id));
  });

  // Breadcrumbs are drop targets too: the person root is the empty crumb.
  const crumbs = $('#crumbs');
  crumbs.addEventListener('dragover', (e) => {
    if (!hasType(e, ITEM_TYPE)) return;
    const crumb = e.target.closest('[data-crumb]');
    if (!crumb) return;
    e.preventDefault();
    crumb.classList.add('drop-target');
  });
  crumbs.addEventListener('dragleave', (e) => e.target.closest?.('[data-crumb]')?.classList.remove('drop-target'));
  crumbs.addEventListener('drop', (e) => {
    if (!hasType(e, ITEM_TYPE)) return;
    const crumb = e.target.closest('[data-crumb]');
    if (!crumb) return;
    e.preventDefault();
    crumb.classList.remove('drop-target');
    const target = crumb.dataset.crumb ? Number(crumb.dataset.crumb) : null;
    dropItemOn(JSON.parse(e.dataTransfer.getData(ITEM_TYPE)), target, true);
  });

  // Sidebar: admins reorder persons by dragging; items dropped on a person are refused.
  const nav = $('#person-list');
  nav.addEventListener('dragstart', (e) => {
    const button = e.target.closest('[data-person]');
    if (!button || !isAdmin()) return e.preventDefault();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PERSON_TYPE, button.dataset.person);
  });
  nav.addEventListener('dragover', (e) => {
    const button = e.target.closest('[data-person]');
    if (!button) return;
    if (hasType(e, PERSON_TYPE) || hasType(e, ITEM_TYPE)) {
      e.preventDefault();
      button.classList.add('drop-target');
    }
  });
  nav.addEventListener('dragleave', (e) => e.target.closest?.('[data-person]')?.classList.remove('drop-target'));
  nav.addEventListener('drop', (e) => {
    const button = e.target.closest('[data-person]');
    document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    if (!button) return;
    e.preventDefault();
    if (hasType(e, PERSON_TYPE)) {
      reorderPersons(Number(e.dataTransfer.getData(PERSON_TYPE)), Number(button.dataset.person));
    } else if (hasType(e, ITEM_TYPE)) {
      toast('Drag documents onto a folder inside the person. Moving between persons is not supported.', true);
    }
  });
}

async function dropItemOn(item, targetFolderId, toRoot = false) {
  if (item.kind === 'folder' && item.id === targetFolderId) return;
  try {
    const tree = await api(`/persons/${state.personId}/tree`);
    if (item.kind === 'folder' && targetFolderId && descendantIds(tree, item.id).has(targetFolderId)) {
      return toast('A folder cannot be moved into itself', true);
    }
    await moveTo(item.kind, item.id, targetFolderId);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Event wiring -----------------------------------------------------------------

window.addEventListener('hashchange', () => {
  const route = parseRoute();
  state.view = viewAllowed(route.view) ? route.view : 'files';
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
$('#collapse-btn').addEventListener('click', () => {
  const collapsed = !$('#app').classList.contains('sidebar-collapsed');
  writeStore('dk-sidebar', collapsed);
  applySidebarState(collapsed);
});
$('#account-btn').addEventListener('click', openSettings);

$('#new-person').addEventListener('click', newPerson);
$('#person-settings').addEventListener('click', personSettings);
$('#sort-btn').addEventListener('click', sortSheet);
$('#new-folder').addEventListener('click', newFolder);
$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  const files = e.target.files;
  uploadFiles(files).finally(() => { e.target.value = ''; });
});
$('#new-user').addEventListener('click', newUser);

$('#person-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-person]');
  if (button) go(Number(button.dataset.person), null);
});
for (const view of ['users', 'recovery', 'trash']) {
  $(`#nav-${view}`).addEventListener('click', () => navigate(`#/${view}`));
}

$('#crumbs').addEventListener('click', (e) => {
  const crumb = e.target.closest('[data-crumb]');
  if (crumb) go(state.personId, crumb.dataset.crumb ? Number(crumb.dataset.crumb) : null);
});

$('#content').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="new-person"]')) return newPerson();
  const sort = e.target.closest('[data-sort]');
  if (sort) {
    const key = sort.dataset.sort;
    const dir = state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc';
    return setSort(key, dir);
  }
  const row = e.target.closest('.row[data-kind]');
  if (!row) return;
  if (e.target.closest('[data-kebab]')) return openRowMenu(row);
  if (row.dataset.kind === 'folder') return go(state.personId, Number(row.dataset.id));
  if (row.dataset.kind === 'file') return rowAction('preview', row);
});

$('#content').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.row[data-kind="file"], .row[data-kind="folder"]')) e.target.click();
});

$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    render();
  }, 250);
});

// Drag and drop of files from the desktop to upload.
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

wireDragAndDrop();
boot().catch((err) => toast(err.message, true));
