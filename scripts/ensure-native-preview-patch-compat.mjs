import fs from 'node:fs';

const path = 'src/PlannerComposerPreview.tsx';
const source = fs.readFileSync(path, 'utf8');

if (!source.includes('SC_NATIVE_SOCIAL_PREVIEWS_V1')) {
  console.log('Native preview compatibility markers not required yet.');
  process.exit(0);
}

const markers = [
  'SC_FACEBOOK_COMPOSER_PREVIEW_V1',
  'SC_FACEBOOK_COMPOSER_PREVIEW_V2',
  'SC_LINKEDIN_COMPOSER_PREVIEW_V1',
];

let next = source;
for (const marker of markers) {
  if (!next.includes(marker)) next += `\n// ${marker}\n`;
}

if (next !== source) fs.writeFileSync(path, next);
console.log('Native preview compatibility markers are ready.');
