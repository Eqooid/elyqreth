const { closedApplication } = require('./helpers/production-configuration.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { CreateTaskDto, ListTasksQueryDto, PaginationQueryDto, validTaskInput } = require('../dist/tasks/dto/task.dto');
const { TasksService, serializeTask, taskRequestHash } = require('../dist/tasks/tasks.service');
const { ExecutionsService, nextAttemptNumber, serializeExecution, executionConfigurationSnapshot } = require('../dist/executions/executions.service');
const { safePersistence } = require('../dist/common/persistence');
const { createApplication } = require('../dist/application');
const { validateEnvironment } = require('../dist/config/configuration');

const request = () => ({ agentId: randomUUID(), input: { instruction: 'Summarize a document', context: 'Public source text' } });
const check = (Class, input) => validate(plainToInstance(Class, input), {
  whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
});

test('task request accepts an agent and bounded instruction/context without runtime settings', async () => {
  assert.deepEqual(await check(CreateTaskDto, request()), []);
  assert.deepEqual(await check(CreateTaskDto, { ...request(), idempotencyKey: 'client:request-1' }), []);
  assert.ok(validTaskInput({ instruction: 'Document\ncontent', context: '' }));
});

test('task input rejects credentials, unsafe structure, excess bytes and unsupported fields', async () => {
  for (const input of [null, [], 'instruction', {}, { instruction: '  ' }, { instruction: 1 },
    { instruction: 'x'.repeat(16001) }, { instruction: '界'.repeat(12000) },
    { instruction: 'x', password: 'private' }, { instruction: 'x', context: null },
    { instruction: 'password=do-not-store' }, { instruction: 'Bearer abcdefghijklmnop' },
    { instruction: 'sk-'+'a'.repeat(32) }, { instruction: '-----BEGIN PRIVATE KEY-----' },
    { instruction: 'https://user:password@example.com' }, { instruction: 'text\0' },
  ]) {
    assert.equal(validTaskInput(input), false);
    assert.ok((await check(CreateTaskDto, { ...request(), input })).length);
  }
  // HTTP guard checks these raw keys before class-transformer sees them.
  assert.equal(validTaskInput(JSON.parse('{"instruction":"text","constructor":"bad"}')), false);
  for (const patch of [{ agentId: 'bad' }, { agentId: null }, { status: 'RUNNING' }, { ownerId: randomUUID() },
    { orchestratorId: randomUUID() }, { idempotencyKey: null }, { idempotencyKey: '' },
    { idempotencyKey: 'x'.repeat(129) }, { idempotencyKey: 'bad key' }])
    assert.ok((await check(CreateTaskDto, { ...request(), ...patch })).length);
});

test('task canonical hashes ignore object key order/UUID case and preserve actual content differences', () => {
  const original = request();
  const hash = taskRequestHash(original);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(taskRequestHash({ agentId: original.agentId.toUpperCase(), input: {
    context: original.input.context, instruction: original.input.instruction } }), hash);
  assert.notEqual(taskRequestHash({ ...original, input: { ...original.input, instruction: original.input.instruction+' ' } }), hash);
  assert.notEqual(taskRequestHash({ ...original, agentId: randomUUID() }), hash);
});

test('task list dates and pagination are explicit, strict and bounded', async () => {
  assert.deepEqual(await check(ListTasksQueryDto, { limit: '10', offset: '0', status: 'CREATED',
    createdFrom: '2026-10-21T00:00:00Z', createdTo: '2026-10-22T01:02:03.123Z' }), []);
  for (const query of [{ limit: 101 }, { offset: 10001 }, { limit: ['1','2'] }, { status: 'PENDING' },
    { createdFrom: '2026-02-30T00:00:00Z' }, { createdTo: 'yesterday' }, { createdTo: '2026-10-21' },
    { createdTo: '2026-10-21T24:00:00Z' }, { createdTo: '2026-10-21T00:00:00+07:00' }, { unexpected: true }])
    assert.ok((await check(ListTasksQueryDto, query)).length, JSON.stringify(query));
  assert.ok((await check(PaginationQueryDto, { status: 'FAILED' })).length);
});

test('internal calls validate task input/identifiers/authority and reversed dates before querying', async () => {
  const tasks = new TasksService({}, {}), executions = new ExecutionsService({}, {});
  await assert.rejects(tasks.create({ agentId: 'invalid', input: {} }), e => e.getStatus() === 400);
  await assert.rejects(tasks.list({ createdFrom: '2026-10-22T00:00:00Z', createdTo: '2026-10-21T00:00:00Z' }), e => e.getStatus() === 400);
  await assert.rejects(executions.createPending('invalid', 'NATIVE'), e => e.getStatus() === 400);
  await assert.rejects(executions.createPending(randomUUID(), 'UNKNOWN'), e => e.getStatus() === 400);
});

test('attempt number and configuration snapshots reject overflow and legacy secrets', () => {
  assert.equal(nextAttemptNumber(0), 1); assert.equal(nextAttemptNumber(8), 9);
  for (const n of [-1, 1.5, 2147483647]) assert.throws(() => nextAttemptNumber(n), e => e.getStatus() === 409);
  const metadata = { category: 'research', color: '#abcdef' };
  assert.deepEqual(executionConfigurationSnapshot(metadata), metadata);
  assert.notEqual(executionConfigurationSnapshot(metadata), metadata);
  for (const data of [{ nested: { token: 'private' } }, { category: 'secret' }, { color: 'secret' }])
    assert.throws(() => executionConfigurationSnapshot(data), e => e.getStatus() === 409);
});

test('task/execution serialization excludes input, idempotency, raw errors, results and private runtime fields', () => {
  const timestamps = { createdAt: new Date(), updatedAt: new Date() };
  const task = serializeTask({ ...timestamps, id: randomUUID(), agentId: randomUUID(), orchestratorId: randomUUID(),
    ownerId: 'private', input: { instruction: 'private' }, requestHash: 'private', idempotencyKey: 'private',
    status: 'CREATED', version: 1, completedAt: null });
  assert.ok(!JSON.stringify(task).includes('private'));
  const attempt = serializeExecution({ ...timestamps, id: randomUUID(), taskId: task.id, agentId: task.agentId,
    orchestratorId: task.orchestratorId, attemptNumber: 1, status: 'FAILED', version: 1,
    startedAt: null, finishedAt: new Date(), errorCode: 'PRIVATE', errorMessage: 'private stack password',
    resultReference: 'private', submissionKey: 'private', agentConfigSnapshot: { private: true }, resultAvailability: 'UNAVAILABLE' });
  assert.equal(attempt.errorCode, 'EXECUTION_ERROR'); assert.ok(!JSON.stringify(attempt).includes('private'));
});

test('known database failures translate to safe HTTP exceptions without leaking messages', async () => {
  for (const [code, status] of [['23505',409], ['23503',400], ['23514',400], ['40001',409], ['40P01',409], ['ECONNREFUSED',503]])
    await assert.rejects(safePersistence(async () => { throw { cause: { code, message: 'private' } }; }), e => e.getStatus() === status && !e.message.includes('private'));
});

test('Task and Execution HTTP routes fail closed by default and in production; mutation routes do not exist', async () => {
  for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com' }]) {
    const app = await closedApplication(env);
    try {
      await app.listen(0, '127.0.0.1');
      const base = `${await app.getUrl()}/api/v1/tasks`, id = randomUUID();
      for (const [path, method] of [['','POST'],['','GET'],['/'+id,'GET'],['/'+id+'/executions','GET'],
        ['/'+id+'/executions/'+randomUUID(),'GET'],['/'+id+'/executions','POST'],['/'+id,'PATCH']])
        assert.equal((await fetch(base+path, { method })).status, 404);
    } finally { await app.close(); }
  }
});
