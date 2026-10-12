import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Board from './Board.jsx';
import CardModal from './CardModal.jsx';
import DocsView from './DocsView.jsx';
import ProvidersView from './ProvidersView.jsx';

export default function App() {
  const [view, setView] = useState('board');
  const [config, setConfig] = useState(null);
  const [cards, setCards] = useState([]);
  const [openCardId, setOpenCardId] = useState(null);
  const [gitStatus, setGitStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    const [cs, gs] = await Promise.all([api.cards(), api.gitStatus().catch(() => null)]);
    setCards(cs);
    setGitStatus(gs);
  }, []);

  const loadConfig = useCallback(() => {
    api.config().then(setConfig).catch((e) => showToast(e.message, true));
  }, [showToast]);

  useEffect(() => {
    loadConfig();
    refresh();
  }, [loadConfig, refresh]);

  // Al volver a la app (cambio de pestaña/app en móvil), re-sincroniza el estado
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const handlePull = async () => {
    setSyncing(true);
    try {
      await api.gitPull();
      await refresh();
      showToast('Workspace actualizado desde el remoto');
    } catch (e) {
      showToast(`Pull falló: ${e.message}`, true);
    } finally {
      setSyncing(false);
    }
  };

  const handlePush = async () => {
    setSyncing(true);
    try {
      const r = await api.gitPush();
      await refresh();
      showToast(
        !r.pushed ? 'No hay remoto configurado: no se ha subido nada'
          : r.committed ? `Subidos ${r.files.length} fichero(s) del workspace`
          : r.ahead > 0 ? 'Sin cambios nuevos; commits pendientes subidos'
          : 'Nada nuevo que subir: la documentación ya está en el remoto'
      );
    } catch (e) {
      showToast(`Push falló: ${e.message}`, true);
    } finally {
      setSyncing(false);
    }
  };

  const openCard = cards.find((c) => c.id === openCardId);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" /> <span className="brand-full">Gotty · </span>Product OS
        </div>
        <nav>
          <button className={view === 'board' ? 'tab active' : 'tab'} onClick={() => setView('board')}>Board</button>
          <button className={view === 'docs' ? 'tab active' : 'tab'} onClick={() => setView('docs')}>Docs</button>
          <button className={view === 'ai' ? 'tab active' : 'tab'} onClick={() => setView('ai')}>IA</button>
        </nav>
        <div className="git-actions">
          {gitStatus && (
            <span className="git-status" title={gitStatus.files?.length ? gitStatus.files.join('\n') : 'sin cambios en workspace/ ni os/'}>
              {gitStatus.branch} · {gitStatus.dirty > 0 ? `${gitStatus.dirty} cambios` : 'limpio'}
            </span>
          )}
          <button className="btn" onClick={handlePull} disabled={syncing}>⬇<span className="btn-label"> Pull</span></button>
          <button className="btn" onClick={handlePush} disabled={syncing}>⬆<span className="btn-label"> Push</span></button>
        </div>
      </header>

      {config && !config.providers.some((p) => p.ready) && view !== 'ai' && (
        <div className="banner">
          No hay ningún proveedor de IA configurado — los agentes no podrán lanzarse.{' '}
          <button className="banner-link" onClick={() => setView('ai')}>Configurar</button>
        </div>
      )}

      {view === 'board' && <Board cards={cards} onOpen={setOpenCardId} onChanged={refresh} showToast={showToast} />}
      {view === 'docs' && <DocsView onSaved={refresh} showToast={showToast} />}
      {view === 'ai' && <ProvidersView onConfigChanged={loadConfig} showToast={showToast} />}

      {openCard && config && (
        <CardModal
          card={openCard}
          config={config}
          onClose={() => { setOpenCardId(null); refresh(); }}
          onChanged={refresh}
          showToast={showToast}
        />
      )}

      {toast && <div className={toast.isError ? 'toast error' : 'toast'}>{toast.msg}</div>}
    </div>
  );
}
