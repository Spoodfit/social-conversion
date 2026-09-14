export type PlanningPlatform = 'instagram' | 'youtube' | 'tiktok';
export type PublicationFieldKind = 'text' | 'textarea' | 'select' | 'toggle' | 'tags' | 'number';

export type PublicationFieldOption = { value: string; label: string };
export type PublicationFieldDefinition = {
  key: string;
  label: string;
  kind: PublicationFieldKind;
  help?: string;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: PublicationFieldOption[];
  requiredToPlan?: boolean;
  requiredToPublish?: boolean;
};

export type PublicationFormatDefinition = {
  id: string;
  label: string;
  mediaHint: string;
  fields: PublicationFieldDefinition[];
};

export type PublicationPlatformDefinition = {
  platform: PlanningPlatform;
  label: string;
  formats: PublicationFormatDefinition[];
};

const visibilityOptions: PublicationFieldOption[] = [
  { value: 'private', label: 'Privée' },
  { value: 'unlisted', label: 'Non répertoriée' },
  { value: 'public', label: 'Publique' },
];

const tiktokPrivacyOptions: PublicationFieldOption[] = [
  { value: '', label: 'À choisir avant publication' },
  { value: 'PUBLIC_TO_EVERYONE', label: 'Tout le monde' },
  { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Amis mutuels' },
  { value: 'FOLLOWER_OF_CREATOR', label: 'Abonnés' },
  { value: 'SELF_ONLY', label: 'Moi uniquement' },
];

export const publicationPlatformSchemas: Record<PlanningPlatform, PublicationPlatformDefinition> = {
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    formats: [
      {
        id: 'post',
        label: 'Post',
        mediaHint: 'Image recommandée. La publication peut être préparée avant connexion du compte.',
        fields: [
          { key: 'caption', label: 'Légende', kind: 'textarea', maxLength: 2200, placeholder: 'Votre légende Instagram…' },
          { key: 'altText', label: 'Texte alternatif', kind: 'textarea', maxLength: 1000, help: 'Accessibilité de l’image.' },
          { key: 'location', label: 'Lieu', kind: 'text', maxLength: 180, placeholder: 'Ex. Carcassonne' },
        ],
      },
      {
        id: 'carousel',
        label: 'Carrousel',
        mediaHint: 'Plusieurs images/vidéos. La légende s’applique au carrousel.',
        fields: [
          { key: 'caption', label: 'Légende', kind: 'textarea', maxLength: 2200, placeholder: 'Votre légende Instagram…' },
          { key: 'altText', label: 'Texte alternatif', kind: 'textarea', maxLength: 1000, help: 'Texte alternatif global de préparation.' },
          { key: 'location', label: 'Lieu', kind: 'text', maxLength: 180 },
        ],
      },
      {
        id: 'reel',
        label: 'Reel',
        mediaHint: 'Vidéo verticale recommandée.',
        fields: [
          { key: 'caption', label: 'Légende', kind: 'textarea', maxLength: 2200, placeholder: 'Votre légende du Reel…' },
          { key: 'shareToFeed', label: 'Partager aussi dans le fil', kind: 'toggle' },
        ],
      },
      {
        id: 'story',
        label: 'Story',
        mediaHint: 'Image ou vidéo verticale. Les stickers interactifs restent à finaliser dans Instagram.',
        fields: [
          { key: 'note', label: 'Note de préparation', kind: 'textarea', maxLength: 1000, help: 'Mémo interne, non publié automatiquement.' },
        ],
      },
    ],
  },
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    formats: [
      {
        id: 'video',
        label: 'Vidéo',
        mediaHint: 'Fichier vidéo requis pour la publication automatique.',
        fields: [
          { key: 'title', label: 'Titre', kind: 'text', maxLength: 100, requiredToPlan: true, requiredToPublish: true, placeholder: 'Titre de la vidéo' },
          { key: 'description', label: 'Description', kind: 'textarea', maxLength: 5000, placeholder: 'Description YouTube…' },
          { key: 'tags', label: 'Tags', kind: 'tags', help: 'Séparez les tags par des virgules.' },
          { key: 'categoryId', label: 'Catégorie', kind: 'text', maxLength: 10, placeholder: 'Ex. 22' },
          { key: 'privacyStatus', label: 'Visibilité', kind: 'select', options: visibilityOptions, requiredToPlan: true, requiredToPublish: true },
          { key: 'madeForKids', label: 'Contenu destiné aux enfants', kind: 'toggle' },
          { key: 'containsSyntheticMedia', label: 'Contient du média synthétique réaliste', kind: 'toggle' },
          { key: 'embeddable', label: 'Autoriser l’intégration sur d’autres sites', kind: 'toggle' },
        ],
      },
      {
        id: 'short',
        label: 'Short',
        mediaHint: 'Vidéo verticale courte. YouTube utilise les mêmes métadonnées vidéo.',
        fields: [
          { key: 'title', label: 'Titre', kind: 'text', maxLength: 100, requiredToPlan: true, requiredToPublish: true, placeholder: 'Titre du Short' },
          { key: 'description', label: 'Description', kind: 'textarea', maxLength: 5000 },
          { key: 'tags', label: 'Tags', kind: 'tags' },
          { key: 'privacyStatus', label: 'Visibilité', kind: 'select', options: visibilityOptions, requiredToPlan: true, requiredToPublish: true },
          { key: 'madeForKids', label: 'Contenu destiné aux enfants', kind: 'toggle' },
          { key: 'containsSyntheticMedia', label: 'Contient du média synthétique réaliste', kind: 'toggle' },
        ],
      },
    ],
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    formats: [
      {
        id: 'video',
        label: 'Vidéo',
        mediaHint: 'Vidéo requise. Les paramètres de confidentialité seront revalidés avec le compte lors de la connexion.',
        fields: [
          { key: 'title', label: 'Légende', kind: 'textarea', maxLength: 2200, placeholder: 'Légende, hashtags et mentions…' },
          { key: 'privacyLevel', label: 'Confidentialité', kind: 'select', options: tiktokPrivacyOptions, requiredToPublish: true, help: 'TikTok exige un choix manuel avant publication.' },
          { key: 'allowComments', label: 'Autoriser les commentaires', kind: 'toggle' },
          { key: 'allowDuet', label: 'Autoriser Duet', kind: 'toggle' },
          { key: 'allowStitch', label: 'Autoriser Stitch', kind: 'toggle' },
          { key: 'coverTimestampMs', label: 'Image de couverture à', kind: 'number', min: 0, step: 1000, help: 'Position dans la vidéo en millisecondes.' },
        ],
      },
      {
        id: 'photo',
        label: 'Photos',
        mediaHint: 'Une ou plusieurs photos.',
        fields: [
          { key: 'title', label: 'Titre', kind: 'text', maxLength: 90 },
          { key: 'description', label: 'Description', kind: 'textarea', maxLength: 4000 },
          { key: 'privacyLevel', label: 'Confidentialité', kind: 'select', options: tiktokPrivacyOptions, requiredToPublish: true },
          { key: 'allowComments', label: 'Autoriser les commentaires', kind: 'toggle' },
          { key: 'autoAddMusic', label: 'Ajouter automatiquement une musique recommandée', kind: 'toggle' },
          { key: 'brandContent', label: 'Contenu de marque / partenariat rémunéré', kind: 'toggle' },
        ],
      },
    ],
  },
};

export function isPlanningPlatform(value: unknown): value is PlanningPlatform {
  return value === 'instagram' || value === 'youtube' || value === 'tiktok';
}

export function defaultPublicationFormat(platform: PlanningPlatform): string {
  return publicationPlatformSchemas[platform].formats[0]?.id ?? 'post';
}

export function getPublicationFormat(platform: PlanningPlatform, format: string | undefined): PublicationFormatDefinition {
  const schema = publicationPlatformSchemas[platform];
  return schema.formats.find((candidate) => candidate.id === format) ?? schema.formats[0]!;
}

export function defaultPublicationFields(platform: PlanningPlatform, format?: string): Record<string, unknown> {
  const resolved = getPublicationFormat(platform, format);
  const result: Record<string, unknown> = {};
  for (const field of resolved.fields) {
    if (field.kind === 'toggle') result[field.key] = false;
    if (field.kind === 'select' && field.options?.length && platform === 'youtube') {
      result[field.key] = field.key === 'privacyStatus' ? 'private' : field.options[0]?.value ?? '';
    }
  }
  if (platform === 'instagram' && resolved.id === 'reel') result.shareToFeed = true;
  if (platform === 'youtube') result.embeddable = true;
  return result;
}

export function normalizePublicationFields(
  platform: PlanningPlatform,
  format: string,
  raw: unknown,
): Record<string, unknown> {
  const definition = getPublicationFormat(platform, format);
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const normalized: Record<string, unknown> = { ...defaultPublicationFields(platform, definition.id) };

  for (const field of definition.fields) {
    const value = input[field.key];
    if (field.kind === 'toggle') {
      if (typeof value === 'boolean') normalized[field.key] = value;
      continue;
    }
    if (field.kind === 'number') {
      if (value === '' || value === undefined || value === null) continue;
      const number = Number(value);
      if (Number.isFinite(number)) {
        normalized[field.key] = Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, number));
      }
      continue;
    }
    if (field.kind === 'tags') {
      const list = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
        : typeof value === 'string'
          ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
          : [];
      normalized[field.key] = list.slice(0, 100);
      continue;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    if (field.maxLength && text.length > field.maxLength) {
      normalized[field.key] = text.slice(0, field.maxLength);
    } else {
      normalized[field.key] = text;
    }
  }
  return normalized;
}

export function missingRequiredPlanningFields(platform: PlanningPlatform, format: string, fields: Record<string, unknown>): string[] {
  const definition = getPublicationFormat(platform, format);
  return definition.fields
    .filter((field) => field.requiredToPlan)
    .filter((field) => {
      const value = fields[field.key];
      return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    })
    .map((field) => field.label);
}

export function publicationPreviewText(platform: PlanningPlatform, fields: Record<string, unknown>): string {
  const keys = platform === 'youtube' ? ['title', 'description'] : platform === 'tiktok' ? ['title', 'description'] : ['caption', 'note'];
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
