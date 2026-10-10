import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CLI_DIR } from '../paths.js';

// Paquetes npm de los CLIs oficiales. Se instalan en el volumen de datos
// (data/cli) y no en la imagen: actualizar un CLI para tener un modelo nuevo
// no requiere construir ni desplegar otra versión del Product OS.
export const CLI_PACKAGES = {
  codex: { pkg: '@openai/codex', bin: 'codex' },
  claude: { pkg: '@anthropic-ai/claude-code', bin: 'claude' },
};

const installs = new Map(); // id -> { running, log, error, finishedAt }
let installQueue = Promise.resolve();

export function cliBinary(id) {
  const { bin } = CLI_PACKAGES[id];
  const local = path.join(CLI_DIR, 'bin', bin);
  return fs.existsSync(local) ? local : null;
}

export function installState(id) {
  return installs.get(id) || { running: false, log: '', error: null, finishedAt: null };
}

export async function cliVersion(id, env) {
  const bin = cliBinary(id);
  if (!bin) return null;
  const out = await runProcess(bin, ['--version'], { env, timeoutMs: 15000 }).catch(() => null);
  return out?.code === 0 ? out.stdout.trim().split('\n').pop() : null;
}

export function installCli(id) {
  const { pkg } = CLI_PACKAGES[id];
  const current = installState(id);
  if (current.running) return current;
  const state = { running: true, log: '', error: null, finishedAt: null };
  installs.set(id, state);
  fs.mkdirSync(CLI_DIR, { recursive: true });
  // Dos `npm install` simultáneos sobre el mismo prefijo pueden pisarse.
  installQueue = installQueue.then(() => runProcess('npm', ['install', '-g', '--prefix', CLI_DIR, '--no-audit', '--no-fund', `${pkg}@latest`], {
    timeoutMs: 10 * 60 * 1000,
    onStdout: (chunk) => { state.log = (state.log + chunk).slice(-4000); },
    onStderr: (chunk) => { state.log = (state.log + chunk).slice(-4000); },
  }))
    .then((out) => {
      if (out.code !== 0) state.error = `npm terminó con código ${out.code}`;
    })
    .catch((error) => { state.error = error.message; })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });
  return state;
}

/**
 * Lanza un proceso y resuelve con { code, stdout, stderr }. `onLine` recibe cada
 * línea de stdout (los CLIs emiten JSONL). Un AbortSignal mata el proceso.
 */
export function runProcess(cmd, args, { env, cwd, stdin, signal, timeoutMs, onLine, onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: childEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      const error = new Error('Proceso abortado');
      error.name = 'AbortError';
      finish(() => reject(error));
    };
    const timer = timeoutMs
      ? setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error(`${path.basename(cmd)} superó el tiempo máximo`)));
      }, timeoutMs)
      : null;
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 2_000_000) stdout += chunk;
      onStdout?.(chunk);
      if (!onLine) return;
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-20000);
      onStderr?.(chunk);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      if (onLine && lineBuffer.trim()) onLine(lineBuffer);
      finish(() => resolve({ code, stdout, stderr }));
    });
    child.stdin.on('error', () => {});
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

// Un valor null elimina la variable heredada (p. ej. una API key que haría que
// el CLI facturase por uso en vez de usar la suscripción).
export function childEnv(overrides = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
