import { describe, expect, it } from 'vitest';
import { normalizeMetaWebhook } from '../src/shared/events';
import { normalizeInstagramComments, normalizeYouTubeCommentThreads } from '../src/worker/provider-inbox-sync';

describe('Inbox publication context', () => {
  it('retains the Instagram media id from realtime Meta comment webhooks', () => {
    const connections = new Map([
      ['ig-account', { id: 'ig:connection', workspaceId: 'workspace-1' }],
    ]);
    const events = normalizeMetaWebhook({
      entry: [{
        id: 'ig-account',
        changes: [{
          value: {
            id: 'comment-1',
            text: 'Très juste',
            from: { id: 'viewer-1', username: 'lea' },
            media: { id: 'media-42', media_product_type: 'REELS' },
          },
        }],
      }],
    }, connections);

    expect(events[0]).toEqual(expect.objectContaining({
      eventType: 'comment',
      context: {
        kind: 'publication',
        externalContentId: 'media-42',
      },
    }));
  });

  it('attaches Instagram post metadata to imported comments', () => {
    const context = {
      kind: 'publication' as const,
      externalContentId: 'media-1',
      title: 'Prendre du recul',
      body: 'Prendre du recul, c’est hyper important.',
      url: 'https://www.instagram.com/p/example/',
      mediaType: 'REELS',
    };
    const events = normalizeInstagramComments({ id: 'ig:connection' }, 'workspace-1', [{
      id: 'comment-1',
      text: 'Exactement',
      timestamp: '2026-09-15T12:30:00Z',
      from: { id: 'viewer-1', username: 'lea' },
    }], context);

    expect(events[0]?.context).toEqual(context);
  });

  it('attaches the YouTube video metadata to imported comments', () => {
    const context = {
      kind: 'publication' as const,
      externalContentId: 'video-1',
      title: 'Club d’affaires : les pièges',
      body: 'Club d’affaires : les pièges\n\nDescription de la vidéo',
      url: 'https://www.youtube.com/watch?v=video-1',
      mediaType: 'VIDEO',
    };
    const events = normalizeYouTubeCommentThreads({ id: 'yt:connection' }, 'workspace-1', [{
      snippet: {
        topLevelComment: {
          id: 'comment-yt-1',
          snippet: {
            authorChannelId: { value: 'UCviewer' },
            authorDisplayName: 'Camille',
            textOriginal: 'Merci pour la vidéo',
            publishedAt: '2026-09-15T14:00:00Z',
          },
        },
      },
    }], context);

    expect(events[0]?.context).toEqual(context);
  });
});
