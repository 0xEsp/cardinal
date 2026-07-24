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
    draft      TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
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
`);

export function getSessionData(cardId) {
  const row = db.prepare('SELECT data FROM agent_sessions WHERE card_id = ?').get(cardId);
  return row ? JSON.parse(row.data) : null;
}

export function saveSessionData(cardId, data) {
  db.prepare(
    'INSERT INTO agent_sessions (card_id, data) VALUES (?, ?) ON CONFLICT(card_id) DO UPDATE SET data = excluded.data'
  ).run(cardId, JSON.stringify(data));
}
