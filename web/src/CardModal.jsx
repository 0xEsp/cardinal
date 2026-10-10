import React, { useCallback, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { api } from './api.js';
import { copyText } from './clipboard.js';
import AgentPanel from './AgentPanel.jsx';
import AgentRuns from './AgentRuns.jsx';
import DesignPanel from './DesignPanel.jsx';

const STACKS = ['app', 'web', 'backend'];

export default function CardModal({ card, config, onClose, onChanged, showToast }) {
  const [draft, setDraft] = useState(card.draft);
  const [draftDirty, setDraftDirty] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState(card.definition);
  const [versions, setVersions] = useState({});
  const [tab, setTab] = useState('draft');
  const [editingDefinition, setEditingDefinition] = useState(false);
  const draftRef = useRef(card.draft);
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    draftRef.current = card.draft;
    draftDirtyRef.current = false;
    setDraftDirty(false);
    setDraft(card.draft);
    setDefinitionDraft(card.definition);
    setVersions(Object.fromEntries(card.stacks.map((s) => [s.name, s.version || ''])));
  }, [card.id]);

  useEffect(() => {
    if (!draftDirtyRef.current) {
      draftRef.current = card.draft;
      setDraft(card.draft);
    }
  }, [card.draft]);

  useEffect(() => {
    if (!editingDefinition) setDefinitionDraft(card.definition);
  }, [card.definition, editingDefinition]);

  useEffect(() => {
    setVersions(Object.fromEntries(card.stacks.map((s) => [s.name, s.version || ''])));
  }, [card.stacks]);

  const save = useCallback(async (patch) => {
    try {
      await api.updateCard(card.id, patch);
      await onChanged();
      return true;
    } catch (e) {
      showToast(e.message, true);
      return false;
    }
  }, [card.id, onChanged, showToast]);

  const persistDraft = useCallback(async (value) => {
    if (!draftDirtyRef.current) return true;
    if (value === card.draft) {
      draftDirtyRef.current = false;
      setDraftDirty(false);
      return true;
    }
    const ok = await save({ draft: value });
    if (ok && draftRef.current === value) {
      draftDirtyRef.current = false;
      setDraftDirty(false);
    }
    return ok;
  }, [card.draft, save]);

  useEffect(() => {
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') void persistDraft(draftRef.current);
    };
    const persistOnPageHide = () => void persistDraft(draftRef.current);
    document.addEventListener('visibilitychange', persistWhenHidden);
    window.addEventListener('pagehide', persistOnPageHide);
    return () => {
      document.removeEventListener('visibilitychange', persistWhenHidden);
      window.removeEventListener('pagehide', persistOnPageHide);
    };
  }, [persistDraft]);

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

  const saveDefinition = async () => {
    if (definitionDraft === card.definition) {
      setEditingDefinition(false);
      return;
    }
    if (await save({ definition: definitionDraft })) {
      setEditingDefinition(false);
      showToast('Definición IA + actualizada');
    }
  };

  if (card.column === 'done-dev') {
    const documented = card.documentationStatus === 'documented';
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal documentation-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div className="documentation-heading">
              <span className={documented ? 'documentation-state documented' : 'documentation-state pending'}>
                {documented ? '✓ Documentada' : '● Pendiente de documentar'}
              </span>
              <h2>{card.title}</h2>
            </div>
            <button className="btn ghost" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body documentation-body">
            <AgentPanel
              card={card}
              config={config}
              mode="document"
              documentOnly
              onChanged={onChanged}
              showToast={showToast}
            />
            {card.design && (
              <details className="design-promote" open={card.designStatus === 'ready'}>
                <summary>Diseño en Paper · {card.designStatus === 'promoted' ? 'promocionado' : card.designStatus === 'stale' ? 'desactualizado' : 'pendiente de promocionar'}</summary>
                <DesignPanel card={card} config={config} onChanged={onChanged} showToast={showToast} promote />
              </details>
            )}
            <AgentRuns cardId={card.id} compact />
          </div>
        </div>
      </div>
    );
  }

  const agentMode = card.column === 'done' ? null : 'define';

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
            Definición IA + {card.definition ? '✦' : ''}
          </button>
          <button className={tab === 'comments' ? 'tab active' : 'tab'} onClick={() => setTab('comments')}>
            Comentarios{card.commentCount ? ` ${card.commentCount}` : ''}
          </button>
          <button className={tab === 'agent' ? 'tab active' : 'tab'} onClick={() => setTab('agent')}>Agente</button>
          {agentMode && (
            <button className={tab === 'design' ? 'tab active' : 'tab'} onClick={() => setTab('design')}>
              Diseño{card.designStatus === 'stale' ? ' ⚠' : card.design ? ' 🎨' : ''}
            </button>
          )}
          <button className={tab === 'runs' ? 'tab active' : 'tab'} onClick={() => setTab('runs')}>Ejecuciones</button>
        </div>

        <div className="modal-body">
          {tab === 'draft' && (
            <div className="draft-view">
              <textarea
                className="draft-editor"
                value={draft}
                placeholder="Escribe aquí tu borrador: qué quieres, casuísticas que se te ocurran, notas técnicas…"
                onChange={(e) => {
                  draftRef.current = e.target.value;
                  draftDirtyRef.current = true;
                  setDraftDirty(true);
                  setDraft(e.target.value);
                }}
                onBlur={() => void persistDraft(draftRef.current)}
              />
              {draftDirty && <span className="draft-save-state">Cambios pendientes · se guardarán al salir o al cambiar de pestaña</span>}
            </div>
          )}

          {tab === 'definition' && (
            <div className="definition-view">
              {card.definition ? (
                <>
                  <div className="def-toolbar">
                    {editingDefinition ? (
                      <>
                        <button className="btn primary" onClick={saveDefinition}>Guardar cambios</button>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setDefinitionDraft(card.definition);
                            setEditingDefinition(false);
                          }}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn primary" onClick={copyAsPrompt}>⧉ Copiar como prompt</button>
                        <button className="btn" onClick={() => setEditingDefinition(true)}>✎ Editar markdown</button>
                        <button className="btn ghost" onClick={copyDefinition}>⧉ Copiar md</button>
                      </>
                    )}
                  </div>
                  {editingDefinition ? (
                    <textarea
                      className="definition-editor"
                      value={definitionDraft}
                      onChange={(e) => setDefinitionDraft(e.target.value)}
                      aria-label="Editar Definición IA + en markdown"
                    />
                  ) : (
                    <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.definition) }} />
                  )}
                </>
              ) : (
                <p className="empty">Aún no hay definición. Lanza el agente desde la pestaña "Agente".</p>
              )}
            </div>
          )}

          {tab === 'comments' && (
            <CommentsPanel card={card} onChanged={onChanged} showToast={showToast} />
          )}

          {tab === 'agent' && (
            <AgentPanel card={card} config={config} mode={agentMode} onChanged={onChanged} showToast={showToast} />
          )}

          {tab === 'design' && agentMode && (
            <DesignPanel card={card} config={config} onChanged={onChanged} showToast={showToast} />
          )}

          {tab === 'runs' && <AgentRuns cardId={card.id} />}
        </div>
      </div>
    </div>
  );
}

function CommentsPanel({ card, onChanged, showToast }) {
  const [comments, setComments] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadComments = async () => {
    setLoading(true);
    try {
      setComments(await api.comments(card.id));
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComments();
  }, [card.id]);

  const addComment = async (event) => {
    event.preventDefault();
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const comment = await api.createComment(card.id, content);
      setComments((current) => [...current, comment]);
      setContent('');
      await onChanged();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setSaving(false);
    }
  };

  const removeComment = async (commentId) => {
    if (!window.confirm('¿Eliminar este comentario?')) return;
    try {
      await api.deleteComment(card.id, commentId);
      setComments((current) => current.filter((comment) => comment.id !== commentId));
      await onChanged();
    } catch (error) {
      showToast(error.message, true);
    }
  };

  return (
    <div className="comments-panel">
      <div className="comments-list">
        {loading && <p className="empty">Cargando comentarios…</p>}
        {!loading && comments.length === 0 && (
          <p className="empty">Aún no hay comentarios. Añade contexto, decisiones o notas para esta card.</p>
        )}
        {comments.map((comment) => (
          <article className="comment" key={comment.id}>
            <div className="comment-avatar" aria-hidden="true">M</div>
            <div className="comment-content">
              <div className="comment-meta">
                <strong>Manu</strong>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
                <button className="comment-delete" onClick={() => removeComment(comment.id)} aria-label="Eliminar comentario">
                  ✕
                </button>
              </div>
              <p>{comment.content}</p>
            </div>
          </article>
        ))}
      </div>
      <form className="comment-composer" onSubmit={addComment}>
        <div className="comment-avatar" aria-hidden="true">M</div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Añade un comentario…"
          aria-label="Nuevo comentario"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') addComment(event);
          }}
        />
        <button className="btn primary" type="submit" disabled={!content.trim() || saving}>
          {saving ? 'Guardando…' : 'Comentar'}
        </button>
      </form>
    </div>
  );
}
