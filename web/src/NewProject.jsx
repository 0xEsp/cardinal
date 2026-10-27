import React, { useState } from 'react';
import { api } from './api.js';
import { ColorPicker, ColumnsField, StacksField } from './ProjectEditors.jsx';

const STEPS = ['Nombre e identidad', 'Stacks y columnas', 'Reglas de partida', 'Importar docs'];

const DEFAULT_COLUMNS = [
  { name: 'Backlog', mode: 'define' },
  { name: 'Todo', mode: 'define' },
  { name: 'In progress', mode: 'define' },
  { name: 'Done dev', mode: 'document' },
  { name: 'Done', mode: null, archive: true },
];

/** Asistente de nuevo proyecto (Moki · D · Nuevo proyecto). */
export default function NewProject({ projects, onCancel, onCreated, showToast }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#FF8A6B',
    stacks: ['app', 'web', 'backend'],
    columns: DEFAULT_COLUMNS,
    copyRulesFrom: projects[0]?.id || '',
  });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const canNext = [form.name.trim(), form.stacks.length && form.columns.length >= 2, true, true][step];

  const readFiles = async (list) => {
    const read = await Promise.all([...list].filter((file) => file.name.endsWith('.md')).map(async (file) => ({
      path: (file.webkitRelativePath || file.name).split('/').slice(file.webkitRelativePath ? 1 : 0).join('/'),
      content: await file.text(),
    })));
    setFiles((current) => [...current.filter((f) => !read.some((r) => r.path === f.path)), ...read]);
  };

  const create = async () => {
    setBusy(true);
    try {
      const project = await api.createProject({
        name: form.name,
        description: form.description,
        color: form.color,
        stacks: form.stacks,
        columns: form.columns,
        copyRulesFrom: form.copyRulesFrom || undefined,
      });
      for (const file of files) await api.saveDoc(project.id, file.path, file.content, 'docs');
      showToast(`Proyecto ${project.name} creado${files.length ? ` con ${files.length} docs` : ''}`);
      onCreated(project);
    } catch (e) {
      showToast(e.message, true);
      setBusy(false);
    }
  };

  return (
    <div className="wizard">
      <aside className="wizard-side">
        <a className="logo" href="#/"><span className="logo-dot yellow" /><span>cardinal</span></a>
        <h1>Nuevo<br />proyecto</h1>
        <ol className="wizard-steps">
          {STEPS.map((label, index) => (
            <li key={label} className={index === step ? 'on' : index < step ? 'done' : ''}>
              <span className="mono small">{String(index + 1).padStart(2, '0')}</span>
              <span className="grow">{label}</span>
              {index < step && <span>✓</span>}
              {index === step && <span>●</span>}
            </li>
          ))}
        </ol>
      </aside>

      <main className="wizard-main">
        <p className="mono small muted">PASO {String(step + 1).padStart(2, '0')} / 04{form.name ? ` — ${form.name.toUpperCase()}` : ''}</p>

        {step === 0 && (
          <>
            <h2 className="wizard-title">¿Cómo se llama?</h2>
            <label className="field">
              <span className="mono small">NOMBRE</span>
              <input className="input big" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Koda" />
            </label>
            <label className="field">
              <span className="mono small">QUÉ ES, EN UNA FRASE</span>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="App de recetas y menú semanal para el hogar" />
            </label>
            <div className="field">
              <span className="mono small">COLOR</span>
              <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="wizard-title">¿Qué piezas tiene el producto?</h2>
            <p className="muted">Cada card podrá tocar uno o varios stacks, y cada stack lleva su versión. Los agentes reciben las reglas de QA del stack que toca la card.</p>
            <div className="field">
              <span className="mono small">STACKS</span>
              <StacksField stacks={form.stacks} onChange={(stacks) => setForm({ ...form, stacks })} />
            </div>
            <div className="field">
              <span className="mono small">COLUMNAS DEL BOARD Y QUÉ AGENTE SE LANZA EN CADA UNA</span>
              <ColumnsField columns={form.columns} onChange={(columns) => setForm({ ...form, columns })} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="wizard-title">¿Con qué reglas trabajan sus agentes?</h2>
            <div className="options">
              {projects.map((p) => (
                <button key={p.id} className={form.copyRulesFrom === p.id ? 'option on' : 'option'} onClick={() => setForm({ ...form, copyRulesFrom: p.id })}>
                  <strong>Copiar reglas de {p.name}</strong>
                  <span className="small">{p.ruleCount} reglas: definición, QA, diseño y documentación. Luego adáptalas.</span>
                </button>
              ))}
              <button className={!form.copyRulesFrom ? 'option on' : 'option'} onClick={() => setForm({ ...form, copyRulesFrom: '' })}>
                <strong>Empezar vacío</strong>
                <span className="small">Los agentes trabajarán sin guía hasta que escribas las reglas.</span>
              </button>
            </div>
            <p className="mono small muted">PODRÁS EDITARLAS EN REGLAS, DESDE LA UI O POR MCP.</p>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="wizard-title">¿Tienes ya documentación?</h2>
            <p className="muted">Arrastra o elige ficheros .md (por ejemplo, exportados de Notion). Es opcional: los docs también se crean al documentar cards o desde el MCP.</p>
            <label
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                readFiles(e.dataTransfer.files);
              }}
            >
              <input type="file" accept=".md" multiple onChange={(e) => readFiles(e.target.files)} hidden />
              <strong>Suelta aquí tus .md</strong>
              <span className="small">o haz clic para elegirlos</span>
            </label>
            {files.length > 0 && (
              <ul className="file-list mono small">
                {files.map((file) => (
                  <li key={file.path}>
                    {file.path}
                    <button className="link small" onClick={() => setFiles(files.filter((f) => f.path !== file.path))}>quitar</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="wizard-foot">
          {step > 0
            ? <button className="link" onClick={() => setStep(step - 1)}>← Atrás</button>
            : onCancel && <button className="link" onClick={onCancel}>Cancelar</button>}
          <span className="grow" />
          {step < 3
            ? <button className="btn ink big" disabled={!canNext} onClick={() => setStep(step + 1)}>Siguiente: {STEPS[step + 1].toLowerCase()} →</button>
            : <button className="btn primary big" disabled={busy} onClick={create}>{busy ? 'Creando…' : 'Crear proyecto'}</button>}
        </div>
      </main>
    </div>
  );
}
