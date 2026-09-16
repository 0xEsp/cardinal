import React, { useCallback, useEffect, useState } from 'react';
import { marked } from 'marked';
import { api } from './api.js';

export default function DocsView({ onSaved, showToast }) {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadDocs = useCallback(async () => {
    try {
      setError(null);
      setDocs(await api.docs());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    api
      .docContent(selected)
      .then((doc) => {
        if (cancelled) return;
        setContent(doc.content);
        setSavedContent(doc.content);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const selectDoc = (path) => {
    if (editing && content !== savedContent && !window.confirm('Tienes cambios sin guardar. ¿Cambiar de documento?')) return;
    setSelected(path);
  };

  const cancelEditing = () => {
    setContent(savedContent);
    setEditing(false);
  };

  const save = async () => {
    if (!selected || saving || content === savedContent) return;
    setSaving(true);
    try {
      const result = await api.saveDoc(selected, content);
      setContent(result.content);
      setSavedContent(result.content);
      setEditing(false);
      await loadDocs();
      await onSaved?.();
      showToast?.('Documentación guardada en workspace/docs/');
    } catch (e) {
      showToast?.(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={selected ? 'docs-view has-selection' : 'docs-view'}>
      <aside className="docs-list">
        <div className="docs-list-head">Documentación de producto</div>
        {error && <p className="empty">{error}</p>}
        {docs.length === 0 && !error && (
          <p className="empty">Aún no hay documentos. Se crearán cuando documentes cards en "done dev", o migra aquí tus .md de Notion (workspace/docs/).</p>
        )}
        {docs.map((d) => (
          <button
            key={d.path}
            className={selected === d.path ? 'doc-item active' : 'doc-item'}
            onClick={() => selectDoc(d.path)}
          >
            <span className="doc-title">{d.title}</span>
            <span className="doc-path">{d.path}</span>
          </button>
        ))}
      </aside>
      <main className="doc-content">
        {selected ? (
          <>
            <button className="btn doc-back" onClick={() => selectDoc(null)}>← Documentos</button>
            <div className="doc-toolbar">
              <div>
                <strong>{selected}</strong>
                {editing && content !== savedContent && <span className="doc-unsaved"> · cambios sin guardar</span>}
              </div>
              <div className="doc-toolbar-actions">
                {editing ? (
                  <>
                    <button className="btn primary" onClick={save} disabled={saving || content === savedContent}>
                      {saving ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button className="btn ghost" onClick={cancelEditing} disabled={saving}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={() => setEditing(true)} disabled={loading}>✎ Editar markdown</button>
                  </>
                )}
              </div>
            </div>
            {loading ? (
              <p className="empty">Cargando documento…</p>
            ) : editing ? (
              <textarea
                className="doc-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                aria-label={`Editar ${selected} en markdown`}
              />
            ) : (
              <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />
            )}
          </>
        ) : (
          <p className="empty">Selecciona un documento.</p>
        )}
      </main>
    </div>
  );
}
