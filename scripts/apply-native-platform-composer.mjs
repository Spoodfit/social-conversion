import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');

if (app.includes('SC_NATIVE_PLATFORM_COMPOSER_V2')) {
  console.log('Native platform composer already applied.');
  await import('./apply-startup-performance.mjs');
  process.exit(0);
}

const importAnchor = `import { ApiError, apiRequest } from './api/client';`;
if (!app.includes(importAnchor)) throw new Error('Native platform composer patch failed: API import anchor not found.');
app = app.replace(importAnchor, `${importAnchor}\nimport NativePlatformComposer from './NativePlatformComposer';`);

const legacyAnchor = '            {activePreviewDestination && <div className={`sc17-network-context';
if (!app.includes(legacyAnchor)) {
  throw new Error('Native platform composer patch failed: generated step-3 network context anchor not found.');
}

const nativeComposer = `            {writerDraft && (\n              <NativePlatformComposer\n                draft={writerDraft}\n                media={selectedMedia ? {\n                  mimeType: selectedMedia.mimeType,\n                  previewUrl: selectedMedia.previewUrl,\n                  title: selectedMedia.title,\n                  format: selectedMedia.format,\n                } : undefined}\n                fallbackText={body || selectedMedia?.caption || ''}\n                aiReady={aiReady}\n                writerObjective={writerObjective}\n                writerBusy={writerBusy}\n                writerError={writerError}\n                onWriterObjective={setWriterObjective}\n                onGenerate={() => void runCopyWriter()}\n                onDraft={onDestinationDraft}\n              />\n            )}\n`;
app = app.replace(legacyAnchor, nativeComposer + legacyAnchor);
app += `\n/* SC_NATIVE_PLATFORM_COMPOSER_V2 */\n`;
fs.writeFileSync(appPath, app);
console.log('Native per-network composer wired into guided step 3.');
await import('./apply-startup-performance.mjs');
