const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID,randomBytes}=require('node:crypto');
const {createApplication}=require('../dist/application');const {validateEnvironment}=require('../dist/config/configuration');
const {ApiLogger}=require('../dist/common/api-logger');const {AgentNpcBindingService}=require('../dist/city/binding.service');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TasksService}=require('../dist/tasks/tasks.service');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {definition,deferred}=require('./runtime-fixtures.cjs');const {configuration,text}=require('./llm-fixtures.cjs');

module.exports=({row,getPool,getUrl})=>{
 async function fixture(corsOrigins,displayText='LLM interaction display marker',options={}){
  const owner=await row("INSERT INTO owners(name) VALUES ('interaction-owned-test') RETURNING id");
  const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'interaction-route','native','ENABLED') RETURNING id",[owner.id]);
  const agents=[];for(const type of options.ruleBased?Array(4).fill('RULE_BASED'):['RULE_BASED','LLM','LLM','RULE_BASED'])agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'Interaction test',$3,'ACTIVE') RETURNING *",[owner.id,route.id,type]));
  const collaborationToken=randomBytes(32).toString('hex'),operator=randomBytes(32).toString('hex'),reader=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');
  const llm=configuration({ids:{ownerId:owner.id,agentId:agents[1].id,orchestratorId:route.id,taskId:randomUUID(),executionId:randomUUID(),correlationId:randomUUID()}});
  const env={...llm.env,...(corsOrigins?{CORS_ORIGINS:corsOrigins}:{}),DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_TOKEN:operator,AGENT_REGISTRY_OWNER_ID:owner.id,
   CITY_READ_ENABLED:'true',CITY_READ_TOKEN:reader,CITY_INTERACTION_ENABLED:'true',CITY_INTERACTION_TOKEN:token,
   CITY_INTERACTION_AGENT_IDS:JSON.stringify(agents.slice(0,3).map(a=>a.id)),CITY_INTERACTION_TEXT_AGENT_IDS:JSON.stringify([agents[2].id]),
   RUNTIME_BINDINGS:JSON.stringify(agents.map((a,i)=>({agentId:a.id,orchestratorId:route.id,definition:options.ruleBased?definition(i===2?600:120000):i===1||i===2?llm.definition:definition()})))};
  if(options.ruleBased){env.RUNTIME_LLM_ENABLED='false';env.CITY_INTERACTION_TEXT_AGENT_IDS='[]';for(const key of ['LLM_PROFILES','LLM_REQUEST_TIMEOUT_MS','LLM_MAX_OUTPUT_TOKENS','LLM_ALLOW_PAID'])delete env[key];}
  if(options.collaborationRead){env.COLLABORATION_READ_ENABLED='true';env.COLLABORATION_READ_TOKEN=collaborationToken;}
  const config=validateEnvironment(env),logs=[],app=await createApplication(config);
  app.get(ApiLogger).info=(...v)=>logs.push(v);app.get(ApiLogger).error=(...v)=>logs.push(v);
  app.get(ProviderSelectionService).registry=new LlmProviderRegistry([{id:'fixture.local',capabilities:()=>llm.settings.capabilities,generate:async()=>text(displayText)}]);
  const service=app.get(AgentNpcBindingService),bindings=[];
  for(let i=0;i<4;i++)bindings.push(await service.create({agentId:agents[i].id,npcId:`resident-slot-00${i+1}`}));
  await app.listen(0,'127.0.0.1');
  const request=async(path,method='GET',body,credential=token,version,extra={})=>{
   const response=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,headers:{...(credential?{authorization:`Bearer ${credential}`} :{}),'content-type':'application/json',...(version?{'if-match':`"${version}"`}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json()};
  };
  const create=async(index=0,key=randomUUID(),instruction='Private interaction input two words')=>request('tasks','POST',{agentId:agents[index].id,input:{instruction},idempotencyKey:key});
  return {owner,route,agents,bindings,operator,reader,token,collaborationToken,env,config,app,logs,service,request,create,close:()=>app.close()};
 }
 test('P4 T02 real HTTP audience isolation, Agent eligibility and strict request validation',async()=>{
  const f=await fixture();try{
   const identity=await f.request(`agents/${f.agents[0].id}`);assert.equal(identity.status,200);assert.equal(identity.data.actionEligibility.canCreateTask,true);
   for(const token of [undefined,null,f.reader]){
    const denied=await f.request('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'test'},idempotencyKey:'test'},token===undefined?null:token);assert.equal(denied.status,401);
   }
   for(const path of ['agents','tasks',`agents/${f.agents[0].id}/events`,'cities/elyqreth/agents'])assert.equal((await f.request(path)).status,403);
   assert.equal((await f.request(`agents/${f.agents[3].id}`)).status,404);
   assert.equal((await f.request(`agents/${randomUUID()}`)).status,404);
   assert.equal((await f.request('agents/not-a-uuid')).status,400);
   assert.equal((await f.request('agents','POST',{name:'forbidden'})).status,403);
   assert.equal((await f.request(`agents/${f.agents[0].id}/activate`,'POST',{},f.token,1)).status,403);
   for(const patch of [{ownerId:f.owner.id},{provider:'openai'},{toolCapabilities:['shell']}])assert.equal((await f.request('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'test'},idempotencyKey:randomUUID(),...patch})).status,400);
   assert.equal((await f.create(0,randomUUID(),'x'.repeat(16001))).status,400);
   assert.equal((await f.request('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'missing key'}})).status,400);
   assert.equal((await f.request(`agents/${f.agents[0].id}`,'GET',undefined,f.token,undefined,{Origin:'https://untrusted.invalid'})).status,403);
   // Existing operator and city-read audiences remain distinct and functional.
   assert.equal((await f.request('agents','GET',undefined,f.operator)).status,200);
   assert.equal((await f.request('cities/elyqreth/agents','GET',undefined,f.reader)).status,200);
   const intentKey=randomUUID(),saved=await f.create(0,intentKey);assert.equal(saved.status,201);
   const disabled=await f.request(`agents/${f.agents[0].id}/disable`,'POST',{},f.operator,identity.data.version);assert.equal(disabled.status,200);
   assert.equal((await f.request(`agents/${f.agents[0].id}`)).data.actionEligibility.canCreateTask,false);
   assert.equal((await f.request(`tasks/${saved.data.id}`)).data.actionEligibility.canRequestStart,false);
   assert.equal((await f.create()).status,409);
   assert.equal((await f.create(0,intentKey)).data.id,saved.data.id); // Same-key recovery creates no work even after disable.
   const archived=await f.request(`agents/${f.agents[0].id}/archive`,'POST',{},f.operator,disabled.data.version);assert.equal(archived.status,200);
   assert.equal((await f.request(`agents/${f.agents[0].id}`)).data.actionEligibility.canCreateTask,false);
   assert.equal((await f.create()).status,409);
  }finally{await f.close();}
 });
 test('P4 T02 concurrent idempotent creation, payload conflict and exact recovery survive a new API instance',async()=>{
  const f=await fixture();let restarted;try{
   const key=randomUUID(),responses=await Promise.all(Array.from({length:6},()=>f.create(0,key)));
   assert.equal(responses.filter(r=>r.status===201).length,1);assert.ok(responses.every(r=>[200,201].includes(r.status)));
   const task=responses[0].data;assert.equal(new Set(responses.map(r=>r.data.id)).size,1);assert.equal(task.status,'CREATED');
   assert.equal(task.actionEligibility.canRequestStart,true);
   assert.equal((await f.create(0,key,'incompatible input')).status,409);
   const caseRetry=await f.request('tasks','POST',{agentId:f.agents[0].id.toUpperCase(),input:{instruction:'Private interaction input two words'},idempotencyKey:key});
   assert.equal(caseRetry.status,200);assert.equal(caseRetry.data.id,task.id);
   assert.equal((await row('SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1 AND idempotency_key=$2',[f.owner.id,key])).n,1);
   const lookup=`tasks/lookup?agentId=${f.agents[0].id}&idempotencyKey=${key}`;
   assert.equal((await f.request(lookup)).data.task.id,task.id);
   assert.equal((await f.request(`tasks/lookup?agentId=${f.agents[1].id}&idempotencyKey=${key}`)).data.task,null);
   assert.equal((await f.request(lookup+'&ownerId='+f.owner.id)).status,400);
   await f.close();restarted=await createApplication(f.config);
   restarted.get(ProviderSelectionService).registry=new LlmProviderRegistry([{id:'fixture.local',capabilities:()=>f.config.llm.profiles[0].capabilities,generate:async()=>text('test')}]);
   await restarted.listen(0,'127.0.0.1');
   const response=await fetch(`${await restarted.getUrl()}/api/v1/${lookup}`,{headers:{Authorization:`Bearer ${f.token}`}});
   assert.equal(response.status,200);assert.equal((await response.json()).task.id,task.id);
   assert.equal((await row("SELECT count(*)::int AS n FROM agent_events WHERE task_id=$1 AND event_type='task.created'",[task.id])).n,1);
  }finally{await restarted?.close();await f.close();}
 });
 test('P4 T02 genuine coordinator execution, canonical result, details, bounded history and immutable terminal state',async()=>{
  const f=await fixture();try{
   const done=[];for(let i=0;i<3;i++){
    const t=await f.create();assert.equal(t.status,201);const result=await f.request(`tasks/${t.data.id}/execute`,'POST',{},f.token,t.data.version);
    assert.equal(result.status,200);assert.equal(result.data.task.status,'COMPLETED');assert.equal(result.data.result.output.type,'text.statistics.v1');done.push(result.data);
   }
   const one=done[0],detail=await f.request(`tasks/${one.task.id}/executions/${one.execution.id}`);assert.equal(detail.data.actionEligibility.canRequestCancel,false);assert.equal(detail.data.status,'SUCCEEDED');
   assert.equal((await f.request(`tasks/${one.task.id}/executions/${one.execution.id}/result`)).data.availability,'AVAILABLE');
   assert.equal((await f.request(`tasks/${one.task.id}/execute`,'POST',{},f.token,one.task.version)).status,409);
   assert.equal((await f.request(`tasks/${one.task.id}/executions/${one.execution.id}/cancel`,'POST',{taskVersion:one.task.version},f.token,one.execution.version)).status,409);
   const first=await f.request(`agents/${f.agents[0].id}/executions?limit=2`);assert.equal(first.status,200);assert.equal(first.data.items.length,2);
   assert.equal(first.data.items[0].id,done[2].execution.id);
   const next=await f.request(`agents/${f.agents[0].id}/executions?limit=2&before=${first.data.pagination.nextCursor}`);assert.equal(next.data.items.length,1);assert.equal(next.data.items[0].id,done[0].execution.id);
   assert.equal((await f.request(`agents/${f.agents[1].id}/executions?before=${first.data.pagination.nextCursor}`)).status,400);
   assert.equal((await f.request(`agents/${f.agents[0].id}/executions?limit=21`)).status,400);
   assert.equal((await f.request(`tasks/${one.task.id}/executions/${done[1].execution.id}`)).status,404);
   assert.equal((await row("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='executions_owner_agent_history_idx'")).n,1);
   const wire=JSON.stringify({done,detail,history:first});for(const value of ['Private interaction input',f.token,f.operator,'agentConfigSnapshot','leaseToken'])assert.ok(!wire.includes(value));
  }finally{await f.close();}
 });
 test('P4 T02 actual LLM responses are filtered on synchronous execution and canonical result reads without changing persistence',async()=>{
  const f=await fixture();try{
   for(const index of [1,2]){
    const t=await f.create(index),done=await f.request(`tasks/${t.data.id}/execute`,'POST',{},f.token,t.data.version);assert.equal(done.status,200);
    const result=await f.request(`tasks/${t.data.id}/executions/${done.data.execution.id}/result`);assert.equal(result.status,200);
    if(index===1){assert.equal(done.data.result,null);assert.equal(result.data.result,null);assert.equal(result.data.displayReason,'DISCLOSURE_RESTRICTED');assert.equal(result.data.execution.resultAvailability,'AVAILABLE');}
    else{assert.equal(done.data.result.output.text,'LLM interaction display marker');assert.equal(result.data.result.output.text,'LLM interaction display marker');assert.equal(result.data.result.provider,undefined);}
    const canonical=await f.request(`tasks/${t.data.id}/executions/${done.data.execution.id}/result`,'GET',undefined,f.operator);assert.equal(canonical.data.result.output.text,'LLM interaction display marker');assert.ok(canonical.data.result.provider);
   }
  }finally{await f.close();}
 });
 test('P4 T02 pending/running cancellation and late candidates preserve one committed terminal event',async()=>{
  const f=await fixture();try{
   const queued=await f.create(),pair=await f.app.get(RuntimeCoordinator).queueTask({taskId:queued.data.id,taskVersion:queued.data.version});
   const pending=await f.request(`tasks/${pair.task.id}/executions/${pair.execution.id}`);assert.equal(pending.data.actionEligibility.canRequestCancel,true);
   assert.equal((await f.request(`tasks/${pair.task.id}/executions/${pair.execution.id}/result`)).data.availability,'PENDING');
   const cancelled=await f.request(`tasks/${pair.task.id}/executions/${pair.execution.id}/cancel`,'POST',{taskVersion:pair.task.version},f.token,pair.execution.version);assert.equal(cancelled.status,200);
   const repeated=await f.request(`tasks/${pair.task.id}/executions/${pair.execution.id}/cancel`,'POST',{taskVersion:cancelled.data.task.version},f.token,cancelled.data.execution.version);assert.equal(repeated.status,409);
   const entered=deferred(),release=deferred(),genuine=f.app.get(TextStatisticsStrategy);
   f.app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{entered.resolve();await release.promise;return genuine.execute(r,c);}}}]);
   const t=await f.create(),inflight=f.request(`tasks/${t.data.id}/execute`,'POST',{},f.token,t.data.version);
   await Promise.race([entered.promise,inflight.then(r=>{throw Error('Strategy not dispatched: HTTP '+r.status);})]);
   const status=await f.request(`tasks/${t.data.id}/status`),detail=await f.request(`tasks/${t.data.id}/executions/${status.data.latestExecutionId}`);
   const ack=await f.request(`tasks/${t.data.id}/executions/${detail.data.id}/cancel`,'POST',{taskVersion:status.data.version},f.token,detail.data.version);assert.equal(ack.status,200);release.resolve();assert.equal((await inflight).status,409);
   assert.equal((await f.request(`tasks/${t.data.id}/executions/${detail.data.id}/result`)).data.availability,'UNAVAILABLE');
   assert.equal((await row("SELECT count(*)::int AS n FROM agent_events WHERE execution_id=$1 AND event_type IN ('execution.cancelled','execution.completed')",[detail.data.id])).n,1);
  }finally{await f.close();}
 });
 test('P4 T02 binding removal and foreign-owner records cannot be used for mutation, replay, history or result access',async()=>{
  const f=await fixture(),foreign=await fixture();try{
   const own=await f.create(),other=await foreign.create();
   for(const path of [`tasks/${other.data.id}`,`tasks/${other.data.id}/status`,`agents/${foreign.agents[0].id}/executions`])assert.equal((await f.request(path)).status,404);
   assert.equal((await f.request(`tasks/${other.data.id}/execute`,'POST',{},f.token,1)).status,404);
   await f.service.remove({bindingId:f.bindings[0].id,revision:f.bindings[0].revision});
   assert.equal((await f.create()).status,404);
   assert.equal((await f.request(`tasks/${own.data.id}/execute`,'POST',{},f.token,own.data.version)).status,404);
   assert.equal((await f.request(`agents/${f.agents[0].id}/executions`)).status,404);
   assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[own.data.id])).status,'CREATED');
   assert.equal((await f.request(`tasks/${own.data.id}`,'GET',undefined,f.operator)).status,200);
  }finally{await f.close();await foreign.close();}
 });
 test('P4 T08 actual HTTP object isolation covers execution, result, history and exact recovery across two configured owners',async()=>{
  const a=await fixture(),b=await fixture();try{
   const key=randomUUID(),saved=await b.create(0,key),task=saved.data;
   const run=await b.request(`tasks/${task.id}/execute`,'POST',{},b.token,task.version);assert.equal(run.status,200);const execution=run.data.execution;
   assert.equal((await b.request(`tasks/${task.id}/executions/${execution.id}/result`)).status,200);
   const denied=[['GET',`agents/${b.agents[0].id}`],['GET',`agents/${b.agents[0].id}/executions?limit=10`],
    ['GET',`tasks/${task.id}`],['GET',`tasks/${task.id}/status`],['GET',`tasks/${task.id}/executions`],
    ['GET',`tasks/${task.id}/executions/${execution.id}`],['GET',`tasks/${task.id}/executions/${execution.id}/result`],
    ['GET',`tasks/lookup?agentId=${b.agents[0].id}&idempotencyKey=${key}`],['POST',`tasks/${task.id}/execute`],['POST',`tasks/${task.id}/executions/${execution.id}/cancel`]];
   for(const [method,path]of denied){const reply=await a.request(path,method,method==='POST'?{}:undefined,a.token,1);assert.equal(reply.status,404,`${method} ${path}`);assert.ok(!JSON.stringify(reply.data).includes(execution.id));assert.ok(!JSON.stringify(reply.data).includes(task.id));}
   const own=await a.create();assert.equal((await a.request(`tasks/${own.data.id}/executions/${execution.id}`)).status,404);
   assert.equal((await a.request(`tasks/${own.data.id}/executions/${execution.id}/result`)).status,404);
   assert.equal((await a.request(`tasks/${own.data.id}/executions/${execution.id}/cancel`,'POST',{taskVersion:1},a.token,1)).status,404);
   const lookup=await b.request(`tasks/lookup?agentId=${b.agents[0].id}&idempotencyKey=${key}`);assert.equal(lookup.data.task.id,task.id);
   for(const path of [`agents/${a.agents[0].id}`,`tasks/${own.data.id}`,`agents/${a.agents[0].id}/executions`])assert.equal((await b.request(path)).status,404);
   assert.equal((await row('SELECT status FROM executions WHERE id=$1',[execution.id])).status,'SUCCEEDED');
   assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE task_id=$1',[task.id])).n,1);
   for(const bad of ['not-an-id',encodeURIComponent('<script>')])assert.equal((await a.request(`agents/${bad}`)).status,400);
  }finally{await a.close();await b.close();}
 });
 test('P4 T02 a binding revoked after HTTP authorization is rejected inside the existing creation transaction',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let pending;
  try{
   const service=f.app.get(TasksService),original=service.create.bind(service);
   service.create=async input=>{entered.resolve();await release.promise;return original(input);};
   pending=f.create();await Promise.race([entered.promise,pending.then(r=>{throw Error('Creation not dispatched: HTTP '+r.status);})]);
   await f.service.remove({bindingId:f.bindings[0].id,revision:f.bindings[0].revision});release.resolve();
   assert.equal((await pending).status,403);
   assert.equal((await row('SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1',[f.owner.id])).n,0);
  }finally{release.resolve();await pending;await f.close();}
 });
 test('P4 T02 history keysets retain exact timestamp ties and use the supporting index without query fan-out',async()=>{
  const f=await fixture();try{
   // Persistence-only history fixtures, not fabricated executed runtime work.
   await getPool().query(`WITH t AS (INSERT INTO tasks(owner_id,agent_id,orchestrator_id,status,input)
    SELECT $1,$2,$3,'QUEUED','{"instruction":"history fixture"}'::jsonb FROM generate_series(1,400)
    RETURNING id,owner_id,agent_id,orchestrator_id)
    INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number,authority)
    SELECT owner_id,id,agent_id,orchestrator_id,1,'EXTERNAL' FROM t`,[f.owner.id,f.agents[0].id,f.route.id]);
   const first=await f.request(`agents/${f.agents[0].id}/executions?limit=20`);assert.equal(first.status,200);assert.equal(first.data.items.length,20);
   const next=await f.request(`agents/${f.agents[0].id}/executions?limit=20&before=${first.data.pagination.nextCursor}`);assert.equal(next.status,200);
   assert.equal(new Set([...first.data.items,...next.data.items].map(x=>x.id)).size,40);
   const proof=await getPool().query(`EXPLAIN (FORMAT JSON) SELECT id FROM executions WHERE owner_id=$1 AND agent_id=$2 ORDER BY created_at DESC NULLS LAST,id DESC NULLS LAST LIMIT 20`,[f.owner.id,f.agents[0].id]);
   assert.ok(JSON.stringify(proof.rows).includes('executions_owner_agent_history_idx'));
  }finally{await f.close();}
 });
 test('P4 T03 frontend data client consumes the actual authorized interaction API and nullable DTOs',async()=>{
  const {InteractionApiClient,createSubmissionIntent}=await import('../../../dist/js/runtime/interaction/index.js');
  const f=await fixture();let client;
  try{
   const pageOrigin='http://127.0.0.1:5173';
   client=new InteractionApiClient({baseUrl:await f.app.getUrl(),pageOrigin,fetchImpl:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:pageOrigin}})});
   client.authorize(f.token);
   const identity=await client.getAgent(f.agents[0].id);assert.equal(identity.actionEligibility.canCreateTask,true);assert.equal(identity.description,null);
   const intent=createSubmissionIntent(identity.id,{instruction:'A real contract check'}),created=await client.createTask(intent);assert.equal(created.status,'CREATED');assert.equal(created.completedAt,null);
   const ref={agentId:identity.id,taskId:created.id};assert.equal((await client.getTask(ref)).id,created.id);assert.equal((await client.getTaskStatus(ref)).latestExecutionId,null);
   assert.equal((await client.findTaskByIntent(identity.id,intent.idempotencyKey)).task.id,created.id);
   assert.equal((await client.findTaskByIntent(identity.id,'missing.intent')).task,null);
   const done=await client.executeTask(ref,created.version),executionRef={...ref,executionId:done.execution.id};assert.equal(done.task.status,'COMPLETED');assert.equal(done.result.output.data.wordCount,4);
   const detail=await client.getExecution(executionRef);assert.equal(detail.actionEligibility.canRequestCancel,false);assert.equal(detail.status,'SUCCEEDED');
   assert.equal((await client.getResult(executionRef)).availability,'AVAILABLE');assert.equal((await client.createTask(intent)).id,created.id);
   const history=await client.listAgentExecutions(identity.id,{limit:1});assert.equal(history.items[0].id,detail.id);assert.equal(history.pagination.limit,1);
   await assert.rejects(client.getExecution({...executionRef,agentId:f.agents[1].id}),{code:'SCHEMA'});
   await assert.rejects(client.executeTask(ref,done.task.version),{code:'CONFLICT',status:409,backendCode:'CAPACITY_EXCEEDED'});
   const next=await client.createTask(createSubmissionIntent(identity.id,{instruction:'Pending contract check'}));
   const queued=await f.app.get(RuntimeCoordinator).queueTask({taskId:next.id,taskVersion:next.version});
   const pendingRef={agentId:identity.id,taskId:next.id,executionId:queued.execution.id};const current=await client.getExecution(pendingRef);
   assert.equal((await client.getResult(pendingRef)).availability,'PENDING');assert.equal(current.startedAt,null);
   const cancelled=await client.cancelExecution(pendingRef,{taskVersion:queued.task.version,executionVersion:current.version});assert.equal(cancelled.task.status,'CANCELLED');
   assert.equal((await client.getResult(pendingRef)).availability,'UNAVAILABLE');
   const page=await client.listAgentExecutions(identity.id,{limit:1});assert.ok(page.pagination.nextCursor);
   const older=await client.listAgentExecutions(identity.id,{limit:1,before:page.pagination.nextCursor});assert.equal(older.items[0].id,done.execution.id);
   for(const index of [1,2]){
    const task=await client.createTask(createSubmissionIntent(f.agents[index].id,{instruction:'LLM client contract'}));
    const completed=await client.executeTask({agentId:f.agents[index].id,taskId:task.id},task.version);
    const result=await client.getResult({agentId:f.agents[index].id,taskId:task.id,executionId:completed.execution.id});
    if(index===1){assert.equal(completed.result,null);assert.equal(result.displayReason,'DISCLOSURE_RESTRICTED');assert.equal(result.availability,'UNAVAILABLE');}
    else{assert.equal(completed.result.output.text,'LLM interaction display marker');assert.equal(result.result.usage.totalTokens,5);assert.equal(result.result.provider,undefined);}
   }
   client.authorize(f.reader);await assert.rejects(client.getAgent(identity.id),{code:'AUTH_REQUIRED',status:401});assert.equal(client.hasCredential,false);
  }finally{client?.dispose();await f.close();}
 });
 test('P4 T04 submission owner saves through actual authorized API and recovers a committed lost response without duplicate Tasks',async()=>{
  const f=await fixture();let owner;
  try{
   const {InteractionApiClient}=await import('../../../dist/js/runtime/interaction/index.js');
   const {TaskSubmissionOwner}=await import('../../../dist/js/runtime/interaction/submission-owner.js');
   let posts=0,refreshes=0;const client=new InteractionApiClient({baseUrl:await f.app.getUrl(),pageOrigin:'http://127.0.0.1:5173',fetchImpl:async(url,options)=>{
    const response=await fetch(url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:5173'}});
    if(options.method==='POST'){posts++;await response.arrayBuffer();throw new TypeError('Controlled lost response after commit');}return response;
   }});
   owner=new TaskSubmissionOwner(client,()=>{refreshes++;});
   owner.select({state:'RESOLVED',agentId:f.agents[0].id,npcId:f.bindings[0].npcId,bindingId:f.bindings[0].id,freshness:'fresh'});
   const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{off();reject(Error('Eligibility did not settle'));},5000);const off=owner.subscribe(()=>{if(!owner.getSnapshot().busy&&owner.getSnapshot().agent){clearTimeout(timeout);off();resolve();}});});
   owner.connect(f.token);await ready;assert.equal(owner.getSnapshot().canSubmit,true);
   owner.setDraft('T04 authorized saved Task, not started');await Promise.all([owner.submit(),owner.submit()]);assert.equal(posts,1);assert.equal(owner.getSnapshot().phase,'RECOVERY_REQUIRED');
   await owner.recover();const saved=owner.getSnapshot().task;assert.equal(saved.agentId,f.agents[0].id);assert.equal(saved.status,'CREATED');assert.equal(refreshes,1);assert.equal(posts,1);
   const history=await client.listAgentExecutions(f.agents[0].id);assert.equal(history.items.length,0);
   const persisted=await f.request(`tasks/${saved.id}`);assert.equal(persisted.status,200);assert.equal(persisted.data.id,saved.id);
   owner.disconnect();assert.equal(owner.getSnapshot().task,null);assert.equal(owner.getSnapshot().draft,'');
  }finally{owner?.dispose();await f.close();}
 });
 test('P4 T04 real browser saves an authorized Task through the existing inspector and PostgreSQL', {timeout:120000},async()=>{
  const {resolve}=require('node:path'),{fork}=require('node:child_process'),{createServer}=await import('vite');
  const root=resolve(__dirname,'../../..'),web=await createServer({configFile:resolve(root,'vite.config.js'),server:{host:'127.0.0.1',port:0}});let f,child,stdout='',stderr='';
  try{
   await web.listen();const origin=`http://127.0.0.1:${web.httpServer.address().port}`;f=await fixture(origin);
   await f.service.remove({bindingId:f.bindings[3].id,revision:f.bindings[3].revision});
   child=fork(resolve(root,'scripts/browser-smoke.mjs'),[],{cwd:root,execArgv:[],env:{...process.env,BROWSER_BASE_URL:origin,ELYQRETH_TASK_PANEL_E2E:'true'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
   child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
   child.on('message',message=>{if(message?.kind==='task-panel-configuration-request')child.send({kind:'task-panel-configuration',config:{apiOrigin:`http://127.0.0.1:${f.app.getHttpServer().address().port}`,cityToken:f.reader,interactionToken:f.token,agentId:f.agents[0].id}});});
   let timer;const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Task panel browser deadline')),100000);})]).finally(()=>clearTimeout(timer));
   assert.equal(code,0,stderr);const report=JSON.parse(stdout);assert.equal(report.status,'PASS');assert.equal(report.exceptions,0);assert.equal(report.taskPanelAcceptance.status,'PASS');
   assert.equal((await row('SELECT count(*)::int AS n FROM tasks WHERE agent_id=$1',[f.agents[0].id])).n,1);
   assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE agent_id=$1',[f.agents[0].id])).n,0);
   const saved=await row('SELECT status,agent_id FROM tasks WHERE id=$1',[report.taskPanelAcceptance.taskId]);assert.equal(saved.status,'CREATED');assert.equal(saved.agent_id,f.agents[0].id);
   for(const secret of [f.token,f.reader,f.operator])assert.ok(!(stdout+stderr).includes(secret));
   const {writeFileSync}=require('node:fs'),{tmpdir}=require('node:os');writeFileSync(resolve(tmpdir(),'elyqreth-p4-t04-live-browser.json'),JSON.stringify(report,null,2));
  }finally{if(child&&child.exitCode===null)child.kill();await f?.close();await web.close();}
 });
 test('P4 T05 frontend lifecycle owner preserves synchronous Start and reconciles a committed lost cancellation response',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let owner,client,run;
  try{
   const {InteractionApiClient,createSubmissionIntent}=await import('../../../dist/js/runtime/interaction/index.js');const {ExecutionLifecycleOwner}=await import('../../../dist/js/runtime/interaction/lifecycle-owner.js');
   const genuine=f.app.get(TextStatisticsStrategy);f.app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{entered.resolve();await release.promise;return genuine.execute(r,c);}}}]);
   let cancels=0;client=new InteractionApiClient({baseUrl:await f.app.getUrl(),pageOrigin:'http://127.0.0.1:5173',fetchImpl:async(url,options)=>{const response=await fetch(url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:5173'}});if(url.endsWith('/cancel')){cancels++;await response.arrayBuffer();throw TypeError('Controlled response lost after cancel commit');}return response;}});client.authorize(f.token);
   const saved=await client.createTask(createSubmissionIntent(f.agents[0].id,{instruction:'T05 authorized cancel test'})),binding={state:'RESOLVED',agentId:f.agents[0].id,bindingId:f.bindings[0].id,npcId:f.bindings[0].npcId,freshness:'fresh'};
   owner=new ExecutionLifecycleOwner(client);owner.select(binding,saved);await owner.refresh();assert.equal(owner.getSnapshot().canStart,true);run=owner.start();
   await Promise.race([entered.promise,run.then(()=>{throw Error('Strategy did not enter');})]);owner.select(undefined);owner.select(binding,saved);await owner.refresh();assert.equal(owner.getSnapshot().canCancel,true);
   const executionId=owner.getSnapshot().execution.id;owner.requestCancel();await Promise.all([owner.confirmCancel(),owner.confirmCancel()]);assert.equal(cancels,1);assert.equal(owner.getSnapshot().execution.status,'CANCELLED');release.resolve();await run;
   assert.equal(owner.getSnapshot().execution.status,'CANCELLED');assert.equal(owner.getSnapshot().canStart,false);assert.equal(owner.getSnapshot().canCancel,false);
   assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE task_id=$1',[saved.id])).n,1);
   assert.equal((await row("SELECT count(*)::int AS n FROM agent_events WHERE execution_id=$1 AND event_type IN ('execution.cancelled','execution.completed')",[executionId])).n,1);
  }finally{release.resolve();await run;owner?.dispose();client?.dispose();await f.close();}
 });
 test('P4 T05 real browser starts, confirms cancellation and reloads authoritative execution controls', {timeout:120000},async()=>{
  const {resolve}=require('node:path'),{fork}=require('node:child_process'),{createServer}=await import('vite');
  const root=resolve(__dirname,'../../..'),web=await createServer({configFile:resolve(root,'vite.config.js'),server:{host:'127.0.0.1',port:0}}),entered=deferred(),release=deferred(),releaseStatus=deferred();let f,child,stdout='',stderr='',calls=0;
  try{
   await web.listen();const origin=`http://127.0.0.1:${web.httpServer.address().port}`;f=await fixture(origin);await f.service.remove({bindingId:f.bindings[3].id,revision:f.bindings[3].revision});
   await row('UPDATE agents SET name=$2 WHERE id=$1 RETURNING id',[f.agents[0].id,'LongAgentName'.repeat(12)]);
   const genuine=f.app.get(TextStatisticsStrategy);f.app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{if(++calls>1){entered.resolve();await release.promise;}return genuine.execute(r,c);}}}]);
   // Hold the first completed Task's follow-up read until selection has moved
   // to the second running Task. Both responses still come from real database reads.
   const {RuntimeApiService}=require('../dist/runtime/http/runtime-api.service'),reads=f.app.get(RuntimeApiService),taskStatus=reads.taskStatus.bind(reads);let completedTask;
   reads.taskStatus=async id=>{const value=await taskStatus(id);if(value.status==='COMPLETED')completedTask??=id;if(id===completedTask)await releaseStatus.promise;return value;};
   child=fork(resolve(root,'scripts/browser-smoke.mjs'),[],{cwd:root,execArgv:[],env:{...process.env,BROWSER_BASE_URL:origin,ELYQRETH_TASK_PANEL_E2E:'true'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
   child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
   child.on('message',async message=>{if(message?.kind==='task-panel-configuration-request')child.send({kind:'task-panel-configuration',config:{apiOrigin:`http://127.0.0.1:${f.app.getHttpServer().address().port}`,cityToken:f.reader,interactionToken:f.token,agentId:f.agents[0].id,lifecycle:true}});
    if(message?.kind==='task-lifecycle-command'){try{assert.ok(['entered','release'].includes(message.name));if(message.name==='entered'){await entered.promise;releaseStatus.resolve();}else release.resolve();if(child.connected)child.send({kind:'task-lifecycle-result',name:message.name});}catch{if(child.connected)child.send({kind:'task-lifecycle-result',name:message.name,error:true});}}
   });
   let timer;const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Lifecycle browser deadline')),100000);})]).finally(()=>clearTimeout(timer));
   assert.equal(code,0,stderr);const report=JSON.parse(stdout);assert.equal(report.status,'PASS');assert.equal(report.exceptions,0);assert.equal(report.taskPanelAcceptance.lifecycle.status,'PASS');assert.equal(report.taskPanelAcceptance.lifecycle.reloadRecovered,true);
   const rows=(await getPool().query('SELECT status FROM executions WHERE agent_id=$1 ORDER BY created_at,id',[f.agents[0].id])).rows;assert.deepEqual(rows.map(r=>r.status),['SUCCEEDED','CANCELLED']);assert.equal(calls,2);
   for(const secret of [f.operator,f.reader,f.token])assert.ok(!(stdout+stderr).includes(secret));
   const {writeFileSync}=require('node:fs'),{tmpdir}=require('node:os');writeFileSync(resolve(tmpdir(),'elyqreth-p4-t05-live-browser.json'),JSON.stringify(report,null,2));
  }finally{release.resolve();releaseStatus.resolve();if(child&&child.exitCode===null)child.kill();await f?.close();await web.close();}
 });
 test('P4 T06 real browser inspects safe results, bounded history and isolated Agent scopes', {timeout:150000},async()=>{
  const {resolve}=require('node:path'),{fork}=require('node:child_process'),{createServer}=await import('vite');const root=resolve(__dirname,'../../..');
  const web=await createServer({configFile:resolve(root,'vite.config.js'),server:{host:'127.0.0.1',port:0}});let f,child,stdout='',stderr='';
  try{
   await web.listen();const origin=`http://127.0.0.1:${web.httpServer.address().port}`;f=await fixture(origin,'<img src=x onerror=globalThis.__resultXss=1>\nUntrusted text https://external.invalid/no-load\n'+'Long result content '.repeat(500));
   await f.service.remove({bindingId:f.bindings[3].id,revision:f.bindings[3].revision});
   for(let i=0;i<11;i++){const saved=await f.create(0,randomUUID(),`seed execution ${i}`);assert.equal(saved.status,201);const done=await f.request(`tasks/${saved.data.id}/execute`,'POST',{},f.token,saved.data.version);assert.equal(done.status,200);}
   for(const index of [1,2]){const saved=await f.create(index);const done=await f.request(`tasks/${saved.data.id}/execute`,'POST',{},f.token,saved.data.version);assert.equal(done.status,200);}
   child=fork(resolve(root,'scripts/browser-smoke.mjs'),[],{cwd:root,execArgv:[],env:{...process.env,BROWSER_BASE_URL:origin,ELYQRETH_TASK_PANEL_E2E:'true'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});
   child.on('message',m=>{if(m?.kind==='task-panel-configuration-request')child.send({kind:'task-panel-configuration',config:{apiOrigin:`http://127.0.0.1:${f.app.getHttpServer().address().port}`,cityToken:f.reader,interactionToken:f.token,agentId:f.agents[0].id,results:true}});});
   let timer;const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Results browser deadline')),120000);})]).finally(()=>clearTimeout(timer));
   assert.equal(code,0,stderr);const report=JSON.parse(stdout);assert.equal(report.status,'PASS');assert.equal(report.exceptions,0);assert.equal(report.taskPanelAcceptance.results.status,'PASS');assert.deepEqual(report.taskPanelAcceptance.results.pages,[10,2]);
   assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE agent_id=$1',[f.agents[0].id])).n,12);for(const secret of [f.operator,f.reader,f.token])assert.ok(!(stdout+stderr).includes(secret));
   const {writeFileSync}=require('node:fs'),{tmpdir}=require('node:os');writeFileSync(resolve(tmpdir(),'elyqreth-p4-t06-live-browser.json'),JSON.stringify(report,null,2));
  }finally{if(child&&child.exitCode===null)child.kill();await f?.close();await web.close();}
 });
 test('P4 T07 session journal restores a committed lost Create response with authorized reads only',async()=>{
  const f=await fixture();let session,restored,client;
  try{
   const {InteractionApiClient}=await import('../../../dist/js/runtime/interaction/index.js'),{InteractionSession}=await import('../../../dist/js/runtime/interaction/session.js'),{InteractionRecoveryJournal,RECOVERY_STORAGE_KEY}=await import('../../../dist/js/runtime/interaction/recovery-journal.js');
   const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};let posts=0;
   client=new InteractionApiClient({baseUrl:await f.app.getUrl(),pageOrigin:'http://127.0.0.1:5173',fetchImpl:async(url,options)=>{const r=await fetch(url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:5173'}});if(options.method==='POST'){posts++;await r.arrayBuffer();throw TypeError('Controlled lost response after commit');}return r;}});client.authorize(f.token);
   const binding={state:'RESOLVED',agentId:f.agents[0].id,bindingId:f.bindings[0].id,npcId:f.bindings[0].npcId,freshness:'fresh'};
   const ready=owner=>new Promise((resolve,reject)=>{let off;const timer=setTimeout(()=>{off?.();reject(Error('Session data did not settle'));},5000);off=owner.subscribe(()=>{if(!owner.submission.getSnapshot().busy&&owner.submission.getSnapshot().agent){clearTimeout(timer);off();resolve();}});});
   session=new InteractionSession(client,{baseUrl:await f.app.getUrl(),journal:new InteractionRecoveryJournal(await f.app.getUrl(),{storage})});const permitted=ready(session);session.select(binding);await permitted;session.submission.setDraft('T07 private instruction never persisted');await session.submission.submit();assert.equal(session.submission.getSnapshot().phase,'RECOVERY_REQUIRED');assert.ok(!storage.getItem(RECOVERY_STORAGE_KEY).includes('T07 private'));session.suspend();session.dispose();
   client.authorize(f.token);restored=new InteractionSession(client,{baseUrl:await f.app.getUrl(),journal:new InteractionRecoveryJournal(await f.app.getUrl(),{storage})});const loaded=ready(restored);restored.select(binding);await loaded;await restored.restore(true);const task=restored.submission.getSnapshot().task;assert.ok(task);assert.equal(task.status,'CREATED');assert.equal(posts,1);assert.equal((await row('SELECT count(*)::int AS n FROM tasks WHERE agent_id=$1',[f.agents[0].id])).n,1);restored.disconnect();assert.equal(storage.getItem(RECOVERY_STORAGE_KEY),null);
  }finally{session?.dispose();restored?.dispose();client?.dispose();await f.close();}
 });
 test('P4 T07 real browser reconciles reload locators, concurrent Agents, outage and history invalidation', {timeout:150000},async()=>{
  const {resolve}=require('node:path'),{fork}=require('node:child_process'),{createServer}=await import('vite');const root=resolve(__dirname,'../../..'),web=await createServer({configFile:resolve(root,'vite.config.js'),server:{host:'127.0.0.1',port:0}}),entered=deferred(),release=deferred(),enteredThird=deferred(),releaseThird=deferred();let f,secondary,child,stdout='',stderr='',calls=0,thirdCalls=0;
  try{
   await web.listen();const origin=`http://127.0.0.1:${web.httpServer.address().port}`;f=await fixture(origin);await f.service.remove({bindingId:f.bindings[3].id,revision:f.bindings[3].revision});
   const genuine=f.app.get(TextStatisticsStrategy),llm=f.app.get(require('../dist/runtime/strategies/llm-agent.strategy').LlmAgentStrategy);f.app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{if(++calls===2){entered.resolve();await release.promise;}return genuine.execute(r,c);}}},{id:'llm.text.v1',strategy:{type:'LLM',validateDefinition:d=>llm.validateDefinition(d),execute:async(r,c)=>{thirdCalls++;enteredThird.resolve();await releaseThird.promise;return llm.execute(r,c);}}}]);
   // Existing coordinator is single-flight per instance. A second authorized instance observes the same PostgreSQL authority, as in Phase3 acceptance.
   secondary=await createApplication(f.config);secondary.get(ProviderSelectionService).registry=f.app.get(ProviderSelectionService).registry;await secondary.listen(0,'127.0.0.1');
   child=fork(resolve(root,'scripts/browser-smoke.mjs'),[],{cwd:root,execArgv:[],env:{...process.env,BROWSER_BASE_URL:origin,ELYQRETH_TASK_PANEL_E2E:'true'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});
   child.on('message',async m=>{if(m?.kind==='task-panel-configuration-request')child.send({kind:'task-panel-configuration',config:{apiOrigin:`http://127.0.0.1:${f.app.getHttpServer().address().port}`,cityToken:f.reader,interactionToken:f.token,agentId:f.agents[0].id,lifecycle:true,synchronization:true}});
    if(m?.kind==='task-lifecycle-command'){try{assert.ok(['entered','release','runB','enteredThird','releaseThird','verifyThird'].includes(m.name));let result;if(m.name==='entered')await entered.promise;else if(m.name==='release')release.resolve();else if(m.name==='enteredThird')await enteredThird.promise;else if(m.name==='releaseThird')releaseThird.resolve();else if(m.name==='verifyThird'){const deadline=Date.now()+5000;do{const execution=await row('SELECT id,status FROM executions WHERE agent_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[f.agents[1].id]);if(['SUCCEEDED','FAILED','CANCELLED','TIMED_OUT'].includes(execution.status)){result={executionId:execution.id,status:execution.status};break;}await new Promise(resolve=>setImmediate(resolve));}while(Date.now()<deadline);assert.ok(result,'Reloaded Execution did not settle');}else if(m.name==='runB'){const task=await row('SELECT id,version FROM tasks WHERE agent_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[f.agents[1].id]);const r=await fetch(`${await secondary.getUrl()}/api/v1/tasks/${task.id}/execute`,{method:'POST',headers:{Authorization:`Bearer ${f.token}`,Origin:origin,'Content-Type':'application/json','If-Match':`"${task.version}"`},body:'{}'});assert.equal(r.status,200);await r.arrayBuffer();}if(child.connected)child.send({kind:'task-lifecycle-result',name:m.name,result});}catch{if(child.connected)child.send({kind:'task-lifecycle-result',name:m.name,error:true});}}
   });
   let timer;const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Session browser deadline')),120000);})]).finally(()=>clearTimeout(timer));assert.equal(code,0,stderr);const report=JSON.parse(stdout);assert.equal(report.exceptions,0);assert.equal(report.taskPanelAcceptance.synchronization.status,'PASS');assert.equal(report.taskPanelAcceptance.synchronization.unstartedTaskReloadRecovered,true);assert.equal(report.taskPanelAcceptance.synchronization.networkReconciled,true);assert.equal(report.taskPanelAcceptance.synchronization.activeReloadRecovered,true);assert.equal(calls,2);assert.equal(thirdCalls,1);
   assert.equal((await row('SELECT count(*)::int AS n FROM tasks WHERE agent_id=$1',[f.agents[0].id])).n,2);assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE agent_id=$1',[f.agents[0].id])).n,2);assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE agent_id=$1',[f.agents[1].id])).n,2);
   for(const secret of [f.token,f.reader,f.operator])assert.ok(!(stdout+stderr).includes(secret));const {writeFileSync}=require('node:fs'),{tmpdir}=require('node:os');writeFileSync(resolve(tmpdir(),'elyqreth-p4-t07-live-browser.json'),JSON.stringify(report,null,2));
  }finally{release.resolve();releaseThird.resolve();if(child&&child.exitCode===null)child.kill();await secondary?.close();await f?.close();await web.close();}
 });
 test('P4 T03 browser input validation and closed backend error codes match current backend contracts',async()=>{
  const {taskInput}=await import('../../../dist/js/runtime/interaction/validation.js');
  const {BACKEND_ERROR_CODES}=await import('../../../dist/js/runtime/interaction/errors.js');
  const {validTaskInput}=require('../dist/tasks/dto/task.dto');const {runtimeErrorMessages}=require('../dist/runtime/contracts/runtime-error.contract');
  for(const code of Object.keys(runtimeErrorMessages))assert.ok(BACKEND_ERROR_CODES.includes(code),code);
  const cases=[{instruction:'ok'},{instruction:'  preserved  ',context:''},{instruction:'x'.repeat(16000)},
   {instruction:'x'.repeat(16001)},{instruction:' '},{instruction:'bad\u0000value'},{instruction:'password=not-public'},
   {instruction:'😀'.repeat(8000),context:'😀'.repeat(8000)},{instruction:'ok',ownerId:'forged'},{instruction:'ok',context:42}];
  for(const input of cases){let valid=true;try{taskInput(input);}catch{valid=false;}assert.equal(valid,validTaskInput(input));}
 });
 require('./collaboration-browser.integration.cjs')({fixture,row,getPool,getUrl});
 if(process.env.ELYQRETH_INTERACTION_E2E==='true')require('./interaction-reliability.integration.cjs')({fixture,row,getPool,getUrl});
};
