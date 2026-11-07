const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createApplication } = require('../dist/application');
const { validateEnvironment } = require('../dist/config/configuration');
const { ExecutionsService } = require('../dist/executions/executions.service');
const { TaskLifecycleService } = require('../dist/lifecycle/task-lifecycle.service');
const { ApiLogger } = require('../dist/common/api-logger');
const { assertEnvelope } = require('../dist/events/contracts/event-contracts');

// Loaded by the existing owned-container harness, never by a developer DATABASE_URL.
module.exports = ({ row, getUrl, getPool }) => {
  test('Phase 1 acceptance: HTTP registry/task, trusted attempt/lifecycle, audit and new-instance persistence', async () => {
    const owner = await row("INSERT INTO owners(name) VALUES ('t08-disposable-scope') RETURNING id");
    const route = await row(`INSERT INTO orchestrators(owner_id,name,type,registration_status)
      VALUES ($1,'t08-route','native','ENABLED') RETURNING id`, [owner.id]);
    const token = randomBytes(32).toString('hex'), logs = [];
    const config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: getUrl(), DATABASE_SSL_MODE: 'disable',
      AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: owner.id, AGENT_REGISTRY_TOKEN: token });
    let app;
    const open = async () => {
      app = await createApplication(config);
      app.get(ApiLogger).info = (...args) => logs.push(args);
      app.get(ApiLogger).error = (...args) => logs.push(args);
      await app.listen(0, '127.0.0.1');
    };
    const request = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(`${await app.getUrl()}${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
    const versions = state => ({ taskVersion: state.task.version, executionVersion: state.execution.version });
    try {
      await open();
      assert.deepEqual(await request('/health'), { status: 200, data: { status: 'ok', service: 'elyqreth-api' } });
      const registered = await request('/api/v1/agents', 'POST', {
        name: 'Acceptance Agent', type: 'RULE_BASED', orchestratorId: route.id,
        configuration: { category: 'test' }, capabilities: ['acceptance'],
      });
      assert.equal(registered.status, 201); assert.equal(registered.data.lifecycleStatus, 'DISABLED');
      const agent = (await request(`/api/v1/agents/${registered.data.id}/activate`, 'POST', {},
        { 'if-match': `"${registered.data.version}"` })).data;
      assert.equal(agent.lifecycleStatus, 'ACTIVE');
      assert.deepEqual((await request(`/api/v1/agents/${agent.id}`)).data, agent);
      const input = { agentId: agent.id, input: { instruction: 'T08 private input marker' }, idempotencyKey: 't08-full-flow' };
      const created = await request('/api/v1/tasks', 'POST', input);
      assert.equal(created.status, 201); assert.equal(created.data.status, 'CREATED');
      assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE task_id=$1', [created.data.id])).n, 0);
      assert.deepEqual((await request(`/api/v1/tasks/${created.data.id}`)).data, created.data);
      // T06 queue atomically creates OR adopts a pending attempt. Exercise T05's
      // trusted allocator first, then adoption; no direct SQL status mutation.
      const pending = await app.get(ExecutionsService).createPending(created.data.id, 'NATIVE');
      const life = app.get(TaskLifecycleService);
      const queued = await life.queueTask(created.data.id, { taskVersion: created.data.version, authority: 'NATIVE' });
      assert.equal(queued.execution.id, pending.id); assert.equal(queued.execution.status, 'PENDING');
      const started = await life.startTask(queued.task.id, pending.id, versions(queued));
      const result = await row('INSERT INTO execution_results(owner_id,execution_id,body) VALUES ($1,$2,$3) RETURNING id',
        [owner.id, pending.id, { summary: 'T08 test result only; no model called' }]);
      const completed = await life.completeTask(started.task.id, pending.id,
        { ...versions(started), resultReference: `result:${result.id}` });
      assert.equal(completed.task.status, 'COMPLETED'); assert.equal(completed.execution.status, 'SUCCEEDED');
      const saved = await row(`SELECT t.status AS task_status,e.status AS execution_status,
        t.completed_at=e.finished_at AS aligned,e.result_reference FROM tasks t
        JOIN executions e ON e.task_id=t.id WHERE e.id=$1`, [pending.id]);
      assert.deepEqual(saved, { task_status: 'COMPLETED', execution_status: 'SUCCEEDED', aligned: true, result_reference: `result:${result.id}` });
      const paths = [`/api/v1/agents/${agent.id}`, `/api/v1/tasks/${created.data.id}`,
        `/api/v1/tasks/${created.data.id}/executions`, `/api/v1/tasks/${created.data.id}/executions/${pending.id}`,
        `/api/v1/tasks/${created.data.id}/events`, `/api/v1/agents/${agent.id}/events`, `/api/v1/executions/${pending.id}/events`];
      const before = await Promise.all(paths.map(path => request(path)));
      before.forEach(response => assert.equal(response.status, 200));
      assert.equal(before[2].data.items.length, 1);
      const events = before[4].data.items;
      assert.deepEqual(events.map(e => e.eventType), ['task.created', 'execution.created', 'task.queued',
        'execution.started', 'task.started', 'execution.completed', 'task.completed']);
      events.forEach(assertEnvelope);
      assert.equal(events[3].correlationId, events[4].correlationId);
      assert.equal(events[5].correlationId, events[6].correlationId);
      assert.equal(new Set(events.map(e => e.eventId)).size, events.length);
      assert.equal((await getPool().query('SELECT id FROM event_outbox WHERE owner_id=$1', [owner.id])).rowCount, 9);
      await app.close(); await open(); // New Nest instance and new DB pool.
      assert.deepEqual(await Promise.all(paths.map(path => request(path))), before);
      const replay = await request('/api/v1/tasks', 'POST', input);
      assert.equal(replay.status, 200); assert.equal(replay.data.id, created.data.id); assert.equal(replay.data.status, 'COMPLETED');
      await assert.rejects(app.get(TaskLifecycleService).completeTask(completed.task.id, pending.id, versions(completed)),
        error => error.code === 'ALREADY_TERMINAL');
      assert.deepEqual((await request(paths[4])).data, before[4].data);
      for (const path of [`/api/v1/tasks/${created.data.id}/start`, `/api/v1/tasks/${created.data.id}/executions`, '/api/v1/events']) {
        assert.equal((await request(path, 'POST', {})).status, 404);
      }
      const exposed = JSON.stringify({ responses: before, logs });
      for (const secret of [token, 'T08 private input marker', result.id]) assert.ok(!exposed.includes(secret));
    } finally { await app?.close(); }
  });
};
