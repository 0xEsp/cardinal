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
