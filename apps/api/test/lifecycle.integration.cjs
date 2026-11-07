const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createApplication } = require('../dist/application');
const { validateEnvironment } = require('../dist/config/configuration');
const { TaskLifecycleService } = require('../dist/lifecycle/task-lifecycle.service');
const { ExecutionLifecycleService } = require('../dist/lifecycle/execution-lifecycle.service');
const { ExecutionsService } = require('../dist/executions/executions.service');
const { ApiLogger } = require('../dist/common/api-logger');

module.exports = ({ row, getUrl, getPool }) => {
  const versions = state => ({ taskVersion: state.task.version, executionVersion: state.execution.version });
  const rejectCode = code => error => error.code === code;
  async function fixture() {
    const owner = await row("INSERT INTO owners(name) VALUES ('lifecycle-scope') RETURNING id");
    const orch = await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'route','native','ENABLED') RETURNING id", [owner.id]);
    const token = randomBytes(32).toString('hex');
    const config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: getUrl(), DATABASE_SSL_MODE: 'disable',
      AGENT_REGISTRY_ENABLED: 'true', AGENT_REGISTRY_OWNER_ID: owner.id, AGENT_REGISTRY_TOKEN: token });
    let app;
    const open = async () => {
      app = await createApplication(config); app.get(ApiLogger).info = () => {}; app.get(ApiLogger).error = () => {};
      await app.listen(0,'127.0.0.1');
    };
    await open();
    const request = async (path, method = 'GET', body) => {
      const response = await fetch(`${await app.getUrl()}/api/v1/${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type':'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
    const agent = await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'target','RULE_BASED','ACTIVE') RETURNING *", [owner.id, orch.id]);
    const task = async () => {
      const response = await request('tasks','POST',{ agentId: agent.id, input: { instruction: 'Lifecycle persistence only' } });
      assert.equal(response.status,201); return response.data;
    };
    const queue = async (authority = 'NATIVE') => {
      const created = await task();
      return app.get(TaskLifecycleService).queueTask(created.id,{ taskVersion: created.version, authority });
    };
    const run = async (authority = 'NATIVE') => { const queued = await queue(authority); return app.get(TaskLifecycleService).startTask(queued.task.id,queued.execution.id,versions(queued)); };
    return { owner, orch, agent, task, queue, run, request,
      life: () => app.get(TaskLifecycleService), exec: () => app.get(ExecutionLifecycleService),
      attempts: () => app.get(ExecutionsService),
      async restart() { await app.close(); await open(); }, async close() { await app.close(); },
    };
  }
  async function persisted(state) {
    return { task: await row('SELECT * FROM tasks WHERE id=$1',[state.task.id]),
      execution: state.execution ? await row('SELECT * FROM executions WHERE id=$1',[state.execution.id]) : null };
  }
  async function assertPair(state, taskStatus, executionStatus) {
    const records = await persisted(state);
    assert.equal(records.task.status,taskStatus); assert.equal(records.execution?.status ?? null,executionStatus);
    return records;
  }

  test('lifecycle queues/starts/completes atomically with timestamps, result ownership and restart persistence', async () => {
    const f = await fixture();
    try {
      const queued = await f.queue();
      await assertPair(queued,'QUEUED','PENDING'); assert.equal(queued.execution.startedAt,null);
      const running = await f.exec().startExecution(queued.task.id,queued.execution.id,versions(queued));
      let saved = await assertPair(running,'RUNNING','RUNNING');
      assert.ok(saved.execution.started_at >= saved.execution.created_at); assert.equal(saved.execution.finished_at,null);
      assert.equal(saved.task.completed_at,null);
      const result = await row('INSERT INTO execution_results(owner_id,execution_id,body) VALUES ($1,$2,$3) RETURNING id', [f.owner.id,running.execution.id,{ summary:'public result' }]);
      const completed = await f.exec().succeedExecution(running.task.id,running.execution.id,{ ...versions(running),resultReference:'result:'+result.id });
      saved = await assertPair(completed,'COMPLETED','SUCCEEDED');
      assert.equal(saved.execution.result_reference,'result:'+result.id); assert.equal(saved.execution.result_availability,'AVAILABLE');
      assert.equal(saved.task.completed_at.toISOString(),saved.execution.finished_at.toISOString());
      assert.equal((await row('SELECT t.completed_at=e.finished_at AS aligned FROM tasks t JOIN executions e ON e.task_id=t.id WHERE e.id=$1',[completed.execution.id])).aligned,true);
      assert.ok(saved.execution.finished_at >= saved.execution.started_at);
      await f.restart();
      assert.equal((await f.request('tasks/'+completed.task.id)).data.status,'COMPLETED');
      assert.equal((await f.request(`tasks/${completed.task.id}/executions/${completed.execution.id}`)).data.status,'SUCCEEDED');
      await assert.rejects(f.life().startTask(completed.task.id,completed.execution.id,versions(completed)),rejectCode('ALREADY_TERMINAL'));
      await assert.rejects(f.life().completeTask(completed.task.id,completed.execution.id,versions(completed)),rejectCode('ALREADY_TERMINAL'));
      assert.deepEqual(await persisted(completed),saved);
      const history = await getPool().query('SELECT * FROM agent_events WHERE task_id=$1 ORDER BY stream_position',[completed.task.id]);
      assert.ok(history.rows.some(e=>e.event_type === 'task.completed'));
      const terminal = history.rows.filter(e=>['task.completed','execution.completed'].includes(e.event_type));
      assert.equal(terminal.length,2); assert.equal(terminal[0].correlation_id,terminal[1].correlation_id);
      assert.ok(!JSON.stringify(history.rows.map(e=>e.payload)).includes('public result'));
    } finally { await f.close(); }
  });

  test('lifecycle failure/timeout finalize both records without retries, including queued pre-start failures', async () => {
    const f = await fixture();
    try {
      for (const prestart of [false,true]) for (const timeout of [false,true]) {
        const initial = prestart ? await f.queue() : await f.run();
        const outcome = timeout ? await f.exec().timeoutExecution(initial.task.id,initial.execution.id,versions(initial)) :
          await f.exec().failExecution(initial.task.id,initial.execution.id,{ ...versions(initial),errorCode:'PROCESS_INTERRUPTED' });
        const saved = await assertPair(outcome,'FAILED',timeout ? 'TIMED_OUT' : 'FAILED');
        assert.equal(saved.execution.started_at === null,prestart); assert.ok(saved.execution.finished_at);
        assert.equal(saved.execution.error_code,timeout ? 'EXECUTION_TIMED_OUT' : 'PROCESS_INTERRUPTED');
        assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1',[initial.task.id])).count,1);
        await assert.rejects(f.life().queueTask(outcome.task.id,{ taskVersion:outcome.task.version,authority:'NATIVE' }),rejectCode('ALREADY_TERMINAL'));
        await assert.rejects(f.attempts().createPending(outcome.task.id,'NATIVE'),e=>e.getStatus() === 409);
        assert.deepEqual(await persisted(outcome),saved);
      }
    } finally { await f.close(); }
  });

  test('cancellation handles CREATED/no attempt, CREATED/PENDING, QUEUED and RUNNING without claiming process termination', async () => {
    const f = await fixture();
    try {
      const created = await f.task();
      const cancelled = await f.life().cancelTask(created.id,{ taskVersion:created.version });
      const saved = await assertPair(cancelled,'CANCELLED',null);
      assert.ok(saved.task.cancel_requested_at); assert.ok(saved.task.completed_at);
      const unqueued = await f.task();
      const pending = await f.attempts().createPending(unqueued.id,'NATIVE');
      await f.life().cancelTask(unqueued.id,{ taskVersion:unqueued.version,executionId:pending.id,executionVersion:pending.version });
      for (const running of [false,true]) {
        const initial = running ? await f.run() : await f.queue();
        await assert.rejects(f.life().cancelTask(initial.task.id,{ taskVersion:initial.task.version }),rejectCode('INVALID_COMMAND'));
        const result = await f.exec().cancelExecution(initial.task.id,initial.execution.id,versions(initial));
        const records = await assertPair(result,'CANCELLED','CANCELLED');
        assert.equal(result.execution.errorCode,null);
        assert.equal(records.execution.reconciliation_state,running ? 'CANCELLATION_UNCONFIRMED' : 'NONE');
        await assert.rejects(f.life().completeTask(result.task.id,result.execution.id,versions(result)),rejectCode('ALREADY_TERMINAL'));
        await assert.rejects(f.life().cancelTask(result.task.id,{ ...versions(result),executionId:result.execution.id }),rejectCode('ALREADY_TERMINAL'));
        assert.deepEqual(await persisted(result),records);
      }
    } finally { await f.close(); }
  });

  test('queue adopts an existing T05 pending attempt; missing/mismatched/stale and older-attempt commands cannot mutate state', async () => {
    const f = await fixture(), other = await fixture();
    try {
      const created = await f.task(), pending = await f.attempts().createPending(created.id,'NATIVE');
      const queued = await f.life().queueTask(created.id,{ taskVersion:created.version,authority:'NATIVE' });
      assert.equal(queued.execution.id,pending.id);
      await assert.rejects(f.life().queueTask(created.id,{ taskVersion:created.version,authority:'NATIVE' }),rejectCode('LIFECYCLE_CONFLICT'));
      const unrelated = await f.queue(), foreign = await other.queue();
      await assert.rejects(f.life().startTask(queued.task.id,unrelated.execution.id,versions(queued)),rejectCode('EXECUTION_TASK_MISMATCH'));
      await assert.rejects(f.life().startTask(queued.task.id,foreign.execution.id,versions(queued)),rejectCode('EXECUTION_NOT_FOUND'));
      await assert.rejects(f.life().queueTask(foreign.task.id,{ taskVersion:foreign.task.version,authority:'NATIVE' }),rejectCode('TASK_NOT_FOUND'));
      await assert.rejects(f.life().startTask(queued.task.id,randomUUID(),versions(queued)),rejectCode('EXECUTION_NOT_FOUND'));
      await assert.rejects(f.life().queueTask(randomUUID(),{ taskVersion:1,authority:'NATIVE' }),rejectCode('TASK_NOT_FOUND'));
      await assertPair(queued,'QUEUED','PENDING');
      const historyTask = await f.task(), old = await f.attempts().createPending(historyTask.id,'NATIVE');
      await getPool().query("UPDATE executions SET status='FAILED',finished_at=now() WHERE id=$1",[old.id]);
      const oldSaved = await row('SELECT * FROM executions WHERE id=$1',[old.id]);
      const latest = await f.attempts().createPending(historyTask.id,'NATIVE');
      const adopted = await f.life().queueTask(historyTask.id,{ taskVersion:historyTask.version,authority:'NATIVE' });
      await assert.rejects(f.life().startTask(historyTask.id,old.id,{ taskVersion:adopted.task.version,executionVersion:oldSaved.version }),rejectCode('LIFECYCLE_CONFLICT'));
      const running = await f.life().startTask(historyTask.id,latest.id,versions(adopted));
      await f.life().completeTask(historyTask.id,latest.id,versions(running));
      assert.deepEqual(await row('SELECT * FROM executions WHERE id=$1',[old.id]),oldSaved);
    } finally { await f.close(); await other.close(); }
  });

  test('concurrent queue/start and agent-capacity races have one winner and unchanged losing records', async () => {
    const f = await fixture();
    try {
      const created = await f.task();
      const queues = await Promise.allSettled(Array.from({length:5},()=>f.life().queueTask(created.id,{ taskVersion:created.version,authority:'NATIVE' })));
      assert.equal(queues.filter(r=>r.status === 'fulfilled').length,1);
      assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1',[created.id])).count,1);
      const queued = queues.find(r=>r.status === 'fulfilled').value;
      const starts = await Promise.allSettled(Array.from({length:5},()=>f.life().startTask(queued.task.id,queued.execution.id,versions(queued))));
      assert.equal(starts.filter(r=>r.status === 'fulfilled').length,1);
      for (const item of starts.filter(r=>r.status === 'rejected')) assert.equal(item.reason.code,'LIFECYCLE_CONFLICT');
      const running = starts.find(r=>r.status === 'fulfilled').value;
      await assertPair(running,'RUNNING','RUNNING');
      const another = await f.queue();
      await assert.rejects(f.life().startTask(another.task.id,another.execution.id,versions(another)),rejectCode('LIFECYCLE_CONFLICT'));
      await assertPair(another,'QUEUED','PENDING');
    } finally { await f.close(); }
  });

  test('duplicate completion, success/cancel and failure/success races preserve exactly one terminal outcome', async () => {
    const f = await fixture();
    try {
      for (const race of ['duplicate','cancel','failure']) {
        const running = await f.run(), input = versions(running);
        const complete = () => f.life().completeTask(running.task.id,running.execution.id,input);
        const rival = race === 'duplicate' ? complete : race === 'cancel' ?
          () => f.life().cancelTask(running.task.id,{ ...input,executionId:running.execution.id }) :
          () => f.life().failTask(running.task.id,running.execution.id,{ ...input,errorCode:'EXECUTION_FAILED' });
        const outcomes = await Promise.allSettled([complete(),rival()]);
        assert.equal(outcomes.filter(r=>r.status === 'fulfilled').length,1);
        assert.equal(outcomes.find(r=>r.status === 'rejected').reason.code,'LIFECYCLE_CONFLICT');
        const winner = outcomes.find(r=>r.status === 'fulfilled').value;
        const records = await persisted(winner);
        assert.ok({ COMPLETED:'SUCCEEDED',FAILED:'FAILED',CANCELLED:'CANCELLED' }[records.task.status] === records.execution.status);
        assert.equal((await row("SELECT count(*)::int AS count FROM agent_events WHERE task_id=$1 AND event_type IN ('task.completed','task.failed','task.cancelled')",[running.task.id])).count,1);
        assert.equal((await row("SELECT count(*)::int AS count FROM executions WHERE task_id=$1 AND status IN ('PENDING','RUNNING')",[running.task.id])).count,0);
      }
    } finally { await f.close(); }
  });

  test('audit persistence failure rolls back queue allocation, paired start, completion, cancellation and history', async () => {
    const f = await fixture();
    try {
      const created = await f.task(), queued = await f.queue(), running = await f.run('EXTERNAL');
      const beforeQueued = await persisted(queued), beforeRunning = await persisted(running);
      const beforeEvents = (await row('SELECT count(*)::int AS count FROM agent_events WHERE owner_id=$1',[f.owner.id])).count;
      const beforeOutbox = (await row('SELECT count(*)::int AS count FROM event_outbox WHERE owner_id=$1',[f.owner.id])).count;
      await getPool().query(`CREATE FUNCTION t06_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.owner_id='${f.owner.id}'::uuid THEN RAISE EXCEPTION 'private audit fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
      await getPool().query('CREATE TRIGGER t06_audit_fault BEFORE INSERT ON command_audit FOR EACH ROW EXECUTE FUNCTION t06_audit_fault()');
      try {
        for (const action of [
          ()=>f.life().queueTask(created.id,{ taskVersion:created.version,authority:'NATIVE' }),
          ()=>f.life().startTask(queued.task.id,queued.execution.id,versions(queued)),
          ()=>f.life().completeTask(running.task.id,running.execution.id,versions(running)),
          ()=>f.life().cancelTask(running.task.id,{ ...versions(running),executionId:running.execution.id }),
        ]) await assert.rejects(action(),e=>e.code === 'INCONSISTENT_STATE' && !e.message.includes('private'));
        assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1',[created.id])).count,0);
        assert.deepEqual(await persisted(queued),beforeQueued); assert.deepEqual(await persisted(running),beforeRunning);
        assert.equal((await row('SELECT count(*)::int AS count FROM agent_events WHERE owner_id=$1',[f.owner.id])).count,beforeEvents);
        assert.equal((await row('SELECT count(*)::int AS count FROM event_outbox WHERE owner_id=$1',[f.owner.id])).count,beforeOutbox);
      } finally {
        await getPool().query('DROP TRIGGER t06_audit_fault ON command_audit'); await getPool().query('DROP FUNCTION t06_audit_fault()');
      }
      await f.life().completeTask(running.task.id,running.execution.id,versions(running));
    } finally { await f.close(); }
  });

  test('invalid direct transitions, unknown results, disabled routes and inconsistent legacy states fail without rewriting history', async () => {
    const f = await fixture();
    try {
      const created = await f.task(), pending = await f.attempts().createPending(created.id,'NATIVE');
      const input = { taskVersion:created.version,executionVersion:pending.version };
      await assert.rejects(f.life().completeTask(created.id,pending.id,input),rejectCode('INVALID_TASK_TRANSITION'));
      await assert.rejects(f.life().startTask(created.id,pending.id,input),rejectCode('INVALID_TASK_TRANSITION'));
      const queued = await f.life().queueTask(created.id,{ taskVersion:created.version,authority:'NATIVE' });
      await getPool().query("UPDATE orchestrators SET registration_status='DISABLED' WHERE id=$1",[f.orch.id]);
      await assert.rejects(f.life().startTask(queued.task.id,pending.id,versions(queued)),rejectCode('LIFECYCLE_CONFLICT'));
      await getPool().query("UPDATE orchestrators SET registration_status='ENABLED' WHERE id=$1",[f.orch.id]);
      const running = await f.life().startTask(queued.task.id,pending.id,versions(queued));
      await assert.rejects(f.life().completeTask(running.task.id,pending.id,{ ...versions(running),resultReference:'result:'+randomUUID() }),rejectCode('RESULT_NOT_FOUND'));
      const another = await f.queue();
      const wrongResult = await row('INSERT INTO execution_results(owner_id,execution_id,body) VALUES ($1,$2,$3) RETURNING id',[f.owner.id,another.execution.id,{}]);
      await assert.rejects(f.life().completeTask(running.task.id,pending.id,{ ...versions(running),resultReference:'result:'+wrongResult.id }),rejectCode('RESULT_NOT_FOUND'));
      await f.life().completeTask(running.task.id,pending.id,versions(running));
      const legacy = await f.task();
      await getPool().query("UPDATE tasks SET status='RUNNING' WHERE id=$1",[legacy.id]);
      const legacyBefore = await row('SELECT * FROM tasks WHERE id=$1',[legacy.id]);
      await assert.rejects(f.life().cancelTask(legacy.id,{ taskVersion:legacyBefore.version }),rejectCode('INCONSISTENT_STATE'));
      assert.deepEqual(await row('SELECT * FROM tasks WHERE id=$1',[legacy.id]),legacyBefore);
      const successfulLegacy = await f.task();
      const oldSuccess = await f.attempts().createPending(successfulLegacy.id,'NATIVE');
      await getPool().query("UPDATE executions SET status='SUCCEEDED',started_at=now(),finished_at=now() WHERE id=$1",[oldSuccess.id]);
      await assert.rejects(f.life().queueTask(successfulLegacy.id,{ taskVersion:successfulLegacy.version,authority:'NATIVE' }),rejectCode('INCONSISTENT_STATE'));
      await assert.rejects(f.life().cancelTask(successfulLegacy.id,{ taskVersion:successfulLegacy.version }),rejectCode('INCONSISTENT_STATE'));
      const inconsistent = await row('INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number) VALUES ($1,$2,$3,$4,2) RETURNING *',
        [f.owner.id,successfulLegacy.id,f.agent.id,f.orch.id]);
      const legacyQueued = await row("UPDATE tasks SET status='QUEUED' WHERE id=$1 RETURNING *",[successfulLegacy.id]);
      await assert.rejects(f.life().startTask(successfulLegacy.id,inconsistent.id,
        { taskVersion:legacyQueued.version,executionVersion:inconsistent.version }),rejectCode('INCONSISTENT_STATE'));
      assert.equal((await f.request('tasks/'+created.id+'/start','POST',{})).status,404);
      assert.equal((await f.request('tasks/'+created.id,'PATCH',{})).status,404);
    } finally { await f.close(); }
  });
};
