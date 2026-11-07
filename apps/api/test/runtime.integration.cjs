const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {RuntimePersistenceService}=require('../dist/runtime/runtime-persistence.service');
const {TaskLifecycleService}=require('../dist/lifecycle/task-lifecycle.service');
const {ExecutionsService}=require('../dist/executions/executions.service');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {createRuntimeExecutionResult}=require('../dist/runtime/contracts/execution-result.contract');
const {ApiLogger}=require('../dist/common/api-logger');
const {definition,candidate,deferred}=require('./runtime-fixtures.cjs');
const code=expected=>e=>e instanceof RuntimeError&&e.code===expected;

module.exports=({row,getUrl,getPool})=>{
  async function fixture(execute, {timeout=120000, registered=true}={}) {
    const owner=await row("INSERT INTO owners(name) VALUES ('runtime-test-scope') RETURNING id");
    const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native-route','native','ENABLED') RETURNING id",[owner.id]);
    const agent=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status,configuration) VALUES ($1,$2,'Runtime fixture','RULE_BASED','ACTIVE',$3) RETURNING *",[owner.id,route.id,{category:'test'}]);
    const token=randomBytes(32).toString('hex');
    const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',
      AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,
      RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:JSON.stringify([{agentId:agent.id,orchestratorId:route.id,definition:definition(timeout)}])});
    let app, calls=0;const apps=[];
    const open=async()=>{
      const instance=await createApplication(config);instance.get(ApiLogger).info=()=>{};instance.get(ApiLogger).error=()=>{};
      // Substitute only this coordinator's injected registry in tests; production
      // DI retains the genuine handler and duplicate registration protection.
      instance.get(RuntimeCoordinator).strategies=new StrategyRegistry(registered?[{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{calls++;return execute?execute(r,c):candidate(r);}}}]:[]);
      await instance.listen(0,'127.0.0.1');apps.push(instance);return instance;
    };
    app=await open();
    const request=async(path,method='GET',body,headers={})=>{
      const response=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,
        headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json()};
    };
    const task=async()=>{
      const r=await request('tasks','POST',{agentId:agent.id,input:{instruction:'Private runtime integration marker'}});
      assert.equal(r.status,201);return r.data;
    };
    return {owner,route,agent,request,task,open,calls:()=>calls,app:()=>app,coordinator:()=>app.get(RuntimeCoordinator),
      async restart(){await app.close();app=await open();}, async close(){await Promise.all(apps.map(a=>a.close()));}};
  }
  const state=async taskId=>{
    const task=await row('SELECT * FROM tasks WHERE id=$1',[taskId]);
    const execution=await row('SELECT * FROM executions WHERE task_id=$1 ORDER BY attempt_number DESC LIMIT 1',[taskId]);
    return {task,execution};
  };
  const history=async taskId=>(await getPool().query('SELECT * FROM agent_events WHERE task_id=$1 ORDER BY stream_position',[taskId])).rows;
  const resultCount=async executionId=>(await row('SELECT count(*)::int AS n FROM execution_results WHERE execution_id=$1',[executionId])).n;
  async function fault(f,eventType,operation){
    // Owned disposable database only. Fault values originate in test fixtures.
    await getPool().query(`CREATE FUNCTION p2t03_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.owner_id='${f.owner.id}'::uuid ${eventType?`AND NEW.event_type='${eventType}'`:''} THEN
      RAISE EXCEPTION 'private trigger fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
    await getPool().query('CREATE TRIGGER p2t03_fault BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION p2t03_fault()');
    try {await operation();}finally{await getPool().query('DROP TRIGGER p2t03_fault ON agent_events');await getPool().query('DROP FUNCTION p2t03_fault()');}
  }

  test('runtime real DI executes one injected fake, persists atomic results/events and survives restart without redispatch',async()=>{
    const f=await fixture();try{
      const task=await f.task(),correlationId=randomUUID();
      const done=await f.coordinator().executeTask({taskId:task.id,taskVersion:task.version,correlationId});
      assert.equal(done.kind,'finished');assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');assert.equal(f.calls(),1);
      const saved=await state(task.id);assert.equal(saved.task.completed_at.toISOString(),saved.execution.finished_at.toISOString());
      assert.equal(saved.execution.authority,'NATIVE');assert.equal(saved.execution.lease_token,null);
      assert.equal(saved.execution.agent_config_snapshot.runtime.correlationId,correlationId);
      assert.equal(saved.execution.agent_config_snapshot.runtime.definition.strategyId,'text.stats.v1');
      assert.equal(saved.execution.result_reference,done.resultReference);assert.equal(await resultCount(done.execution.id),1);
      const result=await row('SELECT * FROM execution_results WHERE execution_id=$1',[done.execution.id]);assert.deepEqual(result.body,done.result);
      const events=await history(task.id);
      assert.deepEqual(events.map(e=>e.event_type),['task.created','execution.created','task.queued','execution.started','task.started','execution.completed','task.completed']);
      assert.ok(events.slice(1).every(e=>e.correlation_id===correlationId));
      assert.equal((await f.request(`tasks/${task.id}/executions`)).data.items.length,1);
      assert.equal((await f.request(`tasks/${task.id}/events`)).data.items.length,7);
      assert.ok(!JSON.stringify(events).includes('Private runtime integration marker'));
      assert.ok(!JSON.stringify(done).includes('leaseToken'));
      await f.restart();assert.equal((await f.request(`tasks/${task.id}`)).data.status,'COMPLETED');
      await assert.rejects(f.coordinator().executeTask({taskId:task.id,taskVersion:done.task.version}),code('ACCESS_DENIED'));
      assert.equal(f.calls(),1);assert.deepEqual(await history(task.id),events);
      // T11 adds a guarded execute route; an absent If-Match remains invalid, never a runnable command.
      assert.equal((await f.request(`tasks/${task.id}/execute`,'POST',{})).status,400);
      assert.equal((await f.request('runtime/execute','POST',{})).status,404);
    }finally{await f.close();}
  });

  test('runtime queue freezes definition and metadata; later execution adopts the same pending attempt and fresh heartbeat versions',async()=>{
    const entered=deferred(),release=deferred();let request,context;
    const f=await fixture(async(r,c)=>{request=r;context=c;entered.resolve();await release.promise;return candidate(r);});
    try{
      const task=await f.task();const queued=await f.coordinator().queueTask({taskId:task.id,taskVersion:task.version});
      assert.equal(queued.task.status,'QUEUED');assert.equal(queued.execution.status,'PENDING');assert.equal(f.calls(),0);
      assert.equal((await f.request(`agents/${f.agent.id}`,'PATCH',{configuration:{category:'research'}},{'if-match':`"${f.agent.version}"`})).status,200);
      const running=f.coordinator().executeTask({taskId:task.id,taskVersion:queued.task.version});await entered.promise;
      let saved=await state(task.id);const before=saved.execution.version;
      await f.app().get(RuntimePersistenceService).heartbeat({task:{id:task.id},execution:{id:saved.execution.id},request,leaseToken:saved.execution.lease_token});
      saved=await state(task.id);assert.ok(saved.execution.version>before);
      assert.equal(context.safeAgentConfiguration.category,'test');assert.equal(request.ids.agentId,f.agent.id);
      release.resolve();const done=await running;assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.id,queued.execution.id);
      assert.equal((await getPool().query('SELECT id FROM executions WHERE task_id=$1',[task.id])).rowCount,1);
    }finally{release.resolve();await f.close();}
  });

  test('database clock ahead of Node does not extend the context budget or reject valid admission',async()=>{
    const f=await fixture();try{
      const store=f.app().get(RuntimePersistenceService), original=store.now.bind(store);
      store.now=async tx=>(await original(tx))+250;
      const task=await f.task(),done=await f.coordinator().executeTask({taskId:task.id,taskVersion:task.version});
      assert.equal(done.kind,'finished');assert.equal(done.execution.status,'SUCCEEDED');assert.equal(f.calls(),1);
    }finally{await f.close();}
  });

  test('T08 tool claim authority accepts only its committed context and rejects forged, copied, foreign-instance and terminal contexts',async()=>{
    const entered=deferred(),release=deferred();let context;
    const f=await fixture(async(r,c)=>{context=c;entered.resolve();await release.promise;return candidate(r);});
    let running;
    try{
      const task=await f.task();running=f.coordinator().executeTask({taskId:task.id,taskVersion:task.version});await entered.promise;
      const store=f.app().get(RuntimePersistenceService);await store.verifyToolContext(context);
      await assert.rejects(store.verifyToolContext({...context}),code('TOOL_DENIED'));
      const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
      const forged=f.app().get(ExecutionContextFactory).create({request:require('../dist/runtime/contracts/execution-request.contract').createRuntimeExecutionRequest({
        ids:context.ids,input:context.input,definition:context.definition}),signal:new AbortController().signal,deadlineAt:context.deadlineAt});
      await assert.rejects(store.verifyToolContext(forged),code('TOOL_DENIED'));
      const other=await f.open();await assert.rejects(other.get(RuntimePersistenceService).verifyToolContext(context),code('TOOL_DENIED'));
      await assert.rejects(f.app().get(require('../dist/runtime/tools/tool-execution.service').ToolExecutionService).openSession(context),code('TOOL_DENIED'));
      release.resolve();const done=await running;assert.equal(done.execution.status,'SUCCEEDED');
      await assert.rejects(store.verifyToolContext(context),code('LEASE_LOST'));
      assert.equal((await history(task.id)).length,7);assert.equal(await resultCount(done.execution.id),1);
    }finally{release.resolve();await running?.catch(()=>{});await f.close();}
  });

  test('unknown strategies, missing/cross-owner Tasks, disabled Agents and invalid context reject without state or event changes',async()=>{
    const absent=await fixture(undefined,{registered:false});try{
      const task=await absent.task();await assert.rejects(absent.coordinator().executeTask({taskId:task.id,taskVersion:1}),code('STRATEGY_NOT_FOUND'));
      assert.equal((await state(task.id)).execution,undefined);assert.equal((await history(task.id)).length,1);
    }finally{await absent.close();}
    const f=await fixture(), other=await fixture();try{
      const task=await f.task(),foreign=await other.task();
      for(const taskId of [randomUUID(),foreign.id])await assert.rejects(f.coordinator().executeTask({taskId,taskVersion:1}),code('DEFINITION_UNAVAILABLE'));
      await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1",[f.agent.id]);
      await assert.rejects(f.coordinator().executeTask({taskId:task.id,taskVersion:1}),code('ACCESS_DENIED'));
      assert.equal((await state(task.id)).task.status,'CREATED');assert.equal((await state(task.id)).execution,undefined);
      await getPool().query("UPDATE agents SET lifecycle_status='ACTIVE' WHERE id=$1",[f.agent.id]);
      await getPool().query('UPDATE tasks SET deadline_at=created_at WHERE id=$1',[task.id]);
      const current=await state(task.id);
      await assert.rejects(f.coordinator().executeTask({taskId:task.id,taskVersion:current.task.version}),code('DEADLINE_EXCEEDED'));
      assert.equal((await state(task.id)).execution,undefined);assert.equal((await history(task.id)).length,1);assert.equal(f.calls(),0);
    }finally{await f.close();await other.close();}
  });

  test('runtime refuses legacy metadata-only pending attempts, non-native routes, and frozen snapshot mutation',async()=>{
    const f=await fixture();try{
      const task=await f.task();const old=await f.app().get(TaskLifecycleService).queueTask(task.id,{taskVersion:1,authority:'NATIVE'});
      await assert.rejects(f.coordinator().executeTask({taskId:task.id,taskVersion:old.task.version}),code('INVALID_INPUT'));
      assert.equal(f.calls(),0);assert.equal((await state(task.id)).execution.status,'PENDING');
      const fresh=await f.task();const queued=await f.coordinator().queueTask({taskId:fresh.id,taskVersion:1});
      await assert.rejects(getPool().query("UPDATE executions SET agent_config_snapshot='{}'::jsonb WHERE id=$1",[queued.execution.id]),e=>e.code==='23514');
      await getPool().query("UPDATE orchestrators SET type='external' WHERE id=$1",[f.route.id]);
      await assert.rejects(f.coordinator().executeTask({taskId:fresh.id,taskVersion:queued.task.version}),code('ACCESS_DENIED'));
    }finally{await f.close();}
  });

  test('runtime strategy failures/invalid results finalize both records with safe audit categories and no result',async()=>{
    for(const invalid of [false,true]){
      const f=await fixture(async()=>{if(invalid)return {apiKey:'private'};throw new Error('password=private error body');});try{
        const task=await f.task();const done=await f.coordinator().executeTask({taskId:task.id,taskVersion:1});
        assert.equal(done.task.status,'FAILED');assert.equal(done.execution.status,'FAILED');
        assert.equal(done.error.code,invalid?'INVALID_INPUT':'INTERNAL_RUNTIME_ERROR');assert.ok(!JSON.stringify(done).includes('private'));
        assert.equal(await resultCount(done.execution.id),0);
        const audit=await row('SELECT details,actor_reference FROM command_audit WHERE resource_id=$1 ORDER BY created_at DESC LIMIT 1',[task.id]);
        assert.equal(audit.details.runtimeErrorCode,done.error.code);assert.equal(audit.actor_reference,'native-runtime');
        assert.deepEqual((await history(task.id)).slice(-2).map(e=>e.event_type),['execution.failed','task.failed']);
      }finally{await f.close();}
    }
  });

  test('two real Nest instances race the same task and another task for the same native agent: one dispatch wins',async()=>{
    for(let repetition=0;repetition<3;repetition++){
    const entered=deferred(),release=deferred();const f=await fixture(async r=>{entered.resolve();await release.promise;return candidate(r);});
    try{
      const second=await f.open(),task=await f.task(),another=await f.task();
      const results=Promise.allSettled([f.coordinator().executeTask({taskId:task.id,taskVersion:1}),second.get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:1})]);
      await Promise.race([entered.promise,results.then(all=>{throw new Error('No strategy entered: '+JSON.stringify(all.map(r=>r.status==='rejected'?r.reason.toJSON?.():r.value)));})]);
      const loser=second.get(RuntimeCoordinator);
      await assert.rejects(loser.executeTask({taskId:another.id,taskVersion:1}),code('CAPACITY_EXCEEDED'));
      release.resolve();const all=await results;assert.equal(all.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls(),1);
      assert.equal((await getPool().query('SELECT id FROM executions WHERE task_id=$1',[task.id])).rowCount,1);
      assert.equal((await state(another.id)).execution,undefined);
      assert.equal((await history(task.id)).filter(e=>e.event_type==='execution.started').length,1);
    }finally{release.resolve();await f.close();}
    }
  });

  test('duplicate terminal transactions commit one result and one terminal event pair without a second invocation',async()=>{
    const entered=deferred(),release=deferred();let request,context;
    const f=await fixture(async(r,c)=>{request=r;context=c;entered.resolve();await release.promise;return candidate(r);});
    try{
      const task=await f.task(),running=f.coordinator().executeTask({taskId:task.id,taskVersion:1});await entered.promise;
      const saved=await state(task.id),store=f.app().get(RuntimePersistenceService);
      const admission={task:{id:task.id},execution:{id:saved.execution.id},request,context,leaseToken:saved.execution.lease_token};
      const result=createRuntimeExecutionResult(candidate(request),request);
      const pair=await Promise.all([store.finish(admission,{result}),store.finish(admission,{result})]);
      assert.equal(pair.filter(r=>r.observed).length,1);assert.ok(pair.every(r=>r.task.status==='COMPLETED'));
      release.resolve();assert.equal((await running).task.status,'COMPLETED');assert.equal(f.calls(),1);
      assert.equal(await resultCount(saved.execution.id),1);
      const events=await history(task.id);assert.equal(events.filter(e=>e.event_type==='task.completed').length,1);
      assert.equal(events.filter(e=>e.event_type==='execution.completed').length,1);
    }finally{release.resolve();await f.close();}
  });

  test('cancellation races with native start and strategy failure leave one committed outcome and preserve original errors',async()=>{
    const f=await fixture();try{
      for(let repetition=0;repetition<3;repetition++){
        const task=await f.task();await Promise.allSettled([
          f.coordinator().executeTask({taskId:task.id,taskVersion:1}),f.app().get(TaskLifecycleService).cancelTask(task.id,{taskVersion:1})]);
        const saved=await state(task.id);
        assert.ok(['COMPLETED','CANCELLED'].includes(saved.task.status));
        if(saved.task.status==='COMPLETED')assert.equal(saved.execution.status,'SUCCEEDED');
        else assert.equal(saved.execution,undefined);
      }
    }finally{await f.close();}
    const entered=deferred(),release=deferred();const failure=await fixture(async()=>{entered.resolve();await release.promise;throw new RuntimeError('TOOL_DENIED');});
    try{
      const task=await failure.task(),running=failure.coordinator().executeTask({taskId:task.id,taskVersion:1});await entered.promise;
      const saved=await state(task.id);release.resolve();
      const cancellation=failure.app().get(TaskLifecycleService).cancelTask(task.id,{taskVersion:saved.task.version,
        executionId:saved.execution.id,executionVersion:saved.execution.version});
      const all=await Promise.allSettled([running,cancellation]);assert.equal(all[0].status,'fulfilled');
      const final=await state(task.id),outcome=all[0].value;
      assert.ok(['FAILED','CANCELLED'].includes(final.task.status));assert.equal(final.execution.status,final.task.status);
      assert.equal(final.task.status==='CANCELLED'?outcome.executionError.code:outcome.error.code,'TOOL_DENIED');
      assert.equal(await resultCount(final.execution.id),0);
      assert.equal((await history(task.id)).filter(e=>['task.cancelled','task.failed'].includes(e.event_type)).length,1);
    }finally{release.resolve();await failure.close();}
  });

  test('concurrent allocator versus runtime admission never duplicates attempts or silently upgrades a legacy attempt',async()=>{
    const f=await fixture();try{
      const task=await f.task();await Promise.allSettled([
        f.coordinator().queueTask({taskId:task.id,taskVersion:1}),f.app().get(ExecutionsService).createPending(task.id,'NATIVE')]);
      const saved=await state(task.id);assert.equal(saved.execution.attempt_number,1);
      assert.equal((await getPool().query('SELECT id FROM executions WHERE task_id=$1',[task.id])).rowCount,1);
      assert.equal(f.calls(),0);
    }finally{await f.close();}
  });

  test('persisted cancellation wins over late success; no result or duplicate terminal fact survives',async()=>{
    const entered=deferred(),release=deferred();const f=await fixture(async r=>{entered.resolve();await release.promise;return candidate(r);});
    try{
      const task=await f.task(),running=f.coordinator().executeTask({taskId:task.id,taskVersion:1});await entered.promise;
      const saved=await state(task.id);await f.app().get(TaskLifecycleService).cancelTask(task.id,{taskVersion:saved.task.version,
        executionId:saved.execution.id,executionVersion:saved.execution.version});
      release.resolve();const done=await running;assert.equal(done.task.status,'CANCELLED');assert.equal(done.execution.status,'CANCELLED');
      assert.equal(done.error.code,'CANCELLED');assert.equal(await resultCount(done.execution.id),0);
      assert.equal((await history(task.id)).filter(e=>e.event_type==='task.cancelled').length,1);
      const other=await f.task();await assert.rejects(f.coordinator().executeTask({taskId:other.id,taskVersion:1}),code('CAPACITY_EXCEEDED'));
    }finally{release.resolve();await f.close();}
  });

  test('local cancellation and runtime deadline abort blocked strategies, quarantine uncertain work and ignore late results',async()=>{
    for(const timeout of [false,true]){
      const entered=deferred(),release=deferred();let context;
      const f=await fixture(async(r,c)=>{context=c;entered.resolve();await release.promise;return candidate(r);},{timeout:timeout?1000:120000});
      try{
        const task=await f.task(),cancel=new AbortController();const running=f.coordinator().executeTask({taskId:task.id,taskVersion:1},cancel.signal);
        await entered.promise;if(!timeout)cancel.abort('private reason');const done=await running;
        assert.equal(done.task.status,timeout?'FAILED':'CANCELLED');assert.equal(done.execution.status,timeout?'TIMED_OUT':'CANCELLED');
        assert.equal(done.error.code,timeout?'DEADLINE_EXCEEDED':'CANCELLED');assert.equal(context.signal.aborted,true);
        release.resolve();await Promise.resolve();assert.equal(await resultCount(done.execution.id),0);
        assert.notEqual((await state(task.id)).execution.reconciliation_state,'NONE');
      }finally{release.resolve();await f.close();}
    }
  });

  test('lost lease fences stale completion, legacy lifecycle wrappers cannot mutate runtime-owned attempts',async()=>{
    const entered=deferred(),release=deferred();const f=await fixture(async r=>{entered.resolve();await release.promise;return candidate(r);});
    try{
      const task=await f.task(),running=f.coordinator().executeTask({taskId:task.id,taskVersion:1});await entered.promise;let saved=await state(task.id);
      await assert.rejects(f.app().get(TaskLifecycleService).completeTask(task.id,saved.execution.id,{taskVersion:saved.task.version,executionVersion:saved.execution.version}),e=>e.code==='LIFECYCLE_CONFLICT');
      await getPool().query("UPDATE executions SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[saved.execution.id]);
      release.resolve();const done=await running;assert.equal(done.kind,'unresolved');assert.equal(done.finalizationError.code,'LEASE_LOST');
      saved=await state(task.id);assert.equal(saved.task.status,'RUNNING');assert.equal(saved.execution.status,'RUNNING');assert.equal(await resultCount(saved.execution.id),0);
      await f.restart();await assert.rejects(f.coordinator().executeTask({taskId:task.id,taskVersion:saved.task.version}),code('CAPACITY_EXCEEDED'));
      assert.equal(f.calls(),1);
    }finally{release.resolve();await f.close();}
  });

  test('result and success-event insertion roll back together, then safe failure finalization preserves consistency',async()=>{
    const entered=deferred(),release=deferred();const f=await fixture(async r=>{entered.resolve();await release.promise;return candidate(r);});
    try{
      const task=await f.task(),running=f.coordinator().executeTask({taskId:task.id,taskVersion:1});await entered.promise;
      await fault(f,'task.completed',async()=>{release.resolve();const done=await running;assert.equal(done.task.status,'FAILED');assert.equal(done.error.code,'PERSISTENCE_UNAVAILABLE');});
      const saved=await state(task.id);assert.equal(saved.execution.status,'FAILED');assert.equal(await resultCount(saved.execution.id),0);
      assert.ok(!(await history(task.id)).some(e=>e.event_type.endsWith('.completed')));
    }finally{release.resolve();await f.close();}
  });

  test('a failed failure-finalization transaction returns unresolved original error and preserves RUNNING records',async()=>{
    const entered=deferred(),release=deferred();const f=await fixture(async()=>{entered.resolve();await release.promise;throw new RuntimeError('TOOL_DENIED');});
    try{
      const task=await f.task(),running=f.coordinator().executeTask({taskId:task.id,taskVersion:1});await entered.promise;
      await fault(f,null,async()=>{release.resolve();const done=await running;assert.equal(done.kind,'unresolved');assert.equal(done.error.code,'TOOL_DENIED');assert.equal(done.finalizationError.code,'PERSISTENCE_UNAVAILABLE');});
      const saved=await state(task.id);assert.equal(saved.task.status,'RUNNING');assert.equal(saved.execution.status,'RUNNING');assert.equal(await resultCount(saved.execution.id),0);
      assert.ok(!(await history(task.id)).some(e=>e.event_type==='task.failed'));
    }finally{release.resolve();await f.close();}
  });
};

