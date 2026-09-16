import fs from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Unified AI UX patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

function safeWrite(path, source, marker) {
  if (!source.includes(marker)) source += `\n${marker}\n`;
  fs.writeFileSync(path, source);
}

// 1) Enrich social contacts with profile URLs + avatars when providers expose them.
const typesPath = 'src/shared/types.ts';
let types = fs.readFileSync(typesPath, 'utf8');
if (!types.includes('SC_UNIFIED_PROFILE_CONTEXT_V1')) {
  types = replaceRequired(
    types,
    `  contactName: string;\n  text: string;`,
    `  contactName: string;\n  contactAvatarUrl?: string;\n  contactProfileUrl?: string;\n  text: string;`,
    'normalized contact profile fields',
  );
  safeWrite(typesPath, types, '// SC_UNIFIED_PROFILE_CONTEXT_V1');
}

const providerPath = 'src/worker/provider-inbox-sync.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
if (!provider.includes('SC_UNIFIED_PROFILE_PROVIDER_V1')) {
  provider = replaceRequired(
    provider,
    `        authorChannelId?: { value?: unknown };\n        authorDisplayName?: unknown;\n        textOriginal?: unknown;`,
    `        authorChannelId?: { value?: unknown };\n        authorDisplayName?: unknown;\n        authorProfileImageUrl?: unknown;\n        authorChannelUrl?: unknown;\n        textOriginal?: unknown;`,
    'YouTube profile fields',
  );
  provider = replaceRequired(
    provider,
    `    const authorName = stringValue(snippet?.authorDisplayName, 180);\n    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);`,
    `    const authorName = stringValue(snippet?.authorDisplayName, 180);\n    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);\n    const authorAvatarUrl = stringValue(snippet?.authorProfileImageUrl, 2_000);\n    const authorProfileUrl = stringValue(snippet?.authorChannelUrl, 2_000) || (authorChannelId ? \`https://www.youtube.com/channel/\${encodeURIComponent(authorChannelId)}\` : '');`,
    'YouTube profile extraction',
  );
  provider = replaceRequired(
    provider,
    `      contactName: authorName || 'Utilisateur YouTube',\n      text,`,
    `      contactName: authorName || 'Utilisateur YouTube',\n      contactAvatarUrl: authorAvatarUrl || undefined,\n      contactProfileUrl: authorProfileUrl || undefined,\n      text,`,
    'YouTube profile event',
  );
  provider = replaceRequired(
    provider,
    `      contactName: username ? \`@\${username}\` : \`Contact \${authorId.slice(-4)}\`,\n      text,`,
    `      contactName: username ? \`@\${username}\` : \`Contact \${authorId.slice(-4)}\`,\n      contactProfileUrl: username ? \`https://www.instagram.com/\${encodeURIComponent(username)}/\` : undefined,\n      text,`,
    'Instagram profile event',
  );
  safeWrite(providerPath, provider, '// SC_UNIFIED_PROFILE_PROVIDER_V1');
}

const persistencePath = 'src/worker/persistence.ts';
let persistence = fs.readFileSync(persistencePath, 'utf8');
if (!persistence.includes('SC_UNIFIED_PROFILE_PERSISTENCE_V1')) {
  persistence = replaceRequired(
    persistence,
    `  const contactId = \`\${event.workspaceId}:\${event.platform}:\${event.externalContactId}\`;\n  const conversationId = \`\${event.connectionId}:\${contactId}\`;`,
    `  const contactId = \`\${event.workspaceId}:\${event.platform}:\${event.externalContactId}\`;\n  const conversationId = \`\${event.connectionId}:\${contactId}\`;\n  const contactMetadata = JSON.stringify({\n    ...(safeHttpsUrl(event.contactAvatarUrl) ? { avatarUrl: safeHttpsUrl(event.contactAvatarUrl) } : {}),\n    ...(safeHttpsUrl(event.contactProfileUrl) ? { profileUrl: safeHttpsUrl(event.contactProfileUrl) } : {}),\n  });`,
    'contact metadata payload',
  );
  persistence = replaceRequired(
    persistence,
    `        \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at\`,`,
    `        \`INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, metadata_json, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           display_name = excluded.display_name,\n           metadata_json = json_patch(COALESCE(contacts.metadata_json, '{}'), excluded.metadata_json),\n           updated_at = excluded.updated_at\`,`,
    'contact metadata insert',
  );
  persistence = replaceRequired(
    persistence,
    `        event.platform,\n        event.contactName,\n        event.occurredAt,`,
    `        event.platform,\n        event.contactName,\n        contactMetadata,\n        event.occurredAt,`,
    'contact metadata binding',
  );
  safeWrite(persistencePath, persistence, '// SC_UNIFIED_PROFILE_PERSISTENCE_V1');
}

const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_UNIFIED_PROFILE_API_V1')) {
  const profileStart = liveData.indexOf('function contactAvatarUrl(raw: string): string | undefined {');
  const profileEnd = liveData.indexOf('\n\nexport async function listInboxConversations(', profileStart);
  if (profileStart < 0 || profileEnd < 0) throw new Error('Unified AI UX patch failed: Inbox avatar parser not found.');
  liveData = liveData.slice(0, profileStart) + `function contactProfileMetadata(raw: string): { avatarUrl?: string; profileUrl?: string } {\n  try {\n    const parsed = JSON.parse(raw) as { avatarUrl?: unknown; profileUrl?: unknown };\n    const result: { avatarUrl?: string; profileUrl?: string } = {};\n    for (const [key, value] of [['avatarUrl', parsed.avatarUrl], ['profileUrl', parsed.profileUrl]] as const) {\n      if (typeof value !== 'string') continue;\n      try {\n        const url = new URL(value);\n        if (url.protocol === 'https:') result[key] = url.toString();\n      } catch {\n        // Ignore malformed provider metadata.\n      }\n    }\n    return result;\n  } catch {\n    return {};\n  }\n}` + liveData.slice(profileEnd);
  liveData = replaceRequired(
    liveData,
    `      avatarUrl: contactAvatarUrl(row.contact_metadata_json),\n      handle: row.handle ?? undefined,`,
    `      ...contactProfileMetadata(row.contact_metadata_json),\n      handle: row.handle ?? undefined,`,
    'Inbox profile response',
  );
  safeWrite(liveDataPath, liveData, '// SC_UNIFIED_PROFILE_API_V1');
}

// 2) Inbox: explicit contextual-AI loading state + richer selected-contact header.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_UNIFIED_AI_INBOX_UX_V1')) {
  app = replaceRequired(
    app,
    `  avatarUrl?: string;\n  handle?: string;`,
    `  avatarUrl?: string;\n  profileUrl?: string;\n  handle?: string;`,
    'Inbox profile URL type',
  );
  app = replaceRequired(
    app,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);`,
    `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [aiReplyBusy, setAiReplyBusy] = useState(false);`,
    'AI reply busy state',
  );

  const suggestStart = app.indexOf('  async function suggestReply() {');
  const suggestEnd = app.indexOf('\n\n  function openCreate(', suggestStart);
  if (suggestStart < 0 || suggestEnd < 0) throw new Error('Unified AI UX patch failed: suggestReply function not found.');
  app = app.slice(0, suggestStart) + `  async function suggestReply() {\n    if (!workspaceId || !selectedConversation || aiReplyBusy) return;\n    if (!runtime.aiReady) {\n      setToast('Le copilote IA n’est pas encore configuré.');\n      return;\n    }\n    setAiReplyBusy(true);\n    try {\n      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {\n        method: 'POST',\n        body: JSON.stringify({ conversationId: selectedConversation.id }),\n      }, workspaceId);\n      setReply(result.draft.body);\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setAiReplyBusy(false);\n    }\n  }` + app.slice(suggestEnd);

  app = replaceRequired(
    app,
    `              aiReady={runtime.aiReady}\n              accountLabel=`,
    `              aiReady={runtime.aiReady}\n              aiBusy={aiReplyBusy}\n              accountLabel=`,
    'AI busy Inbox prop',
  );

  const triageSignature = `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`;
  const baseSignature = `function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {`;
  if (app.includes(triageSignature)) {
    app = app.replace(triageSignature, triageSignature.replace('aiReady, accountLabel', 'aiReady, aiBusy, accountLabel'));
  } else if (app.includes(baseSignature)) {
    app = app.replace(baseSignature, baseSignature.replace('aiReady, accountLabel', 'aiReady, aiBusy, accountLabel'));
  } else {
    const olderSignature = `function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest }: {`;
    if (!app.includes(olderSignature)) throw new Error('Unified AI UX patch failed: Inbox component signature not found.');
    app = app.replace(olderSignature, olderSignature.replace('aiReady, accountLabel', 'aiReady, aiBusy, accountLabel'));
  }
  app = replaceRequired(
    app,
    `  aiReady: boolean;\n  accountLabel: string;`,
    `  aiReady: boolean;\n  aiBusy: boolean;\n  accountLabel: string;`,
    'Inbox AI busy type',
  );

  const oldSuggest = `{aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}`;
  const newSuggest = `{aiReady && <button type="button" className={\`sc26-ai-suggest\${aiBusy ? ' busy' : ''}\`} onClick={onSuggest} disabled={aiBusy}>{aiBusy ? <><LoaderCircle className="sc3-spin" size={15} /> Rédaction en cours…</> : <><Sparkles size={15} /> Proposer une réponse</>}</button>}`;
  app = replaceRequired(app, oldSuggest, newSuggest, 'Inbox AI loading button');

  const oldHeader = `<header><div><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><b>{selected.leadStage}</b></header>`;
  const newHeader = `<header className="sc26-contact-header"><div className="sc26-contact-identity"><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || 'Profil social'}</small><em><PlatformMark platform={selected.platform} size={11} /> {platformLabel(selected.platform)} · via {selected.accountName || accountLabel}</em></span></div><div className="sc26-contact-actions">{selected.profileUrl && <a className="sc26-profile-link" href={selected.profileUrl} target="_blank" rel="noreferrer"><Eye size={13} /> Voir le profil</a>}<b>{selected.leadStage}</b></div></header>`;
  app = replaceRequired(app, oldHeader, newHeader, 'selected contact profile header');
  safeWrite(appPath, app, '/* SC_UNIFIED_AI_INBOX_UX_V1 */');
}

// 3) Use the same free Workers AI engine for publication copy generation.
const copyPath = 'src/worker/social-copy-writer.ts';
let copy = fs.readFileSync(copyPath, 'utf8');
if (!copy.includes('SC_UNIFIED_SOCIAL_COPY_AI_V1')) {
  copy = copy.replace(
    'const EDITORIAL_KEYS: Record<PlanningPlatform, Set<string>> = {',
    'const EDITORIAL_KEYS: Partial<Record<PlanningPlatform, Set<string>>> = {',
  );
  copy = replaceRequired(
    copy,
    `  const editorialKeys = EDITORIAL_KEYS[platform];\n  const writable = definition.fields`,
    `  const editorialKeys = EDITORIAL_KEYS[platform] ?? new Set(\n    definition.fields\n      .filter((field) => field.kind === 'text' || field.kind === 'textarea' || field.kind === 'tags')\n      .map((field) => field.key)\n      .filter((key) => !['altText', 'note', 'location'].includes(key)),\n  );\n  const writable = definition.fields`,
    'generic editorial fields',
  );

  const helperAnchor = `function modelName(env: Env): string {\n  const copyModel = Reflect.get(env, 'OPENAI_COPY_MODEL');\n  if (typeof copyModel === 'string' && copyModel.trim()) return copyModel.trim();\n  const configured = Reflect.get(env, 'OPENAI_MODEL');\n  return typeof configured === 'string' && configured.trim() ? configured.trim() : 'gpt-5.6';\n}`;
  const helperReplacement = `${helperAnchor}\n\ntype WorkersAiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };\n\nfunction workersAiBinding(env: Env): WorkersAiBinding | undefined {\n  const binding = Reflect.get(env, 'AI');\n  if (!binding || typeof binding !== 'object' || typeof Reflect.get(binding, 'run') !== 'function') return undefined;\n  return binding as WorkersAiBinding;\n}\n\nfunction workersAiModelName(env: Env): string {\n  const configured = Reflect.get(env, 'WORKERS_AI_MODEL');\n  return typeof configured === 'string' && configured.trim() ? configured.trim() : '@cf/meta/llama-3.1-8b-instruct-fast';\n}\n\nfunction workersAiOutputText(payload: unknown): string {\n  if (typeof payload === 'string') return payload.trim();\n  if (!payload || typeof payload !== 'object') return '';\n  const candidate = payload as { response?: unknown; text?: unknown; result?: unknown };\n  if (typeof candidate.response === 'string') return candidate.response.trim();\n  if (typeof candidate.text === 'string') return candidate.text.trim();\n  if (candidate.result && typeof candidate.result === 'object') {\n    const nested = candidate.result as { response?: unknown; text?: unknown };\n    if (typeof nested.response === 'string') return nested.response.trim();\n    if (typeof nested.text === 'string') return nested.text.trim();\n  }\n  return '';\n}\n\nfunction extractJsonObject(value: string): string {\n  const cleaned = value.trim().replace(/^\\s*\\`\\`\\`(?:json)?/i, '').replace(/\\`\\`\\`\\s*$/i, '').trim();\n  const start = cleaned.indexOf('{');\n  const end = cleaned.lastIndexOf('}');\n  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;\n}`;
  copy = replaceRequired(copy, helperAnchor, helperReplacement, 'Workers AI copy helpers');

  copy = replaceRequired(
    copy,
    `  const apiKey = optionalSecret(env, 'OPENAI_API_KEY');\n  if (!apiKey) throw new SocialCopyError('AI_NOT_READY', 'OpenAI API key is not configured.');\n  const request = normalizeRequest(input);`,
    `  const workersAi = workersAiBinding(env);\n  const apiKey = optionalSecret(env, 'OPENAI_API_KEY');\n  if (!workersAi && !apiKey) throw new SocialCopyError('AI_NOT_READY', 'Aucun moteur IA n’est disponible.');\n  const request = normalizeRequest(input);`,
    'social copy AI readiness',
  );

  const providerStart = copy.indexOf('  const controller = new AbortController();');
  const providerEnd = copy.indexOf('\n\n  let parsed: { fields?: Record<string, unknown> };', providerStart);
  if (providerStart < 0 || providerEnd < 0) throw new Error('Unified AI UX patch failed: social copy provider block not found.');
  const providerReplacement = `  let model: string;\n  let text: string;\n  if (workersAi) {\n    model = workersAiModelName(env);\n    const contract = request.writable.map((field) => field.kind === 'tags' ? \`\\"\${field.key}\\": [\\"mot-clé\\"]\` : \`\\"\${field.key}\\": \\"texte\\"\`).join(', ');\n    const prompt = [\n      'Tu es un rédacteur social media senior. Tu prépares uniquement un brouillon modifiable.',\n      'Respecte strictement les contraintes et le ton natif de la plateforme.',\n      'Ne crée jamais de faits, chiffres, prix, preuves, promotions ou promesses absents du contexte.',\n      context,\n      \`Réponds uniquement en JSON valide, sans markdown, sous la forme {\\"fields\\": {\${contract}}}.\`,\n    ].join('\\n');\n    try {\n      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('workers_ai_timeout')), 18_000));\n      const payload = await Promise.race([\n        workersAi.run(model, { messages: [{ role: 'user', content: prompt }], max_tokens: 900, temperature: 0.45 }),\n        timeout,\n      ]);\n      text = workersAiOutputText(payload);\n    } catch (error) {\n      console.warn(JSON.stringify({ event: 'social_copy_workers_ai_failed', reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown', platform: request.platform, format: request.format }));\n      throw new SocialCopyError('AI_PROVIDER_FAILED', 'L’assistant de rédaction est temporairement indisponible.');\n    }\n  } else {\n    model = modelName(env);\n    const controller = new AbortController();\n    const timeout = setTimeout(() => controller.abort(), 18_000);\n    let response: Response;\n    try {\n      response = await fetchImpl('https://api.openai.com/v1/responses', {\n        method: 'POST',\n        headers: { authorization: \`Bearer \${apiKey}\`, 'content-type': 'application/json' },\n        body: JSON.stringify({\n          model,\n          reasoning: { effort: 'low' },\n          instructions: 'Tu es un rédacteur social media senior. Tu aides à préparer un brouillon modifiable, jamais à publier automatiquement. Retourne uniquement la structure demandée.',\n          input: context,\n          text: { format: { type: 'json_schema', name: 'social_copy_fields', strict: true, schema } },\n        }),\n        signal: controller.signal,\n      });\n    } catch (error) {\n      const reason = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network';\n      console.warn(JSON.stringify({ event: 'social_copy_provider_failed', reason, platform: request.platform, format: request.format }));\n      throw new SocialCopyError('AI_PROVIDER_FAILED', 'L’assistant de rédaction est temporairement indisponible.');\n    } finally {\n      clearTimeout(timeout);\n    }\n    if (!response.ok) {\n      console.warn(JSON.stringify({ event: 'social_copy_provider_failed', status: response.status, platform: request.platform, format: request.format }));\n      throw new SocialCopyError('AI_PROVIDER_FAILED', 'Le moteur IA a refusé la requête.');\n    }\n    let payload: unknown;\n    try { payload = await response.json(); } catch { throw new SocialCopyError('AI_PROVIDER_FAILED', 'Le moteur IA a retourné une réponse invalide.'); }\n    text = outputText(payload);\n  }\n  if (!text) throw new SocialCopyError('AI_EMPTY_RESPONSE', 'L’assistant de rédaction n’a pas retourné de texte exploitable.');`;
  copy = copy.slice(0, providerStart) + providerReplacement + copy.slice(providerEnd);
  copy = copy.replace('    parsed = JSON.parse(text) as { fields?: Record<string, unknown> };', '    parsed = JSON.parse(extractJsonObject(text)) as { fields?: Record<string, unknown> };');
  copy = copy.replace('    model: modelName(env),', '    model,');
  safeWrite(copyPath, copy, '// SC_UNIFIED_SOCIAL_COPY_AI_V1');
}

// 4) Give the publication-writing assistant a visible spinner too.
const composerPath = 'src/NativePlatformComposer.tsx';
let composer = fs.readFileSync(composerPath, 'utf8');
if (!composer.includes('SC_UNIFIED_COMPOSER_AI_LOADING_V1')) {
  composer = replaceRequired(composer, `  Link2,\n  MapPin,`, `  Link2,\n  LoaderCircle,\n  MapPin,`, 'composer LoaderCircle import');
  composer = replaceRequired(
    composer,
    `<button type="button" className="generate" disabled={!ready || busy} onClick={onGenerate}><Sparkles size={13} /> {busy ? 'Rédaction…' : 'Générer'}</button>`,
    `<button type="button" className={\`generate\${busy ? ' busy' : ''}\`} disabled={!ready || busy} onClick={onGenerate}>{busy ? <><LoaderCircle className="sc3-spin" size={13} /> Rédaction en cours…</> : <><Sparkles size={13} /> Générer</>}</button>`,
    'composer AI loading button',
  );
  safeWrite(composerPath, composer, '// SC_UNIFIED_COMPOSER_AI_LOADING_V1');
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./ai-ux-unification.css")) {
  main += "\nimport './ai-ux-unification.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Unified AI writing UX applied: richer profiles, explicit loading, free publication copy assistant.');
