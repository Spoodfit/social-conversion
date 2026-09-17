import { describe, expect, it } from 'vitest';
import { buildYouTubeMetadata, isYouTubeSyncEnvelope, YouTubePublishingError } from './youtube-publishing';

describe('YouTube publication metadata', () => {
  it('schedules a future public video as private with publishAt', () => {
    const metadata = buildYouTubeMetadata({
      title: 'Mon Short',
      description: 'Description',
      tags: ['neptune', 'business'],
      privacyStatus: 'public',
      madeForKids: false,
      containsSyntheticMedia: true,
    }, '2026-09-16T08:00:00.000Z', Date.parse('2026-09-14T12:00:00.000Z'));

    expect(metadata.snippet.title).toBe('Mon Short');
    expect(metadata.status.privacyStatus).toBe('private');
    expect(metadata.status.publishAt).toBe('2026-09-16T08:00:00.000Z');
    expect(metadata.status.selfDeclaredMadeForKids).toBe(false);
    expect(metadata.status.containsSyntheticMedia).toBe(true);
  });

  it('preserves the exact instant when a local schedule includes a timezone offset', () => {
    const metadata = buildYouTubeMetadata({
      title: 'Publication Paris',
      privacyStatus: 'public',
      madeForKids: false,
    }, '2026-09-15T08:00:00+02:00', Date.parse('2026-09-14T12:00:00.000Z'));

    expect(metadata.status.privacyStatus).toBe('private');
    expect(metadata.status.publishAt).toBe('2026-09-15T06:00:00.000Z');
  });

  it('keeps an explicitly private video private without publishAt', () => {
    const metadata = buildYouTubeMetadata({
      title: 'Privée',
      privacyStatus: 'private',
      madeForKids: false,
    }, '2026-09-16T08:00:00.000Z', Date.parse('2026-09-14T12:00:00.000Z'));

    expect(metadata.status.privacyStatus).toBe('private');
    expect(metadata.status.publishAt).toBeUndefined();
  });

  it('refuses to publish when the audience declaration is missing', () => {
    expect(() => buildYouTubeMetadata({
      title: 'Audience à compléter',
      privacyStatus: 'private',
    }, '2026-09-16T08:00:00.000Z', Date.parse('2026-09-14T12:00:00.000Z')))
      .toThrowError(YouTubePublishingError);
  });

  it('recognizes only valid queue envelopes', () => {
    expect(isYouTubeSyncEnvelope({ kind: 'youtube_publication_sync', workspaceId: 'ws', postId: 'post' })).toBe(true);
    expect(isYouTubeSyncEnvelope({ kind: 'youtube_publication_sync', workspaceId: 'ws' })).toBe(false);
  });
});
