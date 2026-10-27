import React from 'react';
import { href } from './router.js';

const STATUS = {
  none: { label: 'SIN DISEÑO', tone: 'muted' },
  ready: { label: '✓ AL DÍA CON LA DEFINICIÓN', tone: 'ok' },
  stale: { label: '! DESACTUALIZADO: LA DEFINICIÓN HA CAMBIADO', tone: 'warn' },
  promoted: { label: '✓ PROMOCIONADO A LAS PÁGINAS DE LA FEATURE', tone: 'ok' },
};

/** Tareas del agente de diseño. En la columna de documentación solo se promociona. */
export function designActions(card, tool, promote) {
  const design = card.design;
  if (promote) {
    return [{
      task: 'promote',
      label: 'Promocionar diseño',
      primary: true,
      disabled: !design || card.designStatus !== 'ready',
      title: card.designStatus === 'stale' ? 'Rediseña antes de promocionar: la definición ha cambiado' : undefined,
    }];
  }
  return [
    { task: 'design', label: design ? 'Rediseñar' : 'Diseñar', primary: true, disabled: !card.definition.trim() },
    { task: 'comments', label: `Aplicar comentarios de ${tool.label}`, disabled: !design, title: `Lee los hilos abiertos en ${tool.label} y los aplica` },
  ];
}

/**
 * Pestaña Diseño: manifiesto de la card en Paper o Moki. El agente de diseño
 * vive en la consola de la derecha (slot "design"). Una card sin diseño elige
 * herramienta; con diseño, sigue en la suya.
 */
export default function DesignPanel({ card, tools, tool: chosen, setTool, promote, project }) {
  const design = card.design;
  const status = STATUS[card.designStatus] || STATUS.none;
  const toolId = design?.tool || chosen;
  const available = tools?.tools || {};
  const tool = available[toolId] || { label: toolId };

  return (
    <div className="design-tab">
      <p className={`status mono ${status.tone}`}>{status.label}</p>

      {!design && !promote && (
        <div className="field">
          <span className="mono small muted">DISEÑAR EN</span>
          <div className="segmented">
            {Object.entries(available).map(([id, option]) => (
              <button key={id} className={id === toolId ? 'on' : ''} onClick={() => setTool(id)}>
                {option.label}{option.ready ? '' : ' · no disponible'}
              </button>
            ))}
          </div>
        </div>
      )}

      {tools && !tool.ready && (
        <p className="notice warn">
          {tool.label} no está disponible: {tool.message || 'configúralo en IA y diseño.'}{' '}
          {tool.server !== false && tool.bridge !== false && !tool.fileId
            ? <a href={href({ projectId: project.id, view: 'settings' })}>Elige el fichero de diseño del proyecto</a>
            : <a href="#/ai">Revisa la conexión</a>}
        </p>
      )}
      {!card.definition.trim() && <p className="notice">La card necesita una Definición IA antes de diseñarse.</p>}

      {design && (
        <>
          <a className="btn" href={design.pageUrl} target="_blank" rel="noreferrer">
            Abrir en {tool.label} · {design.pageName || design.pageId} ↗
          </a>
          <table className="table">
            <thead>
              <tr><th>ARTBOARD</th><th>PLATAFORMA</th><th>CUBRE</th></tr>
            </thead>
            <tbody>
              {design.artboards.map((artboard) => (
                <tr key={artboard.id}>
                  <td>{artboard.pageUrl ? <a href={artboard.pageUrl} target="_blank" rel="noreferrer">{artboard.name}</a> : artboard.name}</td>
                  <td className="mono small">{artboard.platform || '—'}</td>
                  <td>{artboard.covers.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {design.notes && <p className="muted">Notas: {design.notes}</p>}
          {card.designStatus === 'promoted' && (
            <p className="notice">
              {tool.label} no permite borrar páginas por MCP: borra a mano la página vacía de la card (renombrada con «promocionada, borrar»).
            </p>
          )}
        </>
      )}
    </div>
  );
}
