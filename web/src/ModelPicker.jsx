import React, { useEffect, useState } from 'react';
import { api } from './api.js';

// Caché por proveedor compartida entre paneles: el catálogo de OpenRouter
// tiene cientos de modelos y no hace falta pedirlo en cada card.
const cache = new Map();

export function loadModels(providerId, refresh = false) {
  if (!refresh && cache.has(providerId)) return cache.get(providerId);
  const promise = api.providerModels(providerId, refresh).then((r) => r.models).catch((e) => {
    cache.delete(providerId);
    throw e;
  });
  cache.set(providerId, promise);
  return promise;
}

const CUSTOM = '__custom__';

/**
 * Selector de proveedor + modelo + effort. Tus modelos salen primero y después
 * el catálogo completo. "Escribir otro id…" permite usar un modelo que aún no
 * aparezca en el catálogo. El effort solo se muestra si el modelo lo admite y
 * sus niveles vienen del propio catálogo del proveedor.
 */
export default function ModelPicker({ providers, provider, model, effort = '', onChange, disabled, onlyReady = true }) {
  const [models, setModels] = useState([]);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    let alive = true;
    setModels([]);
    if (!provider) return undefined;
    loadModels(provider).then((list) => alive && setModels(list)).catch(() => {});
    return () => { alive = false; };
  }, [provider]);

  const options = providers.filter((p) => !onlyReady || p.ready || p.id === provider);
  const changeProvider = (id) => {
    const next = providers.find((p) => p.id === id);
    setCustom(false);
    onChange({ provider: id, model: next?.defaultModel || '', effort: '' });
  };
  const changeModel = (value) => {
    if (value === CUSTOM) {
      setCustom(true);
      return;
    }
    // Conserva el effort si el modelo nuevo también lo admite.
    const levels = models.find((m) => m.id === value)?.efforts || [];
    onChange({ provider, model: value, effort: levels.some((level) => level.id === effort) ? effort : '' });
  };

  const featured = models.filter((m) => m.featured);
  const rest = models.filter((m) => !m.featured);
  // Un modelo guardado que ya no está en el catálogo sigue siendo seleccionable.
  const unknown = model && models.length > 0 && !models.some((m) => m.id === model);
  const showInput = custom || (unknown && !models.length);
  const label = (m) => (m.label && m.label !== m.id ? `${m.id} · ${m.label}` : m.id);
  const current = models.find((m) => m.id === model);
  const efforts = current?.efforts || [];

  return (
    <div className="model-picker">
      <select value={provider || ''} onChange={(e) => changeProvider(e.target.value)} disabled={disabled} aria-label="Proveedor de IA">
        {options.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.ready}>{p.label}{p.ready ? '' : ' · no configurado'}</option>
        ))}
      </select>
      {showInput || !models.length ? (
        <input
          value={model || ''}
          onChange={(e) => onChange({ provider, model: e.target.value, effort })}
          onBlur={() => models.some((m) => m.id === model) && setCustom(false)}
          disabled={disabled}
          placeholder="id del modelo"
          aria-label="Modelo"
          spellCheck={false}
          autoFocus={custom}
        />
      ) : (
        <select value={model || ''} onChange={(e) => changeModel(e.target.value)} disabled={disabled} aria-label="Modelo">
          {unknown && <option value={model}>{model} (personalizado)</option>}
          {featured.length > 0 ? (
            <>
              <optgroup label="Tus modelos">
                {featured.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
              </optgroup>
              {rest.length > 0 && (
                <optgroup label="Catálogo completo">
                  {rest.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
                </optgroup>
              )}
            </>
          ) : rest.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
          <option value={CUSTOM}>✎ Escribir otro id…</option>
        </select>
      )}
      {efforts.length > 0 && (
        <select
          className="effort-select"
          value={effort}
          onChange={(e) => onChange({ provider, model, effort: e.target.value })}
          disabled={disabled}
          aria-label="Effort de razonamiento"
          title="Effort de razonamiento"
        >
          <option value="">effort: por defecto{current.defaultEffort ? ` (${current.defaultEffort})` : ''}</option>
          {efforts.map((level) => (
            <option key={level.id} value={level.id} title={level.description || undefined}>effort: {level.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
