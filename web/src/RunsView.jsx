import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { href } from './router.js';
import { RunStatus, runModeLabel } from './AgentRuns.jsx';
import { formatDate } from './ui.jsx';

const FILTERS = [
  { id: 'all', label: 'Todas', test: () => true },
  { id: 'running', label: 'En curso', test: (run) => run.status === 'running' || run.status === 'waiting_input' },
  { id: 'failed', label: 'Fallidas', test: (run) => run.status === 'failed' },
];

function duration(run) {
  if (!run.finishedAt) return run.status === 'running' ? 'en curso' : '—';
  const seconds = Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Ejecuciones de agentes de todas las cards del proyecto (Moki · D · Ejecuciones). */
export default function RunsView({ project }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let alive = true;
    const load = () => api.projectRuns(project.id).then((next) => alive && setRuns(next)).catch((e) => alive && setError(e.message));
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id]);

  const visible = (runs || []).filter(FILTERS.find((f) => f.id === filter).test);

  return (
    <div className="page">
      <header className="page-head">
        <div className="grow">
          <p className="crumb">{project.name} / ejecuciones</p>
          <h1>Ejecuciones</h1>
        </div>
        <div className="filters inline">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'chip ink' : 'chip'} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </header>
      <div className="page-body">
        {error && <p className="notice warn">{error}</p>}
        {!runs && !error && <p className="empty">Cargando…</p>}
        {runs && visible.length === 0 && <p className="empty">No hay ejecuciones{filter !== 'all' ? ' con este filtro' : ''}.</p>}
        {visible.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>ESTADO</th><th>CARD</th><th>MODO</th><th>MODELO</th><th>INICIO</th><th>DURACIÓN</th><th>REVISIÓN</th></tr>
              </thead>
              <tbody>
                {visible.map((run) => (
                  <tr key={run.id}>
                    <td><RunStatus status={run.status} /></td>
                    <td><a href={href({ projectId: project.id, view: 'card', param: run.cardId })}>{run.cardTitle}</a></td>
                    <td>{runModeLabel(run.mode)}</td>
                    <td className="mono small">{run.model}</td>
                    <td className="mono small">{formatDate(run.startedAt)}</td>
                    <td className="mono small">{duration(run)}</td>
                    <td className="small">{run.error ? <span className="warn-text">{run.error}</span> : run.review?.ok ? 'aprobada' : run.review?.issues?.length ? 'con incidencias' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
