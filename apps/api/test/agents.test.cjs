const { closedApplication } = require('./helpers/production-configuration.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { validateEnvironment } = require('../dist/config/configuration');
const { CreateAgentDto, UpdateAgentDto, ListAgentsQueryDto } = require('../dist/agents/dto/agent.dto');
const { AgentsService, expectedVersion, lifecycleTransition, serializeAgent } = require('../dist/agents/agents.service');
const { RegistryGuard } = require('../dist/agents/registry.guard');
const { createApplication } = require('../dist/application');

const input = () => ({ name: '  Research   Agent  ', type: 'LLM', orchestratorId: randomUUID(),
  capabilities: ['research'], configuration: { category: 'research', color: '#abcdef' } });
const check = async (Class, value) => validate(plainToInstance(Class, value), {
  whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
});

test('registration DTO normalizes names and accepts optional metadata without model credentials', async () => {
  const dto = plainToInstance(CreateAgentDto, input());
  assert.equal(dto.name, 'Research Agent');
  assert.deepEqual(await check(CreateAgentDto, input()), []);
  assert.deepEqual(await check(CreateAgentDto, { ...input(), description: null }), []);
});

test('registration rejects missing, invalid, unbounded, server-owned and sensitive fields', async () => {
  for (const patch of [
    { name: '' }, { name: ' '.repeat(3) }, { name: 'x'.repeat(161) }, { name: 'a\0b' },
    { type: 'OPENAI' }, { orchestratorId: null }, { orchestratorId: 'bad' },
    { capabilities: Array(33).fill('x') }, { capabilities: ['x','x'] }, { capabilities: ['arbitrary text'] },
    { capabilities: null }, { configuration: null }, { configuration: [] },
    { configuration: { apiKey: 'never-store' } }, { configuration: { nested: { token: 'never-store' } } },
    { configuration: { category: 'token-value' } }, { configuration: { color: 'secret' } },
    { ownerId: randomUUID() }, { lifecycleStatus: 'ACTIVE' }, { version: 2 }, { id: randomUUID() },
    { description: 'x'.repeat(4001) },
  ]) assert.ok((await check(CreateAgentDto, { ...input(), ...patch })).length, JSON.stringify(patch));
  assert.ok((await check(CreateAgentDto, {})).length);
});

test('updates preserve nullable description but reject routing, type and lifecycle assignment', async () => {
  assert.deepEqual(await check(UpdateAgentDto, { description: null, configuration: {} }), []);
  for (const patch of [{ name: null }, { orchestratorId: randomUUID() }, { type: 'EXTERNAL' },
    { lifecycleStatus: 'ARCHIVED' }, { configuration: { password: 'secret' } }]) {
    assert.ok((await check(UpdateAgentDto, patch)).length);
  }
});

test('empty metadata patch is rejected before persistence, including transformed undefined fields', async () => {
  const service = new AgentsService({}, {});
  await assert.rejects(service.update(randomUUID(), plainToInstance(UpdateAgentDto, {}), 1), e => e.getStatus() === 400);
});

test('query pagination is bounded and filters are typed', async () => {
  assert.deepEqual(await check(ListAgentsQueryDto, { limit: '20', offset: '0', status: 'ACTIVE' }), []);
  for (const query of [{ limit: 101 }, { offset: -1 }, { offset: 10001 }, { limit: '1.5' },
    { limit: ['1','2'] }, { status: 'RUNNING' }, { search: '' }, { sort: 'sql' }, { orchestratorId: 'bad' }]) {
    assert.ok((await check(ListAgentsQueryDto, query)).length);
  }
});

test('lifecycle is administrative, repeated status is idempotent and archive is terminal', () => {
  for (const from of ['ACTIVE', 'DISABLED', 'ARCHIVED']) {
    assert.equal(lifecycleTransition(from, from), false);
    for (const to of ['ACTIVE', 'DISABLED', 'ARCHIVED']) {
      if (from === to) continue;
      if (from === 'ARCHIVED') assert.throws(() => lifecycleTransition(from, to), e => e.getStatus() === 409);
      else assert.equal(lifecycleTransition(from, to), true);
    }
  }
  assert.equal(expectedVersion('"2"'), 2);
  for (const version of [undefined, '*', '1', '"0"', '"2147483648"', '"1", "2"'])
    assert.throws(() => expectedVersion(version), e => e.getStatus() === 400);
});

test('serialization omits internal scope and configuration, including legacy credentials', () => {
  const result = serializeAgent({ ...input(), id: randomUUID(), ownerId: randomUUID(),
    configuration: { secret: 'legacy-secret' }, lifecycleStatus: 'DISABLED', version: 1,
    description: null, createdAt: new Date(), updatedAt: new Date() });
  assert.equal(result.configuration, undefined);
  assert.equal(result.ownerId, undefined);
  assert.ok(!JSON.stringify(result).includes('legacy-secret'));
});

const environment = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/elyqreth_test',
  AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: randomUUID(), AGENT_REGISTRY_TOKEN: 'a'.repeat(48) };

test('registry is opt-in and cannot enable in production, without DB/scope/token, or on external binds', () => {
  assert.equal(validateEnvironment({}).registry, undefined);
  assert.equal(validateEnvironment(environment).registry.ownerId, environment.AGENT_REGISTRY_OWNER_ID);
  for (const patch of [{ NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com' },
    { API_HOST: '0.0.0.0' }, { API_HOST: 'localhost' }, { DATABASE_URL: undefined },
    { AGENT_REGISTRY_OWNER_ID: '' }, { AGENT_REGISTRY_TOKEN: 'short' }, { AGENT_REGISTRY_ENABLED: 'yes' }]) {
    assert.throws(() => validateEnvironment({ ...environment, ...patch }), /Invalid API configuration/);
  }
});

test('development credential guard rejects proxy, host, origin and token boundary violations', () => {
  const guard = new RegistryGuard({ value: validateEnvironment(environment) });
  const request = () => ({ socket: { remoteAddress: '127.0.0.1' }, headers: {
    host: '127.0.0.1:3001', authorization: `Bearer ${environment.AGENT_REGISTRY_TOKEN}` } });
  const run = req => guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
  assert.equal(run(request()), true);
  const remote = request(); remote.socket.remoteAddress = '192.168.1.2';
  assert.throws(() => run(remote), e => e.getStatus() === 403);
  for (const headers of [{ host: 'attacker.example' }, { origin: 'https://attacker.example' },
    { authorization: '' }, { authorization: 'Bearer invalid' }]) {
    const req = request(); Object.assign(req.headers, headers);
    assert.throws(() => run(req));
  }
});

test('default and production HTTP registry routes fail closed while health remains public', async () => {
  for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com' }]) {
    const app = await closedApplication(env);
    try {
      await app.listen(0, '127.0.0.1');
      for (const [path, method] of [['','GET'],['','POST'],['/not-a-uuid','GET'],['/not-a-uuid','PATCH'],['/not-a-uuid/activate','POST']]) {
        const response = await fetch(`${await app.getUrl()}/api/v1/agents${path}`, { method });
        assert.equal(response.status, 404);
      }
      assert.equal((await fetch(`${await app.getUrl()}/health`)).status, 200);
    } finally { await app.close(); }
  }
});
