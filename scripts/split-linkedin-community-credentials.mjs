import fs from 'node:fs';

const communityPath = 'src/worker/linkedin-community.ts';
let community = fs.readFileSync(communityPath, 'utf8');

const oldConfig = `function configFor(env: Env): CommunityConfig | undefined {
  const clientId = envString(env, 'LINKEDIN_CLIENT_ID');
  const clientSecret = envString(env, 'LINKEDIN_CLIENT_SECRET');
  const redirectUri = envString(env, 'LINKEDIN_REDIRECT_URI');
  const keyring = tokenKeyringSecret(env);
  if (!clientId || !clientSecret || !redirectUri || !keyring) return undefined;`;

const newConfig = `function configFor(env: Env): CommunityConfig | undefined {
  // LinkedIn Community Management may require a dedicated developer application
  // with no other provisioned products. Prefer dedicated credentials, while keeping
  // the legacy LinkedIn app as a safe fallback for environments not migrated yet.
  const clientId = envString(env, 'LINKEDIN_COMMUNITY_CLIENT_ID') ?? envString(env, 'LINKEDIN_CLIENT_ID');
  const clientSecret = envString(env, 'LINKEDIN_COMMUNITY_CLIENT_SECRET') ?? envString(env, 'LINKEDIN_CLIENT_SECRET');
  const redirectUri = envString(env, 'LINKEDIN_COMMUNITY_REDIRECT_URI') ?? envString(env, 'LINKEDIN_REDIRECT_URI');
  const keyring = tokenKeyringSecret(env);
  if (!clientId || !clientSecret || !redirectUri || !keyring) return undefined;`;

if (!community.includes("LINKEDIN_COMMUNITY_CLIENT_ID")) {
  if (!community.includes(oldConfig)) throw new Error('Dedicated LinkedIn Community credential patch failed: config anchor not found.');
  community = community.replace(oldConfig, newConfig);
}

if (!community.includes('// SC_LINKEDIN_COMMUNITY_DEDICATED_APP_V1')) {
  community += '\n// SC_LINKEDIN_COMMUNITY_DEDICATED_APP_V1\n';
}
fs.writeFileSync(communityPath, community);

const productionPath = 'src/worker/production.ts';
let production = fs.readFileSync(productionPath, 'utf8');
const oldRedirect = `  const configured = Reflect.get(env, 'LINKEDIN_REDIRECT_URI');`;
const newRedirect = `  const configured = Reflect.get(env, 'LINKEDIN_COMMUNITY_REDIRECT_URI') ?? Reflect.get(env, 'LINKEDIN_REDIRECT_URI');`;
if (production.includes(oldRedirect)) production = production.replace(oldRedirect, newRedirect);
if (!production.includes("LINKEDIN_COMMUNITY_REDIRECT_URI")) {
  throw new Error('Dedicated LinkedIn Community credential patch failed: redirect fallback not applied.');
}
if (!production.includes('// SC_LINKEDIN_COMMUNITY_DEDICATED_APP_V1')) {
  production += '\n// SC_LINKEDIN_COMMUNITY_DEDICATED_APP_V1\n';
}
fs.writeFileSync(productionPath, production);

console.log('LinkedIn Community Management now supports a dedicated LinkedIn developer app.');
