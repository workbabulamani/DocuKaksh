import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';

// Converters are loaded on first use so an idle server stays small in memory.
const lazy = {
  mammoth: () => import('mammoth'),
  heic: () => import('heic-convert'),
};

export const MAX_CONVERT_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_CHARS = 1024 * 1024;
const MAX_TABLE_ROWS = 1000;
const MAX_SHEET_ROWS = 500;
const MAX_SHEET_COLS = 40;
const MAX_XML_BYTES = 20 * 1024 * 1024;

export const PAGE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const decodeXml = (value) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

// Only these tags and attributes survive. Images must be embedded data URIs,
// so a converted document cannot load anything from the network.
function clean(html) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'section', 'figure', 'figcaption']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
}

function page(body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 18px; color: #1b1f27; background: #fff; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  h1, h2, h3 { line-height: 1.25; }
  h2 { font-size: 17px; margin: 22px 0 8px; }
  table { border-collapse: collapse; margin: 10px 0 18px; font-size: 14px; max-width: 100%; display: block; overflow-x: auto; }
  td, th { border: 1px solid #d6dae1; padding: 5px 9px; text-align: left; vertical-align: top; white-space: pre-wrap; }
  th { background: #f2f4f7; position: sticky; top: 0; }
  pre { white-space: pre-wrap; word-break: break-word; font: 13px/1.5 ui-monospace, Consolas, monospace; margin: 0; }
  section { border: 1px solid #e2e5ea; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
  .note { color: #646b7c; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #171a21; color: #e6e8ec; }
    td, th, section { border-color: #2a2f3a; }
    th { background: #1f232c; }
    .note { color: #9097a3; }
  }
</style></head><body>${body}</body></html>`;
}

// ---- Text and Markdown --------------------------------------------------------

function renderText(buffer) {
  const text = buffer.subarray(0, MAX_TEXT_CHARS).toString('utf8');
  return page(`<pre>${escape(text)}</pre>`);
}

function renderMarkdown(buffer) {
  const text = buffer.subarray(0, MAX_TEXT_CHARS).toString('utf8');
  return page(clean(marked.parse(text, { async: false, gfm: true })));
}

// ---- CSV and TSV ---------------------------------------------------------------

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_TABLE_ROWS) break;
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function tableHtml(rows, { header = true } = {}) {
  if (!rows.length) return '<p class="note">This sheet is empty.</p>';
  const cells = (row, tag) => `<tr>${row.map((v) => `<${tag}>${escape(v)}</${tag}>`).join('')}</tr>`;
  const [first, ...rest] = rows;
  const head = header ? `<thead>${cells(first, 'th')}</thead>` : '';
  const body = (header ? rest : rows).map((r) => cells(r, 'td')).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function renderDelimited(buffer, delimiter) {
  const rows = parseDelimited(buffer.toString('utf8'), delimiter);
  const truncated = rows.length > MAX_TABLE_ROWS ? `<p class="note">Showing the first ${MAX_TABLE_ROWS} rows.</p>` : '';
  return page(`${truncated}${tableHtml(rows.slice(0, MAX_TABLE_ROWS))}`);
}

// ---- XLSX (read directly from the zip, no spreadsheet library) ----------------

function unzipWanted(buffer, pattern) {
  return unzipSync(new Uint8Array(buffer), {
    filter: (f) => pattern.test(f.name) && f.originalSize <= MAX_XML_BYTES,
  });
}

function parseXlsx(buffer) {
  const files = unzipWanted(buffer, /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/);
  const read = (name) => (files[name] ? strFromU8(files[name]) : '');

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((m) => decodeXml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));

  const rels = {};
  for (const m of read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels[id] = target.replace(/^\/?(xl\/)?/, 'xl/');
  }

  const sheets = [];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = read(rels[rid] ?? '');
    sheets.push({ name, rows: readSheetRows(xml, shared) });
    if (sheets.length >= 10) break;
  }
  return sheets;
}

function readSheetRows(xml, shared) {
  const grid = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (grid.length >= MAX_SHEET_ROWS) break;
    const values = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cell[1]);
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const inner = cell[2] ?? '';
      const col = ref ? columnIndex(ref[1]) : values.length;
      if (col >= MAX_SHEET_COLS) continue;
      let value = '';
      if (type === 's') value = shared[Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1])] ?? '';
      else if (type === 'inlineStr') value = decodeXml([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (type === 'b') value = /<v>1<\/v>/.test(inner) ? 'TRUE' : 'FALSE';
      else value = decodeXml(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? '');
      values[col] = value;
    }
    grid.push(Array.from(values, (v) => v ?? ''));
  }
  return grid;
}

function columnIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function renderSheets(buffer) {
  const sheets = parseXlsx(buffer);
  if (!sheets.length) throw new Error('No worksheets found');
  return page(sheets.map((s) => `<section><h2>${escape(s.name)}</h2>${tableHtml(s.rows)}</section>`).join(''));
}

// ---- DOCX and PPTX -----------------------------------------------------------

async function renderDocx(buffer) {
  const { default: mammoth } = await lazy.mammoth();
  const { value } = await mammoth.convertToHtml({ buffer });
  return page(clean(value));
}

function renderPptx(buffer) {
  const files = unzipWanted(buffer, /^ppt\/slides\/slide\d+\.xml$/);
  const slides = Object.keys(files)
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((name, i) => {
      const xml = strFromU8(files[name]);
      const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
        .map((p) => decodeXml([...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')))
        .filter((t) => t.trim());
      const body = paragraphs.length ? paragraphs.map((t) => `<p>${escape(t)}</p>`).join('') : '<p class="note">(no text on this slide)</p>';
      return `<section><h2>Slide ${i + 1}</h2>${body}</section>`;
    });
  if (!slides.length) throw new Error('No slides found');
  return page(slides.join(''));
}

// ---- HEIC -------------------------------------------------------------------

async function convertHeic(buffer) {
  const { default: heicConvert } = await lazy.heic();
  const out = await heicConvert({ buffer, format: 'JPEG', quality: 0.85 });
  return Buffer.from(out);
}

// Builds the preview for a stored file. The converted result is cached, encrypted like the
// uploads, so each file is converted once and nothing readable is left on disk.
// readPlain() returns the decrypted original bytes.
export async function buildPreview({ converter, name, readPlain, cacheBase, vault }) {
  if (converter === 'heic') {
    const cached = `${cacheBase}.jpg`;
    if (!fs.existsSync(cached)) vault.encryptBuffer(cached, await convertHeic(readPlain()));
    return { body: vault.decryptBuffer(cached), contentType: 'image/jpeg', csp: "default-src 'none'; sandbox" };
  }

  const cached = `${cacheBase}.html`;
  if (!fs.existsSync(cached)) {
    const buffer = readPlain();
    let html;
    switch (converter) {
      case 'text': html = renderText(buffer); break;
      case 'markdown': html = renderMarkdown(buffer); break;
      case 'table': html = renderDelimited(buffer, /\.tsv$/i.test(name) ? '\t' : ','); break;
      case 'sheet': html = renderSheets(buffer); break;
      case 'docx': html = await renderDocx(buffer); break;
      case 'pptx': html = renderPptx(buffer); break;
      default: throw new Error(`Unknown converter ${converter}`);
    }
    vault.encryptBuffer(cached, Buffer.from(html, 'utf8'));
  }
  return { body: vault.decryptBuffer(cached), contentType: 'text/html; charset=utf-8', csp: PAGE_CSP };
}
