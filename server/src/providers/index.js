import { getSetting, setSetting } from '../settings.js';
import { openrouter } from './openrouter.js';
import { codex } from './codex.js';
import { claude } from './claude.js';
import { CLI_PACKAGES, cliBinary, installCli } from './cli.js';

export const PROVIDERS = { openrouter, codex, claude };

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw Object.assign(new Error(`Proveedor desconocido: ${id}`), { status: 400 });
  return provider;
}

export function defaults() {
  const saved = getSetting('agentDefaults', {});
  const provider = PROVIDERS[saved.provider] ? saved.provider : 'openrouter';
  return {
    provider,
    model: saved.model || PROVIDERS[provider].defaultModel,
    reviewer: saved.reviewer || null, // { provider, model } o null = el mismo que el agente
  };
}

export function saveDefaults({ provider, model, reviewer }) {
  getProvider(provider);
  if (reviewer?.provider) getProvider(reviewer.provider);
  setSetting('agentDefaults', {
    provider,
    model: String(model || '').trim() || PROVIDERS[provider].defaultModel,
    reviewer: reviewer?.provider ? { provider: reviewer.provider, model: String(reviewer.model || '').trim() || PROVIDERS[reviewer.provider].defaultModel } : null,
  });
  return defaults();
}

export async function providerStatuses() {
  const entries = await Promise.all(Object.values(PROVIDERS).map(async (provider) => {
    let status;
    try {
      status = await provider.status();
    } catch (error) {
      status = { ready: false, message: error.message };
    }
    return { id: provider.id, label: provider.label, kind: provider.kind, defaultModel: provider.defaultModel, ...status };
  }));
  return entries;
}

// Mantiene los CLIs al día sin redesplegar: al arrancar y una vez al día
// reinstala @latest de los que ya estén instalados. Desactivable con
// CLI_AUTO_UPDATE=false.
export function scheduleCliUpdates() {
  if (process.env.CLI_AUTO_UPDATE === 'false') return;
  const update = () => {
    for (const id of Object.keys(CLI_PACKAGES)) if (cliBinary(id)) installCli(id);
  };
  setTimeout(update, 60 * 1000).unref();
  setInterval(update, 24 * 60 * 60 * 1000).unref();
}
