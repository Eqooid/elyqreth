const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),os=require('node:os');
const {createApplication}=require('../dist/application'),{validateEnvironment}=require('../dist/config/configuration');
const {DatabaseService}=require('../dist/database/database.module'),{ApiLogger}=require('../dist/common/api-logger');
const {provisionDatabase}=require('../dist/database/provision');
const {migrateDatabase}=require('../dist/database/migrate');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority'),{ExternalIngestionService}=require('../dist/external-orchestrators/external-ingestion.service');
const {definition}=require('./runtime-fixtures.cjs'),{boundedStage}=require('./capacity-tools.cjs');
module.exports=({row,getUrl,getPool,container,runId})=>{
 test('T14 bounded isolated API native collaboration ingestion and pool capacity',{timeout:120000},async()=>{
 const run=promisify(execFile),docker=async(...args)=>(await run('docker',args,{timeout:15000,maxBuffer:1024*1024})).stdout.trim();
 const state=JSON.parse(await docker('inspect',container))[0];assert.equal(state.Config.Labels['elyqreth.test.run'],runId);assert.match(container,/^elyqreth_t03_test_[a-f0-9]{24}$/);
 await docker('update','--cpus','1','--memory','512m','--memory-swap','1g','--pids-limit','128',container);
 const report={status:'RUNNING',environment:'T13_DISPOSABLE_DATABASE_HARNESS',startedAt:new Date().toISOString(),hardware:{platform:os.platform(),architecture:os.arch(),hostCpuModel:os.cpus()[0].model,hostLogicalCpus:os.cpus().length,hostMemoryBytes:os.totalmem()},limits:{postgresCpu:1,postgresMemoryBytes:512*1024*1024,pids:128,apiPool:3,maxConcurrency:8,maxOperationsPerStage:64,stageDeadlineMs:20000,nodeRssStopBytes:768*1024*1024},stages:[],scope:'Host API and closed-loop generator share one Node process; not production-edge throughput, steady-state capacity or whole-host CPU. PostgreSQL is a limited disposable container. No broker/cache/worker exists.'};
 let app;const beginSize=(await row('SELECT pg_database_size(current_database())::text bytes')).bytes;
 try{
 const owner=await row("INSERT INTO owners(name) VALUES ('t14-synthetic') RETURNING id"),route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'t14-native','native','ENABLED') RETURNING id",[owner.id]);
 const agents=[];for(let n=0;n<3;n++)agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,$3,'RULE_BASED','ACTIVE') RETURNING id",[owner.id,route.id,'Capacity '+n]));
 const external=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'t14-external','langgraph.v1','ENABLED') RETURNING id",[owner.id]),externalAgent=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'External','EXTERNAL','DISABLED') RETURNING id",[owner.id,external.id]);
 const original=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable'}).database,roleSuffix=randomBytes(8).toString('hex'),runtimeRole='r_'+roleSuffix,migrationRole='m_'+roleSuffix,runtimePassword=randomBytes(24).toString('hex'),migrationPassword=randomBytes(24).toString('hex');
 await provisionDatabase(original,{expectedDatabase:original.database,runtimeRole,migrationRole,runtimePassword,migrationPassword,adoptExistingSchema:true});
 await migrateDatabase({...original,user:migrationRole,password:migrationPassword});
 const runtimeUrl=new URL(getUrl());runtimeUrl.username=runtimeRole;runtimeUrl.password=runtimePassword;
 const token=randomBytes(32).toString('hex'),readToken=randomBytes(32).toString('hex');
 const profile={id:external.id,ownerId:owner.id,adapterType:'langgraph.v1',name:'Synthetic',namespace:'capacity',generation:1,mode:'OBSERVATION_ONLY',enabled:true,endpoint:{origin:'http://127.0.0.1:20240',network:'local',allowedAddresses:['127.0.0.1']},capabilities:['health','events.poll']};
 app=await createApplication(validateEnvironment({NODE_ENV:'test',DATABASE_URL:runtimeUrl.href,DATABASE_SSL_MODE:'disable',DATABASE_POOL_MAX:'3',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,COLLABORATION_READ_ENABLED:'true',COLLABORATION_READ_TOKEN:readToken,RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:JSON.stringify(agents.map(a=>({agentId:a.id,orchestratorId:route.id,definition:definition()}))),EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([profile])}));
 app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};await app.listen(0,'127.0.0.1');const origin=await app.getUrl();assert.equal(new URL(origin).hostname,'127.0.0.1');
 const db=app.get(DatabaseService),sample=()=>db.diagnostics();
 async function http(path,body,version){const response=await fetch(origin+'/api/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json',...(version?{'if-match':'"'+version+'"'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});return {status:response.status,data:await response.json()};}
 async function command(path,body,version){const r=await http(path,body,version);assert.ok([200,201].includes(r.status),'Synthetic setup failed');return r.data;}
 const stage=async(name,count,concurrency,operation,allowed)=>{const result=await boundedStage({name,count,concurrency,operation,allowed,sample});report.stages.push(result);assert.equal(result.status,'PASS',name);return result;};
 const pgStats=async()=>{const v=JSON.parse(await docker('stats','--no-stream','--format','{{json .}}',container));return {cpuPercent:v.CPUPerc,memory:v.MemUsage,pids:v.PIDs,scope:'One Docker statistics interval, not a sampled peak'};};
 report.postgresBefore=await pgStats();
 for(const concurrency of [1,4,8])await stage('agent-reads-c'+concurrency,32,concurrency,async()=> (await http('agents?limit=10')).status);
 const tasks=[];for(const concurrency of [1,4,8])await stage('task-submit-c'+concurrency,16,concurrency,async()=>{const r=await http('tasks',{agentId:agents[0].id,input:{instruction:'Bounded capacity fixture'},idempotencyKey:randomUUID()});if(r.status===201)tasks.push(r.data);return r.status;},[201]);
 const executed=[];for(const concurrency of [1,2,4])await stage('native-dispatch-c'+concurrency,8,concurrency,async i=>{const task=tasks.shift();const r=await http('tasks/'+task.id+'/execute',{},task.version);if(r.status===200){assert.equal(r.data.execution.status,'SUCCEEDED');executed.push(r.data);}else assert.equal(r.data.code,'CAPACITY_EXCEEDED');return r.status;},[200,409]);
 assert.ok(executed.length>0);await stage('execution-poll-c8',32,8,async()=>{const work=executed[0];return (await http(`tasks/${work.task.id}/executions/${work.execution.id}`)).status;});
 const sessions=[];for(let n=0;n<4;n++){
 const t=await command('tasks',{agentId:agents[0].id,input:{instruction:'Capacity parent'},idempotencyKey:randomUUID()}),parent=await command('tasks/'+t.id+'/execute',{},t.version);
 const s=await command('collaborations',{rootTaskId:t.id,participantAgentIds:[agents[0].id,agents[1+n%2].id],idempotencyKey:randomUUID()}),d=await command(`collaborations/${s.id}/delegations`,{sourceAgentId:agents[0].id,targetAgentId:agents[1+n%2].id,parentTaskId:t.id,sourceExecutionId:parent.execution.id,idempotencyKey:randomUUID()}),body={instruction:'Capacity child',idempotencyKey:randomUUID()};
 await stage('delegation-duplicate-burst-'+n,4,4,async()=> (await http(`collaborations/${s.id}/delegations/${d.id}/activate`,body)).status,[200,202]);
 const done=await command(`collaborations/${s.id}/delegations/${d.id}/activate`,body);assert.equal(done.delegation.status,'COMPLETED');assert.equal((await row('SELECT count(*)::int n FROM executions WHERE task_id=$1',[done.childTask.id])).n,1);sessions.push(s);
 }
 report.collaborationShape={parents:4,participantsPerSession:2,fanoutPerParent:1,duplicateActivationConcurrency:4,duplicateEffectiveChildren:0};
 for(const concurrency of [1,4,8])await stage('collaboration-snapshot-c'+concurrency,32,concurrency,async i=>(await http(`collaboration-activity/${sessions[i%4].id}/snapshot`)).status);
 const authority=app.get(IngestionAuthority),ingestion=app.get(ExternalIngestionService),op=authority.authorize(token,external.id,randomUUID(),'operator','capacity-domain'),source=authority.authorize(token,external.id,randomUUID(),'ingestion','capacity-domain');
 await ingestion.mapAgent(op,{externalId:'synthetic-agent',internalAgentId:externalAgent.id});await ingestion.mapExecution(op,{externalId:'synthetic-run',externalAgentId:'synthetic-agent'});
 let sequence=0,last;const event=()=>({connectionId:external.id,namespace:'capacity',generation:1,eventId:randomUUID(),kind:'execution.observed',externalAgentId:'synthetic-agent',externalExecutionId:'synthetic-run',sourceStatus:'RUNNING',receivedAt:new Date().toISOString(),sequence:{domain:'capacity-domain',value:String(++sequence)}});
 for(const concurrency of [1,4,8])await stage('ingestion-service-c'+concurrency,16,concurrency,async()=>{last=event();await ingestion.ingest(source,last);return 200;});
 await stage('ingestion-identical-replay-c8',16,8,async()=>{await ingestion.ingest(source,last);return 200;});assert.equal((await row('SELECT count(*)::int n FROM external_event_inbox WHERE event_id=$1',[last.eventId])).n,1);
 const held=await Promise.all(Array.from({length:3},()=>db.pool.connect()));let released=false;const releaseHeld=()=>{if(!released){released=true;held.forEach(c=>c.release());}};const release=setTimeout(releaseHeld,200);
 try{const contention=await stage('controlled-pool-saturation',24,8,async()=> (await http('agents?limit=10')).status);assert.ok(contention.maxPoolWaiting>0);}finally{clearTimeout(release);releaseHeld();}
 await stage('after-load-recovery',8,1,async()=> (await http('agents?limit=10')).status);assert.equal(db.diagnostics().waiting,0);
 assert.equal((await row("SELECT count(*)::int n FROM executions WHERE owner_id=$1 AND status='RUNNING'",[owner.id])).n,0);assert.equal((await row('SELECT count(*)::int n FROM (SELECT task_id FROM executions WHERE owner_id=$1 GROUP BY task_id HAVING count(*)>1) x',[owner.id])).n,0);
 report.postgresAfter=await pgStats();report.databaseGrowth={beforeBytes:Number(beginSize),afterBytes:Number((await row('SELECT pg_database_size(current_database())::text bytes')).bytes),scope:'Whole synthetic database physical size; not a per-user growth forecast'};report.runtimePool=db.diagnostics();report.status='PASS';
 }finally{await app?.close();report.finishedAt=new Date().toISOString();console.log('CAPACITY_EVIDENCE '+JSON.stringify(report));}
 });
};
