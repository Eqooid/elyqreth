// Uses only database.integration.cjs's isolated, labeled PostgreSQL container.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdtempSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { createApplication } = require('../dist/application');
const { validateEnvironment } = require('../dist/config/configuration');
const { ApiLogger } = require('../dist/common/api-logger');
const { ExecutionsService } = require('../dist/executions/executions.service');
const { DatabaseService } = require('../dist/database/database.module');
const { migrateDatabase, migrationFolder } = require('../dist/database/migrate');

module.exports = ({ row, getUrl, getPool }) => {
  async function fixture() {
    const owner = await row("INSERT INTO owners(name) VALUES ('task-test-owner') RETURNING id");
    const orchestrator = await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'task-route','native','ENABLED') RETURNING id", [owner.id]);
    const token = randomBytes(32).toString('hex');
    const config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: getUrl(), DATABASE_SSL_MODE: 'disable',
      AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: owner.id, AGENT_REGISTRY_TOKEN: token });
    let app;
    const logs = [];
    const open = async () => {
      app = await createApplication(config);
      app.get(ApiLogger).info = (...args) => logs.push(args);
      app.get(ApiLogger).error = (...args) => logs.push(args);
      await app.listen(0, '127.0.0.1');
    };
    const request = async (path = 'tasks', method = 'GET', body, headers = {}) => {
      const response = await fetch(`${await app.getUrl()}/api/v1/${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    };
    await open();
    const registered = await request('agents', 'POST', { name: 'Task target', type: 'RULE_BASED',
      orchestratorId: orchestrator.id, configuration: { category: 'research' } });
    assert.equal(registered.status, 201);
    const active = await request(`agents/${registered.data.id}/activate`, 'POST', {}, { 'if-match': '"1"' });
    assert.equal(active.status, 200);
    return { owner, orchestrator, agent: active.data, config, request, logs,
      input: patch => ({ agentId: active.data.id, input: { instruction: 'Summarize public document', context: 'Public text' }, ...patch }),
      allocate: (taskId, authority = 'NATIVE') => app.get(ExecutionsService).createPending(taskId, authority),
      rollbackAllocation: taskId => app.get(DatabaseService).db.transaction(async tx => {
        await app.get(ExecutionsService).createPendingInTransaction(tx, taskId, 'NATIVE');
        throw new Error('outer-transaction-rollback');
      }),
      async restart() { await app.close(); await open(); },
      async close() { await app.close(); },
    };
  }

  test('T05 index migration upgrades an actual T03 schema without losing existing task data', async () => {
    const isolated = new URL(getUrl());
    const database = isolated.pathname.slice(1) + '_t05_upgrade';
    assert.match(database, /^elyqreth_test_[a-f0-9]{24}_t05_upgrade$/);
    await getPool().query(`CREATE DATABASE "${database}"`);
    isolated.pathname = '/' + database;
    const pool = new Pool({ connectionString: isolated.href, max: 1 });
    const temp = mkdtempSync(join(tmpdir(), 'elyqreth-t05-upgrade-'));
    try {
      mkdirSync(join(temp, 'meta'));
      const journal = JSON.parse(readFileSync(join(migrationFolder, 'meta/_journal.json'), 'utf8'));
      const expectedMigrations = journal.entries.length;
      journal.entries = journal.entries.slice(0, 2);
      writeFileSync(join(temp, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries) copyFileSync(join(migrationFolder, entry.tag+'.sql'), join(temp, entry.tag+'.sql'));
      await migrate(drizzle(pool), { migrationsFolder: temp });
      const owner = (await pool.query("INSERT INTO owners(name) VALUES ('existing-owner') RETURNING id")).rows[0];
      const orch = (await pool.query("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'existing','native') RETURNING id", [owner.id])).rows[0];
      const agent = (await pool.query("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'existing','RULE_BASED') RETURNING id", [owner.id,orch.id])).rows[0];
      const task = (await pool.query('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,$4) RETURNING *', [owner.id,agent.id,orch.id,{ instruction: 'existing data' }])).rows[0];
      const config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: isolated.href, DATABASE_SSL_MODE: 'disable' });
      await migrateDatabase(config.database);
      const retained = (await pool.query('SELECT * FROM tasks WHERE id=$1', [task.id])).rows[0];
      assert.deepEqual(retained, task);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count, expectedMigrations);
      assert.ok((await pool.query("SELECT to_regclass('public.tasks_owner_created_idx') AS value")).rows[0].value);
    } finally {
      await pool.end();
      assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
      assert.ok(basename(temp).startsWith('elyqreth-t05-upgrade-'));
      rmSync(temp, { recursive: true });
    }
  });

  test('Task HTTP create/get persist across restart and create no execution or automatic transition', async () => {
    const f = await fixture();
    try {
      const response = await f.request('tasks', 'POST', f.input());
      assert.equal(response.status, 201); assert.equal(response.data.status, 'CREATED');
      assert.equal(response.data.completedAt, null); assert.equal(response.data.version, 1);
      assert.equal(response.data.input, undefined); assert.equal(response.data.ownerId, undefined);
      const stored = await row('SELECT * FROM tasks WHERE id=$1', [response.data.id]);
      assert.deepEqual(stored.input, f.input().input); assert.equal(stored.idempotency_key, null);
      assert.equal(stored.agent_id, f.agent.id); assert.equal(stored.orchestrator_id, f.orchestrator.id);
      assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1', [stored.id])).count, 0);
      assert.equal((await f.request(`tasks/${stored.id}/executions`)).data.items.length, 0);
      await f.restart();
      assert.deepEqual((await f.request(`tasks/${stored.id}`)).data, response.data);
      const event = await row("SELECT * FROM agent_events WHERE task_id=$1 AND event_type='task.created'", [stored.id]);
      assert.deepEqual(event.payload, { status: 'CREATED', version: 1 });
      assert.ok(!JSON.stringify(f.logs).includes('Public text'));
    } finally { await f.close(); }
  });

  test('Task creation validates association, lifecycle, route enablement and untrusted request content', async () => {
    const f = await fixture(), other = await fixture();
    try {
      for (const patch of [{ agentId: randomUUID() }, { agentId: other.agent.id }, { agentId: 'invalid' },
        { ownerId: other.owner.id }, { orchestratorId: f.orchestrator.id }, { status: 'RUNNING' },
        { completedAt: new Date().toISOString() }, { input: { instruction: 'x', token: 'do-not-store' } },
        { input: { instruction: 'password=do-not-store' } }, { input: { instruction: '界'.repeat(12000) } },
        { input: JSON.parse('{"instruction":"x","constructor":"do-not-store"}') },
        JSON.parse('{"constructor":"do-not-store"}'), { idempotencyKey: null }]) {
        const response = await f.request('tasks', 'POST', f.input(patch));
        assert.equal(response.status, 400, JSON.stringify(patch));
        assert.ok(!JSON.stringify(response.data).includes('do-not-store'));
      }
      assert.equal((await f.request('tasks', 'POST', f.input({ input: { instruction: 'x'.repeat(70000) } }))).status, 413);
      assert.equal((await f.request('tasks', 'POST', f.input(), { 'content-type': 'text/plain' })).status, 415);
      await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1", [f.agent.id]);
      assert.equal((await f.request('tasks', 'POST', f.input())).status, 409);
      await getPool().query("UPDATE agents SET lifecycle_status='ARCHIVED' WHERE id=$1", [f.agent.id]);
      assert.equal((await f.request('tasks', 'POST', f.input())).status, 409);
      await getPool().query("UPDATE agents SET lifecycle_status='ACTIVE' WHERE id=$1", [f.agent.id]);
      await getPool().query("UPDATE orchestrators SET registration_status='DISABLED' WHERE id=$1", [f.orchestrator.id]);
      assert.equal((await f.request('tasks', 'POST', f.input())).status, 409);
      await getPool().query("UPDATE orchestrators SET registration_status='ENABLED',connectivity_status='DISCONNECTED' WHERE id=$1", [f.orchestrator.id]);
      assert.equal((await f.request('tasks', 'POST', f.input())).status, 201);
      assert.ok(!JSON.stringify(f.logs).includes('do-not-store'));
    } finally { await f.close(); await other.close(); }
  });

  test('Task idempotency is owner-scoped and safe under concurrent canonical equivalent requests', async () => {
    const f = await fixture(), other = await fixture();
    try {
      const requests = await Promise.all(Array.from({ length: 8 }, (_, i) => f.request('tasks', 'POST',
        f.input({ agentId: i % 2 ? f.agent.id.toUpperCase() : f.agent.id, idempotencyKey: 'same-key',
          input: i % 2 ? { context: 'Public text', instruction: 'Summarize public document' } : f.input().input }))));
      assert.equal(requests.filter(r => r.status === 201).length, 1);
      assert.equal(requests.filter(r => r.status === 200).length, 7);
      const id = requests[0].data.id;
      assert.equal(new Set(requests.map(r => r.data.id)).size, 1);
      assert.equal((await row('SELECT count(*)::int AS count FROM tasks WHERE owner_id=$1', [f.owner.id])).count, 1);
      assert.equal((await row('SELECT count(*)::int AS count FROM agent_events WHERE task_id=$1', [id])).count, 1);
      assert.equal((await row('SELECT count(*)::int AS count FROM command_audit WHERE resource_id=$1', [id])).count, 1);
      const conflicting = await f.request('tasks', 'POST', f.input({ idempotencyKey: 'same-key', input: { instruction: 'different' } }));
      assert.equal(conflicting.status, 409);
      const race = await Promise.all(['first payload','second payload'].map(instruction => f.request('tasks', 'POST',
        f.input({ idempotencyKey: 'conflicting-race', input: { instruction } }))));
      assert.deepEqual(race.map(r=>r.status).sort(), [201,409]);
      assert.equal((await other.request('tasks', 'POST', other.input({ idempotencyKey: 'same-key' }))).status, 201);
      await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1", [f.agent.id]);
      assert.equal((await f.request('tasks', 'POST', f.input({ idempotencyKey: 'same-key' }))).status, 200);
      assert.equal((await f.request('tasks', 'POST', f.input({ idempotencyKey: 'new-key' }))).status, 409);
      await f.restart();
      assert.equal((await f.request('tasks', 'POST', f.input({ idempotencyKey: 'same-key' }))).data.id, id);
    } finally { await f.close(); await other.close(); }
  });

  test('Task listing filters dates/routes/status and uses stable ordering and bounded pagination', async () => {
    const f = await fixture();
    try {
      // Single statement creates deliberately tied timestamps using the real schema.
      await getPool().query("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) SELECT $1,$2,$3,$4 FROM generate_series(1,5)",
        [f.owner.id, f.agent.id, f.orchestrator.id, { instruction: 'tied times' }]);
      const first = await f.request('tasks?limit=2');
      const second = await f.request('tasks?limit=2&offset=2');
      const last = await f.request('tasks?limit=2&offset=4');
      const ids = [...first.data.items,...second.data.items,...last.data.items].map(t=>t.id);
      assert.equal(first.data.pagination.hasMore, true); assert.equal(last.data.pagination.hasMore, false);
      assert.equal(new Set(ids).size, 5); assert.deepEqual(ids, [...ids].sort());
      assert.deepEqual((await f.request('tasks?limit=2')).data, first.data);
      for (const query of ['status=CREATED', 'agentId='+f.agent.id, 'orchestratorId='+f.orchestrator.id,
        'createdFrom=2020-01-01T00:00:00Z&createdTo=2099-01-01T00:00:00Z'])
        assert.equal((await f.request('tasks?'+query)).data.items.length, 5);
      assert.equal((await f.request('tasks?status=FAILED')).data.items.length, 0);
      for (const query of ['limit=101','limit=1&limit=2','offset=-1','unknown=x','createdFrom=2026-02-30T00:00:00Z',
        'createdFrom=2027-01-01T00:00:00Z&createdTo=2026-01-01T00:00:00Z'])
        assert.equal((await f.request('tasks?'+query)).status, 400);
    } finally { await f.close(); }
  });

  test('Task and nested Execution reads enforce access, ownership, identifiers and parent relationships', async () => {
    const f = await fixture(), other = await fixture();
    try {
      const task = (await f.request('tasks', 'POST', f.input())).data;
      const otherTask = (await other.request('tasks', 'POST', other.input())).data;
      const execution = await f.allocate(task.id);
      for (const path of ['tasks','tasks/'+task.id,'tasks/'+task.id+'/executions','tasks/'+task.id+'/executions/'+execution.id])
        assert.equal((await f.request(path, 'GET', undefined, { authorization: '' })).status, 401);
      assert.equal((await f.request('tasks', 'POST', f.input(), { authorization: '' })).status, 401);
      assert.equal((await f.request('tasks', 'GET', undefined, { origin: 'https://evil.example' })).status, 403);
      for (const path of ['tasks/'+otherTask.id,'tasks/'+otherTask.id+'/executions','tasks/'+otherTask.id+'/executions/'+execution.id,
        'tasks/'+randomUUID(),'tasks/'+randomUUID()+'/executions']) assert.equal((await f.request(path)).status, 404);
      for (const path of ['tasks/invalid','tasks/invalid/executions','tasks/'+task.id+'/executions/invalid',
        'tasks/'+task.id+'?limit=1','tasks/'+task.id+'/executions?status=PENDING']) assert.equal((await f.request(path)).status, 400);
      assert.equal((await f.request('tasks/'+task.id+'/executions/'+randomUUID())).status, 404);
      assert.equal((await f.request('tasks/'+task.id+'/executions', 'POST', {})).status, 404);
      assert.equal((await f.request('tasks/'+task.id+'/executions/'+execution.id, 'PATCH', {})).status, 404);
      assert.equal((await f.request('tasks/'+task.id, 'DELETE')).status, 404);
    } finally { await f.close(); await other.close(); }
  });

  test('internal Execution allocation is atomic under concurrency and never transitions the Task', async () => {
    const f = await fixture();
    try {
      const task = (await f.request('tasks', 'POST', f.input())).data;
      await assert.rejects(f.rollbackAllocation(task.id), /outer-transaction-rollback/);
      assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1', [task.id])).count, 0);
      const allocations = await Promise.allSettled(Array.from({ length: 6 }, () => f.allocate(task.id)));
      assert.equal(allocations.filter(r=>r.status === 'fulfilled').length, 1);
      for (const rejected of allocations.filter(r=>r.status === 'rejected')) assert.equal(rejected.reason.getStatus(), 409);
      const attempt = allocations.find(r=>r.status === 'fulfilled').value;
      assert.equal(attempt.attemptNumber, 1); assert.equal(attempt.status, 'PENDING'); assert.equal(attempt.startedAt, null);
      const stored = await row('SELECT * FROM executions WHERE id=$1', [attempt.id]);
      assert.equal(stored.agent_id, task.agentId); assert.equal(stored.orchestrator_id, task.orchestratorId);
      assert.deepEqual(stored.agent_config_snapshot, { category: 'research' }); assert.equal(stored.config_version, f.agent.version);
      assert.equal((await f.request('tasks/'+task.id)).data.status, 'CREATED');
      assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1', [task.id])).count, 1);
      const other = (await f.request('tasks', 'POST', f.input())).data;
      assert.equal((await f.request(`tasks/${other.id}/executions/${attempt.id}`)).status, 404);
      await assert.rejects(f.allocate(randomUUID()), e=>e.getStatus() === 404);
    } finally { await f.close(); }
  });

  test('multiple attempts preserve prior history, deterministic numbering and sanitized execution reads', async () => {
    const f = await fixture();
    try {
      const task = (await f.request('tasks', 'POST', f.input())).data;
      const first = await f.allocate(task.id);
      // Only test fixture SQL terminalizes attempts; no T05 transition API/service is introduced.
      await getPool().query("UPDATE executions SET status='FAILED',finished_at=now(),error_code='PRIVATE_SECRET',error_message='private stack credentials',result_reference='https://private-token.example/result' WHERE id=$1", [first.id]);
      const firstStored = await row('SELECT * FROM executions WHERE id=$1', [first.id]);
      const second = await f.allocate(task.id, 'EXTERNAL');
      assert.equal(second.attemptNumber, 2);
      await getPool().query("UPDATE executions SET status='TIMED_OUT',finished_at=now() WHERE id=$1", [second.id]);
      const third = await f.allocate(task.id);
      assert.equal(third.attemptNumber, 3);
      await getPool().query("UPDATE agents SET configuration=$1 WHERE id=$2", [{ category: 'design' },f.agent.id]);
      assert.deepEqual((await row('SELECT agent_config_snapshot FROM executions WHERE id=$1', [third.id])).agent_config_snapshot,
        { category: 'research' });
      const page = await f.request(`tasks/${task.id}/executions?limit=2`);
      assert.deepEqual(page.data.items.map(e=>e.attemptNumber), [1,2]); assert.equal(page.data.pagination.hasMore, true);
      assert.equal(page.data.items[0].errorCode, 'EXECUTION_ERROR');
      assert.equal(page.data.items[1].errorCode, 'EXECUTION_TIMED_OUT');
      assert.ok(!JSON.stringify(page.data).includes('private'));
      const last = await f.request(`tasks/${task.id}/executions?limit=2&offset=2`);
      assert.deepEqual(last.data.items.map(e=>e.attemptNumber), [3]); assert.equal(last.data.pagination.hasMore, false);
      assert.deepEqual(await row('SELECT * FROM executions WHERE id=$1', [first.id]), firstStored);
      await f.restart();
      assert.equal((await f.request(`tasks/${task.id}/executions/${third.id}`)).data.id, third.id);
      await assert.rejects(getPool().query('DELETE FROM tasks WHERE id=$1', [task.id]), e=>e.code === '23514');
      await assert.rejects(getPool().query('INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number) VALUES ($1,$2,$3,$4,3)',
        [f.owner.id,task.id,f.agent.id,f.orchestrator.id]), e=>e.code === '23505');
    } finally { await f.close(); }
  });

  test('Execution primitive rejects terminal tasks, disabled agents, route mismatch, legacy credentials and previous success', async () => {
    const f = await fixture();
    try {
      const task = (await f.request('tasks', 'POST', f.input())).data;
      await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1", [f.agent.id]);
      await assert.rejects(f.allocate(task.id), e=>e.getStatus() === 409);
      await getPool().query("UPDATE agents SET lifecycle_status='ACTIVE',configuration=$1 WHERE id=$2", [{ legacy: { token: 'do-not-copy' } },f.agent.id]);
      await assert.rejects(f.allocate(task.id), e=>e.getStatus() === 409);
      await getPool().query("UPDATE agents SET configuration='{}' WHERE id=$1", [f.agent.id]);
      const another = await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'mismatched','external','ENABLED') RETURNING id", [f.owner.id]);
      await getPool().query('UPDATE agents SET orchestrator_id=$1 WHERE id=$2', [another.id,f.agent.id]);
      await assert.rejects(f.allocate(task.id), e=>e.getStatus() === 409);
      await getPool().query('UPDATE agents SET orchestrator_id=$1 WHERE id=$2', [f.orchestrator.id,f.agent.id]);
      const attempt = await f.allocate(task.id);
      await getPool().query("UPDATE executions SET status='SUCCEEDED',started_at=now(),finished_at=now() WHERE id=$1", [attempt.id]);
      await assert.rejects(f.allocate(task.id), e=>e.getStatus() === 409);
      const terminal = (await f.request('tasks', 'POST', f.input())).data;
      await getPool().query("UPDATE tasks SET status='CANCELLED',completed_at=now() WHERE id=$1", [terminal.id]);
      await assert.rejects(f.allocate(terminal.id), e=>e.getStatus() === 409);
    } finally { await f.close(); }
  });

  test('Task/Execution creation rolls back all records when accepted-command audit cannot persist', async () => {
    const f = await fixture();
    try {
      const task = (await f.request('tasks', 'POST', f.input())).data;
      await getPool().query(`CREATE FUNCTION t05_test_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.owner_id = '${f.owner.id}'::uuid THEN RAISE EXCEPTION 'private fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
      await getPool().query('CREATE TRIGGER t05_test_audit_fault BEFORE INSERT ON command_audit FOR EACH ROW EXECUTE FUNCTION t05_test_audit_fault()');
      try {
        assert.equal((await f.request('tasks', 'POST', f.input({ idempotencyKey: 'rollback' }))).status, 400);
        await assert.rejects(f.allocate(task.id), e=>e.getStatus() === 400);
        assert.equal((await row('SELECT count(*)::int AS count FROM tasks WHERE owner_id=$1', [f.owner.id])).count, 1);
        assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1', [task.id])).count, 0);
        assert.equal((await row('SELECT count(*)::int AS count FROM agent_events WHERE task_id=$1', [task.id])).count, 1);
        assert.equal((await row('SELECT count(*)::int AS count FROM event_outbox WHERE owner_id=$1', [f.owner.id])).count, 3); // register, activate, task
      } finally {
        await getPool().query('DROP TRIGGER t05_test_audit_fault ON command_audit');
        await getPool().query('DROP FUNCTION t05_test_audit_fault()');
      }
      const attempt = await f.allocate(task.id);
      assert.equal(attempt.attemptNumber, 1);
      assert.equal((await f.request('tasks', 'POST', f.input({ idempotencyKey: 'rollback' }))).status, 201);
    } finally { await f.close(); }
  });
};
