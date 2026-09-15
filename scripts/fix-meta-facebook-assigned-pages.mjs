import fs from 'node:fs';

const path = 'src/worker/meta-oauth.ts';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes('META_FACEBOOK_ASSIGNED_PAGES_V1')) {
  const anchor = `  return pages;\n}\n\nfunction selectableAssets`;
  if (!source.includes(anchor)) {
    throw new Error('Facebook assigned Pages patch failed: listPages return anchor not found.');
  }

  source = source.replace(anchor, `  if (requestedPlatform === 'facebook' && pages.length === 0) {\n    try {\n      const assigned = new URL(\`https://graph.facebook.com/\${config.graphVersion}/me/assigned_pages\`);\n      assigned.searchParams.set('fields', 'id,name,access_token');\n      assigned.searchParams.set('limit', '100');\n      let assignedNext = assigned.toString();\n      for (let page = 0; assignedNext && page < 10; page += 1) {\n        const payload = await fetchJson(fetchImpl, assignedNext, {\n          headers: { authorization: \`Bearer \${userToken}\` },\n        }) as { data?: MetaPage[]; paging?: { next?: unknown } };\n        if (Array.isArray(payload.data)) pages.push(...payload.data);\n        assignedNext = typeof payload.paging?.next === 'string' && payload.paging.next.startsWith('https://')\n          ? payload.paging.next\n          : '';\n      }\n    } catch (error) {\n      console.warn(JSON.stringify({\n        event: 'meta_assigned_pages_fallback_failed',\n        code: error instanceof MetaOAuthError ? error.code : 'unknown',\n      }));\n    }\n  }\n  return pages;\n}\n\nfunction selectableAssets`);
  source += '\n// META_FACEBOOK_ASSIGNED_PAGES_V1\n';
  fs.writeFileSync(path, source);
}
