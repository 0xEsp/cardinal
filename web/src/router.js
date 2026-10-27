import { useEffect, useState } from 'react';

// Rutas con hash (#/p/mi-proyecto/board): funcionan servidas desde cualquier ruta y
// el botón atrás del navegador (y del móvil) vuelve a la pantalla anterior.
//   #/p/:project/board · /card/:id · /docs · /rules · /runs · /settings
//   #/mcp · #/ai · #/new-project

const PROJECT_VIEWS = ['board', 'card', 'docs', 'rules', 'runs', 'settings'];

export function parseHash(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) {
    const view = PROJECT_VIEWS.includes(parts[2]) ? parts[2] : 'board';
    return { projectId: parts[1], view, param: parts.slice(3).join('/') || null };
  }
  if (['mcp', 'ai', 'new-project'].includes(parts[0])) return { projectId: null, view: parts[0], param: null };
  return { projectId: null, view: null, param: null };
}

export function href(route) {
  if (route.projectId) {
    const tail = route.param ? `/${encodeURIComponent(route.param)}` : '';
    return `#/p/${encodeURIComponent(route.projectId)}/${route.view || 'board'}${tail}`;
  }
  return `#/${route.view}`;
}

export function navigate(route) {
  window.location.hash = href(route);
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
