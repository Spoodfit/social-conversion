import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc10-copy-assistant')) {
  console.log('Social copy assistant already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Social copy assistant patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

replaceOnce(
`  function openCreate(dateKey?: string, minutes?: number) {`,
`  async function generateSocialCopySuggestion(input: {
    objective: 'engagement' | 'conversion';
    platform: PlanningPlatform;
    format: string;
    fields: Record<string, unknown>;
    mediaTitle?: string;
    mediaCaption?: string;
  }) {
    if (!workspaceId) throw new Error('Espace de travail indisponible.');
    return apiRequest<{
      objective: 'engagement' | 'conversion';
      platform: PlanningPlatform;
      format: string;
      model: string;
      fields: Record<string, string | string[]>;
    }>('/api/ai/social-copy', {
      method: 'POST',
      body: JSON.stringify(input),
    }, workspaceId);
  }

  function openCreate(dateKey?: string, minutes?: number) {`,
'parent AI generator',
);

replaceOnce(
`              deliveryReady={Boolean(runtime.contentPublishingReady)}
              onBody={setPublishBody}`,
`              deliveryReady={Boolean(runtime.contentPublishingReady)}
              aiReady={Boolean(runtime.aiReady)}
              onGenerateCopy={generateSocialCopySuggestion}
              onBody={setPublishBody}`,
'create AI props',
);

replaceOnce(
`function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`,
`function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, aiReady, onGenerateCopy, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`,
'CreatePage AI signature',
);

replaceOnce(
`  deliveryReady: boolean;
  onBody: (value: string) => void;`,
`  deliveryReady: boolean;
  aiReady: boolean;
  onGenerateCopy: (input: {
    objective: 'engagement' | 'conversion';
    platform: PlanningPlatform;
    format: string;
    fields: Record<string, unknown>;
    mediaTitle?: string;
    mediaCaption?: string;
  }) => Promise<{ fields: Record<string, string | string[]> }>;
  onBody: (value: string) => void;`,
'CreatePage AI types',
);

replaceOnce(
`  const [guidedStep, setGuidedStep] = useState<'media' | 'networks' | 'details'>('media');`,
`  const [guidedStep, setGuidedStep] = useState<'media' | 'networks' | 'details'>('media');
  const [writerObjective, setWriterObjective] = useState<'engagement' | 'conversion'>('engagement');
  const [writerBusy, setWriterBusy] = useState(false);
  const [writerError, setWriterError] = useState('');`,
'writer state',
);

replaceOnce(
`  function openDeliveryOptions() {
    setDeliveryOpen(true);
    window.setTimeout(() => document.getElementById('sc8-delivery-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  }`,
`  function openDeliveryOptions() {
    setDeliveryOpen(true);
    window.setTimeout(() => document.getElementById('sc8-delivery-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  }

  const writerKey = activePreviewDestination
    ? activePreviewDestination.connectionId
      ? connectionDestinationKey(activePreviewDestination.connectionId)
      : plannedDestinationKey(activePreviewDestination.platform)
    : undefined;
  const writerDraft = writerKey && activePreviewDestination
    ? destinationDrafts[writerKey] ?? makeDestinationDraft(activePreviewDestination.platform, {
        connectionId: activePreviewDestination.connectionId,
        accountLabel: activePreviewDestination.accountLabel,
        accountHandle: activePreviewDestination.accountHandle,
        format: activePreviewDestination.format,
        fields: activePreviewDestination.fields,
      })
    : undefined;
  const writerSupported = Boolean(writerDraft && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));

  async function runCopyWriter() {
    if (!writerDraft || !selectedMedia || writerBusy || !writerSupported) return;
    if (!aiReady) {
      setWriterError('L’assistant IA n’est pas configuré sur cet environnement.');
      return;
    }
    setWriterBusy(true);
    setWriterError('');
    try {
      const result = await onGenerateCopy({
        objective: writerObjective,
        platform: writerDraft.platform,
        format: writerDraft.format,
        fields: writerDraft.fields,
        mediaTitle: selectedMedia.title,
        mediaCaption: selectedMedia.caption,
      });
      onDestinationDraft(writerDraft.key, {
        ...writerDraft,
        fields: { ...writerDraft.fields, ...result.fields },
      });
    } catch (error) {
      setWriterError(readableError(error));
    } finally {
      setWriterBusy(false);
    }
  }`,
'writer helper',
);

replaceOnce(
`            {activePreviewDestination && <div className="sc9-active-network"><PlatformMark platform={activePreviewDestination.platform} size={17} /><span><strong>{activePreviewDestination.accountLabel}</strong><small>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.format}</small></span></div>}
            <div className="sc9-fields">`,
`            {activePreviewDestination && <div className="sc9-active-network"><PlatformMark platform={activePreviewDestination.platform} size={17} /><span><strong>{activePreviewDestination.accountLabel}</strong><small>{platformLabel(activePreviewDestination.platform)} · {activePreviewDestination.format}</small></span></div>}
            {writerSupported && (
              <section className="sc10-copy-assistant">
                <header><span className="sc10-copy-icon"><Sparkles size={16} /></span><span><strong>Assistant rédaction</strong><small>Choisissez l’objectif, l’IA remplit les textes de ce réseau.</small></span></header>
                <div className="sc10-objectives">
                  <button type="button" className={writerObjective === 'engagement' ? 'active' : ''} onClick={() => setWriterObjective('engagement')}><span>💬</span><span><strong>Engagement / abonnés</strong><small>Accroche, interactions, envie de suivre</small></span>{writerObjective === 'engagement' && <Check size={15} />}</button>
                  <button type="button" className={writerObjective === 'conversion' ? 'active' : ''} onClick={() => setWriterObjective('conversion')}><span>🎯</span><span><strong>Conversions</strong><small>Valeur claire et appel à l’action</small></span>{writerObjective === 'conversion' && <Check size={15} />}</button>
                </div>
                <button type="button" className="sc10-generate" disabled={writerBusy || !aiReady} onClick={() => void runCopyWriter()}>{writerBusy ? <LoaderCircle className="sc3-spin" size={15} /> : <Sparkles size={15} />} {writerBusy ? 'Rédaction en cours…' : 'Générer et remplir les textes'}</button>
                {!aiReady && <small className="sc10-copy-note">L’assistant sera disponible dès que la connexion IA est active.</small>}
                {writerError && <small className="sc10-copy-error">{writerError}</small>}
              </section>
            )}
            <div className="sc9-fields">`,
'writer UI before editorial fields',
);

fs.writeFileSync(path, source);
console.log('Guided social copy assistant applied.');
