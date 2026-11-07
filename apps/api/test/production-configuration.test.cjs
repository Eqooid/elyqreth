const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { productionEnvironment: production } = require('./helpers/production-configuration.cjs');
const { validateEnvironment, ConfigurationError } = require('../dist/config/configuration');
const { fixture } = require('./external-adapter-fixtures.cjs');

const rejected = env => assert.throws(() => validateEnvironment(env), e =>
  e instanceof ConfigurationError && !e.message.includes('synthetic-unit-fixture'));

test('production requires explicit bind, port, origins and database before creating the application', () => {
  const config = validateEnvironment(production);
  assert.equal(config.database.sslMode, 'verify-full');
  for (const field of ['API_HOST', 'API_PORT', 'CORS_ORIGINS', 'DATABASE_URL']) {
    rejected({ ...production, [field]: undefined });
    rejected({ ...production, [field]: '' });
  }
  // Staging uses the same production contract; no silent fourth Node profile.
  rejected({ ...production, NODE_ENV: 'staging' });
});

test('production origins require canonical HTTPS without development or wildcard origins', () => {
  for (const origin of ['*', 'https://*.example', 'http://city.example', 'https://localhost',
    'https://127.0.0.1', 'https://[::ffff:127.0.0.1]', 'https://[::1]', 'https://0.0.0.0', 'https://example.localhost',
    'https://localhost.', 'https://nested.localhost.', 'https://user:password@city.example', 'https://city.example/path', 'null', '']) {
    rejected({ ...production, CORS_ORIGINS: origin });
  }
  assert.deepEqual(validateEnvironment({ ...production,
    CORS_ORIGINS: 'https://city.example,https://city.example' }).corsOrigins, ['https://city.example']);
});

test('production cannot use database test identities, superuser/default credentials or unverified TLS', () => {
  for (const url of ['postgres://postgres:long-synthetic-value@db.invalid/app',
    'postgres://app:password@db.invalid/app', 'postgres://app:replace_with_password@db.invalid/app',
    'postgres://app:long-synthetic-value@db.invalid/elyqreth_test',
    'postgres://app:long-synthetic-value@db.invalid/test',
    production.DATABASE_URL + '?sslmode=disable']) rejected({ ...production, DATABASE_URL: url });
  rejected({ ...production, DATABASE_SSL_MODE: 'disable' });
  for (const [key, value] of [['DATABASE_POOL_MAX', '0'], ['DATABASE_POOL_MAX', '21'],
    ['DATABASE_CONNECTION_TIMEOUT_MS', 'Infinity'], ['DATABASE_STATEMENT_TIMEOUT_MS', '0'],
    ['API_PORT', '3001garbage'], ['API_HOST', '*']]) rejected({ ...production, [key]: value });
});

test('production rejects every privileged development feature, including external ingestion dependencies', () => {
  for (const key of ['AGENT_REGISTRY_ENABLED', 'CITY_READ_ENABLED', 'CITY_INTERACTION_ENABLED',
    'COLLABORATION_READ_ENABLED', 'RUNTIME_ENABLED', 'RUNTIME_TOOLS_ENABLED',
    'RUNTIME_LLM_ENABLED', 'EXTERNAL_ORCHESTRATORS_ENABLED']) {
    rejected({ ...production, [key]: 'true' });
    rejected({ ...production, [key]: 'yes' });
  }
  rejected({ ...production, EXTERNAL_ORCHESTRATORS: '[]' });
  rejected({ ...production, LLM_MODEL: 'ignored-unsafe-alias' });
});

test('configuration JSON/standard inspect diagnostics omit connection identities, tokens and provider credentials', () => {
  const env = { NODE_ENV: 'test', DATABASE_URL: production.DATABASE_URL,
    AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: '10000000-0000-4000-8000-000000000001',
    AGENT_REGISTRY_TOKEN: 'synthetic_registry_secret_0123456789', CITY_READ_ENABLED: 'true',
    CITY_READ_TOKEN: 'synthetic_city_secret_01234567890123' };
  const config = validateEnvironment(env);
  for (const output of [JSON.stringify(config), inspect(config), JSON.stringify(config.database), inspect(config.database)]) {
    for (const secret of ['synthetic-unit-fixture', env.AGENT_REGISTRY_TOKEN, env.CITY_READ_TOKEN,
      'db.invalid', env.AGENT_REGISTRY_OWNER_ID]) assert.ok(!output.includes(secret));
  }
  assert.equal(config.database.password, 'synthetic-unit-fixture');
  assert.equal(config.registry.token, env.AGENT_REGISTRY_TOKEN);
  assert.ok(Object.isFrozen(config)); assert.ok(Object.isFrozen(config.database));
});

test('adapter startup rejects unknown types and unsupported capability/missing authentication configuration', () => {
  const { LangGraphAdapter } = require('../dist/external-orchestrators/langgraph.adapter');
  const { AdapterRegistry } = require('../dist/external-orchestrators/adapter-registry');
  const { ExternalAdapterService } = require('../dist/external-orchestrators/external-adapter.service');
  const registry = new AdapterRegistry([new LangGraphAdapter()]);
  for (const patch of [{ adapterType: 'unknown.v1' },
    { adapterType: 'langgraph.v1', capabilities: ['health', 'dispatch'] },
    { adapterType: 'langgraph.v1', capabilities: ['health'] }]) {
    const f = fixture(patch);
    const service = new ExternalAdapterService({ value: f.config }, registry, f.transport, f.logger);
    assert.throws(() => service.onModuleInit(), { code: 'INVALID_CONFIGURATION' });
    assert.equal(f.calls.length, 0);
  }
});

test('real production bootstrap exits safely before binding when critical configuration is invalid', () => {
  for (const patch of [{ DATABASE_URL: '' }, { API_PORT: 'invalid-private-value' },
    { CORS_ORIGINS: 'http://localhost:5173' }, { AGENT_REGISTRY_ENABLED: 'true' },
    { RUNTIME_ENABLED: 'true' }, { EXTERNAL_ORCHESTRATORS_ENABLED: 'true' }]) {
    const child = spawnSync(process.execPath, ['dist/main.js'], { cwd: join(__dirname, '..'),
      encoding: 'utf8', timeout: 10000, env: { ...process.env, ...production, ...patch } });
    assert.ifError(child.error); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    const line = JSON.parse(child.stderr.trim()); assert.equal(line.event, 'startup_failed');
    assert.match(line.message, /Invalid API configuration/);
    for (const value of ['invalid-private-value', 'synthetic-unit-fixture', production.DATABASE_URL])
      assert.ok(!child.stderr.includes(value));
  }
});

test('development and test retain optional database/local origins and deterministic disabled features', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const c = validateEnvironment({ NODE_ENV });
    assert.equal(c.database, undefined); assert.equal(c.registry, undefined);
    assert.equal(c.runtime, undefined); assert.equal(c.externalOrchestrators, undefined);
    assert.equal(c.host, '127.0.0.1'); assert.equal(c.port, 3001);
    assert.deepEqual(c.corsOrigins, ['http://localhost:5173', 'http://127.0.0.1:5173']);
  }
});

test('production bootstrap checks database connectivity and fails safely without accepting traffic', () => {
  const child = spawnSync(process.execPath, ['dist/main.js'], { cwd: join(__dirname, '..'),
    encoding: 'utf8', timeout: 10000, env: { ...process.env, ...production,
      DATABASE_URL: 'postgresql://app:synthetic-unit-fixture@127.0.0.1:9/elyqreth',
      DATABASE_CONNECTION_TIMEOUT_MS: '100' } });
  assert.ifError(child.error); assert.equal(child.status, 1); assert.equal(child.stdout, '');
  const line = JSON.parse(child.stderr.trim()); assert.equal(line.event, 'startup_failed');
  assert.match(line.message, /Database unavailable/);
  assert.ok(!child.stderr.includes('synthetic-unit-fixture'));
  assert.ok(!child.stderr.includes('postgresql://'));
});
