import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import * as cards from './cards.js';
import * as docs from './docs.js';
import { getProject, listProjects } from './projects.js';
import { buildFeaturePrompt } from './prompt.js';
import { handleRpc } from './mcp.js';

// MCP de Cardinal para los agentes del usuario (Claude Code, Codex, Cursor…):
// leen y escriben cards, docs y reglas sin clonar ningún repositorio. Cada
// token limita los proyectos que ve y si puede escribir. A diferencia del canal
// interno (mcp.js) es accesible desde la red local, siempre con Bearer.

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const bad = (message) => Object.assign(new Error(message), { status: 400 });

// ---- tokens ----

function toToken(row) {
  return {
    id: Number(row.id),
    name: row.name,
    prefix: row.prefix,
    projects: JSON.parse(row.projects),
    access: row.access,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function listTokens() {
  return db.prepare('SELECT * FROM mcp_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC').all().map(toToken);
}

/** Devuelve el token en claro una sola vez: después solo se guarda su hash. */
export function createToken({ name, projects = ['*'], access = 'read' }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw bad('El token necesita un nombre (p. ej. "MacBook · Claude Code")');
  if (!['read', 'write'].includes(access)) throw bad('Permiso inválido');
  if (!Array.isArray(projects) || !projects.length) throw bad('Elige al menos un proyecto');
  if (!projects.includes('*')) projects.forEach((id) => getProject(id));
  const token = `crd_${crypto.randomBytes(24).toString('hex')}`;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO mcp_tokens (name, token_hash, prefix, projects, access, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cleanName, sha(token), token.slice(-4), JSON.stringify(projects.includes('*') ? ['*'] : projects), access, new Date().toISOString());
  return { ...toToken(db.prepare('SELECT * FROM mcp_tokens WHERE id = ?').get(lastInsertRowid)), token };
}

export function revokeToken(id) {
  const result = db.prepare('UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(new Date().toISOString(), Number(id));
  if (!result.changes) throw Object.assign(new Error('Token no encontrado'), { status: 404 });
}

function authenticate(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (!match) return null;
  const row = db.prepare('SELECT * FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(sha(match[1]));
  if (!row) return null;
  db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return toToken(row);
}

// ---- herramientas ----

const str = (description) => ({ type: 'string', description });
const PROJECT = str('Id del proyecto (ver list_projects), p. ej. "gotty"');
const CARD = str('Id de la card (ver list_cards)');

// write: requiere token de escritura. Cada handler recibe (args, ctx) y
// devuelve un objeto serializable o texto.
const TOOLS = [
  {
    name: 'list_projects',
    description: 'Lista los proyectos accesibles con sus stacks y columnas del board.',
    input: {},
    run: (_, ctx) => listProjects().filter((project) => ctx.canSee(project.id))
      .map(({ id, name, description, stacks, columns, cardCount, docCount, ruleCount }) => ({ id, name, description, stacks, columns, cardCount, docCount, ruleCount })),
  },
  {
    name: 'list_cards',
    description: 'Lista las cards de un proyecto (sin el contenido largo). Filtra por columna o por texto en el título.',
    input: { project: PROJECT, column: str('Id de columna (opcional)'), query: str('Texto a buscar en el título (opcional)') },
    required: ['project'],
    run: ({ project, column, query }, ctx) => {
      ctx.checkProject(project);
      const q = String(query || '').toLowerCase();
      return cards.listCards(project)
        .filter((card) => (!column || card.column === column) && (!q || card.title.toLowerCase().includes(q)))
        .map(({ id, title, column: col, stacks, documentationStatus, designStatus, commentCount, updatedAt, definition }) => ({
          id, title, column: col, stacks, hasDefinition: Boolean(definition), documentationStatus, designStatus, commentCount, updatedAt,
        }));
    },
  },
  {
    name: 'get_card',
    description: 'Lee una card completa: borrador, Definición IA, diseño y comentarios.',
    input: { card_id: CARD },
    required: ['card_id'],
    run: ({ card_id }, ctx) => {
      const card = ctx.card(card_id);
      return { ...card, comments: cards.listComments(card.id) };
    },
  },
  {
    name: 'create_card',
    description: 'Crea una card en un proyecto. Por defecto entra en la primera columna del board.',
    input: {
      project: PROJECT,
      title: str('Título corto de la card'),
      draft: str('Borrador en markdown: la idea con las palabras del usuario (opcional)'),
      column: str('Id de columna (opcional)'),
      stacks: { type: 'array', items: { type: 'object', properties: { name: str('Stack del proyecto'), version: str('Versión (opcional)') }, required: ['name'] } },
    },
    required: ['project', 'title'],
    write: true,
    run: ({ project, title, draft, column, stacks }, ctx) => {
      ctx.checkProject(project);
      return cards.createCard({ projectId: project, title, draft, column, stacks });
    },
  },
  {
    name: 'update_card',
    description: 'Actualiza título, borrador, stacks o Definición IA de una card. Cambiar la definición deja la documentación como pendiente.',
    input: {
      card_id: CARD,
      title: str('Nuevo título'),
      draft: str('Borrador completo (sustituye al anterior)'),
      definition: str('Definición IA completa en markdown (sustituye a la anterior)'),
      stacks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' } }, required: ['name'] } },
    },
    required: ['card_id'],
    write: true,
    run: ({ card_id, title, draft, definition, stacks }, ctx) => {
      ctx.card(card_id);
      return cards.updateCard(card_id, { title, draft, definition, stacks });
    },
  },
  {
    name: 'move_card',
    description: 'Mueve una card a otra columna (al final, o antes de otra card).',
    input: { card_id: CARD, column: str('Id de la columna de destino'), before_id: str('Card delante de la que colocarla (opcional)') },
    required: ['card_id', 'column'],
    write: true,
    run: ({ card_id, column, before_id }, ctx) => {
      ctx.card(card_id);
      return cards.moveCard(card_id, { column, beforeId: before_id || null });
    },
  },
  {
    name: 'comment_card',
    description: 'Añade un comentario (nota privada) a una card.',
    input: { card_id: CARD, content: str('Texto del comentario') },
    required: ['card_id', 'content'],
    write: true,
    run: ({ card_id, content }, ctx) => {
      ctx.card(card_id);
      return cards.createComment(card_id, { content: `[${ctx.author}] ${content}` });
    },
  },
  {
    name: 'get_feature_prompt',
    description: 'Prompt listo para implementar una card: su definición envuelta en la plantilla del proyecto, con el diseño si lo tiene.',
    input: { card_id: CARD },
    required: ['card_id'],
    run: ({ card_id }, ctx) => buildFeaturePrompt(ctx.card(card_id)),
  },
  {
    name: 'list_docs',
    description: 'Lista los documentos de producto de un proyecto.',
    input: { project: PROJECT },
    required: ['project'],
    run: ({ project }, ctx) => (ctx.checkProject(project), docs.listDocs(project)),
  },
  {
    name: 'search_docs',
    description: 'Busca términos en el contenido de los docs de un proyecto y devuelve fragmentos para decidir cuáles leer.',
    input: { project: PROJECT, query: str('Términos a buscar'), limit: { type: 'integer', minimum: 1, maximum: 20 } },
    required: ['project', 'query'],
    run: ({ project, query, limit }, ctx) => (ctx.checkProject(project), docs.searchDocs(project, query, limit)),
  },
  {
    name: 'read_doc',
    description: 'Lee un documento de producto completo.',
    input: { project: PROJECT, path: str('Ruta del doc, p. ej. "news.md"') },
    required: ['project', 'path'],
    run: ({ project, path }, ctx) => (ctx.checkProject(project), docs.readDoc(project, path)),
  },
  {
    name: 'write_doc',
    description: 'Crea o sustituye un documento de producto. Léelo antes con read_doc y envía el contenido completo. Queda versionado con tu token como autor.',
    input: { project: PROJECT, path: str('Ruta del .md'), content: str('Contenido completo en markdown'), note: str('Qué cambia y por qué (opcional)') },
    required: ['project', 'path', 'content'],
    write: true,
    run: ({ project, path, content, note }, ctx) => (ctx.checkProject(project), docs.saveDoc(project, path, content, { author: ctx.author, source: 'mcp', note: note || null })),
  },
  {
    name: 'doc_history',
    description: 'Historial de versiones de un doc (o de una regla con kind="rule"): quién lo cambió, cuándo y cuántas líneas.',
    input: { project: PROJECT, path: str('Ruta del .md'), kind: { type: 'string', enum: ['doc', 'rule'] } },
    required: ['project', 'path'],
    run: ({ project, path, kind = 'doc' }, ctx) => (ctx.checkProject(project), docs.docHistory(project, path, kind)),
  },
  {
    name: 'list_rules',
    description: 'Lista las reglas del harness del proyecto: cómo se define una card, criterios de QA, guías de diseño y documentación…',
    input: { project: PROJECT },
    required: ['project'],
    run: ({ project }, ctx) => (ctx.checkProject(project), docs.listDocs(project, 'rule')),
  },
  {
    name: 'read_rule',
    description: 'Lee una regla del proyecto, p. ej. "card-definition.md" o "qa-criteria-backend.md".',
    input: { project: PROJECT, name: str('Nombre de la regla') },
    required: ['project', 'name'],
    run: ({ project, name }, ctx) => (ctx.checkProject(project), docs.readDoc(project, name, 'rule')),
  },
  {
    name: 'update_rule',
    description: 'Crea o sustituye una regla del proyecto. Afecta a todos los agentes de Cardinal de ese proyecto: envía el contenido completo y explica el cambio en note.',
    input: { project: PROJECT, name: str('Nombre de la regla (.md)'), content: str('Contenido completo'), note: str('Qué cambia y por qué') },
    required: ['project', 'name', 'content'],
    write: true,
    run: ({ project, name, content, note }, ctx) => (ctx.checkProject(project), docs.saveDoc(project, name, content, { kind: 'rule', author: ctx.author, source: 'mcp', note: note || null })),
  },
];

const INFO = {
  serverInfo: { name: 'cardinal', version: '2.0.0' },
  instructions:
    'Cardinal gestiona el producto de varios proyectos: un board de cards (borrador → Definición IA → diseño → documentación), ' +
    'los docs de producto (cómo funciona hoy cada flujo) y las reglas con las que trabajan sus agentes. Empieza con list_projects. ' +
    'Antes de implementar una card, léela con get_card o get_feature_prompt; antes de escribir un doc, léelo y conserva lo que no cambias.',
};

function channelFor(token) {
  const all = token.projects.includes('*');
  const canSee = (projectId) => all || token.projects.includes(projectId);
  const ctx = {
    author: `MCP · ${token.name}`,
    canSee,
    checkProject(projectId) {
      getProject(projectId);
      if (!canSee(projectId)) throw Object.assign(new Error(`El token no tiene acceso al proyecto ${projectId}`), { status: 403 });
    },
    card(cardId) {
      const card = cards.getCard(String(cardId || ''));
      ctx.checkProject(card.projectId);
      return card;
    },
  };
  const available = TOOLS.filter((tool) => !tool.write || token.access === 'write');
  return {
    info: INFO,
    tools: available.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { type: 'object', properties: tool.input, ...(tool.required ? { required: tool.required } : {}) },
      annotations: { readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: !tool.write, openWorldHint: false },
    })),
    async call(name, args) {
      const tool = available.find((item) => item.name === name);
      const result = await tool.run(args || {}, ctx);
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    },
  };
}

export function agentsMcpRouter() {
  const router = express.Router();
  router.all('/mcp', async (req, res) => {
    const token = authenticate(req);
    if (!token) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Token de Cardinal ausente o revocado' } });
    }
    if (req.method === 'DELETE') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
    const channel = channelFor(token);
    const batch = Array.isArray(req.body);
    const messages = batch ? req.body : [req.body];
    const replies = (await Promise.all(messages.map((message) => handleRpc(channel, message)))).filter(Boolean);
    if (!replies.length) return res.status(202).end();
    res.json(batch ? replies : replies[0]);
  });
  return router;
}
