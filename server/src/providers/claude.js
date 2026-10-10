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

function writeTemp(content) {
  const file = path.join(os.tmpdir(), `productos-${crypto.randomBytes(6).toString('hex')}.md`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

function commonArgs({ model, systemPromptFile }) {
  const args = [
    '-p',
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--system-prompt-file', systemPromptFile,
  ];
  if (model) args.push('--model', model);
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
    return ALIASES;
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

  async runTurn({ prompt, systemPrompt, model, sessionId, mcpUrl, cwd, signal, onEvent }) {
    const bin = cliBinary('claude');
    if (!bin) throw new Error('El CLI de Claude Code no está instalado');
    const systemPromptFile = path.join(cwd, 'system-prompt.md');
    fs.writeFileSync(systemPromptFile, systemPrompt, { mode: 0o600 });
    const newSession = sessionId || crypto.randomUUID();
    const args = [
      ...commonArgs({ model, systemPromptFile }),
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--mcp-config', JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl } } }),
      '--allowedTools', `mcp__${MCP_SERVER_NAME}`,
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

  async complete({ system, user, model, signal }) {
    const bin = cliBinary('claude');
    if (!bin) throw new Error('El CLI de Claude Code no está instalado');
    const systemPromptFile = writeTemp(system);
    try {
      const out = await runProcess(bin, [
        ...commonArgs({ model, systemPromptFile }),
        '--output-format', 'json',
        '--no-session-persistence',
        '--mcp-config', '{"mcpServers":{}}',
      ], { env: env(), cwd: CLAUDE_CONFIG_DIR, stdin: user, signal, timeoutMs: 15 * 60 * 1000 });
      const parsed = parseJsonLine(out.stdout.trim());
      if (!parsed || parsed.is_error || out.code !== 0) {
        throw new Error(`Claude (revisor) falló: ${parsed?.result || out.stderr.trim().slice(-300) || `código ${out.code}`}`);
      }
      return parsed.result || '';
    } finally {
      fs.rmSync(systemPromptFile, { force: true });
    }
  },
};
