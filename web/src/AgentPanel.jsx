import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import ModelPicker from './ModelPicker.jsx';
import { elapsed, useTicker } from './ui.jsx';

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
 * Consola del agente (panel oscuro de la card). `actions` sustituye el botón de
 * lanzar por varias tareas (diseñar / aplicar comentarios / promocionar) y
 * `launchParams` se añade al lanzar (p. ej. la herramienta de diseño elegida).
 */
export default function AgentPanel({ card, config, mode, slot = 'main', title, actions = null, launchParams = null, emptyText = null, onChanged, showToast }) {
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [choice, setChoice] = useState(() => initialChoice(config, slot));
  const providers = slot === 'design' ? config.providers.filter((p) => p.kind === 'cli') : config.providers;
  const providerReady = providers.some((p) => p.id === choice.provider && p.ready);
  const [input, setInput] = useState('');
  const streamRef = useRef(null);
  const streamText = useRef('');
  useTicker(running);

  useEffect(() => {
    setEvents([]);
    streamText.current = '';
    if (!mode) return undefined;
    const es = new EventSource(`/api/agent/${card.id}/stream?slot=${slot}`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'history') {
        // Una sesión principal de otro modo (p. ej. definición en una card que
        // ya está para documentar) no se mezcla con la de esta columna.
        const matchesMode = slot === 'design' || ev.mode === mode;
        setHasSession(matchesMode && ev.messages.length > 0);
        setRunning(matchesMode && ev.running);
        setActive(matchesMode && ev.active);
        if (matchesMode && ev.model) setChoice({ provider: ev.provider || 'openrouter', model: ev.model, effort: ev.effort || '' });
        setEvents(matchesMode
          ? ev.messages.flatMap((m) => {
            const out = [];
            if (m.role === 'user') out.push({ kind: 'user', text: m.content });
            if (m.role === 'assistant') {
              for (const t of m.toolCalls) out.push({ kind: 'tool', ...describeTool(t.name, t.args) });
              if (m.content) out.push({ kind: 'assistant', text: m.content });
            }
            return out;
          })
          : []);
      } else if (ev.type === 'token') {
        streamText.current += ev.text;
        setEvents((prev) => {
          const next = [...prev];
          if (next.length && next[next.length - 1].kind === 'streaming') next[next.length - 1] = { kind: 'streaming', text: streamText.current };
          else next.push({ kind: 'streaming', text: streamText.current });
          return next;
        });
      } else if (ev.type === 'tool') {
        streamText.current = '';
        setEvents((prev) => [
          ...prev.map((x) => (x.kind === 'streaming' ? { ...x, kind: 'assistant' } : x)),
          { kind: 'tool', ...describeTool(ev.name, ev.args) },
        ]);
      } else if (ev.type === 'validation') {
        const ok = ev.validation?.ok;
        setEvents((prev) => [...prev, {
          kind: ok ? 'check' : 'error',
          name: 'validación',
          detail: ok ? `correcta${ev.validation.warnings?.length ? ` · ${ev.validation.warnings.length} aviso(s)` : ''}` : (ev.validation?.errors || []).join(' '),
        }]);
      } else if (ev.type === 'review') {
        const review = ev.review || {};
        const issues = (review.issues || []).map((issue) => issue.message).join(' ');
        setEvents((prev) => [...prev, {
          kind: review.ok ? 'check' : 'error',
          name: 'revisión',
          detail: review.ok ? `aprobada${review.summary ? ` · ${review.summary}` : ''}` : issues || review.summary || 'corrige el candidato y repite',
        }]);
      } else if (ev.type === 'saved') {
        onChanged();
        setEvents((prev) => [...prev, { kind: 'saved', name: 'guardado', detail: SAVED_TEXT[ev.target]?.(ev) || `doc ${ev.path}` }]);
      } else if (ev.type === 'user') {
        streamText.current = '';
        setEvents((prev) => [...prev, { kind: 'user', text: ev.text }]);
      } else if (ev.type === 'started') {
        setHasSession(true);
        setActive(true);
        setStartedAt(new Date().toISOString());
        setChoice({ provider: ev.provider, model: ev.model, effort: ev.effort || '' });
        setEvents([{ kind: 'info', text: `${ev.provider}/${ev.model}${ev.effort ? ` · ${ev.effort}` : ''}${ev.task ? ` · ${TASK_LABELS[ev.task] || ev.task}` : ''}` }]);
      } else if (ev.type === 'info') {
        setEvents((prev) => [...prev, { kind: 'info', text: ev.message }]);
      } else if (ev.type === 'status') {
        setRunning(ev.running);
        setActive(ev.active);
        if (ev.running) setStartedAt((value) => value || new Date().toISOString());
        else {
          setStartedAt(null);
          setEvents((prev) => prev.map((x) => (x.kind === 'streaming' ? { ...x, kind: 'assistant' } : x)));
          streamText.current = '';
        }
      } else if (ev.type === 'done') {
        onChanged();
      } else if (ev.type === 'error') {
        setEvents((prev) => [...prev, { kind: 'error', name: 'error', detail: ev.message }]);
      }
    };
    return () => es.close();
  }, [card.id, mode, slot]);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
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

  if (!mode) {
    return (
      <aside className="console">
        <div className="console-head"><span className="console-dot" /><p className="console-title grow">Agente</p></div>
        <p className="console-empty">En esta columna no se lanza ningún agente: el ciclo de la card está completo.</p>
      </aside>
    );
  }

  const canLaunch = !running && providerReady && choice.model.trim();
  const launchButtons = actions || [{
    task: undefined,
    label: hasSession ? 'Relanzar' : mode === 'define' ? 'Definir card' : 'Documentar',
    primary: true,
    disabled: mode === 'document' && !card.definition.trim(),
  }];

  return (
    <aside className="console">
      <div className="console-head">
        <span className={running ? 'console-dot live' : active ? 'console-dot waiting' : 'console-dot'} />
        <div className="grow">
          <p className="console-title">{title}</p>
          <p className="mono small console-sub">
            {running ? `trabajando · ${elapsed(startedAt)}` : active ? 'esperando instrucciones' : hasSession ? 'detenido' : 'sin lanzar'}
            {hasSession ? ` · ${choice.provider}/${choice.model}` : ''}
          </p>
        </div>
        {active && <button className="btn console-stop mono" onClick={stop}>DETENER</button>}
      </div>

      {(!active || actions) && (
        <div className="console-launch">
          {!active && <ModelPicker providers={providers} provider={choice.provider} model={choice.model} effort={choice.effort} onChange={setChoice} />}
          <div className="console-actions">
            {launchButtons.map((action) => (
              <button
                key={action.task || 'main'}
                className={action.primary ? 'btn yellow' : 'btn dark'}
                onClick={() => launch(action.task)}
                // Una sesión de diseño que espera instrucciones se puede sustituir por otra tarea.
                disabled={!canLaunch || action.disabled || (!actions && active)}
                title={action.title}
              >
                {action.label}
              </button>
            ))}
          </div>
          {!providerReady && <p className="console-note">Configura un proveedor{slot === 'design' ? ' CLI (Codex o Claude)' : ''} en <a href="#/ai">IA y diseño</a>.</p>}
        </div>
      )}

      <div className="console-stream" ref={streamRef}>
        {events.length === 0 && (
          <p className="console-empty">
            {emptyText || (mode === 'define'
              ? 'El agente cogerá tu borrador, investigará los docs del proyecto y escribirá una definición completa siguiendo sus reglas.'
              : 'El agente cogerá la definición y creará o actualizará los docs de producto del proyecto.')}
          </p>
        )}
        {events.map((ev, i) => <ConsoleEvent key={i} ev={ev} />)}
      </div>

      <form className="console-input" onSubmit={send}>
        <input
          className="mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={active ? '> escribe al agente_' : '> lanza el agente primero'}
          disabled={running || !active}
        />
        <button className="btn yellow" type="submit" disabled={running || !active || !input.trim()}>Enviar</button>
      </form>
    </aside>
  );
}

function ConsoleEvent({ ev }) {
  if (ev.kind === 'user') return <p className="ev-user">{ev.text}</p>;
  if (ev.kind === 'assistant' || ev.kind === 'streaming') return <p className="ev-text">{ev.text}{ev.kind === 'streaming' ? '▌' : ''}</p>;
  if (ev.kind === 'info') return <p className="ev-info mono">{ev.text}</p>;
  return (
    <div className={`ev-row ${ev.kind}`}>
      <span className="ev-name mono">{ev.name}</span>
      <span className="ev-detail mono">{ev.detail}</span>
    </div>
  );
}

const TASK_LABELS = { design: 'diseñar', comments: 'aplicar comentarios', promote: 'promocionar' };

const SAVED_TEXT = {
  definition: () => 'definición en la card',
  design: (ev) => (ev.promoted ? 'diseño promocionado' : 'diseño en la card'),
};

function describeTool(name, args = {}) {
  // En vivo llega el resumen ({artboards: n}); en el historial, el manifiesto completo.
  const artboards = typeof args.artboards === 'number' ? args.artboards : args.manifest?.artboards?.length ?? '?';
  const detail = {
    review_design: `${artboards} artboards`,
    save_design: `${artboards} artboards${args.promoted ? ' · promocionado' : ''}`,
    save_definition: `${args.chars ?? '?'} caracteres`,
    review_definition: `${args.chars ?? '?'} caracteres`,
    save_doc: args.path,
    review_doc: args.path,
    read_doc: args.path,
    search_docs: args.query ? `"${args.query}"` : '',
  }[name];
  return { name, detail: detail ?? '' };
}
