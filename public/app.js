import { t, setLanguage, applyTranslations, LANGUAGES } from './i18n.js';

// ---- Constants ----------------------------------------------------------------

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
  { id: 'one-dark', label: 'One Dark' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'github-light', label: 'GitHub Light' },
  { id: 'everforest-light', label: 'Everforest Light' },
  { id: 'ayu-dark', label: 'Ayu Dark' },
  { id: 'material-ocean', label: 'Material Ocean' },
  { id: 'lime', label: 'Lime' },
];

// Folder icons: 24-unit outline drawings. The ids must match src/icons.js.
const ICON_PATHS = {
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  house: '<path d="M4 10l8-6 8 6v10H4z"/><path d="M10 20v-5h4v5"/>',
  car: '<path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="19" r="1"/><circle cx="16.5" cy="19" r="1"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>',
  school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
  medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  passport: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M8 18h8"/>',
  id: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M13 10h5M13 14h4"/>',
  plane: '<path d="M2 13l20-8-8 20-3-8z"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11 21l-3-3 9.7-9.7z"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-6-6-8 8"/>',
  gift: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8c-2-3-6-3-6 0s6 0 6 0zM12 8c2-3 6-3 6 0s-6 0-6 0z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cloud: '<path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 18 18z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 7H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  baby: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  pet: '<circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="4.5" cy="14" r="1.5"/><circle cx="19.5" cy="14" r="1.5"/><path d="M8 18c0-2 2-3 4-3s4 1 4 3-2 3-4 3-4-1-4-3z"/>',
};
const iconSvg = (id) => `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[id] ?? ICON_PATHS.folder}</svg>`;

const PERMISSION_HELP = {
  view: 'Can open and download. Cannot change anything.',
  edit: 'Can open, change, move, delete and share onwards.',
  dropbox: 'Can upload into the folder only. Cannot see what is inside it.',
};
const PREVIEWABLE_NATIVE = new Set(['pdf', 'image', 'video', 'audio']);

// ---- State ------------------------------------------------------------------------

const state = {
  user: null,
  version: '',
  persons: [],
  personId: null,
  folderId: null,
  folder: null,
  level: 'edit',
  view: 'home',
  query: '',
  sort: readStore('dk-sort', { key: 'name', dir: 'asc' }),
  selecting: false,
  selected: new Map(),
  retention: 30,
  auditFilters: {},
  pending: 0,
  page: 1,
  pageSize: 50,
};

let renderToken = 0;
let searchTimer = null;
let dragDepth = 0;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const ITEM_TYPE = 'application/x-dk-item';
const PERSON_TYPE = 'application/x-dk-person';
const ROLE_LABELS = { super_admin: 'Super admin', user: 'User' };

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
    // Ignored: the preference will not persist.
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
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS"; ISO strings come from the browser or server clock.
function parseStamp(value) {
  if (!value) return null;
  const date = new Date(/T|Z|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
const formatDate = (value) => parseStamp(value)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—';
const formatDateTime = (value) => parseStamp(value)?.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '—';
const dayOnly = (value) => (value ? value.slice(0, 10) : '—');

function extBadge(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? esc(name.slice(dot + 1, dot + 5).toUpperCase()) : 'FILE';
}

// Initials for the collapsed sidebar: "Sagar Lamani" -> SL, one name -> S, more than three words -> first and last.
function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length > 3 ? [words[0], words[words.length - 1]] : words;
  return letters.map((w) => w[0]).join('').toUpperCase();
}

const endpoint = (kind) => (kind === 'folder' ? 'folders' : 'files');
const can = (permission) => Boolean(state.user?.permissions?.includes(permission));
const isAdmin = () => can('persons:manage');
const canWrite = () => state.level === 'edit';
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
const hasType = (e, type) => [...(e.dataTransfer?.types ?? [])].includes(type);
const itemKey = (kind, id) => `${kind}:${id}`;

function applyPrefs(prefs) {
  const root = document.documentElement;
  root.dataset.theme = THEMES.some((t) => t.id === prefs.theme) ? prefs.theme : 'day';
  root.dataset.text = prefs.text_size ?? 'normal';
  root.dataset.contrast = prefs.contrast ?? 'normal';
  root.dataset.density = prefs.density ?? 'comfortable';
  applyAccent(prefs);
  setLanguage(prefs.language ?? 'en');
  applyTranslations();
}

// Custom accent colours override the theme. Empty values fall back to the theme.
function applyAccent(prefs) {
  const style = document.documentElement.style;
  const primary = prefs.accent_primary;
  const secondary = prefs.accent_secondary;
  if (primary) {
    style.setProperty('--accent', primary);
    style.setProperty('--focus', primary);
    style.setProperty('--accent-text', contrastText(primary));
  } else {
    style.removeProperty('--accent');
    style.removeProperty('--focus');
    style.removeProperty('--accent-text');
  }
  if (secondary) style.setProperty('--accent-hover', secondary);
  else style.removeProperty('--accent-hover');
}

function contrastText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  return luminance > 0.6 ? '#111827' : '#ffffff';
}

// ---- Routing ------------------------------------------------------------------------

const VIEWS = ['home', 'shared', 'starred', 'trash'];
const ADMIN_VIEWS = ['trash'];

function parseRoute() {
  const hash = location.hash;
  const named = hash.match(/^#\/(\w+)$/);
  if (named && VIEWS.includes(named[1])) return { view: named[1] };
  let match = hash.match(/^#\/p\/(\d+)(?:\/f\/(\d+))?$/);
  if (match) return { view: 'files', personId: Number(match[1]), folderId: match[2] ? Number(match[2]) : null };
  match = hash.match(/^#\/fo\/(\d+)$/);
  if (match) return { view: 'files', personId: null, folderId: Number(match[1]) };
  return { view: 'home' };
}

const hashFor = () => {
  if (state.view !== 'files') return `#/${state.view}`;
  if (state.folderId) return `#/fo/${state.folderId}`;
  if (state.personId) return `#/p/${state.personId}`;
  return '#/home';
};

// Navigation lives in the URL hash, so reload and the back button both work.
function navigate(hash) {
  closeDrawer();
  state.page = 1;
  state.query = '';
  $('#search').value = '';
  if (location.hash === hash) return render();
  location.hash = hash; // the hashchange listener renders
}

const go = (personId, folderId = null) => {
  if (folderId) return navigate(`#/fo/${folderId}`);
  return navigate(personId ? `#/p/${personId}` : '#/home');
};

// ---- Overlays ---------------------------------------------------------------------

const overlayStack = [];

function openOverlay(html, setup) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'overlay-layer';
    layer.innerHTML = `<div class="backdrop">${html}</div>`;
    $('#modal-root').appendChild(layer);
    const isTop = () => overlayStack[overlayStack.length - 1] === close;
    const close = (value = null) => {
      const index = overlayStack.indexOf(close);
      if (index >= 0) overlayStack.splice(index, 1);
      document.removeEventListener('keydown', onKey);
      layer.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && isTop()) close();
    };
    overlayStack.push(close);
    layer.querySelector('.backdrop').addEventListener('click', (e) => {
      if (e.target === e.currentTarget && isTop()) close();
    });
    layer.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
    document.addEventListener('keydown', onKey);
    setup?.(layer, close);
  });
}

// Fields: { name, label, type, value, options, optional, placeholder }.
// Types: text, email, password, color, select, checkboxes, textarea, icons.
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
    if (f.type === 'textarea') {
      return `<label class="field"><span>${esc(f.label)}</span><textarea class="textarea" name="${f.name}" maxlength="2000"${f.optional ? '' : ' required'}>${esc(f.value ?? '')}</textarea></label>`;
    }
    if (f.type === 'icons') {
      const options = Object.keys(ICON_PATHS).map((id) => `
        <label class="icon-option${id === f.value ? ' selected' : ''}" title="${esc(id)}">
          <input type="radio" name="${f.name}" value="${id}"${id === f.value ? ' checked' : ''} hidden>${iconSvg(id)}
        </label>`).join('');
      return `<div class="field"><span>${esc(f.label)}</span><div class="icon-picker">${options}</div></div>`;
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
    form.querySelectorAll('.icon-option input').forEach((input) => input.addEventListener('change', () => {
      form.querySelectorAll('.icon-option').forEach((l) => l.classList.toggle('selected', l.querySelector('input').checked));
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const result = Object.fromEntries(new FormData(form));
      for (const f of fields.filter((x) => x.type === 'checkboxes')) {
        result[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value);
      }
      close(result);
    });
    form.querySelector('input:not([type="checkbox"]):not([type="radio"]), select, textarea')?.focus();
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

  const where = file.path.length ? file.path.join(' / ') : 'Person root';
  const details = `
    <h3>Details</h3>
    ${file.description ? `<p class="description">${esc(file.description)}</p>` : '<p class="muted small">No description</p>'}
    <dl>
      <dt>Name</dt><dd>${esc(file.name)}</dd>
      <dt>Type</dt><dd>${esc(file.mime_type)}</dd>
      <dt>Size</dt><dd>${esc(formatSize(file.size))}</dd>
      <dt>Uploaded by</dt><dd>${esc(file.uploaded_by_email || 'Deleted account')}</dd>
      <dt>Uploaded</dt><dd>${esc(formatDateTime(file.created_at))}</dd>
      <dt>File created</dt><dd>${esc(file.doc_created_at ? formatDateTime(file.doc_created_at) : '—')}</dd>
      <dt>Expires</dt><dd>${esc(dayOnly(file.expires_on))}</dd>
      <dt>Person</dt><dd>${esc(file.person_name)}</dd>
      <dt>Location</dt><dd>${esc(where)}</dd>
      <dt>Checksum</dt><dd title="${esc(file.sha256)}"><code>${esc(file.sha256.slice(0, 16))}…</code></dd>
    </dl>
    <h3>Tags</h3>
    <div class="tags">${file.tags.length ? file.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('') : '<span class="muted small">No tags</span>'}</div>
    <div class="settings-row">
      ${file.can_write ? '<button class="btn small" type="button" data-edit-details>Edit details</button><button class="btn small" type="button" data-edit-tags>Edit tags</button>' : ''}
      <button class="btn small" type="button" data-share-file>Share…</button>
    </div>`;

  await openOverlay(`
    <div class="preview" role="dialog" aria-modal="true" aria-label="${esc(file.name)}">
      <header>
        <strong class="ellipsis">${esc(file.name)}</strong>
        <span class="muted small">${esc(formatSize(file.size))}</span>
        <span class="grow"></span>
        <button class="btn ghost details-toggle" type="button" data-details>Details</button>
        <button class="btn" type="button" data-native-share>Share</button>
        <a class="btn" href="${src}?download=1">Download</a>
        <button class="btn" type="button" data-close>Close</button>
      </header>
      <div class="preview-layout">
        <div class="preview-body">${body}</div>
        <aside class="details" id="details">${details}</aside>
      </div>
    </div>`, (root, close) => {
    root.querySelector('[data-details]')?.addEventListener('click', () => root.querySelector('#details').classList.toggle('open'));
    root.querySelector('[data-native-share]')?.addEventListener('click', () => shareToApps(file));
    root.querySelector('[data-edit-tags]')?.addEventListener('click', async () => {
      close();
      await editTags(file.id, file.tags);
    });
    root.querySelector('[data-edit-details]')?.addEventListener('click', async () => {
      close();
      await editFileDetails(file);
    });
    root.querySelector('[data-share-file]')?.addEventListener('click', () => {
      close();
      openShareDialog('file', file.id, file.name);
    });
  });
}

// Hands the file to the operating system's share sheet (WhatsApp, email and so on) where the
// browser can share files. Otherwise it downloads the file so it can be attached by hand.
async function shareToApps(file) {
  const res = await fetch(`/api/files/${file.id}/content?download=1`, { credentials: 'same-origin' });
  if (!res.ok) return toast('Could not prepare the file for sharing', true);
  const blob = await res.blob();
  const shareFile = new File([blob], file.name, { type: file.mime_type });
  if (navigator.canShare?.({ files: [shareFile] })) {
    try {
      await navigator.share({ files: [shareFile], title: file.name });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Sharing was not completed', true);
    }
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('This browser cannot share files directly. The file was downloaded so you can attach it.');
}

// ---- Settings -------------------------------------------------------------------------------

const ACCENT_PRESETS = [
  ['#4f46e5', '#818cf8'], ['#0d9488', '#5eead4'], ['#dc2626', '#fb7185'], ['#d97706', '#fbbf24'],
  ['#16a34a', '#86efac'], ['#2563eb', '#7dd3fc'], ['#9333ea', '#c084fc'], ['#db2777', '#f9a8d4'],
];
const ADMIN_TABS = [['users', 'Users'], ['recovery', 'Recovery requests'], ['audit', 'Audit log'], ['system', 'System'], ['backups', 'Backups']];
const ACCENT_FALLBACK = '#4f46e5';

let settingsCtx = null; // { section, sub, root, close } while the Settings window is open
let adminToken = 0;

function settingsSections() {
  const sections = [
    ['appearance', t('appearance')],
    ['accessibility', t('accessibility')],
    ['account', t('account')],
  ];
  if (isAdmin()) sections.push(['admin', t('administration')]);
  sections.push(['about', t('about')]);
  return sections;
}

function openSettings(section = 'appearance') {
  return openOverlay(`
    <div class="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <header class="settings-top">
        <h2>Settings</h2>
        <button class="btn" type="button" data-close>Close</button>
      </header>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections"></nav>
        <div class="settings-body" id="settings-body"></div>
      </div>
    </div>`, (root, close) => {
    settingsCtx = { section, sub: 'users', root, close };
    root.querySelector('.settings-nav').addEventListener('click', (e) => {
      const button = e.target.closest('[data-section]');
      if (button) showSettingsSection(button.dataset.section);
    });
    const body = root.querySelector('#settings-body');
    body.addEventListener('click', onSettingsBodyClick);
    body.addEventListener('change', onSettingsBodyChange);
    showSettingsSection(section);
  }).finally(() => { settingsCtx = null; });
}

function showSettingsSection(id) {
  if (!settingsCtx) return;
  settingsCtx.section = id;
  settingsCtx.root.querySelector('.settings-nav').innerHTML = settingsSections().map(([key, label]) =>
    `<button type="button" data-section="${key}" class="${key === id ? 'active' : ''}" aria-current="${key === id}">${label}</button>`).join('');
  renderSettingsBody();
}

function renderSettingsBody() {
  if (!settingsCtx) return;
  const body = settingsCtx.root.querySelector('#settings-body');
  const scroll = body.scrollTop;
  body.innerHTML = settingsSectionHtml(settingsCtx.section);
  body.querySelectorAll('[data-bg]').forEach((el) => { el.style.background = el.dataset.bg; });
  body.querySelectorAll('[data-color]').forEach((el) => { el.style.background = el.dataset.color; });
  body.scrollTop = scroll;
  if (settingsCtx.section === 'admin') renderAdminPanel();
}

const choiceButtons = (name, options, current) => options.map((o) =>
  `<button class="btn" type="button" data-pref="${name}" data-value="${o.id}" aria-pressed="${o.id === current}">${esc(o.label)}</button>`).join('');

function settingsSectionHtml(id) {
  const user = state.user;
  if (id === 'appearance') {
    const primary = user.accent_primary || currentAccent();
    const secondary = user.accent_secondary || primary;
    return `
      <h2>${t('appearance')}</h2>
      <h3>${t('theme')}</h3>
      <div class="theme-grid" role="group" aria-label="${t('theme')}">
        ${THEMES.map((th) => `
          <button class="theme-option${th.id === user.theme ? ' selected' : ''}" type="button" data-pref="theme" data-value="${th.id}" aria-pressed="${th.id === user.theme}">
            <span class="swatch" data-t="${th.id}"></span>${esc(th.label)}
          </button>`).join('')}
      </div>
      <h3>Accent colours</h3>
      <p class="muted small">Primary colours buttons and highlights. Secondary colours hover and secondary highlights.</p>
      <div class="accent-row">
        <label class="accent-field"><span>Primary</span><input type="color" value="${esc(primary)}" data-accent-input="primary" aria-label="Primary accent colour"></label>
        <label class="accent-field"><span>Secondary</span><input type="color" value="${esc(secondary)}" data-accent-input="secondary" aria-label="Secondary accent colour"></label>
        <button class="btn small" type="button" data-accent-reset>Use theme colours</button>
      </div>
      <div class="accent-presets" role="group" aria-label="Accent presets">
        ${ACCENT_PRESETS.map(([a, b]) => `<button class="accent-preset" type="button" data-accent-preset="${a},${b}" aria-label="Preset ${a} and ${b}"><span class="sw-p" data-bg="${a}"></span><span class="sw-s" data-bg="${b}"></span></button>`).join('')}
      </div>
      <h3>${t('density')}</h3>
      <div class="choice-row">${choiceButtons('density', [{ id: 'comfortable', label: t('comfortable') }, { id: 'compact', label: t('compact') }], user.density)}</div>
      <h3>${t('items_per_page')}</h3>
      <div class="choice-row">${choiceButtons('page_size', [10, 25, 50, 100, 200].map((n) => ({ id: n, label: String(n) })), user.page_size)}</div>
      <p class="muted small">Long folders are split into pages of this size.</p>`;
  }
  if (id === 'accessibility') {
    return `
      <h2>${t('accessibility')}</h2>
      <p class="muted small">Make text bigger, or improve contrast, across the whole app.</p>
      <h3>${t('text_size')}</h3>
      <div class="choice-row">${choiceButtons('text_size', [{ id: 'normal', label: t('normal') }, { id: 'large', label: t('large') }, { id: 'xlarge', label: t('extra_large') }], user.text_size)}</div>
      <h3>${t('contrast')}</h3>
      <div class="choice-row">${choiceButtons('contrast', [{ id: 'normal', label: t('normal') }, { id: 'high', label: t('high_contrast') }], user.contrast)}</div>`;
  }
  if (id === 'account') {
    return `
      <h2>${t('account')}</h2>
      <p class="muted small">${esc(user.email)} · ${esc(ROLE_LABELS[user.role] ?? user.role)}</p>

      <h3>${t('profile')}</h3>
      <form class="profile-form" data-profile-form>
        <label class="field"><span>${t('first_name')}</span><input name="first_name" maxlength="100" value="${esc(user.first_name ?? '')}"></label>
        <label class="field"><span>${t('last_name')}</span><input name="last_name" maxlength="100" value="${esc(user.last_name ?? '')}"></label>
        <label class="field"><span>${t('phone')}</span><input name="phone" maxlength="100" type="tel" value="${esc(user.phone ?? '')}"></label>
        <label class="field"><span>${t('organisation')}</span><input name="organisation" maxlength="100" value="${esc(user.organisation ?? '')}"></label>
        <div class="settings-row"><button class="btn primary" type="submit">${t('save_profile')}</button></div>
      </form>

      <h3>${t('language')}</h3>
      <label class="field"><span>${t('language')}</span>
        <select data-language>
          ${LANGUAGES.map((l) => `<option value="${l.code}"${l.code === (user.language ?? 'en') ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </label>

      <h3>${t('two_factor')}</h3>
      <p class="muted small">${user.twoFactor ? t('two_factor_on') : t('two_factor_off')}</p>
      <div class="settings-row">
        ${user.twoFactor
          ? '<button class="btn danger" type="button" data-2fa="off">' + t('turn_off') + '</button>'
          : '<button class="btn primary" type="button" data-2fa="on">' + t('turn_on') + '</button>'}
      </div>

      <h3>${t('change_password')}</h3>
      <div class="settings-row">
        <button class="btn" type="button" data-change-password>${t('change_password')}</button>
        <button class="btn danger" type="button" data-logout>${t('sign_out')}</button>
      </div>`;
  }
  if (id === 'admin') {
    return `
      <h2>${t('administration')}</h2>
      <p class="muted small">Tools for the super admin. The recycle bin is in the sidebar.</p>
      <div class="admin-tabs" role="tablist" aria-label="${t('administration')}">
        ${ADMIN_TABS.map(([key, label]) => `<button type="button" role="tab" data-sub="${key}" aria-selected="${settingsCtx.sub === key}" class="${settingsCtx.sub === key ? 'active' : ''}">${esc(label)}${key === 'recovery' && state.pending ? ` <span class="count">${state.pending}</span>` : ''}</button>`).join('')}
      </div>
      <div id="admin-panel" class="admin-panel"><p class="muted">Loading…</p></div>`;
  }
  return `
    <div class="about">
      <h2>${t('about')} DocuKaksh</h2>
      <p class="muted small">A self-hosted place for family and office documents.</p>
      <dl>
        <dt>Version</dt><dd>${esc(state.version || '—')}</dd>
        <dt>Encryption</dt><dd>Every uploaded file is encrypted with AES-256-GCM before it is stored.</dd>
        <dt>Keys</dt><dd>The encryption key and all settings are read from the .env file on the server.</dd>
        <dt>Data</dt><dd>Stored in the data folder set by DATA_HOST_DIR (database, encrypted files, previews, backups).</dd>
      </dl>
    </div>`;
}

function currentAccent() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : ACCENT_FALLBACK;
}

async function savePreference(body) {
  const scrollBody = settingsCtx?.root.querySelector('#settings-body');
  try {
    const prefs = await api('/auth/me', { method: 'PATCH', body });
    Object.assign(state.user, prefs);
    applyPrefs(state.user);
    renderSettingsBody();
  } catch (err) {
    toast(err.message, true);
  }
  void scrollBody;
}

function onSettingsBodyClick(e) {
  const tab = e.target.closest('[data-sub]');
  if (tab) {
    settingsCtx.sub = tab.dataset.sub;
    return renderSettingsBody();
  }
  const pref = e.target.closest('[data-pref]');
  if (pref) {
    const value = pref.dataset.pref === 'page_size' ? Number(pref.dataset.value) : pref.dataset.value;
    return savePreference({ [pref.dataset.pref]: value });
  }
  const preset = e.target.closest('[data-accent-preset]');
  if (preset) {
    const [primary, secondary] = preset.dataset.accentPreset.split(',');
    return savePreference({ accent_primary: primary, accent_secondary: secondary });
  }
  if (e.target.closest('[data-accent-reset]')) return savePreference({ accent_primary: '', accent_secondary: '' });
  if (e.target.closest('[data-admin-action="new-user"]')) return newUser();
  const twoFactor = e.target.closest('[data-2fa]');
  if (twoFactor) return twoFactor.dataset['2fa'] === 'on' ? startTwoFactorSetup() : disableTwoFactor();
  if (e.target.closest('[data-change-password]')) {
    settingsCtx.close();
    return changePassword();
  }
  if (e.target.closest('[data-logout]')) {
    settingsCtx.close();
    return logout();
  }
  const kebab = e.target.closest('[data-kebab]');
  if (kebab) return openRowMenu(kebab.closest('.row[data-kind]'));
  const backupButton = e.target.closest('[data-backup]');
  if (backupButton) return backupAction(backupButton.dataset.backup, backupButton.dataset.id);
}

function onSettingsBodyChange(e) {
  if (e.target.matches('[data-language]')) return savePreference({ language: e.target.value });
  if (!e.target.matches('[data-accent-input]')) return;
  const body = settingsCtx.root.querySelector('#settings-body');
  savePreference({
    accent_primary: body.querySelector('[data-accent-input="primary"]').value,
    accent_secondary: body.querySelector('[data-accent-input="secondary"]').value,
  });
}

// Profile form (submitted by the form, not by a click).
document.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-profile-form]')) return;
  e.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(e.target));
    const saved = await api('/auth/profile', { method: 'PATCH', body });
    Object.assign(state.user, saved);
    $('#account-email').textContent = state.user.email;
    toast('Profile saved');
    renderSettingsBody();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---- Administration panels (shown inside Settings) --------------------------------------

async function renderAdminPanel() {
  if (!settingsCtx || settingsCtx.section !== 'admin') return;
  const panel = settingsCtx.root.querySelector('#admin-panel');
  if (!panel) return;
  const token = ++adminToken;
  const builders = { users: adminUsersHtml, recovery: adminRecoveryHtml, audit: adminAuditHtml, system: adminSystemHtml, backups: adminBackupsHtml };
  try {
    const html = await builders[settingsCtx.sub]();
    if (token !== adminToken || !settingsCtx) return;
    panel.innerHTML = html;
    panel.querySelectorAll('[data-color]').forEach((el) => { el.style.background = el.dataset.color; });
    wireAdminPanel(panel);
  } catch (err) {
    if (token === adminToken) panel.innerHTML = `<p class="error" role="alert">${esc(err.message)}</p>`;
  }
}

function wireAdminPanel(panel) {
  if (settingsCtx.sub !== 'audit') return;
  const update = () => {
    state.auditFilters = {
      user_id: panel.querySelector('#audit-user').value,
      action: panel.querySelector('#audit-action').value,
      q: panel.querySelector('#audit-q').value.trim(),
    };
    renderAdminPanel();
  };
  panel.querySelector('#audit-user').addEventListener('change', update);
  panel.querySelector('#audit-action').addEventListener('change', update);
  let timer;
  panel.querySelector('#audit-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 350);
  });
}

async function adminUsersHtml() {
  const users = await api('/users');
  const rows = users.map((u) => {
    const self = u.id === state.user.id;
    const roleLabel = ROLE_LABELS[u.role] ?? u.role;
    const status = u.active ? 'Active' : 'Disabled';
    const counts = `${u.person_count} person${u.person_count === 1 ? '' : 's'} · ${u.file_count} file${u.file_count === 1 ? '' : 's'}`;
    const flags = u.must_change_password ? ' · Must change password' : '';
    return rowHtml({
      kind: 'user',
      id: u.id,
      icon: esc(initials(u.email)),
      iconClass: 'user',
      label: self ? `${u.email} (you)` : u.email,
      meta: `${esc(roleLabel)} · ${status} · ${counts}${flags}`,
      col1: `<span class="badge${u.role === 'super_admin' ? ' admin' : ''}">${esc(roleLabel)}</span>`,
      col2: u.active ? `<span class="muted">${status}</span>` : '<span class="badge off">Disabled</span>',
      attrs: `data-email="${esc(u.email)}" data-role="${u.role}" data-active="${u.active ? 1 : 0}" data-self="${self ? 1 : 0}" data-person-ids="${esc(u.person_ids ?? '')}"`,
    });
  }).join('');
  return `
    <div class="admin-head">
      <span class="muted small">${users.length} account${users.length === 1 ? '' : 's'} on this install</span>
      <span class="grow"></span>
      <button class="btn primary small" type="button" data-admin-action="new-user">New user</button>
    </div>
    ${rows ? `<div class="list">${rows}</div>` : '<div class="empty"><h2>No accounts</h2></div>'}`;
}

async function adminRecoveryHtml() {
  const requests = await api('/recovery');
  const pending = requests.filter((r) => r.status === 'pending').length;
  updateRecoveryCount(pending);
  if (!requests.length) {
    return '<div class="empty"><h2>No requests</h2><p class="muted">When someone forgets their password and asks for help, the request appears here.</p></div>';
  }
  const rows = requests.map((r) => {
    const badge = r.status === 'pending' ? '<span class="badge admin">Pending</span>'
      : r.status === 'approved' ? '<span class="badge">Approved</span>' : '<span class="badge off">Rejected</span>';
    return rowHtml({
      kind: 'recovery',
      id: r.id,
      icon: esc(initials(r.email)),
      iconClass: 'user',
      label: r.email,
      meta: `${r.note ? `“${esc(r.note)}” · ` : ''}${esc(formatDateTime(r.created_at))}`,
      col1: badge,
      col2: esc(formatDate(r.created_at)),
      attrs: `data-status="${r.status}" data-email="${esc(r.email)}"`,
    });
  }).join('');
  return `<p class="muted small">${pending} pending. Use ⋯ on a request to approve or reject it.</p><div class="list">${rows}</div>`;
}

async function adminAuditHtml() {
  const users = await api('/users');
  const filters = state.auditFilters;
  const qs = new URLSearchParams();
  if (filters.user_id) qs.set('user_id', filters.user_id);
  if (filters.action) qs.set('action', filters.action);
  if (filters.q) qs.set('q', filters.q);
  const entries = await api(`/admin/audit?${qs}`);
  const actions = Object.keys(ACTION_TEXT).sort();
  return `
    <div class="audit-filters">
      <select id="audit-user" aria-label="User"><option value="">All users</option>${users.map((u) => `<option value="${u.id}"${String(filters.user_id) === String(u.id) ? ' selected' : ''}>${esc(u.email)}</option>`).join('')}</select>
      <select id="audit-action" aria-label="Action"><option value="">All actions</option>${actions.map((a) => `<option value="${a}"${filters.action === a ? ' selected' : ''}>${esc(ACTION_TEXT[a])}</option>`).join('')}</select>
      <input id="audit-q" type="search" placeholder="Name contains…" value="${esc(filters.q ?? '')}" aria-label="Name contains">
    </div>
    <p class="muted small">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th></tr></thead>
      <tbody>${entries.map((e) => `<tr>
        <td>${esc(formatDateTime(e.created_at))}</td>
        <td>${esc(e.user_email || 'System')}</td>
        <td>${esc(ACTION_TEXT[e.action] ?? e.action)}</td>
        <td>${esc(e.target_name || '—')}${e.detail ? `<div class="muted small">${esc(e.detail)}</div>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing matches these filters.</td></tr>'}</tbody>
    </table></div>`;
}

async function adminSystemHtml() {
  const h = await api('/admin/health');
  state.retention = h.bin_retention_days;
  const usedPct = h.disk.total_bytes ? Math.round(((h.disk.total_bytes - h.disk.free_bytes) / h.disk.total_bytes) * 100) : 0;
  const card = (big, label) => `<div class="card"><div class="big">${big}</div><div class="label-small">${label}</div></div>`;
  return `
    <div class="health-grid">
      ${card(esc(formatSize(h.disk.free_bytes)), `Free disk space (${usedPct}% used)`)}
      ${card(esc(formatSize(h.storage.files_bytes)), 'Encrypted files')}
      ${card(esc(formatSize(h.storage.previews_bytes)), 'Preview cache')}
      ${card(esc(formatSize(h.storage.database_bytes)), 'Database')}
      ${card(h.counts.files, 'Files in use')}
      ${card(h.counts.files_in_bin, 'Files in the bin')}
      ${card(h.last_24_hours.uploads, 'Uploads, 24 h')}
      ${card(h.last_24_hours.downloads, 'Downloads, 24 h')}
      ${card(h.last_24_hours.sign_in_failures, 'Failed sign-ins, 24 h')}
      ${card(h.last_24_hours.errors, 'Server errors, 24 h')}
      ${card(h.accounts_locked_now, 'Accounts locked now')}
      ${card(`${h.memory_mb} MB`, 'Memory in use')}
    </div>
    <dl class="kv">
      <dt>App version</dt><dd>${esc(h.version)}</dd>
      <dt>Node.js</dt><dd>${esc(h.node)}</dd>
      <dt>Uptime</dt><dd>${esc(Math.round(h.uptime_seconds / 60))} min</dd>
      <dt>Accounts · persons · folders · shares</dt><dd>${h.counts.users} · ${h.counts.persons} · ${h.counts.folders} · ${h.counts.shares}</dd>
      <dt>Recycle bin retention</dt><dd>${h.bin_retention_days ? `${h.bin_retention_days} days` : 'kept forever'}</dd>
    </dl>`;
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

// ---- Drawer and sidebar -------------------------------------------------------------

function openDrawer() {
  $('#app').classList.add('drawer-open');
}

function closeDrawer() {
  $('#app').classList.remove('drawer-open');
}

function applySidebarState(collapsed) {
  $('#app').classList.toggle('sidebar-collapsed', collapsed);
  const btn = $('#collapse-btn');
  btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

// ---- Auth screens ----------------------------------------------------------------------

function showAuthCard(html) {
  $('#app').classList.add('hidden');
  const el = $('#auth');
  el.classList.remove('hidden');
  el.innerHTML = html;
  return el;
}

const brandHtml = () => '<div class="brand big"><span class="logo"><img src="/logo.svg" alt=""></span>DocuKaksh</div>';

async function boot() {
  const status = await api('/auth/status');
  state.version = status.version ?? '';
  if (!status.user) return status.setupRequired ? showSetup() : showLogin();
  state.user = status.user;
  state.pageSize = status.user.page_size || 50;
  applyPrefs(status.user);
  if (status.user.mustChangePassword) return showForcedChange();

  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#nav-trash').classList.toggle('hidden', !isAdmin());
  $('#new-person').classList.toggle('hidden', !isAdmin());
  $('#account-email').textContent = status.user.email;
  $('#avatar').textContent = initials(status.user.email);
  applySidebarState(readStore('dk-sidebar', false) && window.innerWidth > 900);
  applySidebarWidth();
  updateRecoveryCount(status.user.pendingRequests);

  const route = parseRoute();
  state.view = route.view;
  state.personId = route.personId ?? null;
  state.folderId = route.folderId ?? null;
  if (ADMIN_VIEWS.includes(state.view) && !isAdmin()) state.view = 'home';
  await refreshPersons();
  history.replaceState(null, '', hashFor());
  await render();
}

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
  wireLogin(el.querySelector('form'));
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

// ---- Persons ----------------------------------------------------------------------------------

async function refreshPersons() {
  state.persons = await api('/persons');
}

const currentPerson = () => state.persons.find((p) => p.id === state.personId);

function renderPersons() {
  const nav = $('#person-list');
  if (!state.persons.length) {
    nav.innerHTML = `<p class="muted small pad">${isAdmin() ? 'No persons yet' : 'No persons assigned to you yet'}</p>`;
  } else {
    nav.innerHTML = state.persons.map((p) => `
      <button class="person${state.view === 'files' && p.id === state.personId ? ' active' : ''}" type="button"
        data-person="${p.id}" title="${esc(p.name)}" ${isAdmin() ? 'draggable="true"' : ''}>
        <span class="dot" data-color="${esc(p.color)}"></span>
        <span class="initials" data-color="${esc(p.color)}">${esc(initials(p.name))}</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="count">${p.file_count}</span>
      </button>`).join('');
    nav.querySelectorAll('.dot, .initials').forEach((el) => { el.style.background = el.dataset.color; });
  }
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.classList.toggle('active', state.view === b.dataset.nav);
  });
}

function updateRecoveryCount(count) {
  state.pending = count || 0;
  $('#account-btn').classList.toggle('has-alert', state.pending > 0);
}

async function newPerson() {
  const result = await formModal({
    title: 'New person',
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'color', label: 'Colour', type: 'color', value: '#4f46e5' },
      { name: 'description', label: 'Description (optional)', type: 'textarea', optional: true },
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
      { name: 'description', label: 'Description', type: 'textarea', optional: true, value: person.description },
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
        ${person.description ? `<p class="description">${esc(person.description)}</p>` : ''}
        <p class="muted">${person.file_count} document${person.file_count === 1 ? '' : 's'} in this person.</p>
        <p class="muted small">Only the super admin can rename, recolour, or remove a person.</p>
        <div class="modal-actions"><button class="btn primary" type="button" data-close>Close</button></div>
      </div>`);
  }
  const choice = await openSheet(person.name, [
    { value: 'edit', label: 'Edit name, colour and description' },
    { value: 'delete', label: 'Move to recycle bin', danger: true },
  ]);
  if (choice === 'edit') return editPerson();
  if (choice === 'delete') return deletePerson();
}

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

// ---- Rendering ---------------------------------------------------------------------------------

async function render() {
  const token = ++renderToken;
  await refreshPersons().catch(() => {});
  renderPersons();
  $('#trash-toolbar').classList.toggle('hidden', state.view !== 'trash');
  $('#trash-select-btn').textContent = state.selecting ? 'Done' : 'Select';
  if (settingsCtx?.section === 'admin') renderAdminPanel();
  const isFiles = state.view === 'files';
  const inPerson = isFiles && (state.personId || state.folderId);
  $('#toolbar').classList.toggle('hidden', !inPerson);
  $('#search').closest('.search-box').classList.toggle('hidden', ['users', 'system', 'audit'].includes(state.view));
  $('#person-settings').classList.toggle('hidden', !isFiles || !state.personId);
  $('#crumbs').innerHTML = '';
  $('#item-count').textContent = '';
  $('#content').classList.remove('select-mode');
  $('#select-btn').classList.toggle('hidden', !isFiles || !!state.query);
  $('#select-btn').setAttribute('aria-pressed', String(state.selecting));
  $('#select-btn').textContent = state.selecting ? 'Done' : 'Select';
  $('#import-btn').classList.toggle('hidden', !isFiles || !canWrite());
  $('#new-folder').classList.toggle('hidden', !isFiles || !canWrite());
  renderBulkBar();

  if (state.view === 'home') return renderHome(token);
  if (state.view === 'shared') return renderShared(token);
  if (state.view === 'starred') return renderStarred(token);
  if (state.view === 'trash') return renderTrash(token);
  if (state.query) return renderSearch(token);
  if (!state.personId && !state.folderId) {
    $('#content').innerHTML = '<div class="empty"><h2>Choose a person</h2><p class="muted">Pick a person in the sidebar, or see what is shared with you.</p></div>';
    return;
  }
  return renderFiles(token);
}

async function renderFiles(token) {
  try {
    const data = state.folderId
      ? await api(`/folders/${state.folderId}/browse`)
      : await api(`/persons/${state.personId}/browse`);
    if (token !== renderToken) return;
    state.folder = data.folder;
    state.level = data.level ?? 'edit';
    state.personId = data.person?.id ?? state.personId;
    renderCrumbs(data);
    $('#new-folder').classList.toggle('hidden', !canWrite());
    $('#import-btn').classList.toggle('hidden', !canWrite());
    renderBulkBar();
    renderBrowse(data);
  } catch (err) {
    if (token !== renderToken) return;
    if (err.status === 401) return showLogin();
    if (err.status === 403 && err.code === 'DROPBOX') return renderDropbox(token);
    if (err.status === 404 && state.folderId) return navigate(state.personId ? `#/p/${state.personId}` : '#/home');
    if (err.status === 404) {
      await refreshPersons();
      return go(state.persons[0]?.id ?? null, null);
    }
    toast(err.message, true);
  }
}

function renderDropbox(token) {
  if (token !== renderToken) return;
  state.level = 'dropbox';
  $('#crumbs').innerHTML = '<span class="crumb-static">Upload folder</span>';
  $('#new-folder').classList.add('hidden');
  $('#import-btn').classList.add('hidden');
  $('#content').innerHTML = `
    <div class="empty">
      <h2>Upload only</h2>
      <p class="muted">This folder accepts files from you, but you cannot see what is inside it.</p>
      <button class="btn primary" type="button" data-action="upload-here">Upload files here</button>
    </div>`;
}

function renderCrumbs({ person, breadcrumb }) {
  const parts = [];
  if (person) parts.push(`<button class="crumb" type="button" data-crumb="" data-person="${person.id}">${esc(person.name)}</button>`);
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
function rowHtml({ kind, id, icon, iconClass = '', label, meta, col1 = '', col2 = '', tags = [], attrs = '', draggable = false, title = '' }) {
  const selected = state.selected.has(itemKey(kind, id));
  return `
    <div class="row${selected ? ' selected' : ''}" data-kind="${kind}" data-id="${id}" tabindex="0" ${draggable ? 'draggable="true"' : ''} ${attrs} title="${esc(title)}">
      <input class="pick" type="checkbox" aria-label="Select ${esc(label)}" ${selected ? 'checked' : ''} data-pick>
      <span class="name">
        <span class="icon ${iconClass || (kind === 'file' ? extClass(label) : '')}">${icon}</span>
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
  return `<div class="row head"><span class="pick-head"></span>${cells}<span class="kebab-spacer"></span></div>`;
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

// ---- Home (dashboard) -------------------------------------------------------------------------

async function renderHome(token) {
  staticCrumb('Home');
  const data = await api('/dashboard');
  if (token !== renderToken) return;
  const max = Math.max(1, ...data.persons.map((p) => p.file_count));
  const today = new Date().toISOString().slice(0, 10);
  const personRows = data.persons.length
    ? data.persons.map((p) => `
        <button type="button" data-open-person="${p.id}">
          <span class="dash-name"><span class="dot dot-inline" data-color="${esc(p.color)}"></span>${esc(p.name)}</span>
          <span class="muted small">${p.file_count} files · ${p.folder_count} folders · ${esc(formatSize(p.bytes))}</span>
        </button>
        <div class="bar-track bar-wrap"><div class="bar-fill" data-width="${Math.round((p.file_count / max) * 100)}"></div></div>`).join('')
    : '<p class="muted small">No persons yet.</p>';
  const expiring = data.expiring.length
    ? data.expiring.map((f) => `
        <button type="button" data-preview="${f.id}">
          <span class="dash-name">${esc(f.name)} <span class="muted small">· ${esc(f.person_name)}</span></span>
          <span class="${f.expires_on < today ? 'badge off' : 'badge'}">${esc(dayOnly(f.expires_on))}</span>
        </button>`).join('')
    : '<p class="muted small">Nothing expires in the next 30 days.</p>';
  const activity = data.activity.length
    ? data.activity.map((a) => `
        <div class="activity-row">
          <span class="when">${esc(formatDateTime(a.created_at))}</span>
          <span class="what">${esc(a.user_email || 'System')} · ${esc(describeAction(a))}</span>
        </div>`).join('')
    : '<p class="muted small">No activity yet.</p>';

  $('#content').innerHTML = `
    <div class="dash">
      <div class="dash-cards">
        <div class="card"><div class="big">${esc(formatSize(data.storage_bytes))}</div><div class="label-small">Storage used by your documents</div></div>
        <div class="card"><div class="big">${data.persons.length}</div><div class="label-small">Persons you can see</div></div>
        <div class="card"><div class="big">${data.starred}</div><div class="label-small">Starred items</div></div>
        <div class="card"><button class="link-btn big" type="button" data-duplicates>${data.duplicate_groups}</button><div class="label-small">Duplicate groups</div></div>
      </div>
      <div class="dash-grid">
        <section class="dash-section"><h2>Persons</h2><div class="dash-list">${personRows}</div></section>
        <section class="dash-section"><h2>Expiring in 30 days</h2><div class="dash-list">${expiring}</div></section>
      </div>
      <section class="dash-section"><h2>Recent activity</h2>${activity}</section>
    </div>`;
  $('#item-count').textContent = '';
  const content = $('#content');
  content.querySelectorAll('[data-open-person]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.openPerson))));
  content.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => openPreview(Number(b.dataset.preview))));
  content.querySelectorAll('[data-color]').forEach((el) => { el.style.background = el.dataset.color; });
  content.querySelectorAll('[data-width]').forEach((el) => { el.style.width = `${el.dataset.width}%`; });
  content.querySelector('[data-duplicates]')?.addEventListener('click', showDuplicates);
}

const ACTION_TEXT = {
  'file.upload': 'uploaded', 'file.download': 'downloaded', 'file.view': 'opened', 'file.update': 'changed',
  'file.delete': 'moved to the bin', 'file.tags': 'changed tags on', 'folder.create': 'created folder',
  'folder.update': 'changed folder', 'folder.delete': 'moved folder to the bin', 'person.create': 'created person',
  'person.update': 'changed person', 'person.delete': 'moved person to the bin', 'share.create': 'shared',
  'share.revoke': 'removed a share on', 'auth.setup': 'created the super admin account', 'auth.login': 'signed in',
  'auth.logout': 'signed out', 'auth.failed': 'failed sign-in', 'auth.locked': 'sign-in blocked',
  'auth.password': 'changed password', 'user.create': 'created account', 'user.delete': 'deleted login',
  'user.disable': 'disabled account', 'user.update': 'updated account', 'user.persons': 'changed person access',
  'user.password_reset': 'reset password', 'bin.restore': 'restored from the bin', 'bin.purge': 'deleted forever',
  'bin.auto_purge': 'emptied old bin items', 'recovery.request': 'asked for password help',
  'recovery.approve': 'approved password help', 'recovery.reject': 'rejected password help',
  'server.error': 'server error',
};
const describeAction = (a) => `${ACTION_TEXT[a.action] ?? a.action}${a.target_name ? ` “${a.target_name}”` : ''}${a.detail ? ` (${a.detail})` : ''}`;

async function showDuplicates() {
  const groups = await api('/duplicates');
  await openOverlay(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="Duplicates">
      <h2>Possible duplicates</h2>
      <p class="muted small">These files have identical content. Removing a copy is up to you.</p>
      ${groups.length ? groups.map((g) => `
        <div class="card card-gap">
          <strong>${g.copies} copies</strong>
          ${g.files.map((f) => `<div class="dash-row"><span class="dash-name">${esc(f.name)} <span class="muted small">· ${esc(f.person_name)}</span></span><button class="btn small" type="button" data-preview="${f.id}">Open</button></div>`).join('')}
        </div>`).join('') : '<p class="muted">No duplicates found.</p>'}
      <div class="modal-actions"><button class="btn primary" type="button" data-close>Close</button></div>
    </div>`, (root, close) => {
    root.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => {
      close();
      openPreview(Number(b.dataset.preview));
    }));
  });
}

// ---- Shared, starred --------------------------------------------------------------------------

async function renderShared(token) {
  staticCrumb('Shared with me');
  const items = await api('/shared');
  if (token !== renderToken) return;
  $('#item-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    $('#content').innerHTML = '<div class="empty"><h2>Nothing shared with you yet</h2><p class="muted">When someone shares a folder or file with you, it appears here.</p></div>';
    return;
  }
  const rows = items.map((s) => rowHtml({
    kind: s.kind,
    id: s.id,
    icon: s.kind === 'folder' ? iconSvg(s.icon) : extBadge(s.name),
    iconClass: s.kind === 'folder' ? 'folder' : '',
    label: s.name,
    meta: `${esc(s.person_name ?? '')} · shared by ${esc(s.shared_by_email ?? 'someone')} · ${esc(formatDate(s.created_at))}`,
    col1: `<span class="badge">${esc(s.permission)}</span>`,
    col2: esc(formatDate(s.created_at)),
    attrs: `data-shared="1"`,
  })).join('');
  $('#content').innerHTML = `<div class="list">${rows}</div>`;
}

async function renderStarred(token) {
  staticCrumb('Starred');
  const items = await api('/starred');
  if (token !== renderToken) return;
  $('#item-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    $('#content').innerHTML = '<div class="empty"><h2>No starred items</h2><p class="muted">Use the ⋯ menu on a file or folder to star it for quick access.</p></div>';
    return;
  }
  const rows = items.map((s) => rowHtml({
    kind: s.kind,
    id: s.id,
    icon: s.kind === 'folder' ? iconSvg('star') : extBadge(s.name),
    iconClass: s.kind === 'folder' ? 'folder' : '',
    label: s.name,
    meta: s.kind === 'folder' ? 'Folder' : esc(formatSize(s.size)),
    col1: s.kind === 'folder' ? 'Folder' : esc(formatSize(s.size)),
    col2: '',
    attrs: `data-starred="1" data-starred-now="1"`,
  })).join('');
  $('#content').innerHTML = `<div class="list">${rows}</div>`;
}

// ---- Admin pages ---------------------------------------------------------------------------------

async function renderTrash(token) {
  staticCrumb('Recycle bin');
  const items = await api('/trash');
  if (token !== renderToken) return;
  $('#trash-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'} in the bin`;
  $('#item-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    $('#content').innerHTML = `<div class="empty"><h2>The recycle bin is empty</h2><p class="muted">Deleted persons, folders and files appear here until you restore them or delete them for good. Items older than ${esc(state.retention)} days are removed automatically.</p></div>`;
    return;
  }
  const rows = items.map((item) => {
    const kindLabel = item.kind === 'person' ? 'Person' : item.kind === 'folder' ? 'Folder' : 'File';
    return rowHtml({
      kind: 'trash',
      id: item.id,
      icon: item.kind === 'folder' ? iconSvg('folder') : item.kind === 'person' ? esc(initials(item.name)) : extBadge(item.name),
      iconClass: item.kind === 'folder' ? 'folder' : item.kind === 'person' ? 'user' : '',
      label: item.name,
      meta: `${kindLabel} · ${esc(item.person_name)} · deleted ${esc(formatDateTime(item.deleted_at))}${item.deleted_by_email ? ` by ${esc(item.deleted_by_email)}` : ''}`,
      col1: item.kind === 'person' ? 'Whole person' : `${esc(kindLabel)} · ${esc(item.person_name)}`,
      col2: esc(formatDate(item.deleted_at)),
      attrs: `data-item="${item.kind}" data-name="${esc(item.name)}"`,
    });
  }).join('');
  const header = '<div class="row head"><span class="pick-head"></span><span class="name">Item</span><span class="col">Location</span><span class="col">Deleted</span><span class="kebab-spacer"></span></div>';
  $('#content').innerHTML = `<div class="list">${header}${rows}</div>`;
}

// ---- Item actions ----------------------------------------------------------------------------

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

async function editFolderDetails(id) {
  const data = await api(`/folders/${id}/browse`);
  const folder = data.folder;
  const result = await formModal({
    title: 'Folder details',
    fields: [
      { name: 'name', label: 'Name', value: folder.name },
      { name: 'icon', label: 'Icon', type: 'icons', value: folder.icon },
      { name: 'description', label: 'Description', type: 'textarea', optional: true, value: folder.description },
    ],
    submit: 'Save',
  });
  if (!result) return;
  await api(`/folders/${id}`, { method: 'PATCH', body: result });
  toast('Saved');
  render();
}

async function editFileDetails(file) {
  const result = await formModal({
    title: 'File details',
    fields: [
      { name: 'name', label: 'Name', value: file.name },
      { name: 'description', label: 'Description', type: 'textarea', optional: true, value: file.description },
      { name: 'expires_on', label: 'Expiry date (optional, YYYY-MM-DD)', optional: true, value: file.expires_on ?? '', placeholder: 'e.g. 2027-03-31' },
    ],
    submit: 'Save',
  });
  if (!result) return;
  try {
    await api(`/files/${file.id}`, {
      method: 'PATCH',
      body: { name: result.name, description: result.description, expires_on: result.expires_on || null },
    });
    toast('Saved');
    render();
  } catch (err) {
    toast(err.message, true);
  }
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

// Folders the user may move things into: the whole person for editors, or the shared subtree for
// people who were given a folder.
async function moveTargets(excludeId = null) {
  const tree = state.level === 'edit' && state.personId
    ? await api(`/persons/${state.personId}/tree`)
    : await api(`/folders/${state.folderId}/subtree`);
  const byId = new Map(tree.map((f) => [f.id, f]));
  const pathOf = (folder) => {
    const parts = [];
    for (let cur = folder; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : null) parts.unshift(cur.name);
    return parts.join(' / ');
  };
  const excluded = excludeId ? descendantIds(tree, excludeId) : new Set();
  const rootOption = state.level === 'edit'
    ? [{ value: '', label: 'Person root' }]
    : [{ value: String(state.folderId), label: 'Shared folder' }];
  return [...rootOption, ...tree.filter((f) => !excluded.has(f.id)).map((f) => ({ value: String(f.id), label: pathOf(f) }))];
}

async function move(kind, id) {
  const options = await moveTargets(kind === 'folder' ? id : null);
  const result = await formModal({
    title: `Move ${kind}`,
    fields: [{ name: 'target', label: 'Move to', type: 'select', value: '', options }],
    submit: 'Move',
  });
  if (!result) return;
  await moveTo(kind, id, result.target === '' ? null : Number(result.target));
}

// Shared by the Move dialog and drag and drop. Null means the person root.
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

async function toggleStar(kind, id, starred) {
  await api('/stars', { method: 'PUT', body: { kind, id, starred } });
  toast(starred ? 'Starred' : 'Removed from starred');
  render();
}

// ---- Sharing ------------------------------------------------------------------------------

async function openShareDialog(kind, id, name) {
  const [shares, users] = await Promise.all([
    api(`/shares?kind=${kind}&id=${id}`),
    api('/share-users'),
  ]);
  const shared = new Set(shares.map((s) => String(s.email)));
  const choices = users.filter((u) => !shared.has(u.email));
  await openOverlay(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="Share ${esc(name)}">
      <h2>Share “${esc(name)}”</h2>
      <p class="muted small">People you share with see this ${kind} in their “Shared with me” list.</p>
      <div class="share-list">
        ${shares.length ? shares.map((s) => `
          <div class="share-item">
            <span class="grow">${esc(s.email)} <span class="badge">${esc(s.permission)}</span></span>
            <button class="btn small danger" type="button" data-revoke="${s.id}">Remove</button>
          </div>`).join('') : '<p class="muted small">Not shared with anyone yet.</p>'}
      </div>
      ${choices.length ? `
        <form id="share-form">
          <label class="field"><span>Share with</span>
            <select name="user_id">${choices.map((u) => `<option value="${u.id}">${esc(u.email)}</option>`).join('')}</select></label>
          <label class="field"><span>Permission</span>
            <select name="permission">
              <option value="view">Can view and download</option>
              <option value="edit">Can view, change and share</option>
              <option value="dropbox">Upload only (cannot see contents)</option>
            </select></label>
          <p class="perm-help" id="perm-help">${PERMISSION_HELP.view}</p>
          <div class="modal-actions"><button class="btn" type="button" data-close>Done</button><button class="btn primary">Share</button></div>
        </form>` : `<p class="muted small">${users.length ? 'Everyone on this install already has access.' : 'There are no other accounts to share with yet. The super admin can create them.'}</p>
        <div class="modal-actions"><button class="btn" type="button" data-close>Done</button></div>`}
    </div>`, (root, close) => {
    root.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/shares/${b.dataset.revoke}`, { method: 'DELETE' });
        toast('Access removed');
        close();
        openShareDialog(kind, id, name);
      } catch (err) {
        toast(err.message, true);
      }
    }));
    const form = root.querySelector('#share-form');
    if (form) {
      form.permission.addEventListener('change', () => {
        root.querySelector('#perm-help').textContent = PERMISSION_HELP[form.permission.value];
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/shares', {
            method: 'POST',
            body: { kind, id, user_id: Number(form.user_id.value), permission: form.permission.value },
          });
          toast('Shared');
          close();
          openShareDialog(kind, id, name);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  });
}

// ---- Menus -----------------------------------------------------------------------------

function documentMenuItems(row) {
  const kind = row.dataset.kind;
  const starredNow = row.dataset.starredNow === '1';
  const star = { value: 'star', label: starredNow ? 'Remove star' : 'Star' };
  if (row.dataset.search) {
    return [
      { value: 'preview', label: 'Preview and details' },
      { value: 'download', label: 'Download' },
      { value: 'share-app', label: 'Share to other apps' },
      { value: 'tags', label: 'Edit tags' },
      { value: 'reveal', label: 'Open folder' },
    ];
  }
  if (row.dataset.shared) {
    if (kind === 'folder') return [{ value: 'open', label: 'Open' }, star];
    return [{ value: 'preview', label: 'Preview and details' }, { value: 'download', label: 'Download' }, { value: 'share-app', label: 'Share to other apps' }, star];
  }
  const writable = canWrite();
  if (kind === 'folder') {
    const items = [{ value: 'open', label: 'Open' }, star];
    if (writable) items.push({ value: 'details', label: 'Icon and description' }, { value: 'rename', label: 'Rename' }, { value: 'move', label: 'Move' });
    items.push({ value: 'share', label: 'Share…' });
    if (writable) items.push({ value: 'delete', label: 'Move to recycle bin', danger: true });
    return items;
  }
  const items = [{ value: 'preview', label: 'Preview and details' }, { value: 'download', label: 'Download' }, { value: 'share-app', label: 'Share to other apps' }, star];
  if (writable) items.push({ value: 'details', label: 'Description and expiry' }, { value: 'tags', label: 'Edit tags' }, { value: 'rename', label: 'Rename' }, { value: 'move', label: 'Move' });
  items.push({ value: 'share', label: 'Share…' });
  if (writable) items.push({ value: 'delete', label: 'Move to recycle bin', danger: true });
  return items;
}

function userMenuItems(row) {
  if (row.dataset.self === '1') return [];
  return [
    { value: 'persons', label: 'Manage persons' },
    { value: 'reset', label: 'Reset password' },
    { value: 'toggle', label: row.dataset.active === '1' ? 'Disable account' : 'Enable account' },
    { value: 'role', label: row.dataset.role === 'super_admin' ? 'Remove super admin role' : 'Make super admin' },
    { value: 'delete', label: 'Delete login (documents are kept)', danger: true },
  ];
}

const recoveryMenuItems = (row) => (row.dataset.status !== 'pending' ? [] : [
  { value: 'approve', label: 'Approve and create temporary password' },
  { value: 'reject', label: 'Reject request', danger: true },
]);

const trashMenuItems = () => [
  { value: 'restore', label: 'Restore' },
  { value: 'purge', label: 'Delete forever', danger: true },
];

async function openRowMenu(row) {
  const kind = row.dataset.kind;
  const title = {
    user: () => row.dataset.email,
    recovery: () => row.dataset.email,
    trash: () => row.dataset.name,
  }[kind]?.() ?? row.querySelector('.label').textContent.trim();
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
    if (action === 'open') return go(state.personId, id);
    if (action === 'preview') return await openPreview(id);
    if (action === 'download') return (location.href = `/api/files/${id}/content?download=1`);
    if (action === 'share-app') {
      const file = await api(`/files/${id}`);
      return await shareToApps(file);
    }
    if (action === 'share') return await openShareDialog(kind, id, row.querySelector('.label').textContent.trim());
    if (action === 'star') return await toggleStar(kind, id, row.dataset.starredNow !== '1');
    if (action === 'details') {
      if (kind === 'folder') return await editFolderDetails(id);
      const file = await api(`/files/${id}`);
      return await editFileDetails(file);
    }
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

// Works out whether a row is starred, so the menu shows the right label.
async function prepareStarState(row) {
  if (row.dataset.search || row.dataset.shared || row.dataset.starredNow !== undefined) return;
  if (!['file', 'folder'].includes(row.dataset.kind)) return;
  const starred = await api('/starred').catch(() => []);
  row.dataset.starredNow = starred.some((s) => s.kind === row.dataset.kind && s.id === Number(row.dataset.id)) ? '1' : '0';
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
        message: 'This cannot be undone. The stored file is removed from the server.',
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

// ---- Selection and bulk actions ----------------------------------------------------------

function toggleSelect(kind, id, name, on) {
  const key = itemKey(kind, id);
  if (on) state.selected.set(key, { kind, id, name });
  else state.selected.delete(key);
}

// Bin rows select by the kind of item they hold (person, folder or file).
const kindOf = (row) => (row.dataset.kind === 'trash' ? row.dataset.item : row.dataset.kind);
const ignoreMissing = (err) => {
  if (err.status !== 404) throw err;
};

function allVisibleSelected() {
  const boxes = [...document.querySelectorAll('#content .row [data-pick]')];
  return boxes.length > 0 && boxes.every((box) => box.checked);
}

// Selects every item on screen, or clears them all if they are all selected already.
function selectAllVisible() {
  const select = !allVisibleSelected();
  document.querySelectorAll('#content .row').forEach((row) => {
    const box = row.querySelector('[data-pick]');
    if (!box) return;
    box.checked = select;
    row.classList.toggle('selected', select);
    toggleSelect(kindOf(row), Number(row.dataset.id), row.querySelector('.label').textContent.trim(), select);
  });
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $('#bulk-bar');
  const files = state.view === 'files';
  const trash = state.view === 'trash';
  bar.classList.toggle('hidden', !(state.selecting && (files || trash)));
  const count = state.selected.size;
  $('#bulk-count').textContent = `${count} selected`;
  bar.querySelectorAll('[data-bulk]').forEach((button) => {
    const action = button.dataset.bulk;
    let show = true;
    if (['move', 'tag', 'delete'].includes(action)) show = files && canWrite();
    if (['restore', 'purge'].includes(action)) show = trash;
    button.classList.toggle('hidden', !show);
    if (['move', 'tag', 'delete', 'restore', 'purge'].includes(action)) button.disabled = count === 0;
  });
  bar.querySelector('[data-bulk="select-all"]').textContent = allVisibleSelected() ? 'Deselect all' : 'Select all';
}

async function bulk(action) {
  if (action === 'clear') {
    state.selected.clear();
    state.selecting = false;
    return render();
  }
  if (action === 'select-all') return selectAllVisible();
  const items = [...state.selected.values()];
  if (!items.length) return toast('Select at least one item first', true);
  try {
    if (action === 'move') {
      const options = await moveTargets(null);
      const result = await formModal({
        title: `Move ${items.length} item${items.length > 1 ? 's' : ''}`,
        fields: [{ name: 'target', label: 'Move to', type: 'select', value: '', options }],
        submit: 'Move',
      });
      if (!result) return;
      const target = result.target === '' ? null : Number(result.target);
      for (const item of items) {
        const body = item.kind === 'folder' ? { parent_id: target } : { folder_id: target };
        await api(`/${endpoint(item.kind)}/${item.id}`, { method: 'PATCH', body });
      }
    } else if (action === 'tag') {
      const files = items.filter((i) => i.kind === 'file');
      const result = await formModal({
        title: `Tags for ${files.length} file${files.length === 1 ? '' : 's'}`,
        message: 'These tags replace the existing tags on the selected files. Leave empty to remove them.',
        fields: [{ name: 'tags', label: 'Tags', optional: true, placeholder: 'e.g. tax, 2026' }],
        submit: 'Apply tags',
      });
      if (!result) return;
      for (const item of files) await api(`/files/${item.id}/tags`, { method: 'PUT', body: { tags: result.tags } });
    } else if (action === 'delete') {
      const result = await formModal({
        title: `Move ${items.length} item${items.length > 1 ? 's' : ''} to the recycle bin?`,
        message: 'Folders take their contents with them. A super admin can restore them from the recycle bin.',
        submit: 'Move to recycle bin',
        danger: true,
      });
      if (!result) return;
      for (const item of items) await api(`/${endpoint(item.kind)}/${item.id}`, { method: 'DELETE' });
    } else if (action === 'restore') {
      for (const item of items) await api(`/trash/${item.kind}/${item.id}/restore`, { method: 'POST' }).catch(ignoreMissing);
      toast(`Restored ${items.length} item${items.length === 1 ? '' : 's'}`);
    } else if (action === 'purge') {
      const result = await formModal({
        title: `Delete ${items.length} item${items.length === 1 ? '' : 's'} forever?`,
        message: 'This cannot be undone. The stored files are removed from the server.',
        submit: 'Delete forever',
        danger: true,
      });
      if (!result) return;
      for (const item of items) await api(`/trash/${item.kind}/${item.id}`, { method: 'DELETE' }).catch(ignoreMissing);
      toast('Deleted forever');
    }
    state.selected.clear();
    render();
  } catch (err) {
    toast(err.message, true);
    render();
  }
}

// Recycle bin toolbar: restore everything, or delete everything for good.
const TRASH_ORDER = { person: 0, folder: 1, file: 2 };

// Works through the bin one top-most item at a time, because restoring or deleting a person
// also takes its contents out of the list.
async function emptyBin(method) {
  let count = 0;
  for (let i = 0; i < 1000; i++) {
    const items = await api('/trash');
    if (!items.length) break;
    items.sort((x, y) => TRASH_ORDER[x.kind] - TRASH_ORDER[y.kind]);
    const item = items[0];
    if (method === 'restore') await api(`/trash/${item.kind}/${item.id}/restore`, { method: 'POST' });
    else await api(`/trash/${item.kind}/${item.id}`, { method: 'DELETE' });
    count++;
  }
  return count;
}

async function trashToolbar(action) {
  try {
    if (action === 'select') {
      state.selecting = !state.selecting;
      if (!state.selecting) state.selected.clear();
      return render();
    }
    if (action === 'restore-all') {
      const count = await emptyBin('restore');
      toast(count ? `Restored ${count} item${count === 1 ? '' : 's'}` : 'The recycle bin is empty');
    } else if (action === 'purge-all') {
      const items = await api('/trash');
      if (!items.length) return toast('The recycle bin is empty');
      const result = await formModal({
        title: `Delete all ${items.length} item${items.length === 1 ? '' : 's'} forever?`,
        message: 'This cannot be undone. The stored files are removed from the server.',
        submit: 'Delete everything',
        danger: true,
      });
      if (!result) return;
      const count = await emptyBin('purge');
      toast(`Deleted ${count} item${count === 1 ? '' : 's'} forever`);
    }
    state.selected.clear();
    render();
  } catch (err) {
    toast(err.message, true);
    render();
  }
}

// ---- Upload and import ------------------------------------------------------------------------

async function uploadFiles(fileList, { camera = false } = {}) {
  if (state.view !== 'files' || (!state.personId && !state.folderId)) return toast('Open a person or folder to upload', true);
  const files = [...fileList];
  if (!files.length) return;

  // Snapshot everything before any await: the file input is cleared after the change event.
  const dates = files.map((f) => f.lastModified);
  const personId = state.personId;
  const folderId = state.folderId;
  const answers = await formModal({
    title: `Upload ${files.length} file${files.length > 1 ? 's' : ''}${camera ? ' from camera' : ''}`,
    message: files.map((f) => f.name).slice(0, 5).join(', ') + (files.length > 5 ? ` and ${files.length - 5} more` : ''),
    fields: [
      { name: 'tags', label: 'Tags (optional)', optional: true, placeholder: 'e.g. tax, 2026' },
      { name: 'description', label: 'Description (optional)', type: 'textarea', optional: true },
    ],
    submit: 'Upload',
  });
  if (!answers) return;

  const form = new FormData();
  if (personId) form.append('person_id', String(personId));
  if (folderId) form.append('folder_id', String(folderId));
  form.append('tags', answers.tags || '');
  form.append('description', answers.description || '');
  form.append('file_dates', JSON.stringify(dates));
  for (const file of files) form.append('files', file);
  sendUpload(form, files.length);
}

function sendUpload(form, count) {
  const bar = $('#upload-progress');
  const fill = bar.querySelector('.bar');
  bar.classList.remove('hidden');
  fill.style.width = '0%';
  bar.querySelector('span').textContent = `Uploading ${count} file${count > 1 ? 's' : ''}…`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) fill.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
  };
  xhr.onload = () => {
    bar.classList.add('hidden');
    let data = [];
    try {
      data = JSON.parse(xhr.responseText);
    } catch {
      // Non-JSON error bodies fall through to the generic message below.
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      const duplicates = Array.isArray(data) ? data.filter((f) => f.duplicates?.length).length : 0;
      toast(`Uploaded ${count} file${count > 1 ? 's' : ''}${duplicates ? `. ${duplicates} ${duplicates > 1 ? 'are' : 'is'} identical to a file already stored.` : ''}`, duplicates > 0);
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

// Folder import keeps every folder name, the nesting, and each file's date.
// Folders do not carry an original date, so they are dated when imported.
async function importFolder(fileList) {
  const files = [...fileList].filter((f) => f.webkitRelativePath);
  if (!files.length) return;
  if (!state.personId && !state.folderId) return toast('Open a person or folder first', true);
  const parentId = state.folderId;
  const personId = state.personId;

  // Every directory on the way to a file, shallowest first, so parents exist before children.
  const dirs = new Set();
  for (const f of files) {
    const parts = f.webkitRelativePath.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const ordered = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const folderIds = new Map();
  const bar = $('#upload-progress');
  bar.classList.remove('hidden');
  bar.querySelector('span').textContent = `Importing ${files.length} files…`;
  bar.querySelector('.bar').style.width = '0%';
  try {
    for (const dir of ordered) {
      const parts = dir.split('/');
      const name = parts[parts.length - 1];
      const parent = parts.slice(0, -1).join('/');
      const parentFolder = parent ? folderIds.get(parent) : parentId;
      const body = parentFolder ? { parent_id: parentFolder, name } : { person_id: personId, name };
      const created = await api('/folders', { method: 'POST', body });
      folderIds.set(dir, created.id);
    }
    const groups = new Map();
    for (const f of files) {
      const dir = f.webkitRelativePath.split('/').slice(0, -1).join('/');
      groups.set(dir, [...(groups.get(dir) ?? []), f]);
    }
    let done = 0;
    for (const [dir, group] of groups) {
      for (let i = 0; i < group.length; i += 50) {
        const chunk = group.slice(i, i + 50);
        const form = new FormData();
        if (personId) form.append('person_id', String(personId));
        form.append('folder_id', String(folderIds.get(dir)));
        form.append('file_dates', JSON.stringify(chunk.map((f) => f.lastModified)));
        for (const f of chunk) form.append('files', f, f.name);
        const res = await fetch('/api/files', { method: 'POST', body: form, credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Import stopped');
        done += chunk.length;
        bar.querySelector('.bar').style.width = `${Math.round((done / files.length) * 100)}%`;
        bar.querySelector('span').textContent = `Imported ${done} of ${files.length} files…`;
      }
    }
    toast(`Imported ${files.length} files in ${folderIds.size} folders`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    bar.classList.add('hidden');
    render();
  }
}

async function newFolder() {
  const result = await formModal({
    title: 'New folder',
    fields: [
      { name: 'name', label: 'Folder name' },
      { name: 'icon', label: 'Icon', type: 'icons', value: 'folder' },
      { name: 'description', label: 'Description (optional)', type: 'textarea', optional: true },
    ],
    submit: 'Create',
  });
  if (!result) return;
  try {
    const body = { parent_id: state.folderId, name: result.name, icon: result.icon, description: result.description };
    if (!state.folderId) body.person_id = state.personId;
    await api('/folders', { method: 'POST', body });
    toast('Folder created');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Sorting -------------------------------------------------------------------------------

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

// ---- Drag and drop -------------------------------------------------------------------------

function wireDragAndDrop() {
  const content = $('#content');
  content.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row[data-kind="file"], .row[data-kind="folder"]');
    if (!row || row.dataset.search || !canWrite()) return e.preventDefault();
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
  content.addEventListener('dragleave', (e) => e.target.closest?.('.row')?.classList.remove('drop-target'));
  content.addEventListener('drop', (e) => {
    if (!hasType(e, ITEM_TYPE)) return;
    const row = e.target.closest('.row[data-kind="folder"]');
    if (!row) return;
    e.preventDefault();
    row.classList.remove('drop-target');
    dropItemOn(JSON.parse(e.dataTransfer.getData(ITEM_TYPE)), Number(row.dataset.id));
  });

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
    dropItemOn(JSON.parse(e.dataTransfer.getData(ITEM_TYPE)), target);
  });

  const nav = $('#person-list');
  nav.addEventListener('dragstart', (e) => {
    const button = e.target.closest('[data-person]');
    if (!button || !isAdmin()) return e.preventDefault();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PERSON_TYPE, button.dataset.person);
  });
  nav.addEventListener('dragover', (e) => {
    const button = e.target.closest('[data-person]');
    if (!button || !hasType(e, PERSON_TYPE)) return;
    e.preventDefault();
    button.classList.add('drop-target');
  });
  nav.addEventListener('dragleave', (e) => e.target.closest?.('[data-person]')?.classList.remove('drop-target'));
  nav.addEventListener('drop', (e) => {
    const button = e.target.closest('[data-person]');
    document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    if (!button || !hasType(e, PERSON_TYPE)) return;
    e.preventDefault();
    reorderPersons(Number(e.dataTransfer.getData(PERSON_TYPE)), Number(button.dataset.person));
  });
}

async function dropItemOn(item, targetFolderId) {
  if (item.kind === 'folder' && item.id === targetFolderId) return;
  try {
    if (item.kind === 'folder' && targetFolderId) {
      const targets = await moveTargets(item.id);
      if (!targets.some((o) => o.value === String(targetFolderId))) {
        return toast('A folder cannot be moved into itself', true);
      }
    }
    await moveTo(item.kind, item.id, targetFolderId);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Event wiring ----------------------------------------------------------------------------

window.addEventListener('hashchange', () => {
  const route = parseRoute();
  state.view = route.view;
  if (route.view === 'files') {
    state.personId = route.personId ?? null;
    state.folderId = route.folderId ?? null;
  }
  if (ADMIN_VIEWS.includes(state.view) && !isAdmin()) state.view = 'home';
  state.selected.clear();
  state.selecting = false;
  state.page = 1;
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
  applySidebarWidth();
});
$('#account-btn').addEventListener('click', openAccountMenu);

document.querySelectorAll('[data-nav]').forEach((b) => {
  b.addEventListener('click', () => navigate(`#/${b.dataset.nav}`));
});

$('#new-person').addEventListener('click', newPerson);
$('#person-settings').addEventListener('click', personSettings);
$('#sort-btn').addEventListener('click', sortSheet);
$('#new-folder').addEventListener('click', newFolder);
$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#camera-btn').addEventListener('click', () => $('#camera-input').click());
$('#import-btn').addEventListener('click', () => $('#folder-input').click());
$('#file-input').addEventListener('change', (e) => {
  const files = e.target.files;
  uploadFiles(files).finally(() => { e.target.value = ''; });
});
$('#camera-input').addEventListener('change', (e) => {
  const files = e.target.files;
  uploadFiles(files, { camera: true }).finally(() => { e.target.value = ''; });
});
$('#folder-input').addEventListener('change', (e) => {
  const files = e.target.files;
  importFolder(files).finally(() => { e.target.value = ''; });
});
$('#select-btn').addEventListener('click', () => {
  state.selecting = !state.selecting;
  if (!state.selecting) state.selected.clear();
  render();
});
$('#bulk-bar').addEventListener('click', (e) => {
  const button = e.target.closest('[data-bulk]');
  if (button) bulk(button.dataset.bulk);
});

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

$('#person-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-person]');
  if (button) go(Number(button.dataset.person), null);
});

$('#crumbs').addEventListener('click', (e) => {
  const crumb = e.target.closest('[data-crumb]');
  if (!crumb) return;
  if (crumb.dataset.crumb) return go(state.personId, Number(crumb.dataset.crumb));
  return go(Number(crumb.dataset.person ?? state.personId), null);
});

$('#content').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="new-person"]')) return newPerson();
  if (e.target.closest('[data-action="upload-here"]')) return $('#file-input').click();
  const sort = e.target.closest('[data-sort]');
  if (sort) {
    const key = sort.dataset.sort;
    const dir = state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc';
    return setSort(key, dir);
  }
  const row = e.target.closest('.row[data-kind]');
  if (!row) return;
  if (e.target.closest('[data-kebab]')) {
    return prepareStarState(row).then(() => openRowMenu(row));
  }
  if (e.target.closest('[data-pick]')) return; // the change listener handles selection
  if (state.selecting && !row.dataset.search && row.querySelector('[data-pick]')) {
    const box = row.querySelector('[data-pick]');
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (['user', 'trash', 'recovery'].includes(row.dataset.kind)) return;
  if (row.dataset.kind === 'folder') return go(state.personId, Number(row.dataset.id));
  if (row.dataset.kind === 'file') return rowAction('preview', row);
});

$('#content').addEventListener('change', (e) => {
  const box = e.target.closest?.('[data-pick]');
  if (!box) return;
  const row = box.closest('.row');
  toggleSelect(kindOf(row), Number(row.dataset.id), row.querySelector('.label').textContent.trim(), box.checked);
  row.classList.toggle('selected', box.checked);
  renderBulkBar();
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

// Shared-with-me count on the sidebar.
api('/shared').then((items) => {
  const badge = $('#shared-count');
  badge.textContent = items.length || '';
  badge.classList.toggle('hidden', !items.length);
}).catch(() => {});

// ---- Sign-in with a code from the authenticator app ----------------------------------------

function wireLogin(form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('.error');
    errorEl.textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      if (data.totpRequired) return showTotpStep(data.pendingToken);
      await boot();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function showTotpStep(pendingToken) {
  const el = showAuthCard(`
    <form class="auth-card">
      ${brandHtml()}
      <h1>${t('two_factor')}</h1>
      <p class="muted">${t('enter_code')}</p>
      <label class="field"><span>${t('code')}</span><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
      <label class="check-row"><input type="checkbox" name="remember"> <span>${t('trust_browser')}</span></label>
      <button class="btn primary wide" type="submit">${t('confirm')}</button>
      <p class="error" role="alert"></p>
      <div class="auth-links"><button class="link-btn" type="button" data-back>${t('sign_in')}</button></div>
    </form>`);
  el.querySelector('[data-back]').addEventListener('click', showLogin);
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errorEl = form.querySelector('.error');
    try {
      await api('/auth/login/totp', {
        method: 'POST',
        body: { pendingToken, code: form.code.value, remember: form.remember.checked },
      });
      await boot();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---- Two-factor set-up and turn-off (Settings → Account) ------------------------------------

async function startTwoFactorSetup() {
  let setup;
  try {
    setup = await api('/auth/2fa/setup', { method: 'POST' });
  } catch (err) {
    return toast(err.message, true);
  }
  await openOverlay(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${t('two_factor')}">
      <h2>${t('two_factor')}</h2>
      <p class="muted small">${t('scan_code')}</p>
      <div class="qr-box">${setup.qr}</div>
      <p class="muted small">${t('or_enter')}</p>
      <div class="copy-box"><span>${esc(setup.secret)}</span></div>
      <form data-2fa-enable>
        <label class="field"><span>${t('enter_code')}</span><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>${t('cancel')}</button>
          <button class="btn primary">${t('confirm')}</button>
        </div>
      </form>
    </div>`, (root, close) => {
    root.querySelector('[data-2fa-enable]').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/auth/2fa/enable', { method: 'POST', body: { code: e.currentTarget.code.value } });
        state.user.twoFactor = true;
        toast(t('two_factor_on'));
        close();
        renderSettingsBody();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function disableTwoFactor() {
  const result = await formModal({
    title: t('turn_off'),
    message: 'Enter your password to turn off two-factor sign-in.',
    fields: [{ name: 'password', label: t('password'), type: 'password' }],
    submit: t('turn_off'),
    danger: true,
  });
  if (!result) return;
  try {
    await api('/auth/2fa/disable', { method: 'POST', body: result });
    state.user.twoFactor = false;
    toast(t('two_factor_off'));
    renderSettingsBody();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Backups (Settings → Administration → Backups) -------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function adminBackupsHtml() {
  const data = await api('/admin/backups');
  const s = data.schedule;
  const modeOption = (value, label) => `<option value="${value}"${s.mode === value ? ' selected' : ''}>${esc(label)}</option>`;
  const list = data.backups.length
    ? data.backups.map((b) => `
        <div class="backup-item">
          <div class="grow">
            <strong>${esc(formatDateTime(b.createdAt))}</strong>
            <div class="muted small">${esc(b.label)} · ${b.files} files · ${esc(formatSize(b.bytes))}</div>
          </div>
          <button class="btn small" type="button" data-backup="download" data-id="${esc(b.id)}">${t('download')}</button>
          <button class="btn small" type="button" data-backup="restore" data-id="${esc(b.id)}">${t('restore')}</button>
          <button class="btn small danger" type="button" data-backup="delete" data-id="${esc(b.id)}">${t('delete')}</button>
        </div>`).join('')
    : '<p class="muted small">No backups yet.</p>';
  return `
    <div class="admin-head">
      <span class="muted small">${s.lastRun ? `Last backup: ${esc(formatDateTime(s.lastRun))}` : 'No backup has run yet.'}</span>
      <span class="grow"></span>
      <button class="btn primary small" type="button" data-backup="now">${t('back_up_now')}</button>
    </div>

    <h3>${t('schedule')}</h3>
    <form class="profile-form" data-backup-form>
      <label class="field"><span>${t('schedule')}</span>
        <select name="mode">${modeOption('manual', t('manual'))}${modeOption('daily', t('daily'))}${modeOption('weekly', t('weekly'))}</select>
      </label>
      <label class="field"><span>${t('at_time')}</span><input name="time" type="time" value="${esc(s.time)}" required></label>
      <label class="field"><span>Day (weekly only)</span>
        <select name="weekday">${WEEKDAYS.map((d, i) => `<option value="${i}"${s.weekday === i ? ' selected' : ''}>${d}</option>`).join('')}</select>
      </label>
      <label class="field"><span>${t('keep_last')} (backups)</span><input name="keep" type="number" min="1" max="365" value="${s.keep}" required></label>
      <div class="settings-row"><button class="btn primary" type="submit">${t('save')}</button></div>
    </form>
    <p class="muted small">Backups are kept on this computer in the backups folder (set BACKUP_DIR in .env to use another drive). Unchanged files are shared between backups, so each one takes only the space of what changed.</p>

    <h3>Backups</h3>
    <div class="backup-list">${list}</div>

    <h3>${t('upload_backup')}</h3>
    <form class="profile-form" data-backup-upload>
      <label class="field"><span>Backup file (.zip)</span><input type="file" name="file" accept=".zip,application/zip" required></label>
      <div class="settings-row"><button class="btn danger" type="submit">${t('upload_backup')}</button></div>
    </form>`;
}

async function backupAction(action, id) {
  try {
    if (action === 'now') {
      const meta = await api('/admin/backups', { method: 'POST' });
      toast(`Backup created (${meta.files} files)`);
      return renderSettingsBody();
    }
    if (action === 'download') {
      location.href = `/api/admin/backups/${encodeURIComponent(id)}/download`;
      return;
    }
    if (action === 'delete') {
      const result = await formModal({
        title: 'Delete this backup?',
        message: 'The backup is removed. Your live data is not affected.',
        submit: t('delete'),
        danger: true,
      });
      if (!result) return;
      await api(`/admin/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Backup deleted');
      return renderSettingsBody();
    }
    if (action === 'restore') {
      const result = await formModal({
        title: 'Restore this backup?',
        message: 'Everything added or changed since this backup is replaced. The current data is kept in a folder named before-restore, and the app restarts to apply the restore.',
        fields: [{ name: 'confirm', label: t('confirm_restore'), placeholder: 'RESTORE' }],
        submit: t('restore'),
        danger: true,
      });
      if (!result) return;
      await api(`/admin/backups/${encodeURIComponent(id)}/restore`, { method: 'POST', body: { confirm: result.confirm } });
      return showRestarting();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

function showRestarting() {
  return openOverlay(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="Restarting">
      <h2>Restoring…</h2>
      <p class="muted">The app is restarting to apply the backup. This takes a few seconds. Then reload this page.</p>
      <div class="modal-actions"><button class="btn primary" type="button" onclick="location.reload()">Reload</button></div>
    </div>`);
}

document.addEventListener('submit', async (e) => {
  if (e.target.matches('[data-backup-form]')) {
    e.preventDefault();
    const form = e.target;
    try {
      await api('/admin/backups/schedule', {
        method: 'PUT',
        body: { mode: form.mode.value, time: form.time.value, weekday: Number(form.weekday.value), keep: Number(form.keep.value) },
      });
      toast('Schedule saved');
      renderSettingsBody();
    } catch (err) {
      toast(err.message, true);
    }
  }
  if (e.target.matches('[data-backup-upload]')) {
    e.preventDefault();
    const form = e.target;
    const file = form.file.files[0];
    if (!file) return toast('Choose a backup file first', true);
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/api/admin/backups/upload', { method: 'POST', body, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const confirmed = await formModal({
        title: 'Restore the uploaded backup?',
        message: 'Everything added or changed since that backup is replaced. The current data is kept aside, and the app restarts.',
        fields: [{ name: 'confirm', label: t('confirm_restore'), placeholder: 'RESTORE' }],
        submit: t('restore'),
        danger: true,
      });
      if (!confirmed) return renderSettingsBody();
      await api(`/admin/backups/${encodeURIComponent(data.id)}/restore`, { method: 'POST', body: { confirm: confirmed.confirm } });
      showRestarting();
    } catch (err) {
      toast(err.message, true);
    }
  }
});

// ---- File type colours --------------------------------------------------------------------------

const EXT_CLASS = {
  pdf: 'ext-pdf', png: 'ext-image', jpg: 'ext-image', jpeg: 'ext-image', gif: 'ext-image', webp: 'ext-image',
  heic: 'ext-image', heif: 'ext-image', svg: 'ext-image', bmp: 'ext-image', avif: 'ext-image',
  csv: 'ext-sheet', tsv: 'ext-sheet', xlsx: 'ext-sheet', xlsm: 'ext-sheet', xls: 'ext-sheet', ods: 'ext-sheet',
  docx: 'ext-doc', doc: 'ext-doc', rtf: 'ext-doc', odt: 'ext-doc',
  pptx: 'ext-slides', ppt: 'ext-slides', odp: 'ext-slides',
  md: 'ext-text', txt: 'ext-text', log: 'ext-text',
  zip: 'ext-archive', rar: 'ext-archive', '7z': 'ext-archive', tar: 'ext-archive', gz: 'ext-archive',
  mp3: 'ext-audio', wav: 'ext-audio', m4a: 'ext-audio', flac: 'ext-audio', ogg: 'ext-audio',
  mp4: 'ext-video', mov: 'ext-video', webm: 'ext-video', mkv: 'ext-video',
  js: 'ext-code', ts: 'ext-code', py: 'ext-code', json: 'ext-code', html: 'ext-code', css: 'ext-code', xml: 'ext-code',
};
const extClass = (name) => EXT_CLASS[(name.split('.').pop() || '').toLowerCase()] ?? 'ext-other';

// ---- Paginated file list -----------------------------------------------------------------------

function renderBrowse(data) {
  const { folders, files } = data;
  const content = $('#content');
  const total = folders.length + files.length;
  $('#item-count').textContent = `${total} item${total === 1 ? '' : 's'}`;
  if (!total) {
    $('#pager').classList.add('hidden');
    content.innerHTML = `
      <div class="empty">
        <h2>${t('empty_folder')}</h2>
        <p class="muted">${canWrite() ? 'Upload files, or create a subfolder to keep things organised.' : 'Nothing has been added here yet.'}</p>
      </div>`;
    return;
  }
  const sorted = sortItems(folders, files);
  const all = [...sorted.folders.map((item) => ({ kind: 'folder', item })), ...sorted.files.map((item) => ({ kind: 'file', item }))];
  const size = state.pageSize || 50;
  const pages = Math.max(1, Math.ceil(all.length / size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const visible = all.slice((state.page - 1) * size, state.page * size);

  const rows = visible.map(({ kind, item }) => {
    if (kind === 'folder') {
      return rowHtml({
        kind: 'folder',
        id: item.id,
        icon: iconSvg(item.icon),
        iconClass: 'folder',
        label: item.name,
        meta: `Folder · ${esc(formatDate(item.created_at))}${item.description ? ` · ${esc(item.description.slice(0, 60))}` : ''}`,
        col1: 'Folder',
        col2: esc(formatDate(item.created_at)),
        draggable: canWrite(),
        title: item.description || '',
      });
    }
    return rowHtml({
      kind: 'file',
      id: item.id,
      icon: extBadge(item.name),
      label: item.name,
      meta: `${esc(formatSize(item.size))} · ${esc(formatDate(item.created_at))}${item.expires_on ? ` · expires ${esc(dayOnly(item.expires_on))}` : ''}`,
      col1: esc(formatSize(item.size)),
      col2: esc(formatDate(item.created_at)),
      tags: item.tags,
      draggable: canWrite(),
    });
  }).join('');
  content.innerHTML = `<div class="list">${headerHtml([['name', 'Name'], ['size', 'Size'], ['added', 'Added']])}${rows}</div>`;
  content.classList.toggle('select-mode', state.selecting);
  renderPager(total, pages, size);
}

function renderPager(total, pages, size) {
  const pager = $('#pager');
  if (pages <= 1) {
    pager.classList.add('hidden');
    pager.innerHTML = '';
    return;
  }
  const from = (state.page - 1) * size + 1;
  const to = Math.min(total, state.page * size);
  pager.classList.remove('hidden');
  pager.innerHTML = `
    <button class="btn small" type="button" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>${t('page_previous')}</button>
    <span class="muted small">${t('page_of', { page: state.page, total: pages })} · ${t('showing', { from, to, total })}</span>
    <button class="btn small" type="button" data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>${t('page_next')}</button>`;
}

$('#pager').addEventListener('click', (e) => {
  const button = e.target.closest('[data-page]');
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  render();
});

// ---- Account menu, sidebar groups, sidebar width -----------------------------------

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;

// Settings and sign out both live behind the account name at the bottom of the sidebar.
async function openAccountMenu() {
  const choice = await openSheet(state.user.email, [
    { value: 'settings', label: 'Settings' },
    { value: 'logout', label: 'Sign out', danger: true },
  ]);
  if (choice === 'settings') openSettings('appearance');
  if (choice === 'logout') logout();
}

function applySidebarGroups() {
  const group = document.querySelector('[data-group-box="persons"]');
  const open = readStore('dk-group-persons', true);
  group.classList.toggle('collapsed', !open);
  group.querySelector('.group-toggle').setAttribute('aria-expanded', String(open));
}

function wireSidebarGroups() {
  document.querySelector('[data-group="persons"]').addEventListener('click', () => {
    writeStore('dk-group-persons', !readStore('dk-group-persons', true));
    applySidebarGroups();
  });
  applySidebarGroups();
}

function applySidebarWidth() {
  const app = $('#app');
  if (window.innerWidth <= 900 || app.classList.contains('sidebar-collapsed')) {
    app.style.removeProperty('--sidebar-w');
    return;
  }
  const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, readStore('dk-sidebar-w', 256)));
  app.style.setProperty('--sidebar-w', `${width}px`);
  $('#resizer').setAttribute('aria-valuenow', String(width));
}

// Drag the sidebar's right edge (or use the arrow keys when it has focus) to change its width.
function wireResizer() {
  const handle = $('#resizer');
  const app = $('#app');
  const clamp = (w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
  const canResize = () => window.innerWidth > 900 && !app.classList.contains('sidebar-collapsed');
  const currentWidth = () => $('#sidebar').getBoundingClientRect().width;

  handle.addEventListener('pointerdown', (e) => {
    if (!canResize()) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    app.classList.add('resizing');
    const startX = e.clientX;
    const startWidth = currentWidth();
    let width = startWidth;
    const move = (ev) => {
      width = clamp(startWidth + (ev.clientX - startX));
      app.style.setProperty('--sidebar-w', `${width}px`);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      app.classList.remove('resizing');
      writeStore('dk-sidebar-w', width);
      applySidebarWidth();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  handle.addEventListener('keydown', (e) => {
    if (!canResize() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    writeStore('dk-sidebar-w', clamp(currentWidth() + (e.key === 'ArrowRight' ? 16 : -16)));
    applySidebarWidth();
  });
  window.addEventListener('resize', applySidebarWidth);
}

$('#trash-toolbar').addEventListener('click', (e) => {
  const button = e.target.closest('[data-trash]');
  if (button) trashToolbar(button.dataset.trash);
});

wireDragAndDrop();
wireSidebarGroups();
wireResizer();
boot().catch((err) => toast(err.message, true));
