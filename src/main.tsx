import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveApp, { type LiveRuntimeState } from './LiveApp';
import './styles.css';

const DemoApp = lazy(() => import('./App'));

type RuntimeState = {
  mode: 'demo' | 'live';
  ready: boolean;
  outboundReady: boolean;
  aiReady: boolean;
};

function FullPageState({ title, body }: { title: string; body: string }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f6f7fb', color: '#161823', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <section style={{ maxWidth: 600 }}>
        <strong>{title}</strong>
        <p>{body}</p>
      </section>
    </main>
  );
}

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

  if (uiOnly) {
    return <Suspense fallback={<FullPageState title="Chargement de la démo" body="Initialisation de l’interface locale…" />}><DemoApp /></Suspense>;
  }

  if (failed) {
    return (
      <FullPageState
        title="Social Conversion indisponible"
        body="Le runtime n’a pas pu être vérifié. Aucune donnée de démonstration n’est affichée à la place d’un environnement indisponible."
      />
    );
  }

  if (!runtime) {
    return <main aria-busy="true" style={{ minHeight: '100vh', background: '#f6f7fb' }} />;
  }

  if (runtime.mode === 'live' && !runtime.ready) {
    return (
      <FullPageState
        title="Environnement live verrouillé"
        body="Les connecteurs sociaux et les sources de données production ne sont pas encore validés. Le mode live reste volontairement inaccessible pour éviter toute simulation présentée comme réelle."
      />
    );
  }

  if (runtime.mode === 'live') {
    return <LiveApp runtime={runtime as LiveRuntimeState} />;
  }

  return (
    <Suspense fallback={<FullPageState title="Chargement de la démo" body="Initialisation de l’interface de démonstration…" />}>
      <DemoApp />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeGate />
  </StrictMode>,
);
