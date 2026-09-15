import fs from 'node:fs';

// The YouTube scheduling UX patch intentionally changes the default visibility from
// private to public before LinkedIn's final publishing patch runs. The LinkedIn patch
// was written against the canonical publication model, so temporarily normalize that
// one generated anchor and restore the YouTube UX value afterward.
const fieldsPath = 'src/shared/social-publication-fields.ts';
let fields = fs.readFileSync(fieldsPath, 'utf8');
const publicAnchor = "result[field.key] = field.key === 'privacyStatus' ? 'public' : field.options[0]?.value ?? '';";
const privateAnchor = "result[field.key] = field.key === 'privacyStatus' ? 'private' : field.options[0]?.value ?? '';";
const normalized = fields.includes(publicAnchor);
if (normalized) {
  fields = fields.replace(publicAnchor, privateAnchor);
  fs.writeFileSync(fieldsPath, fields);
}

try {
  await import('./enable-linkedin-publishing.mjs');
} finally {
  fields = fs.readFileSync(fieldsPath, 'utf8');
  if (fields.includes(privateAnchor)) {
    fields = fields.replace(privateAnchor, publicAnchor);
    fs.writeFileSync(fieldsPath, fields);
  }
}

await import('./fix-linkedin-publishing-generated.mjs');
