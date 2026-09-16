import { simpleGit } from 'simple-git';
import { ROOT } from './paths.js';

// En Docker el checkout completo del host se monta en /repo. El código que se
// ejecuta sigue siendo el de la imagen, pero Git opera sobre el árbol real.
const git = simpleGit(process.env.PRODUCT_OS_REPO_DIR || ROOT);

// En la Raspberry/Docker no hay credential helper interactivo, así que si hay
// GIT_TOKEN en el entorno construimos la URL autenticada y la usamos por comando,
// sin persistir el token en .git/config.
async function remoteFor(command) {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === 'origin');
  if (!origin) return null;
  const url = command === 'push' ? origin.refs.push : origin.refs.fetch;
  const token = process.env.GIT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token || !url.startsWith('https://')) return url ? 'origin' : null;
  const u = new URL(url);
  u.username = process.env.GIT_USERNAME || 'x-access-token';
  u.password = token;
  return u.toString();
}

export async function status() {
  const s = await git.status();
  return {
    branch: s.current,
    ahead: s.ahead,
    behind: s.behind,
    dirty: s.files.length,
    files: s.files.map((f) => f.path),
  };
}

export async function pull() {
  const s = await git.status();
  const remote = await remoteFor('fetch');
  if (!remote) throw new Error('No hay remoto configurado');
  const res = await git.pull(remote, s.current);
  return { summary: res.summary };
}

// Commitea SOLO el workspace (docs de producto, que es lo que generan los agentes)
// y las reglas de os/. Los cambios de código del dashboard se commitean a mano.
export async function commitAndPush(message) {
  await git.add(['workspace', 'os']);
  const s = await git.status();
  const stagedFiles = (await git.raw(['diff', '--cached', '--name-only', '--', 'workspace', 'os']))
    .split('\n').filter(Boolean);
  if (stagedFiles.length > 0) {
    // El pathspec impide que el botón Push incluya código ya staged por el
    // usuario en el checkout del host.
    await git.raw([
      'commit', '-m', message || `product-os: actualización del workspace (${new Date().toISOString()})`,
      '--', 'workspace', 'os',
    ]);
  }
  const remote = await remoteFor('push');
  if (remote) await git.push(remote, s.current);
  return { committed: stagedFiles.length > 0, pushed: Boolean(remote), files: stagedFiles };
}
