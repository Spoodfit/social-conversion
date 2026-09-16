import fs from 'node:fs';

const path = 'src/worker/linkedin-community.ts';
let source = fs.readFileSync(path, 'utf8');

// Community Management's current organization administration permission is
// rw_organization_admin. It covers Page administration and organization lookup.
source = source.replace("  'r_organization_admin',", "  'rw_organization_admin',");

if (!source.includes("'rw_organization_admin'")) {
  throw new Error('LinkedIn Community scope fix failed: rw_organization_admin is missing.');
}
if (source.includes("  'r_organization_admin',")) {
  throw new Error('LinkedIn Community scope fix failed: legacy r_organization_admin is still requested.');
}

if (!source.includes('// SC_LINKEDIN_COMMUNITY_SCOPE_V2')) {
  source += '\n// SC_LINKEDIN_COMMUNITY_SCOPE_V2\n';
}

fs.writeFileSync(path, source);
console.log('LinkedIn Community OAuth now requests rw_organization_admin.');
