import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import { api } from './api.js';
import { copyText } from './clipboard.js';
import AgentPanel from './AgentPanel.jsx';

const STACKS = ['app', 'web', 'backend'];

export default function CardModal({ card, config, onClose, onChanged, showToast }) {
  const [draft, setDraft] = useState(card.draft);
  const [versions, setVersions] = useState({});
  const [tab, setTab] = useState('draft');
  const [defRaw, setDefRaw] = useState(false);

  useEffect(() => {
    setDraft(card.draft);
    setVersions(Object.fromEntries(card.stacks.map((s) => [s.name, s.version || ''])));
  }, [card.id, card.stacks]);

  const save = async (patch) => {
    try {
      await api.updateCard(card.id, patch);
      onChanged();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const activeStacks = card.stacks.map((s) => s.name);

  const toggleStack = (name) => {
    const next = activeStacks.includes(name)
      ? card.stacks.filter((s) => s.name !== name)
      : [...card.stacks, { name, version: null }];
    save({ stacks: next });
  };

  const saveVersion = (name) => {
    const next = card.stacks.map((s) => (s.name === name ? { ...s, version: versions[name]?.trim() || null } : s));
    save({ stacks: next });
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

  const copyDefinition = async () => {
    await copyText(card.definition);
    showToast('Definición copiada');
  };

  const copyAsPrompt = async () => {
    try {
      const { prompt } = await api.cardPrompt(card.id);
      await copyText(prompt);
      showToast('Prompt copiado — pégalo en el feature-builder del proyecto');
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
          <span className="prop-label">Stacks:</span>
          {STACKS.map((name) => (
            <span key={name} className="stack-prop">
              <button
                className={activeStacks.includes(name) ? `chip stack-${name} on` : 'chip off'}
                onClick={() => toggleStack(name)}
              >
                {name}
              </button>
              {activeStacks.includes(name) && (
                <input
                  className="version-input"
                  value={versions[name] || ''}
                  placeholder="vers."
                  title={`Versión de ${name}`}
                  onChange={(e) => setVersions({ ...versions, [name]: e.target.value })}
                  onBlur={() => saveVersion(name)}
                />
              )}
            </span>
          ))}
          <span className="prop-label">Columna:</span>
          <select
            className="version-select"
            value={card.column}
            onChange={(e) => save({ column: e.target.value })}
          >
            {['backlog', 'todo', 'in-progress', 'done-dev', 'done'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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
                    <button className="btn primary" onClick={copyAsPrompt}>⧉ Copiar como prompt</button>
                    <button className="btn ghost" onClick={() => setDefRaw(!defRaw)}>
                      {defRaw ? 'Ver renderizado' : 'Ver markdown'}
                    </button>
                    <button className="btn ghost" onClick={copyDefinition}>⧉ Copiar md</button>
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
