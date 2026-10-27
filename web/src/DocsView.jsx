import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { href, navigate } from './router.js';
import { Markdown, SourceChip, timeAgo } from './ui.jsx';

const TEXTS = {
  docs: {
    title: 'Docs',
    empty: 'Aún no hay docs. Se crean al documentar cards en la columna de documentación, desde el MCP o con «+ Nuevo».',
    help: 'Cómo funciona hoy el producto: flujos, comportamientos y casuísticas.',
  },
  rules: {
    title: 'Reglas',
    empty: 'Este proyecto no tiene reglas: sus agentes trabajarán sin guía. Crea al menos agent-define.md y card-definition.md.',
    help: 'Cómo trabajan los agentes de este proyecto: definición de cards, criterios de QA, guías de diseño y documentación.',
  },
};

/**
 * Docs de producto o reglas del harness de un proyecto, con historial de
 * versiones (Moki · D · Docs con historial; Reglas usa la misma pantalla).
 */
export default function DocsView({ project, kind, selected, onChanged, showToast }) {
  const texts = TEXTS[kind];
  const [docs, setDocs] = useState(null);
  const [filter, setFilter] = useState('');
  const [doc, setDoc] = useState(null); // { path, content, version, updatedAt }
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);
  const [preview, setPreview] = useState(null); // { version, content }

  const loadDocs = useCallback(() => api.docs(project.id, kind).then(setDocs).catch((e) => showToast(e.message, true)), [project.id, kind, showToast]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const loadDoc = useCallback(async (path) => {
    const [loaded, versions] = await Promise.all([api.docContent(project.id, path, kind), api.docHistory(project.id, path, kind)]);
    setDoc({ path, content: loaded.content, version: versions[0]?.version, updatedAt: versions[0]?.createdAt });
    setContent(loaded.content);
    setHistory((current) => (current ? versions : null));
    return versions;
  }, [project.id, kind]);

  useEffect(() => {
    setEditing(false);
    setPreview(null);
    if (!selected) {
      setDoc(null);
      return;
    }
    loadDoc(selected).catch((e) => {
      setDoc(null);
      showToast(e.message, true);
    });
  }, [selected, loadDoc]);

  const open = (path) => {
    if (editing && content !== doc?.content && !window.confirm('Tienes cambios sin guardar. ¿Cambiar de documento?')) return;
    navigate({ projectId: project.id, view: kind, param: path });
  };

  const groups = useMemo(() => {
    const list = (docs || []).filter((d) => !filter || `${d.path} ${d.title}`.toLowerCase().includes(filter.toLowerCase()));
    const map = new Map();
    for (const item of list) {
      const folder = item.path.includes('/') ? item.path.split('/').slice(0, -1).join('/') : '';
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder).push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [docs, filter]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveDoc(project.id, doc.path, content, kind);
      setEditing(false);
      await Promise.all([loadDoc(doc.path), loadDocs()]);
      onChanged();
      showToast(`${doc.path} guardado`);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const name = window.prompt(kind === 'rules' ? 'Nombre de la regla (p. ej. qa-criteria-ios.md)' : 'Ruta del doc (p. ej. onboarding.md o catalogo/busqueda.md)');
    if (!name) return;
    const path = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`;
    try {
      await api.saveDoc(project.id, path, `# ${path.replace(/\.md$/, '').split('/').pop()}\n`, kind);
      await loadDocs();
      onChanged();
      navigate({ projectId: project.id, view: kind, param: path });
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const remove = async () => {
    if (!window.confirm(`¿Borrar ${doc.path}? Su historial se conserva: si vuelves a crearlo con la misma ruta, sigue la numeración de versiones.`)) return;
    try {
      await api.deleteDoc(project.id, doc.path, kind);
      await loadDocs();
      onChanged();
      navigate({ projectId: project.id, view: kind });
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const toggleHistory = async () => {
    if (history) {
      setHistory(null);
      setPreview(null);
      return;
    }
    try {
      setHistory(await api.docHistory(project.id, doc.path, kind));
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const showVersion = async (version) => {
    if (version === doc.version) {
      setPreview(null);
      return;
    }
    try {
      const loaded = await api.docVersion(project.id, doc.path, version, kind);
      setPreview({ version, content: loaded.content });
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const restore = async () => {
    try {
      await api.restoreDoc(project.id, doc.path, preview.version, kind);
      setPreview(null);
      await loadDoc(doc.path);
      setHistory(await api.docHistory(project.id, doc.path, kind));
      showToast(`Restaurada la v${preview.version}`);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  return (
    <div className={['docs', doc ? 'has-doc' : '', history ? 'has-history' : ''].join(' ')}>
      <aside className="doc-list">
        <div className="doc-list-head">
          <h1 className="grow">{texts.title}</h1>
          <button className="btn tiny" onClick={create}>+ Nuevo</button>
        </div>
        <p className="muted small">{texts.help}</p>
        <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filtrar ${docs?.length ?? ''} ${kind === 'rules' ? 'reglas' : 'docs'}…`} />
        {docs?.length === 0 && <p className="empty">{texts.empty}</p>}
        {groups.map(([folder, items]) => (
          <div key={folder || '_'} className="doc-group">
            {folder && <p className="mono small muted doc-group-label">{folder.toUpperCase()}</p>}
            {items.map((item) => (
              <a
                key={item.path}
                href={href({ projectId: project.id, view: kind, param: item.path })}
                onClick={(e) => { e.preventDefault(); open(item.path); }}
                className={item.path === selected ? 'doc-item active' : 'doc-item'}
              >
                <span className="doc-item-title">{item.title}</span>
                <span className="mono small doc-item-path">{item.path.split('/').pop()}</span>
              </a>
            ))}
          </div>
        ))}
      </aside>

      <section className="doc-main">
        {!doc && <p className="empty pad">{selected ? 'Cargando…' : `Elige ${kind === 'rules' ? 'una regla' : 'un doc'}.`}</p>}
        {doc && (
          <>
            <div className="doc-toolbar">
              <button className="btn tiny doc-back" onClick={() => navigate({ projectId: project.id, view: kind })}>←</button>
              <p className="mono small grow">
                {doc.path} · v{doc.version} · {timeAgo(doc.updatedAt)}
                {editing && content !== doc.content ? ' · SIN GUARDAR' : ''}
              </p>
              {editing ? (
                <>
                  <button className="btn ghost" onClick={() => { setContent(doc.content); setEditing(false); }}>Cancelar</button>
                  <button className="btn primary" onClick={save} disabled={saving || content === doc.content}>{saving ? 'Guardando…' : 'Guardar'}</button>
                </>
              ) : (
                <>
                  <button className={history ? 'btn ink' : 'btn'} onClick={toggleHistory}>Historial</button>
                  <button className="btn" onClick={() => setEditing(true)} disabled={Boolean(preview)}>Editar</button>
                  <button className="btn ghost" onClick={remove} title="Borrar" aria-label="Borrar">🗑</button>
                </>
              )}
            </div>
            {preview && (
              <p className="notice">
                Viendo la v{preview.version}. <button className="link" onClick={() => setPreview(null)}>Volver a la actual</button>
              </p>
            )}
            {editing
              ? <textarea className="editor sheet" value={content} onChange={(e) => setContent(e.target.value)} aria-label={`Editar ${doc.path}`} />
              : <div className="sheet"><Markdown source={preview ? preview.content || '*(versión de borrado)*' : doc.content} /></div>}
          </>
        )}
      </section>

      {doc && history && (
        <aside className="history">
          <div className="doc-list-head">
            <h2 className="grow">Historial</h2>
            <button className="btn tiny" onClick={toggleHistory} aria-label="Cerrar historial">✕</button>
          </div>
          <div className="history-list">
            {history.map((item) => {
              const current = (preview?.version ?? doc.version) === item.version;
              return (
                <button key={item.version} className={current ? 'history-row active' : 'history-row'} onClick={() => showVersion(item.version)}>
                  <span className="history-top">
                    <strong>v{item.version}</strong>
                    <SourceChip source={item.source} />
                    <span className="grow" />
                    <span className="mono small">+{item.linesAdded} −{item.linesRemoved}</span>
                  </span>
                  <span className="small">{item.author}</span>
                  <span className="mono small history-meta">{item.note ? `${item.note} · ` : ''}{timeAgo(item.createdAt)}</span>
                </button>
              );
            })}
          </div>
          {preview && <button className="btn primary" onClick={restore}>Restaurar v{preview.version}</button>}
        </aside>
      )}
    </div>
  );
}
