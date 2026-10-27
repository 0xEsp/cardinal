import React, { useEffect, useRef, useState } from 'react';
import { href } from './router.js';

/**
 * Barra lateral (componente `D / Sidebar` en Moki): selector de proyecto,
 * secciones numeradas del proyecto y conexiones globales.
 */
export default function Sidebar({ projects, project, route, counts, running }) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef(null);

  useEffect(() => {
    if (!switcherOpen) return undefined;
    const close = (event) => !switcherRef.current?.contains(event.target) && setSwitcherOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [switcherOpen]);

  useEffect(() => setSwitcherOpen(false), [route.view, route.projectId]);

  const at = (view) => route.view === view || (view === 'board' && route.view === 'card');
  const projectLink = (view) => (project ? href({ projectId: project.id, view }) : '#/new-project');

  const items = [
    { view: 'board', label: 'Board', meta: counts.cards },
    { view: 'docs', label: 'Docs', meta: project?.docCount },
    { view: 'rules', label: 'Reglas', meta: project?.ruleCount },
    { view: 'runs', label: 'Ejecuciones', dot: running },
  ];

  return (
    <aside className="sidebar">
      <a className="logo" href="#/">
        <span className="logo-dot" />
        <span>cardinal</span>
      </a>

      <div className="switcher" ref={switcherRef}>
        <button className="switcher-button" onClick={() => setSwitcherOpen((open) => !open)} aria-expanded={switcherOpen}>
          <span className="project-badge" style={{ background: project?.color }}>{project?.name?.[0] || '+'}</span>
          <span className="switcher-text">
            <span className="switcher-name">{project?.name || 'Sin proyecto'}</span>
            <span className="mono small">{project ? `${project.cardCount} cards · ${project.docCount} docs` : 'crea el primero'}</span>
          </span>
          <span className="switcher-caret">▾</span>
        </button>
        {switcherOpen && (
          <div className="switcher-menu" role="menu">
            {projects.map((item) => (
              <a key={item.id} role="menuitem" className={item.id === project?.id ? 'menu-row active' : 'menu-row'} href={href({ projectId: item.id, view: 'board' })}>
                <span className="project-badge small" style={{ background: item.color }}>{item.name[0]}</span>
                <span className="grow">{item.name}</span>
                <span className="mono small">{item.cardCount} cards</span>
              </a>
            ))}
            <div className="menu-sep" />
            {project && <a role="menuitem" className="menu-row" href={projectLink('settings')}>Ajustes de {project.name}</a>}
            <a role="menuitem" className="menu-row accent" href="#/new-project">+ Nuevo proyecto</a>
          </div>
        )}
      </div>

      <nav className="nav">
        {items.map((item, index) => (
          <a key={item.view} className={at(item.view) ? 'nav-row active' : 'nav-row'} href={projectLink(item.view)}>
            <span className="nav-num">{String(index + 1).padStart(2, '0')}</span>
            <span className="grow">{item.label}</span>
            {item.dot ? <span className="nav-dot" title="Hay un agente trabajando" /> : <span className="mono small">{item.meta ?? ''}</span>}
          </a>
        ))}
      </nav>

      <div className="nav-group">
        <p className="nav-label">CONEXIONES</p>
        <nav className="nav">
          <a className={at('mcp') ? 'nav-row active' : 'nav-row'} href="#/mcp">
            <span className="nav-num">05</span>
            <span className="grow">MCP de agentes</span>
          </a>
          <a className={at('ai') ? 'nav-row active' : 'nav-row'} href="#/ai">
            <span className="nav-num">06</span>
            <span className="grow">IA y diseño</span>
          </a>
        </nav>
      </div>

      <div className="user">
        <span className="avatar">M</span>
        <span className="switcher-text">
          <span className="switcher-name">Manu</span>
          <span className="mono small">CARDINAL · v2.0</span>
        </span>
      </div>
    </aside>
  );
}
