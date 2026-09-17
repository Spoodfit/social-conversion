import { describe, expect, it } from 'vitest';
import { normalizeInstagramComments, normalizeYouTubeCommentThreads } from '../src/worker/provider-inbox-sync';

describe('provider inbox comment sync', () => {
  it('normalizes Instagram comments with the same id shape as Meta webhooks', () => {
    const events = normalizeInstagramComments({ id: 'ig:connection' }, 'workspace-1', [{
      id: '17890001',
      text: 'Très bonne vidéo',
      timestamp: '2026-09-15T12:30:00Z',
      from: { id: 'viewer-1', username: 'jules' },
    }]);

    expect(events).toEqual([expect.objectContaining({
      id: 'ig:connection:17890001',
      externalEventId: '17890001',
      platform: 'instagram',
      eventType: 'comment',
      externalContactId: 'viewer-1',
      contactName: '@jules',
      text: 'Très bonne vidéo',
      occurredAt: '2026-09-15T12:30:00.000Z',
    })]);
  });

  it('normalizes YouTube top-level comments for the Inbox', () => {
    const events = normalizeYouTubeCommentThreads({ id: 'yt:connection' }, 'workspace-1', [{
      snippet: {
        topLevelComment: {
          id: 'Ugxyz',
          snippet: {
            authorChannelId: { value: 'UCviewer' },
            authorDisplayName: 'Camille',
            textOriginal: 'Merci pour la vidéo',
            publishedAt: '2026-09-15T14:00:00Z',
          },
        },
      },
    }]);

    expect(events).toEqual([expect.objectContaining({
      id: 'yt:connection:youtube-comment:Ugxyz',
      externalEventId: 'Ugxyz',
      platform: 'youtube',
      eventType: 'comment',
      externalContactId: 'UCviewer',
      contactName: 'Camille',
      text: 'Merci pour la vidéo',
      occurredAt: '2026-09-15T14:00:00.000Z',
    })]);
  });
});
