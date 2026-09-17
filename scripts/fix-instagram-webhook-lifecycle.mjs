import fs from 'node:fs';

const path = 'src/worker/instagram-oauth.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('INSTAGRAM_WEBHOOK_LIFECYCLE_FIX')) {
  console.log('Instagram webhook lifecycle fix already applied.');
  process.exit(0);
}

const before = `  const subscriptionPayload = await fetchJson(\n    fetchImpl,\n    \`https://graph.instagram.com/\${config.version}/\${encodeURIComponent(profileId)}/subscribed_apps\`,\n    {\n      method: 'POST',\n      headers: {\n        authorization: \`Bearer \${longPayload.access_token}\`,\n        'content-type': 'application/json',\n      },\n      body: JSON.stringify({ subscribed_fields: ['messages', 'messaging_postbacks', 'comments'] }),\n    },\n    'OAUTH_WEBHOOK_SUBSCRIPTION_FAILED',\n  ) as { success?: unknown };\n  if (subscriptionPayload.success !== true) {\n    throw new InstagramOAuthError('OAUTH_WEBHOOK_SUBSCRIPTION_FAILED', 'Instagram webhook subscription was not confirmed.');\n  }`;

const after = `  let webhookSubscribed = false;\n  try {\n    const subscriptionPayload = await fetchJson(\n      fetchImpl,\n      \`https://graph.instagram.com/\${config.version}/\${encodeURIComponent(profileId)}/subscribed_apps\`,\n      {\n        method: 'POST',\n        headers: {\n          authorization: \`Bearer \${longPayload.access_token}\`,\n          'content-type': 'application/json',\n        },\n        body: JSON.stringify({ subscribed_fields: ['messages', 'messaging_postbacks', 'comments'] }),\n      },\n      'OAUTH_WEBHOOK_SUBSCRIPTION_FAILED',\n    ) as { success?: unknown };\n    webhookSubscribed = subscriptionPayload.success === true;\n  } catch (error) {\n    console.warn(JSON.stringify({\n      event: 'instagram_webhook_subscription_deferred',\n      accountId: profileId,\n      code: error instanceof InstagramOAuthError ? error.code : 'unknown',\n    }));\n  }`;

if (!source.includes(before)) {
  throw new Error('Instagram webhook lifecycle patch failed: subscription anchor not found.');
}
source = source.replace(before, after);

const capabilitiesBefore = `      JSON.stringify({ comments: true, direct_messages: true, private_reply: false, follow_trigger: false }),`;
const capabilitiesAfter = `      JSON.stringify({\n        comments: webhookSubscribed,\n        direct_messages: webhookSubscribed,\n        content_publish: true,\n        webhook_subscribed: webhookSubscribed,\n        private_reply: false,\n        follow_trigger: false,\n      }),`;
if (!source.includes(capabilitiesBefore)) {
  throw new Error('Instagram webhook lifecycle patch failed: capabilities anchor not found.');
}
source = source.replace(capabilitiesBefore, capabilitiesAfter);

const auditBefore = `    webhookSubscribed: true,`;
const auditAfter = `    webhookSubscribed,`;
if (!source.includes(auditBefore)) {
  throw new Error('Instagram webhook lifecycle patch failed: audit anchor not found.');
}
source = source.replace(auditBefore, auditAfter);

source += '\n// INSTAGRAM_WEBHOOK_LIFECYCLE_FIX\n';
fs.writeFileSync(path, source);
console.log('Instagram OAuth no longer fails when webhook subscription is unavailable.');
