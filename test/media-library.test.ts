import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import {
  completeMediaUpload,
  createMediaUpload,
  deleteMediaLibraryItem,
  getMediaLibraryItem,
  listMediaLibrary,
  updateMediaLibraryItem,
  uploadMediaPart,
} from '../src/worker/media-library';

function principal(): WorkspacePrincipal {
  return {
    subject: 'media-library-test-subject',
    email: 'media-library@example.test',
    workspaceId: 'default',
    workspaceName: 'Neptune Business Club',
    role: 'admin',
    memberId: 'media-library-test-member',
  };
}

describe('media library', () => {
  it('uploads a file in R2, persists metadata and can update/delete it', async () => {
    const created = await createMediaUpload(env.DB, env.MEDIA_BUCKET, principal(), {
      fileName: 'visuel-test.png',
      mimeType: 'image/png',
      format: 'post',
      title: 'Visuel test',
      caption: 'Légende prête à publier',
      sizeBytes: 16,
    });

    const bytes = new TextEncoder().encode('image-test-bytes');
    const uploaded = await uploadMediaPart(
      env.DB,
      env.MEDIA_BUCKET,
      'default',
      created.upload.id,
      1,
      new Blob([bytes], { type: 'image/png' }).stream(),
    );

    const completed = await completeMediaUpload(
      env.DB,
      env.MEDIA_BUCKET,
      principal(),
      created.upload.id,
      [uploaded.part],
    );

    expect(completed.item).toMatchObject({
      title: 'Visuel test',
      caption: 'Légende prête à publier',
      format: 'post',
      mimeType: 'image/png',
    });

    const loaded = await getMediaLibraryItem(env.DB, 'default', completed.item.id);
    const object = await env.MEDIA_BUCKET.get(loaded.row.r2_key);
    expect(object).not.toBeNull();
    expect(await object?.text()).toBe('image-test-bytes');

    const updated = await updateMediaLibraryItem(env.DB, 'default', completed.item.id, {
      title: 'Visuel renommé',
      caption: 'Nouvelle légende',
      format: 'story',
    });
    expect(updated.item).toMatchObject({ title: 'Visuel renommé', caption: 'Nouvelle légende', format: 'story' });

    const listed = await listMediaLibrary(env.DB, 'default');
    expect(listed.items.some((item) => item.id === completed.item.id)).toBe(true);

    await deleteMediaLibraryItem(env.DB, env.MEDIA_BUCKET, 'default', completed.item.id);
    const afterDelete = await listMediaLibrary(env.DB, 'default');
    expect(afterDelete.items.some((item) => item.id === completed.item.id)).toBe(false);
  });

  it('refuses to delete media referenced by an active scheduled publication', async () => {
    const created = await createMediaUpload(env.DB, env.MEDIA_BUCKET, principal(), {
      fileName: 'short-test.mp4',
      mimeType: 'video/mp4',
      format: 'short',
      title: 'Short test',
      caption: '',
      sizeBytes: 12,
    });
    const uploaded = await uploadMediaPart(
      env.DB,
      env.MEDIA_BUCKET,
      'default',
      created.upload.id,
      1,
      new Blob(['video-bytes!'], { type: 'video/mp4' }).stream(),
    );
    const completed = await completeMediaUpload(env.DB, env.MEDIA_BUCKET, principal(), created.upload.id, [uploaded.part]);

    await env.DB.prepare(
      `INSERT INTO content_posts
        (id, workspace_id, body, media_reference, status, scheduled_at, created_by, version, created_at, updated_at)
       VALUES (?, 'default', 'Publication liée', ?, 'scheduled', ?, ?, 1, ?, ?)`,
    ).bind(
      `media-post-${crypto.randomUUID()}`,
      `library:${completed.item.id}`,
      new Date(Date.now() + 60_000).toISOString(),
      principal().subject,
      new Date().toISOString(),
      new Date().toISOString(),
    ).run();

    await expect(deleteMediaLibraryItem(env.DB, env.MEDIA_BUCKET, 'default', completed.item.id))
      .rejects.toMatchObject({ code: 'MEDIA_IN_USE' });
  });
});
