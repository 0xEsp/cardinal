import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, LEGACY_DOCS_DIR, LEGACY_RULES_DIR } from './paths.js';

// Migraciones versionadas con PRAGMA user_version. Cada una corre en una sola
// transacción (SQLite también revierte el DDL) y se verifica antes del COMMIT:
// si algo no cuadra, la base queda exactamente como estaba y el servidor no
// arranca. Antes de tocar nada se guarda una copia consistente con VACUUM INTO.

// El proyecto al que pertenece todo lo creado antes de Cardinal.
export const LEGACY_PROJECT = { id: 'gotty', name: 'Gotty', color: '#FF8A6B' };

export const DEFAULT_STACKS = ['app', 'web', 'backend'];
export const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Backlog', mode: 'define' },
  { id: 'todo', name: 'Todo', mode: 'define' },
  { id: 'in-progress', name: 'In progress', mode: 'define' },
  { id: 'done-dev', name: 'Done dev', mode: 'document' },
  { id: 'done', name: 'Done', mode: null, archive: true },
];

const MIGRATIONS = [
  { version: 1, name: 'multi-proyecto, docs y reglas en SQLite', up: migrateToProjects },
  { version: 2, name: 'tokens del MCP de agentes', up: addMcpTokens },
];

export const LATEST_VERSION = MIGRATIONS.at(-1).version;

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnsOf(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

/**
 * Lo que una migración nunca puede perder: número de filas de cada tabla de
 * datos y una huella del contenido de las cards.
 */
function snapshot(db) {
  const counts = {};
  for (const table of ['cards', 'card_stacks', 'card_comments', 'agent_runs', 'agent_sessions', 'card_agent_sessions', 'settings']) {
    if (tableExists(db, table)) counts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  }
  const cardCols = columnsOf(db, 'cards');
  const fields = ['id', 'title', '"column"', 'draft', 'definition', ...(cardCols.has('design') ? ['design'] : [])];
  const rows = db.prepare(`SELECT ${fields.join(', ')} FROM cards ORDER BY id`).all();
  const cardsHash = sha(JSON.stringify(rows));
  const commentsHash = sha(JSON.stringify(db.prepare('SELECT id, card_id, content FROM card_comments ORDER BY id').all()));
  return { counts, cardsHash, commentsHash };
}

function readLegacyDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const walk = (current, prefix = '') =>
    fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('.')) return [];
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(path.join(current, entry.name), rel);
      if (!entry.name.endsWith('.md')) return [];
      return [{ path: rel, content: fs.readFileSync(path.join(current, entry.name), 'utf8') }];
    });
  return walk(dir).sort((a, b) => a.path.localeCompare(b.path));
}

function backup(db, version) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `product-os-pre-v${version}-${now().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return file;
}

function migrateToProjects(db, { log }) {
  const before = snapshot(db);
  const docs = readLegacyDir(LEGACY_DOCS_DIR);
  const rules = readLegacyDir(LEGACY_RULES_DIR);
  const hasData = before.counts.cards > 0;

  // Con cards existentes las reglas y docs son obligatorios: importar desde un
  // directorio ausente o vacío dejaría al proyecto sin su documentación.
  if (hasData && !rules?.length) {
    throw new Error(`Hay ${before.counts.cards} cards pero no se encuentran las reglas en ${LEGACY_RULES_DIR}. Monta el os/ del host antes de migrar.`);
  }
  if (hasData && docs === null) {
    throw new Error(`Hay ${before.counts.cards} cards pero no existe ${LEGACY_DOCS_DIR}. Monta el workspace/ del host antes de migrar.`);
  }
  const createLegacy = hasData || Boolean(docs?.length) || Boolean(rules?.length);

  db.exec(`
    CREATE TABLE projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color       TEXT NOT NULL DEFAULT '#FF8A6B',
      position    INTEGER NOT NULL DEFAULT 0,
      stacks      TEXT NOT NULL DEFAULT '[]',
      columns     TEXT NOT NULL DEFAULT '[]',
      design      TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    ALTER TABLE cards ADD COLUMN project_id TEXT REFERENCES projects(id);
    CREATE INDEX idx_cards_project_column ON cards(project_id, "column", position);

    CREATE TABLE documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL CHECK (kind IN ('doc', 'rule')),
      path        TEXT NOT NULL,
      content     TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      deleted_at  TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (project_id, kind, path)
    );

    CREATE TABLE document_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version       INTEGER NOT NULL,
      content       TEXT NOT NULL,
      author        TEXT NOT NULL,
      source        TEXT NOT NULL,
      note          TEXT,
      lines_added   INTEGER NOT NULL DEFAULT 0,
      lines_removed INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      UNIQUE (document_id, version)
    );
  `);

  if (!createLegacy) {
    log('Instalación nueva: sin proyecto heredado.');
    return { before, after: snapshot(db) };
  }

  // Los ficheros de diseño elegidos en la pestaña IA pasan a ser del proyecto.
  const setting = (key) => {
    const row = tableExists(db, 'settings') ? db.prepare('SELECT value FROM settings WHERE key = ?').get(key) : null;
    try {
      return row ? JSON.parse(row.value) : {};
    } catch {
      return {};
    }
  };
  const design = {};
  for (const tool of ['paper', 'moki']) {
    const saved = setting(tool);
    if (saved.fileId) design[tool] = { fileId: saved.fileId, fileName: saved.fileName || '' };
  }

  const timestamp = now();
  db.prepare(
    `INSERT INTO projects (id, name, color, position, stacks, columns, design, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    LEGACY_PROJECT.id, LEGACY_PROJECT.name, LEGACY_PROJECT.color,
    JSON.stringify(DEFAULT_STACKS), JSON.stringify(DEFAULT_COLUMNS), JSON.stringify(design),
    timestamp, timestamp
  );
  db.prepare('UPDATE cards SET project_id = ?').run(LEGACY_PROJECT.id);

  const insertDoc = db.prepare(
    `INSERT INTO documents (project_id, kind, path, content, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  );
  const insertVersion = db.prepare(
    `INSERT INTO document_versions (document_id, version, content, author, source, note, lines_added, created_at)
     VALUES (?, 1, ?, 'Importación', 'import', ?, ?, ?)`
  );
  const imported = [];
  for (const [kind, files, origin] of [['doc', docs || [], 'workspace/docs'], ['rule', rules || [], 'os']]) {
    for (const file of files) {
      const { lastInsertRowid } = insertDoc.run(LEGACY_PROJECT.id, kind, file.path, file.content, timestamp, timestamp);
      insertVersion.run(lastInsertRowid, file.content, `Importado de ${origin}/ (git)`, file.content.split('\n').length, timestamp);
      imported.push({ kind, path: file.path, hash: sha(file.content) });
    }
  }
  log(`Proyecto "${LEGACY_PROJECT.name}": ${before.counts.cards} cards, ${docs?.length || 0} docs y ${rules?.length || 0} reglas.`);

  // Verificación: lo importado coincide byte a byte con los ficheros.
  const stored = db.prepare('SELECT content FROM documents WHERE project_id = ? AND kind = ? AND path = ?');
  for (const doc of imported) {
    const row = stored.get(LEGACY_PROJECT.id, doc.kind, doc.path);
    if (!row || sha(row.content) !== doc.hash) throw new Error(`El ${doc.kind} ${doc.path} no se ha importado íntegro`);
  }
  const orphan = Number(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE project_id IS NULL').get().n);
  if (orphan) throw new Error(`${orphan} cards se han quedado sin proyecto`);

  return { before, after: snapshot(db), imported: imported.length };
}

// Tokens con los que los agentes del usuario (Claude Code, Codex, Cursor…) se
// conectan al MCP de Cardinal. Solo se guarda el hash; el token se muestra una vez.
function addMcpTokens(db) {
  const before = snapshot(db);
  db.exec(`
    CREATE TABLE mcp_tokens (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      prefix       TEXT NOT NULL,
      projects     TEXT NOT NULL DEFAULT '["*"]',
      access       TEXT NOT NULL CHECK (access IN ('read', 'write')),
      created_at   TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at   TEXT
    );
  `);
  return { before, after: snapshot(db) };
}

function verifyPreserved(before, after) {
  for (const [table, count] of Object.entries(before.counts)) {
    if (after.counts[table] !== count) throw new Error(`La tabla ${table} tenía ${count} filas y ahora ${after.counts[table]}`);
  }
  if (before.cardsHash !== after.cardsHash) throw new Error('El contenido de las cards ha cambiado durante la migración');
  if (before.commentsHash !== after.commentsHash) throw new Error('Los comentarios han cambiado durante la migración');
}

/**
 * Aplica las migraciones pendientes. dryRun: migra y verifica, pero revierte
 * (lo usa el despliegue para ensayar sobre una copia antes de cambiar de imagen).
 */
export function runMigrations(db, { dryRun = false, log = console.log } = {}) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version);
  const pending = MIGRATIONS.filter((migration) => migration.version > current);
  const report = { from: current, to: current, backups: [], steps: [] };
  if (!pending.length) return report;

  // En ensayo todas las pendientes van en una sola transacción que se revierte
  // al final; en real, cada una tiene su copia previa y su transacción.
  if (dryRun) db.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of pending) {
      if (!dryRun) report.backups.push(backup(db, migration.version));
      log(`Migración v${migration.version}: ${migration.name}${dryRun ? ' (ensayo)' : ''}`);
      if (!dryRun) db.exec('BEGIN IMMEDIATE');
      try {
        const result = migration.up(db, { log });
        verifyPreserved(result.before, result.after);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        if (!dryRun) db.exec('COMMIT');
        report.steps.push({ version: migration.version, counts: result.after.counts, imported: result.imported || 0 });
        report.to = migration.version;
      } catch (error) {
        if (!dryRun) db.exec('ROLLBACK');
        throw new Error(`Migración v${migration.version} revertida: ${error.message}`);
      }
    }
  } finally {
    if (dryRun) db.exec('ROLLBACK');
  }
  return report;
}
