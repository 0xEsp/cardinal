import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { formatDate } from './ui.jsx';

export const RUN_STATUS = {
  running: { label: 'EN CURSO', color: '#FFD23F' },
  completed: { label: 'COMPLETADA', color: '#7FD6A2' },
  waiting_input: { label: 'ESPERANDO', color: '#FFFFFF' },
  stopped: { label: 'DETENIDA', color: '#E6E0D4' },
  interrupted: { label: 'INTERRUMPIDA', color: '#E6E0D4' },
  failed: { label: 'FALLIDA', color: '#FF8A6B' },
};

export function runModeLabel(mode) {
  if (mode === 'document') return 'documentar';
  if (mode === 'define') return 'definir';
  if (mode?.startsWith('design')) return mode === 'design:promote' ? 'promocionar' : mode === 'design:comments' ? 'comentarios' : 'diseñar';
  return mode;
}

export function RunStatus({ status }) {
  const item = RUN_STATUS[status] || { label: String(status).toUpperCase(), color: '#FFFFFF' };
  return <span className="sticker small mono" style={{ background: item.color }}>{item.label}</span>;
}

/** Historial de ejecuciones de una card (pestaña Ejecuciones). */
export default function AgentRuns({ cardId }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRuns(await api.agentRuns(cardId));
    } catch (e) {
      setError(e.message);
    }
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="notice warn">{error}</p>;
  if (!runs) return <p className="empty">Cargando historial…</p>;
  if (!runs.length) return <p className="empty">Todavía no hay ejecuciones para esta card.</p>;

  return (
    <div className="runs-list">
      {runs.map((run) => {
        const review = run.review || {};
        const validation = run.validation || {};
        return (
          <article key={run.id} className="run">
            <div className="run-top">
              <RunStatus status={run.status} />
              <strong>{runModeLabel(run.mode)}</strong>
              <span className="mono small grow">{run.model}</span>
              <span className="mono small muted">{formatDate(run.startedAt)}</span>
            </div>
            <dl className="run-details">
              <dt>BUSCADOS</dt><dd>{run.docsSearched?.join(', ') || '—'}</dd>
              <dt>LEÍDOS</dt><dd>{run.docsRead?.join(', ') || '—'}</dd>
              <dt>ESCRITOS</dt><dd>{run.filesWritten?.join(', ') || '—'}</dd>
              <dt>VALIDACIÓN</dt><dd>{validation.ok ? 'correcta' : validation.errors?.length ? 'con errores' : '—'}</dd>
              <dt>REVISIÓN</dt><dd>{review.ok ? 'aprobada' : review.issues?.length ? 'con incidencias' : '—'}{run.reviewCount ? ` (${run.reviewCount})` : ''}</dd>
            </dl>
            {review.summary && <p className="muted">{review.summary}</p>}
            {run.error && <p className="notice warn">{run.error}</p>}
          </article>
        );
      })}
    </div>
  );
}
