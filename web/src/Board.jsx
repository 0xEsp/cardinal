import React, { useState } from 'react';
import { api } from './api.js';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'done-dev', label: 'Done Dev' },
  { id: 'done', label: 'Done' },
];

export default function Board({ cards, onOpen, onChanged, showToast }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [newTitle, setNewTitle] = useState('');

  const handleDrop = async (colId) => {
    setOverCol(null);
    if (!dragId) return;
    const card = cards.find((c) => c.id === dragId);
    if (card && card.column !== colId) {
      try {
        await api.updateCard(dragId, { column: colId });
        onChanged();
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

  return (
    <div className="board-wrap">
      <form className="new-card" onSubmit={handleCreate}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Título de la nueva card… (se crea en Backlog)"
        />
        <button className="btn primary" type="submit">+ Card</button>
      </form>
      <div className="board">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.column === col.id);
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
                {colCards.map((card) => (
                  <div
                    key={card.id}
                    className="card"
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onClick={() => onOpen(card.id)}
                  >
                    <div className="card-title">{card.title}</div>
                    <div className="card-meta">
                      {card.stack.map((s) => <span key={s} className={`chip stack-${s}`}>{s}</span>)}
                      {card.version && <span className="chip version">v{card.version}</span>}
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
