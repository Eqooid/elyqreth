'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {definition,candidate,deferred,ids}=require('./runtime-fixtures.cjs');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {executionCommand}=require('../dist/runtime/runtime-command');
const {validateEnvironment}=require('../dist/config/configuration');
const {createRuntimeExecutionRequest}=require('../dist/runtime/contracts/execution-request.contract');
const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {RuntimePersistenceService}=require('../dist/runtime/runtime-persistence.service');
const code = expected => error=>error instanceof RuntimeError&&error.code===expected;
const {RuntimeHostService}=require('../dist/runtime/runtime-host.service');
const safeLogger={info(){},error(){}};
function fixture(execute, timeout=120000) {
  const request=createRuntimeExecutionRequest({ids:ids(),input:{instruction:'fixture'},definition:definition(timeout)});
  const strategy={type:'RULE_BASED',execute:execute??(async r=>candidate(r))};
  const registry=new StrategyRegistry([{id:'text.stats.v1',strategy}]);
  const finished=[];
  const store={
    async admit(command,claim,signal,resolve){
      return {task:{id:request.ids.taskId,status:claim?'RUNNING':'QUEUED'},execution:{id:request.ids.executionId,status:claim?'RUNNING':'PENDING'},
        request,strategy:resolve(request.definition),leaseToken:randomUUID(),
        context:new ExecutionContextFactory(safeLogger).create({request,signal,deadlineAt:new Date(Date.now()+timeout-1).toISOString()})};
    },
    async heartbeat(){},
    async finish(admission,outcome){finished.push(outcome);return {task:{...admission.task,status:outcome.result?'COMPLETED':'FAILED'},
      execution:{...admission.execution,status:outcome.result?'SUCCEEDED':'FAILED'},...(outcome.result?{result:outcome.result}:{})};},
  };
  const host=new RuntimeHostService({value:{runtime:{drainTimeoutMs:0}}},safeLogger);host.onApplicationBootstrap();
  return {request,registry,store,finished,host,coordinator:new RuntimeCoordinator(store,registry,host),command:{taskId:request.ids.taskId,taskVersion:1}};
}

test('runtime command rejects caller-selected identity, provider, permissions and invalid versions',()=>{
  const valid={taskId:randomUUID(),taskVersion:1,correlationId:randomUUID()};assert.deepEqual(executionCommand(valid),valid);
  for(const patch of [{taskId:'invalid'},{taskVersion:0},{taskVersion:1.5},{agentId:randomUUID()},{ownerId:randomUUID()},
    {correlationId:'bad'},{provider:'paid'},{authorizedCapabilities:['tool.shell']}])
    assert.throws(()=>executionCommand({...valid,...patch}),code('INVALID_INPUT'));
});
test('strategy registry explicitly registers stable IDs, rejects duplicates/mismatch and freezes the selected method',async()=>{
  const fake={type:'RULE_BASED',execute:async()=>42};const registry=new StrategyRegistry([{id:'text.stats.v1',strategy:fake}]);
  fake.execute=()=>assert.fail('replaced');assert.equal(await registry.resolve(definition()).execute(),42);
  assert.throws(()=>registry.register('text.stats.v1',fake),code('CONFIGURATION_ERROR'));
  assert.throws(()=>registry.register('arbitrary.module',fake),code('CONFIGURATION_ERROR'));
  assert.throws(()=>registry.register('llm.text.v1',fake),code('CONFIGURATION_ERROR'));
  assert.throws(()=>new StrategyRegistry([]).resolve(definition()),code('STRATEGY_NOT_FOUND'));
});
test('runtime opt-in configuration requires local registry, bounds catalog and preserves disabled startup',()=>{
  assert.equal(validateEnvironment({}).runtime,undefined);
  const base={NODE_ENV:'test',DATABASE_URL:'postgres://test:private-password@127.0.0.1:5432/test',
    AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:randomUUID(),AGENT_REGISTRY_TOKEN:'a'.repeat(64),
    RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:JSON.stringify([{agentId:randomUUID(),orchestratorId:randomUUID(),definition:definition()}])};
  assert.equal(validateEnvironment(base).runtime.bindings.length,1);
  for(const patch of [{NODE_ENV:'production'},{AGENT_REGISTRY_ENABLED:'false'},{API_HOST:'0.0.0.0'},
    {RUNTIME_ENABLED:'yes'},{RUNTIME_BINDINGS:'private-secret-not-json'},{RUNTIME_BINDINGS:'x'.repeat(32769)}])
    assert.throws(()=>validateEnvironment({...base,...patch}),e=>!e.message.includes('private-secret'));
  const duplicated=JSON.parse(base.RUNTIME_BINDINGS);duplicated.push(duplicated[0]);
  assert.throws(()=>validateEnvironment({...base,RUNTIME_BINDINGS:JSON.stringify(duplicated)}));
});
test('coordinator rejects admission without finalizing unclaimed records, including missing/disabled/task state/strategy errors',async()=>{
  for(const errorCode of ['DEFINITION_UNAVAILABLE','ACCESS_DENIED','CAPACITY_EXCEEDED','STRATEGY_NOT_FOUND','CONFIGURATION_ERROR']){
    const f=fixture();f.store.admit=async()=>{throw new RuntimeError(errorCode);};
    await assert.rejects(f.coordinator.executeTask(f.command),code(errorCode));assert.equal(f.finished.length,0);
  }
  for(const nodeEnv of ['development','production']){
    const persistence=new RuntimePersistenceService({}, {value:{nodeEnv}}, {}, {});
    await assert.rejects(persistence.admit({},true,new AbortController().signal,()=>{}),code('ACCESS_DENIED'));
  }
});
test('coordinator invokes the resolved contract with one scoped validated context and validates success output',async()=>{
  let seen;const f=fixture(async(r,c)=>{seen={r,c};return candidate(r);});
  const queued=await f.coordinator.queueTask(f.command);assert.equal(queued.execution.status,'PENDING');assert.equal(f.finished.length,0);
  const outcome=await f.coordinator.executeTask(f.command);assert.equal(outcome.kind,'finished');assert.equal(outcome.task.status,'COMPLETED');
  assert.equal(seen.r.ids.executionId,seen.c.ids.executionId);assert.equal(seen.c.ids.correlationId,f.request.ids.correlationId);
  assert.equal(outcome.result.executionId,f.request.ids.executionId);
});
test('strategy failure and invalid result finalize with fixed errors, never leaking original exception text',async()=>{
  for(const strategy of [async()=>{throw new Error('password=private sentinel');},async()=>({status:'SUCCEEDED',apiKey:'secret'})]){
    const f=fixture(strategy),outcome=await f.coordinator.executeTask(f.command);
    assert.equal(outcome.task.status,'FAILED');assert.equal(f.finished.length,1);
    assert.ok(!JSON.stringify(outcome).includes('sentinel'));assert.ok(!JSON.stringify(outcome).includes('apiKey'));
  }
});
test('secondary finalization errors preserve original classification and return unresolved state',async()=>{
  const f=fixture(async()=>{throw new RuntimeError('TOOL_DENIED');});
  f.store.finish=async()=>{throw new RuntimeError('PERSISTENCE_UNAVAILABLE');};
  const outcome=await f.coordinator.executeTask(f.command);
  assert.equal(outcome.kind,'unresolved');assert.equal(outcome.error.code,'TOOL_DENIED');assert.equal(outcome.finalizationError.code,'PERSISTENCE_UNAVAILABLE');
});
test('cancellation and deadline abort strategy waits, ignore late results and release the local capacity guard',async()=>{
  for(const timeout of [false,true]){
    const entered=deferred(),late=deferred();let context;
    const f=fixture(async(r,c)=>{context=c;entered.resolve();await late.promise;return candidate(r);},timeout?150:120000);
    const controller=new AbortController();const running=f.coordinator.executeTask(f.command,controller.signal);await entered.promise;
    if(!timeout)controller.abort('private reason');
    const outcome=await running;assert.equal(outcome.error.code,timeout?'DEADLINE_EXCEEDED':'CANCELLED');assert.equal(context.signal.aborted,true);
    late.resolve();await Promise.resolve();assert.equal(f.finished.length,1);
  }
});
test('duplicate local calls are bounded and lifecycle conflicts do not cause a second strategy invocation',async()=>{
  const entered=deferred(),release=deferred();let calls=0;
  const f=fixture(async r=>{calls++;entered.resolve();await release.promise;return candidate(r);});
  const first=f.coordinator.executeTask(f.command);await entered.promise;
  await assert.rejects(f.coordinator.executeTask(f.command),code('CAPACITY_EXCEEDED'));release.resolve();await first;assert.equal(calls,1);
  f.store.heartbeat=async()=>{throw new RuntimeError('LEASE_LOST');};
  const outcome=await f.coordinator.executeTask(f.command);assert.equal(outcome.error.code,'LEASE_LOST');assert.equal(calls,1);
});

test('T10 shutdown cancels active strategy, drains finalization, rejects new work and cleans caller listeners',async()=>{
  const {getEventListeners}=require('node:events');
  const entered=deferred(),late=deferred(),caller=new AbortController();let child;
  const f=fixture(async(r,c)=>{child=c.signal;entered.resolve();await late.promise;return candidate(r);});
  const running=f.coordinator.executeTask(f.command,caller.signal);await entered.promise;
  await f.coordinator.onModuleDestroy();const done=await running;
  assert.equal(done.error.code,'CANCELLED');assert.equal(child.aborted,true);
  assert.equal(getEventListeners(caller.signal,'abort').length,0);assert.equal(f.finished.length,1);
  await assert.rejects(f.coordinator.executeTask(f.command),code('RUNTIME_DRAINING'));
  await assert.rejects(f.coordinator.queueTask(f.command),code('RUNTIME_DRAINING'));
  late.resolve();await f.coordinator.onModuleDestroy();assert.equal(f.finished.length,1);
});

test('T10 shutdown grace is bounded when persistence cannot acknowledge finalization',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const entered=deferred(),finishing=deferred(),release=deferred();
  const f=fixture(async()=>{entered.resolve();return new Promise(()=>{});});
  f.store.finish=async()=>{finishing.resolve();await release.promise;throw new RuntimeError('PERSISTENCE_UNAVAILABLE');};
  const running=f.coordinator.executeTask(f.command);await entered.promise;
  const draining=f.coordinator.onModuleDestroy();t.mock.timers.tick(0);await finishing.promise;
  t.mock.timers.tick(5000);await draining;
  release.resolve();const done=await running;assert.equal(done.kind,'unresolved');
  assert.equal(done.error.code,'CANCELLED');assert.equal(done.finalizationError.code,'PERSISTENCE_UNAVAILABLE');
});

test('T10 every coordinator outcome closes its execution scope without cancelling an independent execution',async()=>{
  for(const failure of [false,true]){
    let scope;const caller=new AbortController();
    const f=fixture(async(r,c)=>{scope=c;if(failure)throw new Error('private');return candidate(r);});
    const otherEntered=deferred(),otherRelease=deferred();let otherScope;
    const other=fixture(async(r,c)=>{otherScope=c;otherEntered.resolve();await otherRelease.promise;return candidate(r);});
    const concurrent=other.coordinator.executeTask(other.command);await otherEntered.promise;
    const done=await f.coordinator.executeTask(f.command,caller.signal);
    assert.equal(done.task.status,failure?'FAILED':'COMPLETED');assert.equal(scope.signal.aborted,true);
    assert.equal(caller.signal.aborted,false);assert.equal(otherScope.signal.aborted,false);
    otherRelease.resolve();assert.equal((await concurrent).task.status,'COMPLETED');
  }
});

test('T10 caller cancellation before admission and immediately before success finalization never commits success',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  f.store.admit=async(_c,_claim,signal)=>{assert.equal(signal.aborted,true);throw new RuntimeError('CANCELLED');};
  await assert.rejects(f.coordinator.executeTask(f.command,controller.signal),code('CANCELLED'));assert.equal(f.finished.length,0);
  const caller=new AbortController(),late=fixture();
  late.store.heartbeat=async()=>{};
  late.store.finish=async(_a,outcome)=>{caller.abort();assert.equal(_a.context.signal.aborted,true);return {task:{status:'CANCELLED'},execution:{status:'CANCELLED'}};};
  assert.equal((await late.coordinator.executeTask(late.command,caller.signal)).error.code,'CANCELLED');
});

test('T11 trusted HTTP deadline cancellation remains a timeout through the actual coordinator',async()=>{
  const entered=deferred(),release=deferred(),controller=new AbortController();
  const f=fixture(async r=>{entered.resolve();await release.promise;return candidate(r);});
  const running=f.coordinator.executeTask(f.command,controller.signal);await entered.promise;
  controller.abort(new RuntimeError('DEADLINE_EXCEEDED','context'));
  const outcome=await running;assert.equal(outcome.error.code,'DEADLINE_EXCEEDED');
  assert.equal(f.finished[0].error.code,'DEADLINE_EXCEEDED');release.resolve();
});
