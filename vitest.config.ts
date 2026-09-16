import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(directory, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        // Production uses a Workers AI binding. Workers AI has no local simulator,
        // so tests intentionally load the local-only Wrangler config to avoid
        // opening a remote Cloudflare proxy session in CI.
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityDate: '2026-08-08',
          bindings: {
            TEAM_DOMAIN: 'https://social-conversion-test.cloudflareaccess.com',
            POLICY_AUD: 'social-conversion-test-audience',
            META_APP_SECRET: 'test-meta-secret',
            META_VERIFY_TOKEN: 'test-verify-token',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
