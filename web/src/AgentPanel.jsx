import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export default function AgentPanel({ card, config, mode, documentOnly = false, onChanged, showToast }) {
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [model, setModel] = useState(config.defaultModel);
  const [input, setInput] = useState('');
  const consoleRef = useRef(null);
  const streamText = useRef('');

  useEffect(() => {
    setEvents([]);
    streamText.current = '';
    const es = new EventSource(`/api/agent/${card.id}/stream`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'history') {
        const matchesMode = !documentOnly || ev.mode === 'document';
        setHasSession(matchesMode && ev.messages.length > 0);
        setRunning(matchesMode && ev.running);
        if (!matchesMode) {
          setEvents([]);
          return;
        }
        setEvents(
          ev.messages.flatMap((m) => {
            const out = [];
            if (m.role === 'user') out.push({ kind: 'user', text: m.content });
            if (m.role === 'assistant') {
              for (const t of m.toolCalls) out.push({ kind: 'tool', text: describeTool(t.name, t.args) });
              if (m.content) out.push({ kind: 'assistant', text: m.content });
            }
            return out;
          })
        );
      } else if (ev.type === 'token') {
        streamText.current += ev.text;
        setEvents((prev) => {
          const next = [...prev];
          if (next.length && next[next.length - 1].kind === 'streaming') {
            next[next.length - 1] = { kind: 'streaming', text: streamText.current };
          } else {
            next.push({ kind: 'streaming', text: streamText.current });
          }
          return next;
        });
      } else if (ev.type === 'tool') {
        streamText.current = '';
        setEvents((prev) => [
          ...prev.map((x) => (x.kind === 'streaming' ? { ...x, kind: 'assistant' } : x)),
          { kind: 'tool', text: describeTool(ev.name, ev.args) },
        ]);
      } else if (ev.type === 'saved') {
        onChanged();
        setEvents((prev) => [...prev, { kind: 'saved', text: ev.target === 'definition' ? '✦ Definición guardada en la card' : `✦ Documento guardado: ${ev.path}` }]);
      } else if (ev.type === 'user') {
        streamText.current = '';
        setEvents((prev) => [...prev, { kind: 'user', text: ev.text }]);
      } else if (ev.type === 'started') {
        setHasSession(true);
        setEvents([{ kind: 'info', text: `Agente lanzado · modo ${ev.mode} · ${ev.model}` }]);
      } else if (ev.type === 'status') {
        setRunning(ev.running);
        if (!ev.running) {
          setEvents((prev) => prev.map((x) => (x.kind === 'streaming' ? { ...x, kind: 'assistant' } : x)));
          streamText.current = '';
        }
      } else if (ev.type === 'done') {
        onChanged();
      } else if (ev.type === 'error') {
        setEvents((prev) => [...prev, { kind: 'error', text: ev.message }]);
      }
    };
    return () => es.close();
  }, [card.id, documentOnly]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [events]);

  const launch = async () => {
    try {
      await api.startAgent(card.id, model);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    try {
      await api.sendMessage(card.id, input.trim());
      setInput('');
    } catch (e2) {
      showToast(e2.message, true);
    }
  };

  if (!mode) return <p className="empty">Las cards en "done" no lanzan agente: su ciclo está completo.</p>;

  if (documentOnly) {
    const documented = card.documentationStatus === 'documented';
    const canDocument = Boolean(card.definition.trim());
    return (
      <div className="agent-panel documentation-agent">
        <div className="documentation-action">
          <button className="btn primary document-button" onClick={launch} disabled={running || !config.hasApiKey || !canDocument}>
            {running ? '⏳ Documentando…' : documented ? '↻ Documentar de nuevo' : '▶ Documentar'}
          </button>
          {!config.hasApiKey && <p className="empty">Configura OPENROUTER_API_KEY para lanzar el agente.</p>}
          {!canDocument && <p className="empty">Esta card necesita una Definición IA + antes de documentarse.</p>}
          {canDocument && !running && !events.length && (
            <p className="documentation-help">
              Un agente específico analizará la Definición IA + y la documentación existente para actualizar un documento o crear uno nuevo.
            </p>
          )}
        </div>
        {events.length > 0 && (
          <div className="console" ref={consoleRef}>
            {events.map((ev, i) => (
              <div key={i} className={`ev ev-${ev.kind}`}>
                {ev.kind === 'tool' && <span className="ev-badge">🔧</span>}
                {ev.kind === 'saved' && <span className="ev-badge">💾</span>}
                {ev.kind === 'error' && <span className="ev-badge">⚠</span>}
                <pre>{ev.text}{ev.kind === 'streaming' ? '▌' : ''}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="agent-panel">
      <div className="agent-toolbar">
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
          {config.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="btn primary" onClick={launch} disabled={running || !config.hasApiKey}>
          {running ? '⏳ Trabajando…' : hasSession ? '↻ Relanzar' : mode === 'define' ? '▶ Definir card' : '▶ Documentar'}
        </button>
        <span className="agent-mode">
          modo: <b>{mode === 'define' ? 'definición' : 'documentación'}</b> (según columna)
        </span>
      </div>

      <div className="console" ref={consoleRef}>
        {events.length === 0 && (
          <p className="empty">
            {mode === 'define'
              ? 'El agente cogerá tu borrador y lo convertirá en una definición completa según las reglas de os/.'
              : 'El agente cogerá la definición y creará/actualizará la documentación de producto en workspace/docs/.'}
          </p>
        )}
        {events.map((ev, i) => (
          <div key={i} className={`ev ev-${ev.kind}`}>
            {ev.kind === 'user' && <span className="ev-badge">tú</span>}
            {ev.kind === 'tool' && <span className="ev-badge">🔧</span>}
            {ev.kind === 'saved' && <span className="ev-badge">💾</span>}
            {ev.kind === 'error' && <span className="ev-badge">⚠</span>}
            <pre>{ev.text}{ev.kind === 'streaming' ? '▌' : ''}</pre>
          </div>
        ))}
      </div>

      <form className="agent-input" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasSession ? 'Itera con el agente: "cambia X", "añade la casuística Y"…' : 'Lanza el agente primero'}
          disabled={running || !hasSession}
        />
        <button className="btn" type="submit" disabled={running || !hasSession}>Enviar</button>
      </form>
    </div>
  );
}

function describeTool(name, args) {
  if (name === 'save_definition') return `save_definition (${args.chars ?? '?'} caracteres)`;
  if (name === 'save_doc') return `save_doc → ${args.path ?? '?'}`;
  if (name === 'read_doc') return `read_doc → ${args.path ?? '?'}`;
  if (name === 'list_docs') return 'list_docs';
  return name;
}
