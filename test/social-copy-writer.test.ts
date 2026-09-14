import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { generateSocialCopy } from '../src/worker/social-copy-writer';

function aiEnv(withKey = true): Env {
  return {
    ...env,
    OPENAI_API_KEY: withKey ? 'test-social-copy-secret' : undefined,
    OPENAI_MODEL: 'gpt-5.6-test',
  } as unknown as Env;
}

function successfulFetch(fields: Record<string, unknown>) {
  return vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-social-copy-secret' });
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      reasoning: { effort: string };
      input: string;
      text: { format: { type: string; name: string; strict: boolean; schema: Record<string, unknown> } };
    };
    expect(body.model).toBe('gpt-5.6-test');
    expect(body.reasoning.effort).toBe('low');
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
    return new Response(JSON.stringify({
      id: 'resp_social_copy',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify({ fields }) }],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('social copy writer', () => {
  it('fails closed when the AI provider is not configured', async () => {
    await expect(generateSocialCopy(aiEnv(false), {
      objective: 'engagement',
      platform: 'instagram',
      format: 'post',
      fields: {},
      mediaTitle: 'Visuel Neptune',
    })).rejects.toMatchObject({ code: 'AI_NOT_READY' });
  });

  it('generates only the editorial fields expected by YouTube', async () => {
    const fetchMock = successfulFetch({
      title: '3 façons simples de créer de vraies connexions professionnelles',
      description: 'Découvrez trois méthodes concrètes pour transformer une rencontre en opportunité utile.',
      tags: ['réseau professionnel', 'entrepreneuriat', 'business'],
    });
    const result = await generateSocialCopy(aiEnv(), {
      objective: 'engagement',
      platform: 'youtube',
      format: 'video',
      fields: { privacyStatus: 'private', title: '', description: '' },
      mediaTitle: 'Interview entrepreneur',
      mediaCaption: 'Échange sur la création de relations professionnelles durables.',
    }, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: string; text: { format: { schema: { properties: { fields: { properties: Record<string, unknown> } } } } } };
    expect(request.input).toContain('augmenter les interactions utiles');
    expect(Object.keys(request.text.format.schema.properties.fields.properties).sort()).toEqual(['description', 'tags', 'title']);
    expect(result.fields).toEqual({
      title: '3 façons simples de créer de vraies connexions professionnelles',
      description: 'Découvrez trois méthodes concrètes pour transformer une rencontre en opportunité utile.',
      tags: ['réseau professionnel', 'entrepreneuriat', 'business'],
    });
    expect(result.fields).not.toHaveProperty('privacyStatus');
  });

  it('uses the conversion objective without inventing technical settings', async () => {
    const fetchMock = successfulFetch({
      caption: 'Vous voulez rencontrer les bonnes personnes sans collectionner les cartes de visite ? Découvrez Neptune et échangeons.',
    });
    const result = await generateSocialCopy(aiEnv(), {
      objective: 'conversion',
      platform: 'instagram',
      format: 'reel',
      fields: { caption: '', shareToFeed: true },
      mediaTitle: 'Afterwork Neptune',
    }, fetchMock);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: string };
    expect(request.input).toContain('augmenter les conversions');
    expect(result.fields).toHaveProperty('caption');
    expect(result.fields).not.toHaveProperty('shareToFeed');
  });

  it('does not offer objective copy for formats without public editorial fields', async () => {
    await expect(generateSocialCopy(aiEnv(), {
      objective: 'engagement',
      platform: 'instagram',
      format: 'story',
      fields: { note: 'Mémo interne' },
    }, successfulFetch({}))).rejects.toMatchObject({ code: 'NO_WRITABLE_FIELDS' });
  });
});
