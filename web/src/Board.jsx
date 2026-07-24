import React, { useMemo, useState } from 'react';
import { api } from './api.js';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', short: 'Backlog' },
  { id: 'todo', label: 'To Do', short: 'To Do' },
  { id: 'in-progress', label: 'In Progress', short: 'In Prog' },
  { id: 'done-dev', label: 'Done Dev', short: 'D. Dev' },
  { id: 'done', label: 'Done', short: 'Done' },
];

const STACKS = ['app', 'web', 'backend'];

export default function Board({ cards, onOpen, onChanged, showToast }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [stackFilter, setStackFilter] = useState([]);
  const [versionFilter, setVersionFilter] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [activeCol, setActiveCol] = useState('todo'); // columna visible en móvil
  const [showFilters, setShowFilters] = useState(false);

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

  const moveCard = async (card, colId) => {
    if (card.column === colId) return;
    try {
      await api.updateCard(card.id, { column: colId });
      onChanged();
      if (colId === 'done') showToast(`"${card.title}" archivada en Done`);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const moveBy = (card, delta) => {
    const idx = COLUMNS.findIndex((c) => c.id === card.column);
    const target = COLUMNS[idx + delta];
    if (target) moveCard(card, target.id);
  };

  const handleDrop = (colId) => {
    setOverCol(null);
    if (!dragId) return;
    const card = cards.find((c) => c.id === dragId);
    if (card) moveCard(card, colId);
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
  const filtersActive = stackFilter.length > 0 || versionFilter;

  return (
    <div className="board-wrap">
      <div className="board-toolbar">
        <form className="new-card" onSubmit={handleCreate}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nueva card… (se crea en Backlog)"
          />
          <button className="btn primary" type="submit">+</button>
        </form>
        <button
          className={filtersActive ? 'btn filter-toggle active' : 'btn filter-toggle'}
          onClick={() => setShowFilters(!showFilters)}
        >
          ⚙ Filtros{filtersActive ? ' •' : ''}
        </button>
        <div className={showFilters ? 'filters open' : 'filters'}>
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
          {filtersActive && (
            <button className="btn ghost" onClick={() => { setStackFilter([]); setVersionFilter(''); }}>limpiar</button>
          )}
        </div>
      </div>

      {/* Pestañas de columna — solo visibles en móvil */}
      <div className="col-tabs">
        {COLUMNS.map((col) => {
          const n = cards.filter((c) => c.column === col.id && matches(c)).length;
          return (
            <button
              key={col.id}
              className={activeCol === col.id ? 'col-tab active' : 'col-tab'}
              onClick={() => setActiveCol(col.id)}
            >
              {col.short}
              {n > 0 && <span className="col-tab-count">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="board">
        {COLUMNS.map((col, colIdx) => {
          const isDone = col.id === 'done';
          const colCards = cards.filter((c) => c.column === col.id && matches(c));
          const visible = isDone && !showDone ? [] : colCards;
          return (
            <div
              key={col.id}
              className={[
                'column',
                overCol === col.id ? 'drag-over' : '',
                activeCol === col.id ? 'mobile-active' : '',
              ].join(' ')}
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
                {!isDone && visible.length === 0 && (
                  <p className="empty done-hint">Sin cards{filtersActive ? ' (con estos filtros)' : ''}</p>
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
                    {/* Mover sin drag & drop — solo visible en táctil */}
                    <div className="card-move">
                      <button
                        className="btn move-btn"
                        disabled={colIdx === 0}
                        onClick={(e) => { e.stopPropagation(); moveBy(card, -1); }}
                      >
                        ◀ {colIdx > 0 ? COLUMNS[colIdx - 1].short : ''}
                      </button>
                      <button
                        className="btn move-btn"
                        disabled={colIdx === COLUMNS.length - 1}
                        onClick={(e) => { e.stopPropagation(); moveBy(card, 1); }}
                      >
                        {colIdx < COLUMNS.length - 1 ? COLUMNS[colIdx + 1].short : ''} ▶
                      </button>
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
