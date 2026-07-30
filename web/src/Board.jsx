import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [dropTarget, setDropTarget] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [stackFilter, setStackFilter] = useState([]);
  const [versionFilter, setVersionFilter] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const boardRef = useRef(null);
  const dragIdRef = useRef(null);
  const dropTargetRef = useRef(null);

  const setActiveDrag = (cardId) => {
    dragIdRef.current = cardId;
    setDragId(cardId);
  };

  const setActiveDropTarget = (target) => {
    dropTargetRef.current = target;
    setDropTarget(target);
  };

  const clearDrag = () => {
    dragIdRef.current = null;
    dropTargetRef.current = null;
    setDragId(null);
    setDropTarget(null);
  };

  // En móvil el board arranca en "To Do", no en Backlog
  useEffect(() => {
    if (window.matchMedia('(max-width: 720px)').matches && boardRef.current) {
      const todoCol = boardRef.current.children[1];
      if (todoCol) boardRef.current.scrollLeft = todoCol.offsetLeft - 8;
    }
  }, []);

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

  const moveCard = async (card, colId, beforeId = null) => {
    try {
      await api.moveCard(card.id, colId, beforeId);
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

  const handleDrop = (event, colId, beforeId = null) => {
    event.preventDefault();
    event.stopPropagation();
    const activeId = dragIdRef.current || event.dataTransfer?.getData('text/plain');
    clearDrag();
    if (!activeId || activeId === beforeId) return;
    const card = cards.find((c) => c.id === activeId);
    if (card) moveCard(card, colId, beforeId);
  };

  const targetFromPoint = (clientX, clientY) => {
    const element = document.elementFromPoint(clientX, clientY);
    const cardElement = element?.closest('[data-card-id]');
    const columnElement = element?.closest('[data-column-id]');
    if (!columnElement) return null;
    const colId = columnElement.dataset.columnId;
    if (!cardElement) return { colId, beforeId: null, edge: 'end' };
    const rect = cardElement.getBoundingClientRect();
    const before = clientY < rect.top + rect.height / 2;
    if (before) return { colId, beforeId: cardElement.dataset.cardId, edge: 'before' };
    const nextCard = cardElement.nextElementSibling?.closest?.('[data-card-id]');
    return { colId, beforeId: nextCard?.dataset.cardId || null, edge: nextCard ? 'before' : 'end' };
  };

  const handleTouchDragStart = (event, cardId) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveDrag(cardId);
  };

  const handleTouchDragMove = (event) => {
    if (!dragIdRef.current || event.pointerType === 'mouse') return;
    event.preventDefault();
    const target = targetFromPoint(event.clientX, event.clientY);
    if (target) setActiveDropTarget(target);
  };

  const handleTouchDragEnd = (event) => {
    if (!dragIdRef.current || event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    const activeId = dragIdRef.current;
    const target = dropTargetRef.current || targetFromPoint(event.clientX, event.clientY);
    clearDrag();
    if (!target || activeId === target.beforeId) return;
    const card = cards.find((item) => item.id === activeId);
    if (card) moveCard(card, target.colId, target.beforeId);
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

      <div className="board" ref={boardRef}>
        {COLUMNS.map((col, colIdx) => {
          const isDone = col.id === 'done';
          const colCards = cards.filter((c) => c.column === col.id && matches(c));
          const visible = isDone && !showDone ? [] : colCards;
          return (
            <div
              key={col.id}
              className={dropTarget?.colId === col.id ? 'column drag-over' : 'column'}
              data-column-id={col.id}
            >
              <div className="column-head">
                {col.label} <span className="count">{colCards.length}</span>
              </div>
              <div
                className={dropTarget?.colId === col.id && dropTarget.beforeId === null ? 'column-body drop-at-end' : 'column-body'}
                onDragOver={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  setActiveDropTarget({ colId: col.id, beforeId: null, edge: 'end' });
                }}
                onDrop={(e) => handleDrop(e, col.id)}
              >
                {isDone && !showDone && (
                  <p className="empty done-hint">
                    Arrastra aquí para archivar.{doneCount > 0 ? ` ${doneCount} archivadas — usa "ver done".` : ''}
                  </p>
                )}
                {!isDone && visible.length === 0 && (
                  <p className="empty done-hint">Sin cards{filtersActive ? ' (con estos filtros)' : ''}</p>
                )}
                {visible.map((card, cardIdx) => (
                  <div
                    key={card.id}
                    className={[
                      'card',
                      dragId === card.id ? 'dragging' : '',
                      dropTarget?.colId === col.id && dropTarget.beforeId === card.id ? 'drop-before' : '',
                    ].filter(Boolean).join(' ')}
                    data-card-id={card.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', card.id);
                      setActiveDrag(card.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setActiveDropTarget({
                        colId: col.id,
                        beforeId: before ? card.id : visible[cardIdx + 1]?.id || null,
                        edge: before || visible[cardIdx + 1] ? 'before' : 'end',
                      });
                    }}
                    onDrop={(e) => handleDrop(
                      e,
                      col.id,
                      dropTargetRef.current?.colId === col.id ? dropTargetRef.current.beforeId : card.id
                    )}
                    onDragEnd={clearDrag}
                    onClick={() => onOpen(card.id)}
                  >
                    <div className="card-title-row">
                      <span
                        className="drag-handle"
                        title="Arrastrar para priorizar"
                        aria-label="Arrastrar para priorizar"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => handleTouchDragStart(e, card.id)}
                        onPointerMove={handleTouchDragMove}
                        onPointerUp={handleTouchDragEnd}
                        onPointerCancel={handleTouchDragEnd}
                      >
                        ⠿
                      </span>
                      <div className="card-title">{card.title}</div>
                    </div>
                    <div className="card-meta">
                      {card.stacks.map((s) => (
                        <span key={s.name} className={`chip stack-${s.name}`}>
                          {s.name}{s.version ? ` v${s.version}` : ''}
                        </span>
                      ))}
                      {card.definition && <span className="chip defined" title="Tiene definición generada">✦ def</span>}
                      {card.commentCount > 0 && (
                        <span className="chip comments" title={`${card.commentCount} comentarios`}>
                          ◉ {card.commentCount}
                        </span>
                      )}
                      {card.column === 'done-dev' && (
                        <span
                          className={`documentation-icon ${card.documentationStatus === 'documented' ? 'documented' : 'pending'}`}
                          title={card.documentationStatus === 'documented' ? 'Documentación actualizada' : 'Pendiente de documentar'}
                          aria-label={card.documentationStatus === 'documented' ? 'Documentación actualizada' : 'Pendiente de documentar'}
                        >
                          {card.documentationStatus === 'documented' ? '✓ Doc' : '◷ Doc'}
                        </span>
                      )}
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
