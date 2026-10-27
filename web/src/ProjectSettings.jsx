import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { ColorPicker, ColumnsField, StacksField } from './ProjectEditors.jsx';

/** Ajustes de un proyecto (Moki · D · Ajustes del proyecto). */
export default function ProjectSettings({ project, onChanged, onDeleted, showToast }) {
  const [form, setForm] = useState(() => pick(project));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(project));

  useEffect(() => setForm(pick(project)), [project.updatedAt]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateProject(project.id, form);
      await onChanged();
      showToast('Ajustes guardados');
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`¿Borrar el proyecto «${project.name}» con sus docs y reglas? No se puede deshacer.`)) return;
    try {
      await api.deleteProject(project.id);
      onDeleted();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="grow">
          <p className="crumb">{project.name} / ajustes</p>
          <h1>Ajustes de {project.name}</h1>
        </div>
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </header>
      <div className="page-body settings-grid">
        <div className="stack">
          <section className="block">
            <h2>Identidad</h2>
            <label className="field">
              <span className="mono small">NOMBRE</span>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="mono small">DESCRIPCIÓN (LA LEEN LOS AGENTES DEL MCP)</span>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qué es el producto, en una frase" />
            </label>
            <div className="field">
              <span className="mono small">COLOR</span>
              <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
            </div>
            <p className="mono small muted">ID: {project.id}</p>
          </section>
          <section className="block">
            <h2>Stacks</h2>
            <p className="muted small">Cada card toca uno o varios. Los agentes leen la regla <code>qa-criteria-&lt;stack&gt;.md</code> de los stacks de la card.</p>
            <StacksField stacks={form.stacks} onChange={(stacks) => setForm({ ...form, stacks })} />
          </section>
          <DesignFiles project={project} showToast={showToast} onChanged={onChanged} />
        </div>
        <div className="stack">
          <section className="block">
            <h2>Columnas</h2>
            <p className="muted small">El agente de cada columna es el que se lanza en sus cards. La de archivo no se muestra en el board.</p>
            <ColumnsField columns={form.columns} onChange={(columns) => setForm({ ...form, columns })} />
          </section>
          <section className="block danger">
            <h2>Zona peligrosa</h2>
            <p className="small">Borra el proyecto con sus docs, reglas y su historial.</p>
            <button className="btn danger" onClick={remove} disabled={project.cardCount > 0}>Borrar proyecto</button>
            {project.cardCount > 0 && <p className="mono small">TIENE {project.cardCount} CARDS: BÓRRALAS ANTES</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function pick(project) {
  return { name: project.name, description: project.description, color: project.color, stacks: project.stacks, columns: project.columns };
}

/** Fichero de diseño del proyecto en cada herramienta (Paper y Moki comparten conexión global). */
function DesignFiles({ project, showToast, onChanged }) {
  const [status, setStatus] = useState(null);
  const [choosing, setChoosing] = useState(null); // { tool, files }

  const load = () => api.projectDesignTools(project.id).then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    load();
  }, [project.id, project.updatedAt]);

  const choose = async (tool) => {
    try {
      setChoosing({ tool, files: (await api.designToolFiles(tool)).files });
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const select = async (tool, file) => {
    try {
      await api.updateProject(project.id, { design: { [tool]: { fileId: file.id, fileName: file.name } } });
      setChoosing(null);
      await onChanged();
      showToast(`Fichero de ${tool === 'moki' ? 'Moki' : 'Paper'}: ${file.name}`);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  return (
    <section className="block">
      <h2>Diseño</h2>
      <p className="muted small">El fichero donde los agentes de diseño pintan las cards de este proyecto. La conexión con cada herramienta se configura en <a href="#/ai">IA y diseño</a>.</p>
      {['moki', 'paper'].map((tool) => {
        const item = status?.tools?.[tool];
        const file = project.design?.[tool];
        return (
          <div key={tool} className="row bordered">
            <strong className="w-80">{tool === 'moki' ? 'Moki' : 'Paper'}</strong>
            <span className="grow small">{file?.fileId ? file.fileName || file.fileId : <span className="muted">sin fichero</span>}</span>
            {item && <span className="sticker small mono" style={{ background: item.ready ? '#7FD6A2' : '#FFFFFF' }}>{item.ready ? '● LISTO' : '○ NO LISTO'}</span>}
            <button className="btn tiny" onClick={() => choose(tool)}>{file?.fileId ? 'Cambiar fichero' : 'Elegir fichero'}</button>
          </div>
        );
      })}
      {choosing && (
        <div className="chips">
          {choosing.files.map((file) => (
            <button key={file.id} className={project.design?.[choosing.tool]?.fileId === file.id ? 'chip ink' : 'chip'} onClick={() => select(choosing.tool, file)}>{file.name}</button>
          ))}
          <button className="link small" onClick={() => setChoosing(null)}>cancelar</button>
        </div>
      )}
    </section>
  );
}
