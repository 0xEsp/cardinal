import { getSessionData, saveSessionData } from './db.js';
import { getCard, saveDefinition } from './cards.js';
import { listDocs, readDoc, saveDoc } from './docs.js';
import { buildSystemPrompt, toolsForMode, modeForColumn } from './prompt.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOOL_ROUNDS = 15;

// cardId -> { mode, model, messages, running, listeners:Set, savedFiles:[] }
const sessions = new Map();

export function getSession(cardId) {
  if (sessions.has(cardId)) return sessions.get(cardId);
  const data = getSessionData(cardId);
  if (data) {
    const s = { ...data, running: false, listeners: new Set() };
    sessions.set(cardId, s);
    return s;
  }
  return null;
}

function persist(cardId, s) {
  const { listeners, running, onFinish, ...data } = s;
  saveSessionData(cardId, data);
}

function emit(s, event) {
  for (const res of s.listeners) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

export function subscribe(cardId, res) {
  let s = getSession(cardId);
  if (!s) {
    s = { mode: null, model: null, messages: [], running: false, listeners: new Set(), savedFiles: [] };
    sessions.set(cardId, s);
  }
  s.listeners.add(res);
  // Replay del historial para que la consola muestre la conversación al reconectar
  res.write(`data: ${JSON.stringify({ type: 'history', messages: publicMessages(s), running: s.running })}\n\n`);
  res.on('close', () => s.listeners.delete(res));
}

export function publicMessages(s) {
  return s.messages
    .filter((m) => m.role !== 'system' && m.role !== 'tool')
    .map((m) => ({
      role: m.role,
      content: m.content || '',
      toolCalls: (m.tool_calls || []).map((t) => ({
        name: t.function.name,
        args: safeParse(t.function.arguments),
      })),
    }));
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function execTool(cardId, mode, name, args) {
  const s = sessions.get(cardId);
  switch (name) {
    case 'list_docs':
      return JSON.stringify(listDocs());
    case 'read_doc':
      try {
        return readDoc(args.path);
      } catch (e) {
        return `ERROR: ${e.message}`;
      }
    case 'save_definition': {
      if (mode !== 'define') return 'ERROR: herramienta no disponible en este modo';
      saveDefinition(cardId, args.content || '');
      s.savedFiles = ['definition'];
      emit(s, { type: 'saved', target: 'definition' });
      return 'Definición guardada en la card.';
    }
    case 'save_doc': {
      if (mode !== 'document') return 'ERROR: herramienta no disponible en este modo';
      const rel = saveDoc(args.path, args.content || '');
      if (!s.savedFiles.includes(`workspace/docs/${rel}`)) s.savedFiles.push(`workspace/docs/${rel}`);
      emit(s, { type: 'saved', target: 'doc', path: rel });
      return `Documento guardado: ${rel}`;
    }
    default:
      return `ERROR: herramienta desconocida ${name}`;
  }
}

async function streamCompletion(s, cardId) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Falta OPENROUTER_API_KEY en el entorno (.env)');

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'justgame-product-os',
      },
      body: JSON.stringify({
        model: s.model,
        messages: s.messages,
        tools: toolsForMode(s.mode),
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
    }

    let content = '';
    const toolCalls = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.error) throw new Error(json.error.message || 'Error de OpenRouter');
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          emit(s, { type: 'token', text: delta.content });
        }
        for (const tc of delta.tool_calls || []) {
          if (!toolCalls[tc.index]) {
            toolCalls[tc.index] = { id: tc.id || `call_${tc.index}`, type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) toolCalls[tc.index].id = tc.id;
          if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
        }
      }
    }

    const assistantMsg = { role: 'assistant', content: content || null };
    if (toolCalls.length) assistantMsg.tool_calls = toolCalls.filter(Boolean);
    s.messages.push(assistantMsg);

    if (!toolCalls.length) return; // el modelo ha terminado su turno

    for (const tc of assistantMsg.tool_calls) {
      const args = safeParse(tc.function.arguments);
      emit(s, { type: 'tool', name: tc.function.name, args: summarizeArgs(tc.function.name, args) });
      const result = execTool(cardId, s.mode, tc.function.name, args);
      s.messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
    persist(cardId, s);
  }
  throw new Error(`El agente superó el máximo de ${MAX_TOOL_ROUNDS} rondas de herramientas`);
}

function summarizeArgs(name, args) {
  if (name === 'save_definition') return { chars: (args.content || '').length };
  if (name === 'save_doc') return { path: args.path, chars: (args.content || '').length };
  return args;
}

async function run(cardId, s) {
  s.running = true;
  emit(s, { type: 'status', running: true });
  try {
    await streamCompletion(s, cardId);
    emit(s, { type: 'done', savedFiles: s.savedFiles });
  } catch (e) {
    emit(s, { type: 'error', message: e.message });
  } finally {
    s.running = false;
    persist(cardId, s);
    emit(s, { type: 'status', running: false });
    if (s.onFinish) s.onFinish(s);
  }
}

export function startAgent(cardId, { model, onFinish }) {
  const card = getCard(cardId);
  const mode = modeForColumn(card.column);
  if (!mode) throw Object.assign(new Error('Una card en "done" no lanza agente'), { status: 400 });

  const existing = getSession(cardId);
  if (existing?.running) throw Object.assign(new Error('Ya hay un agente corriendo para esta card'), { status: 409 });

  const s = {
    mode,
    model: model || process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
    messages: [
      { role: 'system', content: buildSystemPrompt(mode, card) },
      {
        role: 'user',
        content:
          mode === 'define'
            ? 'Genera la definición completa de esta card y guárdala con save_definition. Después resume brevemente qué has definido y qué decisiones has tomado.'
            : 'Actualiza o crea la documentación de producto que corresponda a esta card y guárdala con save_doc. Después resume brevemente qué documentos has tocado y por qué.',
      },
    ],
    running: false,
    listeners: existing?.listeners || new Set(),
    savedFiles: [],
    onFinish,
  };
  sessions.set(cardId, s);
  emit(s, { type: 'started', mode, model: s.model });
  run(cardId, s);
  return { mode, model: s.model };
}

export function sendMessage(cardId, content, { onFinish }) {
  const s = getSession(cardId);
  if (!s || !s.messages.length) throw Object.assign(new Error('No hay sesión de agente para esta card; lánzalo primero'), { status: 400 });
  if (s.running) throw Object.assign(new Error('El agente aún está trabajando'), { status: 409 });
  s.onFinish = onFinish;
  s.messages.push({ role: 'user', content });
  emit(s, { type: 'user', text: content });
  run(cardId, s);
}

export function sessionInfo(cardId) {
  const s = getSession(cardId);
  if (!s || !s.messages.length) return { exists: false };
  return { exists: true, running: s.running, mode: s.mode, model: s.model, messages: publicMessages(s) };
}
