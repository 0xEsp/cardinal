import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import { api } from './api.js';

export default function DocsView() {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.docs().then(setDocs).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setContent('');
    api.docContent(selected).then((d) => setContent(d.content)).catch((e) => setError(e.message));
  }, [selected]);

  return (
    <div className="docs-view">
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
            onClick={() => setSelected(d.path)}
          >
            <span className="doc-title">{d.title}</span>
            <span className="doc-path">{d.path}</span>
          </button>
        ))}
      </aside>
      <main className="doc-content">
        {selected ? (
          <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />
        ) : (
          <p className="empty">Selecciona un documento.</p>
        )}
      </main>
    </div>
  );
}
