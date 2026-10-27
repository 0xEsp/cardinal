import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { href, navigate } from './router.js';
import { StackChip, cardStatus, elapsed } from './ui.jsx';

export default function Board({ project, cards, onChanged, showToast }) {
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [stackFilter, setStackFilter] = useState([]);
  const [versionFilter, setVersionFilter] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const boardRef = useRef(null);
  const searchRef = useRef(null);
  const dragIdRef = useRef(null);
  const dropTargetRef = useRef(null);

  const archive = project.columns.find((column) => column.archive);
  const columns = project.columns.filter((column) => !column.archive || showArchive);

  // ⌘K / Ctrl+K enfoca la búsqueda del board.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const versions = useMemo(
    () => [...new Set(cards.flatMap((c) => c.stacks.map((s) => s.version)).filter(Boolean))].sort(),
    [cards]
  );

  const matches = (card) => {
    if (search && !card.title.toLowerCase().includes(search.toLowerCase())) return false;
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
      if (colId === archive?.id) showToast(`«${card.title}» archivada`);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const moveBy = (card, delta) => {
    const all = project.columns;
    const idx = all.findIndex((c) => c.id === card.column);
    const target = all[idx + delta];
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
      const card = await api.createCard(project.id, { title: newTitle.trim() });
      setNewTitle('');
      setCreating(false);
      await onChanged();
      navigate({ projectId: project.id, view: 'card', param: card.id });
    } catch (e2) {
      showToast(e2.message, true);
    }
  };

  const archived = archive ? cards.filter((c) => c.column === archive.id).length : 0;
  const active = cards.length - archived;
  const filtersActive = stackFilter.length > 0 || versionFilter || search;

  return (
    <div className="page board-page">
      <header className="page-head">
        <div className="grow">
          <p className="crumb">{project.name} / board — {active} cards activas</p>
          <h1>Board</h1>
        </div>
        <label className="search">
          <span className="mono">⌘K</span>
          <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="buscar cards…" />
        </label>
        <button className="btn primary" onClick={() => setCreating(true)}>+ Nueva card</button>
      </header>

      {creating && (
        <form className="new-card-bar" onSubmit={handleCreate}>
          <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={`Título de la card (entra en ${project.columns.find((c) => !c.archive)?.name})`} />
          <button className="btn primary" type="submit" disabled={!newTitle.trim()}>Crear</button>
          <button className="btn ghost" type="button" onClick={() => { setCreating(false); setNewTitle(''); }}>Cancelar</button>
        </form>
      )}

      <div className="filters">
        <button className={stackFilter.length === 0 ? 'chip ink' : 'chip'} onClick={() => setStackFilter([])}>Todos</button>
        {project.stacks.map((name, index) => (
          <button key={name} className={!stackFilter.length || stackFilter.includes(name) ? 'chip-toggle on' : 'chip-toggle'} onClick={() => toggleStackFilter(name)}>
            <StackChip name={name} index={index} />
          </button>
        ))}
        {versions.length > 0 && (
          <select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)} className="select mono">
            <option value="">versión: todas</option>
            {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
          </select>
        )}
        {filtersActive && <button className="link" onClick={() => { setStackFilter([]); setVersionFilter(''); setSearch(''); }}>limpiar</button>}
        <span className="grow" />
        {archive && (
          <button className="link mono" onClick={() => setShowArchive(!showArchive)}>
            {showArchive ? 'OCULTAR ARCHIVO ✕' : `${archive.name.toUpperCase()} [${archived}] →`}
          </button>
        )}
      </div>

      <div className="columns" ref={boardRef}>
        {columns.map((col) => {
          const colIdx = project.columns.indexOf(col);
          const colCards = cards.filter((c) => c.column === col.id && matches(c));
          return (
            <section
              key={col.id}
              className={dropTarget?.colId === col.id ? 'column drag-over' : 'column'}
              data-column-id={col.id}
            >
              <div className="column-head">
                <span className="mono muted">{String(colIdx + 1).padStart(2, '0')}</span>
                <h2 className="grow">{col.name}</h2>
                <span className="mono">[{colCards.length}]</span>
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
                {colCards.length === 0 && (
                  <p className="column-empty">{col.archive ? 'Arrastra aquí para archivar.' : `Sin cards${filtersActive ? ' con estos filtros' : ''}`}</p>
                )}
                {colCards.map((card, cardIdx) => {
                  const status = cardStatus(card, col);
                  return (
                    <article
                      key={card.id}
                      className={[
                        'tile',
                        card.agent ? 'tile-live' : '',
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
                          beforeId: before ? card.id : colCards[cardIdx + 1]?.id || null,
                          edge: before || colCards[cardIdx + 1] ? 'before' : 'end',
                        });
                      }}
                      onDrop={(e) => handleDrop(
                        e,
                        col.id,
                        dropTargetRef.current?.colId === col.id ? dropTargetRef.current.beforeId : card.id
                      )}
                      onDragEnd={clearDrag}
                      onClick={() => { window.location.hash = href({ projectId: project.id, view: 'card', param: card.id }); }}
                    >
                      <div className="tile-title-row">
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
                        <h3 className="tile-title">{card.title}</h3>
                      </div>
                      <div className="tile-meta">
                        {card.stacks.length === 0 && <span className="mono muted small">sin stack</span>}
                        {card.stacks.map((s) => (
                          <StackChip key={s.name} name={s.name} version={s.version} index={project.stacks.indexOf(s.name)} small />
                        ))}
                        <span className="grow" />
                        {card.commentCount > 0 && <span className="mono small" title={`${card.commentCount} comentarios`}>◉{card.commentCount}</span>}
                        <span className={`status mono ${card.agent ? 'live' : status.tone}`}>
                          {card.agent ? `● AGENTE ${elapsed(card.agent.since)}` : status.label}
                        </span>
                      </div>
                      {/* Mover sin drag & drop: solo en pantallas táctiles */}
                      <div className="tile-move">
                        <button className="btn tiny" disabled={colIdx === 0} onClick={(e) => { e.stopPropagation(); moveBy(card, -1); }}>
                          ◀ {project.columns[colIdx - 1]?.name || ''}
                        </button>
                        <button className="btn tiny" disabled={colIdx === project.columns.length - 1} onClick={(e) => { e.stopPropagation(); moveBy(card, 1); }}>
                          {project.columns[colIdx + 1]?.name || ''} ▶
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
