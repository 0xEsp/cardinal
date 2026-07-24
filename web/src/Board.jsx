import React, { useMemo, useState } from 'react';
import { api } from './api.js';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'done-dev', label: 'Done Dev' },
  { id: 'done', label: 'Done' },
];

const STACKS = ['app', 'web', 'backend'];

export default function Board({ cards, onOpen, onChanged, showToast }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [stackFilter, setStackFilter] = useState([]);
  const [versionFilter, setVersionFilter] = useState('');
  const [showDone, setShowDone] = useState(false);

  const versions = useMemo(
    () => [...new Set(cards.flatMap((c) => c.stacks.map((s) => s.version)).filter(Boolean))].sort(),
    [cards]
  );

  const matches = (card) => {
    if (stackFilter.length && !card.stacks.some((s) => stackFilter.includes(s.name))) return false;
    if (versionFilter && !card.stacks.some((s) => s.version === versionFilter)) return false;
    return true;
  };

  const toggleStackFilter = (s) =>
    setStackFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleDrop = async (colId) => {
    setOverCol(null);
    if (!dragId) return;
    const card = cards.find((c) => c.id === dragId);
    if (card && card.column !== colId) {
      try {
        await api.updateCard(dragId, { column: colId });
        onChanged();
        if (colId === 'done') showToast(`"${card.title}" archivada en Done`);
      } catch (e) {
        showToast(e.message, true);
      }
    }
    setDragId(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await api.createCard(newTitle.trim());
      setNewTitle('');
      onChanged();
    } catch (e2) {
      showToast(e2.message, true);
    }
  };

  const doneCount = cards.filter((c) => c.column === 'done').length;

  return (
    <div className="board-wrap">
      <div className="board-toolbar">
        <form className="new-card" onSubmit={handleCreate}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título de la nueva card… (se crea en Backlog)"
          />
          <button className="btn primary" type="submit">+ Card</button>
        </form>
        <div className="filters">
          <span className="prop-label">Filtrar:</span>
          {STACKS.map((s) => (
            <button
              key={s}
              className={stackFilter.includes(s) ? `chip stack-${s} on` : 'chip off'}
              onClick={() => toggleStackFilter(s)}
            >
              {s}
            </button>
          ))}
          <select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)} className="version-select">
            <option value="">versión: todas</option>
            {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
          </select>
          <button className={showDone ? 'chip defined on' : 'chip off'} onClick={() => setShowDone(!showDone)}>
            {showDone ? '✕ ocultar done' : `ver done (${doneCount})`}
          </button>
          {(stackFilter.length > 0 || versionFilter) && (
            <button className="btn ghost" onClick={() => { setStackFilter([]); setVersionFilter(''); }}>limpiar</button>
          )}
        </div>
      </div>
      <div className="board">
        {COLUMNS.map((col) => {
          const isDone = col.id === 'done';
          const colCards = cards.filter((c) => c.column === col.id && matches(c));
          const visible = isDone && !showDone ? [] : colCards;
          return (
            <div
              key={col.id}
              className={overCol === col.id ? 'column drag-over' : 'column'}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={() => handleDrop(col.id)}
            >
              <div className="column-head">
                {col.label} <span className="count">{colCards.length}</span>
              </div>
              <div className="column-body">
                {isDone && !showDone && (
                  <p className="empty done-hint">
                    Arrastra aquí para archivar.{doneCount > 0 ? ` ${doneCount} archivadas — usa "ver done".` : ''}
                  </p>
                )}
                {visible.map((card) => (
                  <div
                    key={card.id}
                    className="card"
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onClick={() => onOpen(card.id)}
                  >
                    <div className="card-title">{card.title}</div>
                    <div className="card-meta">
                      {card.stacks.map((s) => (
                        <span key={s.name} className={`chip stack-${s.name}`}>
                          {s.name}{s.version ? ` v${s.version}` : ''}
                        </span>
                      ))}
                      {card.definition && <span className="chip defined" title="Tiene definición generada">✦ def</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
