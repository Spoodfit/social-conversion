import fs from 'node:fs';

const path = 'src/worker/linkedin-publishing.ts';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes('SC_LINKEDIN_ORG_POSTS_API_V2')) {
  const helperAnchor = `async function loadDestination(db: D1Database, workspaceId: string, postId: string): Promise<LinkedInDestinationRow | undefined> {`;
  if (!source.includes(helperAnchor)) throw new Error('LinkedIn Posts API patch failed: helper anchor missing.');

  const helpers = `type LinkedInImageInitializePayload = {
  value?: {
    uploadUrl?: unknown;
    image?: unknown;
  };
};

async function initializeOrganizationImage(
  fetchImpl: typeof fetch,
  token: string,
  owner: string,
): Promise<{ uploadUrl: string; image: string }> {
  const { json } = await linkedinJsonRequest(fetchImpl, 'https://api.linkedin.com/rest/images?action=initializeUpload', token, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Linkedin-Version': '202608',
    },
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const payload = json as LinkedInImageInitializePayload;
  const uploadUrl = payload.value?.uploadUrl;
  const image = payload.value?.image;
  if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://') || typeof image !== 'string' || !image.startsWith('urn:li:image:')) {
    throw new LinkedInPublishingError('LinkedIn n’a pas retourné les informations nécessaires pour envoyer l’image de la Page.', true);
  }
  return { uploadUrl, image };
}

async function publishOrganizationPost(
  env: Env,
  fetchImpl: typeof fetch,
  row: LinkedInDestinationRow,
  token: string,
  owner: string,
  commentary: string,
  selectedMediaId: string | undefined,
): Promise<string> {
  let content: Record<string, unknown> | undefined;
  if (selectedMediaId) {
    const item = await env.DB.prepare(
      'SELECT id, r2_key, file_name, mime_type, size_bytes FROM media_library WHERE id = ? AND workspace_id = ?',
    ).bind(selectedMediaId, row.workspace_id).first<MediaRow>();
    if (!item) throw new LinkedInPublishingError('Le média LinkedIn sélectionné est introuvable.', false);
    if (!item.mime_type.startsWith('image/')) {
      throw new LinkedInPublishingError('Les Pages LinkedIn prennent actuellement en charge le texte et les images dans Social Conversion. Les vidéos et documents seront ajoutés via leurs APIs dédiées.', false);
    }
    if (item.size_bytes > 30 * 1024 * 1024) throw new LinkedInPublishingError('L’image LinkedIn dépasse la limite de sécurité de 30 Mo.', false);
    const object = await env.MEDIA_BUCKET.get(item.r2_key);
    if (!object) throw new LinkedInPublishingError('Le fichier média LinkedIn est introuvable dans le stockage.', false);
    const initialized = await initializeOrganizationImage(fetchImpl, token, owner);
    await uploadBinary(fetchImpl, initialized.uploadUrl, token, await object.arrayBuffer(), item.mime_type);
    const altText = publicationAltText(row);
    content = {
      media: {
        id: initialized.image,
        ...(altText ? { altText } : {}),
      },
    };
  }
  if (!commentary && !content) throw new LinkedInPublishingError('Ajoutez du texte ou une image avant de publier sur LinkedIn.', false);

  const payload: Record<string, unknown> = {
    author: owner,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (content) payload.content = content;

  const { response } = await linkedinJsonRequest(fetchImpl, 'https://api.linkedin.com/rest/posts', token, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Linkedin-Version': '202608',
    },
    body: JSON.stringify(payload),
  });
  const externalId = response.headers.get('x-restli-id') ?? response.headers.get('X-RestLi-Id') ?? '';
  if (!externalId) throw new LinkedInPublishingError('LinkedIn a publié le contenu de la Page sans retourner son identifiant.', true);
  return externalId;
}

`;
  source = source.replace(helperAnchor, helpers + helperAnchor);

  const startMarker = `    const commentary = publicationText(row);`;
  const endMarker = `    const syncedAt = new Date().toISOString();`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) throw new Error('LinkedIn Posts API patch failed: publication block anchors missing.');

  const replacement = `    const commentary = publicationText(row);
    const owner = row.owner_urn || personUrn(row.person_id);
    const selectedMediaId = mediaId(row.media_reference);
    let externalId = '';

    if (row.connection_kind === 'organization') {
      externalId = await publishOrganizationPost(env, fetchImpl, row, token, owner, commentary, selectedMediaId);
    } else {
      let media: Array<Record<string, unknown>> | undefined;
      let mediaCategory = 'NONE';

      if (selectedMediaId) {
        const item = await env.DB.prepare(
          \`SELECT id, r2_key, file_name, mime_type, size_bytes FROM media_library WHERE id = ? AND workspace_id = ?\`,
        ).bind(selectedMediaId, row.workspace_id).first<MediaRow>();
        if (!item) throw new LinkedInPublishingError('Le média LinkedIn sélectionné est introuvable.', false);
        if (!item.mime_type.startsWith('image/')) {
          throw new LinkedInPublishingError('La publication LinkedIn automatique prend actuellement en charge le texte et les images. Utilisez une image pour cette destination.', false);
        }
        if (item.size_bytes > 30 * 1024 * 1024) {
          throw new LinkedInPublishingError('L’image LinkedIn dépasse la limite de sécurité de 30 Mo.', false);
        }
        const object = await env.MEDIA_BUCKET.get(item.r2_key);
        if (!object) throw new LinkedInPublishingError('Le fichier média LinkedIn est introuvable dans le stockage.', false);
        const registered = await registerImage(fetchImpl, token, owner);
        await uploadBinary(fetchImpl, registered.uploadUrl, token, await object.arrayBuffer(), item.mime_type);
        mediaCategory = 'IMAGE';
        const altText = publicationAltText(row);
        media = [{
          status: 'READY',
          media: registered.asset,
          title: { text: item.file_name.slice(0, 200) },
          ...(altText ? { description: { text: altText } } : {}),
        }];
      }

      if (!commentary && !media) {
        throw new LinkedInPublishingError('Ajoutez du texte ou une image avant de publier sur LinkedIn.', false);
      }

      const specificContent: Record<string, unknown> = {
        shareCommentary: { text: commentary },
        shareMediaCategory: mediaCategory,
      };
      if (media) specificContent.media = media;

      const { response } = await linkedinJsonRequest(fetchImpl, 'https://api.linkedin.com/v2/ugcPosts', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          author: owner,
          lifecycleState: 'PUBLISHED',
          specificContent: { 'com.linkedin.ugc.ShareContent': specificContent },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': publicationVisibility(row) },
        }),
      });
      externalId = response.headers.get('x-restli-id') ?? response.headers.get('X-RestLi-Id') ?? '';
      if (!externalId) throw new LinkedInPublishingError('LinkedIn a publié le contenu sans retourner son identifiant.', true);
    }
`;

  source = source.slice(0, start) + replacement + source.slice(end);
  source += '\n// SC_LINKEDIN_ORG_POSTS_API_V2\n';
  fs.writeFileSync(path, source);
}

console.log('LinkedIn Pages publishing upgraded to the versioned Posts + Images APIs.');
