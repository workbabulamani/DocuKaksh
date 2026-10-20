// How each file type is previewed. Decided from the file name extension, never from the
// content type the browser sent, because browsers often guess that wrong.
//
//   native   the browser displays the stored file directly (PDF, images, audio, video)
//   convert  the server turns it into safe HTML or a JPEG, cached in the data folder
//   none     no preview; the file can still be downloaded

const NATIVE = {
  pdf: { category: 'pdf', mime: 'application/pdf' },
  png: { category: 'image', mime: 'image/png' },
  jpg: { category: 'image', mime: 'image/jpeg' },
  jpeg: { category: 'image', mime: 'image/jpeg' },
  gif: { category: 'image', mime: 'image/gif' },
  webp: { category: 'image', mime: 'image/webp' },
  avif: { category: 'image', mime: 'image/avif' },
  bmp: { category: 'image', mime: 'image/bmp' },
  svg: { category: 'image', mime: 'image/svg+xml' },
  mp4: { category: 'video', mime: 'video/mp4' },
  webm: { category: 'video', mime: 'video/webm' },
  ogv: { category: 'video', mime: 'video/ogg' },
  mp3: { category: 'audio', mime: 'audio/mpeg' },
  m4a: { category: 'audio', mime: 'audio/mp4' },
  wav: { category: 'audio', mime: 'audio/wav' },
  ogg: { category: 'audio', mime: 'audio/ogg' },
  flac: { category: 'audio', mime: 'audio/flac' },
};

const TEXT = new Set([
  'txt', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less', 'html', 'htm',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
  'sh', 'bash', 'ps1', 'bat', 'sql', 'r', 'lua', 'pl', 'dockerfile', 'gitignore', 'rtf',
]);

const CONVERTERS = {
  md: 'markdown',
  markdown: 'markdown',
  csv: 'table',
  tsv: 'table',
  xlsx: 'sheet',
  xlsm: 'sheet',
  docx: 'docx',
  pptx: 'pptx',
  heic: 'heic',
  heif: 'heic',
};

export const extOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
};

export function previewFor(name) {
  const ext = extOf(name);
  if (NATIVE[ext]) return { mode: 'native', ...NATIVE[ext] };
  if (TEXT.has(ext)) return { mode: 'convert', converter: 'text' };
  if (CONVERTERS[ext]) return { mode: 'convert', converter: CONVERTERS[ext] };
  return { mode: 'none' };
}

// Content types recorded for display. Browsers often send application/octet-stream for
// files they do not recognise, so the extension decides when the browser's answer is generic.
const MIME_BY_EXT = {
  csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', markdown: 'text/markdown',
  txt: 'text/plain', log: 'text/plain', json: 'application/json', xml: 'application/xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  heic: 'image/heic', heif: 'image/heif', zip: 'application/zip', rtf: 'application/rtf',
};

export function mimeFor(name, clientType) {
  const generic = !clientType || clientType === 'application/octet-stream';
  if (generic && MIME_BY_EXT[extOf(name)]) return MIME_BY_EXT[extOf(name)];
  return clientType || 'application/octet-stream';
}

// Only native types are ever served inline with their own content type.
export const inlineMime = (name) => {
  const info = previewFor(name);
  return info.mode === 'native' ? info.mime : null;
};
