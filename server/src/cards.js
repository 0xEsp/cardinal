import { db } from './db.js';

export const COLUMNS = ['backlog', 'todo', 'in-progress', 'done-dev', 'done'];
export const STACKS = ['app', 'web', 'backend'];

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'card';
}

function toCard(row, stackRows) {
  return {
    id: row.id,
    title: row.title,
    column: row.column,
    stacks: stackRows.map((s) => ({ name: s.name, version: s.version })),
    draft: row.draft,
    definition: row.definition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stacksOf(cardId) {
  return db.prepare('SELECT name, version FROM card_stacks WHERE card_id = ? ORDER BY name').all(cardId);
}

function validateStacks(stacks) {
  if (!Array.isArray(stacks)) throw Object.assign(new Error('stacks debe ser un array'), { status: 400 });
  for (const s of stacks) {
    if (!STACKS.includes(s.name)) throw Object.assign(new Error(`stack inválido: ${s.name}`), { status: 400 });
  }
}

export function listCards() {
  const rows = db.prepare('SELECT * FROM cards ORDER BY created_at DESC').all();
  return rows.map((r) => toCard(r, stacksOf(r.id)));
}

export function getCard(id) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error(`Card ${id} no encontrada`), { status: 404 });
  return toCard(row, stacksOf(id));
}

export function createCard({ title }) {
  if (!title || !title.trim()) throw Object.assign(new Error('title requerido'), { status: 400 });
  const id = `${Date.now().toString(36)}-${slugify(title)}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO cards (id, title, "column", created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    title.trim(),
    'backlog',
    now,
    now
  );
  return getCard(id);
}

export function updateCard(id, patch) {
  const card = getCard(id);
  if (patch.column !== undefined && !COLUMNS.includes(patch.column)) {
    throw Object.assign(new Error(`columna inválida: ${patch.column}`), { status: 400 });
  }
  if (patch.stacks !== undefined) validateStacks(patch.stacks);

  const next = {
    title: patch.title ?? card.title,
    column: patch.column ?? card.column,
    draft: patch.draft ?? card.draft,
    definition: patch.definition ?? card.definition,
  };
  db.prepare('UPDATE cards SET title = ?, "column" = ?, draft = ?, definition = ?, updated_at = ? WHERE id = ?').run(
    next.title,
    next.column,
    next.draft,
    next.definition,
    new Date().toISOString(),
    id
  );

  if (patch.stacks !== undefined) {
    db.prepare('DELETE FROM card_stacks WHERE card_id = ?').run(id);
    const ins = db.prepare('INSERT INTO card_stacks (card_id, name, version) VALUES (?, ?, ?)');
    for (const s of patch.stacks) ins.run(id, s.name, s.version || null);
  }
  return getCard(id);
}

export function saveDefinition(id, definition) {
  return updateCard(id, { definition });
}

export function deleteCard(id) {
  getCard(id); // 404 si no existe
  db.prepare('DELETE FROM cards WHERE id = ?').run(id); // cascade borra stacks y sesión
}
