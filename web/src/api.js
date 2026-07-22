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
  deleteCard: (id) => req(`/api/cards/${id}`, { method: 'DELETE' }),
  docs: () => req('/api/docs'),
  docContent: (path) => req(`/api/docs/content?path=${encodeURIComponent(path)}`),
  startAgent: (cardId, model) => req(`/api/agent/${cardId}/start`, json('POST', { model })),
  sendMessage: (cardId, content) => req(`/api/agent/${cardId}/message`, json('POST', { content })),
  session: (cardId) => req(`/api/agent/${cardId}`),
  gitStatus: () => req('/api/git/status'),
  gitPull: () => req('/api/git/pull', { method: 'POST' }),
  gitPush: () => req('/api/git/push', json('POST', {})),
};
