import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { SECRETS_DIR } from './paths.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value));
}

// Los secretos van a ficheros 0600 fuera de la SQLite para que un volcado de la
// base de datos o de la API nunca los incluya.
fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });

function secretFile(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Nombre de secreto inválido: ${name}`);
  return path.join(SECRETS_DIR, name);
}

export function getSecret(name, envFallback) {
  const file = secretFile(name);
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) return value;
  }
  return envFallback ? process.env[envFallback] || null : null;
}

export function setSecret(name, value) {
  const clean = String(value || '').trim();
  if (!clean) throw Object.assign(new Error('El valor no puede estar vacío'), { status: 400 });
  fs.writeFileSync(secretFile(name), `${clean}\n`, { mode: 0o600 });
}

export function deleteSecret(name) {
  fs.rmSync(secretFile(name), { force: true });
}

export function secretSource(name, envFallback) {
  if (fs.existsSync(secretFile(name))) return 'ui';
  if (envFallback && process.env[envFallback]) return 'env';
  return null;
}
