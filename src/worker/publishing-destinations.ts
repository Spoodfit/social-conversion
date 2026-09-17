import {
  defaultPublicationFormat,
  getPublicationFormat,
  isPlanningPlatform,
  missingRequiredPlanningFields,
  normalizePublicationFields,
  publicationPreviewText,
  type PlanningPlatform,
} from '../shared/social-publication-fields';

export class DestinationValidationError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'connection_not_found' = 'invalid') {
    super(message);
    this.name = 'DestinationValidationError';
  }
}

type ConnectionRow = {
  id: string;
  platform: PlanningPlatform;
  display_name: string;
  handle: string | null;
  status: string;
};

export type ResolvedPublicationDestination = {
  id: string;
  connectionId?: string;
  platform: PlanningPlatform;
  accountLabel: string;
  accountHandle?: string;
  format: string;
  fields: Record<string, unknown>;
  status: 'planned' | 'ready';
  connectionStatus?: string;
};

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0).map((candidate) => candidate.trim()))]
    : [];
}

async function loadConnections(db: D1Database, workspaceId: string, ids: string[]): Promise<Map<string, ConnectionRow>> {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT id, platform, display_name, handle, status
     FROM social_connections
     WHERE workspace_id = ? AND id IN (${placeholders})`,
  ).bind(workspaceId, ...ids).all<ConnectionRow>();
  if (result.results.length !== ids.length) {
    throw new DestinationValidationError('Un des comptes sélectionnés n’existe pas dans cet espace.', 'connection_not_found');
  }
  return new Map(result.results.map((connection) => [connection.id, connection]));
}

export async function resolvePublicationDestinations(
  db: D1Database,
  workspaceId: string,
  rawDestinations: unknown,
  legacyConnectionIds?: unknown,
): Promise<ResolvedPublicationDestination[]> {
  const provided = Array.isArray(rawDestinations) ? rawDestinations : [];
  const legacyIds = uniqueStrings(legacyConnectionIds);
  const requestedConnectionIds = [
    ...legacyIds,
    ...provided.flatMap((candidate) => candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).connectionId === 'string'
      ? [String((candidate as Record<string, unknown>).connectionId)]
      : []),
  ];
  const connectionMap = await loadConnections(db, workspaceId, [...new Set(requestedConnectionIds)]);

  const normalized: ResolvedPublicationDestination[] = [];
  if (!provided.length && legacyIds.length) {
    for (const connectionId of legacyIds) {
      const connection = connectionMap.get(connectionId)!;
      const format = defaultPublicationFormat(connection.platform);
      normalized.push({
        id: crypto.randomUUID(),
        connectionId,
        platform: connection.platform,
        accountLabel: connection.display_name,
        accountHandle: connection.handle ?? undefined,
        format,
        fields: normalizePublicationFields(connection.platform, format, {}),
        status: connection.status === 'connected' ? 'ready' : 'planned',
        connectionStatus: connection.status,
      });
    }
  }

  for (const raw of provided) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DestinationValidationError('Une destination de publication est invalide.');
    }
    const candidate = raw as Record<string, unknown>;
    const connectionId = typeof candidate.connectionId === 'string' && candidate.connectionId.trim() ? candidate.connectionId.trim() : undefined;
    const connection = connectionId ? connectionMap.get(connectionId) : undefined;
    const platformCandidate = connection?.platform ?? candidate.platform;
    if (!isPlanningPlatform(platformCandidate)) {
      throw new DestinationValidationError('Le réseau social choisi n’est pas pris en charge par le Planner.');
    }
    const platform = platformCandidate;
    if (connection && candidate.platform && candidate.platform !== connection.platform) {
      throw new DestinationValidationError('Le compte connecté ne correspond pas au réseau social sélectionné.');
    }

    const formatInput = typeof candidate.format === 'string' ? candidate.format : undefined;
    const format = getPublicationFormat(platform, formatInput).id;
    if (formatInput && format !== formatInput) {
      throw new DestinationValidationError(`Le format « ${formatInput} » n’est pas disponible pour ${platform}.`);
    }
    const fields = normalizePublicationFields(platform, format, candidate.fields);
    const missing = missingRequiredPlanningFields(platform, format, fields);
    if (missing.length) {
      throw new DestinationValidationError(`Complétez ${missing.join(', ')} pour cette destination.`);
    }
    const accountLabel = connection?.display_name
      ?? (typeof candidate.accountLabel === 'string' && candidate.accountLabel.trim() ? candidate.accountLabel.trim().slice(0, 180) : `${platform} · à connecter`);
    const accountHandle = connection?.handle
      ?? (typeof candidate.accountHandle === 'string' && candidate.accountHandle.trim() ? candidate.accountHandle.trim().slice(0, 180) : undefined);

    normalized.push({
      id: crypto.randomUUID(),
      connectionId,
      platform,
      accountLabel,
      accountHandle,
      format,
      fields,
      status: connection?.status === 'connected' ? 'ready' : 'planned',
      connectionStatus: connection?.status,
    });
  }

  const deduped = new Map<string, ResolvedPublicationDestination>();
  for (const destination of normalized) {
    const key = destination.connectionId ? `connection:${destination.connectionId}` : `planned:${destination.platform}:${destination.accountLabel.toLowerCase()}`;
    deduped.set(key, destination);
  }
  const result = [...deduped.values()];
  if (!result.length || result.length > 20) {
    throw new DestinationValidationError('Choisissez entre 1 et 20 destinations, connectées ou à connecter.');
  }
  return result;
}

export function destinationPreviewText(destinations: ResolvedPublicationDestination[]): string {
  for (const destination of destinations) {
    const text = publicationPreviewText(destination.platform, destination.fields);
    if (text) return text;
  }
  return '';
}

export function destinationInsertStatements(
  db: D1Database,
  workspaceId: string,
  postId: string,
  destinations: ResolvedPublicationDestination[],
  now: string,
): D1PreparedStatement[] {
  return destinations.map((destination) => db.prepare(
    `INSERT INTO content_post_destinations (
       id, workspace_id, post_id, connection_id, platform, account_label, account_handle,
       format, fields_json, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    destination.id,
    workspaceId,
    postId,
    destination.connectionId ?? null,
    destination.platform,
    destination.accountLabel,
    destination.accountHandle ?? null,
    destination.format,
    JSON.stringify(destination.fields),
    destination.status,
    now,
    now,
  ));
}

export function connectedLegacyTargetStatements(
  db: D1Database,
  workspaceId: string,
  postId: string,
  destinations: ResolvedPublicationDestination[],
  now: string,
): D1PreparedStatement[] {
  return destinations
    .filter((destination) => destination.connectionId && destination.connectionStatus === 'connected')
    .map((destination) => db.prepare(
      `INSERT INTO content_post_targets (
         id, workspace_id, post_id, connection_id, platform, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      workspaceId,
      postId,
      destination.connectionId!,
      destination.platform,
      now,
      now,
    ));
}
