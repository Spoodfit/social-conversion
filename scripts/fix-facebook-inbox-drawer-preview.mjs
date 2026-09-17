import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Facebook Inbox drawer/preview fix failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const syncPath = 'src/worker/facebook-runtime-sync.ts';
let sync = fs.readFileSync(syncPath, 'utf8');

if (!sync.includes('SC_FACEBOOK_INBOX_DRAWER_PREVIEW_V1')) {
  sync = replaceOnce(
    sync,
`type FacebookPost = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  permalink_url?: unknown;
  attachments?: { data?: Array<{ type?: unknown; media_type?: unknown }> };
};`,
`type FacebookPost = {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
  permalink_url?: unknown;
  full_picture?: unknown;
  attachments?: { data?: Array<{ type?: unknown; media_type?: unknown }> };
};`,
    'Facebook post preview field',
  );

  sync = replaceOnce(
    sync,
    `  initial.searchParams.set('fields', 'id,message,created_time,permalink_url,attachments{type,media_type}');`,
    `  initial.searchParams.set('fields', 'id,message,created_time,permalink_url,full_picture,attachments{type,media_type}');`,
    'Facebook Graph preview query',
  );

  sync = replaceOnce(
    sync,
`    const mediaType = text(firstAttachment?.media_type, 60) || text(firstAttachment?.type, 60) || undefined;
    statements.push(db.prepare(`,
`    const mediaType = text(firstAttachment?.media_type, 60) || text(firstAttachment?.type, 60) || undefined;
    const previewUrl = safeHttps(post.full_picture);
    statements.push(db.prepare(`,
    'Facebook post preview extraction',
  );

  sync = replaceOnce(
    sync,
`      ` + '`' + `INSERT INTO facebook_remote_posts
         (id, workspace_id, connection_id, external_id, body, media_type, external_url, event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, connection_id, external_id) DO UPDATE SET
         body = excluded.body,
         media_type = excluded.media_type,
         external_url = excluded.external_url,
         event_at = excluded.event_at,
         updated_at = excluded.updated_at` + '`' + `,`,
`      ` + '`' + `INSERT INTO facebook_remote_posts
         (id, workspace_id, connection_id, external_id, body, media_type, external_url, preview_url, event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, connection_id, external_id) DO UPDATE SET
         body = excluded.body,
         media_type = excluded.media_type,
         external_url = excluded.external_url,
         preview_url = excluded.preview_url,
         event_at = excluded.event_at,
         updated_at = excluded.updated_at` + '`' + `,`,
    'Facebook post preview persistence SQL',
  );

  sync = replaceOnce(
    sync,
`      mediaType ?? null,
      safeHttps(post.permalink_url) ?? null,
      eventAt,`,
`      mediaType ?? null,
      safeHttps(post.permalink_url) ?? null,
      previewUrl ?? null,
      eventAt,`,
    'Facebook post preview persistence bind',
  );

  sync = replaceOnce(
    sync,
`    type: 'comment' | 'message';
    direction: 'inbound' | 'outbound';
  },`,
`    type: 'comment' | 'message';
    direction: 'inbound' | 'outbound';
    contentContextJson?: string;
  },`,
    'Facebook message context input',
  );

  sync = replaceOnce(
    sync,
`    db.prepare(
      ` + '`' + `INSERT OR IGNORE INTO messages
         (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` + '`' + `,
    ).bind(eventId, conversationId, input.externalMessageId, input.direction, input.type, input.body, input.direction === 'outbound' ? 'sent' : 'received', input.occurredAt, now),`,
`    db.prepare(
      ` + '`' + `INSERT INTO messages
         (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at, context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         context_json = excluded.context_json
       WHERE excluded.context_json IS NOT NULL
         AND excluded.context_json <> ''
         AND COALESCE(messages.context_json, '') <> excluded.context_json` + '`' + `,
    ).bind(eventId, conversationId, input.externalMessageId, input.direction, input.type, input.body, input.direction === 'outbound' ? 'sent' : 'received', input.occurredAt, now, input.contentContextJson ?? null),`,
    'Facebook message context persistence',
  );

  sync = replaceOnce(
    sync,
`    attemptedPosts += 1;

    const url = new URL(`,
`    attemptedPosts += 1;

    const firstAttachment = Array.isArray(post.attachments?.data) ? post.attachments?.data?.[0] : undefined;
    const mediaType = text(firstAttachment?.media_type, 60) || text(firstAttachment?.type, 60) || undefined;
    const postBody = text(post.message) || 'Publication Facebook';
    const postTitle = postBody.split(/\\r?\\n/)[0]?.slice(0, 220) || 'Publication Facebook';
    const postUrl = safeHttps(post.permalink_url);
    const previewUrl = safeHttps(post.full_picture);
    const publishedAt = iso(post.created_time);
    const contentContextJson = JSON.stringify({
      kind: 'publication',
      externalContentId: postId,
      title: postTitle,
      body: postBody,
      url: postUrl,
      mediaType,
      previewUrl,
      publishedAt,
    });

    const url = new URL(`,
    'Facebook comment publication context',
  );

  sync = replaceOnce(
    sync,
`        type: 'comment',
        direction: 'inbound',
      })) saved += 1;`,
`        type: 'comment',
        direction: 'inbound',
        contentContextJson,
      })) saved += 1;`,
    'Facebook comment context bind',
  );

  sync = replaceOnce(
    sync,
`rp.media_type, rp.external_url,
            rp.event_at`,
`rp.media_type, rp.external_url, rp.preview_url,
            rp.event_at`,
    'Facebook Planner preview select',
  );

  sync = replaceOnce(
    sync,
`    external_url: string | null;
    event_at: string;`,
`    external_url: string | null;
    preview_url: string | null;
    event_at: string;`,
    'Facebook Planner preview row type',
  );

  sync = replaceOnce(
    sync,
`      readOnly: true,
      externalUrl: row.external_url ?? undefined,
      providerStatus: 'published' as const,`,
`      readOnly: true,
      externalUrl: row.external_url ?? undefined,
      previewUrl: row.preview_url ?? undefined,
      providerExternalId: row.external_id,
      providerMediaType: row.media_type ?? undefined,
      providerEditable: false,
      providerStatus: 'published' as const,`,
    'Facebook Planner preview publication',
  );

  sync += '\n// SC_FACEBOOK_INBOX_DRAWER_PREVIEW_V1\n';
  fs.writeFileSync(syncPath, sync);
}

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_FACEBOOK_ALWAYS_DRAWER_V1')) {
  app = replaceOnce(
    app,
`  function editPublication(publication: Publication) {
    if (publication.readOnly && !publication.providerEditable) {
      if (publication.externalUrl) {
        window.open(publication.externalUrl, '_blank', 'noopener,noreferrer');
      } else {
        setToast('Cette publication synchronisée ne fournit pas de lien ouvrable.');
      }
      return;
    }
    // Les contenus synchronisés modifiables (YouTube) s’ouvrent dans le volet d’édition.`,
`  function editPublication(publication: Publication) {
    // Toute publication synchronisée s’ouvre dans le même volet interne.
    // Le lien externe reste une action explicite dans le volet, jamais le comportement du clic principal.`,
    'Facebook provider click opens internal drawer',
  );

  app += '\n/* SC_FACEBOOK_ALWAYS_DRAWER_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Facebook Inbox now keeps publication context, real preview images and internal drawer navigation.');