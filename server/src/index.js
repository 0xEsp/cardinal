import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT } from './paths.js';
import * as cards from './cards.js';
import * as projects from './projects.js';
import { buildFeaturePrompt } from './prompt.js';
import * as docs from './docs.js';
import * as agent from './agent.js';
import { mcpRouter } from './mcp.js';
import { listProjectRuns } from './db.js';
import { agentsMcpRouter, createToken, listTokens, revokeToken } from './mcp-agents.js';
import { PROVIDERS, defaults, getProvider, providerStatuses, saveDefaults, scheduleCliUpdates } from './providers/index.js';
import { installCli } from './providers/cli.js';
import { deletePaperToken, listPaperFiles, paperStatus, savePaperConfig } from './paper.js';
import { deleteMokiToken, listMokiFiles, mokiStatus, saveMokiConfig } from './moki.js';
import { designToolsStatus, saveDefaultDesignTool } from './design-tools.js';

// Carga .env sin dependencia extra
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const app = express();
app.use(express.json({ limit: '5mb' }));
// Herramientas del harness para los CLIs (solo accesible desde el contenedor).
app.use(mcpRouter());
// MCP para los agentes del usuario, con token (accesible desde la red local).
app.use(agentsMcpRouter());

const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

// ---- config ----
app.get('/api/config', wrap(async () => ({
  providers: (await providerStatuses()).map(({ id, label, kind, ready, message, defaultModel }) => ({ id, label, kind, ready, message, defaultModel })),
  designTools: await designToolsStatus(),
  defaults: defaults(),
  projects: projects.listProjects(),
})));

// ---- tokens del MCP de agentes ----
// El token en claro solo se devuelve al crearlo.
app.get('/api/mcp-tokens', wrap(() => listTokens()));
app.post('/api/mcp-tokens', wrap((req) => createToken(req.body || {})));
app.delete('/api/mcp-tokens/:id', wrap((req) => {
  revokeToken(req.params.id);
  return { ok: true };
}));

// ---- proyectos ----
app.get('/api/projects', wrap(() => projects.listProjects()));
app.post('/api/projects', wrap((req) => projects.createProject(req.body || {})));
app.get('/api/projects/:pid', wrap((req) => projects.getProject(req.params.pid)));
app.put('/api/projects/:pid', wrap((req) => projects.updateProject(req.params.pid, req.body || {})));
app.delete('/api/projects/:pid', wrap((req) => {
  projects.deleteProject(req.params.pid);
  return { ok: true };
}));
// Estado de Paper/Moki con el fichero de diseño del proyecto.
app.get('/api/projects/:pid/design-tools', wrap((req) => designToolsStatus(projects.getProject(req.params.pid))));
app.get('/api/projects/:pid/cards', wrap((req) => cards.listCards(req.params.pid).map((card) => ({ ...card, agent: agent.agentState(card.id) }))));
app.get('/api/projects/:pid/agent-runs', wrap((req) => {
  projects.getProject(req.params.pid);
  return listProjectRuns(req.params.pid, req.query.limit);
}));
app.post('/api/projects/:pid/cards', wrap((req) => cards.createCard({ ...req.body, projectId: req.params.pid })));

// ---- proveedores de IA ----
// Las credenciales nunca se devuelven al cliente: solo si están configuradas.
app.get('/api/providers', wrap(async () => ({ providers: await providerStatuses(), defaults: defaults() })));
app.put('/api/providers/defaults', wrap((req) => saveDefaults(req.body || {})));
app.get('/api/providers/:id/models', wrap(async (req) => {
  const models = await getProvider(req.params.id).listModels({ refresh: req.query.refresh === '1' });
  return { models };
}));
app.post('/api/providers/:id/install', wrap((req) => {
  const provider = getProvider(req.params.id);
  if (provider.kind !== 'cli') throw Object.assign(new Error('Este proveedor no usa CLI'), { status: 400 });
  const { running, error } = installCli(provider.id);
  return { running, error };
}));
app.post('/api/providers/:id/verify', wrap(async (req) => {
  const provider = getProvider(req.params.id);
  const model = String(req.body?.model || '').trim() || provider.defaultModel;
  const answer = await provider.complete({ model, effort: '', system: 'Responde únicamente con la palabra OK.', user: 'ping', signal: AbortSignal.timeout(120000) });
  return { ok: true, model, answer: String(answer || '').trim().slice(0, 200) };
}));
app.delete('/api/providers/:id/credentials', wrap(async (req) => {
  await getProvider(req.params.id).logout();
  return { ok: true };
}));
app.put('/api/providers/openrouter/credentials', wrap((req) => {
  PROVIDERS.openrouter.saveKey(req.body?.apiKey);
  return { ok: true };
}));
app.put('/api/providers/claude/credentials', wrap((req) => {
  PROVIDERS.claude.saveToken(req.body?.token);
  return { ok: true };
}));
app.put('/api/providers/codex/credentials', wrap((req) => {
  PROVIDERS.codex.saveAuthJson(req.body?.authJson);
  return { ok: true };
}));
// ---- Paper (diseño) ----
// El puente corre en el Mac (scripts/paper-bridge/). El token nunca se devuelve.
app.get('/api/paper', wrap(() => paperStatus()));
app.put('/api/paper', wrap(async (req) => {
  savePaperConfig(req.body || {});
  return paperStatus();
}));
app.delete('/api/paper/token', wrap(() => {
  deletePaperToken();
  return { ok: true };
}));
app.get('/api/paper/files', wrap(async () => ({ files: await listPaperFiles() })));

// ---- Moki (diseño) ----
// Servidor propio en la red local con MCP por HTTP: sin puente. El token nunca se devuelve.
app.get('/api/moki', wrap(() => mokiStatus()));
app.put('/api/moki', wrap(async (req) => {
  saveMokiConfig(req.body || {});
  return mokiStatus();
}));
app.delete('/api/moki/token', wrap(() => {
  deleteMokiToken();
  return { ok: true };
}));
app.get('/api/moki/files', wrap(async () => ({ files: await listMokiFiles() })));

// Herramienta de diseño por defecto para las cards nuevas (paper | moki).
app.put('/api/design-tools/default', wrap(async (req) => {
  saveDefaultDesignTool(req.body?.tool);
  return designToolsStatus();
}));

app.post('/api/providers/codex/device-login', wrap(() => {
  const { url, code, status, error } = PROVIDERS.codex.startDeviceLogin();
  return { url, code, status, error };
}));
app.delete('/api/providers/codex/device-login', wrap(() => {
  PROVIDERS.codex.cancelDeviceLogin();
  return { ok: true };
}));

// ---- cards ----
app.get('/api/cards/:id', wrap((req) => cards.getCard(req.params.id)));
app.get('/api/cards/:id/prompt', wrap((req) => ({ prompt: buildFeaturePrompt(cards.getCard(req.params.id)) })));
app.put('/api/cards/:id', wrap((req) => cards.updateCard(req.params.id, req.body)));
app.post('/api/cards/:id/move', wrap((req) => cards.moveCard(req.params.id, req.body)));
app.get('/api/cards/:id/comments', wrap((req) => cards.listComments(req.params.id)));
app.post('/api/cards/:id/comments', wrap((req) => cards.createComment(req.params.id, req.body)));
app.delete('/api/cards/:id/comments/:commentId', wrap((req) => {
  cards.deleteComment(req.params.id, req.params.commentId);
  return { ok: true };
}));
app.delete('/api/cards/:id', wrap((req) => {
  agent.stopAllAgents(req.params.id);
  cards.deleteCard(req.params.id);
  return { ok: true };
}));

// ---- docs y reglas ----
// /api/projects/:pid/docs/… y /api/projects/:pid/rules/… comparten rutas; las
// reglas son lo que antes era os/.
const KIND = { docs: 'doc', rules: 'rule' };
const kindOf = (req) => {
  const kind = KIND[req.params.kind];
  if (!kind) throw Object.assign(new Error('Ruta desconocida'), { status: 404 });
  projects.getProject(req.params.pid);
  return kind;
};
const UI_AUTHOR = { author: 'Manu', source: 'ui' };

app.get('/api/projects/:pid/:kind', wrap((req) => docs.listDocs(req.params.pid, kindOf(req))));
app.get('/api/projects/:pid/:kind/content', wrap((req) => {
  const kind = kindOf(req);
  return { path: req.query.path, content: docs.readDoc(req.params.pid, req.query.path, kind) };
}));
app.put('/api/projects/:pid/:kind/content', wrap((req) => {
  const kind = kindOf(req);
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const saved = docs.saveDoc(req.params.pid, req.body?.path, content, { kind, ...UI_AUTHOR });
  return { ...saved, content: docs.readDoc(req.params.pid, saved.path, kind) };
}));
app.delete('/api/projects/:pid/:kind/content', wrap((req) => {
  docs.deleteDoc(req.params.pid, req.query.path, { kind: kindOf(req), ...UI_AUTHOR });
  return { ok: true };
}));
app.get('/api/projects/:pid/:kind/history', wrap((req) => docs.docHistory(req.params.pid, req.query.path, kindOf(req))));
app.get('/api/projects/:pid/:kind/version', wrap((req) => {
  const kind = kindOf(req);
  return { path: req.query.path, version: Number(req.query.v), content: docs.readVersion(req.params.pid, req.query.path, req.query.v, kind) };
}));
app.post('/api/projects/:pid/:kind/restore', wrap((req) => {
  const kind = kindOf(req);
  return docs.restoreVersion(req.params.pid, req.body?.path, req.body?.version, { kind, ...UI_AUTHOR });
}));

// ---- agent ----

// slot: "main" (definición/documentación) o "design" (Paper o Moki). task solo en
// design: design | comments | promote. designTool (paper | moki) solo cuenta si la
// card aún no tiene diseño; si no, se usa el de Ajustes.
const slotOf = (req) => String(req.query.slot || req.body?.slot || 'main');

app.post('/api/agent/:cardId/start', wrap((req) => agent.startAgent(req.params.cardId, {
  slot: slotOf(req),
  task: req.body?.task,
  designTool: req.body?.designTool,
  provider: req.body?.provider,
  model: req.body?.model,
  effort: req.body?.effort,
})));
app.post('/api/agent/:cardId/stop', wrap((req) => agent.stopAgent(req.params.cardId, slotOf(req))));
app.post('/api/agent/:cardId/message', wrap((req) => {
  agent.sendMessage(req.params.cardId, req.body.content, { slot: slotOf(req) });
  return { ok: true };
}));
app.get('/api/agent/:cardId', wrap((req) => agent.sessionInfo(req.params.cardId, slotOf(req))));
app.get('/api/cards/:id/agent-runs', wrap((req) => {
  cards.getCard(req.params.id);
  return agent.listRuns(req.params.id);
}));
app.get('/api/agent/:cardId/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  try {
    agent.subscribe(req.params.cardId, res, slotOf(req));
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// ---- frontend estático (build de producción) ----
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = process.env.PORT || 4400;
app.listen(port, '0.0.0.0', () => {
  console.log(`Cardinal escuchando en http://0.0.0.0:${port}`);
  scheduleCliUpdates();
});
