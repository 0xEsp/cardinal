#!/usr/bin/env node
// Puente MCP de Paper para el Product OS.
//
// El MCP de Paper es un relay stdio (`~/.paper/bin/paper mcp`) que habla con la
// app de escritorio en 127.0.0.1:29979, así que solo funciona en el Mac donde
// Paper está abierto. Este puente lo expone por HTTP (MCP Streamable HTTP,
// respuestas JSON) en la red local para que el Product OS de la Raspberry pueda
// usarlo. Cada sesión MCP entrante tiene su propio proceso `paper mcp`.
//
// Se levanta y se cierra a mano, como un backend en desarrollo:
//   node scripts/paper-bridge/paper-bridge.mjs               # levanta en primer plano (Ctrl+C para cerrar)
//   node scripts/paper-bridge/paper-bridge.mjs status        # ¿está levantado? ¿Paper está abierto?
//   node scripts/paper-bridge/paper-bridge.mjs token         # URL y token para la pestaña IA
//   node scripts/paper-bridge/paper-bridge.mjs rotate-token  # genera un token nuevo
// El token se guarda en ~/.config/cardinal-paper-bridge/token y se reutiliza en
// cada arranque, así la configuración del Product OS sigue valiendo.
// Sin dependencias: solo Node 18+.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'cardinal-paper-bridge');
// Antes de Cardinal el token vivía en otra carpeta: se mueve una vez para no
// tener que volver a pegarlo en IA y diseño.
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.config', 'gotty-paper-bridge');
if (!fs.existsSync(CONFIG_DIR) && fs.existsSync(LEGACY_CONFIG_DIR)) fs.renameSync(LEGACY_CONFIG_DIR, CONFIG_DIR);
const PORT = Number(process.env.PAPER_BRIDGE_PORT || 4410);
const HOST = process.env.PAPER_BRIDGE_HOST || '0.0.0.0';
const PAPER_BIN = process.env.PAPER_BIN || path.join(os.homedir(), '.paper', 'bin', 'paper');
const PAPER_APP_PORT = 29979;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_SESSION_MS = 30 * 60 * 1000;

const TOKEN_FILE = path.join(CONFIG_DIR, 'token');

function writeNewToken() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  return token;
}

function readToken() {
  if (process.env.PAPER_BRIDGE_TOKEN) return process.env.PAPER_BRIDGE_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  return writeNewToken();
}

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    const ipv4 = addresses?.find((address) => address.family === 'IPv4' && !address.internal);
    if (ipv4) return ipv4.address;
  }
  return '<ip-del-mac>';
}

function printConnection(token) {
  console.log('\nEn el Product OS → pestaña IA → Paper (diseño):');
  console.log(`  URL:   http://${lanAddress()}:${PORT}/mcp`);
  console.log(`  Token: ${token}`);
  console.log('(Reserva esa IP para el Mac en el router para que no cambie.)\n');
}

const command = process.argv[2] || 'start';
if (command === 'token') {
  printConnection(readToken());
  process.exit(0);
}
if (command === 'rotate-token') {
  const token = writeNewToken();
  console.log('Token nuevo generado. Actualízalo en la pestaña IA y reinicia el puente si estaba levantado.');
  printConnection(token);
  process.exit(0);
}
if (command === 'status') {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      headers: { Authorization: `Bearer ${readToken()}` },
      signal: AbortSignal.timeout(3000),
    });
    const health = await res.json();
    console.log(`Puente levantado en el puerto ${PORT} · sesiones activas: ${health.sessions}`);
    console.log(health.paperApp ? 'Paper: abierto ✓' : '⚠ Paper: cerrado. Abre la app de Paper para poder diseñar.');
  } catch {
    console.log(`El puente no está levantado (nada en el puerto ${PORT}). Arráncalo con: node scripts/paper-bridge/paper-bridge.mjs`);
    process.exitCode = 1;
  }
  process.exit();
}
if (command !== 'start') {
  console.error('Uso: node scripts/paper-bridge/paper-bridge.mjs [start|status|token|rotate-token]');
  process.exit(1);
}

const TOKEN = readToken();
if (TOKEN.length < 24) {
  console.error(`El token del puente es demasiado corto (${TOKEN_FILE}). Genera otro con: node scripts/paper-bridge/paper-bridge.mjs rotate-token`);
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);
const sessions = new Map(); // id -> { child, pending: Map, lastUsed }

function authorized(req) {
  const header = req.headers.authorization || '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function paperAppReachable() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: PAPER_APP_PORT });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function closeSession(id, reason) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  for (const { reject, timer } of session.pending.values()) {
    clearTimeout(timer);
    reject(new Error(`Sesión cerrada: ${reason}`));
  }
  session.child.kill('SIGTERM');
  log(`sesión ${id.slice(0, 8)} cerrada (${reason})`);
}

function createSession() {
  const id = crypto.randomUUID();
  const child = spawn(PAPER_BIN, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const session = { child, pending: new Map(), lastUsed: Date.now() };
  sessions.set(id, session);

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const key = JSON.stringify(message.id);
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined) && session.pending.has(key)) {
        const { resolve, timer } = session.pending.get(key);
        clearTimeout(timer);
        session.pending.delete(key);
        resolve(message);
      } else if (message.method && message.id !== undefined) {
        // Petición del servidor al cliente (roots, sampling…): no se soporta.
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'No soportado por el puente' } })}\n`);
      }
    }
  });
  child.stderr.on('data', (chunk) => log(`[paper ${id.slice(0, 8)}]`, chunk.toString().trim()));
  child.on('exit', (code) => closeSession(id, `paper mcp terminó con código ${code}`));
  child.stdin.on('error', () => {});
  log(`sesión ${id.slice(0, 8)} abierta`);
  return id;
}

function forward(session, message) {
  session.lastUsed = Date.now();
  const line = `${JSON.stringify(message)}\n`;
  if (message.id === undefined || message.id === null) {
    session.child.stdin.write(line);
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const key = JSON.stringify(message.id);
    const timer = setTimeout(() => {
      session.pending.delete(key);
      resolve({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'Paper no respondió a tiempo' } });
    }, REQUEST_TIMEOUT_MS);
    session.pending.set(key, { resolve, reject, timer });
    session.child.stdin.write(line);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 20 * 1024 * 1024) reject(new Error('Petición demasiado grande'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://bridge');
  if (!authorized(req)) return send(res, 401, { error: 'Token inválido' });

  if (url.pathname === '/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      paperApp: await paperAppReachable(),
      paperBin: fs.existsSync(PAPER_BIN),
      sessions: sessions.size,
      host: os.hostname(),
    });
  }

  if (url.pathname !== '/mcp') return send(res, 404, { error: 'No encontrado' });
  const sessionId = req.headers['mcp-session-id'];

  if (req.method === 'DELETE') {
    if (sessionId) closeSession(sessionId, 'cerrada por el cliente');
    return send(res, 200);
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Solo POST' }, { Allow: 'POST, DELETE' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } });
  }
  const batch = Array.isArray(payload);
  const messages = batch ? payload : [payload];

  let id = sessionId;
  if (!id && messages.some((message) => message?.method === 'initialize')) {
    if (!(await paperAppReachable())) {
      return send(res, 503, { jsonrpc: '2.0', id: messages[0]?.id ?? null, error: { code: -32002, message: 'La app de Paper no está abierta en el Mac' } });
    }
    id = createSession();
  }
  const session = id && sessions.get(id);
  if (!session) return send(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sesión MCP desconocida; vuelve a inicializar' } });

  try {
    const replies = (await Promise.all(messages.map((message) => forward(session, message)))).filter(Boolean);
    if (!replies.length) return send(res, 202, undefined, { 'Mcp-Session-Id': id });
    return send(res, 200, batch ? replies : replies[0], { 'Mcp-Session-Id': id });
  } catch (error) {
    return send(res, 502, { jsonrpc: '2.0', id: null, error: { code: -32003, message: error.message } });
  }
});

setInterval(() => {
  for (const [id, session] of sessions) {
    if (Date.now() - session.lastUsed > IDLE_SESSION_MS) closeSession(id, 'inactiva');
  }
}, 60 * 1000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const id of [...sessions.keys()]) closeSession(id, 'apagando');
    console.log('\nPuente de Paper cerrado: el Product OS ya no puede usar Paper hasta que lo vuelvas a levantar.');
    process.exit(0);
  });
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya está en uso: probablemente el puente ya está levantado en otra terminal.`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  log(`Puente de Paper escuchando en http://${HOST}:${PORT}/mcp (Ctrl+C para cerrarlo)`);
  if (!fs.existsSync(PAPER_BIN)) console.warn(`⚠ No existe ${PAPER_BIN}: instala o abre Paper para que cree su CLI.`);
  if (!(await paperAppReachable())) console.warn('⚠ La app de Paper no está abierta: ábrela para poder consultar y diseñar.');
  printConnection(TOKEN);
});
