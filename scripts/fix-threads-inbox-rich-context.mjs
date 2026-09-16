import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Threads rich inbox patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Expose Threads interaction kind in the existing publication-context contract so the UI
// can distinguish a reply from a mention without inventing a separate message model.
const liveDataPath = 'src/worker/live-data.ts';
let liveData = fs.readFileSync(liveDataPath, 'utf8');
if (!liveData.includes('SC_THREADS_RICH_CONTEXT_LIVE_DATA_V1')) {
  liveData = replaceOnce(
    liveData,
    `  publishedAt?: string;\n};`,
    `  publishedAt?: string;\n  interactionType?: 'reply' | 'mention';\n  parentBody?: string;\n};`,
    'API context type',
  );
  liveData = replaceOnce(
    liveData,
    `      publishedAt: stringOrUndefined(parsed.publishedAt, 80),`,
    `      publishedAt: stringOrUndefined(parsed.publishedAt, 80),\n      interactionType: parsed.interactionType === 'reply' || parsed.interactionType === 'mention' ? parsed.interactionType : undefined,\n      parentBody: stringOrUndefined(parsed.parentBody, 1_200),`,
    'API context parser',
  );
  liveData += '\n// SC_THREADS_RICH_CONTEXT_LIVE_DATA_V1\n';
  fs.writeFileSync(liveDataPath, liveData);
}

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_THREADS_RICH_CONTEXT_UI_V1')) {
  app = replaceOnce(
    app,
    `  publishedAt?: string;\n};`,
    `  publishedAt?: string;\n  interactionType?: 'reply' | 'mention';\n  parentBody?: string;\n};`,
    'frontend context type',
  );

  // Make the compact list immediately understandable: reply vs mention + source Thread.
  app = app.replaceAll(
    `{conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}`,
    `{conversation.latestMessage?.context?.interactionType === 'mention' ? 'Mention' : conversation.latestMessage?.context?.interactionType === 'reply' ? 'Réponse' : conversation.latestMessage?.type === 'comment' ? 'Commentaire' : 'Message'} · {conversation.accountName}`,
  );

  // The detailed context card already shows the original publication. Improve its label and,
  // for nested replies, show the immediate parent reply/comment when Meta gives it to us.
  app = app.replaceAll(
    `<small className="sc20-context-label"><MessageCircle size={11} /> Commentaire sur {platformLabel(selected.platform)} · {selected.accountName || 'Compte connecté'}</small>`,
    `<small className="sc20-context-label"><MessageCircle size={11} /> {message.context.interactionType === 'mention' ? 'Mention dans un Thread' : message.context.interactionType === 'reply' ? 'Réponse à votre Thread' : `Commentaire sur ${platformLabel(selected.platform)}`} · {selected.accountName || 'Compte connecté'}</small>`,
  );
  app = app.replaceAll(
    `{excerpt && <span>{excerpt}</span>}`,
    `{message.context.parentBody && <span className="sc25-parent-context"><b>En réponse à :</b> {message.context.parentBody}</span>}\n                      {excerpt && <span>{excerpt}</span>}`,
  );

  app += '\n/* SC_THREADS_RICH_CONTEXT_UI_V1 */\n';
  fs.writeFileSync(appPath, app);
}

const cssPath = 'src/social-core.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('SC_THREADS_RICH_CONTEXT_CSS_V1')) {
  css += `\n\n/* SC_THREADS_RICH_CONTEXT_CSS_V1 */\n.sc25-parent-context{display:block!important;margin-top:5px;padding:6px 8px;border-radius:8px;background:#f7f6fb;color:#62677f;font-size:7px;line-height:1.4}.sc25-parent-context b{color:#343852;font-weight:700}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log('Threads Inbox now exposes avatars and explicit reply/mention source context.');
