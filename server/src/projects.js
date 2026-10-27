import { db } from './db.js';
import { DEFAULT_COLUMNS, DEFAULT_STACKS } from './migrate.js';

// Un proyecto agrupa cards, docs y reglas. Stacks y columnas son configurables
// por proyecto; cada columna decide qué agente se lanza en ella (mode):
// define · document · null (ninguno). La columna con archive=true es el
// archivo: no se muestra en el board.

const MODES = ['define', 'document', null];
const bad = (message) => Object.assign(new Error(message), { status: 400 });

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    position: row.position,
    stacks: parse(row.stacks, []),
    columns: parse(row.columns, []),
    design: parse(row.design, {}),
    cardCount: Number(row.card_count || 0),
    docCount: Number(row.doc_count || 0),
    ruleCount: Number(row.rule_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `
  SELECT projects.*,
    (SELECT COUNT(*) FROM cards WHERE project_id = projects.id) AS card_count,
    (SELECT COUNT(*) FROM documents WHERE project_id = projects.id AND kind = 'doc' AND deleted_at IS NULL) AS doc_count,
    (SELECT COUNT(*) FROM documents WHERE project_id = projects.id AND kind = 'rule' AND deleted_at IS NULL) AS rule_count
  FROM projects`;

export function listProjects() {
  return db.prepare(`${SELECT} ORDER BY position ASC, created_at ASC`).all().map(toProject);
}

export function getProject(id) {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(String(id || ''));
  if (!row) throw Object.assign(new Error(`Proyecto ${id} no encontrado`), { status: 404 });
  return toProject(row);
}

function cleanStacks(stacks) {
  if (!Array.isArray(stacks) || !stacks.length) throw bad('El proyecto necesita al menos un stack');
  const names = stacks.map((stack) => slugify(stack));
  if (names.some((name) => !name)) throw bad('Nombre de stack inválido');
  if (new Set(names).size !== names.length) throw bad('Hay stacks repetidos');
  return names;
}

function cleanColumns(columns) {
  if (!Array.isArray(columns) || columns.length < 2) throw bad('El board necesita al menos dos columnas');
  const clean = columns.map((column) => {
    const name = String(column?.name || '').trim();
    if (!name) throw bad('Cada columna necesita nombre');
    const mode = column.mode ?? null;
    if (!MODES.includes(mode)) throw bad(`Agente de columna inválido: ${mode}`);
    return { id: slugify(column.id || name), name, mode, ...(column.archive ? { archive: true } : {}) };
  });
  if (new Set(clean.map((column) => column.id)).size !== clean.length) throw bad('Hay columnas repetidas');
  if (clean.filter((column) => column.archive).length > 1) throw bad('Solo puede haber una columna de archivo');
  return clean;
}

/**
 * copyRulesFrom: id de un proyecto del que copiar las reglas (os/) como punto
 * de partida. Sin él, el proyecto empieza sin reglas.
 */
export function createProject({ id, name, description = '', color, stacks = DEFAULT_STACKS, columns = DEFAULT_COLUMNS, copyRulesFrom }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw bad('El proyecto necesita nombre');
  const projectId = slugify(id || cleanName);
  if (!projectId) throw bad('Identificador de proyecto inválido');
  if (db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw bad(`Ya existe un proyecto "${projectId}"`);
  if (copyRulesFrom) getProject(copyRulesFrom);

  const now = new Date().toISOString();
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM projects').get().next;
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO projects (id, name, description, color, position, stacks, columns, design, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
    ).run(projectId, cleanName, String(description), color || '#FF8A6B', position,
      JSON.stringify(cleanStacks(stacks)), JSON.stringify(cleanColumns(columns)), now, now);
    if (copyRulesFrom) {
      const rules = db.prepare("SELECT path, content FROM documents WHERE project_id = ? AND kind = 'rule' AND deleted_at IS NULL").all(copyRulesFrom);
      const insertDoc = db.prepare("INSERT INTO documents (project_id, kind, path, content, version, created_at, updated_at) VALUES (?, 'rule', ?, ?, 1, ?, ?)");
      const insertVersion = db.prepare(
        "INSERT INTO document_versions (document_id, version, content, author, source, note, lines_added, created_at) VALUES (?, 1, ?, 'Cardinal', 'ui', ?, ?, ?)"
      );
      for (const rule of rules) {
        const { lastInsertRowid } = insertDoc.run(projectId, rule.path, rule.content, now, now);
        insertVersion.run(lastInsertRowid, rule.content, `Copiada de ${copyRulesFrom}`, rule.content.split('\n').length, now);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getProject(projectId);
}

export function updateProject(id, patch) {
  const project = getProject(id);
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() : project.name,
    description: patch.description !== undefined ? String(patch.description) : project.description,
    color: patch.color || project.color,
    stacks: patch.stacks !== undefined ? cleanStacks(patch.stacks) : project.stacks,
    columns: patch.columns !== undefined ? cleanColumns(patch.columns) : project.columns,
    design: patch.design !== undefined ? { ...project.design, ...patch.design } : project.design,
  };
  if (!next.name) throw bad('El proyecto necesita nombre');
  // Una columna con cards no puede desaparecer: se perderían en el board.
  if (patch.columns !== undefined) {
    const kept = new Set(next.columns.map((column) => column.id));
    const used = db.prepare('SELECT DISTINCT "column" AS id FROM cards WHERE project_id = ?').all(id);
    const lost = used.filter((column) => !kept.has(column.id)).map((column) => column.id);
    if (lost.length) throw bad(`Mueve antes las cards de: ${lost.join(', ')}`);
  }
  db.prepare(
    `UPDATE projects SET name = ?, description = ?, color = ?, stacks = ?, columns = ?, design = ?, updated_at = ? WHERE id = ?`
  ).run(next.name, next.description, next.color, JSON.stringify(next.stacks), JSON.stringify(next.columns),
    JSON.stringify(next.design), new Date().toISOString(), id);
  return getProject(id);
}

export function deleteProject(id) {
  const project = getProject(id);
  if (project.cardCount) throw bad(`El proyecto tiene ${project.cardCount} cards: bórralas o muévelas antes`);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id); // cascade: docs y reglas
}

export function columnOf(project, columnId) {
  return project.columns.find((column) => column.id === columnId) || null;
}

/** Columna de entrada de las cards nuevas: la primera que no es archivo. */
export function firstColumn(project) {
  return (project.columns.find((column) => !column.archive) || project.columns[0]).id;
}
