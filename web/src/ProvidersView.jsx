import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ModelPicker, { loadModels } from './ModelPicker.jsx';

export default function ProvidersView({ onConfigChanged, showToast }) {
  const [data, setData] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    const next = await api.providers();
    setData(next);
    return next;
  }, []);

  useEffect(() => {
    reload().then((next) => setDefaults(next.defaults)).catch((e) => showToast(e.message, true));
  }, [reload, showToast]);

  // Mientras haya una instalación o un login en curso, refresca el estado.
  const pending = data?.providers.some((p) => p.install?.running || p.login?.status === 'pending');
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      reload().then((next) => {
        if (!next.providers.some((p) => p.install?.running || p.login?.status === 'pending')) onConfigChanged();
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, reload, onConfigChanged]);

  const act = async (key, fn, success) => {
    setBusy(key);
    try {
      const out = await fn();
      await reload();
      onConfigChanged();
      if (success) showToast(typeof success === 'function' ? success(out) : success);
      return true;
    } catch (e) {
      showToast(e.message, true);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!data || !defaults) return <div className="providers-view"><p className="empty">Cargando proveedores…</p></div>;
  const byId = Object.fromEntries(data.providers.map((p) => [p.id, p]));
  const common = { busy, act, showToast };

  return (
    <div className="providers-view">
      <section className="provider-card">
        <h2>Modelo por defecto</h2>
        <p className="provider-help">Es el que aparece preseleccionado al lanzar un agente. Puedes cambiarlo en cada card.</p>
        <ModelPicker
          providers={data.providers}
          provider={defaults.provider}
          model={defaults.model}
          onChange={(next) => setDefaults({ ...defaults, ...next })}
        />
        <label className="provider-check">
          <input
            type="checkbox"
            checked={Boolean(defaults.reviewer)}
            onChange={(e) => setDefaults({
              ...defaults,
              reviewer: e.target.checked ? { provider: defaults.provider, model: defaults.model } : null,
            })}
          />
          Usar otro proveedor/modelo para la revisión independiente
        </label>
        {defaults.reviewer && (
          <ModelPicker
            providers={data.providers}
            provider={defaults.reviewer.provider}
            model={defaults.reviewer.model}
            onChange={(next) => setDefaults({ ...defaults, reviewer: next })}
          />
        )}
        <div className="provider-actions">
          <button
            className="btn primary"
            disabled={busy === 'defaults'}
            onClick={() => act('defaults', async () => setDefaults(await api.saveProviderDefaults(defaults)), 'Preferencias guardadas')}
          >
            Guardar
          </button>
        </div>
      </section>

      <OpenRouterCard provider={byId.openrouter} {...common} />
      <CodexCard provider={byId.codex} {...common} />
      <ClaudeCard provider={byId.claude} {...common} />
    </div>
  );
}

function StatusPill({ provider }) {
  return (
    <span className={provider.ready ? 'provider-pill ready' : 'provider-pill'}>
      {provider.ready ? '● Listo' : `○ ${provider.message || 'No configurado'}`}
    </span>
  );
}

function CardHead({ provider, children }) {
  return (
    <div className="provider-head">
      <h2>{provider.label}</h2>
      <StatusPill provider={provider} />
      {children}
    </div>
  );
}

function CliRow({ provider, busy, act }) {
  const installing = provider.install?.running;
  return (
    <div className="provider-row">
      <span className="provider-label">CLI</span>
      <span className="provider-value">{provider.installed ? provider.version || 'instalado' : 'no instalado'}</span>
      <button
        className="btn"
        disabled={installing || busy === `${provider.id}-install`}
        onClick={() => act(`${provider.id}-install`, () => api.installProviderCli(provider.id))}
      >
        {installing ? '⏳ Instalando…' : provider.installed ? '↻ Actualizar' : '⬇ Instalar'}
      </button>
      {provider.install?.error && <div className="provider-error">{provider.install.error}<pre>{provider.install.log}</pre></div>}
    </div>
  );
}

function CommonActions({ provider, busy, act }) {
  const [refreshing, setRefreshing] = useState(false);
  if (!provider.ready) return null;
  const refreshModels = async () => {
    setRefreshing(true);
    try {
      await loadModels(provider.id, true);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="provider-actions">
      <button
        className="btn"
        disabled={busy === `${provider.id}-verify`}
        onClick={() => act(`${provider.id}-verify`, () => api.verifyProvider(provider.id), (r) => `Conexión correcta con ${r.model}: ${r.answer}`)}
      >
        {busy === `${provider.id}-verify` ? '⏳ Probando…' : 'Probar conexión'}
      </button>
      <button className="btn" disabled={refreshing} onClick={refreshModels}>{refreshing ? '⏳' : '↻'} Recargar modelos</button>
    </div>
  );
}

function SecretForm({ placeholder, label, onSave, multiline = false }) {
  const [value, setValue] = useState('');
  const Field = multiline ? 'textarea' : 'input';
  return (
    <form
      className="provider-secret"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(value.trim())) setValue('');
      }}
    >
      <Field
        type={multiline ? undefined : 'password'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        rows={multiline ? 4 : undefined}
      />
      <button className="btn primary" type="submit" disabled={!value.trim()}>{label}</button>
    </form>
  );
}

function OpenRouterCard({ provider, busy, act }) {
  return (
    <section className="provider-card">
      <CardHead provider={provider} />
      <p className="provider-help">Pago por uso con API key. Su catálogo se carga en vivo desde OpenRouter.</p>
      <div className="provider-row">
        <span className="provider-label">API key</span>
        <span className="provider-value">{provider.keySource === 'ui' ? 'guardada desde aquí' : provider.keySource === 'env' ? 'desde .env' : 'sin configurar'}</span>
        {provider.keySource === 'ui' && (
          <button className="btn danger" onClick={() => act('openrouter-del', () => api.deleteProviderCredentials('openrouter'), 'API key eliminada')}>Eliminar</button>
        )}
      </div>
      <SecretForm
        placeholder="sk-or-…"
        label="Guardar key"
        onSave={(apiKey) => act('openrouter-key', () => api.saveProviderCredentials('openrouter', { apiKey }), 'API key guardada')}
      />
      <CommonActions provider={provider} busy={busy} act={act} />
    </section>
  );
}

function CodexCard({ provider, busy, act }) {
  const login = provider.login;
  return (
    <section className="provider-card">
      <CardHead provider={provider} />
      <p className="provider-help">
        Usa tu suscripción de ChatGPT (Plus/Pro) a través del CLI oficial de Codex. Los modelos nuevos aparecen solos
        cuando OpenAI los publica; si alguno requiere una versión más reciente del CLI, pulsa Actualizar.
      </p>
      <CliRow provider={provider} busy={busy} act={act} />
      {provider.installed && (
        <div className="provider-row">
          <span className="provider-label">Cuenta</span>
          <span className="provider-value">{provider.loggedIn ? provider.account || 'conectada' : 'sin conectar'}</span>
          {provider.loggedIn ? (
            <button className="btn danger" onClick={() => act('codex-logout', () => api.deleteProviderCredentials('codex'), 'Cuenta desconectada')}>Desconectar</button>
          ) : login?.status !== 'pending' && (
            <button className="btn primary" onClick={() => act('codex-login', () => api.startCodexDeviceLogin())}>Conectar cuenta ChatGPT</button>
          )}
        </div>
      )}
      {login?.status === 'pending' && (
        <div className="device-login">
          {login.code ? (
            <>
              <p>1. Abre <a href={login.url} target="_blank" rel="noreferrer">{login.url}</a> en cualquier dispositivo.</p>
              <p>2. Introduce este código:</p>
              <code className="device-code">{login.code}</code>
              <p className="provider-help">Esperando confirmación… Si OpenAI pide activar el inicio de sesión por código de dispositivo, hazlo en los ajustes de seguridad de ChatGPT.</p>
            </>
          ) : <p>⏳ Pidiendo código a OpenAI…</p>}
          <button className="btn" onClick={() => act('codex-cancel', () => api.cancelCodexDeviceLogin())}>Cancelar</button>
        </div>
      )}
      {login?.status === 'failed' && <p className="provider-error">{login.error}</p>}
      {provider.installed && !provider.loggedIn && (
        <details className="provider-alt">
          <summary>Alternativa: pegar auth.json</summary>
          <p className="provider-help">
            En un ordenador con navegador ejecuta <code>codex login</code> y pega aquí el contenido de <code>~/.codex/auth.json</code>.
          </p>
          <SecretForm
            multiline
            placeholder='{"tokens": {…}}'
            label="Guardar"
            onSave={(authJson) => act('codex-auth', () => api.saveProviderCredentials('codex', { authJson }), 'Cuenta conectada')}
          />
        </details>
      )}
      <CommonActions provider={provider} busy={busy} act={act} />
    </section>
  );
}

function ClaudeCard({ provider, busy, act }) {
  return (
    <section className="provider-card">
      <CardHead provider={provider} />
      <p className="provider-help">
        Usa tu suscripción Pro/Max a través del CLI oficial de Claude Code. Los alias (opus, sonnet, haiku…) apuntan siempre
        al último modelo que conoce el CLI: actualízalo para tener los nuevos. También puedes escribir un id concreto.
      </p>
      <p className="provider-warning">
        ⚠ Anthropic solo permite usar la suscripción a través de Claude Code y para uso personal. Aquí siempre se invoca el
        binario oficial, pero revisa sus condiciones vigentes antes de depender de ello.
      </p>
      <CliRow provider={provider} busy={busy} act={act} />
      <div className="provider-row">
        <span className="provider-label">Token</span>
        <span className="provider-value">
          {provider.tokenSource === 'ui' ? 'guardado desde aquí' : provider.tokenSource === 'env' ? 'desde .env' : 'sin configurar'}
        </span>
        {provider.tokenSource === 'ui' && (
          <button className="btn danger" onClick={() => act('claude-del', () => api.deleteProviderCredentials('claude'), 'Token eliminado')}>Eliminar</button>
        )}
      </div>
      <p className="provider-help">
        En tu ordenador ejecuta <code>claude setup-token</code>, inicia sesión con tu cuenta y pega aquí el token que te
        devuelve (dura un año).
      </p>
      <SecretForm
        placeholder="sk-ant-oat01-…"
        label="Guardar token"
        onSave={(token) => act('claude-token', () => api.saveProviderCredentials('claude', { token }), 'Token guardado')}
      />
      <CommonActions provider={provider} busy={busy} act={act} />
    </section>
  );
}
