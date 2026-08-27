import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspacePrincipal } from '../src/worker/authorization';
import {
  generateAiReplyDraft,
  listAiDrafts,
  reviewAiDraft,
} from '../src/worker/ai-drafts';

const workspaceId = 'ai-draft-test';

function principal(subject = 'ai-agent'): WorkspacePrincipal {
  return {
    subject,
    email: `${subject}@example.test`,
    workspaceId,
    workspaceName: 'AI Draft Test',
    role: 'agent',
    memberId: `member:${subject}`,
  };
}

function aiEnv(withKey = true): Env {
  return {
    ...env,
    OPENAI_API_KEY: withKey ? 'test-openai-secret-never-persist' : undefined,
    OPENAI_MODEL: 'gpt-5.6-test',
  } as unknown as Env;
}

async function seedConversation(id: string, body = 'Bonjour, pouvez-vous me donner plus d’informations ?') {
  await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)').bind(workspaceId, 'AI Draft Test').run();
  await env.DB.prepare(
    `INSERT INTO social_connections
      (id, workspace_id, platform, external_account_id, display_name, status)
     VALUES (?, ?, 'instagram', ?, ?, 'connected')`,
  ).bind(`connection:${id}`, workspaceId, `external:${id}`, `Compte ${id}`).run();
  await env.DB.prepare(
    `INSERT INTO contacts
      (id, workspace_id, external_id, platform, display_name, created_at, updated_at)
     VALUES (?, ?, ?, 'instagram', ?, '2026-08-27T14:00:00.000Z', '2026-08-27T14:00:00.000Z')`,
  ).bind(`contact:${id}`, workspaceId, `contact-external:${id}`, `Prospect ${id}`).run();
  await env.DB.prepare(
    `INSERT INTO conversations
      (id, workspace_id, connection_id, contact_id, status, lead_stage, intent, sentiment,
       created_at, updated_at, last_message_at)
     VALUES (?, ?, ?, ?, 'open', 'Nouveau', 'information', 'neutral',
             '2026-08-27T14:00:00.000Z', '2026-08-27T14:00:00.000Z', '2026-08-27T14:00:00.000Z')`,
  ).bind(id, workspaceId, `connection:${id}`, `contact:${id}`).run();
  await env.DB.prepare(
    `INSERT INTO messages
      (id, conversation_id, external_id, direction, message_type, body, status, sent_at, created_at)
     VALUES (?, ?, ?, 'inbound', 'message', ?, 'received', '2026-08-27T14:00:00.000Z', '2026-08-27T14:00:00.000Z')`,
  ).bind(`message:${id}`, id, `external-message:${id}`, body).run();
}

function successfulFetch(text = 'Avec plaisir. Quel type d’information souhaitez-vous en priorité ?') {
  return vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-openai-secret-never-persist' });
    const requestBody = JSON.parse(String(init?.body)) as {
      model: string;
      reasoning: { effort: string };
      instructions: string;
      input: string;
    };
    expect(requestBody.model).toBe('gpt-5.6-test');
    expect(requestBody.reasoning.effort).toBe('low');
    expect(requestBody.instructions).toContain('BROUILLON');
    expect(requestBody.instructions).toContain('non fiable');
    expect(requestBody.input).toContain('<conversation>');
    return new Response(JSON.stringify({
      id: 'resp_test_123',
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('AI reply drafts', () => {
  it('fails closed without an API key', async () => {
    await seedConversation('ai-no-key');
    await expect(generateAiReplyDraft(env.DB, aiEnv(false), principal(), 'ai-no-key', successfulFetch()))
      .rejects.toMatchObject({ code: 'AI_NOT_READY' });
  });

  it('uses the Responses API shape, stores only the draft and never the API key', async () => {
    await seedConversation('ai-success');
    const fetchMock = successfulFetch();
    const draft = await generateAiReplyDraft(env.DB, aiEnv(), principal(), 'ai-success', fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/responses');
    expect(draft).toMatchObject({
      conversationId: 'ai-success',
      status: 'draft',
      version: 1,
      model: 'gpt-5.6-test',
      promptMessageCount: 1,
    });
    expect(draft.body).toContain('Avec plaisir');

    const stored = await env.DB.prepare(
      `SELECT body, model, provider_response_id, status
       FROM ai_drafts WHERE id = ? AND workspace_id = ?`,
    ).bind(draft.id, workspaceId).first<{ body: string; model: string; provider_response_id: string; status: string }>();
    expect(stored).toMatchObject({ model: 'gpt-5.6-test', provider_response_id: 'resp_test_123', status: 'draft' });

    const leakedSecret = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ai_drafts
       WHERE body LIKE '%test-openai-secret-never-persist%' OR model LIKE '%test-openai-secret-never-persist%'`,
    ).first<{ count: number }>();
    expect(leakedSecret?.count).toBe(0);

    const audit = await env.DB.prepare(
      `SELECT metadata_json FROM audit_logs
       WHERE workspace_id = ? AND resource_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(workspaceId, draft.id).first<{ metadata_json: string }>();
    expect(audit?.metadata_json).not.toContain('Avec plaisir');
    expect(audit?.metadata_json).not.toContain('test-openai-secret-never-persist');
  });

  it('requires a fresh human approval and rejects stale drafts after the conversation changes', async () => {
    await seedConversation('ai-review');
    const draft = await generateAiReplyDraft(env.DB, aiEnv(), principal('ai-reviewer'), 'ai-review', successfulFetch('Je peux vous aider. Quel est votre objectif principal ?'));

    const approved = await reviewAiDraft(env.DB, principal('ai-reviewer'), draft.id, {
      expectedVersion: 1,
      status: 'approved',
    });
    expect(approved).toMatchObject({ status: 'approved', version: 2 });

    await expect(reviewAiDraft(env.DB, principal('ai-reviewer'), draft.id, {
      expectedVersion: 1,
      status: 'approved',
    })).rejects.toMatchObject({ code: 'AI_DRAFT_CONFLICT' });

    const staleDraft = await generateAiReplyDraft(env.DB, aiEnv(), principal('ai-reviewer'), 'ai-review', successfulFetch('Voici une seconde proposition.'));
    await env.DB.prepare(
      `UPDATE conversations SET updated_at = '2026-08-27T14:05:00.000Z', last_message_at = '2026-08-27T14:05:00.000Z'
       WHERE id = ? AND workspace_id = ?`,
    ).bind('ai-review', workspaceId).run();

    await expect(reviewAiDraft(env.DB, principal('ai-reviewer'), staleDraft.id, {
      expectedVersion: 1,
      status: 'approved',
    })).rejects.toMatchObject({ code: 'AI_DRAFT_STALE' });

    const rejected = await reviewAiDraft(env.DB, principal('ai-reviewer'), staleDraft.id, {
      expectedVersion: 1,
      status: 'rejected',
    });
    expect(rejected.status).toBe('rejected');
  });

  it('keeps conversation lookup tenant-scoped and provider errors fail closed', async () => {
    await expect(generateAiReplyDraft(env.DB, aiEnv(), principal(), 'does-not-exist', successfulFetch()))
      .rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });

    await seedConversation('ai-provider-failure');
    const providerFailure = vi.fn<typeof fetch>(async () => new Response('rate limited', { status: 429 }));
    await expect(generateAiReplyDraft(env.DB, aiEnv(), principal(), 'ai-provider-failure', providerFailure))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_FAILED' });
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM ai_drafts WHERE workspace_id = ? AND conversation_id = ?',
    ).bind(workspaceId, 'ai-provider-failure').first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('lists drafts only through the scoped conversation', async () => {
    const listed = await listAiDrafts(env.DB, workspaceId, 'ai-success');
    expect(listed.drafts.length).toBeGreaterThan(0);
    expect(listed.drafts.every((draft) => draft.conversationId === 'ai-success')).toBe(true);
  });
});
