import { readFileSync } from 'node:fs';

const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const failures = [];

if (wrangler.includes('CHANGE_ME')) {
  failures.push('TEAM_DOMAIN and POLICY_AUD must be replaced with the Cloudflare Access values.');
}

if (!/"workers_dev"\s*:\s*false/.test(wrangler)) {
  failures.push('workers_dev must be false for production.');
}

if (!/"preview_urls"\s*:\s*false/.test(wrangler)) {
  failures.push('preview_urls must be false for production.');
}

if (!/"custom_domain"\s*:\s*true/.test(wrangler)) {
  failures.push('A production custom domain is required.');
}

if (failures.length > 0) {
  console.error('Production configuration is blocked:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Production configuration validated.');
