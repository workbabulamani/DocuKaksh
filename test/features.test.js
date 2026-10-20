import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createApp } from '../src/app.js';

let server;
let db;
let base;
let dataDir;
let cookie = '';
let personId;

async function call(method, url, { body, form, raw } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api${url}`, { method, headers, body: payload });
  if (raw) return { status: res.status, res, text: await res.text() };
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON bodies are returned as text.
  }
  return { status: res.status, data, res };
}

function upload(name, content, { tags, dates, type = 'application/octet-stream' } = {}) {
  const form = new FormData();
  form.append('person_id', String(personId));
  if (tags !== undefined) form.append('tags', tags);
  if (dates !== undefined) form.append('file_dates', JSON.stringify(dates));
  form.append('files', new Blob([content], { type }), name);
  return call('POST', '/files', { form });
}

// Minimal Office Open XML packages: enough structure for the converters to read real text.
const docxBytes = () => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph &amp; more</w:t></w:r></w:p></w:body></w:document>`),
}));

const xlsxBytes = () => Buffer.from(zipSync({
  'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/sharedStrings.xml': strToU8('<sst><si><t>Item</t></si><si><t>Amount</t></si></sst>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Rent &amp; utilities</t></is></c><c r="B2"><v>1200</v></c></row>
    </sheetData></worksheet>`),
}));

const pptxBytes = () => Buffer.from(zipSync({
  'ppt/slides/slide1.xml': strToU8('<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Quarterly plan</a:t></a:r></a:p></p:sld>'),
  'ppt/slides/slide2.xml': strToU8('<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Next steps</a:t></a:r></a:p></p:sld>'),
}));

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-features-'));
  const created = createApp({ dataDir, encryptionKey: crypto.randomBytes(32), loginMaxFailures: 1000 });
  db = created.db;
  await new Promise((resolve) => {
    server = created.app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  let r = await call('POST', '/auth/setup', { body: { email: 'admin@example.com', password: 'adminpass1' } });
  cookie = r.res.headers.get('set-cookie').split(';')[0];
  r = await call('POST', '/persons', { body: { name: 'Family' } });
  personId = r.data.id;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('tags can be added at upload, edited later, searched with #, and listed', async () => {
  let r = await upload('tagged.txt', 'x', { tags: 'Tax, 2026, tax' });
  assert.equal(r.status, 201);
  const file = r.data[0];
  assert.deepEqual(file.tags, ['tax', '2026'], 'tags are lower-cased and de-duplicated');

  r = await call('PUT', `/files/${file.id}/tags`, { body: { tags: 'insurance, home' } });
  assert.deepEqual(r.data.tags, ['insurance', 'home']);

  r = await call('GET', '/search?q=%23insurance');
  assert.deepEqual(r.data.map((f) => f.name), ['tagged.txt']);
  r = await call('GET', '/search?q=%23tax');
  assert.equal(r.data.length, 0, 'old tags are removed when replaced');

  r = await call('GET', '/tags');
  assert.ok(r.data.includes('home'));
  assert.ok(!r.data.includes('2026'), 'tags no longer on any file are not offered');

  r = await call('PUT', `/files/${file.id}/tags`, { body: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(',') } });
  assert.equal(r.status, 400, 'at most 20 tags per file');
});

test('the details panel receives who uploaded, when, the file date, size, location and checksum', async () => {
  const created = Date.UTC(2023, 4, 10, 8, 30);
  let r = await upload('statement.csv', 'a,b\n1,2\n', { dates: [created], type: 'text/csv' });
  const file = r.data[0];
  assert.equal(file.doc_created_at, new Date(created).toISOString(), 'the file date comes from the browser');
  assert.equal(file.uploaded_by_email, 'admin@example.com');

  r = await call('GET', `/files/${file.id}`);
  assert.equal(r.data.size, 8);
  assert.equal(r.data.person_name, 'Family');
  assert.deepEqual(r.data.path, [], 'a file at the person root has no folder path');
  assert.match(r.data.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.data.preview, 'document', 'csv is converted for preview');

  r = await upload('bad-date.txt', 'x', { dates: ['not a date'] });
  assert.equal(r.data[0].doc_created_at, null);
});

test('native types are shown directly; everything else is converted safely or left as download', async () => {
  let r = await upload('scan.pdf', '%PDF-1.4 minimal');
  let meta = await call('GET', `/files/${r.data[0].id}`);
  assert.equal(meta.data.preview, 'pdf');
  let content = await call('GET', `/files/${r.data[0].id}/content`, { raw: true });
  assert.equal(content.res.headers.get('content-type'), 'application/pdf');
  assert.match(content.res.headers.get('content-disposition'), /^inline/);

  r = await upload('photo.jpeg', 'not really a jpeg', { type: 'image/jpeg' });
  meta = await call('GET', `/files/${r.data[0].id}`);
  assert.equal(meta.data.preview, 'image');

  r = await upload('clip.mp4', 'x');
  meta = await call('GET', `/files/${r.data[0].id}`);
  assert.equal(meta.data.preview, 'video');

  r = await upload('archive.zip', 'x');
  meta = await call('GET', `/files/${r.data[0].id}`);
  assert.equal(meta.data.preview, 'none', 'archives are download only');
  r = await call('GET', `/files/${r.data[0].id}/preview`);
  assert.equal(r.status, 415);

  r = await upload('legacy.doc', 'x');
  meta = await call('GET', `/files/${r.data[0].id}`);
  assert.equal(meta.data.preview, 'none', 'old binary Word files are download only');
});

test('Word, Excel, PowerPoint, CSV and Markdown files convert to readable previews', async () => {
  let r = await upload('letter.docx', docxBytes());
  let preview = await call('GET', `/files/${r.data[0].id}/preview`, { raw: true });
  assert.equal(preview.status, 200);
  assert.match(preview.res.headers.get('content-security-policy'), /sandbox/);
  assert.match(preview.text, /Hello from Word/);
  assert.match(preview.text, /Second paragraph &amp; more/);

  r = await upload('budget.xlsx', xlsxBytes());
  preview = await call('GET', `/files/${r.data[0].id}/preview`, { raw: true });
  assert.match(preview.text, /<h2>Budget<\/h2>/);
  assert.match(preview.text, /Rent &amp; utilities/);
  assert.match(preview.text, /<td>1200<\/td>/);

  r = await upload('deck.pptx', pptxBytes());
  preview = await call('GET', `/files/${r.data[0].id}/preview`, { raw: true });
  assert.match(preview.text, /Quarterly plan/);
  assert.match(preview.text, /Slide 2/);

  r = await upload('table.csv', 'name,note\n"Smith, J","said ""hi"""\n', { type: 'text/csv' });
  preview = await call('GET', `/files/${r.data[0].id}/preview`, { raw: true });
  assert.match(preview.text, /Smith, J/);
  assert.match(preview.text, /said &quot;hi&quot;/);

  r = await upload('notes.md', '# Title\n\nSome **bold** text.\n\n<script>alert("x")</script>');
  preview = await call('GET', `/files/${r.data[0].id}/preview`, { raw: true });
  assert.match(preview.text, /<h1[^>]*>Title<\/h1>/);
  assert.match(preview.text, /<strong>bold<\/strong>/);
  assert.doesNotMatch(preview.text, /<script/, 'scripts inside Markdown are removed');
});

test('source code and text are shown as escaped text', async () => {
  const r = await upload('app.js', 'if (a < b) { alert("<img src=x onerror=alert(1)>") }');
  const preview = await call('GET', `/files/${r.data[0].id}/preview`, { raw: true });
  assert.match(preview.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(preview.text, /<img src=x/);
});

test('a damaged file gets a clear error instead of a broken page', async () => {
  const r = await upload('broken.docx', 'this is not a zip file');
  const preview = await call('GET', `/files/${r.data[0].id}/preview`);
  assert.equal(preview.status, 422);
  assert.match(preview.data.error, /could not be previewed/);
});

test('SVG is served with a sandbox policy so it cannot run script when opened', async () => {
  const r = await upload('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { type: 'image/svg+xml' });
  const content = await call('GET', `/files/${r.data[0].id}/content`, { raw: true });
  assert.equal(content.res.headers.get('content-type'), 'image/svg+xml');
  assert.match(content.res.headers.get('content-security-policy'), /sandbox/);
});

test('the recycle bin keeps a deleted file until it is restored or deleted for good', async () => {
  const r = await upload('to-trash.txt', 'bin me');
  const id = r.data[0].id;
  let res = await call('DELETE', `/files/${id}`);
  assert.equal(res.status, 204);
  res = await call('GET', '/trash');
  const item = res.data.find((t) => t.kind === 'file' && t.name === 'to-trash.txt');
  assert.ok(item);
  assert.equal(item.deleted_by_email, 'admin@example.com');

  res = await call('GET', `/files/${id}`);
  assert.equal(res.status, 404, 'a trashed file is hidden');
  res = await call('POST', `/trash/file/${id}/restore`);
  assert.equal(res.status, 204);
  res = await call('GET', `/files/${id}`);
  assert.equal(res.status, 200);

  res = await call('DELETE', `/files/${id}`);
  res = await call('DELETE', `/trash/file/${id}`);
  assert.equal(res.status, 204);
  res = await call('GET', '/trash');
  assert.equal(res.data.some((t) => t.name === 'to-trash.txt'), false);
});

test('a file cannot be purged from the bin while it is still live', async () => {
  const r = await upload('live.txt', 'still here');
  const res = await call('DELETE', `/trash/file/${r.data[0].id}`);
  assert.equal(res.status, 404);
});

test('restoring a file whose folder is still in the bin is refused with a clear message', async () => {
  let r = await call('POST', '/folders', { body: { person_id: personId, name: 'Archive' } });
  const folder = r.data;
  r = await upload('inside.txt', 'x', {});
  await call('PATCH', `/files/${r.data[0].id}`, { body: { folder_id: folder.id } });
  const fileId = r.data[0].id;
  await call('DELETE', `/folders/${folder.id}`);

  r = await call('POST', `/trash/file/${fileId}/restore`);
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'Restore the folder first');
  r = await call('POST', `/trash/folder/${folder.id}/restore`);
  assert.equal(r.status, 204);
});
