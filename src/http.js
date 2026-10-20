import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);

export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid id');
  return id;
}

export function parseOptionalId(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseId(value);
}

export function cleanText(value, label, max = 255) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!text) throw badRequest(`${label} is required`);
  if (text.length > max) throw badRequest(`${label} must be ${max} characters or fewer`);
  return text;
}

export function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email');
  return email;
}

export function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8) throw badRequest('Password must be at least 8 characters');
  if (value.length > 200) throw badRequest('Password is too long');
  return value;
}

export function cleanColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#4f46e5';
}

// Browsers send UTF-8 file names, which the multipart parser may read as latin1. Undo that
// when the result is clearly mangled, and keep only the last path segment.
export function cleanFileName(original) {
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  const name = (decoded.includes('\uFFFD') ? original : decoded)
    .split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (name || 'untitled').slice(0, 255);
}

// Tags: comma-separated input, lower-cased, de-duplicated, at most 20 per file.
export function cleanTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const tags = [...new Set(list
    .map((t) => String(t).replace(/[\u0000-\u001f\u007f,#]/g, '').trim().toLowerCase().slice(0, 40))
    .filter(Boolean))];
  if (tags.length > 20) throw badRequest('A file can have at most 20 tags');
  return tags;
}

export const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

// Makes a value safe to put inside a Content-Disposition header.
export function contentDisposition(type, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Recursive SQL that walks down from a folder. Use as a prefix to a SELECT that reads from `subtree`.
export const SUBTREE_CTE = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM folders WHERE id = ?
  UNION ALL
  SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
)`;
