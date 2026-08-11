import fs from 'node:fs';
import path from 'node:path';
import { DOCS_DIR } from './paths.js';

function safeDocPath(name) {
  if (typeof name !== 'string' || !name.trim()) throw Object.assign(new Error('ruta requerida'), { status: 400 });
  if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) {
    throw Object.assign(new Error('ruta inválida'), { status: 400 });
  }
  const clean = path.normalize(name);
  const file = path.resolve(DOCS_DIR, clean);
  if (file !== DOCS_DIR && !file.startsWith(`${DOCS_DIR}${path.sep}`)) {
    throw Object.assign(new Error('ruta inválida'), { status: 400 });
  }
  if (!file.endsWith('.md')) throw Object.assign(new Error('solo ficheros .md'), { status: 400 });
  return file;
}

export function listDocs() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const walk = (dir, prefix = '') =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name.startsWith('.')) return [];
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) return walk(path.join(dir, e.name), rel);
      if (!e.name.endsWith('.md')) return [];
      const content = fs.readFileSync(path.join(dir, e.name), 'utf8');
      const firstHeading = content.split('\n').find((l) => l.startsWith('#'));
      return [{ path: rel, title: firstHeading ? firstHeading.replace(/^#+\s*/, '') : rel }];
    });
  return walk(DOCS_DIR).sort((a, b) => a.path.localeCompare(b.path));
}

export function readDoc(name) {
  const file = safeDocPath(name);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`Doc ${name} no encontrado`), { status: 404 });
  return fs.readFileSync(file, 'utf8');
}

export function searchDocs(query, limit = 8) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const maxResults = Math.min(Math.max(Number(limit) || 8, 1), 20);
  return listDocs()
    .map((doc) => {
      const content = readDoc(doc.path);
      const normalized = normalize(content);
      const matches = terms.filter((term) => normalized.includes(term));
      if (matches.length !== terms.length) return null;

      const firstTermIndex = Math.min(...terms.map((term) => normalized.indexOf(term)).filter((index) => index >= 0));
      const start = Math.max(0, firstTermIndex - 180);
      const end = Math.min(content.length, firstTermIndex + 360);
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
      return {
        path: doc.path,
        title: doc.title,
        matches: matches.length,
        snippet: `${start > 0 ? '…' : ''}${snippet}${end < content.length ? '…' : ''}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.matches - a.matches || a.path.localeCompare(b.path))
    .slice(0, maxResults);
}

export function saveDoc(name, content) {
  const file = safeDocPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n');
  return path.relative(DOCS_DIR, file);
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
