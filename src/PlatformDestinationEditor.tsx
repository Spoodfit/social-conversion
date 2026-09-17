import { Camera, Check, Music2, Plus, Video } from 'lucide-react';
import {
  defaultPublicationFields,
  defaultPublicationFormat,
  getPublicationFormat,
  publicationPlatformSchemas,
  type PlanningPlatform,
  type PublicationFieldDefinition,
} from './shared/social-publication-fields';

export type PlannerConnection = {
  id: string;
  platform: PlanningPlatform;
  displayName: string;
  handle?: string;
  status: string;
};

export type DestinationDraft = {
  key: string;
  platform: PlanningPlatform;
  connectionId?: string;
  accountLabel: string;
  accountHandle?: string;
  format: string;
  fields: Record<string, unknown>;
};

export function connectionDestinationKey(id: string) {
  return `connection:${id}`;
}

export function plannedDestinationKey(platform: PlanningPlatform) {
  return `planned:${platform}`;
}

export function makeDestinationDraft(
  platform: PlanningPlatform,
  options: { connectionId?: string; accountLabel?: string; accountHandle?: string; format?: string; fields?: Record<string, unknown> } = {},
): DestinationDraft {
  const format = getPublicationFormat(platform, options.format ?? defaultPublicationFormat(platform)).id;
  const key = options.connectionId ? connectionDestinationKey(options.connectionId) : plannedDestinationKey(platform);
  return {
    key,
    platform,
    connectionId: options.connectionId,
    accountLabel: options.accountLabel || `${publicationPlatformSchemas[platform].label} · à connecter`,
    accountHandle: options.accountHandle,
    format,
    fields: { ...defaultPublicationFields(platform, format), ...(options.fields ?? {}) },
  };
}

export function destinationPayload(
  connections: PlannerConnection[],
  selectedConnectionIds: string[],
  plannedPlatforms: PlanningPlatform[],
  drafts: Record<string, DestinationDraft>,
) {
  const destinations: Array<{
    platform: PlanningPlatform;
    connectionId?: string;
    accountLabel: string;
    accountHandle?: string;
    format: string;
    fields: Record<string, unknown>;
  }> = [];
  for (const id of selectedConnectionIds) {
    const connection = connections.find((candidate) => candidate.id === id);
    if (!connection) continue;
    const key = connectionDestinationKey(id);
    const draft = drafts[key] ?? makeDestinationDraft(connection.platform, {
      connectionId: id,
      accountLabel: connection.displayName,
      accountHandle: connection.handle,
    });
    destinations.push({
      platform: connection.platform,
      connectionId: id,
      accountLabel: connection.displayName,
      accountHandle: connection.handle,
      format: draft.format,
      fields: draft.fields,
    });
  }
  for (const platform of plannedPlatforms) {
    const key = plannedDestinationKey(platform);
    const draft = drafts[key] ?? makeDestinationDraft(platform);
    destinations.push({
      platform,
      accountLabel: draft.accountLabel,
      accountHandle: draft.accountHandle,
      format: draft.format,
      fields: draft.fields,
    });
  }
  return destinations;
}

function PlatformIcon({ platform }: { platform: PlanningPlatform }) {
  if (platform === 'instagram') return <Camera size={15} />;
  if (platform === 'youtube') return <Video size={15} />;
  return <Music2 size={15} />;
}

function renderField(
  definition: PublicationFieldDefinition,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  const id = `publication-field-${definition.key}`;
  if (definition.kind === 'toggle') {
    return (
      <label className="sc4-toggle" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span><strong>{definition.label}</strong>{definition.help && <small>{definition.help}</small>}</span>
      </label>
    );
  }
  if (definition.kind === 'select') {
    return (
      <label className="sc4-field" htmlFor={id}>
        <span>{definition.label}{definition.requiredToPlan && <b>Requis</b>}{!definition.requiredToPlan && definition.requiredToPublish && <b className="later">Avant publication</b>}</span>
        <select id={id} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
          {(definition.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {definition.help && <small>{definition.help}</small>}
      </label>
    );
  }
  if (definition.kind === 'textarea') {
    return (
      <label className="sc4-field" htmlFor={id}>
        <span>{definition.label}{definition.requiredToPlan && <b>Requis</b>}{!definition.requiredToPlan && definition.requiredToPublish && <b className="later">Avant publication</b>}</span>
        <textarea id={id} value={typeof value === 'string' ? value : ''} placeholder={definition.placeholder} maxLength={definition.maxLength} onChange={(event) => onChange(event.target.value)} />
        <small>{definition.help || (definition.maxLength ? `${String(value ?? '').length}/${definition.maxLength}` : '')}</small>
      </label>
    );
  }
  if (definition.kind === 'number') {
    return (
      <label className="sc4-field" htmlFor={id}>
        <span>{definition.label}</span>
        <input id={id} type="number" value={typeof value === 'number' || typeof value === 'string' ? value : ''} min={definition.min} max={definition.max} step={definition.step} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
        {definition.help && <small>{definition.help}</small>}
      </label>
    );
  }
  const rendered = definition.kind === 'tags' && Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  return (
    <label className="sc4-field" htmlFor={id}>
      <span>{definition.label}{definition.requiredToPlan && <b>Requis</b>}{!definition.requiredToPlan && definition.requiredToPublish && <b className="later">Avant publication</b>}</span>
      <input id={id} type="text" value={rendered} placeholder={definition.placeholder} maxLength={definition.maxLength} onChange={(event) => onChange(definition.kind === 'tags' ? event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) : event.target.value)} />
      {definition.help && <small>{definition.help}</small>}
    </label>
  );
}

export default function PlatformDestinationEditor({
  connections,
  selectedConnectionIds,
  plannedPlatforms,
  drafts,
  onToggleConnection,
  onTogglePlanned,
  onDraft,
}: {
  connections: PlannerConnection[];
  selectedConnectionIds: string[];
  plannedPlatforms: PlanningPlatform[];
  drafts: Record<string, DestinationDraft>;
  onToggleConnection: (id: string) => void;
  onTogglePlanned: (platform: PlanningPlatform) => void;
  onDraft: (key: string, draft: DestinationDraft) => void;
}) {
  const selected: DestinationDraft[] = [];
  for (const id of selectedConnectionIds) {
    const connection = connections.find((candidate) => candidate.id === id);
    if (!connection) continue;
    const key = connectionDestinationKey(id);
    selected.push(drafts[key] ?? makeDestinationDraft(connection.platform, {
      connectionId: connection.id,
      accountLabel: connection.displayName,
      accountHandle: connection.handle,
    }));
  }
  for (const platform of plannedPlatforms) {
    const key = plannedDestinationKey(platform);
    selected.push(drafts[key] ?? makeDestinationDraft(platform));
  }

  return (
    <section className="sc4-destinations">
      <header>
        <div><strong>Où publier ?</strong><small>Un compte n’a pas besoin d’être connecté pour préparer son contenu.</small></div>
      </header>

      {connections.length > 0 && (
        <div className="sc4-destination-group">
          <span>Comptes connus</span>
          <div className="sc4-target-buttons">
            {connections.map((connection) => {
              const active = selectedConnectionIds.includes(connection.id);
              return (
                <button key={connection.id} className={active ? 'active' : ''} onClick={() => onToggleConnection(connection.id)}>
                  <i><PlatformIcon platform={connection.platform} /></i>
                  <span><strong>{connection.displayName}</strong><small>{connection.handle || publicationPlatformSchemas[connection.platform].label} · {connection.status === 'connected' ? 'connecté' : 'connexion à terminer'}</small></span>
                  {active && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="sc4-destination-group">
        <span>Planifier sans compte connecté</span>
        <div className="sc4-target-buttons compact">
          {(Object.keys(publicationPlatformSchemas) as PlanningPlatform[]).map((platform) => {
            const active = plannedPlatforms.includes(platform);
            const schema = publicationPlatformSchemas[platform];
            return (
              <button key={platform} className={active ? 'active planned' : 'planned'} onClick={() => onTogglePlanned(platform)}>
                <i><PlatformIcon platform={platform} /></i>
                <span><strong>{schema.label}</strong><small>À connecter plus tard</small></span>
                {active ? <Check size={14} /> : <Plus size={14} />}
              </button>
            );
          })}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="sc4-network-forms">
          {selected.map((draft) => {
            const schema = publicationPlatformSchemas[draft.platform];
            const formatDefinition = getPublicationFormat(draft.platform, draft.format);
            const isConnected = Boolean(draft.connectionId && connections.find((candidate) => candidate.id === draft.connectionId)?.status === 'connected');
            return (
              <article key={draft.key} className="sc4-network-card">
                <header>
                  <i><PlatformIcon platform={draft.platform} /></i>
                  <div><strong>{draft.accountLabel}</strong><small>{schema.label} · {isConnected ? 'prêt côté compte' : 'préparation uniquement'}</small></div>
                  <span className={isConnected ? 'ready' : ''}>{isConnected ? 'Connecté' : 'À connecter'}</span>
                </header>
                {!draft.connectionId && (
                  <label className="sc4-field inline">
                    <span>Nom du compte prévu</span>
                    <input value={draft.accountLabel} onChange={(event) => onDraft(draft.key, { ...draft, accountLabel: event.target.value })} placeholder={`${schema.label} Neptune`} />
                  </label>
                )}
                <label className="sc4-field inline">
                  <span>Format</span>
                  <select value={draft.format} onChange={(event) => {
                    const format = event.target.value;
                    onDraft(draft.key, { ...draft, format, fields: defaultPublicationFields(draft.platform, format) });
                  }}>
                    {schema.formats.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
                  </select>
                  <small>{formatDefinition.mediaHint}</small>
                </label>
                <div className="sc4-fields-grid">
                  {formatDefinition.fields.map((field) => (
                    <div key={field.key} className={field.kind === 'textarea' ? 'wide' : ''}>
                      {renderField(field, draft.fields[field.key], (value) => onDraft(draft.key, { ...draft, fields: { ...draft.fields, [field.key]: value } }))}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
