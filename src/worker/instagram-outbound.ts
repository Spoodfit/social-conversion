import { loadOutboundDelivery, markOutboundFailed, markOutboundSent } from './outbox';
import { loadOAuthTokens, tokenKeyringSecret } from './token-vault';

export interface OutboundDeliveryEnvelope {
  kind: 'outbound_delivery';
  id: string;
  workspaceId: string;
}

export class InstagramDeliveryError extends Error {
  readonly code:
    | 'OUTBOUND_CONFIG_NOT_READY'
    | 'OUTBOUND_RECORD_UNAVAILABLE'
    | 'UNSUPPORTED_PLATFORM'
    | 'MISSING_CAPABILITY'
    | 'CONVERSATION_NOT_INITIATED'
    | 'OAUTH_NOT_FOUND'
    | 'OAUTH_SCOPE_MISSING'
    | 'OAUTH_EXPIRED'
    | 'META_RATE_LIMITED'
    | 'META_AUTH_FAILED'
    | 'META_REQUEST_REJECTED'
    | 'META_OUTCOME_UNKNOWN'
    | 'META_INVALID_RESPONSE';
  readonly retryAt?: string;

  constructor(code: InstagramDeliveryError['code'], message: string, retryAt?: string) {
    super(message);
    this.name = 'InstagramDeliveryError';
    this.code = code;
    this.retryAt = retryAt;
  }
}

const requiredScope = 'instagram_business_manage_messages';

function graphVersion(env: Env): string | undefined {
  const value = Reflect.get(env, 'META_GRAPH_VERSION');
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^v\d{1,3}\.\d{1,2}$/.test(normalized) ? normalized : undefined;
}

export function instagramOutboundConfigured(env: Env): boolean {
  return Boolean(graphVersion(env) && tokenKeyringSecret(env));
}

function capabilityEnabled(raw: string, key: string): boolean {
  try {
    const value = JSON.parse(raw) as unknown;
    return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>)[key] === true);
  } catch {
    return false;
  }
}

function retryTime(attemptCount: number, retryAfterHeader: string | null): string {
  const headerSeconds = retryAfterHeader && /^\d{1,6}$/.test(retryAfterHeader)
    ? Number(retryAfterHeader)
    : undefined;
  const exponentialSeconds = Math.min(3_600, 60 * (2 ** Math.max(0, Math.min(5, attemptCount - 1))));
  const seconds = Math.max(30, Math.min(3_600, headerSeconds ?? exponentialSeconds));
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function accessTokenExpired(accessExpiresAt?: string): boolean {
  if (!accessExpiresAt) return false;
  const expiresAt = Date.parse(accessExpiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + 5 * 60 * 1_000;
}

function parseMetaMessageId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const messageId = (payload as { message_id?: unknown }).message_id;
  return typeof messageId === 'string' && messageId.length > 0 && messageId.length <= 1_000
    ? messageId
    : undefined;
}

export async function deliverInstagramOutbound(
  db: D1Database,
  env: Env,
  envelope: OutboundDeliveryEnvelope,
  fetchImpl: typeof fetch = fetch,
): Promise<'sent' | 'failed' | 'skipped'> {
  const version = graphVersion(env);
  const keyring = tokenKeyringSecret(env);
  if (!version || !keyring) {
    throw new InstagramDeliveryError('OUTBOUND_CONFIG_NOT_READY', 'Instagram outbound configuration is incomplete.');
  }

  const delivery = await loadOutboundDelivery(db, envelope.id, envelope.workspaceId);
  if (!delivery) return 'skipped';

  let failure: InstagramDeliveryError | undefined;
  try {
    if (delivery.platform !== 'instagram') {
      throw new InstagramDeliveryError('UNSUPPORTED_PLATFORM', 'Only Instagram outbound is enabled in the current production pilot.');
    }
    if (!delivery.hasInbound) {
      throw new InstagramDeliveryError('CONVERSATION_NOT_INITIATED', 'Instagram outbound requires a conversation initiated by the recipient.');
    }
    if (!capabilityEnabled(delivery.capabilitiesJson, 'direct_messages')) {
      throw new InstagramDeliveryError('MISSING_CAPABILITY', 'This Instagram connection has not validated direct message capability.');
    }

    const tokens = await loadOAuthTokens(db, keyring, delivery.workspaceId, delivery.connectionId);
    if (!tokens || tokens.credentials.provider !== 'instagram') {
      throw new InstagramDeliveryError('OAUTH_NOT_FOUND', 'No active Instagram OAuth credential is available for this connection.');
    }
    if (!tokens.credentials.scopes.includes(requiredScope)) {
      throw new InstagramDeliveryError('OAUTH_SCOPE_MISSING', `Instagram OAuth credential is missing ${requiredScope}.`);
    }
    if (accessTokenExpired(tokens.credentials.accessExpiresAt)) {
      throw new InstagramDeliveryError('OAUTH_EXPIRED', 'Instagram OAuth token is expired or too close to expiry for a safe send.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetchImpl(
        `https://graph.instagram.com/${version}/${encodeURIComponent(delivery.providerAccountId)}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tokens.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            recipient: { id: delivery.recipientExternalId },
            message: { text: delivery.body },
          }),
          signal: controller.signal,
        },
      );
    } catch {
      throw new InstagramDeliveryError(
        'META_OUTCOME_UNKNOWN',
        'Instagram delivery outcome is unknown after a network or timeout failure; automatic retry is disabled to prevent duplicate messages.',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new InstagramDeliveryError(
        'META_RATE_LIMITED',
        'Instagram rate limited the outbound request.',
        retryTime(delivery.attemptCount, response.headers.get('retry-after')),
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new InstagramDeliveryError('META_AUTH_FAILED', 'Instagram rejected the OAuth credential or permission set.');
    }
    if (response.status >= 500) {
      throw new InstagramDeliveryError(
        'META_OUTCOME_UNKNOWN',
        'Instagram returned a server error with an uncertain delivery outcome; automatic retry is disabled to prevent duplicates.',
      );
    }
    if (!response.ok) {
      throw new InstagramDeliveryError('META_REQUEST_REJECTED', `Instagram rejected the outbound request with HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InstagramDeliveryError('META_INVALID_RESPONSE', 'Instagram returned a successful status without valid JSON.');
    }
    const providerMessageId = parseMetaMessageId(payload);
    if (!providerMessageId) {
      throw new InstagramDeliveryError('META_INVALID_RESPONSE', 'Instagram did not return a message_id for the outbound request.');
    }

    const marked = await markOutboundSent(db, {
      id: delivery.id,
      workspaceId: delivery.workspaceId,
      providerMessageId,
    });
    if (!marked) return 'skipped';
    return 'sent';
  } catch (error) {
    failure = error instanceof InstagramDeliveryError
      ? error
      : new InstagramDeliveryError('OUTBOUND_CONFIG_NOT_READY', 'Instagram outbound failed before a safe provider request could be completed.');
  }

  await markOutboundFailed(db, {
    id: delivery.id,
    workspaceId: delivery.workspaceId,
    errorCode: failure.code,
    retryAt: failure.retryAt,
  });
  console.warn(JSON.stringify({
    event: 'instagram_outbound_failed',
    workspaceId: delivery.workspaceId,
    connectionId: delivery.connectionId,
    outboxId: delivery.id,
    code: failure.code,
    retryScheduled: Boolean(failure.retryAt),
  }));
  return 'failed';
}
