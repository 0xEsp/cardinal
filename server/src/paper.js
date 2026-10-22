import { getSetting, setSetting, getSecret, setSecret, deleteSecret, secretSource } from './settings.js';
import { callRemoteTool } from './remote-mcp.js';

// Paper (diseño) vía el puente MCP que corre en el Mac donde está abierta la
// app de Paper (scripts/paper-bridge/). Sin el puente encendido, el Product OS
// de la Raspberry no puede consultar ni pintar diseños.

const TOKEN_SECRET = 'paper-bridge-token';
const TOKEN_ENV = 'PAPER_BRIDGE_TOKEN';

// Herramientas de solo lectura: consulta de diseños al definir y revisión.
export const PAPER_READ_TOOLS = [
  'list_resources', 'open_file', 'get_basic_info', 'get_selection', 'get_node_info', 'get_children',
  'get_tree_summary', 'find_nodes', 'get_screenshot', 'get_jsx', 'get_computed_styles', 'get_fill_image',
  'get_tokens', 'get_font_family_info', 'get_guide', 'list_comment_threads', 'get_comment_thread',
  'list_comment_thread_authors',
];

// Escritura para el agente de diseño. Quedan fuera crear/renombrar ficheros,
// exportar y tocar los tokens del sistema de diseño (eso lo decide Manu).
// update_pages renombra páginas (la promoción marca la de la card para borrar).
export const PAPER_WRITE_TOOLS = [
  'create_page', 'update_pages', 'create_artboard', 'write_html', 'set_text_content', 'rename_nodes',
  'update_styles', 'duplicate_nodes', 'move_nodes', 'delete_nodes', 'finish_working_on_nodes',
  'set_comment_thread_status',
];

export function paperConfig() {
  const saved = getSetting('paper', {});
  return {
    url: saved.url || process.env.PAPER_BRIDGE_URL || '',
    fileId: saved.fileId || process.env.PAPER_FILE_ID || '',
    fileName: saved.fileName || '',
    token: getSecret(TOKEN_SECRET, TOKEN_ENV),
    tokenSource: secretSource(TOKEN_SECRET, TOKEN_ENV),
  };
}

export function savePaperConfig({ url, token, fileId, fileName }) {
  const current = getSetting('paper', {});
  const next = { ...current };
  if (url !== undefined) {
    const clean = String(url).trim().replace(/\/+$/, '');
    if (clean && !/^https?:\/\/[^/]+(\/mcp)?$/.test(clean)) {
      throw Object.assign(new Error('La URL debe ser del tipo http://<ip-del-mac>:4410/mcp'), { status: 400 });
    }
    next.url = clean && !clean.endsWith('/mcp') ? `${clean}/mcp` : clean;
  }
  if (fileId !== undefined) {
    next.fileId = String(fileId).trim();
    next.fileName = String(fileName || '').trim();
  }
  setSetting('paper', next);
  if (token !== undefined && String(token).trim()) setSecret(TOKEN_SECRET, token);
}

export function deletePaperToken() {
  deleteSecret(TOKEN_SECRET);
}

function healthUrl(url) {
  return url.replace(/\/mcp$/, '/health');
}

export async function paperStatus() {
  const config = paperConfig();
  const base = { configured: Boolean(config.url && config.token), url: config.url, fileId: config.fileId, fileName: config.fileName, tokenSource: config.tokenSource };
  if (!base.configured) return { ...base, bridge: false, paperApp: false, ready: false, message: 'Configura la URL y el token del puente de Paper.' };
  try {
    const res = await fetch(healthUrl(config.url), {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401) return { ...base, bridge: true, paperApp: false, ready: false, message: 'El puente rechaza el token.' };
    const health = await res.json();
    const ready = Boolean(health.paperApp && config.fileId);
    return {
      ...base,
      bridge: true,
      paperApp: Boolean(health.paperApp),
      host: health.host,
      ready,
      message: !health.paperApp
        ? 'El puente está encendido pero la app de Paper no está abierta en el Mac.'
        : !config.fileId ? 'Elige el fichero de diseño de Gotty.' : null,
    };
  } catch {
    return {
      ...base,
      bridge: false,
      paperApp: false,
      ready: false,
      message: 'No hay respuesta del puente de Paper: en el Mac, levántalo con `node scripts/paper-bridge/paper-bridge.mjs` y abre Paper.',
    };
  }
}

export async function listPaperFiles() {
  const status = await paperStatus();
  if (!status.bridge || !status.paperApp) throw Object.assign(new Error(status.message), { status: 400 });
  const config = paperConfig();
  const data = await callRemoteTool({ url: config.url, token: config.token, name: 'list_resources' });
  return (data.resources || []).filter((item) => item.type === 'file').map((file) => ({ id: file.id, name: file.name }));
}

export function paperPageUrl(fileId, pageId) {
  return `https://app.paper.design/file/${encodeURIComponent(fileId)}/${encodeURIComponent(pageId)}`;
}

/**
 * Definición del servidor MCP de Paper que se pasa a los CLIs.
 * access: 'read' (consulta y revisión) o 'write' (agente de diseño).
 */
export function paperMcp(access) {
  const config = paperConfig();
  return {
    name: 'paper',
    url: config.url,
    token: config.token,
    tools: access === 'write' ? [...PAPER_READ_TOOLS, ...PAPER_WRITE_TOOLS] : PAPER_READ_TOOLS,
  };
}
