const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {fork}=require('node:child_process');
const {resolve}=require('node:path');
const {writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {ApiLogger}=require('../dist/common/api-logger');
const {AgentNpcBindingService}=require('../dist/city/binding.service');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {definition,deferred}=require('./runtime-fixtures.cjs');

// Opt-in extension of the owned, clean PostgreSQL harness. Browser receives only
// the city-read token; trusted setup/operator commands stay in this parent.
module.exports=({row,getUrl})=>{
 test('P3 T10 real browser traverses authorized API, coordinator, PostgreSQL and existing city', {timeout:180000},async()=>{
  const root=resolve(__dirname,'../../..'),{createServer}=await import('vite');
  const web=await createServer({configFile:resolve(root,'vite.config.js'),server:{host:'127.0.0.1',port:0}});
  let primary,secondary,child,port,stdout='',stderr='',commandError;
  const holds=new Map(),runs=[],logs=[],agents=[],bindings=[];
  const operator=randomBytes(32).toString('hex');let cityToken=randomBytes(32).toString('hex');const secrets=[operator,cityToken];
  const bounded=(promise,label,milliseconds=25000)=>{
   let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),milliseconds);})]).finally(()=>clearTimeout(timer));
  };
  try{
   await web.listen();const webOrigin=`http://127.0.0.1:${web.httpServer.address().port}`;
   const owner=await row("INSERT INTO owners(name) VALUES ('t10-browser-owned') RETURNING id");
   const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'t10-native','native','ENABLED') RETURNING id",[owner.id]);
   const env={NODE_ENV:'test',API_HOST:'127.0.0.1',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',CORS_ORIGINS:webOrigin,
    AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:operator,CITY_READ_ENABLED:'true',CITY_READ_TOKEN:cityToken};
   const open=async(listenPort=0)=>{
    const app=await createApplication(validateEnvironment(env));
    app.get(ApiLogger).info=(...args)=>logs.push(args);app.get(ApiLogger).error=(...args)=>logs.push(args);
    if(env.RUNTIME_ENABLED==='true'){
     const genuine=app.get(TextStatisticsStrategy);
     app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(request,context)=>{
      const hold=holds.get(request.ids.agentId);assert.ok(hold,'Only explicitly controlled test dispatches are permitted');hold.reached.resolve();
      let abort;try{await Promise.race([hold.release.promise,new Promise((_,reject)=>{abort=()=>reject(context.signal.reason);context.signal.addEventListener('abort',abort,{once:true});if(context.signal.aborted)abort();})]);}
      finally{context.signal.removeEventListener('abort',abort);}
      if(hold.mode==='failure')throw new RuntimeError('INTERNAL_RUNTIME_ERROR');
      return genuine.execute(request,context);
     }}}]);
    }
    await app.listen(listenPort,'127.0.0.1');return app;
   };
   const request=async(app,path,method='GET',body,version)=>{
    const response=await fetch(`${await app.getUrl()}${path}`,{method,headers:{authorization:`Bearer ${operator}`,'content-type':'application/json',...(version?{'if-match':`"${version}"`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
   };
   primary=await open();port=Number(new URL(await primary.getUrl()).port);
   for(let i=0;i<3;i++){
    const created=await request(primary,'/api/v1/agents','POST',{name:i===0?'<img src=x onerror=globalThis.__acceptanceXss=true>':`Acceptance ${i}`,type:'RULE_BASED',orchestratorId:route.id,configuration:{category:'general'}});
    assert.equal(created.status,201);const active=await request(primary,`/api/v1/agents/${created.data.id}/activate`,'POST',{},created.data.version);assert.equal(active.status,200);agents.push(active.data.id);
    const service=primary.get(AgentNpcBindingService),command={agentId:active.data.id,npcId:`resident-slot-00${i+1}`};
    const binding=await service.create(command);assert.equal((await service.create(command)).id,binding.id);bindings.push(binding.id);
   }
   await assert.rejects(primary.get(AgentNpcBindingService).create({agentId:agents[0],npcId:'resident-slot-004'}),e=>e.code==='CONFLICT');
   env.RUNTIME_ENABLED='true';env.RUNTIME_BINDINGS=JSON.stringify(agents.map((agentId,i)=>({agentId,orchestratorId:route.id,definition:definition(i===2?600:50000)})));
   await primary.close();primary=await open(port);secondary=await open();
   const make=async(index,app,mode='success')=>{
    const created=await request(app,'/api/v1/tasks','POST',{agentId:agents[index],input:{instruction:'acceptance-private-instruction two words',context:'acceptance-private-context'}});
    assert.equal(created.status,201);
    const queued=await app.get(RuntimeCoordinator).queueTask({taskId:created.data.id,taskVersion:created.data.version});
    const run={index,app,taskId:queued.task.id,executionId:queued.execution.id,taskVersion:queued.task.version,release:deferred(),reached:deferred(),mode};
    holds.set(agents[index],run);runs.push(run);return run;
   };
   const start=async(run)=>{
    run.pending=request(run.app,`/api/v1/tasks/${run.taskId}/execute`,'POST',{},run.taskVersion);
    await bounded(Promise.race([run.reached.promise,run.pending.then(result=>{throw Error(`Dispatch failed before barrier: HTTP ${result.status}`);})]),'Dispatch barrier not reached');
    return {executionId:run.executionId};
   };
   const finish=async(run,status)=>{run.release.resolve();const result=await bounded(run.pending,'Execution did not settle');assert.equal(result.status,status);return result;};
   let a,b,f,c,recovery;
   const handlers={
    configuration:async()=>({apiOrigin:await primary.getUrl(),cityToken,agents,bindings}),
    queueA:async()=>{a=await make(0,primary);return {executionId:a.executionId};},
    startA:()=>start(a),startB:async()=>{b=await make(1,secondary);return start(b);},
    cancelB:async()=>{
     let cancelled;
     for(let attempt=0;attempt<3;attempt++){
      const v=await row('SELECT t.version AS tv,e.version AS ev FROM tasks t JOIN executions e ON e.task_id=t.id WHERE e.id=$1',[b.executionId]);
      cancelled=await request(secondary,`/api/v1/tasks/${b.taskId}/executions/${b.executionId}/cancel`,'POST',{taskVersion:v.tv},v.ev);
      if(cancelled.status!==409)break;
     }
     assert.equal(cancelled.status,200);await finish(b,409);return {status:'CANCELLED'};
    },
    completeA:()=>finish(a,200),
    startFailureA:async()=>{f=await make(0,primary,'failure');return start(f);},failA:()=>finish(f,500),
    timeoutC:async()=>{c=await make(2,primary);await start(c);const result=await bounded(c.pending,'Deadline failed to settle');assert.equal(result.status,504);return {status:'TIMED_OUT'};},
    startRecoveryA:async()=>{recovery=await make(0,primary);return start(recovery);},completeRecoveryA:()=>finish(recovery,200),
    restart:async()=>{await primary.close();primary=await open(port);return {restarted:true};},
    rotateCredential:async()=>{cityToken=randomBytes(32).toString('hex');secrets.push(cityToken);env.CITY_READ_TOKEN=cityToken;await primary.close();primary=await open(port);return {rotated:true};},
    removeA:async()=>{const service=primary.get(AgentNpcBindingService),binding=await service.byAgent(agents[0]);assert.equal(binding.id,bindings[0]);await service.remove({bindingId:binding.id,revision:binding.revision});return {removed:true};},
    verify:async()=>{
     const expected=['SUCCEEDED','CANCELLED','FAILED','TIMED_OUT','SUCCEEDED'];
     for(let i=0;i<runs.length;i++){
      const saved=await row('SELECT e.status,t.status AS task_status FROM executions e JOIN tasks t ON t.id=e.task_id WHERE e.id=$1',[runs[i].executionId]);
      assert.equal(saved.status,expected[i]);assert.equal(saved.task_status,expected[i]==='SUCCEEDED'?'COMPLETED':expected[i]==='CANCELLED'?'CANCELLED':'FAILED');
      const events=await request(primary,`/api/v1/tasks/${runs[i].taskId}/events`);assert.equal(events.status,200);
      const terminal=events.data.items.filter(e=>/^execution\.(completed|failed|cancelled|timed_out)$/.test(e.eventType));assert.equal(terminal.length,1);
      assert.equal(new Set(events.data.items.map(e=>e.eventId)).size,events.data.items.length);
     }
     const result=await request(primary,`/api/v1/tasks/${a.taskId}/executions/${a.executionId}/result`);assert.equal(result.status,200);
     const saved=await row('SELECT body FROM execution_results WHERE execution_id=$1',[a.executionId]);assert.equal(saved.body.output.type,'text.statistics.v1');assert.equal(saved.body.output.data.wordCount,3);
     assert.equal((await row('SELECT count(*)::int AS n FROM agents WHERE owner_id=$1',[owner.id])).n,3);
     assert.equal(await primary.get(AgentNpcBindingService).byAgent(agents[0]),null);
     assert.equal((await primary.get(AgentNpcBindingService).byAgent(agents[1])).id,bindings[1]);
     return {ruleResultPersisted:true,terminalEventsUnique:true,agentsPreserved:true,bindingRemoved:true,executions:runs.length};
    }
   };
   child=fork(resolve(root,'scripts/browser-smoke.mjs'),[],{cwd:root,execArgv:[],env:{...process.env,ELYQRETH_CITY_E2E_BROWSER:'true',BROWSER_BASE_URL:webOrigin},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
   child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
   child.on('message',async message=>{
    if(message?.kind!=='city-acceptance-command')return;
    try{assert.ok(Object.hasOwn(handlers,message.name));const result=await handlers[message.name]();if(child.connected)child.send({kind:'city-acceptance-result',id:message.id,result});}
    catch(error){commandError=error;if(child.connected)child.send({kind:'city-acceptance-result',id:message.id,error:true});}
   });
   const code=await bounded(new Promise((yes,no)=>{child.once('error',no);child.once('exit',yes);}), 'Owned browser did not finish',120000);
   if(commandError)throw commandError;
   for(const secret of [...secrets,'acceptance-private-instruction','acceptance-private-context'])assert.ok(!(stdout+stderr+JSON.stringify(logs)).includes(secret),'Protected test data leaked');
   assert.equal(code,0,stderr);const report=JSON.parse(stdout.slice(stdout.indexOf('{')));assert.equal(report.cityAcceptance.status,'PASS');
   writeFileSync(resolve(tmpdir(),'elyqreth-p3-t10-browser-evidence.json'),JSON.stringify(report,null,2)+'\n');
   console.log(JSON.stringify({status:report.status,browser:report.browser,cityAcceptance:report.cityAcceptance}));
  }finally{
   for(const run of runs)run.release.resolve();
   await Promise.allSettled(runs.filter(run=>run.pending).map(run=>run.pending));
   if(child&&child.exitCode===null)child.kill();await secondary?.close();await primary?.close();await web.close();
  }
 });
};
