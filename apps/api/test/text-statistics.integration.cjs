'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {join}=require('node:path');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TaskLifecycleService}=require('../dist/lifecycle/task-lifecycle.service');
const {ApiLogger}=require('../dist/common/api-logger');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {definition}=require('./runtime-fixtures.cjs');
const executeFile=promisify(execFile);
module.exports=({row,getUrl,getPool})=>{
 async function fixture(){
  const owner=await row("INSERT INTO owners(name) VALUES ('t04-owned-test-scope') RETURNING id");
  const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native-test','native','ENABLED') RETURNING id",[owner.id]);
  const token=randomBytes(32).toString('hex'),logs=[];
  const env={NODE_ENV:'development',API_HOST:'127.0.0.1',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',
   AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,RUNTIME_ENABLED:'false'};
  let app,config;
  const open=async()=>{const a=await createApplication(config);a.get(ApiLogger).info=(...v)=>logs.push(v);a.get(ApiLogger).error=(...v)=>logs.push(v);await a.listen(0,'127.0.0.1');return a;};
  config=validateEnvironment(env);app=await open();
  const http=async(path,method='GET',body,headers={})=>{
   const response=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json()};
  };
  const registered=await http('agents','POST',{name:'Real deterministic analyzer',type:'RULE_BASED',orchestratorId:route.id,configuration:{category:'general'}});
  assert.equal(registered.status,201);assert.equal(registered.data.lifecycleStatus,'DISABLED');
  const activated=await http(`agents/${registered.data.id}/activate`,'POST',{}, {'if-match':`"${registered.data.version}"`});
  assert.equal(activated.status,200);const agent=activated.data;
  env.RUNTIME_ENABLED='true';env.RUNTIME_BINDINGS=JSON.stringify([{agentId:agent.id,orchestratorId:route.id,definition:definition()}]);
  await app.close();config=validateEnvironment(env);app=await open();
  return {owner,route,agent,env,http,logs,app:()=>app,open,async restart(){await app.close();app=await open();},close:()=>app.close(),
   async task(instruction='Welcome to Elyqreth AI City'){const r=await http('tasks','POST',{agentId:agent.id,input:{instruction,context:'Ignored private context marker'}});assert.equal(r.status,201);return r.data;},
   async cli(args){
    const inspection=args.includes('--inspect');
    if(!inspection)assert.ok(process.env.npm_execpath,'npm command is part of the acceptance workflow');
    const command=inspection?[join(__dirname,'../dist/runtime/local-command.js'),...args]:[process.env.npm_execpath,'run','runtime:execute','--',...args];
    const out=await executeFile(process.execPath,command,{cwd:join(__dirname,'../../..'),env:{...process.env,...env},timeout:30000,maxBuffer:65536});
    assert.equal(out.stderr,'');return {out,data:JSON.parse(out.stdout.trim().split(/\r?\n/).at(-1))};}
  };
 }
 const saved=async id=>({task:await row('SELECT * FROM tasks WHERE id=$1',[id]),execution:await row('SELECT * FROM executions WHERE task_id=$1 ORDER BY attempt_number DESC LIMIT 1',[id])});
 const events=async id=>(await getPool().query('SELECT * FROM agent_events WHERE task_id=$1 ORDER BY stream_position',[id])).rows;

 test('T04 genuine DI strategy: HTTP register/activate/task, actual local CLI, persisted result/history and restart inspection',async()=>{
  const f=await fixture();try{
   assert.ok(f.app().get(TextStatisticsStrategy) instanceof TextStatisticsStrategy);
   assert.ok(f.app().get(ProviderSelectionService));
   assert.throws(()=>f.app().get(LlmProviderRegistry).resolve('not.installed'),e=>e.code==='PROVIDER_UNAVAILABLE');
   assert.equal(f.app().get(StrategyRegistry).resolve(definition()).type,'RULE_BASED');
   assert.throws(()=>f.app().get(StrategyRegistry).register('text.stats.v1',f.app().get(TextStatisticsStrategy)),e=>e.code==='CONFIGURATION_ERROR');
   const task=await f.task();assert.equal((await saved(task.id)).execution,undefined);
   const {data:done,out}=await f.cli(['--task-id',task.id,'--task-version',String(task.version)]);
   assert.equal(done.kind,'finished');assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');
   assert.deepEqual(done.result.output,{type:'text.statistics.v1',data:{codePointCount:27,wordCount:5,nonemptyLineCount:1}});
   const state=await saved(task.id);assert.equal(state.task.status,'COMPLETED');
   assert.equal(state.execution.result_reference,done.resultReference);assert.equal(state.execution.attempt_number,1);
   assert.ok(state.execution.started_at instanceof Date);
   assert.ok(state.execution.started_at>=state.execution.created_at);
   assert.ok(state.execution.finished_at>=state.execution.started_at);
   assert.equal(state.execution.finished_at.toISOString(),state.task.completed_at.toISOString());
   assert.deepEqual((await row('SELECT body FROM execution_results WHERE execution_id=$1',[state.execution.id])).body,done.result);
   const history=await events(task.id);assert.deepEqual(history.map(e=>e.event_type),['task.created','execution.created','task.queued','execution.started','task.started','execution.completed','task.completed']);
   assert.equal(new Set(history.slice(1).map(e=>e.correlation_id)).size,1);
   assert.equal((await f.http(`tasks/${task.id}/executions`)).data.items[0].status,'SUCCEEDED');
   assert.equal((await f.http(`tasks/${task.id}/events`)).data.items.length,7);
   // T11 adds a guarded execute route; an absent If-Match remains invalid, never a runnable command.
      assert.equal((await f.http(`tasks/${task.id}/execute`,'POST',{})).status,400);
      assert.equal((await f.http('runtime/execute','POST',{})).status,404);
   await f.restart();const inspection=(await f.cli(['--inspect','--task-id',task.id])).data;
   assert.equal(inspection.taskStatus,'COMPLETED');assert.deepEqual(inspection.result,done.result);
   assert.deepEqual(await events(task.id),history);
   const exposed=JSON.stringify({out,logs:f.logs,history,inspection});
   for(const secret of [f.env.AGENT_REGISTRY_TOKEN,'Welcome to Elyqreth AI City','Ignored private context marker','leaseToken'])assert.ok(!exposed.includes(secret));
   await assert.rejects(f.app().get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:done.task.version}),e=>e.code==='ACCESS_DENIED');
  }finally{await f.close();}
 });
 test('T04 invalid input/strategy fields are rejected before persistence; disabled Agent and missing strategy never allocate',async()=>{
  const f=await fixture();try{
   for(const input of [{},{text:'wrong contract'},{instruction:''},{instruction:' \n '},{instruction:3},{instruction:'x'.repeat(16001)},
    {instruction:'a',strategyId:'text.stats.v1'},{instruction:'api_key=private'},{instruction:'a',extra:true}])
    assert.equal((await f.http('tasks','POST',{agentId:f.agent.id,input})).status,400);
   assert.equal((await row('SELECT count(*)::int AS n FROM tasks WHERE agent_id=$1',[f.agent.id])).n,0);
   const task=await f.task();f.app().get(RuntimeCoordinator).strategies=new StrategyRegistry([]);
   await assert.rejects(f.app().get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:task.version}),e=>e.code==='STRATEGY_NOT_FOUND');
   assert.equal((await saved(task.id)).execution,undefined);
   await f.restart();assert.equal((await f.http(`agents/${f.agent.id}/disable`,'POST',{}, {'if-match':`"${f.agent.version}"`})).status,200);
   await assert.rejects(f.app().get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:task.version}),e=>e.code==='ACCESS_DENIED');
   assert.equal((await saved(task.id)).task.status,'CREATED');assert.equal((await saved(task.id)).execution,undefined);
  }finally{await f.close();}
 });
 test('T04 genuine strategy concurrent claims and pending cancellation preserve one committed terminal outcome',async()=>{
  const f=await fixture();let other;try{
   const task=await f.task();other=await f.open();
   const outcomes=await Promise.allSettled([f.app(),other].map(a=>a.get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:task.version})));
   assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal((await saved(task.id)).execution.status,'SUCCEEDED');
   assert.equal((await events(task.id)).filter(e=>e.event_type==='execution.started').length,1);
   const next=await f.task(),queue=await f.app().get(RuntimeCoordinator).queueTask({taskId:next.id,taskVersion:next.version});
   const races=await Promise.allSettled([f.app().get(RuntimeCoordinator).executeTask({taskId:next.id,taskVersion:queue.task.version}),
    other.get(TaskLifecycleService).cancelTask(next.id,{taskVersion:queue.task.version,executionId:queue.execution.id,executionVersion:queue.execution.version})]);
   assert.ok(races.some(x=>x.status==='fulfilled'));const final=await saved(next.id);
   assert.ok(['COMPLETED','CANCELLED'].includes(final.task.status));
   assert.equal(final.execution.status,final.task.status==='COMPLETED'?'SUCCEEDED':'CANCELLED');
   assert.equal((await events(next.id)).filter(e=>['task.completed','task.cancelled'].includes(e.event_type)).length,1);
   assert.equal((await row('SELECT count(*)::int AS n FROM execution_results WHERE execution_id=$1',[final.execution.id])).n,final.task.status==='COMPLETED'?1:0);
  }finally{await other?.close();await f.close();}
 });
 test('T04 actual result insertion fault rolls back success and safely records the failed pair without input leakage',async()=>{
  const f=await fixture();let trigger=false;try{
   const task=await f.task();
   await getPool().query(`CREATE FUNCTION t04_result_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid THEN RAISE EXCEPTION 'private fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER t04_result_fault BEFORE INSERT ON execution_results FOR EACH ROW EXECUTE FUNCTION t04_result_fault()');trigger=true;
   const done=await f.app().get(RuntimeCoordinator).executeTask({taskId:task.id,taskVersion:task.version});
   assert.equal(done.kind,'finished');assert.equal(done.error.code,'PERSISTENCE_UNAVAILABLE');
   const final=await saved(task.id);assert.equal(final.task.status,'FAILED');assert.equal(final.execution.status,'FAILED');
   assert.equal((await row('SELECT count(*)::int AS n FROM execution_results WHERE execution_id=$1',[final.execution.id])).n,0);
   assert.deepEqual((await events(task.id)).slice(-2).map(e=>e.event_type),['execution.failed','task.failed']);
   assert.ok(!JSON.stringify(done).includes('private fault'));
  }finally{if(trigger)await getPool().query('DROP TRIGGER t04_result_fault ON execution_results');await getPool().query('DROP FUNCTION IF EXISTS t04_result_fault()');await f.close();}
 });
 test('T11 HTTP executes the genuine rule-based strategy without provider configuration and serves its persisted result',async()=>{
  const f=await fixture();try{
   const t=await f.task(),response=await f.http(`tasks/${t.id}/execute`,'POST',{}, {'if-match':`"${t.version}"`});
   assert.equal(response.status,200);const done=response.data;
   assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution.status,'SUCCEEDED');
   assert.deepEqual(done.result.output.data,{codePointCount:27,wordCount:5,nonemptyLineCount:1});
   const result=await f.http(`tasks/${t.id}/executions/${done.execution.id}/result`);
   assert.equal(result.status,200);assert.equal(result.data.availability,'AVAILABLE');assert.deepEqual(result.data.result,done.result);
   assert.equal((await events(t.id)).length,7);
  }finally{await f.close();}
 });
};


