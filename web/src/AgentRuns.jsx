import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export default function AgentRuns({ cardId, compact = false }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setRuns(await api.agentRuns(cardId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className={compact ? 'agent-runs compact' : 'agent-runs'}>
      <div className="agent-runs-head">
        <div>
          <h3>Historial de ejecuciones</h3>
          <p>Modelo, contexto consultado, validación y revisión de cada ejecución.</p>
        </div>
        <button className="btn ghost" onClick={load} disabled={loading} title="Actualizar historial">↻</button>
      </div>
      {loading && <p className="empty">Cargando historial…</p>}
      {error && <p className="empty">{error}</p>}
      {!loading && !error && runs.length === 0 && <p className="empty">Todavía no hay ejecuciones para esta card.</p>}
      {!loading && !error && runs.length > 0 && (
        <div className="agent-runs-list">
          {runs.map((run) => <RunItem key={run.id} run={run} />)}
        </div>
      )}
    </section>
  );
}

function RunItem({ run }) {
  const validation = run.validation || {};
  const review = run.review || {};
  const statusLabel = {
    running: 'En curso',
    completed: 'Completada',
    failed: 'Fallida',
  }[run.status] || run.status;
  const reviewLabel = review.ok ? 'aprobada' : review.issues?.length ? 'con incidencias' : 'no realizada';
  const validationLabel = validation.ok ? 'correcta' : validation.errors?.length ? 'con errores' : 'no realizada';

  return (
    <article className={`agent-run status-${run.status}`}>
      <div className="agent-run-top">
        <strong>{run.mode === 'document' ? 'Documentación' : 'Definición'}</strong>
        <span className="agent-run-status">{statusLabel}</span>
        <time dateTime={run.startedAt}>{formatDate(run.startedAt)}</time>
      </div>
      <div className="agent-run-model">{run.model} · contexto {run.contextRevision || '—'}</div>
      <div className="agent-run-details">
        <span><b>Buscados:</b> {run.docsSearched?.length ? run.docsSearched.join(', ') : '—'}</span>
        <span><b>Leídos:</b> {run.docsRead?.length ? run.docsRead.join(', ') : '—'}</span>
        <span><b>Escritos:</b> {run.filesWritten?.length ? run.filesWritten.join(', ') : '—'}</span>
        <span><b>Validación:</b> {validationLabel}</span>
        <span><b>Revisión:</b> {reviewLabel}{run.reviewCount ? ` (${run.reviewCount})` : ''}</span>
      </div>
      {review.summary && <p className="agent-run-summary">{review.summary}</p>}
      {run.error && <p className="agent-run-error">{run.error}</p>}
    </article>
  );
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}
