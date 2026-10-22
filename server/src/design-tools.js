import { getSetting, setSetting } from './settings.js';
import { paperConfig, paperMcp, paperPageUrl, paperStatus } from './paper.js';
import { mokiConfig, mokiMcp, mokiPageUrl, mokiStatus } from './moki.js';

// Herramientas de diseño intercambiables. Paper y Moki son alternativas: cada
// card queda ligada a la herramienta con la que se diseñó, y la herramienta por
// defecto (pestaña IA) se usa para las cards nuevas y para consultar diseños.

export const DESIGN_TOOLS = {
  paper: { id: 'paper', label: 'Paper', status: paperStatus, config: paperConfig, mcp: paperMcp, pageUrl: paperPageUrl },
  moki: { id: 'moki', label: 'Moki', status: mokiStatus, config: mokiConfig, mcp: mokiMcp, pageUrl: mokiPageUrl },
};

export function getDesignTool(id) {
  const tool = DESIGN_TOOLS[id];
  if (!tool) throw Object.assign(new Error(`Herramienta de diseño desconocida: ${id}`), { status: 400 });
  return tool;
}

/** Herramienta de un diseño guardado: los manifiestos anteriores a Moki son de Paper. */
export function designToolOf(design) {
  return design?.tool && DESIGN_TOOLS[design.tool] ? design.tool : 'paper';
}

export function defaultDesignTool() {
  const saved = getSetting('designTool', null);
  return DESIGN_TOOLS[saved] ? saved : 'paper';
}

export function saveDefaultDesignTool(id) {
  setSetting('designTool', getDesignTool(id).id);
}

export async function designToolsStatus() {
  const entries = await Promise.all(Object.values(DESIGN_TOOLS).map(async (tool) => [tool.id, { label: tool.label, ...(await tool.status()) }]));
  return { default: defaultDesignTool(), tools: Object.fromEntries(entries) };
}
