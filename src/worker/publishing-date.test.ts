import { describe, expect, it } from 'vitest';
import { normalizePublicationDate } from './publishing';

describe('publication scheduling guardrails', () => {
  it('rejects even a recently elapsed schedule', () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString();
    expect(() => normalizePublicationDate(fiveSecondsAgo)).toThrow(/passé/i);
  });

  it('accepts a future schedule', () => {
    const inFiveMinutes = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(new Date(normalizePublicationDate(inFiveMinutes)).getTime()).toBeGreaterThan(Date.now());
  });
});
