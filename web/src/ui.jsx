import React, { useEffect, useState } from 'react';
import { marked } from 'marked';

// Piezas compartidas del sistema D (Moki · "D · Cristal × Imprenta").

// Colores de pegatina de los stacks, por posición dentro del proyecto.
const STACK_COLORS = ['#FF8A6B', '#8FA8FF', '#7FD6A2', '#FFD23F', '#D7B8FF', '#FFB5D8'];

export function stackColor(index) {
  return STACK_COLORS[(index < 0 ? 0 : index) % STACK_COLORS.length];
}

export function StackChip({ name, version, index = 0, small = false }) {
  return (
    <span className={small ? 'sticker small' : 'sticker'} style={{ background: stackColor(index) }}>
      {name}{version ? ` ${version}` : ''}
    </span>
  );
}

/** Estado corto de una card para el board, según su columna y lo que tiene. */
export function cardStatus(card, column) {
  if (column?.archive) return { label: '✓ ARCHIVADA', tone: 'muted' };
  if (column?.mode === 'document') {
    return card.documentationStatus === 'documented'
      ? { label: '✓ DOCUMENTADA', tone: 'ok' }
      : { label: '→ DOCUMENTAR', tone: 'warn' };
  }
  if (card.designStatus === 'stale') return { label: '! DISEÑO VIEJO', tone: 'warn' };
  if (card.design) return { label: '✓ DISEÑADA', tone: 'ok' };
  if (card.definition) return { label: '✓ DEFINIDA', tone: 'ok' };
  return { label: 'BORRADOR', tone: 'muted' };
}

export function elapsed(since) {
  if (!since) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Re-renderiza cada segundo mientras `active` (cronómetros de agentes). */
export function useTicker(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

export function timeAgo(value) {
  if (!value) return '—';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 2) return 'ayer';
  return new Date(value).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

export function Markdown({ source, className = 'md' }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: marked.parse(source || '') }} />;
}

// Origen de una versión de doc o regla.
const SOURCES = {
  agent: { label: 'AGENTE', color: '#FFD23F' },
  mcp: { label: 'MCP', color: '#8FA8FF' },
  ui: { label: 'UI', color: '#FFFFFF' },
  import: { label: 'IMPORT', color: '#7FD6A2' },
};

export function SourceChip({ source }) {
  const item = SOURCES[source] || { label: String(source).toUpperCase(), color: '#FFFFFF' };
  return <span className="sticker small mono" style={{ background: item.color }}>{item.label}</span>;
}

/** Etapas de la card: Borrador → Definición → Diseño → Desarrollo → Documentación. */
export function Lifecycle({ card, column, agent }) {
  const developed = column?.mode === 'document' || column?.archive;
  const steps = [
    { label: 'Borrador', done: Boolean(card.draft.trim()) || Boolean(card.definition) },
    { label: 'Definición', done: Boolean(card.definition), live: agent?.mode === 'define' },
    { label: 'Diseño', done: card.designStatus === 'ready' || card.designStatus === 'promoted', warn: card.designStatus === 'stale', live: agent?.slot === 'design' },
    { label: 'Desarrollo', done: developed },
    { label: 'Documentación', done: card.documentationStatus === 'documented', live: agent?.mode === 'document' },
  ];
  // La etapa actual es la primera sin terminar.
  const current = steps.findIndex((step) => !step.done);
  return (
    <ol className="lifecycle">
      {steps.map((step, index) => {
        const state = step.live ? 'live' : step.warn ? 'warn' : step.done ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={step.label} className={`step ${state}`}>
            <span className="mono">{step.live ? '●' : step.warn ? '!' : step.done ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
