import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes('SC_STARTUP_PERFORMANCE_V1')) {
  app = app.replace(
    `  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>();\n  const [workspaceId, setWorkspaceId] = useState<string>();\n  const [session, setSession] = useState<SessionPayload>();\n  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();\n  const [inbox, setInbox] = useState<InboxPayload>();`,
    `  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);\n  const [workspaceId, setWorkspaceId] = useState<string>(() => window.localStorage.getItem('social-conversion.workspace') || undefined);\n  const [session, setSession] = useState<SessionPayload>();\n  const [bootstrap, setBootstrap] = useState<LiveBootstrap>();\n  const [inbox, setInbox] = useState<InboxPayload>(() => ({ conversations: [], page: { limit: 50, hasMore: false } }));`,
  );

  const workspaceEffectStart = `  useEffect(() => {\n    let active = true;\n    apiRequest<{ workspaces: WorkspaceSummary[] }>('/api/workspaces')`;
  const workspaceEffectEnd = `  }, []);\n\n  useEffect(() => {\n    if (!toast) return undefined;`;
  const wsStart = app.indexOf(workspaceEffectStart);
  const wsEnd = wsStart >= 0 ? app.indexOf(workspaceEffectEnd, wsStart) : -1;
  if (wsStart < 0 || wsEnd < 0) throw new Error('Startup performance patch: workspace bootstrap anchor not found.');
  const workspaceEffect = `  useEffect(() => {\n    let active = true;\n    const persisted = window.localStorage.getItem('social-conversion.workspace');\n    apiRequest<{ workspaces: WorkspaceSummary[] }>('/api/workspaces')\n      .then(({ workspaces: available }) => {\n        if (!active) return;\n        setWorkspaces(available);\n        const found = persisted ? available.find((workspace) => workspace.id === persisted) : undefined;\n        if (!persisted || !found) setWorkspaceId(found?.id ?? available[0]?.id);\n      })\n      .catch((error) => {\n        if (!active) return;\n        if (!persisted) setDataError(readableError(error));\n        else setToast('La liste des espaces sera actualisée en arrière-plan.');\n      });\n    return () => { active = false; };\n  }, []);\n\n  useEffect(() => {\n    if (!toast) return undefined;`;
  app = app.slice(0, wsStart) + workspaceEffect + app.slice(wsEnd + `  }, []);\n\n  useEffect(() => {\n    if (!toast) return undefined;`.length);

  const criticalStart = `  useEffect(() => {\n    if (!workspaceId) return undefined;\n    let active = true;\n    setDataError(undefined);\n    window.localStorage.setItem('social-conversion.workspace', workspaceId);\n    Promise.all([`;
  const publicationsEffect = `  useEffect(() => {\n    if (!workspaceId || !runtime.publishingSchedulerReady) return undefined;`;
  const criticalIndex = app.indexOf(criticalStart);
  const criticalEnd = criticalIndex >= 0 ? app.indexOf(publicationsEffect, criticalIndex) : -1;
  if (criticalIndex < 0 || criticalEnd < 0) throw new Error('Startup performance patch: critical hydration anchor not found.');

  const criticalEffect = `  useEffect(() => {\n    if (!workspaceId) return undefined;\n    let active = true;\n    setDataError(undefined);\n    setBootstrap(undefined);\n    setInbox({ conversations: [], page: { limit: 50, hasMore: false } });\n    window.localStorage.setItem('social-conversion.workspace', workspaceId);\n\n    const bootstrapRequest = apiRequest<LiveBootstrap>('/api/bootstrap', {}, workspaceId)\n      .then((nextBootstrap) => {\n        if (!active) return undefined;\n        setBootstrap(nextBootstrap);\n        setSession((current) => current?.workspace.id === workspaceId ? current : {\n          subject: '',\n          workspace: nextBootstrap.workspace,\n        });\n        const connected = nextBootstrap.connections.filter((connection) => connection.status === 'connected');\n        setSelectedConnectionIds((current) => {\n          const valid = current.filter((id) => connected.some((connection) => connection.id === id));\n          return valid.length ? valid : connected[0] ? [connected[0].id] : [];\n        });\n        if (activeAccountId !== 'all' && !connected.some((connection) => connection.id === activeAccountId)) {\n          setActiveAccountId('all');\n        }\n        return nextBootstrap;\n      })\n      .catch((error) => {\n        if (active) setDataError(readableError(error));\n        return undefined;\n      });\n\n    void apiRequest<SessionPayload>('/api/session', {}, workspaceId)\n      .then((nextSession) => { if (active) setSession(nextSession); })\n      .catch((error) => { if (active) setToast(readableError(error)); });\n\n    void bootstrapRequest.then((loaded) => {\n      if (!active || !loaded) return;\n      window.setTimeout(() => {\n        if (!active) return;\n        void apiRequest<InboxPayload>('/api/inbox/conversations?limit=50', {}, workspaceId)\n          .then((nextInbox) => { if (active) setInbox(nextInbox); })\n          .catch((error) => { if (active) setToast(readableError(error)); });\n      }, 0);\n    });\n\n    return () => { active = false; };\n  }, [workspaceId, refreshIndex]);\n\n`;
  app = app.slice(0, criticalIndex) + criticalEffect + app.slice(criticalEnd);

  app = app.replace(
    `  if (!workspaces || !workspaceId || !session || !bootstrap || !inbox) {\n    return <Gate title=\"Ouverture de Social Conversion\" body=\"Chargement de votre espace…\" loading />;\n  }`,
    `  if (!workspaceId || !session || !bootstrap) {\n    return <Gate title=\"Ouverture de Social Conversion\" body=\"Chargement de votre espace…\" loading />;\n  }`,
  );

  app = app.replace(
    `function Gate({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {\n  return (\n    <main className=\"sc3-gate\">\n      <section>\n        {loading ? <LoaderCircle className=\"sc3-spin\" size={24} /> : <AlertTriangle size={24} />}\n        <h1>{title}</h1>\n        <p>{body}</p>\n      </section>\n    </main>\n  );\n}`,
    `function Gate({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {\n  if (loading) {\n    return (\n      <main className=\"sc25-startup-shell\" aria-busy=\"true\" aria-label={title}>\n        <aside><div className=\"sc25-brand-skeleton\" /><div className=\"sc25-nav-skeleton\" /><div className=\"sc25-nav-skeleton short\" /><div className=\"sc25-nav-skeleton\" /></aside>\n        <section><header><div><span className=\"sc25-line w1\" /><span className=\"sc25-line w2\" /></div><span className=\"sc25-pill\" /></header><div className=\"sc25-toolbar\"><span /><span /><span /></div><div className=\"sc25-planner-grid\">{Array.from({ length: 15 }, (_, index) => <i key={index} />)}</div><p>{body}</p></section>\n      </main>\n    );\n  }\n  return (\n    <main className=\"sc3-gate\">\n      <section>\n        <AlertTriangle size={24} />\n        <h1>{title}</h1>\n        <p>{body}</p>\n      </section>\n    </main>\n  );\n}`,
  );

  app += '\n// SC_STARTUP_PERFORMANCE_V1\n';
  fs.writeFileSync(appPath, app);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./startup-performance.css")) {
  main += "\nimport './startup-performance.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Startup critical path and progressive hydration optimized.');
