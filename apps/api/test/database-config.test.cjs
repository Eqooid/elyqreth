const { productionEnvironment } = require('./helpers/production-configuration.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { validateEnvironment, ConfigurationError } = require('../dist/config/configuration');
const url = 'postgresql://elyqreth:secret-password@127.0.0.1:5432/elyqreth';

test('database is opt-in, with validated bounded local pool settings', () => {
  assert.equal(validateEnvironment({}).database, undefined);
  const config = validateEnvironment({ DATABASE_URL: url }).database;
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5432);
  assert.equal(config.poolMax, 5);
  assert.equal(config.connectionTimeoutMs, 5000);
  assert.equal(config.sslMode, 'disable');
  assert.ok(Object.isFrozen(config));
});

test('database credentials are decoded but never echoed on validation failure', () => {
  const value = validateEnvironment({ DATABASE_URL: 'postgres://user:p%40ss%3Aword@[::1]/app_db' }).database;
  assert.equal(value.password, 'p@ss:word');
  assert.equal(value.host, '::1');
  for (const env of [
    { DATABASE_URL: '' }, { DATABASE_URL: 'https://user:secret@localhost/db' },
    { DATABASE_URL: 'postgresql://localhost/db' }, { DATABASE_URL: url + '?sslmode=disable' },
    { DATABASE_URL: url + '#secret' }, { DATABASE_URL: url + '/path' },
    { DATABASE_URL: url, DATABASE_POOL_MAX: '0' }, { DATABASE_URL: url, DATABASE_POOL_MAX: '21' },
    { DATABASE_URL: url, DATABASE_POOL_MAX: '1.5' }, { DATABASE_URL: url, DATABASE_CONNECTION_TIMEOUT_MS: '' },
    { DATABASE_URL: url, DATABASE_IDLE_TIMEOUT_MS: '-1' }, { DATABASE_URL: url, DATABASE_STATEMENT_TIMEOUT_MS: '0' },
    { DATABASE_URL: url, DATABASE_SSL_MODE: 'allow' }, { DATABASE_POOL_MAX: '5' },
    { NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com', DATABASE_URL: url, DATABASE_SSL_MODE: 'disable' },
  ]) {
    assert.throws(() => validateEnvironment(env), error => error instanceof ConfigurationError && !error.message.includes('secret'));
  }
  const production = validateEnvironment({ ...productionEnvironment, DATABASE_URL: url });
  assert.equal(production.database.sslMode, 'verify-full');
});

test('configured but unreachable PostgreSQL fails startup safely and closes its pool', () => {
  const child = spawnSync(process.execPath, ['dist/main.js'], {
    cwd: join(__dirname, '..'), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: 'postgres://test:secret-password@127.0.0.1:9/elyqreth',
      DATABASE_CONNECTION_TIMEOUT_MS: '100', DATABASE_SSL_MODE: 'disable' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stderr.trim()).event, 'startup_failed');
  assert.match(JSON.parse(child.stderr.trim()).message, /Database unavailable/);
  assert.ok(!child.stderr.includes('secret-password'));
  assert.ok(!child.stderr.includes('postgres://'));
});
