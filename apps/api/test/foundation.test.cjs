const { productionEnvironment } = require('./helpers/production-configuration.cjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createApplication } = require('../dist/application');
const { loadConfiguration, validateEnvironment, ConfigurationError } = require('../dist/config/configuration');
const { ApiConfig } = require('../dist/config/config.module');
const { ApiLogger } = require('../dist/common/api-logger');
const { configureHttp } = require('../dist/common/http-foundation');
const { NestFactory } = require('@nestjs/core');
const { Body, Controller, Get, Module, Post } = require('@nestjs/common');
const { IsString } = require('class-validator');

const config = validateEnvironment({ NODE_ENV: 'test' });

test('configuration defaults are local and immutable', () => {
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3001);
  assert.deepEqual(config.corsOrigins, ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.corsOrigins));
});

test('invalid environments fail without echoing configured values', () => {
  for (const env of [
    { NODE_ENV: 'secret-environment' }, { API_PORT: '' }, { API_PORT: '0' },
    { API_PORT: '65536' }, { API_PORT: '1.5' }, { API_PORT: '3001secret' },
    { API_HOST: 'https://secret-host.invalid' }, { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://*.example.com' }, { CORS_ORIGINS: 'https://example.com/path' },
    { CORS_ORIGINS: 'https://user:secret@example.com' }, { CORS_ORIGINS: 'null' },
    { CORS_ORIGINS: 'http://localhost:5173,' }, { NODE_ENV: 'production' },
  ]) {
    assert.throws(() => validateEnvironment(env), error => {
      assert.ok(error instanceof ConfigurationError);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('explicit production origins and boundary ports validate', () => {
  for (const port of ['1', '65535']) {
    const value = validateEnvironment({ ...productionEnvironment, API_PORT: port,
      API_HOST: '::1', CORS_ORIGINS: 'https://elyqreth.example,https://elyqreth.example' });
    assert.equal(value.port, Number(port));
    assert.deepEqual(value.corsOrigins, ['https://elyqreth.example']);
  }
});

test('process environment overrides API-local env file without mutating process.env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elyqreth-config-'));
  const file = join(dir, '.env');
  const prior = process.env.API_PORT;
  try {
    writeFileSync(file, 'API_PORT=4001\nCORS_ORIGINS=http://localhost:8080\n');
    assert.equal(loadConfiguration({}, file).port, 4001);
    assert.equal(loadConfiguration({ API_PORT: '4002' }, file).port, 4002);
    assert.deepEqual(loadConfiguration({ API_PORT: undefined }, file).corsOrigins, ['http://localhost:8080']);
    assert.equal(process.env.API_PORT, prior);
    assert.throws(() => loadConfiguration({ API_PORT: '' }, file), ConfigurationError);
  } finally { rmSync(dir, { recursive: true }); }
});

test('main rejects invalid startup configuration with nonzero exit and safe logs', () => {
  const child = spawnSync(process.execPath, ['dist/main.js'], {
    cwd: join(__dirname, '..'), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_ENV: 'test', API_PORT: 'secret-invalid-port' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  const line = JSON.parse(child.stderr.trim());
  assert.equal(line.event, 'startup_failed');
  assert.match(line.message, /API_PORT/);
  assert.ok(!child.stderr.includes('secret-invalid-port'));
  assert.equal(child.stdout, '');
});

let app, base;
const logs = [];
before(async () => {
  app = await createApplication(config);
  const logger = app.get(ApiLogger);
  logger.info = (event, fields) => logs.push({ event, ...fields });
  logger.error = (event, fields) => logs.push({ event, ...fields });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { await app?.close(); });

test('Nest boots with DI configuration and serves only lightweight health', async () => {
  assert.equal(app.get(ApiConfig).value, config);
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'elyqreth-api' });
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('correlation IDs are echoed only when bounded and safe', async () => {
  const accepted = await fetch(`${base}/health`, { headers: { 'x-request-id': 'review-123' } });
  assert.equal(accepted.headers.get('x-request-id'), 'review-123');
  for (const requestId of ['x'.repeat(65), 'not/a/safe/id']) {
    const response = await fetch(`${base}/health`, { headers: { 'x-request-id': requestId } });
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  }
});

test('CORS permits exact origins and rejects wildcard or unrelated origins', async () => {
  const allowed = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  for (const origin of ['http://localhost:5174', 'https://untrusted.example', 'null']) {
    const denied = await fetch(`${base}/health`, { headers: { origin } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  const preflight = await fetch(`${base}/health`, { method: 'OPTIONS', headers: {
    origin: 'http://localhost:5173', 'access-control-request-method': 'GET',
    'access-control-request-headers': 'authorization,x-request-id',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('unsupported routes/methods return safe correlated 404 and no business features', async () => {
  for (const path of ['/agents', '/tasks', '/executions', '/api/v1/agents', '/missing-secret?token=private-query']) {
    const response = await fetch(base + path, { headers: { authorization: 'Bearer private-credential' } });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      statusCode: 404, message: 'Route not found.', requestId: response.headers.get('x-request-id'),
    });
  }
  const post = await fetch(`${base}/health`, { method: 'POST' });
  assert.equal(post.status, 404);
});

test('malformed JSON and oversize bodies return safe 400/413 with correlation', async () => {
  for (const [body, status] of [['{"secret":', 400], [JSON.stringify({ value: 'x'.repeat(70_000) }), 413]]) {
    const response = await fetch(`${base}/missing`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.statusCode, status);
    assert.equal(result.requestId, response.headers.get('x-request-id'));
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.ok(!('stack' in result));
  }
});

test('structured request logs omit credentials, query, body and unmatched URL', async () => {
  await fetch(`${base}/sensitive-route?token=private-query`, { method: 'POST', headers: {
    authorization: 'Bearer private-credential', 'content-type': 'application/json',
  }, body: JSON.stringify({ value: 'private-body' }) });
  await new Promise(resolve => setImmediate(resolve));
  const output = JSON.stringify(logs);
  for (const value of ['private-query', 'private-credential', 'private-body', 'sensitive-route', 'missing-secret']) {
    assert.ok(!output.includes(value));
  }
  assert.ok(logs.some(line => line.event === 'http_request' && line.route === '/health'));
  assert.ok(logs.every(line => line.requestId && Number.isInteger(line.statusCode)));
});

// Test-only controller proves the production global pipe/filter behavior.
// It is never imported by AppModule or included in src/build output.
class ProbeDto {}
IsString()(ProbeDto.prototype, 'name');
class ProbeController {
  submit(body) { return { name: body.name, dto: body instanceof ProbeDto }; }
  fail() { throw new Error('private-internal-error-and-stack'); }
}
Body()(ProbeController.prototype, 'submit', 0);
Reflect.defineMetadata('design:paramtypes', [ProbeDto], ProbeController.prototype, 'submit');
Post()(ProbeController.prototype, 'submit', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'submit'));
Get('failure')(ProbeController.prototype, 'fail', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'fail'));
Controller('probe')(ProbeController);
class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

test('global validation transforms DTOs, rejects invalid/unknown fields, and hides internal errors', async () => {
  const fixture = await NestFactory.create(ProbeModule, { bodyParser: false, logger: false });
  const logger = { info() {}, error() {} };
  configureHttp(fixture, config, logger);
  try {
    await fixture.listen(0, '127.0.0.1');
    const url = await fixture.getUrl();
    const valid = await fetch(`${url}/probe`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'city' }) });
    assert.equal(valid.status, 201);
    assert.deepEqual(await valid.json(), { name: 'city', dto: true });
    for (const body of [{ name: 12 }, { name: 'city', unexpected: 'private-value' }, {}]) {
      const response = await fetch(`${url}/probe`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.ok(!JSON.stringify(await response.json()).includes('private-value'));
    }
    const failure = await fetch(`${url}/probe/failure`);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { statusCode: 500,
      message: 'Internal server error.', requestId: failure.headers.get('x-request-id') });
  } finally { await fixture.close(); }
});
