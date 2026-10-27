import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { copyText } from './clipboard.js';
import { timeAgo } from './ui.jsx';

const TOOLS = [
  ['CARDS', 'list_cards · get_card · create_card · update_card · move_card · comment_card · get_feature_prompt'],
  ['DOCS', 'list_docs · search_docs · read_doc · write_doc · doc_history'],
  ['REGLAS Y PROYECTOS', 'list_projects · list_rules · read_rule · update_rule'],
];

// Cómo añadir el MCP en cada cliente. `token` es el valor real recién creado o
// un marcador si ya no se puede mostrar.
const CLIENTS = [
  { id: 'claude', label: 'CLAUDE CODE', command: (url, token) => `claude mcp add --transport http cardinal ${url} --header "Authorization: Bearer ${token}"` },
  {
    id: 'codex',
    label: 'CODEX (~/.codex/config.toml)',
    command: (url, token) => `[mcp_servers.cardinal]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
  },
  {
    id: 'cursor',
    label: 'CURSOR (.cursor/mcp.json)',
    command: (url, token) => JSON.stringify({ mcpServers: { cardinal: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
];

/** Conexiones · MCP de agentes (Moki · D · Conexiones MCP). */
export default function McpView({ projects, showToast }) {
  const [tokens, setTokens] = useState(null);
  const [form, setForm] = useState(null);
  const [created, setCreated] = useState(null);
  const [client, setClient] = useState('claude');
  const url = `${window.location.origin}/mcp`;

  const load = () => api.mcpTokens().then(setTokens).catch((e) => showToast(e.message, true));
  useEffect(() => {
    load();
  }, []);

  const copy = async (text, label) => {
    await copyText(text);
    showToast(`${label} copiado`);
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const token = await api.createMcpToken(form);
      setCreated(token);
      setForm(null);
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const revoke = async (token) => {
    if (!window.confirm(`¿Revocar «${token.name}»? Los agentes que lo usen dejarán de tener acceso.`)) return;
    try {
      await api.revokeMcpToken(token.id);
      if (created?.id === token.id) setCreated(null);
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const toggleProject = (id) => {
    const current = form.projects.filter((p) => p !== '*');
    const next = current.includes(id) ? current.filter((p) => p !== id) : [...current, id];
    setForm({ ...form, projects: next.length ? next : ['*'] });
  };

  const snippet = CLIENTS.find((c) => c.id === client).command(url, created?.token || 'crd_…tu-token');

  return (
    <div className="page">
      <header className="page-head">
        <div className="grow">
          <p className="crumb">conexiones / mcp de agentes</p>
          <h1>Conecta tus agentes</h1>
          <p className="muted">Claude Code, Codex o Cursor leen y escriben cards, docs y reglas sin clonar ningún repositorio.</p>
        </div>
        <button className="btn primary" onClick={() => setForm({ name: '', projects: ['*'], access: 'write' })}>+ Nuevo token</button>
      </header>

      <div className="page-body stack">
        {form && (
          <form className="block yellow" onSubmit={create}>
            <h2>Nuevo token</h2>
            <label className="field">
              <span className="mono small">NOMBRE</span>
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MacBook · Claude Code" />
            </label>
            <div className="field">
              <span className="mono small">PROYECTOS</span>
              <div className="chips">
                <button type="button" className={form.projects.includes('*') ? 'chip ink' : 'chip'} onClick={() => setForm({ ...form, projects: ['*'] })}>Todos</button>
                {projects.map((p) => (
                  <button key={p.id} type="button" className={form.projects.includes(p.id) ? 'chip ink' : 'chip'} onClick={() => toggleProject(p.id)}>{p.name}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="mono small">PERMISO</span>
              <div className="segmented">
                <button type="button" className={form.access === 'write' ? 'on' : ''} onClick={() => setForm({ ...form, access: 'write' })}>Lectura + escritura</button>
                <button type="button" className={form.access === 'read' ? 'on' : ''} onClick={() => setForm({ ...form, access: 'read' })}>Solo lectura</button>
              </div>
            </div>
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn ink" type="submit" disabled={!form.name.trim()}>Crear token</button>
            </div>
          </form>
        )}

        {created && (
          <div className="block">
            <h2>Token creado: {created.name}</h2>
            <p className="muted">Cópialo ahora: por seguridad no se vuelve a mostrar.</p>
            <div className="code-row">
              <code className="mono grow">{created.token}</code>
              <button className="link" onClick={() => copy(created.token, 'Token')}>Copiar</button>
            </div>
          </div>
        )}

        <section className="block">
          <div className="row">
            <h2 className="grow">Endpoint</h2>
            <span className="sticker small mono" style={{ background: '#7FD6A2' }}>● EN LÍNEA</span>
          </div>
          <div className="code-row">
            <code className="mono grow">{url}</code>
            <button className="link" onClick={() => copy(url, 'Endpoint')}>Copiar</button>
          </div>
          <div className="segmented small">
            {CLIENTS.map((c) => <button key={c.id} className={client === c.id ? 'on' : ''} onClick={() => setClient(c.id)}>{c.label.split(' (')[0]}</button>)}
          </div>
          <div className="terminal">
            <p className="mono small terminal-label">{CLIENTS.find((c) => c.id === client).label}</p>
            <pre className="mono">{snippet}</pre>
            <button className="link light" onClick={() => copy(snippet, 'Comando')}>Copiar</button>
          </div>
          {!created && <p className="muted small">Crea un token para tener el comando completo con tu token.</p>}
        </section>

        <div className="split">
          <section className="grow">
            <h2>Tokens</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>NOMBRE</th><th>PROYECTOS</th><th>PERMISO</th><th>ÚLTIMO USO</th><th /></tr>
                </thead>
                <tbody>
                  {tokens?.length === 0 && <tr><td colSpan={5} className="muted">Aún no hay tokens.</td></tr>}
                  {tokens?.map((token) => (
                    <tr key={token.id}>
                      <td><strong>{token.name}</strong> <span className="mono small muted">…{token.prefix}</span></td>
                      <td>{token.projects.includes('*') ? 'Todos' : token.projects.map((id) => projects.find((p) => p.id === id)?.name || id).join(', ')}</td>
                      <td>
                        <span className="sticker small mono" style={{ background: token.access === 'write' ? '#7FD6A2' : '#8FA8FF' }}>
                          {token.access === 'write' ? 'LECTURA+ESCRITURA' : 'SOLO LECTURA'}
                        </span>
                      </td>
                      <td className="mono small">{token.lastUsedAt ? timeAgo(token.lastUsedAt) : 'nunca'}</td>
                      <td><button className="link small" onClick={() => revoke(token)}>revocar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <aside className="block yellow tools-block">
            <h2>Herramientas expuestas</h2>
            {TOOLS.map(([label, names]) => (
              <div key={label}>
                <p className="mono small">{label}</p>
                <p className="mono small tools-names">{names}</p>
              </div>
            ))}
            <p className="small">Un token de solo lectura no ve las herramientas que escriben.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
