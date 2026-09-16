import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Unified social writer patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

// Worker route: prefer free Workers AI, keep OpenAI only as an optional fallback.
const cockpitPath = 'src/worker/cockpit-production.ts';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');
if (!cockpit.includes('SC_WORKERS_AI_SOCIAL_COPY_ROUTE_V1')) {
  cockpit = replaceOnce(
    cockpit,
    `import { generateSocialCopy, SocialCopyError } from './social-copy-writer';`,
    `import { generateSocialCopy, SocialCopyError } from './social-copy-writer';\nimport { generateWorkersAiSocialCopy, workersAiSocialCopyReady } from './workers-ai-social-copy';`,
    'Workers AI social writer import',
  );
  cockpit = replaceOnce(
    cockpit,
    `    const result = await generateSocialCopy(env, body);`,
    `    const result = workersAiSocialCopyReady(env)\n      ? await generateWorkersAiSocialCopy(env, body)\n      : await generateSocialCopy(env, body);`,
    'prefer Workers AI for social copy',
  );
  cockpit += '\n// SC_WORKERS_AI_SOCIAL_COPY_ROUTE_V1\n';
  fs.writeFileSync(cockpitPath, cockpit);
}

// UI: same assistant for creation and modification, even when there is no media.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_UNIFIED_PUBLICATION_AI_UX_V1')) {
  if (!app.includes('async function generateSocialCopySuggestion(')) {
    app = replaceOnce(
      app,
      `  function openCreate(dateKey?: string, minutes?: number) {`,
      `  async function generateSocialCopySuggestion(input: {\n    objective: 'engagement' | 'conversion';\n    platform: PlanningPlatform;\n    format: string;\n    fields: Record<string, unknown>;\n    mediaTitle?: string;\n    mediaCaption?: string;\n  }) {\n    if (!workspaceId) throw new Error('Espace de travail indisponible.');\n    return apiRequest<{\n      objective: 'engagement' | 'conversion';\n      platform: PlanningPlatform;\n      format: string;\n      model: string;\n      fields: Record<string, string | string[]>;\n    }>('/api/ai/social-copy', {\n      method: 'POST',\n      body: JSON.stringify(input),\n    }, workspaceId);\n  }\n\n  function openCreate(dateKey?: string, minutes?: number) {`,
      'restore parent AI generator after later UI patches',
    );
  }

  app = app.replace(
    `const writerSupported = Boolean(writerDraft && writerDraft.platform !== 'facebook' && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));`,
    `const writerSupported = Boolean(writerDraft && !(writerDraft.platform === 'instagram' && writerDraft.format === 'story'));`,
  );
  app = app.replace(
    `if (!writerDraft || !selectedMedia || writerBusy || !writerSupported) return;`,
    `if (!writerDraft || writerBusy || !writerSupported) return;`,
  );
  app = app.replace(
    `        mediaTitle: selectedMedia.title,\n        mediaCaption: selectedMedia.caption,`,
    `        mediaTitle: selectedMedia?.title,\n        mediaCaption: selectedMedia?.caption,`,
  );
  app = app.replaceAll('Générer et remplir les textes', 'Générer ou améliorer les textes');
  if (!app.includes(`if (!writerDraft || writerBusy || !writerSupported) return;`)) {
    throw new Error('Unified social writer patch failed: media is still mandatory for AI writing.');
  }
  if (!app.includes('async function generateSocialCopySuggestion(')) {
    throw new Error('Unified social writer patch failed: parent AI generator is missing.');
  }
  if (!app.includes('Générer ou améliorer les textes')) {
    throw new Error('Unified social writer patch failed: final AI copy label missing.');
  }
  app += '\n/* SC_UNIFIED_PUBLICATION_AI_UX_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Free Workers AI publication writer is shared by create and edit flows.');
