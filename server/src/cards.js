import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { CARDS_DIR } from './paths.js';

export const COLUMNS = ['backlog', 'todo', 'in-progress', 'done-dev', 'done'];

const DEFINITION_MARKER = '<!-- DEFINITION -->';

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'card';
}

function cardFile(id) {
  const file = path.join(CARDS_DIR, `${id}.md`);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`Card ${id} no encontrada`), { status: 404 });
  return file;
}

function parseCard(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  const idx = content.indexOf(DEFINITION_MARKER);
  const draft = (idx === -1 ? content : content.slice(0, idx)).trim();
  const definition = idx === -1 ? '' : content.slice(idx + DEFINITION_MARKER.length).trim();
  return {
    id: path.basename(file, '.md'),
    title: data.title || path.basename(file, '.md'),
    column: COLUMNS.includes(data.column) ? data.column : 'backlog',
    stack: Array.isArray(data.stack) ? data.stack : [],
    version: data.version ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    draft,
    definition,
  };
}

function writeCard(file, card) {
  const front = {
    title: card.title,
    column: card.column,
    stack: card.stack,
    version: card.version,
    createdAt: card.createdAt,
    updatedAt: new Date().toISOString(),
  };
  let body = `${card.draft.trim()}\n`;
  if (card.definition && card.definition.trim()) {
    body += `\n${DEFINITION_MARKER}\n\n${card.definition.trim()}\n`;
  }
  fs.writeFileSync(file, matter.stringify(body, front));
}

export function listCards() {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  return fs
    .readdirSync(CARDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseCard(path.join(CARDS_DIR, f)))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function getCard(id) {
  return parseCard(cardFile(id));
}

export function createCard({ title }) {
  if (!title || !title.trim()) throw Object.assign(new Error('title requerido'), { status: 400 });
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  const id = `${Date.now().toString(36)}-${slugify(title)}`;
  const file = path.join(CARDS_DIR, `${id}.md`);
  const now = new Date().toISOString();
  writeCard(file, {
    title: title.trim(),
    column: 'backlog',
    stack: [],
    version: null,
    createdAt: now,
    draft: '',
    definition: '',
  });
  return parseCard(file);
}

export function updateCard(id, patch) {
  const file = cardFile(id);
  const card = parseCard(file);
  if (patch.column !== undefined && !COLUMNS.includes(patch.column)) {
    throw Object.assign(new Error(`columna inválida: ${patch.column}`), { status: 400 });
  }
  const updated = {
    ...card,
    ...['title', 'column', 'stack', 'version', 'draft', 'definition'].reduce((acc, k) => {
      if (patch[k] !== undefined) acc[k] = patch[k];
      return acc;
    }, {}),
  };
  writeCard(file, updated);
  return parseCard(file);
}

export function saveDefinition(id, definition) {
  return updateCard(id, { definition });
}

export function deleteCard(id) {
  fs.unlinkSync(cardFile(id));
}
