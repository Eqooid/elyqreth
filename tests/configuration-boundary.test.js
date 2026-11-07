import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import config from '../vite.config.js';

test('static frontend has no ambient public environment namespace or private configuration imports', () => {
  assert.deepEqual(config.envPrefix, []);
  assert.equal(config.define, undefined);
  for (const name of readdirSync('dist/js', { recursive: true }).filter(n => n.endsWith('.js'))) {
    const source = readFileSync(`dist/js/${name}`, 'utf8');
    assert.doesNotMatch(source, /process\.env|import\.meta\.env|apps\/api\/src\/config/);
  }
});

test('Vite public env loading excludes backend and VITE-prefixed values from production env files', async () => {
  const { loadEnv } = await import('vite');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'elyqreth-public-env-'));
  try {
    writeFileSync(join(dir, '.env.production'),
      'DATABASE_URL=synthetic-private-database\nVITE_PROVIDER_TOKEN=synthetic-private-token\nEXTERNAL_SECRET_FIXTURE=synthetic-external-token\n');
    const exposed = loadEnv('production', dir, config.envPrefix);
    assert.deepEqual(exposed, {});
  } finally { rmSync(dir, { recursive: true }); }
});
