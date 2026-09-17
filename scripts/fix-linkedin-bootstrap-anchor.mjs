import fs from 'node:fs';

const path = 'src/worker/index.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('SC_LINKEDIN_BOOTSTRAP_V1')) {
  console.log('LinkedIn bootstrap aggregation already applied.');
  process.exit(0);
}

source = source.replace(
  "  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok';\n  display_name: string;",
  "  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'linkedin';\n  display_name: string;",
);

const before = `    db.prepare(
      \`SELECT id, platform, display_name, handle, status, last_synced_at
       FROM social_connections
       WHERE workspace_id = ?
         AND (status = 'connected' OR external_account_id IS NOT NULL)
       UNION ALL
       SELECT id, 'facebook' AS platform, display_name, handle, status, last_synced_at
       FROM facebook_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name\`,
    ).bind(principal.workspaceId, principal.workspaceId),`;

const after = `    db.prepare(
      \`SELECT id, platform, display_name, handle, status, last_synced_at
       FROM social_connections
       WHERE workspace_id = ?
         AND (status = 'connected' OR external_account_id IS NOT NULL)
       UNION ALL
       SELECT id, 'facebook' AS platform, display_name, handle, status, last_synced_at
       FROM facebook_connections
       WHERE workspace_id = ?
       UNION ALL
       SELECT id, 'linkedin' AS platform, display_name, handle, status, last_synced_at
       FROM linkedin_connections
       WHERE workspace_id = ?
       ORDER BY platform, display_name\`,
    ).bind(principal.workspaceId, principal.workspaceId, principal.workspaceId),`;

if (!source.includes(before)) {
  throw new Error('LinkedIn bootstrap fix failed: Facebook-aware bootstrap query not found.');
}

source = source.replace(before, after);
source += '\n// SC_LINKEDIN_BOOTSTRAP_V1\n';
fs.writeFileSync(path, source);
console.log('LinkedIn bootstrap aggregation applied after Facebook storage patch.');
