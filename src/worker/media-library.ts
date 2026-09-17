import type { WorkspacePrincipal } from './authorization';

export type MediaFormat = 'post' | 'short' | 'video' | 'story';

export type MediaLibraryItem = {
  id: string;
  fileName: string;
  mimeType: string;
  format: MediaFormat;
  title: string;
  caption: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
};

type MediaRow = {
  id: string;
  r2_key: string;
  file_name: string;
  mime_type: string;
  format: MediaFormat;
  title: string;
  caption: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
};

type UploadRow = {
  id: string;
  workspace_id: string;
  r2_key: string;
  upload_id: string;
  file_name: string;
  mime_type: string;
  format: MediaFormat;
  title: string;
  caption: string;
  size_bytes: number;
  created_by: string;
  status: 'uploading' | 'completed' | 'aborted';
  expires_at: string;
};

export type MediaLibraryErrorCode =
  | 'INVALID_MEDIA'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_IN_USE'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_CONFLICT';

export class MediaLibraryError extends Error {
  constructor(public readonly code: MediaLibraryErrorCode, message: string) {
    super(message);
    this.name = 'MediaLibraryError';
  }
}

const formats = new Set<MediaFormat>(['post', 'short', 'video', 'story']);
const MAX_MEDIA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB, uploaded in chunks.
export const MEDIA_PART_SIZE = 8 * 1024 * 1024;

function normalizeFormat(value: unknown): MediaFormat {
  if (typeof value !== 'string' || !formats.has(value as MediaFormat)) {
    throw new MediaLibraryError('INVALID_MEDIA', 'Choisissez un format valide : post, short, vidéo ou story.');
  }
  return value as MediaFormat;
}

function normalizeText(value: unknown, maximum: number, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new MediaLibraryError('INVALID_MEDIA', 'Les métadonnées du contenu sont invalides.');
  const text = value.trim();
  if (text.length > maximum) throw new MediaLibraryError('INVALID_MEDIA', 'Une métadonnée du contenu est trop longue.');
  return text;
}

function normalizeUploadInput(input: Record<string, unknown>) {
  const fileName = normalizeText(input.fileName, 240);
  const mimeType = normalizeText(input.mimeType, 120).toLowerCase();
  const format = normalizeFormat(input.format);
  const title = normalizeText(input.title, 180, fileName) || fileName;
  const caption = normalizeText(input.caption, 5_000);
  const sizeBytes = Number(input.sizeBytes);

  if (!fileName || !mimeType || (!mimeType.startsWith('image/') && !mimeType.startsWith('video/'))) {
    throw new MediaLibraryError('INVALID_MEDIA', 'La bibliothèque accepte les images et vidéos.');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_MEDIA_BYTES) {
    throw new MediaLibraryError('INVALID_MEDIA', 'La taille du fichier est invalide ou dépasse 10 Go.');
  }
  if ((format === 'short' || format === 'video') && !mimeType.startsWith('video/')) {
    throw new MediaLibraryError('INVALID_MEDIA', 'Un short ou une vidéo doit utiliser un fichier vidéo.');
  }

  return { fileName, mimeType, format, title, caption, sizeBytes };
}

function safeFileSegment(fileName: string) {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop() ?? ''}` : '';
  const base = fileName.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'media';
  const safeExtension = extension.replace(/[^A-Za-z0-9.]/g, '').slice(0, 12);
  return `${base}${safeExtension}`;
}

function toItem(row: MediaRow): MediaLibraryItem {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    format: row.format,
    title: row.title,
    caption: row.caption,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    previewUrl: `/api/library/${encodeURIComponent(row.id)}/file`,
  };
}

export async function listMediaLibrary(db: D1Database, workspaceId: string, format?: string) {
  const requestedFormat = format ? normalizeFormat(format) : undefined;
  const result = requestedFormat
    ? await db.prepare(
      `SELECT id, r2_key, file_name, mime_type, format, title, caption, size_bytes, created_at, updated_at
       FROM media_library WHERE workspace_id = ? AND format = ? ORDER BY created_at DESC`,
    ).bind(workspaceId, requestedFormat).all<MediaRow>()
    : await db.prepare(
      `SELECT id, r2_key, file_name, mime_type, format, title, caption, size_bytes, created_at, updated_at
       FROM media_library WHERE workspace_id = ? ORDER BY created_at DESC`,
    ).bind(workspaceId).all<MediaRow>();
  return { items: result.results.map(toItem) };
}

export async function getMediaLibraryItem(db: D1Database, workspaceId: string, mediaId: string) {
  const row = await db.prepare(
    `SELECT id, r2_key, file_name, mime_type, format, title, caption, size_bytes, created_at, updated_at
     FROM media_library WHERE id = ? AND workspace_id = ?`,
  ).bind(mediaId, workspaceId).first<MediaRow>();
  if (!row) throw new MediaLibraryError('MEDIA_NOT_FOUND', 'Contenu introuvable dans cette bibliothèque.');
  return { row, item: toItem(row) };
}

export async function createMediaUpload(
  db: D1Database,
  bucket: R2Bucket,
  principal: WorkspacePrincipal,
  rawInput: Record<string, unknown>,
) {
  const input = normalizeUploadInput(rawInput);
  const id = crypto.randomUUID();
  const key = `workspaces/${principal.workspaceId}/library/${id}/${safeFileSegment(input.fileName)}`;
  const multipart = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: input.mimeType },
    customMetadata: { workspaceId: principal.workspaceId, mediaUploadId: id },
  });
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000).toISOString();

  await db.prepare(
    `INSERT INTO media_uploads
      (id, workspace_id, r2_key, upload_id, file_name, mime_type, format, title, caption, size_bytes, created_by, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
  ).bind(
    id,
    principal.workspaceId,
    key,
    multipart.uploadId,
    input.fileName,
    input.mimeType,
    input.format,
    input.title,
    input.caption,
    input.sizeBytes,
    principal.subject,
    createdAt.toISOString(),
    expiresAt,
  ).run();

  return {
    upload: {
      id,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      partSize: MEDIA_PART_SIZE,
      expiresAt,
    },
  };
}

async function loadUpload(db: D1Database, workspaceId: string, uploadId: string) {
  const row = await db.prepare(
    `SELECT id, workspace_id, r2_key, upload_id, file_name, mime_type, format, title, caption, size_bytes,
            created_by, status, expires_at
     FROM media_uploads WHERE id = ? AND workspace_id = ?`,
  ).bind(uploadId, workspaceId).first<UploadRow>();
  if (!row) throw new MediaLibraryError('UPLOAD_NOT_FOUND', 'Upload introuvable.');
  if (row.status !== 'uploading') throw new MediaLibraryError('UPLOAD_CONFLICT', 'Cet upload est déjà terminé ou annulé.');
  if (Date.parse(row.expires_at) <= Date.now()) throw new MediaLibraryError('UPLOAD_EXPIRED', 'Cet upload a expiré. Relancez-le depuis la bibliothèque.');
  return row;
}

export async function uploadMediaPart(
  db: D1Database,
  bucket: R2Bucket,
  workspaceId: string,
  uploadId: string,
  partNumber: number,
  body: ReadableStream<Uint8Array> | null,
) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000 || !body) {
    throw new MediaLibraryError('INVALID_MEDIA', 'Partie de fichier invalide.');
  }
  const row = await loadUpload(db, workspaceId, uploadId);
  const multipart = bucket.resumeMultipartUpload(row.r2_key, row.upload_id);
  try {
    const part = await multipart.uploadPart(partNumber, body);
    return { part: { partNumber: part.partNumber, etag: part.etag } };
  } catch {
    throw new MediaLibraryError('UPLOAD_CONFLICT', 'Cette partie du fichier n’a pas pu être enregistrée.');
  }
}

export async function completeMediaUpload(
  db: D1Database,
  bucket: R2Bucket,
  principal: WorkspacePrincipal,
  uploadId: string,
  rawParts: unknown,
) {
  const row = await loadUpload(db, principal.workspaceId, uploadId);
  if (!Array.isArray(rawParts) || rawParts.length === 0 || rawParts.length > 10_000) {
    throw new MediaLibraryError('INVALID_MEDIA', 'Liste des parties uploadées invalide.');
  }
  const parts = rawParts.map((raw) => {
    const value = raw as { partNumber?: unknown; etag?: unknown };
    const partNumber = Number(value?.partNumber);
    const etag = typeof value?.etag === 'string' ? value.etag : '';
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000 || !etag || etag.length > 512) {
      throw new MediaLibraryError('INVALID_MEDIA', 'Une partie uploadée est invalide.');
    }
    return { partNumber, etag };
  }).sort((a, b) => a.partNumber - b.partNumber);

  const multipart = bucket.resumeMultipartUpload(row.r2_key, row.upload_id);
  try {
    await multipart.complete(parts);
  } catch {
    throw new MediaLibraryError('UPLOAD_CONFLICT', 'Le fichier n’a pas pu être finalisé. Relancez l’upload.');
  }

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO media_library
        (id, workspace_id, r2_key, file_name, mime_type, format, title, caption, size_bytes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id,
      principal.workspaceId,
      row.r2_key,
      row.file_name,
      row.mime_type,
      row.format,
      row.title,
      row.caption,
      row.size_bytes,
      principal.subject,
      now,
      now,
    ),
    db.prepare(`UPDATE media_uploads SET status = 'completed' WHERE id = ? AND workspace_id = ?`).bind(row.id, principal.workspaceId),
  ]);

  const loaded = await getMediaLibraryItem(db, principal.workspaceId, row.id);
  return { item: loaded.item };
}

export async function abortMediaUpload(db: D1Database, bucket: R2Bucket, workspaceId: string, uploadId: string) {
  const row = await loadUpload(db, workspaceId, uploadId);
  try {
    await bucket.resumeMultipartUpload(row.r2_key, row.upload_id).abort();
  } finally {
    await db.prepare(`UPDATE media_uploads SET status = 'aborted' WHERE id = ? AND workspace_id = ?`).bind(uploadId, workspaceId).run();
  }
  return { id: uploadId, status: 'aborted' };
}

export async function updateMediaLibraryItem(
  db: D1Database,
  workspaceId: string,
  mediaId: string,
  rawInput: Record<string, unknown>,
) {
  await getMediaLibraryItem(db, workspaceId, mediaId);
  const title = rawInput.title === undefined ? undefined : normalizeText(rawInput.title, 180);
  const caption = rawInput.caption === undefined ? undefined : normalizeText(rawInput.caption, 5_000);
  const format = rawInput.format === undefined ? undefined : normalizeFormat(rawInput.format);
  if (title === undefined && caption === undefined && format === undefined) {
    throw new MediaLibraryError('INVALID_MEDIA', 'Aucune modification à enregistrer.');
  }
  if (title !== undefined && !title) throw new MediaLibraryError('INVALID_MEDIA', 'Le titre ne peut pas être vide.');

  const fields: string[] = [];
  const values: unknown[] = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(title); }
  if (caption !== undefined) { fields.push('caption = ?'); values.push(caption); }
  if (format !== undefined) { fields.push('format = ?'); values.push(format); }
  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now, mediaId, workspaceId);
  await db.prepare(`UPDATE media_library SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).bind(...values).run();
  const loaded = await getMediaLibraryItem(db, workspaceId, mediaId);
  return { item: loaded.item };
}

export async function deleteMediaLibraryItem(db: D1Database, bucket: R2Bucket, workspaceId: string, mediaId: string) {
  const loaded = await getMediaLibraryItem(db, workspaceId, mediaId);
  const reference = `library:${mediaId}`;
  const inUse = await db.prepare(
    `SELECT 1 AS present FROM content_posts
     WHERE workspace_id = ? AND media_reference = ? AND status != 'cancelled' LIMIT 1`,
  ).bind(workspaceId, reference).first<{ present: number }>();
  if (inUse) throw new MediaLibraryError('MEDIA_IN_USE', 'Ce contenu est utilisé par une publication programmée.');
  await bucket.delete(loaded.row.r2_key);
  await db.prepare(`DELETE FROM media_library WHERE id = ? AND workspace_id = ?`).bind(mediaId, workspaceId).run();
  return { id: mediaId, deleted: true };
}
