// Cliente MCP mínimo (Streamable HTTP) para las herramientas de diseño. Solo lo
// usa el servidor para tareas puntuales de Ajustes (comprobar el token, listar
// ficheros); los agentes hablan con el MCP directamente desde su CLI.

const PROTOCOL_VERSION = '2025-06-18';

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  // Algunos servidores responden siempre en SSE: el mensaje JSON-RPC es el último `data:`.
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = text.split('\n').filter((line) => line.startsWith('data:')).pop();
    return data ? JSON.parse(data.slice(5).trim()) : null;
  }
  return JSON.parse(text);
}

/**
 * Llama a una herramienta y devuelve el JSON de su último bloque de texto
 * (Paper y Moki anteponen un bloque con la cabecera del fichero).
 * Lanza un error con status 401 si el servidor rechaza el token.
 */
export async function callRemoteTool({ url, token, name, args = {}, timeoutMs = 20000 }) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const post = async (body, sessionId) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) throw Object.assign(new Error('El servidor MCP rechaza el token.'), { status: 401 });
    // Moki responde 403 sin cuerpo si el host con el que se le llama no está en su
    // MOKI_ALLOWED_HOSTS; sin este caso el error llegaba como "Unexpected end of JSON input".
    if (res.status === 403) {
      throw Object.assign(new Error(`El servidor MCP rechaza la petición (403): añade ${new URL(url).host.split(':')[0]} a sus hosts permitidos.`), { status: 403 });
    }
    if (!res.ok && res.status !== 202) throw Object.assign(new Error(`El servidor MCP responde HTTP ${res.status}.`), { status: res.status });
    return { res, json: await parseBody(res) };
  };
  const init = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'cardinal', version: '1' } } });
  if (init.json?.error) throw new Error(init.json.error.message);
  const sessionId = init.res.headers.get('mcp-session-id');
  try {
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
    const call = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, sessionId);
    if (call.json?.error) throw new Error(call.json.error.message);
    const texts = (call.json?.result?.content || []).filter((item) => item.type === 'text');
    const text = texts.at(-1)?.text || '';
    if (call.json?.result?.isError) throw new Error(text || `La herramienta ${name} ha fallado`);
    return JSON.parse(text);
  } finally {
    if (sessionId) fetch(url, { method: 'DELETE', headers: { ...headers, 'Mcp-Session-Id': sessionId } }).catch(() => {});
  }
}
