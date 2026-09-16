import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Threads content rendering/date patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes('SC_THREADS_CONTENT_RENDERING_DATES_V1')) {
  // Dates in Inbox and source cards must remain unambiguous across years.
  app = app.replace(
    `return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);`,
    `return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);`,
  );

  // One canonical content-type label. A text Thread must never look like a failed image.
  if (!app.includes('function inboxContentTypeLabel(')) {
    app = replaceOnce(
      app,
      `function InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest, publications, onOpenPublication }: {`,
      `function inboxContentTypeLabel(context?: MessageContext) {\n  const mediaType = (context?.mediaType ?? '').trim().toUpperCase();\n  if (mediaType.includes('CAROUSEL')) return 'Carrousel';\n  if (mediaType.includes('VIDEO')) return 'Vidéo';\n  if (mediaType.includes('IMAGE')) return 'Image';\n  if (context?.previewUrl) return 'Média';\n  return 'Post texte';\n}\n\nfunction InboxPage({ conversations, selected, messages, loading, query, filter, reply, outboundReady, aiReady, accountLabel, onQuery, onFilter, onSelect, onReply, onSend, onSuggest, publications, onOpenPublication }: {`,
      'content type helper',
    );
  }

  // Compact conversation list: explicit text fallback + content type next to the source title.
  app = app.replaceAll(
    `{conversation.latestMessage.context.previewUrl ? <img src={conversation.latestMessage.context.previewUrl} alt="" loading="lazy" /> : <span className="sc20-row-fallback"><PlatformMark platform={conversation.platform} size={11} /></span>}<span><small>Sur</small><b>{contentContextTitle(conversation.latestMessage.context)}</b></span>`,
    `{conversation.latestMessage.context.previewUrl ? <img src={conversation.latestMessage.context.previewUrl} alt="" loading="lazy" /> : conversation.platform === 'threads' ? <span className="sc26-text-fallback sc26-text-fallback-row" aria-label="Post texte"><b>Aa</b></span> : <span className="sc20-row-fallback"><PlatformMark platform={conversation.platform} size={11} /></span>}<span><small>Sur</small><b>{contentContextTitle(conversation.latestMessage.context)}</b><em className="sc26-source-kind">{inboxContentTypeLabel(conversation.latestMessage.context)}</em></span>`,
  );

  // Detailed source card: media gets its real preview; text-only Threads get a deliberate typographic card.
  app = app.replaceAll(
    `{message.context.previewUrl ? <img src={message.context.previewUrl} alt="" loading="lazy" /> : <span><PlatformMark platform={selected.platform} size={20} /></span>}`,
    `{message.context.previewUrl ? <img src={message.context.previewUrl} alt="" loading="lazy" /> : selected.platform === 'threads' ? <span className="sc26-text-fallback sc26-text-fallback-card"><b>Aa</b><small>Texte</small></span> : <span><PlatformMark platform={selected.platform} size={20} /></span>}`,
  );

  app = app.replaceAll(
    "<em>{message.context.mediaType ? `${message.context.mediaType.replaceAll('_', ' ')} · ` : ''}Publié{message.context.publishedAt ? ` · ${formatShortDate(message.context.publishedAt)}` : ''}</em>",
    "<em>{inboxContentTypeLabel(message.context)} · Publié{message.context.publishedAt ? ` · ${formatShortDate(message.context.publishedAt)}` : ''}</em>",
  );

  app += '\n/* SC_THREADS_CONTENT_RENDERING_DATES_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const cssPath = 'src/social-core.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('SC_THREADS_CONTENT_RENDERING_DATES_CSS_V1')) {
  css += `\n\n/* SC_THREADS_CONTENT_RENDERING_DATES_CSS_V1 */\n.sc26-text-fallback{display:grid!important;place-items:center;background:linear-gradient(145deg,#f5f2ff,#eeebf8);color:#4c3d84;border:1px solid #e1d9ff;overflow:hidden}.sc26-text-fallback b{font-family:Georgia,serif;font-weight:700;letter-spacing:-.06em}.sc26-text-fallback-row{width:32px;height:32px;border-radius:8px}.sc26-text-fallback-row b{font-size:13px}.sc26-text-fallback-card{width:100%;height:100%;min-height:72px;border-radius:10px;align-content:center;gap:2px}.sc26-text-fallback-card b{font-size:22px;line-height:1}.sc26-text-fallback-card small{font-size:6px!important;letter-spacing:.08em;text-transform:uppercase;color:#786ca2!important;font-weight:700}.sc26-source-kind{display:block!important;margin-top:1px!important;font-style:normal!important;font-size:6px!important;font-weight:700!important;color:#7767af!important;text-transform:none!important}.sc20-context-visual:has(.sc26-text-fallback-card){background:transparent!important}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log('Threads source cards now distinguish text/media content and Inbox dates include the year.');
