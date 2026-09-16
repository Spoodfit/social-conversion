import fs from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`AI UX profile v2 failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

function markAndWrite(path, source, marker) {
  if (!source.includes(marker)) source += `\n${marker}\n`;
  fs.writeFileSync(path, source);
}

// Social event profile metadata.
const typesPath = 'src/shared/types.ts';
let types = fs.readFileSync(typesPath, 'utf8');
if (!types.includes('SC_PROFILE_METADATA_V2')) {
  types = replaceRequired(
    types,
    '  contactName: string;\n  text: string;',
    '  contactName: string;\n  contactAvatarUrl?: string;\n  contactProfileUrl?: string;\n  text: string;',
    'normalized profile fields',
  );
  markAndWrite(typesPath, types, '// SC_PROFILE_METADATA_V2');
}

// Provider-level enrichment. YouTube exposes both avatar and channel URL.
const providerPath = 'src/worker/provider-inbox-sync.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
if (!provider.includes('SC_PROFILE_PROVIDER_V2')) {
  provider = replaceRequired(
    provider,
    '        authorChannelId?: { value?: unknown };\n        authorDisplayName?: unknown;\n        textOriginal?: unknown;',
    '        authorChannelId?: { value?: unknown };\n        authorDisplayName?: unknown;\n        authorProfileImageUrl?: unknown;\n        authorChannelUrl?: unknown;\n        textOriginal?: unknown;',
    'YouTube snippet profile fields',
  );
  provider = replaceRequired(
    provider,
    '    const authorName = stringValue(snippet?.authorDisplayName, 180);\n    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);',
    [
      '    const authorName = stringValue(snippet?.authorDisplayName, 180);',
      '    const authorChannelId = stringValue(snippet?.authorChannelId?.value, 200);',
      '    const authorAvatarUrl = stringValue(snippet?.authorProfileImageUrl, 2_000);',
      "    const authorProfileUrl = stringValue(snippet?.authorChannelUrl, 2_000) || (authorChannelId ? `https://www.youtube.com/channel/${encodeURIComponent(authorChannelId)}` : '');",
    ].join('\n'),
    'YouTube profile extraction',
  );
  provider = replaceRequired(
    provider,
    "      contactName: authorName || 'Utilisateur YouTube',\n      text,",
    "      contactName: authorName || 'Utilisateur YouTube',\n      contactAvatarUrl: authorAvatarUrl || undefined,\n      contactProfileUrl: authorProfileUrl || undefined,\n      text,",
    'YouTube profile event',
  );
  provider = replaceRequired(
    provider,
    "      contactName: username ? `@${username}` : `Contact ${authorId.slice(-4)}`,\n      text,",
    "      contactName: username ? `@${username}` : `Contact ${authorId.slice(-4)}`,\n      contactProfileUrl: username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : undefined,\n      text,",
    'Instagram profile URL',
  );
  markAndWrite(providerPath, provider, '// SC_PROFILE_PROVIDER_V2');
}

// Persist provider profile metadata without erasing data already captured by Facebook/Threads.
const persistencePath = 'src/worker/persistence.ts';
let persistence = fs.readFileSync(persistencePath, 'utf8');
if (!persistence.includes('SC_PROFILE_PERSISTENCE_V2')) {
  persistence = replaceRequired(
    persistence,
    '  const contactId = `${event.workspaceId}:${event.platform}:${event.externalContactId}`;\n  const conversationId = `${event.connectionId}:${contactId}`;',
    [
      '  const contactId = `${event.workspaceId}:${event.platform}:${event.externalContactId}`;',
      '  const conversationId = `${event.connectionId}:${contactId}`;',
      '  const avatarUrl = safeHttpsUrl(event.contactAvatarUrl);',
      '  const profileUrl = safeHttpsUrl(event.contactProfileUrl);',
      '  const contactMetadata = JSON.stringify({',
      '    ...(avatarUrl ? { avatarUrl } : {}),',
      '    ...(profileUrl ? { profileUrl } : {}),',
      '  });',
    ].join('\n'),
    'profile metadata payload',
  );
  persistence = replaceRequired(
    persistence,
    '        `INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,',
    '        `INSERT INTO contacts (id, workspace_id, external_id, platform, display_name, metadata_json, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           display_name = excluded.display_name,\n           metadata_json = json_patch(COALESCE(contacts.metadata_json, \'{}\'), excluded.metadata_json),\n           updated_at = excluded.updated_at`,',
    'profile metadata insert',
  );
  persistence = replaceRequired(
    persistence,
    '        event.platform,\n        event.contactName,\n        event.occurredAt,',
    '        event.platform,\n        event.contactName,\n        contactMetadata,\n        event.occurredAt,',
    'profile metadata binding',
  );
  markAndWrite(persistencePath, persistence, '// SC_PROFILE_PERSISTENCE_V2');
}

// Expose both avatar and provider profile URL in Inbox API.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_PROFILE_API_V2')) {
  const start = liveData.indexOf('function contactAvatarUrl(raw: string): string | undefined {');
  const end = liveData.indexOf('\n\nexport async function listInboxConversations(', start);
  if (start < 0 || end < 0) throw new Error('AI UX profile v2 failed: contact metadata parser not found.');
  const parser = [
    'function contactProfileMetadata(raw: string): { avatarUrl?: string; profileUrl?: string } {',
    '  try {',
    '    const parsed = JSON.parse(raw) as { avatarUrl?: unknown; profileUrl?: unknown };',
    '    const result: { avatarUrl?: string; profileUrl?: string } = {};',
    "    for (const [key, value] of [['avatarUrl', parsed.avatarUrl], ['profileUrl', parsed.profileUrl]] as const) {",
    "      if (typeof value !== 'string') continue;",
    '      try {',
    '        const url = new URL(value);',
    "        if (url.protocol === 'https:') result[key] = url.toString();",
    '      } catch {',
    '        // Ignore malformed provider metadata.',
    '      }',
    '    }',
    '    return result;',
    '  } catch {',
    '    return {};',
    '  }',
    '}',
  ].join('\n');
  liveData = liveData.slice(0, start) + parser + liveData.slice(end);
  liveData = replaceRequired(
    liveData,
    '      avatarUrl: contactAvatarUrl(row.contact_metadata_json),\n      handle: row.handle ?? undefined,',
    '      ...contactProfileMetadata(row.contact_metadata_json),\n      handle: row.handle ?? undefined,',
    'profile metadata response',
  );
  markAndWrite(liveDataPath, liveData, '// SC_PROFILE_API_V2');
}

// Inbox UI: richer identity and an explicit busy state for AI suggestion.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_AI_UX_V2')) {
  app = replaceRequired(app, '  avatarUrl?: string;\n  handle?: string;', '  avatarUrl?: string;\n  profileUrl?: string;\n  handle?: string;', 'profileUrl UI type');
  app = replaceRequired(
    app,
    "  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);",
    "  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [aiReplyBusy, setAiReplyBusy] = useState(false);",
    'AI reply busy state',
  );

  const suggestStart = app.indexOf('  async function suggestReply() {');
  const suggestEnd = app.indexOf('\n\n  function openCreate(', suggestStart);
  if (suggestStart < 0 || suggestEnd < 0) throw new Error('AI UX profile v2 failed: suggestReply not found.');
  const suggest = [
    '  async function suggestReply() {',
    '    if (!workspaceId || !selectedConversation || aiReplyBusy) return;',
    '    if (!runtime.aiReady) {',
    "      setToast('Le copilote IA n’est pas encore configuré.');",
    '      return;',
    '    }',
    '    setAiReplyBusy(true);',
    '    try {',
    "      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {",
    "        method: 'POST',",
    '        body: JSON.stringify({ conversationId: selectedConversation.id }),',
    '      }, workspaceId);',
    '      setReply(result.draft.body);',
    '    } catch (error) {',
    '      setToast(readableError(error));',
    '    } finally {',
    '      setAiReplyBusy(false);',
    '    }',
    '  }',
  ].join('\n');
  app = app.slice(0, suggestStart) + suggest + app.slice(suggestEnd);

  app = replaceRequired(app, '              aiReady={runtime.aiReady}\n              accountLabel=', '              aiReady={runtime.aiReady}\n              aiBusy={aiReplyBusy}\n              accountLabel=', 'aiBusy Inbox prop');

  const signatureCandidates = [
    'function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {',
    'function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest, onOpenPublication }: {',
    'function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest }: {',
  ];
  const signature = signatureCandidates.find((candidate) => app.includes(candidate));
  if (!signature) throw new Error('AI UX profile v2 failed: Inbox signature not found.');
  app = app.replace(signature, signature.replace('aiReady, accountLabel', 'aiReady, aiBusy, accountLabel'));
  app = replaceRequired(app, '  aiReady: boolean;\n  accountLabel: string;', '  aiReady: boolean;\n  aiBusy: boolean;\n  accountLabel: string;', 'Inbox aiBusy type');

  app = replaceRequired(
    app,
    '{aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}',
    "{aiReady && <button type=\"button\" className={`sc26-ai-suggest${aiBusy ? ' busy' : ''}`} onClick={onSuggest} disabled={aiBusy}>{aiBusy ? <><LoaderCircle className=\"sc3-spin\" size={15} /> Rédaction en cours…</> : <><Sparkles size={15} /> Proposer une réponse</>}</button>}",
    'AI suggestion busy button',
  );

  app = replaceRequired(
    app,
    '<header><div><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><b>{selected.leadStage}</b></header>',
    '<header className="sc26-contact-header"><div className="sc26-contact-identity"><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || \'Profil social\'}</small><em><PlatformMark platform={selected.platform} size={11} /> {platformLabel(selected.platform)} · via {selected.accountName || accountLabel}</em></span></div><div className="sc26-contact-actions">{selected.profileUrl && <a className="sc26-profile-link" href={selected.profileUrl} target="_blank" rel="noreferrer"><Eye size={13} /> Voir le profil</a>}<b>{selected.leadStage}</b></div></header>',
    'rich contact header',
  );
  markAndWrite(appPath, app, '/* SC_INBOX_AI_UX_V2 */');
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./ai-ux-unification.css")) {
  main += "\nimport './ai-ux-unification.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Inbox profile enrichment and AI loading UX v2 applied.');
