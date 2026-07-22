import fs from 'node:fs';
import path from 'node:path';
import { DOCS_DIR } from './paths.js';

function safeDocPath(name) {
  const clean = path.normalize(name).replace(/^(\.\.[/\\])+/, '');
  const file = path.resolve(DOCS_DIR, clean);
  if (!file.startsWith(DOCS_DIR)) throw Object.assign(new Error('ruta inválida'), { status: 400 });
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

export function saveDoc(name, content) {
  const file = safeDocPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n');
  return path.relative(DOCS_DIR, file);
}
