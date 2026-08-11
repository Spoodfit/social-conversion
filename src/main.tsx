import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

type RuntimeState = {
  mode: 'demo' | 'live';
  ready: boolean;
};

function RuntimeGate() {
  const uiOnly = import.meta.env.VITE_UI_ONLY === 'true';
  const [runtime, setRuntime] = useState<RuntimeState>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (uiOnly) return undefined;
    let active = true;
    fetch('/api/runtime', { headers: { accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error('runtime unavailable');
        return response.json() as Promise<RuntimeState>;
      })
      .then((payload) => active && setRuntime(payload))
      .catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [uiOnly]);

  if (uiOnly) return <App />;

  if (failed) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f6f7fb', color: '#161823', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <section style={{ maxWidth: 560 }}>
          <strong>Social Conversion indisponible</strong>
          <p>Le runtime n’a pas pu être vérifié. Aucune donnée de démonstration n’est affichée à la place d’un environnement indisponible.</p>
        </section>
      </main>
    );
  }

  if (!runtime) {
    return <main aria-busy="true" style={{ minHeight: '100vh', background: '#f6f7fb' }} />;
  }

  if (runtime.mode === 'live' && !runtime.ready) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f6f7fb', color: '#161823', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <section style={{ maxWidth: 600 }}>
          <strong>Environnement live verrouillé</strong>
          <p>Les connecteurs sociaux et les sources de données production ne sont pas encore validés. Le mode live reste volontairement inaccessible pour éviter toute simulation présentée comme réelle.</p>
        </section>
      </main>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeGate />
  </StrictMode>,
);
