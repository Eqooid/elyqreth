require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertTaskTransition, assertExecutionTransition, LifecycleError } = require('../dist/lifecycle/lifecycle-policy');
const { TaskLifecycleService } = require('../dist/lifecycle/task-lifecycle.service');
const { ExecutionLifecycleService } = require('../dist/lifecycle/execution-lifecycle.service');

const task = {
  CREATED: ['QUEUED','CANCELLED'], QUEUED: ['RUNNING','FAILED','CANCELLED'],
  RUNNING: ['COMPLETED','FAILED','CANCELLED'], COMPLETED: [], FAILED: [], CANCELLED: [],
};
const execution = {
  PENDING: ['RUNNING','FAILED','CANCELLED','TIMED_OUT'],
  RUNNING: ['SUCCEEDED','FAILED','CANCELLED','TIMED_OUT'], SUCCEEDED: [], FAILED: [], CANCELLED: [], TIMED_OUT: [],
};
for (const [label, table, validate, invalid] of [
  ['Task',task,assertTaskTransition,'INVALID_TASK_TRANSITION'],
  ['Execution',execution,assertExecutionTransition,'INVALID_EXECUTION_TRANSITION'],
]) {
  test(`${label} transition matrix exhaustively rejects invalid, repeated and terminal transitions`, () => {
    for (const from of Object.keys(table)) for (const to of Object.keys(table)) {
      if (table[from].includes(to)) assert.doesNotThrow(() => validate(from,to));
      else assert.throws(() => validate(from,to), e => e instanceof LifecycleError && e.code === (table[from].length ? invalid : 'ALREADY_TERMINAL'));
    }
  });
}

test('lifecycle commands validate identifiers, required versions and strictly bounded error/result contracts', async () => {
  const service = new TaskLifecycleService({}, {}, {});
  const id = randomUUID(), attempt = randomUUID();
  const invalid = e => e instanceof LifecycleError && e.code === 'INVALID_COMMAND';
  for (const command of [null, {}, { taskVersion: 0, authority: 'NATIVE' }, { taskVersion: 1, authority: 'invalid' },
    { taskVersion: 1, authority: 'NATIVE', status: 'RUNNING' }]) await assert.rejects(service.queueTask(id, command), invalid);
  await assert.rejects(service.queueTask('invalid', { taskVersion: 1, authority: 'NATIVE' }), invalid);
  for (const command of [{ taskVersion: 1 }, { taskVersion: 1, executionVersion: -1 }, { taskVersion: 1, executionVersion: 1.5 }])
    await assert.rejects(service.startTask(id, attempt, command), invalid);
  for (const resultReference of ['https://user:secret@example.com', 'result:invalid', {}, 'file:/secret'])
    await assert.rejects(service.completeTask(id, attempt, { taskVersion: 1, executionVersion: 1, resultReference }), invalid);
  for (const errorCode of ['private secret', 'constructor', '__proto__', null])
    await assert.rejects(service.failTask(id, attempt, { taskVersion: 1, executionVersion: 1, errorCode }), invalid);
  await assert.rejects(service.failTask(id, attempt, { taskVersion: 1, executionVersion: 1, errorCode: 'EXECUTION_FAILED', errorMessage: 'private' }), invalid);
  await assert.rejects(service.cancelTask(id, { taskVersion: 1, executionVersion: 1 }), invalid);
});

test('internal lifecycle operations fail closed without configured scope or in production', async () => {
  for (const value of [{ nodeEnv: 'development' }, { nodeEnv: 'production', registry: { ownerId: randomUUID() } }]) {
    const service = new TaskLifecycleService({}, { value }, {});
    await assert.rejects(service.queueTask(randomUUID(), { taskVersion: 1, authority: 'NATIVE' }), e => e.code === 'ACCESS_DISABLED');
  }
});

test('Execution lifecycle interface delegates every operation to the shared atomic coordinator', async () => {
  const calls = [];
  const target = Object.fromEntries(['startTask','completeTask','failTask','cancelTask','timeoutTask'].map(name =>
    [name, async (...args) => { calls.push([name,...args]); return name; }]));
  const service = new ExecutionLifecycleService(target);
  const command = { taskVersion: 2, executionVersion: 1 };
  await service.startExecution('task','attempt',command);
  await service.succeedExecution('task','attempt',command);
  await service.failExecution('task','attempt',{ ...command, errorCode: 'EXECUTION_FAILED' });
  await service.cancelExecution('task','attempt',command);
  await service.timeoutExecution('task','attempt',command);
  assert.deepEqual(calls.map(call => call[0]), ['startTask','completeTask','failTask','cancelTask','timeoutTask']);
  assert.deepEqual(calls[3], ['cancelTask','task',{ ...command, executionId: 'attempt' }]);
});
