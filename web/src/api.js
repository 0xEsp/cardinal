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

export const api = {
  config: () => req('/api/config'),
  cards: () => req('/api/cards'),
  createCard: (title) => req('/api/cards', json('POST', { title })),
  updateCard: (id, patch) => req(`/api/cards/${id}`, json('PUT', patch)),
  moveCard: (id, column, beforeId = null) => req(`/api/cards/${id}/move`, json('POST', { column, beforeId })),
  cardPrompt: (id) => req(`/api/cards/${id}/prompt`),
  comments: (id) => req(`/api/cards/${id}/comments`),
  createComment: (id, content) => req(`/api/cards/${id}/comments`, json('POST', { content })),
  deleteComment: (id, commentId) => req(`/api/cards/${id}/comments/${commentId}`, { method: 'DELETE' }),
  deleteCard: (id) => req(`/api/cards/${id}`, { method: 'DELETE' }),
  docs: () => req('/api/docs'),
  docContent: (path) => req(`/api/docs/content?path=${encodeURIComponent(path)}`),
  saveDoc: (path, content) => req('/api/docs/content', json('PUT', { path, content })),
  agentRuns: (cardId) => req(`/api/cards/${cardId}/agent-runs`),
  startAgent: (cardId, model) => req(`/api/agent/${cardId}/start`, json('POST', { model })),
  sendMessage: (cardId, content) => req(`/api/agent/${cardId}/message`, json('POST', { content })),
  session: (cardId) => req(`/api/agent/${cardId}`),
  gitStatus: () => req('/api/git/status'),
  gitPull: () => req('/api/git/pull', { method: 'POST' }),
  gitPush: () => req('/api/git/push', json('POST', {})),
};
