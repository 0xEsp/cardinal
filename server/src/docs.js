import { db } from './db.js';

// Docs de producto (kind "doc") y reglas del harness (kind "rule", lo que antes
// era os/) de cada proyecto. Cada escritura guarda una versión con su autor y
// origen (ui | agent | mcp | import), que sustituye al historial de git.

const KINDS = ['doc', 'rule'];
const fail = (status, message) => Object.assign(new Error(message), { status });

function checkKind(kind) {
  if (!KINDS.includes(kind)) throw fail(400, `Tipo de documento inválido: ${kind}`);
  return kind;
}

export function cleanPath(name) {
  if (typeof name !== 'string' || !name.trim()) throw fail(400, 'ruta requerida');
  const clean = name.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = clean.split('/');
  if (clean.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) throw fail(400, 'ruta inválida');
  if (!/^[\w\-./ ]+$/.test(clean)) throw fail(400, 'la ruta solo admite letras, números, guiones, puntos y barras');
  if (!clean.endsWith('.md')) throw fail(400, 'solo ficheros .md');
  return clean;
}

const titleOf = (content, fallback) => {
  const heading = content.split('\n').find((line) => line.startsWith('#'));
  return heading ? heading.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim() || fallback : fallback;
};

function findRow(projectId, path, kind) {
  return db
    .prepare('SELECT * FROM documents WHERE project_id = ? AND kind = ? AND path = ? AND deleted_at IS NULL')
    .get(projectId, checkKind(kind), cleanPath(path));
}

export function listDocs(projectId, kind = 'doc') {
  return db
    .prepare('SELECT path, content, version, updated_at FROM documents WHERE project_id = ? AND kind = ? AND deleted_at IS NULL ORDER BY path')
    .all(projectId, checkKind(kind))
    .map((row) => ({ path: row.path, title: titleOf(row.content, row.path), version: row.version, updatedAt: row.updated_at }));
}

export function readDoc(projectId, path, kind = 'doc') {
  const row = findRow(projectId, path, kind);
  if (!row) throw fail(404, `${kind === 'rule' ? 'Regla' : 'Doc'} ${path} no encontrado`);
  return row.content;
}

/** Contenido de una regla, o '' si el proyecto no la tiene (las reglas son opcionales). */
export function readRule(projectId, name) {
  return findRow(projectId, name, 'rule')?.content || '';
}

export function searchDocs(projectId, query, limit = 8, kind = 'doc') {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const maxResults = Math.min(Math.max(Number(limit) || 8, 1), 20);
  return db
    .prepare('SELECT path, content FROM documents WHERE project_id = ? AND kind = ? AND deleted_at IS NULL')
    .all(projectId, checkKind(kind))
    .map(({ path, content }) => {
      const normalized = normalize(content);
      const matches = terms.filter((term) => normalized.includes(term));
      if (matches.length !== terms.length) return null;

      const firstTermIndex = Math.min(...terms.map((term) => normalized.indexOf(term)).filter((index) => index >= 0));
      const start = Math.max(0, firstTermIndex - 180);
      const end = Math.min(content.length, firstTermIndex + 360);
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
      return {
        path,
        title: titleOf(content, path),
        matches: matches.length,
        snippet: `${start > 0 ? '…' : ''}${snippet}${end < content.length ? '…' : ''}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.matches - a.matches || a.path.localeCompare(b.path))
    .slice(0, maxResults);
}

// Líneas añadidas/quitadas (multiconjunto de líneas): suficiente para el
// resumen del historial sin depender de una librería de diff.
function lineStats(before, after) {
  const count = (text) => text.split('\n').reduce((map, line) => map.set(line, (map.get(line) || 0) + 1), new Map());
  const a = count(before);
  const b = count(after);
  let added = 0;
  let removed = 0;
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) || 0));
  for (const [line, n] of a) removed += Math.max(0, n - (b.get(line) || 0));
  return { added, removed };
}

/**
 * Crea o actualiza un documento. who: { author, source, note }. Si el
 * contenido no cambia no se crea versión nueva.
 */
export function saveDoc(projectId, path, content, { kind = 'doc', author = 'Manu', source = 'ui', note = null } = {}) {
  checkKind(kind);
  const rel = cleanPath(path);
  const text = String(content ?? '');
  const body = text.endsWith('\n') ? text : `${text}\n`;
  const now = new Date().toISOString();
  const current = db.prepare('SELECT * FROM documents WHERE project_id = ? AND kind = ? AND path = ?').get(projectId, kind, rel);
  if (current && !current.deleted_at && current.content === body) return { path: rel, version: current.version, changed: false };

  const version = current ? current.version + 1 : 1;
  const stats = lineStats(current && !current.deleted_at ? current.content : '', body);
  db.exec('BEGIN');
  try {
    let documentId = current?.id;
    if (current) {
      db.prepare('UPDATE documents SET content = ?, version = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(body, version, now, current.id);
    } else {
      documentId = db
        .prepare('INSERT INTO documents (project_id, kind, path, content, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(projectId, kind, rel, body, now, now).lastInsertRowid;
    }
    db.prepare(
      `INSERT INTO document_versions (document_id, version, content, author, source, note, lines_added, lines_removed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(documentId, version, body, String(author), String(source), note, stats.added, stats.removed, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { path: rel, version, changed: true };
}

/** Borrado lógico: el historial se conserva y se puede restaurar. */
export function deleteDoc(projectId, path, { kind = 'doc', author = 'Manu', source = 'ui' } = {}) {
  const row = findRow(projectId, path, kind);
  if (!row) throw fail(404, `${path} no encontrado`);
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE documents SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?').run(now, row.version + 1, now, row.id);
    db.prepare(
      `INSERT INTO document_versions (document_id, version, content, author, source, note, lines_removed, created_at)
       VALUES (?, ?, '', ?, ?, 'Borrado', ?, ?)`
    ).run(row.id, row.version + 1, author, source, row.content.split('\n').length, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function docHistory(projectId, path, kind = 'doc') {
  const doc = db.prepare('SELECT id FROM documents WHERE project_id = ? AND kind = ? AND path = ?').get(projectId, checkKind(kind), cleanPath(path));
  if (!doc) throw fail(404, `${path} no encontrado`);
  return db
    .prepare(
      `SELECT version, author, source, note, lines_added, lines_removed, created_at
       FROM document_versions WHERE document_id = ? ORDER BY version DESC`
    )
    .all(doc.id)
    .map((row) => ({
      version: row.version,
      author: row.author,
      source: row.source,
      note: row.note,
      linesAdded: row.lines_added,
      linesRemoved: row.lines_removed,
      createdAt: row.created_at,
    }));
}

export function readVersion(projectId, path, version, kind = 'doc') {
  const row = db
    .prepare(
      `SELECT v.content FROM document_versions v JOIN documents d ON d.id = v.document_id
       WHERE d.project_id = ? AND d.kind = ? AND d.path = ? AND v.version = ?`
    )
    .get(projectId, checkKind(kind), cleanPath(path), Number(version));
  if (!row) throw fail(404, `Versión ${version} de ${path} no encontrada`);
  return row.content;
}

export function restoreVersion(projectId, path, version, { kind = 'doc', author = 'Manu', source = 'ui' } = {}) {
  const content = readVersion(projectId, path, version, kind);
  if (!content) throw fail(400, 'Esa versión es un borrado: elige una anterior');
  return saveDoc(projectId, path, content, { kind, author, source, note: `Restaurada v${version}` });
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
