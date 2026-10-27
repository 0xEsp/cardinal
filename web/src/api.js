async function req(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const q = encodeURIComponent;

export const api = {
  config: () => req('/api/config'),

  // ---- proyectos ----
  projects: () => req('/api/projects'),
  createProject: (body) => req('/api/projects', json('POST', body)),
  updateProject: (pid, patch) => req(`/api/projects/${pid}`, json('PUT', patch)),
  deleteProject: (pid) => req(`/api/projects/${pid}`, { method: 'DELETE' }),
  projectDesignTools: (pid) => req(`/api/projects/${pid}/design-tools`),
  projectRuns: (pid) => req(`/api/projects/${pid}/agent-runs`),

  // ---- cards ----
  cards: (pid) => req(`/api/projects/${pid}/cards`),
  createCard: (pid, body) => req(`/api/projects/${pid}/cards`, json('POST', body)),
  card: (id) => req(`/api/cards/${id}`),
  updateCard: (id, patch) => req(`/api/cards/${id}`, json('PUT', patch)),
  moveCard: (id, column, beforeId = null) => req(`/api/cards/${id}/move`, json('POST', { column, beforeId })),
  cardPrompt: (id) => req(`/api/cards/${id}/prompt`),
  comments: (id) => req(`/api/cards/${id}/comments`),
  createComment: (id, content) => req(`/api/cards/${id}/comments`, json('POST', { content })),
  deleteComment: (id, commentId) => req(`/api/cards/${id}/comments/${commentId}`, { method: 'DELETE' }),
  deleteCard: (id) => req(`/api/cards/${id}`, { method: 'DELETE' }),
  agentRuns: (cardId) => req(`/api/cards/${cardId}/agent-runs`),

  // ---- docs y reglas (kind: 'docs' | 'rules') ----
  docs: (pid, kind = 'docs') => req(`/api/projects/${pid}/${kind}`),
  docContent: (pid, path, kind = 'docs') => req(`/api/projects/${pid}/${kind}/content?path=${q(path)}`),
  saveDoc: (pid, path, content, kind = 'docs') => req(`/api/projects/${pid}/${kind}/content`, json('PUT', { path, content })),
  deleteDoc: (pid, path, kind = 'docs') => req(`/api/projects/${pid}/${kind}/content?path=${q(path)}`, { method: 'DELETE' }),
  docHistory: (pid, path, kind = 'docs') => req(`/api/projects/${pid}/${kind}/history?path=${q(path)}`),
  docVersion: (pid, path, version, kind = 'docs') => req(`/api/projects/${pid}/${kind}/version?path=${q(path)}&v=${version}`),
  restoreDoc: (pid, path, version, kind = 'docs') => req(`/api/projects/${pid}/${kind}/restore`, json('POST', { path, version })),

  // ---- MCP de agentes ----
  mcpTokens: () => req('/api/mcp-tokens'),
  createMcpToken: (body) => req('/api/mcp-tokens', json('POST', body)),
  revokeMcpToken: (id) => req(`/api/mcp-tokens/${id}`, { method: 'DELETE' }),

  // ---- agentes ----
  // slot: 'main' (definición/documentación) o 'design' (Paper o Moki, con task design|comments|promote
  // y designTool paper|moki, que solo cuenta si la card aún no tiene diseño)
  startAgent: (cardId, { slot = 'main', task, designTool, provider, model, effort }) => req(`/api/agent/${cardId}/start`, json('POST', { slot, task, designTool, provider, model, effort })),
  stopAgent: (cardId, slot = 'main') => req(`/api/agent/${cardId}/stop?slot=${slot}`, { method: 'POST' }),
  sendMessage: (cardId, content, slot = 'main') => req(`/api/agent/${cardId}/message?slot=${slot}`, json('POST', { content })),
  session: (cardId, slot = 'main') => req(`/api/agent/${cardId}?slot=${slot}`),

  // ---- herramientas de diseño (tool = 'paper' | 'moki'): conexión global ----
  designTool: (tool) => req(`/api/${tool}`),
  saveDesignTool: (tool, patch) => req(`/api/${tool}`, json('PUT', patch)),
  deleteDesignToolToken: (tool) => req(`/api/${tool}/token`, { method: 'DELETE' }),
  designToolFiles: (tool) => req(`/api/${tool}/files`),
  saveDefaultDesignTool: (tool) => req('/api/design-tools/default', json('PUT', { tool })),

  // ---- proveedores de IA ----
  providers: () => req('/api/providers'),
  providerModels: (id, refresh = false) => req(`/api/providers/${id}/models${refresh ? '?refresh=1' : ''}`),
  saveProviderDefaults: (defaults) => req('/api/providers/defaults', json('PUT', defaults)),
  installProviderCli: (id) => req(`/api/providers/${id}/install`, { method: 'POST' }),
  verifyProvider: (id, model) => req(`/api/providers/${id}/verify`, json('POST', { model })),
  saveProviderCredentials: (id, body) => req(`/api/providers/${id}/credentials`, json('PUT', body)),
  deleteProviderCredentials: (id) => req(`/api/providers/${id}/credentials`, { method: 'DELETE' }),
  startCodexDeviceLogin: () => req('/api/providers/codex/device-login', { method: 'POST' }),
  cancelCodexDeviceLogin: () => req('/api/providers/codex/device-login', { method: 'DELETE' }),
};
