require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {RuntimeHostService}=require('../dist/runtime/runtime-host.service');
const {runtimeSignals}=require('../dist/runtime/runtime-signals');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {validateEnvironment}=require('../dist/config/configuration');
const {definition,candidate,deferred,ids}=require('./runtime-fixtures.cjs');
const {createRuntimeExecutionRequest}=require('../dist/runtime/contracts/execution-request.contract');
const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
const {randomUUID}=require('node:crypto');
const logger={info(){},error(){}};
const host=()=>new RuntimeHostService({value:{runtime:{drainTimeoutMs:100}}},logger);
test('runtime state is explicit, closed before bootstrap, monotone and never readmitted after drain',async()=>{
  const h=host();assert.equal(h.snapshot().state,'STARTING');assert.throws(()=>h.acquire('execute',()=>{}),e=>e.code==='RUNTIME_DRAINING');
  h.onApplicationBootstrap();assert.equal(h.snapshot().state,'READY');
  const release=h.acquire('execute',()=>assert.fail('Clean drain must not abort'));
  const a=h.beginDrain(),b=h.beginDrain();assert.equal(a,b);assert.equal(h.snapshot().activeExecutions,1);
  assert.throws(()=>h.acquire('queue',()=>{}),e=>e.code==='RUNTIME_DRAINING');
  release();release();await a;assert.equal(h.snapshot().activeExecutions,0);assert.equal(h.snapshot().drainTimedOut,false);
  const stop=h.stop();assert.equal(h.stop(),stop);await stop;assert.equal(h.snapshot().state,'STOPPED');h.onApplicationBootstrap();assert.equal(h.admitting,false);
});
test('drain deadline and finalization fallback are bounded even when persistence remains unavailable',async({mock})=>{
  mock.timers.enable({apis:['setTimeout']});const h=host();h.onApplicationBootstrap();let aborted=0;
  const release=h.acquire('execute',()=>aborted++),drain=h.beginDrain();mock.timers.tick(100);await drain;
  assert.equal(h.snapshot().drainTimedOut,true);const stop=h.stop();await Promise.resolve();assert.equal(aborted,1);
  mock.timers.tick(5000);await stop;assert.equal(h.snapshot().state,'STOPPED');assert.equal(h.snapshot().activeExecutions,1);
  release();assert.equal(h.snapshot().activeExecutions,0);
});
test('signal owner registers once, treats repeated termination idempotently and closes after active work settles',async({mock})=>{
  const h=host();h.onApplicationBootstrap();const release=h.acquire('execute',()=>{});let closed=0,exit;
  mock.method(process,'exit',code=>{exit=code;});
  const readiness={drain(){}},app={get(type){return type===RuntimeHostService?h:type.name==='ReadinessService'?readiness:logger;},async close(){closed++;}};
  const before=process.listenerCount('SIGTERM'),cleanup=runtimeSignals(app);
  try{assert.equal(runtimeSignals(app),cleanup);assert.equal(process.listenerCount('SIGTERM'),before+1);
    const signal=process.listeners('SIGTERM').at(-1);signal();signal();assert.equal(closed,0);assert.equal(h.admitting,false);
    release();for(let i=0;i<12;i++)await Promise.resolve();assert.equal(closed,1);assert.equal(exit,0);
  }finally{cleanup();mock.restoreAll();}assert.equal(process.listenerCount('SIGTERM'),before);
});
test('drain during an in-flight admission never dispatches a strategy or fabricates a success',async()=>{
  const h=host();h.onApplicationBootstrap();const entered=deferred(),release=deferred();let calls=0,finished=0;
  const request=createRuntimeExecutionRequest({ids:ids(),input:{instruction:'test'},definition:definition()});
  const strategy={execute:async r=>{calls++;return candidate(r);}};
  const persistence={async admit(command,claim,signal){entered.resolve();await release.promise;return {task:{id:request.ids.taskId},execution:{id:request.ids.executionId},request,strategy,
    context:new ExecutionContextFactory(logger).create({request,signal,deadlineAt:new Date(Date.now()+10000).toISOString()})};},async heartbeat(){},
    async finish(a,outcome){finished++;assert.equal(outcome.error.code,'CANCELLED');return {task:{...a.task,status:'CANCELLED'},execution:{...a.execution,status:'CANCELLED'}};}};
  const coordinator=new RuntimeCoordinator(persistence,{resolve:()=>strategy},h),running=coordinator.executeTask({taskId:request.ids.taskId,taskVersion:1});
  await entered.promise;const draining=h.beginDrain();release.resolve();const result=await running;await draining;
  assert.equal(calls,0);assert.equal(finished,1);assert.equal(result.task.status,'CANCELLED');await h.stop();
});
test('drain configuration is bounded by the existing shutdown and container budgets',()=>{
  const base={NODE_ENV:'test',DATABASE_URL:'postgres://test:synthetic-password@127.0.0.1/test',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:randomUUID(),AGENT_REGISTRY_TOKEN:'a'.repeat(64),RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:'[]'};
  assert.equal(validateEnvironment(base).runtime.drainTimeoutMs,15000);
  for(const value of ['0','99','20001','-1','1.5','unlimited',''])assert.throws(()=>validateEnvironment({...base,RUNTIME_DRAIN_TIMEOUT_MS:value}),/configuration/i);
  assert.equal(validateEnvironment({...base,RUNTIME_DRAIN_TIMEOUT_MS:'20000'}).runtime.drainTimeoutMs,20000);
  assert.throws(()=>validateEnvironment({RUNTIME_DRAIN_TIMEOUT_MS:'1000'}));
});
