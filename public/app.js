const state = { user: null, persons: [], personId: null, folderId: null, query: '' };
let renderToken = 0;
let searchTimer = null;
let dragDepth = 0;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const FOLDER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;

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
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

function parseHash() {
  const match = location.hash.match(/^#\/p\/(\d+)(?:\/f\/(\d+))?$/);
  return match
    ? { personId: Number(match[1]), folderId: match[2] ? Number(match[2]) : null }
    : { personId: null, folderId: null };
}

// Navigation is kept in the URL hash, so reload and the back button both work.
function go(personId, folderId = null) {
  state.query = '';
  $('#search').value = '';
  const hash = personId ? `#/p/${personId}${folderId ? `/f/${folderId}` : ''}` : '#/';
  if (location.hash === hash) return render();
  location.hash = hash; // the hashchange listener renders
}

// ---- Modal and overlay -----------------------------------------------------

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
    return `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" required autocomplete="off"></label>`;
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

// ---- Auth ----------------------------------------------------------------

async function boot() {
  const status = await api('/auth/status');
  if (!status.user) return showAuth(status.setupRequired);
  state.user = status.user;
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const { personId, folderId } = parseHash();
  state.personId = personId;
  state.folderId = folderId;
  await refreshPersons();
  if (!state.persons.some((p) => p.id === state.personId)) {
    state.personId = state.persons[0]?.id ?? null;
    state.folderId = null;
  }
  const hash = state.personId ? `#/p/${state.personId}${state.folderId ? `/f/${state.folderId}` : ''}` : '#/';
  history.replaceState(null, '', hash);
  await render();
}

function showAuth(setupRequired) {
  $('#app').classList.add('hidden');
  const el = $('#auth');
  el.classList.remove('hidden');
  el.innerHTML = `
    <form class="auth-card">
      <div class="brand big"><span class="logo">D</span>DocuKaksh</div>
      <h1>${setupRequired ? 'Create your account' : 'Sign in'}</h1>
      <p class="muted">${setupRequired ? 'This is a new install. The account you create here owns all documents.' : 'Enter your credentials to continue.'}</p>
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

// ---- Persons -------------------------------------------------------------

async function refreshPersons() {
  state.persons = await api('/persons');
}

function renderPersons() {
  const nav = $('#person-list');
  if (!state.persons.length) {
    nav.innerHTML = '<p class="muted small pad">No persons yet</p>';
    return;
  }
  nav.innerHTML = state.persons.map((p) => `
    <button class="person${p.id === state.personId ? ' active' : ''}" type="button" data-person="${p.id}">
      <span class="dot" data-color="${esc(p.color)}"></span>
      <span class="pname">${esc(p.name)}</span>
      <span class="count">${p.file_count}</span>
    </button>`).join('');
  nav.querySelectorAll('.dot').forEach((dot) => { dot.style.background = dot.dataset.color; });
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

// ---- Rendering -----------------------------------------------------------

async function render() {
  const token = ++renderToken;
  renderPersons();
  const hasPersons = state.persons.length > 0;
  $('#toolbar').classList.toggle('hidden', !hasPersons);
  $('#crumbs').innerHTML = '';

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

function renderBrowse({ folders, files }) {
  const content = $('#content');
  if (!folders.length && !files.length) {
    content.innerHTML = `
      <div class="empty">
        <h2>This folder is empty</h2>
        <p class="muted">Drop files anywhere on this page or click Upload. Create subfolders to keep things organised.</p>
      </div>`;
    return;
  }
  const folderRows = folders.map((f) => `
    <div class="row" data-kind="folder" data-id="${f.id}" tabindex="0">
      <span class="name"><span class="icon folder">${FOLDER_ICON}</span><span class="label">${esc(f.name)}</span></span>
      <span class="hide-sm muted small">Folder</span>
      <span class="hide-sm muted small">${formatDate(f.created_at)}</span>
      <span class="actions">${actionButtons(['rename', 'move', 'delete'])}</span>
    </div>`).join('');
  const fileRows = files.map((f) => `
    <div class="row" data-kind="file" data-id="${f.id}" tabindex="0">
      <span class="name"><span class="icon">${extBadge(f.name)}</span><span class="label">${esc(f.name)}</span></span>
      <span class="hide-sm muted small">${formatSize(f.size)}</span>
      <span class="hide-sm muted small">${formatDate(f.created_at)}</span>
      <span class="actions">${actionButtons(['preview', 'download', 'rename', 'move', 'delete'])}</span>
    </div>`).join('');
  content.innerHTML = `
    <div class="list">
      <div class="row head"><span>Name</span><span>Size</span><span>Added</span><span></span></div>
      ${folderRows}${fileRows}
    </div>`;
}

function renderEmpty() {
  $('#content').innerHTML = `
    <div class="empty">
      <h2>Welcome to DocuKaksh</h2>
      <p class="muted">Start by creating a person or category, for example "Papa", "Office" or "Car". Each one gets its own folders and files.</p>
      <button class="btn primary" type="button" data-action="new-person">Create a person</button>
    </div>`;
}

const ACTION_LABELS = {
  preview: 'Preview',
  download: 'Download',
  reveal: 'Open folder',
  rename: 'Rename',
  move: 'Move',
  delete: 'Delete',
};

function actionButtons(actions) {
  return actions.map((a) => `<button class="btn ghost" type="button" data-action="${a}">${ACTION_LABELS[a]}</button>`).join('');
}

async function renderSearch(token) {
  const results = await api(`/search?q=${encodeURIComponent(state.query)}`);
  if (token !== renderToken) return;
  $('#crumbs').innerHTML = `<span class="muted">Results for “${esc(state.query)}”</span>`;
  if (!results.length) {
    $('#content').innerHTML = '<div class="empty"><h2>No matching files</h2><p class="muted">Try a different name.</p></div>';
    return;
  }
  const rows = results.map((f) => {
    const where = [f.person_name, f.folder_name].filter(Boolean).join(' / ');
    return `
      <div class="row" data-kind="file" data-id="${f.id}" data-person="${f.person_id}" data-folder="${f.folder_id ?? ''}" tabindex="0">
        <span class="name"><span class="icon">${extBadge(f.name)}</span>
          <span class="label">${esc(f.name)}<br><span class="where muted">${esc(where)}</span></span></span>
        <span class="hide-sm muted small">${formatSize(f.size)}</span>
        <span class="hide-sm muted small">${formatDate(f.created_at)}</span>
        <span class="actions">${actionButtons(['preview', 'download', 'reveal', 'delete'])}</span>
      </div>`;
  }).join('');
  $('#content').innerHTML = `<div class="list">${rows}</div>`;
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

// ---- Upload ----------------------------------------------------------------

function uploadFiles(fileList) {
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
  const { personId, folderId } = parseHash();
  state.personId = personId;
  state.folderId = folderId;
  if (!personId && state.persons.length) return go(state.persons[0].id, null);
  render();
});

$('#new-person').addEventListener('click', newPerson);
$('#edit-person').addEventListener('click', editPerson);
$('#delete-person').addEventListener('click', deletePerson);
$('#new-folder').addEventListener('click', newFolder);
$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  uploadFiles(e.target.files);
  e.target.value = '';
});

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  state.persons = [];
  history.replaceState(null, '', location.pathname);
  boot();
});

$('#person-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-person]');
  if (button) go(Number(button.dataset.person), null);
});

$('#crumbs').addEventListener('click', (e) => {
  const crumb = e.target.closest('[data-crumb]');
  if (crumb) go(state.personId, crumb.dataset.crumb ? Number(crumb.dataset.crumb) : null);
});

$('#content').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="new-person"]')) return newPerson();
  const row = e.target.closest('.row[data-kind]');
  if (!row) return;
  const action = e.target.closest('[data-action]');
  if (action) {
    e.stopPropagation();
    return rowAction(action.dataset.action, row);
  }
  if (row.dataset.kind === 'folder') return go(state.personId, Number(row.dataset.id));
  return rowAction('preview', row);
});

$('#content').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.row[data-kind]')) e.target.click();
});

$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    render();
  }, 250);
});

// Drag and drop anywhere on the page.
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
