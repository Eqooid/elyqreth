const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID,randomBytes}=require('node:crypto');
const {createApplication}=require('../dist/application');const {validateEnvironment}=require('../dist/config/configuration');const {ApiLogger}=require('../dist/common/api-logger');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {NativeCoordinationService}=require('../dist/collaboration/native-coordination.service');const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');const {definition,deferred}=require('./runtime-fixtures.cjs');
module.exports=({row,getUrl,getPool})=>{
 async function fixture(timeout=120000){
  const owner=await row("INSERT INTO owners(name) VALUES ('native-collaboration') RETURNING id"),route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native','native','ENABLED') RETURNING id",[owner.id]);
  const agents=[];for(let i=0;i<2;i++)agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,$3,'RULE_BASED','ACTIVE') RETURNING id",[owner.id,route.id,'Native '+i]));
  const token=randomBytes(32).toString('hex'),config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,RUNTIME_ENABLED:'true',
   RUNTIME_BINDINGS:JSON.stringify(agents.map((a,i)=>({agentId:a.id,orchestratorId:route.id,definition:definition(i===1?timeout:120000)})))});
  let app;const open=async()=>{app=await createApplication(config);app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};await app.listen(0,'127.0.0.1');};await open();
  const http=async(path,method='GET',body,headers={},auth=token)=>{
   const res=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:res.status,data:await res.json()};
  };
  const root=await http('tasks','POST',{agentId:agents[0].id,input:{instruction:'Parent task stays complete'},idempotencyKey:randomUUID()});assert.equal(root.status,201);
  const parent=await http(`tasks/${root.data.id}/execute`,'POST',{}, {'if-match':`"${root.data.version}"`});assert.equal(parent.status,200);
  const session=await http('collaborations','POST',{rootTaskId:root.data.id,participantAgentIds:agents.map(a=>a.id),idempotencyKey:randomUUID()});assert.equal(session.status,201);
  const requested=await http(`collaborations/${session.data.id}/delegations`,'POST',{sourceAgentId:agents[0].id,targetAgentId:agents[1].id,parentTaskId:root.data.id,sourceExecutionId:parent.data.execution.id,idempotencyKey:randomUUID()});assert.equal(requested.status,201);
  const d=requested.data,path=`collaborations/${session.data.id}/delegations/${d.id}`,input={instruction:'Three child words',idempotencyKey:randomUUID()};
  const activate=(value=input,auth=token)=>http(path+'/activate','POST',value,{},auth);
  const control=fn=>{const real=app.get(TextStatisticsStrategy);app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:(r,c)=>fn(r,c,real)}}]);};
  return {owner,route,agents,parent:parent.data,session:session.data,d,path,input,http,activate,control,token,config,
   service:()=>app.get(NativeCoordinationService),coordinator:()=>app.get(RuntimeCoordinator),restart:async()=>{await app.close();await open();},close:()=>app.close()};
 }
 test('P6 T03 forged identity headers cannot switch owner across native execution delegation or polling APIs',async()=>{
  const a=await fixture(),b=await fixture();
  const spoof={'x-user-id':b.owner.id,'x-owner-id':b.owner.id,'x-tenant-id':b.owner.id,
   'x-forwarded-user':'administrator','x-forwarded-for':'127.0.0.1',cookie:'session=unverified'};
  try{
   const before=await row('SELECT status,version FROM executions WHERE id=$1',[b.parent.execution.id]);
   const tasksBefore=await row('SELECT count(*)::int n FROM tasks WHERE owner_id=$1',[b.owner.id]);
   for(const path of [`agents/${b.agents[0].id}`,`tasks/${b.parent.task.id}`,
    `tasks/${b.parent.task.id}/executions/${b.parent.execution.id}`,
    `tasks/${b.parent.task.id}/executions/${b.parent.execution.id}/result`,
    `collaborations/${b.session.id}`,`collaborations/${b.session.id}/delegations`,
    `collaboration-activity/${b.session.id}/snapshot`,`collaboration-activity/${b.session.id}/timeline`,
    `collaboration-activity/${b.session.id}/events?afterPosition=0`]){
    const r=await a.http(path,'GET',undefined,spoof);assert.equal(r.status,404,path);
    assert.ok(!JSON.stringify(r.data).includes(b.owner.id));
   }
   assert.equal((await a.http(`tasks/${b.parent.task.id}/execute`,'POST',{}, {...spoof,'if-match':'"1"'})).status,404);
   assert.equal((await a.http(`tasks/${b.parent.task.id}/executions/${b.parent.execution.id}/cancel`,'POST',
    {taskVersion:b.parent.task.version},{...spoof,'if-match':'"1"'})).status,404);
   assert.equal((await a.http(b.path+'/activate','POST',b.input,spoof)).status,404);
   assert.equal((await a.http(`tasks/${a.parent.task.id}`,'GET',undefined,spoof)).status,200);
   assert.equal((await a.http(`tasks/${a.parent.task.id}`,'GET',undefined,spoof,b.token)).status,401);
   for(const resource of ['tasks','collaboration-activity']){
    const listed=await a.http(resource+'?limit=1','GET',undefined,spoof);assert.equal(listed.status,200);
    assert.ok(listed.data.items.every(item=>item.id!==b.parent.task.id&&item.id!==b.session.id));
   }
   assert.deepEqual(await row('SELECT status,version FROM executions WHERE id=$1',[b.parent.execution.id]),before);
   assert.deepEqual(await row('SELECT count(*)::int n FROM tasks WHERE owner_id=$1',[b.owner.id]),tasksBefore);
   assert.equal((await row('SELECT status FROM collaboration_delegations WHERE id=$1',[b.d.id])).status,'REQUESTED');
  }finally{await a.close();await b.close();}
 });
 test('P5 T04 backend E2E genuinely runs one native child and exposes its canonical result without changing parent',async()=>{
  const f=await fixture();try{
   const response=await f.activate();assert.equal(response.status,200);const receipt=response.data;
   assert.equal(receipt.delegation.status,'COMPLETED');assert.equal(receipt.childTask.agentId,f.agents[1].id);assert.equal(receipt.childExecution.status,'SUCCEEDED');assert.equal(receipt.resultAvailable,true);
   assert.equal(receipt.delegation.parentTaskId,f.parent.task.id);assert.equal(receipt.delegation.sourceExecutionId,f.parent.execution.id);
   assert.equal(receipt.delegation.childTaskId,receipt.childTask.id);assert.equal(receipt.delegation.childExecutionId,receipt.childExecution.id);
   const result=await f.http(receipt.resultPath.replace('/api/v1/',''));assert.equal(result.status,200);assert.equal(result.data.result.output.type,'text.statistics.v1');assert.equal(result.data.result.output.data.wordCount,3);
   const replay=await f.activate();assert.equal(replay.data.childTask.id,receipt.childTask.id);assert.equal(replay.data.childExecution.id,receipt.childExecution.id);
   assert.equal((await f.activate({...f.input,instruction:'Changed instruction'})).status,409);assert.equal((await f.activate({...f.input,idempotencyKey:randomUUID()})).status,409);
   assert.equal((await row('SELECT count(*)::int n FROM tasks WHERE owner_id=$1',[f.owner.id])).n,2);assert.equal((await row('SELECT count(*)::int n FROM executions WHERE owner_id=$1',[f.owner.id])).n,2);
   assert.deepEqual((await f.http('tasks/'+f.parent.task.id)).data,f.parent.task);
   assert.equal((await row("SELECT count(*)::int n FROM agent_events WHERE owner_id=$1 AND event_type='execution.started'",[f.owner.id])).n,2);
  }finally{await f.close();}
 });
 test('P5 T04 strategy cannot run until child execution correlation commits; concurrent activation never redispatches',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let running,calls=0;try{
   f.control(async(r,c,real)=>{calls++;const linked=await row('SELECT child_task_id,child_execution_id,status FROM collaboration_delegations WHERE id=$1',[f.d.id]);assert.equal(linked.child_task_id,r.ids.taskId);assert.equal(linked.child_execution_id,r.ids.executionId);assert.equal(linked.status,'EXECUTING');entered.resolve();await release.promise;return real.execute(r,c);});
   running=f.activate();await Promise.race([entered.promise,running.then(value=>{throw Error('Activation completed before strategy entry: '+JSON.stringify(value));})]);const duplicates=await Promise.all(Array.from({length:4},()=>f.activate()));
   assert.ok(duplicates.every(r=>r.status===202&&r.data.childTask.id===duplicates[0].data.childTask.id));assert.equal(calls,1);
   release.resolve();const completed=await running;assert.equal(completed.data.delegation.status,'COMPLETED');assert.equal(calls,1);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[completed.data.childTask.id])).n,1);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
 test('P5 T04 committed activation interrupted before dispatch survives restart without automatic work or generic-start bypass',async()=>{
  const f=await fixture();try{
   const prepared=await f.service().prepare(f.session.id,f.d.id,f.input);assert.equal(prepared.dispatch,true);await f.restart();
   const replay=await f.activate();assert.equal(replay.status,202);assert.equal(replay.data.childTask.id,prepared.taskId);assert.equal(replay.data.childExecution,null);assert.equal(replay.data.delegation.status,'ACCEPTED');assert.equal(replay.data.dispatchState,'RECOVERY_REQUIRED');
   const denied=await f.http(`tasks/${prepared.taskId}/execute`,'POST',{}, {'if-match':`"${prepared.taskVersion}"`});assert.equal(denied.status,403);
   await assert.rejects(f.coordinator().queueTask({taskId:prepared.taskId,taskVersion:prepared.taskVersion,delegationId:f.d.id,correlationId:prepared.correlationId}),e=>e.code==='ACCESS_DENIED');
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[prepared.taskId])).n,0);
  }finally{await f.close();}
 });
 test('P5 T04 a lost post-commit runtime acknowledgement observes success instead of starting another attempt',async()=>{
  const f=await fixture();try{
   const coordinator=f.coordinator(),native=coordinator.executeTask.bind(coordinator);let calls=0;coordinator.executeTask=async(...args)=>{calls++;await native(...args);throw new RuntimeError('PERSISTENCE_UNAVAILABLE');};
   const response=await f.activate();assert.equal(response.data.delegation.status,'COMPLETED');assert.equal(response.data.childExecution.status,'SUCCEEDED');assert.equal(calls,1);
   await f.activate();assert.equal(calls,1);assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[response.data.childTask.id])).n,1);
  }finally{await f.close();}
 });
 test('P5 T04 genuine native failure and deadline outcomes never fabricate delegation success',async()=>{
  for(const mode of ['failure','timeout']){
   const f=await fixture(mode==='timeout'?100:120000);try{
    f.control(async()=>{if(mode==='failure')throw new RuntimeError('INTERNAL_RUNTIME_ERROR');await new Promise(()=>{});});
    const response=await f.activate();assert.equal(response.status,200);assert.equal(response.data.delegation.status,'FAILED');assert.equal(response.data.childExecution.status,mode==='failure'?'FAILED':'TIMED_OUT');assert.equal(response.data.resultAvailable,false);
    assert.equal((await f.http(f.path)).data.status,'FAILED');assert.equal((await f.activate()).data.childExecution.id,response.data.childExecution.id);
   }finally{await f.close();}
  }
 });
 test('P5 T04 existing exact-target cancellation reconciles the child and preserves parent relationships',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let running;try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});running=f.activate();await Promise.race([entered.promise,running.then(value=>{throw Error('Activation completed before strategy entry: '+JSON.stringify(value));})]);
   const d=(await f.http(f.path)).data,task=await row('SELECT version FROM tasks WHERE id=$1',[d.childTaskId]),execution=await row('SELECT version FROM executions WHERE id=$1',[d.childExecutionId]);
   const cancel=await f.http(`tasks/${d.childTaskId}/executions/${d.childExecutionId}/cancel`,'POST',{taskVersion:task.version},{'if-match':`"${execution.version}"`});assert.equal(cancel.status,200);
   release.resolve();const done=await running;assert.equal(done.data.delegation.status,'CANCELLED');assert.equal(done.data.childExecution.status,'CANCELLED');assert.equal(done.data.delegation.parentTaskId,f.parent.task.id);assert.equal((await f.http('tasks/'+f.parent.task.id)).data.status,'COMPLETED');
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
 test('P5 T04 activation uses operator auth, blocks forged IDs and revalidates current eligibility',async()=>{
  const f=await fixture(),other=await fixture();try{
   assert.equal((await f.activate(f.input,null)).status,401);
   assert.equal((await f.http(`collaborations/${other.session.id}/delegations/${other.d.id}/activate`,'POST',f.input)).status,404);
   assert.equal((await f.http(`collaborations/${f.session.id}/delegations/${other.d.id}/activate`,'POST',f.input)).status,404);
   for(const patch of [{childTaskId:f.parent.task.id},{childExecutionId:f.parent.execution.id},{status:'COMPLETED'},{ownerId:other.owner.id},{instruction:'x'.repeat(16001)}])assert.equal((await f.activate({...f.input,...patch})).status,400);
   for(const agent of f.agents){await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1",[agent.id]);assert.equal((await f.activate()).status,409);await getPool().query("UPDATE agents SET lifecycle_status='ACTIVE' WHERE id=$1",[agent.id]);}
   await getPool().query('UPDATE collaboration_participants SET left_at=clock_timestamp() WHERE session_id=$1 AND agent_id=$2',[f.session.id,f.agents[0].id]);assert.equal((await f.activate()).status,403);
   await getPool().query("UPDATE collaboration_sessions SET status='CANCELLED',finished_at=clock_timestamp() WHERE id=$1",[f.session.id]);assert.equal((await f.activate()).status,409);
   assert.equal((await row('SELECT count(*)::int n FROM tasks WHERE owner_id=$1',[f.owner.id])).n,1);
  }finally{await f.close();await other.close();}
 });
 test('P5 T04 child creation and relation failures roll back atomically with native facts and outbox',async()=>{
  const f=await fixture();try{
   const count=()=>row('SELECT (SELECT count(*) FROM tasks WHERE owner_id=$1)::int t,(SELECT count(*) FROM agent_events WHERE owner_id=$1)::int e,(SELECT count(*) FROM event_outbox WHERE owner_id=$1)::int o',[f.owner.id]);const before=await count();
   await getPool().query(`CREATE FUNCTION p5_t04_attach_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.event_type='delegation.child_associated' THEN RAISE EXCEPTION 'private database fault' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t04_attach_fault BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION p5_t04_attach_fault()');
   try{const fail=await f.activate();assert.equal(fail.status,503);assert.ok(!JSON.stringify(fail.data).includes('private'));assert.deepEqual(await count(),before);assert.equal((await f.http(f.path)).data.childTaskId,null);}
   finally{await getPool().query('DROP TRIGGER p5_t04_attach_fault ON agent_events');await getPool().query('DROP FUNCTION p5_t04_attach_fault()');}
   assert.equal((await f.activate()).data.delegation.status,'COMPLETED');
  }finally{await f.close();}
 });
 test('P5 T04 admission correlation failure prevents dispatch and remains a terminal rejected activation',async()=>{
  const f=await fixture();let calls=0;try{
   f.control(async(r,c,real)=>{calls++;return real.execute(r,c);});
   await getPool().query(`CREATE FUNCTION p5_t04_admit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.event_type='delegation.state_changed' AND NEW.payload->>'status'='EXECUTING' THEN RAISE EXCEPTION 'private admission fault' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t04_admit_fault BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION p5_t04_admit_fault()');
   let failed;try{failed=await f.activate();assert.equal(failed.data.delegation.status,'FAILED');assert.equal(failed.data.childExecution,null);assert.equal(failed.data.childTask.status,'CREATED');assert.equal(calls,0);}
   finally{await getPool().query('DROP TRIGGER p5_t04_admit_fault ON agent_events');await getPool().query('DROP FUNCTION p5_t04_admit_fault()');}
   const again=await f.activate();assert.equal(again.data.childTask.id,failed.data.childTask.id);assert.equal(calls,0);assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[failed.data.childTask.id])).n,0);
  }finally{await f.close();}
 });
 test('P5 T04 native admission rechecks eligibility after activation commits',async()=>{
  const f=await fixture();try{
   const coordinator=f.coordinator(),native=coordinator.executeTask.bind(coordinator);coordinator.executeTask=async(...args)=>{await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1",[f.agents[1].id]);return native(...args);};
   const failed=await f.activate();assert.equal(failed.data.delegation.status,'FAILED');assert.equal(failed.data.childExecution,null);assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[failed.data.childTask.id])).n,0);
  }finally{await f.close();}
 });
 test('P5 T04 the existing coordinator capacity bound rejects child dispatch without affecting unrelated work',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let running;try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});
   const other=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Unrelated active work'},idempotencyKey:randomUUID()});
   running=f.http(`tasks/${other.data.id}/execute`,'POST',{}, {'if-match':`"${other.data.version}"`});
   await Promise.race([entered.promise,running.then(value=>{throw Error('Other work did not start: '+JSON.stringify(value));})]);
   const rejected=await f.activate();assert.equal(rejected.data.delegation.status,'FAILED');assert.equal(rejected.data.childExecution,null);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[rejected.data.childTask.id])).n,0);
   release.resolve();assert.equal((await running).data.execution.status,'SUCCEEDED');
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
 test('P5 T04 cancellation racing child completion preserves the actual native winner',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let running;try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});running=f.activate();
   await Promise.race([entered.promise,running.then(value=>{throw Error('Child did not start: '+JSON.stringify(value));})]);
   const d=(await f.http(f.path)).data,task=await row('SELECT version FROM tasks WHERE id=$1',[d.childTaskId]),execution=await row('SELECT version FROM executions WHERE id=$1',[d.childExecutionId]);
   const cancelling=f.http(`tasks/${d.childTaskId}/executions/${d.childExecutionId}/cancel`,'POST',{taskVersion:task.version},{'if-match':`"${execution.version}"`});release.resolve();
   const [done,cancel]=await Promise.all([running,cancelling]);assert.ok([200,409].includes(cancel.status));
   const canonical=await row('SELECT status FROM executions WHERE id=$1',[d.childExecutionId]);assert.ok(['SUCCEEDED','CANCELLED'].includes(canonical.status));
   assert.equal(done.data.childExecution.status,canonical.status);assert.equal((await f.http(f.path)).data.status,canonical.status==='SUCCEEDED'?'COMPLETED':'CANCELLED');
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });
 test('P5 T04 unresolved native finalization preserves identity without fabricated success or automatic retry',async()=>{
  const f=await fixture();let calls=0;try{
   f.control(async(r,c,real)=>{calls++;return real.execute(r,c);});
   await getPool().query(`CREATE FUNCTION p5_t04_finish_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.agent_id='${f.agents[1].id}'::uuid AND NEW.status IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') THEN RAISE EXCEPTION 'private finalization fault' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t04_finish_fault BEFORE UPDATE ON executions FOR EACH ROW EXECUTE FUNCTION p5_t04_finish_fault()');
   let unresolved;try{unresolved=await f.activate();assert.equal(unresolved.status,202);assert.equal(unresolved.data.dispatchState,'RECOVERY_REQUIRED');assert.equal(unresolved.data.delegation.status,'EXECUTING');assert.equal(unresolved.data.childExecution.status,'RUNNING');assert.equal(unresolved.data.resultAvailable,false);assert.equal(calls,1);}
   finally{await getPool().query('DROP TRIGGER p5_t04_finish_fault ON executions');await getPool().query('DROP FUNCTION p5_t04_finish_fault()');}
   const again=await f.activate();assert.equal(again.data.childExecution.id,unresolved.data.childExecution.id);assert.equal(calls,1);assert.equal(again.data.delegation.status,'EXECUTING');
  }finally{await f.close();}
 });
 test('P5 T04 a second independent API/coordinator instance observes the same activation without dispatching',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let running,other;try{
   f.control(async(r,c,real)=>{entered.resolve();await release.promise;return real.execute(r,c);});running=f.activate();
   await Promise.race([entered.promise,running.then(value=>{throw Error('Child did not start: '+JSON.stringify(value));})]);
   other=await createApplication(f.config);await other.listen(0,'127.0.0.1');let dispatched=0;
   const coordinator=other.get(RuntimeCoordinator),native=coordinator.executeTask.bind(coordinator);coordinator.executeTask=(...args)=>{dispatched++;return native(...args);};
   const response=await fetch(`${await other.getUrl()}/api/v1/${f.path}/activate`,{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(f.input)});
   const duplicate=await response.json();assert.equal(response.status,202);assert.equal(dispatched,0);
   const known=(await f.http(f.path)).data;assert.equal(duplicate.delegation.childTaskId,known.childTaskId);assert.equal(duplicate.delegation.childExecutionId,known.childExecutionId);
   release.resolve();assert.equal((await running).data.delegation.status,'COMPLETED');
  }finally{release.resolve();await running?.catch(()=>{});await other?.close();await f.close();}
 });
};
