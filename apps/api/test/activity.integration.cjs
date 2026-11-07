const { closedApplication } = require('./helpers/production-configuration.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {sql}=require('drizzle-orm');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {ApiLogger}=require('../dist/common/api-logger');
const {requestContext}=require('../dist/common/request-context');
const {DatabaseService}=require('../dist/database/database.module');
const {AgentActivityProjectionService}=require('../dist/city/activity.service');
const {activitySql}=require('../dist/city/activity.repository');
const {AgentNpcBindingService}=require('../dist/city/binding.service');
const {AgentsService}=require('../dist/agents/agents.service');
const {TasksService}=require('../dist/tasks/tasks.service');
const {TaskLifecycleService}=require('../dist/lifecycle/task-lifecycle.service');
const {EventsService}=require('../dist/events/events.service');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
module.exports=({row,getPool,getUrl})=>{
 async function fixture(){
  const owner=await row("INSERT INTO owners(name) VALUES ('activity-owner') RETURNING id");
  const orch=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'activity-route','native','ENABLED') RETURNING id",[owner.id]);
  const token=randomBytes(32).toString('hex'),cityToken=randomBytes(32).toString('hex');
  const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',
   AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,CITY_READ_ENABLED:'true',CITY_READ_TOKEN:cityToken});
  const app=await createApplication(config),logs=[];app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};
  const service=app.get(AgentActivityProjectionService);
  service.logger.info=(event,fields)=>logs.push({event,...fields,...requestContext.getStore()});
  await app.listen(0,'127.0.0.1');
  return {app,config,owner,orch,token,cityToken,service,logs,
   async agent(type='RULE_BASED'){return app.get(AgentsService).create({name:'Projection Agent',type,orchestratorId:orch.id,description:'private-agent-marker'});},
   async bind(id,slot='resident-slot-001'){return app.get(AgentNpcBindingService).create({agentId:id,npcId:slot});},
   async request(path,credential=token,extra={},method='GET',body){
    const r=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,headers:{...(credential?{authorization:`Bearer ${credential}`} :{}),...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};
   },async close(){await app.close();}};
 }
 // Trusted persistence-only fixtures: no pretend provider execution or lifecycle delivery claim.
 async function state(f,agent,status,authority='NATIVE'){
  const taskStatus={PENDING:'QUEUED',RUNNING:'RUNNING',SUCCEEDED:'COMPLETED',FAILED:'FAILED',CANCELLED:'CANCELLED',TIMED_OUT:'FAILED'}[status];
  const terminal=['SUCCEEDED','FAILED','CANCELLED','TIMED_OUT'].includes(status);
  return row(`WITH t AS (INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,status,completed_at)
   VALUES ($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() ELSE NULL END) RETURNING *)
   INSERT INTO executions(owner_id,agent_id,orchestrator_id,task_id,status,authority,attempt_number,started_at,finished_at,
    lease_owner,lease_token,lease_expires_at,last_heartbeat_at,error_message)
   SELECT $1,$2,$3,t.id,$7,$8,1,CASE WHEN $7 IN ('RUNNING','SUCCEEDED') THEN now() ELSE NULL END,
    CASE WHEN $6 THEN now() ELSE NULL END,CASE WHEN $7='RUNNING' AND $8='NATIVE' THEN 'test-projection-lease' ELSE NULL END,
    CASE WHEN $7='RUNNING' AND $8='NATIVE' THEN $9::uuid ELSE NULL END,
    CASE WHEN $7='RUNNING' AND $8='NATIVE' THEN now()+interval '20 seconds' ELSE NULL END,
    CASE WHEN $7='RUNNING' AND $8='NATIVE' THEN now() ELSE NULL END,'raw-private-stack-marker' FROM t RETURNING *`,
   [f.owner.id,agent.id,f.orch.id,{instruction:'private-prompt-marker'},taskStatus,terminal,status,authority,randomUUID()]);
 }
 test('P3 T03 SQL projects no work, optional safe binding, queued/pending and historical outcomes without persistent celebration',async()=>{
  const f=await fixture();try{
   const a=await f.agent();let p=await f.service.single(a.id);assert.equal(p.activityStatus,'IDLE');assert.equal(p.npcId,null);
   const binding=await f.bind(a.id);p=await f.service.single(a.id,true);assert.equal(p.bindingId,binding.id);assert.equal(p.npcId,'resident-slot-001');
   const queued=await state(f,a,'PENDING');p=await f.service.single(a.id);assert.equal(p.activityStatus,'QUEUED');assert.equal(p.currentExecution.id,queued.id);
   assert.equal(p.activeExecutionCount,1);assert.equal(p.queuedTaskCount,1);
   for(const [status,outcome] of [['SUCCEEDED','COMPLETED'],['FAILED','FAILED'],['CANCELLED','CANCELLED'],['TIMED_OUT','FAILED']]){
    const agent=await f.agent(),execution=await state(f,agent,status),projection=await f.service.single(agent.id);
    assert.equal(projection.activityStatus,'IDLE');assert.equal(projection.recentOutcome.status,outcome);assert.equal(projection.recentOutcome.executionId,execution.id);
    assert.equal(projection.lastExecution.id,execution.id);
   }
   const text=JSON.stringify(await f.service.batch({}));for(const marker of ['private-agent-marker','private-prompt-marker','raw-private-stack-marker','lease_token','agent_config_snapshot'])assert.ok(!text.includes(marker));
  }finally{await f.close();}
 });
 test('P3 T03 deterministic representative and counts preserve multiple external active attempts and native stale uncertainty',async()=>{
  const f=await fixture();try{
   const a=await f.agent(),active=await state(f,a,'RUNNING');
   let p=await f.service.single(a.id);assert.equal(p.activityStatus,'RUNNING');assert.equal(p.statusReason,'CURRENT_LEASE');
   await row('UPDATE executions SET lease_expires_at=last_heartbeat_at WHERE id=$1 RETURNING id',[active.id]);
   p=await f.service.single(a.id);assert.equal(p.activityStatus,'UNKNOWN');assert.equal(p.currentExecution.status,'RUNNING');assert.equal(p.statusReason,'LEASE_UNVERIFIED');
   const external=await f.agent('EXTERNAL'),one=await state(f,external,'RUNNING','EXTERNAL'),two=await state(f,external,'RUNNING','EXTERNAL');
   await state(f,external,'SUCCEEDED','EXTERNAL');
   p=await f.service.single(external.id);assert.equal(p.activeExecutionCount,2);assert.equal(p.activityStatus,'UNKNOWN');assert.equal(p.statusReason,'EXTERNAL_LIVENESS_UNVERIFIED');
   assert.equal(p.currentExecution.id,one.id);assert.equal(p.recentOutcome.status,'COMPLETED');
   const repeat=await f.service.single(external.id);assert.deepEqual({...repeat,observedAt:p.observedAt},p);
   // Equal Task timestamps must break ties by UUID, not physical insertion order.
   const chosen=await row("SELECT id FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY created_at,id LIMIT 1",[[one.task_id,two.task_id]]);
   assert.equal(p.currentTask.id,chosen.id);
   const tieAgent=await f.agent();
   const ties=await getPool().query("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,status) SELECT $1,$2,$3,'{\"instruction\":\"equal timestamp fixture\"}'::jsonb,'QUEUED' FROM generate_series(1,2) RETURNING id,created_at",[f.owner.id,tieAgent.id,f.orch.id]);
   assert.equal((await row('SELECT count(DISTINCT created_at)::int AS n FROM tasks WHERE agent_id=$1',[tieAgent.id])).n,1);
   assert.equal((await f.service.single(tieAgent.id)).currentTask.id,ties.rows.map(r=>r.id).sort()[0]);
   await row('UPDATE executions SET deadline_at=created_at WHERE id=$1 RETURNING id',[one.id]);
   assert.equal((await f.service.single(external.id)).statusReason,'DEADLINE_EXPIRED');
  }finally{await f.close();}
 });
 test('P3 T03 task-only states, multiple historical attempts, missing execution and unsupported bindings remain explicit',async()=>{
  const f=await fixture();try{
   for(const [status,expected] of [['CREATED','IDLE'],['QUEUED','QUEUED'],['RUNNING','UNKNOWN'],['FAILED','IDLE'],['CANCELLED','IDLE'],['COMPLETED','UNKNOWN']]){
    const a=await f.agent();await row("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,status,completed_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 IN ('FAILED','CANCELLED','COMPLETED') THEN now() ELSE NULL END) RETURNING id",
     [f.owner.id,a.id,f.orch.id,{instruction:'private-task-only-marker'},status]);
    const p=await f.service.single(a.id);assert.equal(p.activityStatus,expected);assert.equal(p.currentExecution,null);
    if(['FAILED','CANCELLED'].includes(status))assert.equal(p.recentOutcome.status,status);
   }
   const a=await f.agent(),first=await state(f,a,'FAILED');
   const second=await row("INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number,status,finished_at) VALUES ($1,$2,$3,$4,2,'FAILED',now()) RETURNING id",[f.owner.id,first.task_id,a.id,f.orch.id]);
   const p=await f.service.single(a.id);assert.equal(p.activityStatus,'IDLE');assert.equal(p.lastExecution.id,second.id);assert.equal(p.recentOutcome.executionId,second.id);
   assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE task_id=$1',[first.task_id])).n,2);
   const binding=await f.bind(a.id);await row("UPDATE city_agent_bindings SET visualization_mode='WORK_ACTIVITY' WHERE id=$1 RETURNING id",[binding.id]);
   assert.equal((await f.service.single(a.id)).npcId,null);await assert.rejects(f.service.single(a.id,true),{status:404});
  }finally{await f.close();}
 });
 test('P3 T03 HTTP routes enforce separate credentials, scoped IDs, valid queries and static route precedence',async()=>{
  const f=await fixture(),g=await fixture();try{
   const a=await f.agent(),unbound=await f.agent(),foreign=await g.agent();await f.bind(a.id);
   const routes=[`agents/${a.id}/activity`,'agents/activities'];
   for(const route of routes){assert.equal((await f.request(route)).status,200);assert.equal((await f.request(route,null)).status,401);assert.equal((await f.request(route,f.cityToken)).status,401);}
   for(const route of ['cities/elyqreth/agents',`cities/elyqreth/agents/${a.id}/activity`]){
    assert.equal((await f.request(route,f.cityToken)).status,200);assert.equal((await f.request(route,null)).status,401);assert.equal((await f.request(route)).status,401);
   }
   const running=await state(f,a,'RUNNING');
   for(const [route,credential] of [[`agents/${a.id}/activity`,f.token],[`cities/elyqreth/agents/${a.id}/activity`,f.cityToken]]){
    const view=await f.request(route,credential);assert.equal(view.status,200);assert.equal(view.data.activityStatus,'RUNNING');
    assert.equal(view.data.currentExecution.id,running.id);assert.equal(view.data.currentTask.id,running.task_id);
    assert.equal(view.data.activeExecutionCount,1);assert.equal(view.data.npcId,'resident-slot-001');
   }
   assert.equal((await f.request(`agents/${unbound.id}/activity`)).status,200);
   for(const id of [unbound.id,foreign.id,randomUUID()])assert.equal((await f.request(`cities/elyqreth/agents/${id}/activity`,f.cityToken)).status,404);
   assert.equal((await f.request(`agents/${foreign.id}/activity`)).status,404);
   assert.equal((await f.request(`agents/activities?ids=${a.id},${foreign.id}`)).status,404);
   const list=await f.request('cities/elyqreth/agents?boundOnly=false',f.cityToken);assert.deepEqual(list.data.items.map(x=>x.agentId),[a.id]);
   for(const query of ['limit=0','limit=21','limit=1&limit=2','ids=bad','after=bad','ownerId='+g.owner.id,'provider=openai',`ids=${Array.from({length:21},randomUUID).join(',')}`])
    assert.equal((await f.request('agents/activities?'+query)).status,400);
   assert.equal((await f.request('agents/bad/activity')).status,400);assert.equal((await f.request(`agents/${a.id}/activity?limit=1`)).status,400);
   assert.equal((await f.request('cities/other/agents',f.cityToken)).status,404);
   assert.equal((await f.request('cities/elyqreth/agents',f.cityToken,{origin:'http://evil.invalid'})).status,403);
   assert.equal((await f.request('agents',f.cityToken,{'content-type':'application/json'},'POST',{})).status,401);
   assert.equal((await f.request(`tasks/${randomUUID()}/execute`,f.cityToken,{'content-type':'application/json'},'POST',{})).status,401);
   for(const route of ['agents','tasks',`tasks/${randomUUID()}/status`,`tasks/${randomUUID()}/executions`,
     `tasks/${randomUUID()}/executions/${randomUUID()}/result`,`executions/${randomUUID()}/events`])
    assert.equal((await f.request(route,f.cityToken)).status,401);
   assert.equal((await f.request(`tasks/${randomUUID()}/executions/${randomUUID()}/cancel`,f.cityToken,{'content-type':'application/json'},'POST',{})).status,401);
   for(const nodeEnv of ['test','production']){
    const closed=await closedApplication({NODE_ENV:nodeEnv,CORS_ORIGINS:nodeEnv==='production'?'https://city.example':'http://127.0.0.1:5173'});
    try{
     closed.get(ApiLogger).info=()=>{};await closed.listen(0,'127.0.0.1');
     for(const route of ['agents/activities','cities/elyqreth/agents']){
      const r=await fetch(`${await closed.getUrl()}/api/v1/${route}`);assert.equal(r.status,404);
     }
    }finally{await closed.close();}
   }
   assert.equal((await f.request('cities/elyqreth/agents',f.cityToken,{'X-Request-Id':'activity-test-correlation'})).status,200);
   assert.ok(f.logs.some(l=>l.event==='projection.completed'&&l.requestId==='activity-test-correlation'));
   const text=JSON.stringify(f.logs);assert.ok(!text.includes(f.token));assert.ok(!text.includes(f.cityToken));assert.ok(!text.includes('private-prompt-marker'));
  }finally{await f.close();await g.close();}
 });
 test('P3 T03 a real lifecycle cancellation commits atomically while projection reads remain consistent and read-only',async()=>{
  const f=await fixture(),reached=deferred(),release=deferred();let cancel;
  try{
   const a=await f.agent();await f.app.get(AgentsService).lifecycle(a.id,'ACTIVE',a.version);
   const created=await f.app.get(TasksService).create({agentId:a.id,input:{instruction:'projection race fixture'}}),life=f.app.get(TaskLifecycleService);
   const queued=await life.queueTask(created.task.id,{taskVersion:created.task.version,authority:'NATIVE'});
   const events=f.app.get(EventsService),original=events.appendState.bind(events);let held=false;
   events.appendState=async(...args)=>{if(!held){held=true;reached.resolve();await release.promise;}return original(...args);};
   cancel=life.cancelTask(queued.task.id,{taskVersion:queued.task.version,executionId:queued.execution.id,executionVersion:queued.execution.version});
   await reached.promise;
   const before=await row('SELECT count(*)::int AS n FROM agent_events WHERE agent_id=$1',[a.id]);
   const snapshots=await Promise.all(Array.from({length:5},()=>f.service.single(a.id)));
   assert.ok(snapshots.every(p=>p.activityStatus==='QUEUED'&&p.currentTask.status==='QUEUED'&&p.currentExecution.status==='PENDING'));
   assert.equal((await row('SELECT count(*)::int AS n FROM agent_events WHERE agent_id=$1',[a.id])).n,before.n);
   release.resolve();await cancel;const after=await f.service.single(a.id);
   assert.equal(after.activityStatus,'IDLE');assert.equal(after.recentOutcome.status,'CANCELLED');assert.equal(after.activeExecutionCount,0);
   const binding=await f.bind(a.id);assert.equal((await f.service.single(a.id,true)).npcId,'resident-slot-001');
   await f.app.get(AgentNpcBindingService).remove({bindingId:binding.id,revision:binding.revision});
   await assert.rejects(f.service.single(a.id,true),{status:404});assert.equal((await f.service.single(a.id)).npcId,null);
  }finally{release.resolve();await cancel?.catch(()=>{});await f.close();}
 });
 test('P3 T04 actual frontend client and synchronization consume protected HTTP contracts without operator credentials', {timeout:30000},async()=>{
  const f=await fixture();let integration;
  try{
   const {RuntimeApiClient}=await import('../../../dist/js/runtime/api-client.js');
   const {createRuntimeIntegration}=await import('../../../dist/js/runtime/index.js');
   const a=await f.agent(),binding=await f.bind(a.id),pageOrigin='http://127.0.0.1:5173';let requests=0;
   // Node fetch does not add browser Origin automatically; mirror the real cross-origin request.
   const fetchImpl=(url,options)=>{requests++;return fetch(url,{...options,headers:{...options.headers,Origin:pageOrigin}});};
   const baseUrl=await f.app.getUrl(),client=new RuntimeApiClient({baseUrl,pageOrigin,fetchImpl});client.authorize(f.cityToken);
   const idle=await client.fetchActivity(a.id);assert.equal(idle.activityStatus,'IDLE');assert.equal(idle.bindingId,binding.id);
   const batch=await client.fetchPage({ids:[a.id],limit:1});assert.equal(batch.items[0].agentId,a.id);
   integration=createRuntimeIntegration({fetchImpl});const snapshots=[];const unsubscribe=integration.view.subscribe(s=>snapshots.push(s));
   assert.equal(integration.getSnapshot().phase,'DISCONNECTED');const before=requests;
   integration.connect({baseUrl,pageOrigin,token:f.cityToken});await integration.refresh();assert.equal(requests,before+1);
   assert.equal(integration.view.getByNpc('resident-slot-001').agentId,a.id);
   const running=await state(f,a,'RUNNING');await integration.refresh();assert.equal(integration.view.getAgent(a.id).activityStatus,'RUNNING');
   assert.equal(integration.view.getAgent(a.id).currentExecution.id,running.id);
   await f.app.get(TaskLifecycleService).cancelTask(running.task_id,{taskVersion:1,executionId:running.id,executionVersion:1});
   await integration.refresh();assert.equal(integration.getAgent(a.id).activityStatus,'IDLE');assert.equal(integration.getAgent(a.id).recentOutcome.status,'CANCELLED');
   await f.app.get(AgentNpcBindingService).remove({bindingId:binding.id,revision:binding.revision});
   await integration.refresh();assert.equal(integration.getAgent(a.id),undefined);await integration.refresh();assert.equal(Object.keys(integration.getSnapshot().activitiesByAgentId).length,0);
   await assert.rejects(client.fetchActivity(a.id),{code:'NOT_FOUND'});
   integration.connect({baseUrl,pageOrigin,token:'X'.repeat(40)});await integration.refresh();assert.equal(integration.getSnapshot().phase,'AUTH_REQUIRED');
   assert.equal(Object.keys(integration.getSnapshot().activitiesByAgentId).length,0);assert.ok(snapshots.some(s=>s.refreshing));unsubscribe();client.clearCredential();
  }finally{integration?.dispose();await f.close();}
 });
 require('./multi-agent-reconnect.integration.cjs')({fixture,state});
 test('P3 T03 bounded projection query counts for 1/10/25/50/100 Agents use one SELECT per page with safe planner observations',async()=>{
  const f=await fixture();try{
   await getPool().query("INSERT INTO agents(owner_id,orchestrator_id,name,type) SELECT $1,$2,'batch-'||i,'RULE_BASED' FROM generate_series(1,100) AS i",[f.owner.id,f.orch.id]);
   await getPool().query("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,status,completed_at) SELECT a.owner_id,a.id,a.orchestrator_id,'{\"instruction\":\"private-history-marker\"}'::jsonb,'FAILED',now() FROM agents a CROSS JOIN generate_series(1,20) i WHERE a.owner_id=$1",[f.owner.id]);
   await getPool().query("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) SELECT owner_id,id,orchestrator_id,'{\"instruction\":\"private-current-marker\"}'::jsonb FROM agents WHERE owner_id=$1",[f.owner.id]);
   const db=f.app.get(DatabaseService).db,original=db.execute.bind(db);let queries=0;
   db.execute=(...args)=>{queries++;return original(...args);};const measurements=[];
   for(const n of [1,10,25,50,100]){
    queries=0;let after,seen=[];const start=performance.now(),cpu=process.cpuUsage(),memoryBefore=process.memoryUsage();
    while(seen.length<n){const page=await f.service.batch({limit:String(Math.min(20,n-seen.length)),...(after?{after}:{})});seen.push(...page.items.map(i=>i.agentId));after=page.nextCursor;if(!after)break;}
    assert.equal(seen.length,n);assert.equal(new Set(seen).size,n);assert.deepEqual(seen,[...seen].sort());assert.equal(queries,Math.ceil(n/20));
    const used=process.cpuUsage(cpu),memoryAfter=process.memoryUsage();
    measurements.push({agents:n,pages:queries,sqlStatements:queries,durationMs:Math.round((performance.now()-start)*1000)/1000,
     nodeApiAndDriverCpuMs:(used.user+used.system)/1000,heapBeforeBytes:memoryBefore.heapUsed,heapAfterBytes:memoryAfter.heapUsed,rssBytes:memoryAfter.rss});
   }
   db.execute=original;
   const plan=await db.execute(sql`EXPLAIN (FORMAT JSON) ${activitySql(f.owner.id,{limit:20,boundOnly:false},false)}`);
   const root=plan.rows[0]['QUERY PLAN'][0].Plan;
   console.log(JSON.stringify({p3ActivityPerformance:{measurements,agents:100,historicalTasks:2000,createdTasks:100,planRoot:root['Node Type'],estimatedCost:root['Total Cost'],kind:'local-projection-only-not-runtime-benchmark'}}));
   assert.ok(Number.isFinite(root['Total Cost']));
  }finally{await f.close();}
 });
};
