'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {ApiLogger}=require('../dist/common/api-logger');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {TaskLifecycleService}=require('../dist/lifecycle/task-lifecycle.service');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ToolExecutionService}=require('../dist/runtime/tools/tool-execution.service');
const {configuration,text,proposal,CALC,TIME}=require('./llm-fixtures.cjs');
const {deferred}=require('./runtime-fixtures.cjs');
module.exports=({row,getUrl,getPool})=>{
 async function fixture(script=async()=>text(),{grants=[],live=false,drainTimeoutMs}={}){
  const owner=await row("INSERT INTO owners(name) VALUES ('t09-test-scope') RETURNING id");
  const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native-llm','native','ENABLED') RETURNING id",[owner.id]);
  const env={NODE_ENV:'test',API_HOST:'127.0.0.1',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',
   AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:randomBytes(32).toString('hex')},logs=[];
  let app,configured=false,config=validateEnvironment(env),calls=0,toolCalls=0;const instances=[];
  const open=async()=>{
   if(config.runtime&&drainTimeoutMs!==undefined)config={...config,runtime:{...config.runtime,drainTimeoutMs}};
   const a=await createApplication(config);
   const {requestContext}=require('../dist/common/request-context');
   a.get(ApiLogger).info=(event,fields={})=>logs.push([event,{...fields,...requestContext.getStore()}]);
   a.get(ApiLogger).error=(event,fields={})=>logs.push([event,{...fields,...requestContext.getStore()}]);
   if(configured&&!live){
    // Explicit test-only provider injected into the EXISTING selection port.
    // Production registration remains Ollama/OpenAI, with no fake strategy.
    a.get(ProviderSelectionService).registry=new LlmProviderRegistry([{id:'fixture.local',capabilities:()=>config.llm.profiles[0].capabilities,
     generate:async(r,c)=>{calls++;return script(r,c,calls);}}]);
   }
   const tools=a.get(ToolExecutionService),invoke=tools.invoke.bind(tools);
   tools.invoke=async(...args)=>{const result=await invoke(...args);toolCalls++;return result;};
   if(live){
    const validate=tools.validateRequests.bind(tools);
    tools.validateRequests=(requests,context)=>{
     try{return validate(requests,context);}catch(error){
      logs.push(['live.tool.validation',requests.map(r=>({calculator:r.toolId==='calculator',
       operationPresent:Object.hasOwn(r.input??{},'operation'),operationValid:['add','subtract','multiply','divide'].includes(r.input?.operation),
       aType:typeof r.input?.a,bType:typeof r.input?.b,unknownFieldCount:Object.keys(r.input??{}).filter(k=>!['operation','a','b'].includes(k)).length}))]);throw error;
     }
    };
   }
   await a.listen(0,'127.0.0.1');instances.push(a);return a;
  };
  app=await open();
  const http=async(path,method='GET',body,headers={},options={})=>{
   const response=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,headers:{authorization:`Bearer ${env.AGENT_REGISTRY_TOKEN}`,'content-type':'application/json',...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),...options});return {status:response.status,data:await response.json(),headers:Object.fromEntries(response.headers)};
  };
  const registered=await http('agents','POST',{name:'Reviewed LLM test Agent',type:'LLM',orchestratorId:route.id,configuration:{category:'test'}});
  assert.equal(registered.status,201);const active=await http(`agents/${registered.data.id}/activate`,'POST',{}, {'if-match':`"${registered.data.version}"`});assert.equal(active.status,200);
  const agent=active.data,ids={ownerId:owner.id,agentId:agent.id,orchestratorId:route.id,taskId:randomUUID(),executionId:randomUUID(),correlationId:randomUUID()};
  const f=configuration({ids,grants,providerId:live?'ollama':'fixture.local',model:live?process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL:'fixture:model'});
  if(live){
   f.definition.systemInstructions=grants.length?'Call calculator exactly once with operation multiply, a as the JSON number 125, and b as the JSON number 48. Numeric arguments must be JSON numbers, never quoted strings. Then report the supplied tool result briefly. /no_think':'Reply briefly with READY. /no_think';
   f.env.LLM_REQUEST_TIMEOUT_MS='60000';f.env.LLM_MAX_OUTPUT_TOKENS='1024';
   f.env.RUNTIME_BINDINGS=JSON.stringify([{agentId:agent.id,orchestratorId:route.id,definition:f.definition}]);
  }
  config=validateEnvironment({...f.env,...env,DATABASE_URL:getUrl()});configured=true;await app.close();app=await open();
  return {owner,route,agent,config,logs,http,open,calls:()=>calls,toolCalls:()=>toolCalls,app:()=>app,
   async restart(){await app.close();app=await open();},async close(){await Promise.all(instances.map(a=>a.close()));},
   async task(instruction='Calculate a product using approved tools'){const t=await http('tasks','POST',{agentId:agent.id,input:{instruction}});assert.equal(t.status,201);return t.data;},
   execute:t=>app.get(RuntimeCoordinator).executeTask({taskId:t.id,taskVersion:t.version})};
 }
 const saved=async taskId=>({task:await row('SELECT * FROM tasks WHERE id=$1',[taskId]),execution:await row('SELECT * FROM executions WHERE task_id=$1 ORDER BY attempt_number DESC LIMIT 1',[taskId])});
 const events=async taskId=>(await getPool().query('SELECT * FROM agent_events WHERE task_id=$1 ORDER BY stream_position',[taskId])).rows;
 const body=async executionId=>(await row('SELECT body FROM execution_results WHERE execution_id=$1',[executionId]))?.body;

 test('T09 real LLM DI strategy: register/activate/task/queue/execute, persist final text and audit, survive new-instance restart',async()=>{
  const f=await fixture();try{
   const t=await f.task(),queued=await f.app().get(RuntimeCoordinator).queueTask({taskId:t.id,taskVersion:t.version});assert.equal(f.calls(),0);
   const done=await f.execute(queued.task);assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');assert.equal(f.calls(),1);
   assert.equal((await body(done.execution.id)).output.text,'Safe final answer');assert.equal(done.result.provider.providerId,'fixture.local');
   const history=await events(t.id);assert.deepEqual(history.map(e=>e.event_type),['task.created','execution.created','task.queued','execution.started','task.started','execution.completed','task.completed']);
   await f.restart();assert.equal((await f.http(`tasks/${t.id}`)).data.status,'COMPLETED');assert.deepEqual(await body(done.execution.id),done.result);assert.deepEqual(await events(t.id),history);
   assert.equal((await f.http(`tasks/${t.id}/executions`)).data.items.length,1);assert.ok(!JSON.stringify({logs:f.logs,history}).includes('Calculate a product'));
  }finally{await f.close();}
 });

 test('T09 genuine calculator and datetime run through committed claim/session; fake provider receives exact correlated results',async()=>{
  const f=await fixture(async(r,_c,n)=>{
   if(n===1)return {...proposal(),calls:[...proposal().calls,{callId:'clock_1',toolId:'current_datetime',arguments:{}}]};
   assert.equal(JSON.parse(r.messages.at(-2).content).result,96);assert.equal(JSON.parse(r.messages.at(-1).content).timezone,'UTC');
   assert.equal(r.messages.at(-2).callId,'call_1');return text('The product is 96 and the time is UTC.');
  },{grants:[CALC,TIME]});try{
   const t=await f.task(),done=await f.execute(t);assert.equal(done.task.status,'COMPLETED');assert.equal(f.toolCalls(),2);assert.equal(f.calls(),2);
   assert.equal(done.result.toolSummary.invocationCount,2);assert.deepEqual(await body(done.execution.id),done.result);assert.equal((await events(t.id)).length,7);
   assert.equal((await saved(t.id)).execution.status,'SUCCEEDED');
  }finally{await f.close();}
 });

 test('T09 unauthorized, malformed and duplicate proposals finalize safely and never execute a denied calculator',async()=>{
  for(const scenario of ['unauthorized','invalid','duplicate']){
   const f=await fixture(async()=>scenario==='invalid'?proposal('call_1','calculator',{operation:'divide',a:1,b:0}):proposal(),{grants:scenario==='unauthorized'?[]:[CALC]});
   try{
    const t=await f.task(),done=await f.execute(t);assert.equal(done.task.status,'FAILED');assert.equal(done.execution.status,'FAILED');
    assert.equal(f.toolCalls(),scenario==='duplicate'?1:0);assert.equal(await body(done.execution.id),undefined);
    assert.deepEqual((await events(t.id)).slice(-2).map(e=>e.event_type),['execution.failed','task.failed']);
   }finally{await f.close();}
  }
 });

 test('T09 persisted cancellation and caller abort reject late provider success without a result or success event',async()=>{
  for(const local of [false,true]){
   const entered=deferred(),release=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;return text();});let running;
   try{
    const t=await f.task(),controller=new AbortController();running=f.app().get(RuntimeCoordinator).executeTask({taskId:t.id,taskVersion:t.version},controller.signal);await entered.promise;
    if(local)controller.abort();else{
     const state=await saved(t.id);await f.app().get(TaskLifecycleService).cancelTask(t.id,{taskVersion:state.task.version,executionId:state.execution.id,executionVersion:state.execution.version});
    }
    release.resolve();const done=await running;assert.equal(done.task.status,'CANCELLED');assert.equal(done.execution.status,'CANCELLED');
    assert.equal(await body(done.execution.id),undefined);assert.ok(!(await events(t.id)).some(e=>e.event_type==='execution.completed'));assert.equal(f.calls(),1);
   }finally{release.resolve();await running?.catch(()=>{});await f.close();}
  }
 });

 test('T09 concurrent real coordinators dispatch one LLM request; success-event fault rolls back result and finalizes failure',async()=>{
  const entered=deferred(),release=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;return text();});let other;
  try{
   const t=await f.task();other=await f.open();const first=f.execute(t);await entered.promise;
   await assert.rejects(other.get(RuntimeCoordinator).executeTask({taskId:t.id,taskVersion:t.version}),e=>['CAPACITY_EXCEEDED','ACCESS_DENIED'].includes(e.code));
   release.resolve();assert.equal((await first).task.status,'COMPLETED');assert.equal(f.calls(),1);
   // Fault injection is scoped to this run's owned disposable database/owner.
   await getPool().query(`CREATE FUNCTION t09_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.event_type='execution.completed' THEN RAISE EXCEPTION 'private fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER t09_fault BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION t09_fault()');
   try{
    const t2=await f.task(),done=await f.execute(t2);assert.equal(done.task.status,'FAILED');assert.equal(await body(done.execution.id),undefined);
    assert.ok(!(await events(t2.id)).some(e=>e.event_type==='execution.completed'));
   }finally{await getPool().query('DROP TRIGGER t09_fault ON agent_events');await getPool().query('DROP FUNCTION t09_fault()');}
  }finally{release.resolve();await other?.close();await f.close();}
 });

 test('T10 cancellation wins, duplicate cancellation has no second effect, and late success leaves no result',async()=>{
  const entered=deferred(),release=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;return text();});let running;
  try{
   const t=await f.task();running=f.execute(t);await entered.promise;const state=await saved(t.id);
   const command={taskVersion:state.task.version,executionId:state.execution.id,executionVersion:state.execution.version};
   const life=f.app().get(TaskLifecycleService),cancelled=await life.cancelTask(t.id,command);
   const before=await events(t.id);
   // Preserve Phase 1's explicit stale-command/terminal conflict policy. Replays
   // are effect-idempotent; they do not acknowledge a new cancellation decision.
   await assert.rejects(life.cancelTask(t.id,command),e=>e.code==='LIFECYCLE_CONFLICT');
   await assert.rejects(life.cancelTask(t.id,{taskVersion:cancelled.task.version,executionId:cancelled.execution.id,
    executionVersion:cancelled.execution.version}),e=>e.code==='ALREADY_TERMINAL');
   release.resolve();assert.equal((await running).task.status,'CANCELLED');
   const final=await saved(t.id);assert.equal(final.execution.status,'CANCELLED');assert.equal(await body(final.execution.id),undefined);
   assert.deepEqual(await events(t.id),before);assert.equal(before.filter(e=>e.event_type==='task.cancelled').length,1);
   assert.equal(before.filter(e=>e.event_type==='execution.cancelled').length,1);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });

 test('T10 completion wins against late cancellation with one immutable result and terminal audit pair',async()=>{
  const f=await fixture();try{
   const t=await f.task(),done=await f.execute(t),before=await events(t.id),result=await body(done.execution.id);
   await assert.rejects(f.app().get(TaskLifecycleService).cancelTask(t.id,{taskVersion:done.task.version,
    executionId:done.execution.id,executionVersion:done.execution.version}),e=>e.code==='ALREADY_TERMINAL');
   assert.deepEqual(await body(done.execution.id),result);assert.deepEqual(await events(t.id),before);
   const final=await saved(t.id);assert.equal(final.task.status,'COMPLETED');assert.equal(final.execution.status,'SUCCEEDED');
   assert.equal(before.filter(e=>e.event_type==='task.completed').length,1);assert.equal(before.filter(e=>e.event_type==='execution.completed').length,1);
  }finally{await f.close();}
 });

 test('T10 provider failure versus persisted cancellation commits one consistent terminal event pair',async()=>{
  const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
  const entered=deferred(),release=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;throw new RuntimeError('PROVIDER_UNAVAILABLE');});let running;
  try{
   const t=await f.task();running=f.execute(t);await entered.promise;const state=await saved(t.id);
   const cancel=f.app().get(TaskLifecycleService).cancelTask(t.id,{taskVersion:state.task.version,
    executionId:state.execution.id,executionVersion:state.execution.version});release.resolve();
   const outcomes=await Promise.allSettled([running,cancel]);assert.equal(outcomes[0].status,'fulfilled');
   const final=await saved(t.id),history=await events(t.id);assert.ok(['FAILED','CANCELLED'].includes(final.task.status));
   assert.equal(final.execution.status,final.task.status);assert.equal(await body(final.execution.id),undefined);
   assert.equal(history.filter(e=>['task.failed','task.cancelled'].includes(e.event_type)).length,1);
   assert.equal(history.filter(e=>['execution.failed','execution.cancelled'].includes(e.event_type)).length,1);
   assert.equal(history.some(e=>e.event_type==='execution.completed'),false);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });

 test('T10 independent live runtime claims do not share caller cancellation or scoped resources',async()=>{
  const enteredA=deferred(),enteredB=deferred(),release=deferred();
  const a=await fixture(async()=>{enteredA.resolve();await release.promise;return text();});
  const b=await fixture(async()=>{enteredB.resolve();await release.promise;return text();});let first,second;
  try{
   const ta=await a.task(),tb=await b.task(),caller=new AbortController();
   first=a.app().get(RuntimeCoordinator).executeTask({taskId:ta.id,taskVersion:ta.version},caller.signal);second=b.execute(tb);
   await Promise.all([enteredA.promise,enteredB.promise]);caller.abort();const cancelled=await first;
   assert.equal(cancelled.task.status,'CANCELLED');assert.equal((await saved(tb.id)).task.status,'RUNNING');
   release.resolve();const completed=await second;assert.equal(completed.task.status,'COMPLETED');
   assert.equal(await body(cancelled.execution.id),undefined);assert.ok(await body(completed.execution.id));
   assert.equal((await events(ta.id)).filter(e=>e.event_type==='task.cancelled').length,1);
   assert.equal((await events(tb.id)).filter(e=>e.event_type==='task.completed').length,1);
  }finally{release.resolve();await Promise.allSettled([first,second].filter(Boolean));await a.close();await b.close();}
 });

 test('T10 real Nest shutdown cancels after bounded drain and finalizes before database pool shutdown',async()=>{
  const entered=deferred(),release=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;return text();},{drainTimeoutMs:100});let running;
  try{
   const t=await f.task(),coordinator=f.app().get(RuntimeCoordinator);running=f.execute(t);await entered.promise;
   await f.app().close();assert.equal((await running).task.status,'CANCELLED');
   await assert.rejects(coordinator.executeTask({taskId:t.id,taskVersion:t.version}),e=>e.code==='RUNTIME_DRAINING');
   const final=await saved(t.id);assert.equal(final.execution.status,'CANCELLED');assert.equal(await body(final.execution.id),undefined);
   assert.equal(final.execution.reconciliation_state,'CANCELLATION_UNCONFIRMED');
   assert.deepEqual((await events(t.id)).slice(-2).map(e=>e.event_type),['execution.cancelled','task.cancelled']);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });

 test('T11 HTTP execute uses real LLM coordinator/tools; persisted status/result/history/audit and request correlation agree',async()=>{
  const f=await fixture(async(_r,_c,n)=>n===1?{...proposal(),calls:[...proposal().calls,{callId:'clock_http',toolId:'current_datetime',arguments:{}}]}:text('96 and UTC'),{grants:[CALC,TIME]});
  try{
   const t=await f.task('Private T11 HTTP instruction marker'),requestId='T11-http-success';
   const response=await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`,'x-request-id':requestId});
   assert.equal(response.status,200);assert.equal(response.headers['x-request-id'],requestId);const done=response.data;
   assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');assert.equal(f.calls(),2);assert.equal(f.toolCalls(),2);
   const status=await f.http(`tasks/${t.id}/status`);assert.equal(status.data.latestExecutionId,done.execution.id);
   const exec=await f.http(`tasks/${t.id}/executions/${done.execution.id}`);assert.equal(exec.data.strategyId,'llm.text.v1');assert.ok(exec.data.durationMs>=0);
   const result=await f.http(`tasks/${t.id}/executions/${done.execution.id}/result`);assert.equal(result.data.availability,'AVAILABLE');assert.deepEqual(result.data.result,done.result);
   assert.equal(result.headers['x-content-type-options'],'nosniff');assert.equal(result.headers['cache-control'],'no-store');
   assert.equal((await f.http(`tasks/${t.id}/executions?limit=1`)).data.items.length,1);
   const history=await f.http(`executions/${done.execution.id}/events?limit=1`);assert.equal(history.data.items.length,1);assert.equal(history.data.pagination.hasMore,true);
   const next=await f.http(`executions/${done.execution.id}/events?after=${history.data.pagination.nextAfter}&limit=1`);assert.notEqual(next.data.items[0].eventId,history.data.items[0].eventId);
   assert.ok((await events(t.id)).slice(1).every(e=>e.correlation_id===done.correlationId));
   for(const event of ['runtime.requested','runtime.started','runtime.completed','provider.started','provider.completed','tool.started','tool.completed']){
    const entry=f.logs.find(([name,fields])=>name===event&&fields.requestId===requestId);assert.ok(entry,event);
    assert.equal(entry[1].correlationId,done.correlationId);
   }
   assert.ok(!JSON.stringify(f.logs).includes('Private T11 HTTP instruction'));assert.ok(!JSON.stringify(await events(t.id)).includes('Private T11 HTTP instruction'));
   // Exercise the real no-op finalization path: its observed success has no
   // result body, so HTTP must retrieve the first committed result safely.
   const {RuntimePersistenceService}=require('../dist/runtime/runtime-persistence.service');
   const store=f.app().get(RuntimePersistenceService),finish=store.finish.bind(store);
   store.finish=async(...args)=>{await finish(...args);return finish(...args);};
   const observedTask=await f.task(),observed=await f.http(`tasks/${observedTask.id}/execute`,'POST',{}, {'if-match':`"${observedTask.version}"`});
   assert.equal(observed.status,200);assert.ok(observed.data.result);assert.deepEqual(observed.data.result,await body(observed.data.execution.id));
   assert.equal((await events(observedTask.id)).length,7);store.finish=finish;
   await f.restart();assert.deepEqual((await f.http(`tasks/${t.id}/executions/${done.execution.id}/result`)).data.result,done.result);
  }finally{await f.close();}
 });

 test('T11 HTTP rejects unauthenticated, forged, stale and cross-owner commands before any runtime invocation',async()=>{
  const f=await fixture(),foreign=await fixture();try{
   const t=await f.task(),other=await foreign.task(),url=`tasks/${t.id}/execute`,headers={'if-match':`"${t.version}"`};
   assert.equal((await f.http(url,'POST',{}, {...headers,authorization:''})).status,401);
   assert.equal((await f.http(url,'POST',{}, {...headers,origin:'https://evil.invalid'})).status,403);
   for(const body of [{provider:'openai'},{model:'evil'},{authorizedCapabilities:[CALC]},{agentId:foreign.agent.id},JSON.parse('{"__proto__":{}}')])
    assert.equal((await f.http(url,'POST',body,headers)).status,400);
   assert.equal((await f.http(url,'POST',{})).status,400);
   assert.equal((await f.http(url+'?strategy=evil','POST',{},headers)).status,400);
   assert.equal((await f.http('tasks/not-a-uuid/status')).status,400);
   assert.equal((await f.http(`tasks/${other.id}/status`)).status,404);
   assert.equal((await f.http(`tasks/${other.id}/execute`,'POST',{},headers)).status,404);
   assert.equal((await f.http(url,'POST',{}, {'if-match':'"999"'})).status,409);
   assert.equal(f.calls(),0);assert.equal((await saved(t.id)).execution,undefined);
   assert.equal((await f.http(`tasks/${t.id}/executions?limit=10001`)).status,400);
   assert.equal((await f.http(`tasks/${t.id}/events?offset=10001`)).status,400);
  }finally{await f.close();await foreign.close();}
 });

 test('T11 HTTP pending reads, duplicate execution and cancellation races preserve one terminal decision',async()=>{
  const entered=deferred(),release=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;return text();});let running;
  try{
   const t=await f.task();running=f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`});await entered.promise;
   const status=(await f.http(`tasks/${t.id}/status`)).data,executionId=status.latestExecutionId;
   const exec=(await f.http(`tasks/${t.id}/executions/${executionId}`)).data;
   const pending=await f.http(`tasks/${t.id}/executions/${executionId}/result`);assert.equal(pending.data.availability,'PENDING');assert.equal(pending.data.result,null);
   assert.equal((await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${status.version}"`})).status,409);
   const path=`tasks/${t.id}/executions/${executionId}/cancel`,body={taskVersion:status.version},headers={'if-match':`"${exec.version}"`};
   assert.equal((await f.http(path,'POST',body,{...headers,authorization:''})).status,401);
   assert.equal((await f.http(path,'POST',body,headers)).status,200);
   const history=await events(t.id);assert.equal((await f.http(path,'POST',body,headers)).status,409);
   release.resolve();const outcome=await running;assert.equal(outcome.status,409);assert.equal(outcome.data.code,'CANCELLED');
   assert.deepEqual(await events(t.id),history);assert.equal((await saved(t.id)).execution.status,'CANCELLED');assert.equal(f.calls(),1);
   assert.equal((await f.http(`tasks/${t.id}/executions/${executionId}/result`)).data.availability,'UNAVAILABLE');
   assert.equal((await f.http(`tasks/${randomUUID()}/executions/${executionId}/result`)).status,404);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });

 test('T11 HTTP failures/timeouts are safe codes, persisted failed results unavailable, and late cancellation cannot overwrite success',async()=>{
  const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
  for(const code of ['PROVIDER_UNAVAILABLE','DEADLINE_EXCEEDED']){
   const f=await fixture(async()=>{throw new RuntimeError(code);});try{
    const t=await f.task(),response=await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`});
    assert.equal(response.status,code==='DEADLINE_EXCEEDED'?504:503);assert.equal(response.data.code,code);assert.equal(response.data.stack,undefined);
    const state=await saved(t.id);assert.equal(state.task.status,'FAILED');assert.equal(state.execution.status,code==='DEADLINE_EXCEEDED'?'TIMED_OUT':'FAILED');
    const result=await f.http(`tasks/${t.id}/executions/${state.execution.id}/result`);assert.equal(result.status,200);assert.equal(result.data.availability,'UNAVAILABLE');assert.equal(result.data.result,null);
   }finally{await f.close();}
  }
  const f=await fixture();try{
   const t=await f.task(),done=(await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`})).data,history=await events(t.id);
   assert.equal((await f.http(`tasks/${t.id}/executions/${done.execution.id}/cancel`,'POST',{taskVersion:done.task.version},{'if-match':`"${done.execution.version}"`})).status,409);
   assert.deepEqual(await events(t.id),history);
   // Historical results are append-only. Inject a malformed NEW insert in this
   // owned database rather than disabling immutability or rewriting history.
   await getPool().query(`CREATE FUNCTION t11_corrupt_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid THEN NEW.body='{"private":"credential sentinel"}'::jsonb; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER t11_corrupt_result BEFORE INSERT ON execution_results FOR EACH ROW EXECUTE FUNCTION t11_corrupt_result()');
   try{
    const t2=await f.task(),next=await f.http(`tasks/${t2.id}/execute`,'POST',{}, {'if-match':`"${t2.version}"`});assert.equal(next.status,200);
    const corrupted=await f.http(`tasks/${t2.id}/executions/${next.data.execution.id}/result`);assert.equal(corrupted.status,503);assert.equal(corrupted.data.code,'OUTCOME_UNCERTAIN');
    assert.ok(!JSON.stringify(corrupted.data).includes('credential sentinel'));
   }finally{await getPool().query('DROP TRIGGER t11_corrupt_result ON execution_results');await getPool().query('DROP FUNCTION t11_corrupt_result()');}
  }finally{await f.close();}
 });

 test('T11 actual HTTP disconnect aborts the active coordinator and commits cancellation without a detached executor',async()=>{
  const entered=deferred(),release=deferred(),committed=deferred(),f=await fixture(async()=>{entered.resolve();await release.promise;return text();});let running;
  try{
   const {RuntimePersistenceService}=require('../dist/runtime/runtime-persistence.service');
   const store=f.app().get(RuntimePersistenceService),finish=store.finish.bind(store);
   store.finish=async(...args)=>{const value=await finish(...args);committed.resolve(value);return value;};
   const t=await f.task(),client=new AbortController();running=f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`},{signal:client.signal});
   const clientFailure=assert.rejects(running);await entered.promise;client.abort();await clientFailure;
   const done=await committed.promise;assert.equal(done.task.status,'CANCELLED');assert.equal(done.execution.status,'CANCELLED');
   assert.equal(await body(done.execution.id),undefined);assert.equal((await events(t.id)).filter(e=>e.event_type==='execution.cancelled').length,1);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });

 test('T12 every runtime read/write/history route denies missing authentication and foreign owners without leaking existence',async()=>{
  const f=await fixture(),foreign=await fixture();try{
   const t=await f.task(),done=(await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`})).data;
   const prefix=`tasks/${t.id}/executions/${done.execution.id}`;
   const reads=[`tasks/${t.id}`,`tasks/${t.id}/status`,prefix,`${prefix}/result`,`tasks/${t.id}/executions`,
    `tasks/${t.id}/events`,`executions/${done.execution.id}/events`,`agents/${f.agent.id}/events`];
   for(const path of reads){assert.equal((await f.http(path,'GET',undefined,{authorization:''})).status,401,path);
    assert.equal((await foreign.http(path)).status,404,path);}
   for(const [path,body,version] of [[`tasks/${t.id}/execute`,{},done.task.version],[`${prefix}/cancel`,{taskVersion:done.task.version},done.execution.version]]){
    assert.equal((await f.http(path,'POST',body,{'if-match':`"${version}"`,authorization:''})).status,401);
    assert.equal((await foreign.http(path,'POST',body,{'if-match':`"${version}"`})).status,404);
   }
   for(const suffix of ['', '/result'])assert.equal((await f.http(`tasks/${randomUUID()}/executions/${done.execution.id}${suffix}`)).status,404);
   assert.equal((await f.http(`tasks/${t.id}/execute`,'POST',{ignored:'x'.repeat(65536)},{'if-match':`"${done.task.version}"`})).status,413);
   assert.equal((await f.http(`tasks/${t.id}/executions?limit=1&limit=2`)).status,400);
   assert.equal((await f.http(`tasks/${t.id}/events?limit=101`)).status,400);
   assert.equal((await f.http(`${prefix}/result?provider=openai`)).status,400);
   const registered=await f.http('agents','POST',{name:'Not runtime allowlisted',type:'LLM',orchestratorId:f.route.id});assert.equal(registered.status,201);
   assert.equal((await f.http(`agents/${registered.data.id}/activate`,'POST',{}, {'if-match':`"${registered.data.version}"`})).status,200);
   const deniedTask=await f.http('tasks','POST',{agentId:registered.data.id,input:{instruction:'No runtime permission'}});assert.equal(deniedTask.status,201);
   assert.equal((await f.http(`tasks/${deniedTask.data.id}/execute`,'POST',{}, {'if-match':`"${deniedTask.data.version}"`})).status,403);
   assert.equal((await saved(deniedTask.data.id)).execution,undefined);assert.equal((await events(t.id)).length,7);assert.equal(f.calls(),1);
  }finally{await f.close();await foreign.close();}
 });

 test('T12 HTTP cancellation during an authorized tool reaches its child signal and prevents further model calls',async()=>{
  const entered=deferred(),release=deferred(),committed=deferred(),f=await fixture(async()=>proposal(),{grants:[CALC]});let running,toolSignal;
  try{
   const {ToolRegistry}=require('../dist/runtime/tools/tool-registry'),{CalculatorTool}=require('../dist/runtime/tools/calculator.tool');
   const calculator=new CalculatorTool(),registry=new ToolRegistry([{definition:calculator.definition,
    parseInput:value=>calculator.parseInput(value),parseOutput:value=>calculator.parseOutput(value),
    execute:async(input,context)=>{toolSignal=context.signal;entered.resolve();await release.promise;return calculator.execute(input,context);}}]);
   // Test-only cooperative delay, retaining real registry/schema/authorization/
   // claim/session/invocation boundaries. No production source or permission policy is changed.
   f.app().get(ToolExecutionService).registry=registry;
   const {RuntimePersistenceService}=require('../dist/runtime/runtime-persistence.service');
   const store=f.app().get(RuntimePersistenceService),finish=store.finish.bind(store);
   store.finish=async(...args)=>{const value=await finish(...args);committed.resolve(value);return value;};
   const t=await f.task(),client=new AbortController();running=f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`},{signal:client.signal});
   const disconnected=assert.rejects(running);await entered.promise;client.abort();await disconnected;
   const done=await committed.promise;assert.equal(toolSignal.aborted,true);assert.equal(done.task.status,'CANCELLED');assert.equal(done.execution.status,'CANCELLED');
   assert.equal(f.calls(),1);assert.equal(f.toolCalls(),0);assert.equal(await body(done.execution.id),undefined);
   assert.deepEqual((await events(t.id)).slice(-2).map(e=>e.event_type),['execution.cancelled','task.cancelled']);
  }finally{release.resolve();await running?.catch(()=>{});await f.close();}
 });

 test('T12 bounded local HTTP execution sample records latency, memory and query-plan observations without load thresholds',async()=>{
  const {performance}=require('node:perf_hooks'),f=await fixture();try{
   const before=process.memoryUsage(),times=[];let last;
   for(let i=0;i<5;i++){
    const t=await f.task(),started=performance.now(),r=await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`});
    times.push(performance.now()-started);assert.equal(r.status,200);assert.equal(r.data.execution.status,'SUCCEEDED');last=t;
   }
   const after=process.memoryUsage(),sorted=[...times].sort((a,b)=>a-b);
   const plan=(await getPool().query('EXPLAIN (FORMAT JSON) SELECT id,attempt_number FROM executions WHERE task_id=$1 AND owner_id=$2 ORDER BY attempt_number LIMIT 20',[last.id,f.owner.id])).rows[0]['QUERY PLAN'][0].Plan;
   console.log(JSON.stringify({t12Performance:{kind:'five-sequential-fake-provider-HTTP-executions',samples:times.map(n=>Number(n.toFixed(3))),
    minMs:Number(sorted[0].toFixed(3)),medianMs:Number(sorted[2].toFixed(3)),maxMs:Number(sorted[4].toFixed(3)),
    rssBeforeBytes:before.rss,rssAfterBytes:after.rss,heapUsedDeltaBytes:after.heapUsed-before.heapUsed,
    historyPlanNode:plan['Node Type'],historyEstimatedCost:plan['Total Cost'],providerRequests:f.calls()}}));
  }finally{await f.close();}
 });

 if(process.env.ELYQRETH_OLLAMA_RUNTIME_LIVE==='true')test('T12 live installed Ollama text completes through protected HTTP and survives application restart',{timeout:180000},async()=>{
  assert.notEqual(process.env.NODE_ENV,'production');assert.ok(process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL);
  const f=await fixture(undefined,{live:true});try{
   const t=await f.task('Reply briefly with READY. /no_think');
   const response=await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`,'x-request-id':'t12-live-ollama'});
   assert.equal(response.status,200);const done=response.data;assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');
   assert.match(done.result.output.text,/\bREADY\b/i);assert.equal(f.toolCalls(),0);assert.deepEqual(await body(done.execution.id),done.result);
   const before=await events(t.id);assert.equal(before.length,7);await f.restart();
   const result=await f.http(`tasks/${t.id}/executions/${done.execution.id}/result`);assert.deepEqual(result.data.result,done.result);assert.deepEqual(await events(t.id),before);
   assert.equal(f.logs.filter(([event])=>event==='provider.started').length,1);
   console.log(JSON.stringify({t12LiveOllama:{status:'PASS',transport:'actual-protected-HTTP',model:process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL,
    providerRequests:1,taskStatus:done.task.status,executionStatus:done.execution.status,resultPersisted:true,restartVerified:true,
    auditEvents:before.length,usage:done.result.usage,executionDurationMs:done.execution.durationMs}}));
  }finally{await f.close();}
 });

 // Separate opt-in local live probe: never enabled by standard CI. No downloads,
 // paid APIs or development database. The same owned PostgreSQL harness is used.
 if(process.env.ELYQRETH_OLLAMA_RUNTIME_LIVE==='true')test('T09 live installed Ollama tool model completes a real persisted calculator Task',{timeout:180000},async()=>{
  assert.notEqual(process.env.NODE_ENV,'production');assert.ok(process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL);
  const check=await fetch('http://127.0.0.1:11434/api/show',{method:'POST',signal:AbortSignal.timeout(3000),headers:{'content-type':'application/json'},
   body:JSON.stringify({model:process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL})});assert.equal(check.status,200);
  const metadata=await check.json();assert.ok(metadata.capabilities?.includes('tools'),'Installed model must declare tool support');
  const f=await fixture(undefined,{grants:[CALC],live:true});try{
   const t=await f.task('Calculate 125 multiplied by 48 using the calculator tool. /no_think'),done=await f.execute(t);
   if(done.task.status!=='COMPLETED'){
    const persisted=await saved(t.id),audit=await events(t.id);
    assert.equal(persisted.task.status,done.task.status);assert.equal(persisted.execution.status,done.execution.status);
    assert.equal(await body(done.execution.id),undefined);
    console.log(JSON.stringify({liveOllama:'FAIL',taskStatus:done.task.status,executionStatus:persisted.execution.status,
    resultPersisted:false,auditEvents:audit.length,terminalEvents:audit.slice(-2).map(e=>e.event_type),
    errorCode:done.error?.code,executionErrorCode:done.executionError?.code,toolInvocations:f.toolCalls(),
    providerCalls:f.logs.filter(([event])=>event==='provider.started').length,
    validation:f.logs.find(([event])=>event==='live.tool.validation')?.[1]}));
   }
   assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');assert.equal(f.toolCalls(),1);
   assert.match(done.result.output.text,/6[ ,]?000/);assert.equal(done.result.toolSummary.invocationCount,1);
   assert.deepEqual(await body(done.execution.id),done.result);assert.equal((await events(t.id)).length,7);
   console.log(JSON.stringify({liveOllama:'PASS',model:process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL,toolInvocations:f.toolCalls(),
    providerCalls:f.logs.filter(([event])=>event==='provider.started').length,taskStatus:done.task.status,executionStatus:done.execution.status,usage:done.result.usage}));
  }finally{await f.close();}
 });
 if(process.env.ELYQRETH_OLLAMA_RUNTIME_LIVE==='true')test('T09 live installed Ollama text-only model completes a separate persisted Task',{timeout:180000},async()=>{
  assert.notEqual(process.env.NODE_ENV,'production');assert.ok(process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL);
  const f=await fixture(undefined,{live:true});try{
   const t=await f.task('Reply with READY. /no_think'),done=await f.execute(t);
   if(done.task.status!=='COMPLETED')console.log(JSON.stringify({liveOllamaText:'FAIL',errorCode:done.error?.code}));
   assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');assert.equal(f.toolCalls(),0);
   assert.match(done.result.output.text,/\bREADY\b/i);assert.equal(done.result.toolSummary.invocationCount,0);
   assert.deepEqual(await body(done.execution.id),done.result);assert.equal((await events(t.id)).length,7);
   console.log(JSON.stringify({liveOllamaText:'PASS',model:process.env.ELYQRETH_OLLAMA_RUNTIME_MODEL,
    providerCalls:f.logs.filter(([event])=>event==='provider.started').length,taskStatus:done.task.status,executionStatus:done.execution.status,usage:done.result.usage}));
  }finally{await f.close();}
 });
};

