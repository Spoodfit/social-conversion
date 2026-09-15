import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Inbox visual context patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const typesPath = 'src/shared/types.ts';
let types = fs.readFileSync(typesPath, 'utf8');
if (!types.includes('SC_INBOX_VISUAL_CONTEXT_TYPES_V1')) {
  types = replaceOnce(
    types,
    `export interface SocialContentContext {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n}`,
    `export interface SocialContentContext {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n  previewUrl?: string;\n  publishedAt?: string;\n}`,
    'shared context fields',
  );
  types += '\n// SC_INBOX_VISUAL_CONTEXT_TYPES_V1\n';
  fs.writeFileSync(typesPath, types);
}

const providerPath = 'src/worker/provider-inbox-sync.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
if (!provider.includes('SC_INBOX_VISUAL_CONTEXT_PROVIDER_V1')) {
  provider = replaceOnce(
    provider,
    `type InstagramMedia = {\n  id?: unknown;\n  caption?: unknown;\n  media_type?: unknown;\n  permalink?: unknown;\n  timestamp?: unknown;\n};`,
    `type InstagramMedia = {\n  id?: unknown;\n  caption?: unknown;\n  media_type?: unknown;\n  media_url?: unknown;\n  thumbnail_url?: unknown;\n  permalink?: unknown;\n  timestamp?: unknown;\n};`,
    'instagram visual fields',
  );
  provider = replaceOnce(
    provider,
    `  mediaUrl.searchParams.set('fields', 'id,caption,media_type,permalink,timestamp');`,
    `  mediaUrl.searchParams.set('fields', 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp');`,
    'instagram media query',
  );
  provider = replaceOnce(
    provider,
    `      url: stringValue(item.permalink, 2_000) || undefined,\n      mediaType: stringValue(item.media_type, 80) || undefined,`,
    `      url: stringValue(item.permalink, 2_000) || undefined,\n      mediaType: stringValue(item.media_type, 80) || undefined,\n      previewUrl: stringValue(item.thumbnail_url ?? item.media_url, 2_000) || undefined,\n      publishedAt: isoDate(item.timestamp),`,
    'instagram context preview',
  );
  provider = replaceOnce(
    provider,
    `    \`SELECT external_id, body, media_type, external_url\n     FROM planner_remote_posts`,
    `    \`SELECT external_id, body, media_type, external_url, preview_url, event_at\n     FROM planner_remote_posts`,
    'youtube planner visual select',
  );
  provider = replaceOnce(
    provider,
    `.all<{ external_id: string; body: string; media_type: string | null; external_url: string | null }>();`,
    `.all<{ external_id: string; body: string; media_type: string | null; external_url: string | null; preview_url: string | null; event_at: string | null }>();`,
    'youtube planner visual type',
  );
  provider = replaceOnce(
    provider,
    `  await mapInBatches(videos.results, async ({ external_id: videoId, body, media_type: mediaType, external_url: externalUrl }) => {`,
    `  await mapInBatches(videos.results, async ({ external_id: videoId, body, media_type: mediaType, external_url: externalUrl, preview_url: previewUrl, event_at: eventAt }) => {`,
    'youtube visual destructuring',
  );
  provider = replaceOnce(
    provider,
    `      url: externalUrl || \`https://www.youtube.com/watch?v=\${encodeURIComponent(videoId)}\`,\n      mediaType: mediaType || 'VIDEO',`,
    `      url: externalUrl || \`https://www.youtube.com/watch?v=\${encodeURIComponent(videoId)}\`,\n      mediaType: mediaType || 'VIDEO',\n      previewUrl: previewUrl || \`https://i.ytimg.com/vi/\${encodeURIComponent(videoId)}/hqdefault.jpg\`,\n      publishedAt: isoDate(eventAt),`,
    'youtube context preview',
  );
  provider += '\n// SC_INBOX_VISUAL_CONTEXT_PROVIDER_V1\n';
  fs.writeFileSync(providerPath, provider);
}

const persistencePath = 'src/worker/persistence.ts';
let persistence = fs.readFileSync(persistencePath, 'utf8');
if (!persistence.includes('SC_INBOX_VISUAL_CONTEXT_PERSISTENCE_V1')) {
  persistence = replaceOnce(
    persistence,
    `type RemoteContextRow = {\n  body: string;\n  media_type: string | null;\n  external_url: string | null;\n};`,
    `type RemoteContextRow = {\n  body: string;\n  media_type: string | null;\n  external_url: string | null;\n  preview_url: string | null;\n  event_at: string | null;\n};`,
    'remote context row visual fields',
  );
  persistence = replaceOnce(
    persistence,
    `        \`SELECT body, media_type, external_url FROM planner_remote_posts`,
    `        \`SELECT body, media_type, external_url, preview_url, event_at FROM planner_remote_posts`,
    'remote fallback visual select',
  );
  persistence = replaceOnce(
    persistence,
    `    url: safeHttpsUrl(input.url ?? remote?.external_url ?? undefined),\n    mediaType: cleanText(input.mediaType ?? remote?.media_type ?? undefined, 80),`,
    `    url: safeHttpsUrl(input.url ?? remote?.external_url ?? undefined),\n    mediaType: cleanText(input.mediaType ?? remote?.media_type ?? undefined, 80),\n    previewUrl: safeHttpsUrl(input.previewUrl ?? remote?.preview_url ?? undefined),\n    publishedAt: cleanText(input.publishedAt ?? remote?.event_at ?? undefined, 80),`,
    'persist visual context',
  );
  persistence += '\n// SC_INBOX_VISUAL_CONTEXT_PERSISTENCE_V1\n';
  fs.writeFileSync(persistencePath, persistence);
}

const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_INBOX_VISUAL_CONTEXT_LIVE_DATA_V1')) {
  liveData = replaceOnce(
    liveData,
    `  body?: string;\n  url?: string;\n  mediaType?: string;\n};`,
    `  body?: string;\n  url?: string;\n  mediaType?: string;\n  previewUrl?: string;\n  publishedAt?: string;\n};`,
    'api context type visual fields',
  );
  liveData = replaceOnce(
    liveData,
    `      url: stringOrUndefined(parsed.url, 2_000),\n      mediaType: stringOrUndefined(parsed.mediaType, 80),`,
    `      url: stringOrUndefined(parsed.url, 2_000),\n      mediaType: stringOrUndefined(parsed.mediaType, 80),\n      previewUrl: stringOrUndefined(parsed.previewUrl, 2_000),\n      publishedAt: stringOrUndefined(parsed.publishedAt, 80),`,
    'api context parse visual fields',
  );
  liveData += '\n// SC_INBOX_VISUAL_CONTEXT_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

const historyPath = 'src/worker/planner-account-history.ts';
let history = fs.readFileSync(historyPath, 'utf8');
if (!history.includes('SC_INBOX_VISUAL_CONTEXT_HISTORY_V1')) {
  history = replaceOnce(
    history,
    `      externalUrl: row.external_url ?? undefined,\n      previewUrl: row.preview_url ?? undefined,`,
    `      externalUrl: row.external_url ?? undefined,\n      providerExternalId: row.external_id,\n      previewUrl: row.preview_url ?? undefined,`,
    'planner provider external id',
  );
  history += '\n// SC_INBOX_VISUAL_CONTEXT_HISTORY_V1\n';
  fs.writeFileSync(historyPath, history);
}

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_VISUAL_CONTEXT_UI_V1')) {
  app = replaceOnce(
    app,
    `type MessageContext = {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n};`,
    `type MessageContext = {\n  kind: 'publication';\n  externalContentId: string;\n  title?: string;\n  body?: string;\n  url?: string;\n  mediaType?: string;\n  previewUrl?: string;\n  publishedAt?: string;\n};`,
    'frontend message context visual fields',
  );
  app = replaceOnce(
    app,
    `  providerStatus?: 'published' | 'scheduled';\n  previewUrl?: string;`,
    `  providerStatus?: 'published' | 'scheduled';\n  providerExternalId?: string;\n  previewUrl?: string;`,
    'frontend provider external id',
  );
  app = replaceOnce(
    app,
    `              onSuggest={() => void suggestReply()}\n            />`,
    `              onSuggest={() => void suggestReply()}\n              publications={publications}\n              onOpenPublication={(context) => {\n                const publication = publications.find((candidate) => candidate.providerExternalId === context.externalContentId || candidate.targets.some((target) => target.externalId === context.externalContentId) || (context.url && candidate.externalUrl === context.url));\n                if (publication) {\n                  void editPublication(publication);\n                  navigate('planner');\n                  return;\n                }\n                if (context.url) {\n                  window.open(context.url, '_blank', 'noopener,noreferrer');\n                  return;\n                }\n                setToast('Cette publication n’est pas encore disponible dans le Planner.');\n              }}\n            />`,
    'inbox editor callback',
  );
  app = replaceOnce(
    app,
    `function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest }: {`,
    `function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest, publications, onOpenPublication }: {`,
    'inbox component signature',
  );
  app = replaceOnce(
    app,
    `  onSend: (event: FormEvent) => void;\n  onSuggest: () => void;\n}) {`,
    `  onSend: (event: FormEvent) => void;\n  onSuggest: () => void;\n  publications: Publication[];\n  onOpenPublication: (context: MessageContext) => void;\n}) {`,
    'inbox component props',
  );
  app = replaceOnce(
    app,
    `<span><strong>{conversation.contactName}</strong><small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small><em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em>{conversation.latestMessage?.type === 'comment' && conversation.latestMessage.context && <i className="sc19-row-context">Sur · {contentContextTitle(conversation.latestMessage.context)}</i>}</span>`,
    `<span><strong>{conversation.contactName}</strong><small>{conversation.latestMessage?.body || 'Conversation ouverte'}</small><em><PlatformMark platform={conversation.platform} size={12} /> {conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}</em>{conversation.latestMessage?.type === 'comment' && conversation.latestMessage.context && <i className="sc20-row-context">{conversation.latestMessage.context.previewUrl ? <img src={conversation.latestMessage.context.previewUrl} alt="" loading="lazy" /> : <span className="sc20-row-fallback"><PlatformMark platform={conversation.platform} size={11} /></span>}<span><small>Sur</small><b>{contentContextTitle(conversation.latestMessage.context)}</b></span></i>}</span>`,
    'conversation row visual context',
  );
  app = replaceOnce(
    app,
    `{message.type === 'comment' && message.context && <div className="sc19-context-card">\n                    <PlatformMark platform={selected.platform} size={14} />\n                    <span className="sc19-context-copy">\n                      <small className="sc19-context-label"><MessageCircle size={11} /> Commentaire sur {platformLabel(selected.platform)}</small>\n                      <strong>{contentContextTitle(message.context)}</strong>\n                      {excerpt && <span>{excerpt}</span>}\n                    </span>\n                    {message.context.url && <a className="sc19-context-link" href={message.context.url} target="_blank" rel="noreferrer">Voir la publication <Eye size={12} /></a>}\n                  </div>}`,
    `{message.type === 'comment' && message.context && <div className="sc20-context-card">\n                    <button type="button" className="sc20-context-visual" onClick={() => onOpenPublication(message.context!)} aria-label="Ouvrir le contenu dans l’éditeur">\n                      {message.context.previewUrl ? <img src={message.context.previewUrl} alt="" loading="lazy" /> : <span><PlatformMark platform={selected.platform} size={20} /></span>}\n                    </button>\n                    <span className="sc20-context-copy">\n                      <small className="sc20-context-label"><MessageCircle size={11} /> Commentaire sur {platformLabel(selected.platform)} · {selected.accountName || 'Compte connecté'}</small>\n                      <strong>{contentContextTitle(message.context)}</strong>\n                      <em>{message.context.mediaType ? `${message.context.mediaType.replaceAll('_', ' ')} · ` : ''}Publié{message.context.publishedAt ? ` · ${formatShortDate(message.context.publishedAt)}` : ''}</em>\n                      {excerpt && <span>{excerpt}</span>}\n                    </span>\n                    <span className="sc20-context-actions">\n                      <button type="button" onClick={() => onOpenPublication(message.context!)}><Pencil size={12} /> Ouvrir dans l’éditeur</button>\n                      {message.context.url && <a href={message.context.url} target="_blank" rel="noreferrer">Voir la publication <Eye size={12} /></a>}\n                    </span>\n                  </div>}`,
    'rich comment source card',
  );
  app += '\n// SC_INBOX_VISUAL_CONTEXT_UI_V1\n';
  fs.writeFileSync(appPath, app);
}

const cssPath = 'src/social-core.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('SC_INBOX_VISUAL_CONTEXT_CSS_V1')) {
  css += `\n\n/* SC_INBOX_VISUAL_CONTEXT_CSS_V1 */\n.sc20-row-context{margin-top:6px!important;min-height:34px;display:grid!important;grid-template-columns:32px minmax(0,1fr);gap:7px;align-items:center;color:#5d6280!important;font-style:normal!important}.sc20-row-context>img,.sc20-row-fallback{width:32px;height:32px;border-radius:8px;overflow:hidden;background:#f4f2fb;display:grid;place-items:center}.sc20-row-context>img{object-fit:cover}.sc20-row-context>span:last-child{min-width:0;display:grid;gap:1px}.sc20-row-context small{font-size:6px!important;color:#9a9dae!important;text-transform:uppercase;letter-spacing:.04em}.sc20-row-context b{font-size:7px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#5f43b8}.sc20-context-card{width:min(100%,720px);display:grid;grid-template-columns:88px minmax(0,1fr) auto;gap:11px;align-items:stretch;padding:9px;border:1px solid #ddd4fa;border-radius:15px;background:linear-gradient(135deg,#fff 70%,#faf8ff);box-shadow:0 4px 14px rgba(76,50,145,.05)}.sc20-context-visual{width:88px;min-height:76px;padding:0;border:0;border-radius:11px;background:#f3f1f9;overflow:hidden;display:grid;place-items:center;cursor:pointer}.sc20-context-visual img{width:100%;height:100%;min-height:76px;object-fit:cover}.sc20-context-visual>span{display:grid;place-items:center}.sc20-context-copy{min-width:0;display:grid;align-content:center;gap:3px}.sc20-context-copy strong{font-size:10px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sc20-context-copy>span{color:#7d8093;font-size:8px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.sc20-context-copy em{color:#9699a9;font-size:7px;font-style:normal}.sc20-context-label{display:flex;align-items:center;gap:4px;color:#6a4bd3;font-size:7px;font-weight:900}.sc20-context-actions{display:flex;flex-direction:column;justify-content:center;gap:5px}.sc20-context-actions button,.sc20-context-actions a{min-height:28px;padding:0 8px;border:1px solid #dfd7fa;border-radius:8px;background:#fff;color:#6234cf;display:flex;align-items:center;justify-content:center;gap:4px;font-size:7px;font-weight:900;text-decoration:none;white-space:nowrap;cursor:pointer}.sc20-context-actions button{background:#f2efff}.sc20-context-actions a:hover,.sc20-context-actions button:hover{border-color:#bcaaf3}@media(max-width:900px){.sc20-context-card{grid-template-columns:72px minmax(0,1fr)}.sc20-context-visual{width:72px;min-height:68px}.sc20-context-visual img{min-height:68px}.sc20-context-actions{grid-column:1/-1;flex-direction:row;justify-content:flex-start}.sc20-context-actions button,.sc20-context-actions a{flex:0 1 auto}}@media(max-width:560px){.sc20-context-card{grid-template-columns:64px minmax(0,1fr);gap:8px}.sc20-context-visual{width:64px;min-height:64px}.sc20-context-visual img{min-height:64px}.sc20-context-actions{display:grid;grid-template-columns:1fr 1fr}.sc20-context-copy>span{display:none}}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log('Inbox visual publication context applied.');
