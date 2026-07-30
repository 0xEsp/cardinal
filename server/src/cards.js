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
    position: row.position,
    stacks: stackRows.map((s) => ({ name: s.name, version: s.version })),
    draft: row.draft,
    definition: row.definition,
    documentationStatus: row.documentation_status,
    documentedAt: row.documented_at,
    commentCount: Number(row.comment_count || 0),
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
  const rows = db.prepare(`
    SELECT cards.*,
      (SELECT COUNT(*) FROM card_comments WHERE card_id = cards.id) AS comment_count
    FROM cards
    ORDER BY
      CASE "column"
        WHEN 'backlog' THEN 0
        WHEN 'todo' THEN 1
        WHEN 'in-progress' THEN 2
        WHEN 'done-dev' THEN 3
        WHEN 'done' THEN 4
      END,
      position ASC,
      created_at DESC
  `).all();
  return rows.map((r) => toCard(r, stacksOf(r.id)));
}

export function getCard(id) {
  const row = db.prepare(`
    SELECT cards.*,
      (SELECT COUNT(*) FROM card_comments WHERE card_id = cards.id) AS comment_count
    FROM cards
    WHERE id = ?
  `).get(id);
  if (!row) throw Object.assign(new Error(`Card ${id} no encontrada`), { status: 404 });
  return toCard(row, stacksOf(id));
}

export function createCard({ title }) {
  if (!title || !title.trim()) throw Object.assign(new Error('title requerido'), { status: 400 });
  const id = `${Date.now().toString(36)}-${slugify(title)}`;
  const now = new Date().toISOString();
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE "column" = ?').get('backlog').next;
  db.prepare('INSERT INTO cards (id, title, "column", position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    title.trim(),
    'backlog',
    position,
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
  const columnChanged = next.column !== card.column;
  const definitionChanged = next.definition !== card.definition;
  const position = columnChanged
    ? db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE "column" = ?').get(next.column).next
    : card.position;
  const documentationStatus = definitionChanged ? 'pending' : card.documentationStatus;
  const documentedAt = definitionChanged ? null : card.documentedAt;

  db.prepare(`
    UPDATE cards
    SET title = ?, "column" = ?, position = ?, draft = ?, definition = ?,
        documentation_status = ?, documented_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.title,
    next.column,
    position,
    next.draft,
    next.definition,
    documentationStatus,
    documentedAt,
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

export function moveCard(id, { column, beforeId = null }) {
  const card = getCard(id);
  if (!COLUMNS.includes(column)) {
    throw Object.assign(new Error(`columna inválida: ${column}`), { status: 400 });
  }

  const targetRows = db
    .prepare('SELECT id FROM cards WHERE "column" = ? AND id != ? ORDER BY position ASC, created_at DESC')
    .all(column, id);
  let insertAt = targetRows.length;
  if (beforeId !== null) {
    insertAt = targetRows.findIndex((row) => row.id === beforeId);
    if (insertAt < 0) {
      throw Object.assign(new Error('La card de referencia no pertenece a la columna de destino'), { status: 400 });
    }
  }
  const targetIds = targetRows.map((row) => row.id);
  targetIds.splice(insertAt, 0, id);
  const sourceColumn = card.column;
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE cards SET "column" = ?, updated_at = ? WHERE id = ?').run(column, now, id);
    const updatePosition = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
    targetIds.forEach((cardId, index) => updatePosition.run(index, cardId));
    if (sourceColumn !== column) normalizeColumn(sourceColumn);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getCard(id);
}

function normalizeColumn(column) {
  const rows = db
    .prepare('SELECT id FROM cards WHERE "column" = ? ORDER BY position ASC, created_at DESC')
    .all(column);
  const updatePosition = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  rows.forEach((row, index) => updatePosition.run(index, row.id));
}

export function markDocumented(id) {
  getCard(id);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE cards
    SET documentation_status = 'documented', documented_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
  return getCard(id);
}

export function listComments(cardId) {
  getCard(cardId);
  return db
    .prepare('SELECT id, content, created_at, updated_at FROM card_comments WHERE card_id = ? ORDER BY created_at ASC, id ASC')
    .all(cardId)
    .map(toComment);
}

export function createComment(cardId, { content }) {
  getCard(cardId);
  const clean = typeof content === 'string' ? content.trim() : '';
  if (!clean) throw Object.assign(new Error('El comentario no puede estar vacío'), { status: 400 });
  if (clean.length > 10000) throw Object.assign(new Error('El comentario es demasiado largo'), { status: 400 });
  const now = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO card_comments (card_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(cardId, clean, now, now);
  return toComment(
    db.prepare('SELECT id, content, created_at, updated_at FROM card_comments WHERE id = ?').get(result.lastInsertRowid)
  );
}

export function deleteComment(cardId, commentId) {
  getCard(cardId);
  const result = db.prepare('DELETE FROM card_comments WHERE id = ? AND card_id = ?').run(commentId, cardId);
  if (!result.changes) throw Object.assign(new Error('Comentario no encontrado'), { status: 404 });
}

function toComment(row) {
  return {
    id: Number(row.id),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteCard(id) {
  getCard(id); // 404 si no existe
  db.prepare('DELETE FROM cards WHERE id = ?').run(id); // cascade borra stacks y sesión
}
