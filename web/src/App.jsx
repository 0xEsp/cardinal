import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { navigate, useRoute } from './router.js';
import Sidebar from './Sidebar.jsx';
import Board from './Board.jsx';
import CardView from './CardView.jsx';
import DocsView from './DocsView.jsx';
import RunsView from './RunsView.jsx';
import McpView from './McpView.jsx';
import ProvidersView from './ProvidersView.jsx';
import ProjectSettings from './ProjectSettings.jsx';
import NewProject from './NewProject.jsx';

const LAST_PROJECT = 'cardinal:project';

function rememberedProject() {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

export default function App() {
  const route = useRoute();
  const [config, setConfig] = useState(null);
  const [projects, setProjects] = useState(null);
  const [cards, setCards] = useState([]);
  const [toast, setToast] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadConfig = useCallback(() => api.config().then((next) => {
    setConfig(next);
    setProjects(next.projects);
    return next;
  }).catch((e) => showToast(e.message, true)), [showToast]);

  const loadProjects = useCallback(() => api.projects().then(setProjects).catch((e) => showToast(e.message, true)), [showToast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Las vistas globales (MCP, IA) conservan el proyecto activo en la barra lateral.
  const [lastProjectId, setLastProjectId] = useState(rememberedProject);
  const projectId = route.projectId || lastProjectId;
  const project = projects?.find((p) => p.id === projectId) || null;

  useEffect(() => {
    if (!route.projectId) return;
    setLastProjectId(route.projectId);
    try {
      localStorage.setItem(LAST_PROJECT, route.projectId);
    } catch {
      // sin almacenamiento: solo se pierde recordar el último proyecto
    }
  }, [route.projectId]);

  // Sin ruta: al último proyecto, al primero o al asistente si no hay ninguno.
  useEffect(() => {
    if (!projects || route.view) return;
    const target = projects.find((p) => p.id === lastProjectId) || projects[0];
    navigate(target ? { projectId: target.id, view: 'board' } : { view: 'new-project' });
  }, [projects, route.view, lastProjectId]);

  const refresh = useCallback(async () => {
    if (!project) return;
    try {
      setCards(await api.cards(project.id));
    } catch (e) {
      showToast(e.message, true);
    }
  }, [project?.id, showToast]);

  useEffect(() => {
    setCards([]);
    refresh();
  }, [refresh]);

  // Mientras algún agente trabaja, el board se refresca para mostrar su estado.
  const anyRunning = cards.some((c) => c.agent);
  useEffect(() => {
    if (!anyRunning) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  // Al volver a la app (cambio de pestaña/app en móvil), re-sincroniza el estado.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => setMenuOpen(false), [route.view, route.projectId, route.param]);

  if (!config || !projects) return <div className="boot">cardinal</div>;

  if (route.view === 'new-project') {
    return (
      <>
        <NewProject
          projects={projects}
          onCancel={projects.length ? () => window.history.back() : null}
          onCreated={async (created) => {
            await loadProjects();
            navigate({ projectId: created.id, view: 'board' });
          }}
          showToast={showToast}
        />
        {toast && <div className={toast.isError ? 'toast error' : 'toast'}>{toast.msg}</div>}
      </>
    );
  }

  if (route.projectId && !project) {
    return (
      <div className="boot">
        <p>No existe el proyecto «{route.projectId}».</p>
        <a className="btn" href="#/">Volver</a>
      </div>
    );
  }

  const openCard = route.view === 'card' ? cards.find((c) => c.id === route.param) : null;
  const noProvider = !config.providers.some((p) => p.ready);

  return (
    <div className={menuOpen ? 'shell menu-open' : 'shell'}>
      <Sidebar
        projects={projects}
        project={project}
        route={route}
        counts={{ cards: cards.filter((c) => !project?.columns.find((col) => col.id === c.column)?.archive).length }}
        running={cards.some((c) => c.agent)}
        onClose={() => setMenuOpen(false)}
      />
      <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />

      <main className="main">
        <div className="mobile-bar">
          <button className="btn icon" onClick={() => setMenuOpen(true)} aria-label="Abrir menú">☰</button>
          <span className="mobile-brand"><span className="logo-dot" /> {project?.name || 'cardinal'}</span>
        </div>

        {noProvider && route.view !== 'ai' && (
          <div className="banner">
            No hay ningún proveedor de IA configurado: los agentes no podrán lanzarse.{' '}
            <a href="#/ai">Configurar</a>
          </div>
        )}

        {route.view === 'board' && project && (
          <Board project={project} cards={cards} onChanged={refresh} showToast={showToast} />
        )}
        {route.view === 'card' && project && (
          openCard
            ? <CardView key={openCard.id} project={project} card={openCard} config={config} onChanged={refresh} showToast={showToast} />
            : <p className="empty pad">Cargando card…</p>
        )}
        {(route.view === 'docs' || route.view === 'rules') && project && (
          <DocsView key={`${project.id}-${route.view}`} project={project} kind={route.view} selected={route.param} onChanged={loadProjects} showToast={showToast} />
        )}
        {route.view === 'runs' && project && <RunsView project={project} />}
        {route.view === 'settings' && project && (
          <ProjectSettings
            key={project.id}
            project={project}
            onChanged={loadProjects}
            onDeleted={async () => {
              const rest = projects.filter((p) => p.id !== project.id);
              await loadProjects();
              navigate(rest[0] ? { projectId: rest[0].id, view: 'board' } : { view: 'new-project' });
            }}
            showToast={showToast}
          />
        )}
        {route.view === 'mcp' && <McpView projects={projects} showToast={showToast} />}
        {route.view === 'ai' && <ProvidersView config={config} onConfigChanged={loadConfig} showToast={showToast} />}
      </main>

      {toast && <div className={toast.isError ? 'toast error' : 'toast'}>{toast.msg}</div>}
    </div>
  );
}
