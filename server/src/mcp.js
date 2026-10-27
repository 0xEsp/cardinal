import crypto from 'node:crypto';
import express from 'express';

// Servidor MCP mínimo (Streamable HTTP sin estado, respuestas JSON) que expone
// las herramientas del harness a los CLIs de Codex y Claude. Cada ejecución
// abre un canal con un token aleatorio ligado a una card; el CLI solo ve las
// herramientas de su modo y no puede tocar otras cards.

const channels = new Map(); // token -> { tools, call }
const READ_ONLY = new Set(['list_docs', 'search_docs', 'read_doc', 'review_definition', 'review_doc']);

export const MCP_SERVER_NAME = 'productos';

export function openMcpChannel({ tools, call }) {
  const token = crypto.randomBytes(24).toString('hex');
  channels.set(token, {
    call,
    tools: tools.map(({ function: fn }) => ({
      name: fn.name,
      description: fn.description,
      inputSchema: fn.parameters,
      annotations: {
        readOnlyHint: READ_ONLY.has(fn.name),
        destructiveHint: false,
        idempotentHint: READ_ONLY.has(fn.name),
        openWorldHint: false,
      },
    })),
  });
  return token;
}

export function closeMcpChannel(token) {
  if (token) channels.delete(token);
}

export function mcpUrl(token) {
  return `http://127.0.0.1:${process.env.PORT || 4400}/mcp/${token}`;
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const INTERNAL_INFO = {
  serverInfo: { name: 'cardinal', version: '2.0.0' },
  instructions: 'Herramientas de Cardinal para investigar, revisar y guardar definiciones y documentación de la card.',
};

/**
 * JSON-RPC de MCP (Streamable HTTP sin estado, respuestas JSON). Lo comparten
 * el canal interno de los agentes de cada card y el MCP para agentes externos.
 * channel: { tools, call(name, args), info: { serverInfo, instructions } }
 */
export async function handleRpc(channel, message) {
  const { id, method, params } = message || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });

  if (id === undefined || id === null) return null; // notificación: no lleva respuesta
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        ...(channel.info || INTERNAL_INFO),
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: channel.tools });
    case 'tools/call': {
      const name = params?.name;
      if (!channel.tools.some((tool) => tool.name === name)) return fail(-32602, `Herramienta desconocida: ${name}`);
      try {
        const text = await channel.call(name, params?.arguments || {});
        const isError = /^(ERROR|VALIDATION_ERROR|REVIEW_REQUIRED)/.test(text);
        return reply({ content: [{ type: 'text', text }], isError });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: `ERROR: ${error.message}` }], isError: true });
      }
    }
    case 'resources/list':
      return reply({ resources: [] });
    case 'prompts/list':
      return reply({ prompts: [] });
    default:
      return fail(-32601, `Método no soportado: ${method}`);
  }
}

export function mcpRouter() {
  const router = express.Router();
  router.all('/mcp/:token', async (req, res) => {
    // Solo los CLIs que corren dentro del mismo contenedor pueden llamar.
    if (!isLoopback(req)) return res.status(403).end();
    const channel = channels.get(req.params.token);
    if (!channel) return res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Canal MCP cerrado' } });
    if (req.method === 'DELETE') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();

    const batch = Array.isArray(req.body);
    const messages = batch ? req.body : [req.body];
    const replies = (await Promise.all(messages.map((message) => handleRpc(channel, message)))).filter(Boolean);
    if (!replies.length) return res.status(202).end();
    res.json(batch ? replies : replies[0]);
  });
  return router;
}
