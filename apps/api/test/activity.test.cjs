const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mapAgentActivity}=require('../dist/city/activity.mapper');
const {activityQuery}=require('../dist/city/activity.contract');
const {validateEnvironment}=require('../dist/config/configuration');
const {AgentActivityProjectionService}=require('../dist/city/activity.service');
const {CityReadGuard}=require('../dist/city/activity.controller');
const {LocalAccessGuard}=require('../dist/common/local-access.guard');
const now='2026-10-24T12:00:00.000Z',agentId=randomUUID(),taskId=randomUUID();
function raw(){return {agent:{id:agentId,name:'Agent',type:'LLM',availability:'ACTIVE',version:1},binding:null,current:null,outcome:null,lastExecution:null,
 activeCount:0,queuedCount:0,createdCount:0,lastActivityAt:now};}
function work(status='RUNNING',executionStatus='RUNNING'){
 const r=raw(),e=executionStatus?{id:randomUUID(),agent_id:agentId,task_id:taskId,status:executionStatus,version:2,attempt_number:1,authority:'NATIVE',
 deadline_at:null,lease_expires_at:'2026-10-24T12:00:20Z',last_heartbeat_at:now,reconciliation_state:'NONE'}:null;
 r.current={id:taskId,agent_id:agentId,status,version:2,execution:e,deadline_at:null,active_count:e?1:0};r.activeCount=e?1:0;return r;
}
function outcome(status){const r=raw();r.outcome={agent_id:agentId,task_id:taskId,execution_id:randomUUID(),status,
 task_status:status==='SUCCEEDED'?'COMPLETED':status==='TIMED_OUT'?'FAILED':status,finished_at:now};return r;}
test('activity separates IDLE/current intent and historical successful, failed, timed-out and cancelled outcomes',()=>{
 assert.equal(mapAgentActivity(raw(),now).activityStatus,'IDLE');
 const created=work('CREATED',null);created.createdCount=1;assert.equal(mapAgentActivity(created,now).statusReason,'AWAITING_QUEUE');
 for(const [status,expected] of [['SUCCEEDED','COMPLETED'],['FAILED','FAILED'],['TIMED_OUT','FAILED'],['CANCELLED','CANCELLED']]){
  const p=mapAgentActivity(outcome(status),now);assert.equal(p.activityStatus,'IDLE');assert.equal(p.recentOutcome.status,expected);assert.equal(p.recentOutcome.executionStatus,status);
 }
});
test('activity maps queued/pending, current native lease and orthogonal disabled/archived availability',()=>{
 assert.equal(mapAgentActivity(work('QUEUED',null),now).activityStatus,'QUEUED');
 assert.equal(mapAgentActivity(work('CREATED','PENDING'),now).activityStatus,'QUEUED');
 for(const availability of ['ACTIVE','DISABLED','ARCHIVED']){const r=work();r.agent.availability=availability;const p=mapAgentActivity(r,now);
  assert.equal(p.activityStatus,'RUNNING');assert.equal(p.availability,availability);assert.equal(p.activeExecutionCount,1);}
});
test('activity preserves recorded counts/references but does not claim stale or unverified execution is live',()=>{
 for(const [patch,reason] of [[{lease_expires_at:now},'LEASE_UNVERIFIED'],[{last_heartbeat_at:null},'LEASE_UNVERIFIED'],[{last_heartbeat_at:'2026-10-24T11:00:00Z'},'LEASE_UNVERIFIED'],
  [{authority:'EXTERNAL'},'EXTERNAL_LIVENESS_UNVERIFIED'],[{deadline_at:now},'DEADLINE_EXPIRED'],[{reconciliation_state:'QUARANTINED'},'INCONSISTENT_STATE']]){
  const r=work();Object.assign(r.current.execution,patch);r.activeCount=2;const p=mapAgentActivity(r,now);
  assert.equal(p.activityStatus,'UNKNOWN');assert.equal(p.statusReason,reason);assert.equal(p.currentExecution.status,'RUNNING');assert.equal(p.activeExecutionCount,2);
 }
});
test('activity rejects contradictory/missing/foreign references and unsupported states without repair or diagnostics',()=>{
 for(const r of [work('RUNNING',null),work('QUEUED','RUNNING'),work('RUNNING','FAILED')])assert.equal(mapAgentActivity(r,now).activityStatus,'UNKNOWN');
 const r=work();r.current.execution.task_id=randomUUID();const p=mapAgentActivity(r,now);assert.equal(p.activityStatus,'UNKNOWN');assert.equal(p.currentExecution,null);
 r.current.status='invented';assert.equal(mapAgentActivity(r,now).activityStatus,'UNKNOWN');
 const o=outcome('SUCCEEDED');o.outcome.task_status='FAILED';assert.equal(mapAgentActivity(o,now).recentOutcome.status,'UNKNOWN');
});
test('activity DTO is bounded explicit data, optional binding and serializable stable dates, never raw provider/input/result objects',()=>{
 const r=work();r.binding={id:randomUUID(),npcId:'resident-slot-001'};r.agent.configuration={apiKey:'secret-marker'};r.current.input='prompt-marker';r.current.execution.error_message='stack-marker';
 const p=mapAgentActivity(r,now),text=JSON.stringify(p);assert.equal(p.npcId,'resident-slot-001');assert.ok(Object.isFrozen(p));
 for(const secret of ['secret-marker','prompt-marker','stack-marker','lease_expires_at'])assert.ok(!text.includes(secret));
 assert.equal(JSON.parse(text).observedAt,now);assert.throws(()=>mapAgentActivity({...r,lastActivityAt:'bad'},now),{status:503});
});
test('activity query rejects unknown, duplicated, oversized and malformed filters; bounded stable keyset',()=>{
 assert.deepEqual(activityQuery({}),{limit:20,boundOnly:false});assert.equal(activityQuery({ids:agentId,limit:'1',after:taskId}).ids[0],agentId);
 for(const q of [{limit:'0'},{limit:'21'},{limit:['1']},{after:'bad'},{ids:'bad'},{ids:agentId+','+agentId},
  {ids:Array.from({length:21},randomUUID).join(',')},{ids:[agentId]},{boundOnly:'yes'},{ownerId:agentId},{provider:'openai'}])assert.throws(()=>activityQuery(q),{status:400});
});
const env={NODE_ENV:'test',DATABASE_URL:'postgresql://user:pass@127.0.0.1/test',DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',
 AGENT_REGISTRY_OWNER_ID:agentId,AGENT_REGISTRY_TOKEN:'O'.repeat(40),CITY_READ_ENABLED:'true',CITY_READ_TOKEN:'C'.repeat(40)};
test('city read config is optional, distinct, owner-bound and fails closed without production identity',()=>{
 assert.equal(validateEnvironment({...env,CITY_READ_ENABLED:'false'}).cityRead,undefined);assert.equal(validateEnvironment(env).cityRead.token,env.CITY_READ_TOKEN);
 for(const patch of [{CITY_READ_TOKEN:env.AGENT_REGISTRY_TOKEN},{CITY_READ_TOKEN:'short'},{CITY_READ_ENABLED:'yes'},
  {AGENT_REGISTRY_ENABLED:'false'},{NODE_ENV:'production'},{API_HOST:'0.0.0.0'},{CITY_READ_CITY_ID:'another'}])assert.throws(()=>validateEnvironment({...env,...patch}));
});
test('city/operator guards enforce separate audiences and shared socket/Host/Origin protections',()=>{
 const value=validateEnvironment(env),req={method:'GET',params:{cityId:'elyqreth'},headers:{host:'127.0.0.1',authorization:`Bearer ${env.CITY_READ_TOKEN}`},socket:{remoteAddress:'127.0.0.1'}};
 const context={switchToHttp:()=>({getRequest:()=>req})},guard=new CityReadGuard({value});assert.equal(guard.canActivate(context),true);
 assert.throws(()=>new LocalAccessGuard({value}).canActivate(context),{status:401});
 req.headers.authorization=`Bearer ${env.AGENT_REGISTRY_TOKEN}`;assert.throws(()=>guard.canActivate(context),{status:401});req.headers.authorization=`Bearer ${env.CITY_READ_TOKEN}`;
 req.headers.origin='http://evil.invalid';assert.throws(()=>guard.canActivate(context),{status:403});delete req.headers.origin;
 req.socket.remoteAddress='192.168.1.4';assert.throws(()=>guard.canActivate(context),{status:403});req.socket.remoteAddress='127.0.0.1';
 req.headers.host='evil.invalid';assert.throws(()=>guard.canActivate(context),{status:403});req.headers.host='127.0.0.1';
 req.params.cityId='another';assert.throws(()=>guard.canActivate(context),{status:404});
});
test('activity service enforces fixed scope, entire requested-set authorization and city binding restriction with safe logs/errors',async()=>{
 const logs=[],config={value:validateEnvironment(env)};let calls=0;
 const repo={page:async(owner,q,bound)=>{calls++;assert.equal(owner,agentId);assert.equal(bound,true);return {observed_at:now,matched_count:1,items:[raw()]};}};
 const service=new AgentActivityProjectionService(config,repo,{info:(e,v)=>logs.push({e,...v})});
 assert.equal((await service.single(agentId,true)).agentId,agentId);assert.equal(calls,1);
 const originalLog=service.logger.info;service.logger.info=()=>{throw Error('diagnostic sink failure');};
 assert.equal((await service.single(agentId,true)).agentId,agentId);service.logger.info=originalLog;
 repo.page=async()=>({observed_at:now,matched_count:0,items:[]});await assert.rejects(service.single(agentId,true),{status:404});
 repo.page=async()=>{throw Error('password/raw SQL/prompt');};await assert.rejects(service.batch({},true),{status:503});
 assert.ok(!JSON.stringify(logs).includes('password'));assert.ok(!JSON.stringify(logs).includes(env.CITY_READ_TOKEN));
 config.value={...config.value,nodeEnv:'production'};await assert.rejects(service.batch({}),{status:404});
});
