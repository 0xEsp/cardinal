import { deleteSecret, getSecret, secretSource, setSecret } from '../settings.js';

// OpenRouter por API key (pago por uso). El bucle de herramientas de este
// proveedor vive en agent.js porque es el propio harness quien lo ejecuta.

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_SECRET = 'openrouter-api-key';
const KEY_ENV = 'OPENROUTER_API_KEY';

let modelCache = { at: 0, models: null };

export const openrouter = {
  id: 'openrouter',
  label: 'OpenRouter (API key)',
  kind: 'api',
  // Getter: index.js carga el .env después de importar este módulo.
  get defaultModel() {
    return process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
  },

  // Tu selección (OPENROUTER_MODEL + MODELS del .env) sale siempre primero.
  featuredModels() {
    const configured = (process.env.MODELS || '').split(',').map((id) => id.trim()).filter(Boolean);
    return [...new Set([this.defaultModel, ...configured, 'deepseek/deepseek-v4.1-flash', 'openai/gpt-5.6-luna'])];
  },

  apiKey() {
    return getSecret(KEY_SECRET, KEY_ENV);
  },

  async status() {
    const keySource = secretSource(KEY_SECRET, KEY_ENV);
    return {
      keySource,
      ready: Boolean(keySource),
      message: keySource ? null : 'Añade tu API key de OpenRouter.',
    };
  },

  saveKey(key) {
    if (!/^sk-or-/.test(String(key || '').trim())) {
      throw Object.assign(new Error('Eso no parece una API key de OpenRouter (empieza por sk-or-…)'), { status: 400 });
    }
    setSecret(KEY_SECRET, key);
  },

  logout() {
    deleteSecret(KEY_SECRET);
  },

  // Primero tus modelos (featured) y después el catálogo en vivo con los que
  // admiten tool calling, los más nuevos primero. Si OpenRouter no responde,
  // quedan al menos tus modelos.
  async listModels({ refresh = false } = {}) {
    const featuredIds = this.featuredModels();
    let catalog = modelCache.models;
    if (refresh || !catalog || Date.now() - modelCache.at > 60 * 60 * 1000) {
      try {
        const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        catalog = data
          .filter((model) => (model.supported_parameters || []).includes('tools'))
          .sort((a, b) => (b.created || 0) - (a.created || 0))
          .map((model) => ({ id: model.id, label: model.name || model.id }));
        modelCache = { at: Date.now(), models: catalog };
      } catch {
        catalog ||= [];
      }
    }
    const labels = new Map(catalog.map((model) => [model.id, model.label]));
    return [
      ...featuredIds.map((id) => ({ id, label: labels.get(id) || id, featured: true })),
      ...catalog.filter((model) => !featuredIds.includes(model.id)),
    ];
  },

  async complete({ system, user, model, signal }) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'gotty-product-os-reviewer',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content;
  },
};
