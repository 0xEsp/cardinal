import { simpleGit } from 'simple-git';
import { ROOT } from './paths.js';

const git = simpleGit(ROOT);

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
  const res = await git.pull();
  return { summary: res.summary };
}

// Commitea SOLO el workspace (cards + docs), que es lo que generan los agentes.
// Los cambios de código del dashboard se commitean a mano.
export async function commitAndPush(message) {
  await git.add(['workspace']);
  const s = await git.status();
  const staged = s.staged.length;
  if (staged > 0) {
    await git.commit(message || `product-os: actualización del workspace (${new Date().toISOString()})`);
  }
  const hasRemote = (await git.getRemotes()).length > 0;
  if (hasRemote) await git.push();
  return { committed: staged > 0, pushed: hasRemote, files: s.staged };
}
