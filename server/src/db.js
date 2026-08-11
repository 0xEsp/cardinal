import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './paths.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'product-os.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS cards (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    "column"   TEXT NOT NULL DEFAULT 'backlog',
    position   INTEGER NOT NULL DEFAULT 0,
    draft      TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    documentation_status TEXT NOT NULL DEFAULT 'pending',
    documented_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_stacks (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    version TEXT,
    PRIMARY KEY (card_id, name)
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    data    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_card_comments_card_created
    ON card_comments(card_id, created_at);

  CREATE TABLE IF NOT EXISTS agent_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id         TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    mode            TEXT NOT NULL,
    model           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    context_revision TEXT,
    docs_read       TEXT NOT NULL DEFAULT '[]',
    docs_searched   TEXT NOT NULL DEFAULT '[]',
    files_written   TEXT NOT NULL DEFAULT '[]',
    validation      TEXT NOT NULL DEFAULT '{}',
    review          TEXT NOT NULL DEFAULT '{}',
    tool_rounds     INTEGER NOT NULL DEFAULT 0,
    review_count    INTEGER NOT NULL DEFAULT 0,
    error           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_agent_runs_card_started
    ON agent_runs(card_id, started_at DESC);
`);

// Migraciones incrementales para bases creadas por versiones anteriores.
const cardColumns = new Set(db.prepare('PRAGMA table_info(cards)').all().map((column) => column.name));
const addedPosition = !cardColumns.has('position');
if (addedPosition) db.exec('ALTER TABLE cards ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
if (!cardColumns.has('documentation_status')) {
  db.exec("ALTER TABLE cards ADD COLUMN documentation_status TEXT NOT NULL DEFAULT 'pending'");
}
if (!cardColumns.has('documented_at')) db.exec('ALTER TABLE cards ADD COLUMN documented_at TEXT');

if (addedPosition) {
  const columns = db.prepare('SELECT DISTINCT "column" AS name FROM cards').all();
  const updatePosition = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  for (const { name } of columns) {
    const rows = db
      .prepare('SELECT id FROM cards WHERE "column" = ? ORDER BY created_at DESC')
      .all(name);
    rows.forEach((row, index) => updatePosition.run(index, row.id));
  }
}

export function getSessionData(cardId) {
  const row = db.prepare('SELECT data FROM agent_sessions WHERE card_id = ?').get(cardId);
  return row ? JSON.parse(row.data) : null;
}

export function saveSessionData(cardId, data) {
  db.prepare(
    'INSERT INTO agent_sessions (card_id, data) VALUES (?, ?) ON CONFLICT(card_id) DO UPDATE SET data = excluded.data'
  ).run(cardId, JSON.stringify(data));
}

export function createAgentRun({ cardId, mode, model, contextRevision }) {
  const startedAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO agent_runs (card_id, mode, model, status, started_at, context_revision)
       VALUES (?, ?, ?, 'running', ?, ?)`
    )
    .run(cardId, mode, model, startedAt, contextRevision || null);
  return { id: Number(result.lastInsertRowid), startedAt };
}

export function finishAgentRun(id, data) {
  if (!id) return;
  db.prepare(
    `UPDATE agent_runs
     SET status = ?, finished_at = ?, docs_read = ?, docs_searched = ?, files_written = ?,
         validation = ?, review = ?, tool_rounds = ?, review_count = ?, error = ?
     WHERE id = ?`
  ).run(
    data.status,
    data.finishedAt || new Date().toISOString(),
    JSON.stringify(data.docsRead || []),
    JSON.stringify(data.docsSearched || []),
    JSON.stringify(data.filesWritten || []),
    JSON.stringify(data.validation || {}),
    JSON.stringify(data.review || {}),
    Number(data.toolRounds || 0),
    Number(data.reviewCount || 0),
    data.error || null,
    id
  );
}

export function listAgentRuns(cardId, limit = 20) {
  const rows = db
    .prepare(
      `SELECT id, card_id, mode, model, status, started_at, finished_at, context_revision,
              docs_read, docs_searched, files_written, validation, review,
              tool_rounds, review_count, error
       FROM agent_runs
       WHERE card_id = ?
       ORDER BY started_at DESC, id DESC
       LIMIT ?`
    )
    .all(cardId, Math.min(Math.max(Number(limit) || 20, 1), 100));
  return rows.map((row) => ({
    id: Number(row.id),
    cardId: row.card_id,
    mode: row.mode,
    model: row.model,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    contextRevision: row.context_revision,
    docsRead: parseJson(row.docs_read, []),
    docsSearched: parseJson(row.docs_searched, []),
    filesWritten: parseJson(row.files_written, []),
    validation: parseJson(row.validation, {}),
    review: parseJson(row.review, {}),
    toolRounds: row.tool_rounds,
    reviewCount: row.review_count,
    error: row.error,
  }));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
