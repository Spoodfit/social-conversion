import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');
const original = source;

// LinkedIn has a dedicated OAuth endpoint, but older account-panel paths can still
// funnel a provider click through connectSocial(). Make that fallback LinkedIn-aware
// so adding a second profile never falls through to TikTok readiness.
source = source.replace(
  'async function connectSocial(platform: SocialPlatform, connectionId?: string) {',
  "async function connectSocial(platform: SocialPlatform | 'linkedin', connectionId?: string) {",
);

const readyBefore = `    const ready = platform === 'instagram'\n      ? Boolean(runtime.instagramOAuthReady)\n      : platform === 'youtube'\n        ? Boolean(runtime.youtubeOAuthReady)\n        : Boolean(runtime.tiktokOAuthReady);`;
const readyAfter = `    const ready = platform === 'linkedin'\n      ? Boolean(runtime.linkedinOAuthReady)\n      : platform === 'instagram'\n        ? Boolean(runtime.instagramOAuthReady)\n        : platform === 'youtube'\n          ? Boolean(runtime.youtubeOAuthReady)\n          : Boolean(runtime.tiktokOAuthReady);`;
if (source.includes(readyBefore)) source = source.replace(readyBefore, readyAfter);

// Prefer the dedicated handler wherever an older generated UI explicitly casts
// LinkedIn into SocialPlatform.
source = source.replaceAll(
  "onClick={() => onConnect('linkedin' as SocialPlatform)}",
  'onClick={() => onConnectLinkedIn()}',
);
source = source.replaceAll(
  "onClick={() => onConnect('linkedin' as SocialPlatform, undefined)}",
  'onClick={() => onConnectLinkedIn()}',
);
source = source.replaceAll(
  "onConnectLinkedIn={(id) => void connectSocial('linkedin' as SocialPlatform, id)}",
  'onConnectLinkedIn={(id) => void connectLinkedIn(id)}',
);

// Fail closed during CI if LinkedIn has been accidentally removed from the runtime
// or if no path can start the dedicated OAuth flow.
if (!source.includes('linkedinOAuthReady?: boolean;')) {
  throw new Error('LinkedIn multi-account fix failed: runtime readiness is missing.');
}
if (!source.includes('async function connectLinkedIn(connectionId?: string)')) {
  throw new Error('LinkedIn multi-account fix failed: dedicated connectLinkedIn handler is missing.');
}
if (!source.includes("'/api/oauth/linkedin/start'")) {
  throw new Error('LinkedIn multi-account fix failed: LinkedIn OAuth start endpoint is missing.');
}
if (!source.includes("platform === 'linkedin'\n      ? Boolean(runtime.linkedinOAuthReady)")) {
  throw new Error('LinkedIn multi-account fix failed: generic connector still cannot route LinkedIn safely.');
}

if (!source.includes('SC_LINKEDIN_MULTI_ACCOUNT_ROUTING_V1')) {
  source += '\n/* SC_LINKEDIN_MULTI_ACCOUNT_ROUTING_V1 */\n';
}

if (source !== original) fs.writeFileSync(path, source);

// Keep LinkedIn publishing as the final generated patch. This prevents older Facebook
// and account-switcher patches from re-excluding LinkedIn from Planner destinations.
await import('./run-linkedin-publishing.mjs');
await import('./apply-account-disconnect.mjs');

console.log('LinkedIn add-account routing and publishing are finalized.');
