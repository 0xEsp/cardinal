import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { copyText } from './clipboard.js';
import { href, navigate } from './router.js';
import AgentPanel from './AgentPanel.jsx';
import AgentRuns from './AgentRuns.jsx';
import DesignPanel, { designActions } from './DesignPanel.jsx';
import { Lifecycle, Markdown, StackChip, formatDate } from './ui.jsx';

/**
 * Card a pantalla completa (Moki · D · Card + agente): contenido a la
 * izquierda y consola del agente siempre visible a la derecha.
 */
export default function CardView({ project, card, config, onChanged, showToast }) {
  const column = project.columns.find((c) => c.id === card.column);
  const mode = column?.mode ?? null;
  const [tab, setTab] = useState(card.definition ? 'definition' : 'draft');
  const [designTools, setDesignTools] = useState(null);
  const [designTool, setDesignTool] = useState(card.design?.tool || config.designTools?.default || 'moki');
  const [consoleOpen, setConsoleOpen] = useState(false);

  useEffect(() => {
    api.projectDesignTools(project.id).then(setDesignTools).catch(() => setDesignTools(config.designTools));
  }, [project.id]);

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

  const copyAsPrompt = async () => {
    try {
      const { prompt } = await api.cardPrompt(card.id);
      await copyText(prompt);
      showToast('Prompt copiado: pégalo en el agente que vaya a implementarla');
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Borrar la card «${card.title}»?`)) return;
    try {
      await api.deleteCard(card.id);
      await onChanged();
      navigate({ projectId: project.id, view: 'board' });
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const nextColumn = project.columns[project.columns.indexOf(column) + 1];
  const canDesign = Boolean(mode);
  const designSlot = tab === 'design' && canDesign;
  const promote = mode === 'document';
  const tool = designTools?.tools?.[card.design?.tool || designTool] || { label: designTool };

  return (
    <div className={consoleOpen ? 'card-view console-open' : 'card-view'}>
      <div className="card-panel">
        <div className="card-crumbs">
          <a className="crumb grow" href={href({ projectId: project.id, view: 'board' })}>
            ← {project.name} / board / {column?.name || card.column}
          </a>
          {card.definition && <button className="btn" onClick={copyAsPrompt}>Copiar como prompt</button>}
          {nextColumn && <button className="btn" onClick={() => save({ column: nextColumn.id })}>Mover a → {nextColumn.name}</button>}
          <select className="select" value={card.column} onChange={(e) => save({ column: e.target.value })} aria-label="Columna">
            {project.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn ghost" onClick={handleDelete} title="Borrar card" aria-label="Borrar card">🗑</button>
        </div>

        <textarea
          key={card.title}
          className="card-title-input"
          defaultValue={card.title}
          rows={1}
          aria-label="Título"
          // El título crece en altura en vez de cortarse (field-sizing donde existe).
          ref={(el) => el && !CSS.supports('field-sizing', 'content') && autosize(el)}
          onInput={(e) => !CSS.supports('field-sizing', 'content') && autosize(e.target)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.target.blur())}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== card.title && save({ title: e.target.value.trim() })}
        />

        <StacksEditor project={project} card={card} save={save} />

        <Lifecycle card={card} column={column} agent={card.agent} />

        <div className="tabs" role="tablist">
          <Tab id="draft" tab={tab} setTab={setTab}>Borrador</Tab>
          <Tab id="definition" tab={tab} setTab={setTab}>Definición IA</Tab>
          {canDesign && <Tab id="design" tab={tab} setTab={setTab}>Diseño{card.designStatus === 'stale' ? ' !' : ''}</Tab>}
          <Tab id="comments" tab={tab} setTab={setTab}>Comentarios ({card.commentCount})</Tab>
          <Tab id="runs" tab={tab} setTab={setTab}>Ejecuciones</Tab>
        </div>

        <div className="tab-body">
          {tab === 'draft' && <DraftEditor key={card.id} card={card} save={save} />}
          {tab === 'definition' && <DefinitionTab card={card} project={project} save={save} copyAsPrompt={copyAsPrompt} showToast={showToast} />}
          {tab === 'design' && canDesign && (
            <DesignPanel card={card} tools={designTools} tool={designTool} setTool={setDesignTool} promote={promote} project={project} />
          )}
          {tab === 'comments' && <CommentsPanel card={card} onChanged={onChanged} showToast={showToast} />}
          {tab === 'runs' && <AgentRuns cardId={card.id} />}
        </div>
      </div>

      <button className="console-toggle btn" onClick={() => setConsoleOpen(!consoleOpen)}>
        {consoleOpen ? '✕ Cerrar agente' : card.agent ? '● Agente trabajando' : 'Agente ▸'}
      </button>

      {designSlot ? (
        <AgentPanel
          key={`${card.id}-design`}
          card={card}
          config={config}
          mode="design"
          slot="design"
          title={`Agente de diseño · ${tool.label}`}
          actions={designActions(card, tool, promote)}
          launchParams={card.design ? null : { designTool }}
          emptyText={promote
            ? 'El agente moverá los artboards aprobados a las páginas de su feature y archivará la página de la card.'
            : `El agente pintará en ${tool.label} cada casuística de la definición. Para corregir, escríbele aquí o comenta en ${tool.label} y pulsa «Aplicar comentarios».`}
          onChanged={onChanged}
          showToast={showToast}
        />
      ) : (
        <AgentPanel
          key={`${card.id}-main`}
          card={card}
          config={config}
          mode={mode}
          title={mode === 'document' ? 'Agente de documentación' : 'Agente de definición'}
          onChanged={onChanged}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function Tab({ id, tab, setTab, children }) {
  return (
    <button role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
      {children}
    </button>
  );
}

function StacksEditor({ project, card, save }) {
  const [versions, setVersions] = useState({});
  useEffect(() => {
    setVersions(Object.fromEntries(card.stacks.map((s) => [s.name, s.version || ''])));
  }, [card.stacks]);
  const active = card.stacks.map((s) => s.name);

  const toggle = (name) => save({
    stacks: active.includes(name) ? card.stacks.filter((s) => s.name !== name) : [...card.stacks, { name, version: null }],
  });
  const saveVersion = (name) => save({
    stacks: card.stacks.map((s) => (s.name === name ? { ...s, version: versions[name]?.trim() || null } : s)),
  });

  return (
    <div className="stacks-row">
      {project.stacks.map((name, index) => (
        <span key={name} className={active.includes(name) ? 'stack-edit on' : 'stack-edit'}>
          <button className="chip-toggle" onClick={() => toggle(name)} title={active.includes(name) ? `Quitar ${name}` : `Añadir ${name}`}>
            <StackChip name={name} index={index} />
          </button>
          {active.includes(name) && (
            <input
              className="version-input mono"
              value={versions[name] || ''}
              placeholder="vers."
              aria-label={`Versión de ${name}`}
              onChange={(e) => setVersions({ ...versions, [name]: e.target.value })}
              onBlur={() => (versions[name] || '') !== (card.stacks.find((s) => s.name === name)?.version || '') && saveVersion(name)}
            />
          )}
        </span>
      ))}
      <span className="grow" />
      <span className="mono small muted">CREADA {formatDate(card.createdAt).toUpperCase()} · {card.commentCount} COMENTARIOS</span>
    </div>
  );
}

function DraftEditor({ card, save }) {
  const [draft, setDraft] = useState(card.draft);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(card.draft);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) {
      draftRef.current = card.draft;
      setDraft(card.draft);
    }
  }, [card.draft]);

  const persist = useCallback(async () => {
    if (!dirtyRef.current) return;
    const value = draftRef.current;
    if (await save({ draft: value }) && draftRef.current === value) {
      dirtyRef.current = false;
      setDirty(false);
    }
  }, [save]);

  // Al salir de la pantalla o de la app el borrador se guarda igualmente.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void persist();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', persist);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', persist);
      void persist();
    };
  }, [persist]);

  return (
    <div className="draft-view">
      <textarea
        className="editor"
        value={draft}
        placeholder="Escribe aquí tu borrador: qué quieres, casuísticas que se te ocurran, notas técnicas…"
        onChange={(e) => {
          draftRef.current = e.target.value;
          dirtyRef.current = true;
          setDirty(true);
          setDraft(e.target.value);
        }}
        onBlur={() => void persist()}
      />
      <p className="mono small muted">{dirty ? 'CAMBIOS PENDIENTES · SE GUARDAN AL SALIR DEL CAMPO' : 'GUARDADO'}</p>
    </div>
  );
}

function DefinitionTab({ card, project, save, copyAsPrompt, showToast }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.definition);
  const [sources, setSources] = useState([]);

  useEffect(() => {
    if (!editing) setValue(card.definition);
  }, [card.definition, editing]);

  // Fuentes: los docs que leyó la última definición que se guardó.
  useEffect(() => {
    api.agentRuns(card.id).then((runs) => {
      const last = runs.find((run) => run.mode === 'define' && run.filesWritten?.includes('definition'));
      setSources(last?.docsRead || []);
    }).catch(() => setSources([]));
  }, [card.id, card.definition]);

  if (!card.definition && !editing) {
    return (
      <div className="empty-state">
        <p>Aún no hay definición. Lanza el agente de definición desde la consola de la derecha: cogerá tu borrador, investigará los docs del proyecto y aplicará sus reglas.</p>
        <button className="btn" onClick={() => setEditing(true)}>Escribirla a mano</button>
      </div>
    );
  }

  return (
    <div className="definition">
      <div className="toolbar">
        {editing ? (
          <>
            <button className="btn primary" onClick={async () => (await save({ definition: value })) && setEditing(false)}>Guardar</button>
            <button className="btn ghost" onClick={() => { setValue(card.definition); setEditing(false); }}>Cancelar</button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={copyAsPrompt}>Copiar como prompt</button>
            <button className="btn" onClick={() => setEditing(true)}>Editar markdown</button>
            <button className="btn ghost" onClick={async () => { await copyText(card.definition); showToast('Markdown copiado'); }}>Copiar md</button>
          </>
        )}
      </div>
      <div className="definition-body">
        {editing
          ? <textarea className="editor" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Definición IA en markdown" />
          : <Markdown source={card.definition} className="md grow" />}
        {!editing && sources.length > 0 && (
          <aside className="marginalia">
            <p className="mono small muted">FUENTES</p>
            {sources.map((path) => (
              <a key={path} href={href({ projectId: project.id, view: 'docs', param: path })}>{path}</a>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function CommentsPanel({ card, onChanged, showToast }) {
  const [comments, setComments] = useState(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.comments(card.id).then(setComments).catch((e) => showToast(e.message, true));
  }, [card.id]);

  const add = async (event) => {
    event.preventDefault();
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const comment = await api.createComment(card.id, content);
      setComments((current) => [...current, comment]);
      setContent('');
      await onChanged();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar este comentario?')) return;
    try {
      await api.deleteComment(card.id, id);
      setComments((current) => current.filter((c) => c.id !== id));
      await onChanged();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  return (
    <div className="comments">
      {comments === null && <p className="empty">Cargando comentarios…</p>}
      {comments?.length === 0 && <p className="empty">Sin comentarios. Úsalos como notas privadas: los agentes no los leen.</p>}
      {comments?.map((comment) => (
        <article className="comment" key={comment.id}>
          <div className="comment-meta">
            <span className="mono small">{formatDate(comment.createdAt).toUpperCase()}</span>
            <button className="link small" onClick={() => remove(comment.id)}>eliminar</button>
          </div>
          <p>{comment.content}</p>
        </article>
      ))}
      <form className="composer" onSubmit={add}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Añade un comentario… (⌘↵ para enviar)"
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && add(e)}
        />
        <button className="btn primary" type="submit" disabled={!content.trim() || saving}>Comentar</button>
      </form>
    </div>
  );
}
