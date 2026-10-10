import React from 'react';
import AgentPanel from './AgentPanel.jsx';

const STATUS = {
  none: { label: 'Sin diseño', className: 'pending' },
  ready: { label: '✓ Diseño al día con la definición', className: 'documented' },
  stale: { label: '⚠ Desactualizado: la definición ha cambiado', className: 'stale' },
  promoted: { label: '✓ Promocionado a las páginas canónicas', className: 'documented' },
};

/**
 * Pestaña Diseño de una card: manifiesto en Paper + agente de diseño (slot
 * "design"). En Done Dev (`promote`) solo permite promocionar.
 */
export default function DesignPanel({ card, config, onChanged, showToast, promote = false }) {
  const design = card.design;
  const status = STATUS[card.designStatus] || STATUS.none;
  const paper = config.paper || {};
  const hasCli = config.providers.some((p) => p.kind === 'cli' && p.ready);

  const actions = promote
    ? [{
      task: 'promote',
      label: '⤴ Promocionar diseño',
      primary: true,
      disabled: !design || card.designStatus !== 'ready',
      title: card.designStatus === 'stale' ? 'Rediseña antes de promocionar: la definición ha cambiado' : undefined,
    }]
    : [
      { task: 'design', label: design ? '↻ Rediseñar' : '▶ Diseñar', primary: true, disabled: !card.definition.trim() },
      { task: 'comments', label: '💬 Aplicar comentarios de Paper', disabled: !design, title: 'Lee los hilos abiertos en Paper sobre estos artboards y los aplica' },
    ];

  return (
    <div className="design-panel">
      <div className="design-summary">
        <span className={`documentation-state ${status.className}`}>{status.label}</span>
        {design && (
          <>
            <a className="design-link" href={design.pageUrl} target="_blank" rel="noreferrer">
              Abrir en Paper · {design.pageName || design.pageId} ↗
            </a>
            <table className="design-artboards">
              <thead>
                <tr><th>Artboard</th><th>Plataforma</th><th>Cubre</th></tr>
              </thead>
              <tbody>
                {design.artboards.map((artboard) => (
                  <tr key={artboard.id}>
                    <td>{artboard.pageUrl ? <a href={artboard.pageUrl} target="_blank" rel="noreferrer">{artboard.name}</a> : artboard.name}</td>
                    <td>{artboard.platform || '—'}</td>
                    <td>{artboard.covers.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {design.notes && <p className="provider-help">Notas: {design.notes}</p>}
            {card.designStatus === 'promoted' && (
              <p className="provider-help">
                Paper no permite borrar páginas por MCP: borra a mano la página vacía <code>30 · Card · {card.title} · promocionada, borrar</code>.
              </p>
            )}
          </>
        )}
      </div>

      {!paper.ready && (
        <p className="provider-warning">
          Paper no está disponible: {paper.message || 'configúralo en la pestaña IA.'} Levanta el puente en el Mac con
          {' '}<code>node scripts/paper-bridge/paper-bridge.mjs</code> y abre la app de Paper.
        </p>
      )}
      {!hasCli && <p className="provider-warning">El agente de diseño necesita Codex o Claude configurados en la pestaña IA.</p>}
      {!card.definition.trim() && <p className="empty">Esta card necesita una Definición IA + antes de diseñarse.</p>}

      <AgentPanel
        card={card}
        config={config}
        mode="design"
        slot="design"
        actions={actions}
        emptyText={promote
          ? 'El agente moverá los artboards aprobados a las páginas canónicas de su flujo y archivará la página de la card.'
          : 'El agente pintará en Paper cada casuística de la definición. Para corregir, escríbele aquí o comenta en Paper y pulsa "Aplicar comentarios".'}
        onChanged={onChanged}
        showToast={showToast}
      />
    </div>
  );
}
