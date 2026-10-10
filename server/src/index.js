import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT } from './paths.js';
import * as cards from './cards.js';
import { buildFeaturePrompt } from './prompt.js';
import * as docs from './docs.js';
import * as agent from './agent.js';
import * as git from './git.js';
import { mcpRouter } from './mcp.js';
import { PROVIDERS, defaults, getProvider, providerStatuses, saveDefaults, scheduleCliUpdates } from './providers/index.js';
import { installCli } from './providers/cli.js';

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
  defaults: defaults(),
  autoPush: process.env.AUTO_PUSH === 'true',
  columns: cards.COLUMNS,
})));

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
  const answer = await provider.complete({ model, system: 'Responde únicamente con la palabra OK.', user: 'ping', signal: AbortSignal.timeout(120000) });
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
app.post('/api/providers/codex/device-login', wrap(() => {
  const { url, code, status, error } = PROVIDERS.codex.startDeviceLogin();
  return { url, code, status, error };
}));
app.delete('/api/providers/codex/device-login', wrap(() => {
  PROVIDERS.codex.cancelDeviceLogin();
  return { ok: true };
}));

// ---- cards ----
app.get('/api/cards', wrap(() => cards.listCards()));
app.post('/api/cards', wrap((req) => cards.createCard(req.body)));
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
  agent.stopAgent(req.params.id);
  cards.deleteCard(req.params.id);
  return { ok: true };
}));

// ---- docs ----
app.get('/api/docs', wrap(() => docs.listDocs()));
app.get('/api/docs/content', wrap((req) => ({ path: req.query.path, content: docs.readDoc(req.query.path) })));
app.put('/api/docs/content', wrap((req) => {
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const path = docs.saveDoc(req.body?.path, content);
  return { path, content: content.endsWith('\n') ? content : `${content}\n` };
}));

// ---- agent ----
const onFinish = async () => {
  if (process.env.AUTO_PUSH === 'true') {
    try {
      await git.commitAndPush();
    } catch (e) {
      console.error('AUTO_PUSH falló:', e.message);
    }
  }
};

app.post('/api/agent/:cardId/start', wrap((req) => agent.startAgent(req.params.cardId, {
  provider: req.body?.provider,
  model: req.body?.model,
  onFinish,
})));
app.post('/api/agent/:cardId/stop', wrap((req) => agent.stopAgent(req.params.cardId)));
app.post('/api/agent/:cardId/message', wrap((req) => {
  agent.sendMessage(req.params.cardId, req.body.content, { onFinish });
  return { ok: true };
}));
app.get('/api/agent/:cardId', wrap((req) => agent.sessionInfo(req.params.cardId)));
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
  agent.subscribe(req.params.cardId, res);
});

// ---- git ----
app.get('/api/git/status', wrap(() => git.status()));
app.post('/api/git/pull', wrap(() => git.pull()));
app.post('/api/git/push', wrap((req) => git.commitAndPush(req.body?.message)));

// ---- frontend estático (build de producción) ----
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = process.env.PORT || 4400;
app.listen(port, '0.0.0.0', () => {
  console.log(`product-os escuchando en http://0.0.0.0:${port}`);
  scheduleCliUpdates();
});
