const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validateEnvironment } = require('../dist/config/configuration');
const { assertLocalRequest, LocalAccessGuard } = require('../dist/common/local-access.guard');
const { requestContext } = require('../dist/common/request-context');
const { establishInteraction, interactionPrincipal } = require('../dist/interaction/interaction.context');
const { InteractionGuard } = require('../dist/interaction/interaction.guard');
const agentId = randomUUID(), ownerId = randomUUID();
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://app:synthetic-password@127.0.0.1/app',
  AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: ownerId, AGENT_REGISTRY_TOKEN: 'o'.repeat(40),
  CITY_READ_ENABLED: 'true', CITY_READ_TOKEN: 'r'.repeat(40),
  CITY_INTERACTION_ENABLED: 'true', CITY_INTERACTION_TOKEN: 'i'.repeat(40),
  CITY_INTERACTION_AGENT_IDS: JSON.stringify([agentId]),
  COLLABORATION_READ_ENABLED: 'true', COLLABORATION_READ_TOKEN: 'c'.repeat(40) };
const config = validateEnvironment(env);
const request = token => ({ method: 'GET', path: '/api/v1/agents/' + agentId,
  headers: { host: '127.0.0.1', authorization: 'Bearer ' + token }, socket: { remoteAddress: '127.0.0.1' } });
const context = req => ({ switchToHttp: () => ({ getRequest: () => req }) });
const scope = { ownerId, agentId, operation: 'read' };
const run = callback => requestContext.run(Object.freeze({ requestId: randomUUID() }), callback);

test('trusted local principal resolution preserves four existing audiences and ignores forged identity headers', () => {
  for (const [token, audience] of [[env.AGENT_REGISTRY_TOKEN, 'operator'], [env.CITY_READ_TOKEN, 'city-read'],
    [env.CITY_INTERACTION_TOKEN, 'interaction'], [env.COLLABORATION_READ_TOKEN, 'collaboration-read']]) {
    const req = request(token);
    Object.assign(req.headers, { 'x-user-id': randomUUID(), 'x-owner-id': randomUUID(),
      'x-tenant-id': randomUUID(), 'x-forwarded-user': 'administrator', cookie: 'session=forged' });
    const p = assertLocalRequest(req, config, token);
    assert.equal(p.kind, 'LOCAL_CREDENTIAL'); assert.equal(p.ownerId, ownerId);
    assert.equal(p.audience, audience); assert.ok(Object.isFrozen(p));
    assert.ok(!JSON.stringify(p).includes(token)); assert.equal(p.userId, undefined);
    assert.equal(p.tenantId, undefined);
  }
});

test('invalid credentials and arbitrary caller-selected credential audiences never resolve a principal', () => {
  for (const credential of ['', 'Bearer forged', 'Basic forged', 'Bearer ' + env.CITY_READ_TOKEN]) {
    const req = request(''); req.headers.authorization = credential;
    assert.throws(() => assertLocalRequest(req, config, env.AGENT_REGISTRY_TOKEN), { status: 401 });
  }
  assert.throws(() => assertLocalRequest(request('unconfigured'), config, 'unconfigured'), { status: 403 });
});

test('forwarded identity/address headers do not replace actual socket host origin or environment checks', () => {
  const req = request(env.AGENT_REGISTRY_TOKEN);
  req.headers['x-forwarded-for'] = '127.0.0.1'; req.headers['x-forwarded-user'] = ownerId;
  for (const patch of [r => r.socket.remoteAddress = '10.1.2.3', r => r.headers.host = 'untrusted.example',
    r => r.headers.origin = 'https://untrusted.example']) {
    const next = structuredClone(req); patch(next);
    assert.throws(() => assertLocalRequest(next, config, env.AGENT_REGISTRY_TOKEN), { status: 403 });
  }
  assert.throws(() => assertLocalRequest(req, { ...config, nodeEnv: 'production' }, env.AGENT_REGISTRY_TOKEN), { status: 404 });
});

test('an unbound interaction context cannot bypass the operator authentication guard', () => run(() => {
  establishInteraction(scope);
  assert.throws(() => new LocalAccessGuard({ value: config }).canActivate(context(request(env.AGENT_REGISTRY_TOKEN))), { status: 403 });
}));

test('interaction authorization binds to the verified request rather than an inherited asynchronous principal', async () => {
  const guard = new LocalAccessGuard({ value: config });
  await run(async () => {
    const req = request(env.CITY_INTERACTION_TOKEN); establishInteraction(scope, req);
    await Promise.resolve(); assert.equal(guard.canActivate(context(req)), true);
    assert.throws(() => guard.canActivate(context(request(env.CITY_INTERACTION_TOKEN))), { status: 403 });
    const copied = { ...req }; assert.throws(() => guard.canActivate(context(copied)), { status: 403 });
  });
  assert.equal(interactionPrincipal(), undefined);
});

test('interaction authority cannot survive route or method rewriting', () => {
  for (const patch of [r => r.path = '/api/v1/agents', r => r.method = 'POST']) run(() => {
    const req = request(env.CITY_INTERACTION_TOKEN); establishInteraction(scope, req); patch(req);
    assert.throws(() => new LocalAccessGuard({ value: config }).canActivate(context(req)), { status: 403 });
  });
});

test('interaction authority revalidates token owner Agent grants and production restrictions at use', () => {
  const patches = [
    [{ ...config, interaction: { ...config.interaction, token: 'rotated'.repeat(8) } }, 401],
    [{ ...config, registry: { ...config.registry, ownerId: randomUUID() } }, 403],
    [{ ...config, interaction: { ...config.interaction, agentIds: [] } }, 403],
    [{ ...config, interaction: undefined }, 404], [{ ...config, nodeEnv: 'production' }, 404],
  ];
  for (const [changed, status] of patches) run(() => {
    const req = request(env.CITY_INTERACTION_TOKEN); establishInteraction(scope, req);
    assert.throws(() => new LocalAccessGuard({ value: changed }).canActivate(context(req)), { status });
  });
});

test('global exact-route guard issues request-bound scope only for the server-owned authorized Agent', async () => {
  const guard = new InteractionGuard({ value: config }, { agent: async id => ({ id, type: 'RULE_BASED' }) }, { info() {} });
  await run(async () => {
    const req = request(env.CITY_INTERACTION_TOKEN); req.headers['x-owner-id'] = randomUUID();
    assert.equal(await guard.canActivate(context(req)), true);
    assert.deepEqual(interactionPrincipal(), scope);
    assert.equal(new LocalAccessGuard({ value: config }).canActivate(context(req)), true);
  });
});

test('concurrent request scopes cannot adopt another request grant or leak identity into log context', async () => {
  await Promise.all(Array.from({ length: 25 }, () => run(async () => {
    const req = request(env.CITY_INTERACTION_TOKEN); establishInteraction(scope, req);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(new LocalAccessGuard({ value: config }).canActivate(context(req)), true);
    assert.deepEqual(Object.keys(requestContext.getStore()), ['requestId']);
    assert.throws(() => new LocalAccessGuard({ value: config }).canActivate(context(request(env.CITY_INTERACTION_TOKEN))), { status: 403 });
  })));
});
