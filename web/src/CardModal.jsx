import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import { api } from './api.js';
import AgentPanel from './AgentPanel.jsx';

const STACKS = ['app', 'web', 'backend'];

export default function CardModal({ card, config, onClose, onChanged, showToast }) {
  const [draft, setDraft] = useState(card.draft);
  const [version, setVersion] = useState(card.version || '');
  const [tab, setTab] = useState('draft');
  const [defRaw, setDefRaw] = useState(false);

  useEffect(() => {
    setDraft(card.draft);
    setVersion(card.version || '');
  }, [card.id]);

  const save = async (patch) => {
    try {
      await api.updateCard(card.id, patch);
      onChanged();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const toggleStack = (s) => {
    const next = card.stack.includes(s) ? card.stack.filter((x) => x !== s) : [...card.stack, s];
    save({ stack: next });
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Borrar la card "${card.title}"?`)) return;
    try {
      await api.deleteCard(card.id);
      onClose();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const agentMode = card.column === 'done-dev' ? 'document' : card.column === 'done' ? null : 'define';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <input
            className="modal-title"
            defaultValue={card.title}
            onBlur={(e) => e.target.value.trim() !== card.title && save({ title: e.target.value.trim() })}
          />
          <button className="btn ghost" onClick={handleDelete}>🗑</button>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>

        <div className="props">
          <span className="prop-label">Stack:</span>
          {STACKS.map((s) => (
            <button
              key={s}
              className={card.stack.includes(s) ? `chip stack-${s} on` : 'chip off'}
              onClick={() => toggleStack(s)}
            >
              {s}
            </button>
          ))}
          <span className="prop-label">Versión:</span>
          <input
            className="version-input"
            value={version}
            placeholder="—"
            onChange={(e) => setVersion(e.target.value)}
            onBlur={() => save({ version: version.trim() || null })}
          />
          <span className="prop-label">Columna:</span>
          <span className="chip">{card.column}</span>
        </div>

        <div className="modal-tabs">
          <button className={tab === 'draft' ? 'tab active' : 'tab'} onClick={() => setTab('draft')}>Borrador</button>
          <button className={tab === 'definition' ? 'tab active' : 'tab'} onClick={() => setTab('definition')}>
            Definición IA {card.definition ? '✦' : ''}
          </button>
          <button className={tab === 'agent' ? 'tab active' : 'tab'} onClick={() => setTab('agent')}>Agente</button>
        </div>

        <div className="modal-body">
          {tab === 'draft' && (
            <textarea
              className="draft-editor"
              value={draft}
              placeholder="Escribe aquí tu borrador: qué quieres, casuísticas que se te ocurran, notas técnicas…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== card.draft && save({ draft })}
            />
          )}

          {tab === 'definition' && (
            <div className="definition-view">
              {card.definition ? (
                <>
                  <div className="def-toolbar">
                    <button className="btn ghost" onClick={() => setDefRaw(!defRaw)}>
                      {defRaw ? 'Ver renderizado' : 'Ver markdown'}
                    </button>
                    <button className="btn ghost" onClick={() => { navigator.clipboard.writeText(card.definition); showToast('Definición copiada'); }}>
                      ⧉ Copiar
                    </button>
                  </div>
                  {defRaw ? (
                    <pre className="md-raw">{card.definition}</pre>
                  ) : (
                    <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.definition) }} />
                  )}
                </>
              ) : (
                <p className="empty">Aún no hay definición. Lanza el agente desde la pestaña "Agente".</p>
              )}
            </div>
          )}

          {tab === 'agent' && (
            <AgentPanel card={card} config={config} mode={agentMode} onChanged={onChanged} showToast={showToast} />
          )}
        </div>
      </div>
    </div>
  );
}
