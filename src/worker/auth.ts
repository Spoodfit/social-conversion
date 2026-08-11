import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  teamDomain: string;
  audience: string;
}

export interface AccessIdentity {
  subject: string;
  email?: string;
}

export type AccessTokenVerifier = (
  token: string,
  config: AccessConfig,
) => Promise<AccessIdentity>;

function normalizeTeamDomain(value: string): string | undefined {
  if (value.includes('CHANGE_ME')) return undefined;

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || !url.hostname.endsWith('.cloudflareaccess.com')
      || Boolean(url.username)
      || Boolean(url.password)
      || Boolean(url.port)
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function getAccessConfig(env: Pick<Env, 'TEAM_DOMAIN' | 'POLICY_AUD'>): AccessConfig | undefined {
  const teamDomain = normalizeTeamDomain(env.TEAM_DOMAIN);
  const audience = env.POLICY_AUD.trim();
  if (!teamDomain || !audience || audience === 'CHANGE_ME') return undefined;
  return { teamDomain, audience };
}

export async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  getKey?: JWTVerifyGetKey,
): Promise<AccessIdentity> {
  const jwks = getKey ?? createRemoteJWKSet(
    new URL('/cdn-cgi/access/certs', config.teamDomain),
    {
      timeoutDuration: 3_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1_000,
    },
  );

  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.teamDomain,
    audience: config.audience,
    algorithms: ['RS256'],
    clockTolerance: 5,
  });

  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) throw new Error('Access JWT is missing a subject.');

  const email = typeof payload.email === 'string' && payload.email.trim()
    ? payload.email.trim().toLowerCase()
    : undefined;
  return { subject, email };
}
