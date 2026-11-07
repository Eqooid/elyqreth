// Registered by database.integration.cjs: reuses only its isolated, labeled PostgreSQL server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createApplication } = require('../dist/application');
const { validateEnvironment } = require('../dist/config/configuration');
const { ApiLogger } = require('../dist/common/api-logger');

module.exports = ({ row, getUrl, getPool }) => {
  async function fixture() {
    const owner = await row("INSERT INTO owners(name) VALUES ('registry-test-owner') RETURNING id");
    const orchestrator = await row("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'registry-test','native') RETURNING id", [owner.id]);
    const token = randomBytes(32).toString('hex');
    const config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: getUrl(), DATABASE_SSL_MODE: 'disable',
      AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: owner.id, AGENT_REGISTRY_TOKEN: token });
    let app;
    const logs = [];
    async function open() {
      app = await createApplication(config);
      app.get(ApiLogger).info = (...args) => logs.push(args);
      app.get(ApiLogger).error = (...args) => logs.push(args);
      await app.listen(0, '127.0.0.1');
    }
    await open();
    return { owner, orchestrator, config, logs,
      input: patch => ({ name: '  Research   Agent ', type: 'LLM', orchestratorId: orchestrator.id,
        capabilities: ['research'], configuration: { category: 'research' }, ...patch }),
      async request(path = '', method = 'GET', body, headers = {}) {
        const response = await fetch(`${await app.getUrl()}/api/v1/agents${path}`, {
          method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        return { status: response.status, data, headers: response.headers };
      },
      async restart() { await app.close(); await open(); },
      async close() { await app.close(); },
    };
  }

  test('registry HTTP registration persists, permits duplicate display names, and survives Nest restart', async () => {
    const f = await fixture();
    try {
      const created = await f.request('', 'POST', f.input());
      assert.equal(created.status, 201); assert.equal(created.data.name, 'Research Agent');
      assert.equal(created.data.lifecycleStatus, 'DISABLED'); assert.equal(created.data.version, 1);
      assert.equal(created.data.configuration, undefined); assert.equal(created.data.ownerId, undefined);
      const stored = await row('SELECT * FROM agents WHERE id=$1', [created.data.id]);
      assert.equal(stored.owner_id, f.owner.id); assert.equal(stored.orchestrator_id, f.orchestrator.id);
      assert.deepEqual(stored.configuration, { category: 'research' });
      assert.equal((await f.request('', 'POST', f.input())).status, 201);
      await f.restart();
      assert.deepEqual((await f.request('/' + created.data.id)).data, created.data);
      assert.equal((await f.request('/' + randomUUID())).status, 404);
      assert.equal((await row('SELECT count(*)::int AS count FROM agent_events WHERE agent_id=$1', [stored.id])).count, 1);
      assert.equal((await row('SELECT count(*)::int AS count FROM command_audit WHERE resource_id=$1', [stored.id])).count, 1);
    } finally { await f.close(); }
  });

  test('registry validates IDs, bodies, routing and sensitive fields without response/log leakage', async () => {
    const f = await fixture();
    try {
      const other = await row("INSERT INTO owners(name) VALUES ('other-owner') RETURNING id");
      const foreign = await row("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'other','external') RETURNING id", [other.id]);
      for (const patch of [{ orchestratorId: randomUUID() }, { orchestratorId: foreign.id },
        { orchestratorId: null }, { ownerId: other.id }, { id: randomUUID() }, { lifecycleStatus: 'ACTIVE' },
        { name: '' }, { configuration: { apiKey: 'never-expose-this-secret' } },
        { configuration: { category: 'research', nested: { credentials: 'never-expose-this-secret' } } },
        { capabilities: ['x','x'] }, { name: 'x'.repeat(161) }]) {
        const result = await f.request('', 'POST', f.input(patch));
        assert.equal(result.status, 400, JSON.stringify(patch));
        assert.equal(result.data.message, 'Request is invalid.');
        assert.ok(!JSON.stringify(result.data).includes('never-expose'));
      }
      assert.equal((await f.request('/invalid')).status, 400);
      assert.equal((await f.request('?unknown=true')).status, 400);
      assert.equal((await f.request('', 'POST', f.input(JSON.parse('{"constructor":"prohibited"}')))).status, 400);
      assert.equal((await f.request('', 'POST', f.input({ configuration: JSON.parse('{"__proto__":{"token":"never-expose-this-secret"}}') }))).status, 400);
      assert.equal((await f.request('', 'POST', f.input({ description: 'x'.repeat(70000) }))).status, 413);
      assert.ok(!JSON.stringify(f.logs).includes('never-expose'));
      assert.equal((await row('SELECT count(*)::int AS count FROM agents WHERE owner_id=$1', [f.owner.id])).count, 0);
    } finally { await f.close(); }
  });

  test('registry token, origin and owner boundaries protect every route and preserve safe errors', async () => {
    const f = await fixture(), other = await fixture();
    try {
      const agent = (await other.request('', 'POST', other.input())).data;
      for (const [path, method] of [['','GET'],['','POST'],['/'+agent.id,'GET'],['/'+agent.id,'PATCH'],
        ['/'+agent.id+'/activate','POST'],['/'+agent.id+'/disable','POST'],['/'+agent.id+'/archive','POST']]) {
        assert.equal((await f.request(path, method, undefined, { authorization: '' })).status, 401);
      }
      assert.equal((await f.request('', 'GET', undefined, { origin: 'https://evil.example' })).status, 403);
      assert.equal((await f.request('/'+agent.id)).status, 404);
      assert.equal((await f.request('/'+agent.id, 'PATCH', { name: 'stolen' }, { 'if-match': '"1"' })).status, 404);
      assert.equal((await f.request('/'+agent.id+'/disable', 'POST', {}, { 'if-match': '"1"' })).status, 404);
      assert.equal((await f.request()).data.items.length, 0);
    } finally { await f.close(); await other.close(); }
  });

  test('registry filters and pagination use deterministic ordering with a unique tie breaker', async () => {
    const f = await fixture();
    try {
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push((await f.request('', 'POST', f.input({ name: 'same%name', type: 'RULE_BASED' }))).data.id);
      // Deliberately tie creation times so ordering must use UUID as a tiebreaker.
      const first = await row('SELECT created_at FROM agents WHERE id=$1', [ids[0]]);
      // created_at is immutable; use a separate single INSERT statement for the tie fixture.
      await getPool().query("INSERT INTO agents(owner_id,orchestrator_id,name,type) SELECT $1,$2,'tied','EXTERNAL' FROM generate_series(1,3)", [f.owner.id, f.orchestrator.id]);
      assert.ok(first.created_at);
      const page1 = await f.request('?limit=2&type=EXTERNAL');
      const page2 = await f.request('?limit=2&offset=2&type=EXTERNAL');
      assert.equal(page1.data.pagination.hasMore, true); assert.equal(page2.data.pagination.hasMore, false);
      const tied = [...page1.data.items, ...page2.data.items];
      assert.equal(new Set(tied.map(a => a.id)).size, 3);
      assert.deepEqual(tied.map(a => a.id), tied.map(a => a.id).sort());
      assert.deepEqual((await f.request('?limit=2&type=EXTERNAL')).data, page1.data);
      for (const query of ['?status=DISABLED&type=RULE_BASED', '?search=%25name', '?orchestratorId='+f.orchestrator.id+'&type=RULE_BASED'])
        assert.equal((await f.request(query)).data.items.length, 5);
      for (const query of ['?limit=101', '?offset=-1', '?limit=1.5', '?status=RUNNING', '?limit=1&limit=2'])
        assert.equal((await f.request(query)).status, 400);
    } finally { await f.close(); }
  });

  test('metadata patches preserve omitted fields, clear description, reject reassignment and enforce versions', async () => {
    const f = await fixture();
    try {
      const agent = (await f.request('', 'POST', f.input({ description: 'original' }))).data;
      const path = '/'+agent.id;
      assert.equal((await f.request(path, 'PATCH', { name: 'updated' })).status, 400);
      for (const body of [{}, { orchestratorId: f.orchestrator.id }, { lifecycleStatus: 'ACTIVE' }, { type: 'EXTERNAL' }])
        assert.equal((await f.request(path, 'PATCH', body, { 'if-match': '"1"' })).status, 400);
      const updated = await f.request(path, 'PATCH', { name: ' Updated ', description: null, configuration: {} }, { 'if-match': '"1"' });
      assert.equal(updated.status, 200); assert.equal(updated.data.version, 2);
      assert.equal(updated.data.description, null); assert.equal(updated.data.name, 'Updated');
      assert.deepEqual(updated.data.capabilities, ['research']); assert.equal(updated.data.lifecycleStatus, 'DISABLED');
      assert.equal((await f.request(path, 'PATCH', { name: 'lost update' }, { 'if-match': '"1"' })).status, 409);
      assert.equal((await row('SELECT name FROM agents WHERE id=$1', [agent.id])).name, 'Updated');
      const concurrent = await Promise.all(['one','two'].map(name => f.request(path, 'PATCH', { name }, { 'if-match': '"2"' })));
      assert.deepEqual(concurrent.map(r => r.status).sort(), [200,409]);
      assert.equal((await row('SELECT count(*)::int AS count FROM agent_events WHERE agent_id=$1', [agent.id])).count, 3);
    } finally { await f.close(); }
  });

  test('administrative transitions are persistent, idempotent and archive is irreversible', async () => {
    const f = await fixture();
    try {
      let agent = (await f.request('', 'POST', f.input())).data;
      for (const [action, status] of [['activate','ACTIVE'], ['disable','DISABLED'], ['archive','ARCHIVED']]) {
        const headers = { 'if-match': `"${agent.version}"` };
        const result = await f.request(`/${agent.id}/${action}`, 'POST', {}, headers);
        assert.equal(result.status, 200); assert.equal(result.data.lifecycleStatus, status);
        const again = await f.request(`/${agent.id}/${action}`, 'POST', {}, headers);
        assert.deepEqual(again.data, result.data); agent = result.data;
      }
      const headers = { 'if-match': `"${agent.version}"` };
      assert.equal((await f.request(`/${agent.id}/activate`, 'POST', {}, headers)).status, 409);
      assert.equal((await f.request(`/${agent.id}`, 'PATCH', { name: 'resurrect' }, headers)).status, 409);
      assert.equal((await f.request(`/${agent.id}/archive`, 'POST', { unexpected: true }, headers)).status, 400);
      assert.equal((await row('SELECT count(*)::int AS count FROM agent_events WHERE agent_id=$1', [agent.id])).count, 4);
      await f.restart(); assert.equal((await f.request('/'+agent.id)).data.lifecycleStatus, 'ARCHIVED');
      for (const table of ['tasks','executions'])
        assert.equal((await row(`SELECT count(*)::int AS count FROM ${table} WHERE owner_id=$1`, [f.owner.id])).count, 0);
    } finally { await f.close(); }
  });

  test('registry transaction rolls back agent/event/outbox if audit persistence fails', async () => {
    const f = await fixture();
    try {
      // Fault injection only in this disposable test database, scoped to this unique owner.
      await getPool().query(`CREATE FUNCTION registry_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.owner_id = '${f.owner.id}'::uuid THEN RAISE EXCEPTION 'audit-fault-private' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
      await getPool().query('CREATE TRIGGER registry_test_failure BEFORE INSERT ON command_audit FOR EACH ROW EXECUTE FUNCTION registry_test_failure()');
      try {
        const response = await f.request('', 'POST', f.input());
        assert.equal(response.status, 400); assert.ok(!JSON.stringify(response.data).includes('audit-fault-private'));
        for (const table of ['agents','agent_events','event_outbox','command_audit'])
          assert.equal((await row(`SELECT count(*)::int AS count FROM ${table} WHERE owner_id=$1`, [f.owner.id])).count, 0);
      } finally {
        await getPool().query('DROP TRIGGER registry_test_failure ON command_audit');
        await getPool().query('DROP FUNCTION registry_test_failure()');
      }
    } finally { await f.close(); }
  });

  test('enabled registry requires an existing owner and legacy configuration is never exposed', async () => {
    const f = await fixture();
    try {
      const agent = (await f.request('', 'POST', f.input())).data;
      await getPool().query('UPDATE agents SET configuration=$1 WHERE id=$2', [{ legacy: { token: 'legacy-private-value' } }, agent.id]);
      for (const path of ['', '/'+agent.id])
        assert.ok(!JSON.stringify((await f.request(path)).data).includes('legacy-private-value'));
      const invalid = await createApplication({ ...f.config, registry: { ...f.config.registry, ownerId: randomUUID() } });
      try { await assert.rejects(invalid.init(), /owner scope does not exist/); }
      finally { await invalid.close(); }
    } finally { await f.close(); }
  });
};
