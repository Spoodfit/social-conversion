import fs from 'node:fs';

const path = 'scripts/apply-youtube-lifecycle-v2.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldAnchor = `function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`;
const actualAnchor = `function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, aiReady, onGenerateCopy, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onBack, onCancel }: {`;
const oldReplacement = `function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onSaveDraft, onBack, onCancel }: {`;
const actualReplacement = `function CreatePage({ body, editingPublication, connections, selectedIds, plannedPlatforms, destinationDrafts, selectedMedia, library, scheduleDate, scheduleTime, publishNow, customize, accountBodies, busy, deliveryReady, aiReady, onGenerateCopy, onBody, onToggle, onTogglePlanned, onDestinationDraft, onSelectMedia, onUpload, onOpenLibrary, onDate, onTime, onNow, onCustomize, onAccountBody, onSchedule, onSaveDraft, onBack, onCancel }: {`;

if (source.includes(oldAnchor) && source.includes(oldReplacement)) {
  source = source.replace(oldAnchor, actualAnchor).replace(oldReplacement, actualReplacement);
  fs.writeFileSync(path, source);
}

console.log('YouTube lifecycle v2 composer anchor aligned.');
