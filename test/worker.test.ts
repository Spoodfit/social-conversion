import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { normalizeMetaWebhook } from '../src/shared/events';

describe('worker', () => {
  it('exposes a health endpoint', async () => {
    const response = await SELF.fetch('https://example.test/api/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', service: 'neptune-social-conversion' });
  });

  it('normalizes a Meta direct message', () => {
    const events = normalizeMetaWebhook({
      entry: [{ messaging: [{ sender: { id: '42' }, timestamp: 1_722_000_000_000, message: { mid: 'm-1', text: 'Bonjour' } }] }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'm-1', platform: 'instagram', eventType: 'message', text: 'Bonjour' });
  });
});
