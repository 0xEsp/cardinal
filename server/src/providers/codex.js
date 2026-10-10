import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CODEX_HOME } from '../paths.js';
import { MCP_SERVER_NAME } from '../mcp.js';
import { cliBinary, cliVersion, installState, parseJsonLine, runProcess } from './cli.js';

// Codex CLI con la cuenta de ChatGPT (Plus/Pro). Las credenciales viven en
// CODEX_HOME (data/codex/auth.json) y Codex las refresca solo.

fs.mkdirSync(CODEX_HOME, { recursive: true, mode: 0o700 });
const env = () => ({ CODEX_HOME });
const toml = (value) => JSON.stringify(value); // un string JSON es un string TOML válido

let modelCache = { at: 0, models: null };
let deviceLogin = null; // { child, url, code, output, status, error }

export const codex = {
  id: 'codex',
  label: 'Codex (cuenta ChatGPT)',
  kind: 'cli',
  // El recomendado es el primero del catálogo vivo (ordenado por prioridad).
  get defaultModel() {
    return modelCache.models?.[0]?.id || 'gpt-5.5';
  },

  async status() {
    const installed = Boolean(cliBinary('codex'));
    const version = installed ? await cliVersion('codex', env()) : null;
    let loggedIn = false;
    let account = null;
    if (installed) {
      const out = await runProcess(cliBinary('codex'), ['login', 'status'], { env: env(), timeoutMs: 15000 }).catch(() => null);
      loggedIn = out?.code === 0;
      account = loggedIn ? `${out.stdout}${out.stderr}`.trim().split('\n').pop() : null;
      if (loggedIn) await this.listModels().catch(() => null); // calienta defaultModel
    }
    return {
      installed,
      version,
      install: installState('codex'),
      loggedIn,
      account,
      login: deviceLogin && { url: deviceLogin.url, code: deviceLogin.code, status: deviceLogin.status, error: deviceLogin.error },
      ready: installed && loggedIn,
      message: !installed ? 'Instala el CLI de Codex.' : !loggedIn ? 'Conecta tu cuenta de ChatGPT.' : null,
    };
  },

  // El catálogo sale del propio CLI: con la cuenta conectada lo refresca desde
  // OpenAI, así que un modelo nuevo aparece sin tocar el Product OS.
  async listModels({ refresh = false } = {}) {
    const bin = cliBinary('codex');
    if (!bin) return [];
    if (!refresh && modelCache.models && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.models;
    const out = await runProcess(bin, ['debug', 'models'], { env: env(), timeoutMs: 30000 });
    if (out.code !== 0) throw new Error(`codex debug models: ${out.stderr.slice(-300)}`);
    const catalog = JSON.parse(out.stdout);
    const models = (catalog.models || catalog)
      .filter((model) => model.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((model) => ({ id: model.slug, label: model.display_name || model.slug, description: model.description || '' }));
    modelCache = { at: Date.now(), models };
    return models;
  },

  startDeviceLogin() {
    const bin = cliBinary('codex');
    if (!bin) throw Object.assign(new Error('Instala antes el CLI de Codex'), { status: 400 });
    if (deviceLogin?.status === 'pending') return deviceLogin;
    const state = { url: null, code: null, output: '', status: 'pending', error: null };
    const child = spawn(bin, ['login', '--device-auth'], { env: { ...process.env, ...env() }, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;
    const onData = (chunk) => {
      // Quita códigos ANSI antes de buscar la URL y el código de dispositivo.
      state.output = (state.output + chunk.toString()).replace(/\x1b\[[0-9;]*m/g, '').slice(-4000);
      state.url ||= state.output.match(/https:\/\/\S+/)?.[0] || null;
      state.code ||= state.output.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0] || null;
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      state.status = code === 0 ? 'done' : 'failed';
      if (code !== 0) state.error = state.output.trim().split('\n').slice(-3).join(' ') || `codex login terminó con código ${code}`;
      modelCache = { at: 0, models: null };
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
    child.on('close', () => clearTimeout(timeout));
    deviceLogin = state;
    return state;
  },

  cancelDeviceLogin() {
    deviceLogin?.child?.kill('SIGTERM');
    deviceLogin = null;
  },

  // Alternativa al device code: pegar el auth.json de un ordenador donde ya se
  // hizo `codex login`.
  saveAuthJson(content) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw Object.assign(new Error('El contenido no es un JSON válido'), { status: 400 });
    }
    if (!parsed.tokens && !parsed.OPENAI_API_KEY) {
      throw Object.assign(new Error('No parece un auth.json de Codex (falta "tokens")'), { status: 400 });
    }
    fs.writeFileSync(path.join(CODEX_HOME, 'auth.json'), JSON.stringify(parsed, null, 2), { mode: 0o600 });
    modelCache = { at: 0, models: null };
  },

  async logout() {
    const bin = cliBinary('codex');
    if (bin) await runProcess(bin, ['logout'], { env: env(), timeoutMs: 15000 }).catch(() => null);
    fs.rmSync(path.join(CODEX_HOME, 'auth.json'), { force: true });
    modelCache = { at: 0, models: null };
  },

  baseArgs({ model, systemPrompt }) {
    const args = [
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '-c', `sandbox_mode=${toml('read-only')}`,
      '-c', `approval_policy=${toml('never')}`,
      '-c', `web_search=${toml('disabled')}`,
    ];
    if (model) args.push('-m', model);
    if (systemPrompt) args.push('-c', `developer_instructions=${toml(systemPrompt)}`);
    return args;
  },

  /**
   * Ejecuta un turno del agente. Las herramientas del harness llegan por MCP;
   * aquí solo se traduce el JSONL de Codex a eventos comunes.
   */
  async runTurn({ prompt, systemPrompt, model, sessionId, mcpUrl, cwd, signal, onEvent }) {
    const bin = cliBinary('codex');
    if (!bin) throw new Error('El CLI de Codex no está instalado');
    const mcp = `mcp_servers.${MCP_SERVER_NAME}`;
    const args = [
      'exec',
      ...(sessionId ? ['resume'] : []),
      ...this.baseArgs({ model, systemPrompt }),
      '-c', `${mcp}.url=${toml(mcpUrl)}`,
      '-c', `${mcp}.required=true`,
      '-c', `${mcp}.startup_timeout_sec=30`,
      // review_* llama a otro modelo: necesita margen.
      '-c', `${mcp}.tool_timeout_sec=900`,
      '-c', `${mcp}.default_tools_approval_mode=${toml('auto')}`,
      ...(sessionId ? [sessionId] : []),
      '-',
    ];
    let threadId = sessionId || null;
    let failure = null;
    const out = await runProcess(bin, args, {
      env: env(),
      cwd,
      stdin: prompt,
      signal,
      onLine: (line) => {
        const event = parseJsonLine(line);
        if (!event) return;
        if (event.type === 'thread.started') threadId = event.thread_id;
        else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
          onEvent({ type: 'text', text: event.item.text });
        } else if (event.type === 'turn.failed') failure = event.error?.message || 'Codex no pudo completar el turno';
        else if (event.type === 'turn.completed' && event.usage) onEvent({ type: 'usage', usage: event.usage });
      },
    });
    if (failure) throw new Error(`Codex: ${failure}`);
    if (out.code !== 0) throw new Error(`Codex terminó con código ${out.code}: ${lastLines(out.stderr)}`);
    return { sessionId: threadId };
  },

  async complete({ system, user, model, signal }) {
    const bin = cliBinary('codex');
    if (!bin) throw new Error('El CLI de Codex no está instalado');
    let text = '';
    const out = await runProcess(bin, ['exec', '--ephemeral', ...this.baseArgs({ model, systemPrompt: system }), '-'], {
      env: env(),
      cwd: CODEX_HOME,
      stdin: user,
      signal,
      timeoutMs: 15 * 60 * 1000,
      onLine: (line) => {
        const event = parseJsonLine(line);
        if (event?.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text || text;
        if (event?.type === 'turn.failed') text = '';
      },
    });
    if (out.code !== 0 || !text) throw new Error(`Codex (revisor) falló: ${lastLines(out.stderr)}`);
    return text;
  },
};

function lastLines(text) {
  return String(text || '').trim().split('\n').filter((line) => !/Reconnecting|websocket/i.test(line)).slice(-3).join(' ').slice(0, 500);
}
