import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'vite';

// dist/ IS the maintained city source and hosting root. Never use Vite's default
// output directory here. This verifies bundling without changing deployment.
const output = mkdtempSync(join(tmpdir(), 'elyqreth-web-build-'));
try {
  await build({ configFile: resolve('vite.config.js'), build: { outDir: output, emptyOutDir: false } });
  assert.ok(existsSync(join(output, 'index.html')));
  assert.ok(readdirSync(join(output, 'assets')).some(name => name.endsWith('.js')));
  console.log('Frontend production bundle verified in a disposable directory; city source preserved.');
} finally {
  assert.equal(dirname(resolve(output)), resolve(tmpdir()));
  assert.ok(basename(output).startsWith('elyqreth-web-build-'));
  rmSync(output, { recursive: true });
}
