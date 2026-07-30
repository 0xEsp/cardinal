import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT } from './paths.js';
import * as cards from './cards.js';
import { buildFeaturePrompt } from './prompt.js';
import * as docs from './docs.js';
import * as agent from './agent.js';
import * as git from './git.js';

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

const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

// ---- config ----
app.get('/api/config', wrap(() => ({
  models: (process.env.MODELS || process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5').split(',').map((m) => m.trim()),
  defaultModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
  hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
  autoPush: process.env.AUTO_PUSH === 'true',
  columns: cards.COLUMNS,
})));

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
  cards.deleteCard(req.params.id);
  return { ok: true };
}));

// ---- docs ----
app.get('/api/docs', wrap(() => docs.listDocs()));
app.get('/api/docs/content', wrap((req) => ({ path: req.query.path, content: docs.readDoc(req.query.path) })));

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

app.post('/api/agent/:cardId/start', wrap((req) => agent.startAgent(req.params.cardId, { model: req.body?.model, onFinish })));
app.post('/api/agent/:cardId/message', wrap((req) => {
  agent.sendMessage(req.params.cardId, req.body.content, { onFinish });
  return { ok: true };
}));
app.get('/api/agent/:cardId', wrap((req) => agent.sessionInfo(req.params.cardId)));
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
});
