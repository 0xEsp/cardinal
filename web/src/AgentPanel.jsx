import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import ModelPicker from './ModelPicker.jsx';

// slot "design": el agente de diseño solo puede usar proveedores CLI (Paper y Moki van por MCP).
function initialChoice(config, slot) {
  const { defaults, providers } = config;
  if (slot !== 'design' || providers.find((p) => p.id === defaults.provider)?.kind === 'cli') {
    return { provider: defaults.provider, model: defaults.model, effort: defaults.effort || '' };
  }
  const cli = providers.find((p) => p.kind === 'cli' && p.ready) || providers.find((p) => p.kind === 'cli');
  return { provider: cli?.id || '', model: cli?.defaultModel || '', effort: '' };
}

/**
 * Consola + chat de un agente. `actions` sustituye el botón de lanzar por
 * varias tareas (p. ej. diseñar / aplicar comentarios / promocionar).
 * `launchParams` se añade al lanzar (p. ej. la herramienta de diseño elegida).
 */
export default function AgentPanel({ card, config, mode, slot = 'main', actions = null, launchParams = null, emptyText = null, documentOnly = false, onChanged, showToast }) {
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [choice, setChoice] = useState(() => initialChoice(config, slot));
  const providers = slot === 'design' ? config.providers.filter((p) => p.kind === 'cli') : config.providers;
  const providerReady = providers.some((p) => p.id === choice.provider && p.ready);
  const [input, setInput] = useState('');
  const consoleRef = useRef(null);
  const streamText = useRef('');

  useEffect(() => {
    setEvents([]);
    streamText.current = '';
    const es = new EventSource(`/api/agent/${card.id}/stream?slot=${slot}`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'history') {
        const matchesMode = !documentOnly || ev.mode === 'document';
        setHasSession(matchesMode && ev.messages.length > 0);
        setRunning(matchesMode && ev.running);
        setActive(matchesMode && ev.active);
        if (matchesMode && ev.model) setChoice({ provider: ev.provider || 'openrouter', model: ev.model, effort: ev.effort || '' });
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
      } else if (ev.type === 'validation') {
        setEvents((prev) => [
          ...prev,
          {
            kind: ev.validation?.ok ? 'validation' : 'error',
            text: ev.validation?.ok
              ? `✓ Validación estructural correcta${ev.validation.warnings?.length ? ` · ${ev.validation.warnings.length} aviso(s)` : ''}`
              : `Validación bloqueada: ${(ev.validation?.errors || []).join(' ')}`,
          },
        ]);
      } else if (ev.type === 'review') {
        const review = ev.review || {};
        const issues = (review.issues || []).map((issue) => issue.message).join(' ');
        setEvents((prev) => [
          ...prev,
          {
            kind: review.ok ? 'review' : 'error',
            text: review.ok ? `✓ Revisión aprobada${review.summary ? ` · ${review.summary}` : ''}` : `Revisión pendiente: ${issues || review.summary || 'corrige el candidato y repite'}`,
          },
        ]);
      } else if (ev.type === 'saved') {
        onChanged();
        setEvents((prev) => [...prev, { kind: 'saved', text: SAVED_TEXT[ev.target]?.(ev) || `✦ Documento guardado: ${ev.path}` }]);
      } else if (ev.type === 'user') {
        streamText.current = '';
        setEvents((prev) => [...prev, { kind: 'user', text: ev.text }]);
      } else if (ev.type === 'started') {
        setHasSession(true);
        setActive(true);
        const designLabel = ev.designTool ? config.designTools?.tools?.[ev.designTool]?.label || ev.designTool : null;
        setEvents([{ kind: 'info', text: `Agente lanzado · ${ev.task ? `diseño (${TASK_LABELS[ev.task] || ev.task})${designLabel ? ` en ${designLabel}` : ''}` : `modo ${ev.mode}`} · ${ev.provider} · ${ev.model}${ev.effort ? ` · effort ${ev.effort}` : ''}` }]);
      } else if (ev.type === 'info') {
        setEvents((prev) => [...prev, { kind: 'info', text: ev.message }]);
      } else if (ev.type === 'status') {
        setRunning(ev.running);
        setActive(ev.active);
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
  }, [card.id, documentOnly, slot]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [events]);

  const launch = async (task) => {
    try {
      await api.startAgent(card.id, { slot, task, ...choice, ...launchParams });
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const stop = async () => {
    try {
      await api.stopAgent(card.id, slot);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    try {
      await api.sendMessage(card.id, input.trim(), slot);
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
          <ModelPicker providers={providers} provider={choice.provider} model={choice.model} effort={choice.effort} onChange={setChoice} disabled={active} />
          <button className="btn primary document-button" onClick={() => launch()} disabled={running || active || !providerReady || !choice.model.trim() || !canDocument}>
            {active ? running ? '⏳ Documentando…' : 'Esperando instrucciones' : documented ? '↻ Documentar de nuevo' : '▶ Documentar'}
          </button>
          {active && <button className="btn danger" onClick={stop}>■ Detener agente</button>}
          {!providerReady && <p className="empty">Configura un proveedor de IA en la pestaña IA para lanzar el agente.</p>}
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
        {active && !running && (
          <form className="agent-input" onSubmit={send}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Da una indicación para continuar…" />
            <button className="btn" type="submit" disabled={!input.trim()}>Enviar</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="agent-panel">
      <div className="agent-toolbar">
        <ModelPicker providers={providers} provider={choice.provider} model={choice.model} effort={choice.effort} onChange={setChoice} disabled={active} />
        {actions ? (
          actions.map((action) => (
            <button
              key={action.task}
              className={action.primary ? 'btn primary' : 'btn'}
              onClick={() => launch(action.task)}
              // Una sesión de diseño que espera instrucciones se puede sustituir por otra tarea.
              disabled={running || !providerReady || !choice.model.trim() || action.disabled}
              title={action.title}
            >
              {action.label}
            </button>
          ))
        ) : (
          <button className="btn primary" onClick={() => launch()} disabled={running || active || !providerReady || !choice.model.trim()}>
            {active ? running ? '⏳ Trabajando…' : 'Esperando instrucciones' : hasSession ? '↻ Relanzar' : mode === 'define' ? '▶ Definir card' : '▶ Documentar'}
          </button>
        )}
        {actions && active && <span className="agent-mode">{running ? '⏳ Trabajando…' : 'Esperando instrucciones'}</span>}
        {active && <button className="btn danger" onClick={stop}>■ Detener agente</button>}
        {!actions && (
          <span className="agent-mode">
            modo: <b>{mode === 'define' ? 'definición' : 'documentación'}</b> (según columna)
          </span>
        )}
      </div>

      <div className="console" ref={consoleRef}>
        {events.length === 0 && (
          <p className="empty">
            {emptyText || (mode === 'define'
              ? 'El agente cogerá tu borrador y lo convertirá en una definición completa según las reglas de os/.'
              : 'El agente cogerá la definición y creará/actualizará la documentación de producto en workspace/docs/.')}
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
          disabled={running || !active}
        />
        <button className="btn" type="submit" disabled={running || !active || !input.trim()}>Enviar</button>
      </form>
    </div>
  );
}

const TASK_LABELS = { design: 'diseñar', comments: 'aplicar comentarios', promote: 'promocionar' };

const SAVED_TEXT = {
  definition: () => '✦ Definición guardada en la card',
  design: (ev) => (ev.promoted ? '✦ Diseño promocionado a las páginas canónicas' : '✦ Diseño guardado en la card'),
};

function describeTool(name, args) {
  // En vivo llega el resumen ({artboards: n}); en el historial, el manifiesto completo.
  const artboards = typeof args.artboards === 'number' ? args.artboards : args.manifest?.artboards?.length ?? '?';
  if (name === 'review_design') return `review_design (${artboards} artboards)`;
  if (name === 'save_design') return `save_design (${artboards} artboards${args.promoted ? ', promocionado' : ''})`;
  if (name.startsWith('paper.') || name.startsWith('moki.')) return `🎨 ${name}`;
  if (name === 'save_definition') return `save_definition (${args.chars ?? '?'} caracteres)`;
  if (name === 'review_definition') return `review_definition (${args.chars ?? '?'} caracteres)`;
  if (name === 'save_doc') return `save_doc → ${args.path ?? '?'}`;
  if (name === 'review_doc') return `review_doc → ${args.path ?? '?'}`;
  if (name === 'read_doc') return `read_doc → ${args.path ?? '?'}`;
  if (name === 'list_docs') return 'list_docs';
  if (name === 'search_docs') return `search_docs → ${args.query ?? '?'}`;
  return name;
}
