import fs from 'node:fs';

const path = 'scripts/apply-inbox-visual-context.mjs';
let source = fs.readFileSync(path, 'utf8');

const brokenMeta = "<em>{message.context.mediaType ? `${message.context.mediaType.replaceAll('_', ' ')} · ` : ''}Publié{message.context.publishedAt ? ` · ${formatShortDate(message.context.publishedAt)}` : ''}</em>";
const safeMeta = "<em>{message.context.mediaType ? message.context.mediaType.replaceAll('_', ' ') + ' · ' : ''}Publié{message.context.publishedAt ? ' · ' + formatShortDate(message.context.publishedAt) : ''}</em>";
if (source.includes(brokenMeta)) source = source.replace(brokenMeta, safeMeta);

source = source.replace('\\n              publications={publications}\\n              onOpenPublication=', '\\n              onOpenPublication=');
source = source.replace(', onSuggest, publications, onOpenPublication }: {', ', onSuggest, onOpenPublication }: {');
source = source.replace('  publications: Publication[];\\n  onOpenPublication:', '  onOpenPublication:');

fs.writeFileSync(path, source);
console.log('Inbox visual context patch script normalized.');
