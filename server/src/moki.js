import { getSetting, setSetting, getSecret, setSecret, deleteSecret, secretSource } from './settings.js';
import { callRemoteTool } from './remote-mcp.js';

// Moki (diseño): servidor propio siempre encendido en la red local (Mac mini)
// que expone su MCP por HTTP con token. A diferencia de Paper no necesita
// puente ni app abierta: el Product OS habla con él directamente.

const TOKEN_SECRET = 'moki-token';
const TOKEN_ENV = 'MOKI_TOKEN';

// Mismo criterio que Paper: consulta de diseños al definir y revisión.
export const MOKI_READ_TOOLS = [
  'list_resources', 'open_file', 'get_basic_info', 'get_selection', 'get_node_info', 'get_children',
  'get_tree_summary', 'find_nodes', 'get_screenshot', 'get_jsx', 'get_computed_styles', 'get_fill_image',
  'get_tokens', 'get_font_family_info', 'get_guide', 'list_comment_threads', 'get_comment_thread',
  'list_comment_thread_authors', 'list_components',
];

// Escritura para el agente de diseño. Diseña siempre con instancias: usa los
// componentes existentes y, si falta uno, lo crea como borrador en la página de
// la card (create_component, convert_to_instances), que pasa a la página de
// componentes al promocionar. Sin detach_instance (deshacer una instancia crea una copia suelta),
// ni tokens, ficheros o exportar: eso lo decide Manu.
export const MOKI_WRITE_TOOLS = [
  'create_page', 'update_pages', 'create_artboard', 'write_html', 'set_text_content', 'rename_nodes',
  'update_styles', 'duplicate_nodes', 'move_nodes', 'delete_nodes', 'finish_working_on_nodes',
  'set_comment_thread_status', 'create_instance', 'reset_overrides', 'create_component',
  'convert_to_instances',
];

export function mokiConfig() {
  const saved = getSetting('moki', {});
  return {
    url: saved.url || process.env.MOKI_URL || '',
    token: getSecret(TOKEN_SECRET, TOKEN_ENV),
    tokenSource: secretSource(TOKEN_SECRET, TOKEN_ENV),
  };
}

// El fichero de diseño es de cada proyecto (projects.design.moki); aquí solo
// se guarda la conexión con el servidor.
export function saveMokiConfig({ url, token }) {
  const next = { ...getSetting('moki', {}) };
  if (url !== undefined) {
    const clean = String(url).trim().replace(/\/+$/, '');
    if (clean && !/^https?:\/\/[^/]+(\/mcp)?$/.test(clean)) {
      throw Object.assign(new Error('La URL debe ser del tipo http://<ip-del-mac-mini>:7410/mcp'), { status: 400 });
    }
    next.url = clean && !clean.endsWith('/mcp') ? `${clean}/mcp` : clean;
  }
  setSetting('moki', next);
  if (token !== undefined && String(token).trim()) setSecret(TOKEN_SECRET, token);
}

export function deleteMokiToken() {
  deleteSecret(TOKEN_SECRET);
}

const baseUrl = (url) => url.replace(/\/mcp$/, '');

async function listResources(config) {
  const data = await callRemoteTool({ url: config.url, token: config.token, name: 'list_resources', args: { limit: 200 } });
  return data.resources || [];
}

/**
 * file: { fileId, fileName } del proyecto. Sin argumento solo se comprueba la
 * conexión (pestaña IA); con él ({} si el proyecto no tiene fichero), también el fichero.
 */
export async function mokiStatus(file) {
  const config = mokiConfig();
  const fileId = file?.fileId || '';
  const base = { configured: Boolean(config.url && config.token), url: config.url, fileId, fileName: file?.fileName || '', tokenSource: config.tokenSource };
  if (!base.configured) return { ...base, server: false, ready: false, message: 'Configura la URL y el token de Moki.' };
  try {
    // /api/health no exige token: confirma que el servidor está vivo.
    const health = await fetch(`${baseUrl(config.url)}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch {
    return { ...base, server: false, ready: false, message: `No hay respuesta de Moki en ${baseUrl(config.url)}: comprueba que el Mac mini y su contenedor están encendidos.` };
  }
  let resources;
  try {
    // Una llamada MCP real valida el token y que el fichero elegido sigue existiendo.
    resources = await listResources(config);
  } catch (e) {
    const message = e.status === 401 ? 'Moki rechaza el token.' : `Moki responde pero su MCP falla: ${e.message}`;
    return { ...base, server: true, ready: false, message };
  }
  if (file === undefined) return { ...base, server: true, ready: true, message: null };
  if (!fileId) return { ...base, server: true, ready: false, message: 'Elige el fichero de diseño del proyecto.' };
  if (!resources.some((item) => item.type === 'file' && item.id === fileId)) {
    return { ...base, server: true, ready: false, message: 'El fichero elegido ya no existe en Moki: elige otro.' };
  }
  return { ...base, server: true, ready: true, message: null };
}

export async function listMokiFiles() {
  const config = mokiConfig();
  if (!config.url || !config.token) throw Object.assign(new Error('Configura la URL y el token de Moki.'), { status: 400 });
  const resources = await listResources(config);
  return resources.filter((item) => item.type === 'file').map((file) => ({ id: file.id, name: file.name }));
}

/** Enlace a una página del fichero en el editor de Moki. */
export function mokiPageUrl(fileId, pageId) {
  return `${baseUrl(mokiConfig().url)}/file/${encodeURIComponent(fileId)}/${encodeURIComponent(pageId)}`;
}

/**
 * Definición del servidor MCP de Moki que se pasa a los CLIs.
 * access: 'read' (consulta y revisión) o 'write' (agente de diseño).
 */
export function mokiMcp(access) {
  const config = mokiConfig();
  return {
    name: 'moki',
    url: config.url,
    token: config.token,
    tools: access === 'write' ? [...MOKI_READ_TOOLS, ...MOKI_WRITE_TOOLS] : MOKI_READ_TOOLS,
  };
}
