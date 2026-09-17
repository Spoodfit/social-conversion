import { describe, expect, it } from 'vitest';
import { normalizeInstagramComments, normalizeYouTubeCommentThreads } from '../src/worker/provider-inbox-sync';

describe('Inbox visual publication context', () => {
  it('keeps an Instagram publication preview on normalized comments', () => {
    const context = {
      kind: 'publication' as const,
      externalContentId: 'media-1',
      title: 'Publication test',
      previewUrl: 'https://example.cdninstagram.com/image.jpg',
      publishedAt: '2026-09-15T12:00:00.000Z',
    };
    const [event] = normalizeInstagramComments({ id: 'ig-1' }, 'workspace-1', [{
      id: 'comment-1',
      text: 'Super',
      timestamp: '2026-09-15T12:30:00Z',
      from: { id: 'viewer-1', username: 'viewer' },
    }], context);
    expect(event?.context).toEqual(context);
  });

  it('keeps a YouTube video thumbnail on normalized comments', () => {
    const context = {
      kind: 'publication' as const,
      externalContentId: 'video-1',
      title: 'Vidéo test',
      previewUrl: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg',
      publishedAt: '2026-09-15T12:00:00.000Z',
    };
    const [event] = normalizeYouTubeCommentThreads({ id: 'yt-1' }, 'workspace-1', [{
      snippet: {
        topLevelComment: {
          id: 'comment-1',
          snippet: {
            authorChannelId: { value: 'UCviewer' },
            authorDisplayName: 'Viewer',
            textOriginal: 'Très clair',
            publishedAt: '2026-09-15T13:00:00Z',
          },
        },
      },
    }], context);
    expect(event?.context?.previewUrl).toBe(context.previewUrl);
    expect(event?.context?.externalContentId).toBe('video-1');
  });
});
