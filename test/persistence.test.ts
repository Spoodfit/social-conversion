import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { NormalizedSocialEvent } from '../src/shared/types';
import { persistSocialEvent } from '../src/worker/persistence';

function event(overrides: Partial<NormalizedSocialEvent> = {}): NormalizedSocialEvent {
  return {
    id: 'connection-1:message-1',
    externalEventId: 'message-1',
    platform: 'instagram',
    workspaceId: 'default',
    connectionId: 'connection-1',
    eventType: 'message',
    externalContactId: 'contact-1',
    contactName: 'Contact pilote',
    text: 'Message privé à ne pas dupliquer dans le journal webhook',
    occurredAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('social event persistence', () => {
  it('persists an inbound event transactionally and remains idempotent', async () => {
    const socialEvent = event();
    await expect(persistSocialEvent(env.DB, socialEvent)).resolves.toBe('created');
    await expect(persistSocialEvent(env.DB, socialEvent)).resolves.toBe('duplicate');

    const counts = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS count FROM webhook_events WHERE id = ?').bind(socialEvent.id),
      env.DB.prepare('SELECT COUNT(*) AS count FROM messages WHERE id = ?').bind(socialEvent.id),
      env.DB.prepare('SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ?').bind('default'),
    ]);
    expect(counts.map((result) => result.results[0])).toEqual([
      { count: 1 },
      { count: 1 },
      { count: 1 },
    ]);

    const webhook = await env.DB
      .prepare(
        `SELECT workspace_id, connection_id, external_event_id, payload_json, processed_at
         FROM webhook_events WHERE id = ?`,
      )
      .bind(socialEvent.id)
      .first<{
        workspace_id: string;
        connection_id: string;
        external_event_id: string;
        payload_json: string;
        processed_at: string;
      }>();
    expect(webhook).toMatchObject({
      workspace_id: 'default',
      connection_id: 'connection-1',
      external_event_id: 'message-1',
    });
    expect(webhook?.processed_at).toBeTruthy();
    expect(webhook?.payload_json).not.toContain(socialEvent.text);
  });

  it('scopes identical external contacts and event ids by workspace and connection', async () => {
    await env.DB
      .prepare("INSERT INTO workspaces (id, name) VALUES ('workspace-2', 'Second workspace')")
      .run();

    const first = event({
      id: 'connection-a:shared-event',
      externalEventId: 'shared-event',
      connectionId: 'connection-a',
    });
    const second = event({
      id: 'connection-b:shared-event',
      externalEventId: 'shared-event',
      workspaceId: 'workspace-2',
      connectionId: 'connection-b',
    });

    await expect(persistSocialEvent(env.DB, first)).resolves.toBe('created');
    await expect(persistSocialEvent(env.DB, second)).resolves.toBe('created');

    const contacts = await env.DB
      .prepare(
        `SELECT workspace_id, external_id
         FROM contacts WHERE external_id = 'contact-1' ORDER BY workspace_id`,
      )
      .all<{ workspace_id: string; external_id: string }>();
    expect(contacts.results).toEqual([
      { workspace_id: 'default', external_id: 'contact-1' },
      { workspace_id: 'workspace-2', external_id: 'contact-1' },
    ]);
  });
});
