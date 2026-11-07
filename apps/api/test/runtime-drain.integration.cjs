const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {deferred}=require('./runtime-fixtures.cjs');
const {RuntimeHostService}=require('../dist/runtime/runtime-host.service');
module.exports=dependencies=>{
 const {row}=dependencies,fixture=require('./collaboration-recovery-fixture.cjs')(dependencies);
 test('T09 legacy native lifecycle start cannot bypass drain and queued work remains durable',async()=>{
  const f=await fixture();try{
   const task=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Legacy pending'},idempotencyKey:randomUUID()});
   const queued=await f.coordinator().queueTask({taskId:task.data.id,taskVersion:task.data.version});
   await f.app().get(RuntimeHostService).beginDrain();
   const lifecycle=f.app().get(require('../dist/lifecycle/task-lifecycle.service').TaskLifecycleService);
   await assert.rejects(lifecycle.startTask(queued.task.id,queued.execution.id,{taskVersion:queued.task.version,executionVersion:queued.execution.version}),e=>e.code==='RUNTIME_DRAINING');
   assert.equal((await row('SELECT status FROM executions WHERE id=$1',[queued.execution.id])).status,'PENDING');
   assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[queued.task.id])).status,'QUEUED');
  }finally{await f.close();}
 });
 test('T09 clean drain closes all admission while genuine child completion and reads remain available',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let running;
  try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});
   running=f.activate();await entered.promise;const host=f.app().get(RuntimeHostService),drain=host.beginDrain();
   assert.equal(host.snapshot().activeExecutions,1);
   const task=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Persist while draining'},idempotencyKey:randomUUID()});
   assert.equal(task.status,201);
   const rejected=await f.http(`tasks/${task.data.id}/execute`,'POST',{}, {'if-match':`"${task.data.version}"`});
   assert.equal(rejected.status,503);assert.equal(rejected.data.code,'RUNTIME_DRAINING');
   await assert.rejects(f.coordinator().queueTask({taskId:task.data.id,taskVersion:task.data.version}),e=>e.code==='RUNTIME_DRAINING');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[task.data.id])).n,0);
   const origin=await f.app().getUrl(),probe=await fetch(origin+'/ready?runtime=true');assert.equal(probe.status,503);
   assert.equal((await probe.json()).runtime.state,'DRAINING');assert.equal((await fetch(origin+'/health')).status,200);
   assert.equal((await f.http('tasks/'+task.data.id)).status,200);
   release.resolve();const done=await running;await drain;
   assert.equal(done.data.childExecution.status,'SUCCEEDED');assert.equal(done.data.delegation.status,'COMPLETED');
   assert.equal(host.snapshot().activeExecutions,0);assert.equal(host.snapshot().drainTimedOut,false);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
 test('T09 drain at the durable preparation-to-dispatch cut preserves one recoverable child rather than failing delegation',async()=>{
  const f=await fixture();try{
   const service=f.service(),prepare=service.prepare.bind(service);let prepared;
   service.prepare=async(...args)=>{prepared=await prepare(...args);void f.app().get(RuntimeHostService).beginDrain();return prepared;};
   const pending=await f.activate();assert.equal(pending.status,202);assert.equal(pending.data.delegation.status,'ACCEPTED');
   assert.equal(pending.data.childTask.status,'CREATED');assert.equal(pending.data.childExecution,null);
   assert.equal((await f.http(f.path+'/recover','POST',{})).status,503);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,0);
   await f.restart();const done=await f.http(f.path+'/recover','POST',{});assert.equal(done.status,200);
   assert.equal(done.data.delegations[0].childExecution.status,'SUCCEEDED');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,1);
  }finally{await f.close();}
 });
 test('T09 drain during a PostgreSQL admission transaction rolls back Task and Execution mutation',async()=>{
  const f=await fixture();try{
   const task=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Admission race'},idempotencyKey:randomUUID()});
   const persistence=f.coordinator().persistence,original=persistence.agentLock.bind(persistence);
   persistence.agentLock=async(...args)=>{const agent=await original(...args);void f.app().get(RuntimeHostService).beginDrain();return agent;};
   await assert.rejects(f.coordinator().executeTask({taskId:task.data.id,taskVersion:task.data.version}),e=>e.code==='RUNTIME_DRAINING');
   assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[task.data.id])).status,'CREATED');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[task.data.id])).n,0);
  }finally{await f.close();}
 });
 test('T09 bounded stop quarantines noncooperative work, rejects late success and never replays it on restart',async()=>{
  const f=await fixture(120000,{RUNTIME_DRAIN_TIMEOUT_MS:'100'}),entered=deferred(),release=deferred();let running;
  try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});
   running=f.activate();await entered.promise;const host=f.app().get(RuntimeHostService);await host.stop();
   const done=await running;assert.equal(host.snapshot().drainTimedOut,true);assert.equal(host.snapshot().state,'STOPPED');
   assert.equal(done.data.childExecution.status,'CANCELLED');assert.equal(done.data.childTask.status,'CANCELLED');
   const execution=done.data.childExecution.id;
   release.resolve();await f.restart();const recovered=await f.http(f.path+'/recover','POST',{});
   assert.equal(recovered.data.delegations[0].childExecution.id,execution);
   assert.equal((await row('SELECT status,reconciliation_state FROM executions WHERE id=$1',[execution])).reconciliation_state,'CANCELLATION_UNCONFIRMED');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[done.data.childTask.id])).n,1);
   assert.equal((await row('SELECT status FROM executions WHERE id=$1',[execution])).status,'CANCELLED');
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
};
