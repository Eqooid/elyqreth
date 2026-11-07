const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {CollaborationRecoveryService}=require('../dist/collaboration/collaboration-recovery.service');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');const {createApplication}=require('../dist/application');
const {deferred}=require('./runtime-fixtures.cjs');
module.exports=dependencies=>{
 const {row,getPool}=dependencies,fixture=require('./collaboration-recovery-fixture.cjs')(dependencies);
 const base=f=>`collaborations/${f.session.id}`;
 const reconcile=f=>f.http(base(f)+'/reconcile','POST',{});
 test('P5 T05 genuine success propagates aggregate state and repeated/out-of-order observations have no side effects',async()=>{
  const f=await fixture();try{
   const done=await f.activate();assert.equal(done.data.delegation.status,'COMPLETED');
   const before=await row('SELECT count(*)::int n FROM agent_events WHERE owner_id=$1',[f.owner.id]);
   for(let i=0;i<4;i++){const r=await reconcile(f);assert.equal(r.status,200);assert.equal(r.data.collaboration.status,'COMPLETED');assert.equal(r.data.delegations[0].resultAvailable,true);}
   assert.deepEqual(await row('SELECT count(*)::int n FROM agent_events WHERE owner_id=$1',[f.owner.id]),before);
   const late=await f.http(base(f)+'/cancel','POST',{});assert.equal(late.status,200);assert.equal(late.data.collaboration.status,'COMPLETED');
   assert.equal((await f.activate()).data.childExecution.id,done.data.childExecution.id);
  }finally{await f.close();}
 });
 test('P5 T05 genuine child failure closes the mandatory collaboration; native timeout remains quarantined when uncertain',async()=>{
  for(const timeout of [false,true]){const f=await fixture(timeout?100:120000);try{
   f.control(async(r,c)=>{if(timeout)await new Promise((_,reject)=>{const fail=()=>reject(c.signal.reason);c.signal.addEventListener('abort',fail,{once:true});if(c.signal.aborted)fail();});throw new RuntimeError('INTERNAL_RUNTIME_ERROR');});
   const done=await f.activate();assert.equal(done.data.delegation.status,'FAILED');assert.equal(done.data.childExecution.status,timeout?'TIMED_OUT':'FAILED');
   const result=await reconcile(f);assert.equal(result.data.collaboration.status,timeout?'WAITING':'FAILED');
   if(timeout)assert.equal(result.data.requiresAttention,true);
   assert.equal((await f.http(f.path+'/recover','POST',{})).data.delegations[0].childExecution.id,done.data.childExecution.id);
  }finally{await f.close();}}
 });
 test('P5 T05 pending cancellation is idempotent, never cancels the source, and blocks activation',async()=>{
  const f=await fixture();try{
   const r=await f.http(f.path+'/cancel','POST',{});assert.equal(r.status,200);assert.equal(r.data.collaboration.status,'CANCELLED');assert.equal(r.data.delegations[0].delegation.status,'CANCELLED');
   await f.http(f.path+'/cancel','POST',{});assert.equal((await row("SELECT count(*)::int n FROM command_audit WHERE owner_id=$1 AND command_type='delegation.cancel.requested'",[f.owner.id])).n,1);
   assert.deepEqual((await f.http('tasks/'+f.parent.task.id)).data,f.parent.task);assert.equal((await f.activate()).status,409);
  }finally{await f.close();}
 });
 test('P5 T05 committed cancellation intent survives restart and prevents prepared-child admission',async()=>{
  const f=await fixture();try{
   const prepared=await f.service().prepare(f.session.id,f.d.id,f.input);
   // Controlled cut: durable intent commits, process closes before propagation.
   const service=f.service();const context=service.api.operatorContext();
   const recovery=service.repository;await recovery.run(context,async(_,tx)=>{const {controlAudit}=require('../dist/collaboration/collaboration-control');await controlAudit(tx,context,'collaboration.cancel.requested','collaboration',f.session.id,{sessionId:f.session.id});});
   await assert.rejects(f.coordinator().executeTask({taskId:prepared.taskId,taskVersion:prepared.taskVersion,delegationId:f.d.id,correlationId:randomUUID()}),e=>e.code==='ACCESS_DENIED');
   // The activation rejection path must not convert an earlier committed cancel intent into failure.
   await service.rejectUnstarted(f.session.id,f.d.id,'ACCESS_DENIED');
   assert.equal((await f.http(f.path)).data.status,'ACCEPTED');
   await f.restart();const r=await reconcile(f);assert.equal(r.data.collaboration.status,'CANCELLED');assert.equal(r.data.delegations[0].childTask.status,'CANCELLED');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,0);
  }finally{await f.close();}
 });
 test('P5 T05 restart recovery dispatches a never-admitted child once across concurrent requests and preserves result',async()=>{
  const f=await fixture();const entered=deferred(),release=deferred();let running,calls=0;try{
   const prepared=await f.service().prepare(f.session.id,f.d.id,f.input);await f.restart();
   f.control(async(r,c,real)=>{calls++;entered.resolve();await release.promise;return real.execute(r,c);});
   running=f.http(f.path+'/recover','POST',{});await Promise.race([entered.promise,running.then(r=>{throw Error('Recovery did not dispatch: '+JSON.stringify(r));})]);
   const repeats=await Promise.all(Array.from({length:3},()=>f.http(f.path+'/recover','POST',{})));assert.ok(repeats.every(r=>r.status===202));assert.equal(calls,1);
   release.resolve();const done=await running;assert.equal(done.status,200);assert.equal(done.data.collaboration.status,'COMPLETED');assert.equal(done.data.delegations[0].childTask.id,prepared.taskId);assert.equal(done.data.delegations[0].resultAvailable,true);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,1);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
 test('P5 T05 recovery attempts are durably capped and rejected dispatch never fabricates a failed execution',async()=>{
  const f=await fixture();try{
   const prepared=await f.service().prepare(f.session.id,f.d.id,f.input);let calls=0;
   f.coordinator().executeTask=async()=>{calls++;throw new RuntimeError('CAPACITY_EXCEEDED');};
   for(let i=0;i<4;i++)assert.equal((await f.http(f.path+'/recover','POST',{})).status,202);
   assert.equal(calls,3);await f.restart();const r=await f.http(f.path+'/recover','POST',{});
   assert.equal(r.data.delegations[0].recoveryAttempts,3);assert.equal(r.data.delegations[0].attention,'RECOVERY_EXHAUSTED');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,0);
  }finally{await f.close();}
 });
 test('P5 T05 active cancellation preserves native quarantine and does not cancel an unrelated Agent execution',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred(),otherEntered=deferred(),otherRelease=deferred();let running,other,unrelated;try{
   other=await createApplication(f.config);await other.listen(0,'127.0.0.1');
   const native=other.get(TextStatisticsStrategy);other.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{otherEntered.resolve();await otherRelease.promise;return native.execute(r,c);}}}]);
   const task=(await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Independent work'}})).data;
   unrelated=other.get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:task.version});await otherEntered.promise;
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});running=f.activate();await Promise.race([entered.promise,running.then(r=>{throw Error('No child: '+JSON.stringify(r));})]);
   const cancelled=await f.http(base(f)+'/cancel','POST',{});assert.equal(cancelled.status,202);assert.equal(cancelled.data.collaboration.status,'WAITING');assert.equal(cancelled.data.requiresAttention,true);
   assert.equal((await f.http('tasks/'+task.id)).data.status,'RUNNING');
   release.resolve();await running;otherRelease.resolve();assert.equal((await unrelated).execution.status,'SUCCEEDED');
   const final=await reconcile(f);assert.equal(final.data.delegations[0].delegation.status,'CANCELLED');assert.equal(final.data.collaboration.status,'WAITING');
  }finally{release.resolve();otherRelease.resolve();await running?.catch(()=>{});await unrelated?.catch(()=>{});await other?.close();await f.close();}
 });
 test('P5 T05 operator controls deny unauthenticated, foreign and forged lifecycle requests',async()=>{
  const f=await fixture(),foreign=await fixture();try{
   for(const suffix of ['/cancel','/recover']){assert.equal((await f.http(f.path+suffix,'POST',{}, {},null)).status,401);assert.equal((await f.http(f.path+suffix,'POST',{status:'COMPLETED'})).status,400);}
   assert.equal((await f.http(`collaborations/${randomUUID()}/cancel`,'POST',{})).status,404);
   assert.equal((await f.http(base(f)+`/delegations/${randomUUID()}/recover`,'POST',{})).status,404);
   for(const operation of ['cancel','recover'])assert.equal((await f.http(`collaborations/${foreign.session.id}/delegations/${foreign.d.id}/${operation}`,'POST',{})).status,404);
   assert.equal((await f.http(`collaborations/${foreign.session.id}/cancel`,'POST',{})).status,404);
   assert.equal((await foreign.http(foreign.path)).data.status,'REQUESTED');
   assert.equal((await f.http('collaborations/reconcile','POST',{limit:21})).status,400);
   assert.equal((await f.http(base(f)+'/reconcile','POST',{ownerId:randomUUID()})).status,400);
  }finally{await f.close();await foreign.close();}
 });
 test('P5 T05 cancellation propagation failure retains durable intent for repeatable recovery after restart',async()=>{
  const f=await fixture();try{
   const p=await f.service().prepare(f.session.id,f.d.id,f.input);
   await getPool().query(`CREATE FUNCTION p5_t05_cancel_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${p.taskId}'::uuid THEN RAISE EXCEPTION 'private task fault' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t05_cancel_fault BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION p5_t05_cancel_fault()');
   try{assert.equal((await f.http(base(f)+'/cancel','POST',{})).status,503);}finally{await getPool().query('DROP TRIGGER p5_t05_cancel_fault ON tasks');await getPool().query('DROP FUNCTION p5_t05_cancel_fault()');}
   assert.equal((await f.http('tasks/'+p.taskId)).data.status,'CREATED');await f.restart();const fixed=await reconcile(f);assert.equal(fixed.data.collaboration.status,'CANCELLED');assert.equal(fixed.data.delegations[0].childTask.status,'CANCELLED');
  }finally{await f.close();}
 });
 test('P5 T05 reconciliation batches are owner-scoped, bounded, cursor-based and never dispatch work',async()=>{
  const f=await fixture();try{
   const root=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'No delegation'}});
   assert.equal((await f.http('collaborations','POST',{rootTaskId:root.data.id,participantAgentIds:f.agents.map(a=>a.id),idempotencyKey:randomUUID()})).status,201);
   const first=await f.http('collaborations/reconcile','POST',{limit:1});assert.equal(first.status,200);assert.equal(first.data.items.length,1);assert.ok(first.data.nextCursor);
   const last=await f.http('collaborations/reconcile','POST',{limit:1,after:first.data.nextCursor});assert.equal(last.data.items.length,1);assert.equal(last.data.nextCursor,null);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE owner_id=$1',[f.owner.id])).n,1);
  }finally{await f.close();}
 });
 test('P5 T05 independent recovery instances race on the same persisted child and admit exactly one execution',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let pending,other;try{
   const prepared=await f.service().prepare(f.session.id,f.d.id,f.input);
   const first=f.coordinator(),execute=first.executeTask.bind(first);first.executeTask=async(...args)=>{entered.resolve();await release.promise;return execute(...args);};
   pending=f.http(f.path+'/recover','POST',{});await Promise.race([entered.promise,pending.then(r=>{throw Error(JSON.stringify(r));})]);
   other=await createApplication(f.config);await other.listen(0,'127.0.0.1');
   const response=await fetch(`${await other.getUrl()}/api/v1/${f.path}/recover`,{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:'{}'});
   const second=await response.json();assert.equal(response.status,200);assert.equal(second.collaboration.status,'COMPLETED');
   release.resolve();const original=await pending;assert.equal(original.data.delegations[0].childExecution.id,second.delegations[0].childExecution.id);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,1);
  }finally{release.resolve();await pending?.catch(()=>{});await other?.close();await f.close();}
 });
 test('P5 T05 cancellation and completion race preserve the exact native terminal winner and session quarantine',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let pending;try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});pending=f.activate();
   await Promise.race([entered.promise,pending.then(r=>{throw Error(JSON.stringify(r));})]);
   const cancellation=f.http(base(f)+'/cancel','POST',{});release.resolve();await Promise.all([pending,cancellation]);
   const observed=(await reconcile(f)).data,d=observed.delegations[0];
   const actual=await row('SELECT status,reconciliation_state FROM executions WHERE id=$1',[d.childExecution.id]);
   if(actual.status==='SUCCEEDED'){assert.equal(d.delegation.status,'COMPLETED');assert.equal(observed.collaboration.status,'COMPLETED');}
   else{assert.equal(actual.status,'CANCELLED');assert.equal(d.delegation.status,'CANCELLED');assert.equal(actual.reconciliation_state,'CANCELLATION_UNCONFIRMED');assert.equal(observed.collaboration.status,'WAITING');assert.equal(observed.requiresAttention,true);}
  }finally{release.resolve();await pending?.catch(()=>{});await f.close();}
 });
 test('P5 T05 expired native admission after lost finalization stays WAITING and is never replayed',async()=>{
  const f=await fixture();let calls=0;try{
   f.control(async(r,c,real)=>{calls++;return real.execute(r,c);});
   await getPool().query(`CREATE FUNCTION p5_t05_finish_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.agent_id='${f.agents[1].id}'::uuid AND NEW.status IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') THEN RAISE EXCEPTION 'private outcome fault' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t05_finish_fault BEFORE UPDATE ON executions FOR EACH ROW EXECUTE FUNCTION p5_t05_finish_fault()');
   let result;try{result=await f.activate();}finally{await getPool().query('DROP TRIGGER p5_t05_finish_fault ON executions');await getPool().query('DROP FUNCTION p5_t05_finish_fault()');}
   assert.equal(result.status,202);assert.equal(result.data.childExecution.status,'RUNNING');
   await getPool().query("UPDATE executions SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[result.data.childExecution.id]);
   await f.restart();const recovered=await f.http(f.path+'/recover','POST',{});assert.equal(recovered.status,202);
   assert.equal(recovered.data.collaboration.status,'WAITING');assert.equal(recovered.data.delegations[0].attention,'OUTCOME_UNCERTAIN');assert.equal(calls,1);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[result.data.childTask.id])).n,1);
  }finally{await f.close();}
 });
 test('P5 T05 additive recovery indexes apply against populated prior tables without changing existing work',async()=>{
  const f=await fixture();const client=await getPool().connect();try{
   const {readFileSync}=require('node:fs'),{join}=require('node:path');
   const counts=()=>client.query('SELECT (SELECT count(*)::int FROM tasks) tasks,(SELECT count(*)::int FROM executions) executions,(SELECT count(*)::int FROM collaboration_delegations) delegations');
   const before=(await counts()).rows;await client.query('BEGIN');
   await client.query('DROP INDEX collaboration_sessions_incomplete_idx');await client.query('DROP INDEX command_audit_resource_command_idx');
   const sql=readFileSync(join(__dirname,'../migrations/0006_wise_jigsaw.sql'),'utf8').replaceAll('--> statement-breakpoint','');await client.query(sql);
   assert.deepEqual((await counts()).rows,before);assert.equal((await client.query("SELECT count(*)::int n FROM pg_indexes WHERE indexname IN ('collaboration_sessions_incomplete_idx','command_audit_resource_command_idx')")).rows[0].n,2);
  }finally{await client.query('ROLLBACK');client.release();await f.close();}
 });
 test('P5 T05 incomplete historical correlation cannot fabricate aggregate success or trigger recovery execution',async()=>{
  const f=await fixture();try{
   const child=await f.service().prepare(f.session.id,f.d.id,f.input);
   const service=f.service(),context=service.api.operatorContext();
   // The foundational repository permits lifecycle-only history. T05 must diagnose it, not invent an Execution.
   await service.repository.run(context,async r=>{let d=await r.getDelegation(f.d.id);for(const status of ['EXECUTING','AWAITING_RETURN','COMPLETED'])d=await r.updateDelegation(d.id,d.version,{status});});
   const report=await reconcile(f);assert.equal(report.status,200);assert.equal(report.data.collaboration.status,'WAITING');assert.equal(report.data.requiresAttention,true);
   assert.equal(report.data.delegations[0].attention,'CORRELATION_MISMATCH');assert.equal(report.data.delegations[0].delegation.status,'COMPLETED');
   await f.http(f.path+'/recover','POST',{});assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[child.taskId])).n,0);
  }finally{await f.close();}
 });

 test('P5 T11 hard process crash after native child admission preserves correlation and fences recovery',{timeout:45000},async()=>{
  const f=await fixture();let child,reopened,pending,closed=false;
  const bounded=(promise)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned collaboration process deadline')),15000);})]).finally(()=>clearTimeout(timer));};
  try{
   await f.close();closed=true;
   child=require('node:child_process').fork(require('node:path').resolve(__dirname,'interaction-runtime-child.cjs'),[],{execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
   const queue=[],waiters=[];child.on('message',m=>{const i=waiters.findIndex(w=>w.kind===m?.kind);if(i>=0)waiters.splice(i,1)[0].resolve(m);else queue.push(m);});
   const wait=kind=>{const i=queue.findIndex(m=>m.kind===kind);return i>=0?Promise.resolve(queue.splice(i,1)[0]):bounded(new Promise(resolve=>waiters.push({kind,resolve})));};
   const {definition}=require('./runtime-fixtures.cjs');
   child.send({kind:'open',env:{NODE_ENV:'test',DATABASE_URL:dependencies.getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:f.owner.id,AGENT_REGISTRY_TOKEN:f.token,RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:JSON.stringify(f.agents.map(a=>({agentId:a.id,orchestratorId:f.route.id,definition:definition(120000)})))}});
   const ready=await wait('ready');pending=fetch(ready.origin+'/api/v1/'+f.path+'/activate',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(f.input),signal:AbortSignal.timeout(20000)}).catch(()=>null);
   const entered=await wait('entered');const relation=await row('SELECT child_task_id,child_execution_id FROM collaboration_delegations WHERE id=$1',[f.d.id]);assert.equal(relation.child_task_id,entered.taskId);assert.equal(relation.child_execution_id,entered.executionId);
   assert.ok(child.pid&&child.pid!==process.pid);const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await bounded(stopped);await pending;
   assert.equal((await row('SELECT status FROM executions WHERE id=$1',[entered.executionId])).status,'RUNNING');
   // Advance only the persisted lease clock cut; no Task/Execution outcome is forged.
   await getPool().query("UPDATE executions SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[entered.executionId]);
   reopened=await createApplication(f.config);await reopened.listen(0,'127.0.0.1');
   const recovery=reopened.get(CollaborationRecoveryService);const results=await Promise.all([recovery.recover(f.session.id,f.d.id),recovery.recover(f.session.id,f.d.id),recovery.reconcile(f.session.id)]);
   assert.ok(results.every(r=>r.collaboration.status==='WAITING'&&r.requiresAttention));assert.ok(results.every(r=>r.delegations[0].attention==='OUTCOME_UNCERTAIN'));
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[entered.taskId])).n,1);assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[entered.taskId])).status,'RUNNING');assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[f.parent.task.id])).status,'COMPLETED');
   require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(),'elyqreth-p5-t11-crash.json'),JSON.stringify({status:'PASS',actualOwnedProcessKilled:true,committedCorrelation:true,concurrentRecoveryCalls:3,childExecutionCount:1,collaborationStatus:'WAITING',attention:'OUTCOME_UNCERTAIN',automaticRedispatch:false},null,2));
  }finally{if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await bounded(stopped);}await pending?.catch(()=>{});await reopened?.close();if(!closed)await f.close();}
 });
};
