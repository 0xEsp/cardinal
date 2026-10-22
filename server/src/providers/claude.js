import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CLAUDE_CONFIG_DIR } from '../paths.js';
import { MCP_SERVER_NAME } from '../mcp.js';
import { deleteSecret, getSecret, secretSource, setSecret } from '../settings.js';
import { cliBinary, cliVersion, installState, parseJsonLine, runProcess } from './cli.js';

// Claude Code (binario oficial) con la suscripción Pro/Max. La credencial es el
// token de larga duración que genera `claude setup-token` en tu ordenador.
// Ojo: Anthropic solo permite usar la suscripción a través de Claude Code; por
// eso aquí siempre se invoca el CLI oficial y nunca la API con ese token.

const TOKEN_SECRET = 'claude-oauth-token';
const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 });

function env() {
  return {
    CLAUDE_CONFIG_DIR,
    [TOKEN_ENV]: getSecret(TOKEN_SECRET, TOKEN_ENV),
    // Nunca facturar por API: sin estas variables el CLI usa la suscripción.
    ANTHROPIC_API_KEY: null,
    ANTHROPIC_AUTH_TOKEN: null,
    // Las actualizaciones las gestiona el Product OS (botón "Actualizar CLI").
    DISABLE_AUTOUPDATER: '1',
    // Alpine: usa el ripgrep del sistema en vez del binario glibc incluido.
    USE_BUILTIN_RIPGREP: fs.existsSync('/etc/alpine-release') ? '0' : undefined,
    MCP_TIMEOUT: '30000',
    // review_* llama a otro modelo: necesita margen.
    MCP_TOOL_TIMEOUT: '900000',
  };
}

// Los alias siempre apuntan al último modelo de cada familia que conoce el CLI
// instalado: al actualizar el CLI aparecen los modelos nuevos sin desplegar.
const ALIASES = [
  { id: 'opus', label: 'Opus (último)' },
  { id: 'sonnet', label: 'Sonnet (último)' },
  { id: 'haiku', label: 'Haiku (último)' },
  { id: 'fable', label: 'Fable (último)' },
];

// Los niveles de --effort se leen del --help del CLI instalado: si Claude Code
// añade uno nuevo, aparece al actualizar el CLI.
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
let effortCache = { at: 0, levels: null };

async function effortLevels() {
  if (effortCache.levels && Date.now() - effortCache.at < 60 * 60 * 1000) return effortCache.levels;
  const bin = cliBinary('claude');
  if (!bin) return FALLBACK_EFFORTS;
  const out = await runProcess(bin, ['--help'], { env: env(), timeoutMs: 15000 }).catch(() => null);
  const match = out?.stdout.replace(/\s+/g, ' ').match(/--effort <level>.*?\(([a-z, ]+)\)/);
  const levels = match ? match[1].split(',').map((level) => level.trim()).filter(Boolean) : [];
  effortCache = { at: Date.now(), levels: levels.length ? levels : FALLBACK_EFFORTS };
  return effortCache.levels;
}

// Config MCP en un fichero 0600 (lleva el token de Paper/Moki) y la lista de
// herramientas permitidas: las nuestras completas y de Paper/Moki solo las indicadas.
function mcpSetup(file, servers = {}, extraMcp = []) {
  const mcpServers = { ...servers };
  const allowed = Object.keys(servers).map((name) => `mcp__${name}`);
  for (const server of extraMcp) {
    mcpServers[server.name] = { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.token}` } };
    allowed.push(...server.tools.map((tool) => `mcp__${server.name}__${tool}`));
  }
  fs.writeFileSync(file, JSON.stringify({ mcpServers }), { mode: 0o600 });
  return ['--mcp-config', file, ...(allowed.length ? ['--allowedTools', allowed.join(',')] : [])];
}

function writeTemp(content) {
  const file = path.join(os.tmpdir(), `productos-${crypto.randomBytes(6).toString('hex')}.md`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

function commonArgs({ model, effort, systemPromptFile }) {
  const args = [
    '-p',
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--system-prompt-file', systemPromptFile,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

export const claude = {
  id: 'claude',
  label: 'Claude (suscripción Pro/Max)',
  kind: 'cli',
  defaultModel: 'sonnet',

  async status() {
    const installed = Boolean(cliBinary('claude'));
    const version = installed ? await cliVersion('claude', env()) : null;
    const tokenSource = secretSource(TOKEN_SECRET, TOKEN_ENV);
    let loggedIn = false;
    if (installed && tokenSource) {
      const out = await runProcess(cliBinary('claude'), ['auth', 'status', '--json'], { env: env(), timeoutMs: 20000 }).catch(() => null);
      loggedIn = Boolean(parseJsonLine(out?.stdout || '')?.loggedIn);
    }
    return {
      installed,
      version,
      install: installState('claude'),
      tokenSource,
      loggedIn,
      ready: installed && loggedIn,
      message: !installed ? 'Instala el CLI de Claude Code.' : !tokenSource ? 'Pega el token de `claude setup-token`.' : !loggedIn ? 'El token no es válido.' : null,
    };
  },

  async listModels() {
    const efforts = (await effortLevels()).map((id) => ({ id, label: id }));
    return ALIASES.map((alias) => ({ ...alias, efforts, defaultEffort: null }));
  },

  saveToken(token) {
    const clean = String(token || '').trim();
    if (!/^sk-ant-oat/.test(clean)) {
      throw Object.assign(new Error('Eso no parece un token de `claude setup-token` (empieza por sk-ant-oat…)'), { status: 400 });
    }
    setSecret(TOKEN_SECRET, clean);
  },

  logout() {
    deleteSecret(TOKEN_SECRET);
  },

  async runTurn({ prompt, systemPrompt, model, effort, sessionId, mcpUrl, extraMcp, cwd, signal, onEvent }) {
    const bin = cliBinary('claude');
    if (!bin) throw new Error('El CLI de Claude Code no está instalado');
    const systemPromptFile = path.join(cwd, 'system-prompt.md');
    fs.writeFileSync(systemPromptFile, systemPrompt, { mode: 0o600 });
    const newSession = sessionId || crypto.randomUUID();
    const args = [
      ...commonArgs({ model, effort, systemPromptFile }),
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...mcpSetup(path.join(cwd, 'mcp.json'), { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl } }, extraMcp),
      ...(sessionId ? ['--resume', sessionId] : ['--session-id', newSession]),
    ];
    let result = null;
    let mcpFailed = false;
    const out = await runProcess(bin, args, {
      env: env(),
      cwd,
      stdin: prompt,
      signal,
      onLine: (line) => {
        const event = parseJsonLine(line);
        if (!event) return;
        if (event.type === 'system' && event.subtype === 'init') {
          const server = (event.mcp_servers || []).find((s) => s.name === MCP_SERVER_NAME);
          mcpFailed = server && server.status !== 'connected';
        } else if (event.type === 'stream_event') {
          const delta = event.event?.delta;
          if (event.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
            onEvent({ type: 'delta', text: delta.text });
          } else if (event.event?.type === 'message_stop') {
            onEvent({ type: 'flush' });
          }
        } else if (event.type === 'assistant') {
          // Llamadas a MCP externos (Paper, Moki): no pasan por nuestro servidor, se avisan para la consola.
          for (const block of event.message?.content || []) {
            const match = block.type === 'tool_use' && block.name?.match(/^mcp__(.+?)__(.+)$/);
            if (match && match[1] !== MCP_SERVER_NAME) onEvent({ type: 'external_tool', server: match[1], tool: match[2] });
          }
        } else if (event.type === 'result') {
          result = event;
          if (event.usage) onEvent({ type: 'usage', usage: event.usage });
        }
      },
    });
    if (mcpFailed) throw new Error('Claude Code no pudo conectar con las herramientas del Product OS (MCP)');
    if (result?.is_error) throw new Error(`Claude: ${result.result || result.subtype || 'error desconocido'}`);
    if (out.code !== 0) throw new Error(`Claude Code terminó con código ${out.code}: ${out.stderr.trim().slice(-500)}`);
    return { sessionId: result?.session_id || newSession };
  },

  // extraMcp permite que el revisor consulte el diseño (capturas) antes de responder.
  async complete({ system, user, model, effort, extraMcp, signal }) {
    const bin = cliBinary('claude');
    if (!bin) throw new Error('El CLI de Claude Code no está instalado');
    const systemPromptFile = writeTemp(system);
    const mcpFile = `${systemPromptFile}.mcp.json`;
    try {
      const out = await runProcess(bin, [
        ...commonArgs({ model, effort, systemPromptFile }),
        '--output-format', 'json',
        '--no-session-persistence',
        ...mcpSetup(mcpFile, {}, extraMcp),
      ], { env: env(), cwd: CLAUDE_CONFIG_DIR, stdin: user, signal, timeoutMs: 15 * 60 * 1000 });
      const parsed = parseJsonLine(out.stdout.trim());
      if (!parsed || parsed.is_error || out.code !== 0) {
        throw new Error(`Claude (revisor) falló: ${parsed?.result || out.stderr.trim().slice(-300) || `código ${out.code}`}`);
      }
      return parsed.result || '';
    } finally {
      fs.rmSync(systemPromptFile, { force: true });
      fs.rmSync(mcpFile, { force: true });
    }
  },
};
