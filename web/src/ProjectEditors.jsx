import React, { useState } from 'react';
import { StackChip } from './ui.jsx';

// Editores compartidos por Ajustes del proyecto y el asistente de nuevo proyecto.

export const PROJECT_COLORS = ['#FF8A6B', '#FFD23F', '#7FD6A2', '#8FA8FF', '#D7B8FF', '#111111'];

export const MODE_OPTIONS = [
  { id: 'define', label: 'definir' },
  { id: 'document', label: 'documentar' },
  { id: '', label: 'ninguno' },
];

export function ColorPicker({ value, onChange }) {
  return (
    <div className="chips">
      {PROJECT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={value === color ? 'swatch on' : 'swatch'}
          style={{ background: color }}
          onClick={() => onChange(color)}
          aria-label={`Color ${color}`}
        />
      ))}
    </div>
  );
}

export function StacksField({ stacks, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const name = draft.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (name && !stacks.includes(name)) onChange([...stacks, name]);
    setDraft('');
  };
  return (
    <div className="chips">
      {stacks.map((name, index) => (
        <span key={name} className="sticker-edit">
          <StackChip name={name} index={index} />
          <button type="button" className="sticker-x" onClick={() => onChange(stacks.filter((s) => s !== name))} aria-label={`Quitar ${name}`}>×</button>
        </span>
      ))}
      <input
        className="input dashed"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="+ añadir stack"
        size={14}
      />
    </div>
  );
}

/** Columnas del board: nombre, agente que se lanza y cuál es el archivo. */
export function ColumnsField({ columns, onChange }) {
  const update = (index, patch) => onChange(columns.map((column, i) => (i === index ? { ...column, ...patch } : column)));
  const move = (index, delta) => {
    const next = [...columns];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th /><th>NOMBRE</th><th>AGENTE</th><th>ARCHIVO</th><th /></tr>
        </thead>
        <tbody>
          {columns.map((column, index) => (
            <tr key={column.id || index}>
              <td className="mono small muted">{String(index + 1).padStart(2, '0')}</td>
              <td><input className="input" value={column.name} onChange={(e) => update(index, { name: e.target.value })} /></td>
              <td>
                <select className="select" value={column.mode || ''} onChange={(e) => update(index, { mode: e.target.value || null })}>
                  {MODE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </td>
              <td>
                <input
                  type="radio"
                  name="archive-column"
                  checked={Boolean(column.archive)}
                  onChange={() => onChange(columns.map((c, i) => ({ ...c, archive: i === index ? true : undefined, ...(i === index ? { mode: null } : {}) })))}
                  aria-label={`${column.name} es el archivo`}
                />
              </td>
              <td className="nowrap">
                <button type="button" className="btn tiny" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="btn tiny" disabled={index === columns.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="btn tiny" onClick={() => onChange(columns.filter((_, i) => i !== index))} aria-label="Quitar columna">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn tiny" onClick={() => onChange([...columns, { name: 'Nueva columna', mode: 'define' }])}>+ Columna</button>
    </div>
  );
}
