import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { describe, expect, it } from 'vitest';
import { verifyAccessToken, type AccessConfig } from '../src/worker/auth';

const config: AccessConfig = {
  teamDomain: 'https://social-conversion-test.cloudflareaccess.com',
  audience: 'social-conversion-test-audience',
};

async function signedToken(overrides: { audience?: string; issuer?: string } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = {
    ...await exportJWK(publicKey),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  const token = await new SignJWT({ email: 'ADMIN@Example.Test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? config.teamDomain)
    .setAudience(overrides.audience ?? config.audience)
    .setSubject('access-subject-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  return { token, getKey: createLocalJWKSet({ keys: [publicJwk] }) };
}

describe('Cloudflare Access JWT verification', () => {
  it('verifies RS256, issuer and audience and normalizes email', async () => {
    const { token, getKey } = await signedToken();
    await expect(verifyAccessToken(token, config, getKey)).resolves.toEqual({
      subject: 'access-subject-1',
      email: 'admin@example.test',
    });
  });

  it('rejects a token issued for another Access application', async () => {
    const { token, getKey } = await signedToken({ audience: 'another-audience' });
    await expect(verifyAccessToken(token, config, getKey)).rejects.toThrow();
  });

  it('rejects a token from another issuer', async () => {
    const { token, getKey } = await signedToken({
      issuer: 'https://another-team.cloudflareaccess.com',
    });
    await expect(verifyAccessToken(token, config, getKey)).rejects.toThrow();
  });
});
