require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{createServer}=require('node:http');
const recorded=require('./fixtures/hermes-0.21.2-connectivity.json');
const {HermesAdapter,HERMES_CAPABILITIES}=require('../dist/external-orchestrators/hermes.adapter');
const {AdapterRegistry}=require('../dist/external-orchestrators/adapter-registry');
const {ExternalAdapterService}=require('../dist/external-orchestrators/external-adapter.service');
const {ExternalHttpTransport}=require('../dist/external-orchestrators/external-http.transport');
const {connection,ExternalCredentials}=require('../dist/external-orchestrators/external-configuration');
const match=code=>e=>e.code===code;
async function fixture(handler,registeredAgents){
 const calls=[],logs=[],secret='synthetic-hermes-connectivity-key';
 const server=createServer((req,res)=>{calls.push({path:req.url,method:req.method,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');
  if(handler)return handler(req,res);res.end(JSON.stringify(req.url==='/health'?recorded.health:recorded.capabilities));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const c=connection({id:randomUUID(),ownerId:randomUUID(),adapterType:'hermes.v1',name:'Hermes connectivity test',namespace:'installation-a',generation:1,enabled:true,
  mode:'OBSERVATION_ONLY',credentialRef:'EXTERNAL_SECRET_HERMES_TEST',endpoint:{origin:`http://127.0.0.1:${server.address().port}`,network:'local',allowedAddresses:['127.0.0.1']},capabilities:HERMES_CAPABILITIES,...(registeredAgents?{registeredAgents}:{})});
 const config={externalOrchestrators:{connections:[c],credentials:new ExternalCredentials(new Map([[c.credentialRef,secret]]))}};
 const service=new ExternalAdapterService({value:config},new AdapterRegistry([new HermesAdapter()]),new ExternalHttpTransport(async()=>{throw Error('Unexpected DNS');}),{info:(...v)=>logs.push(v)});
 service.onModuleInit();return {c,calls,logs,secret,config,service,access:{ownerId:c.ownerId,correlationId:randomUUID(),operations:['health','agents','status','events.poll','dispatch']},
  close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
test('Hermes source-derived connectivity fixture uses authenticated GETs and exposes no model identity or credentials',async()=>{
 const f=await fixture();try{const health=await f.service.health(f.access,f.c.id);assert.equal(health.state,'HEALTHY');
 assert.deepEqual(f.calls.map(c=>[c.method,c.path]),[['GET','/health'],['GET','/v1/capabilities'],['GET','/health']]);
 assert.ok(f.calls.every(c=>c.authorization==='Bearer '+f.secret));assert.ok(!JSON.stringify([health,f.logs,f.config]).includes(f.secret));
 assert.equal(health.connectionId,f.c.id);assert.equal(health.namespace,f.c.namespace);assert.equal(health.generation,1);
 assert.ok(!new HermesAdapter().capabilities.includes('dispatch'));}finally{await f.close();}
});
test('Hermes configuration rejects commands unsupported capabilities and missing credentials even on loopback',async()=>{
 const f=await fixture();try{const a=new HermesAdapter();for(const patch of [{mode:'CONTROLLED_DISPATCH'},{credentialRef:undefined},{adapterType:'langgraph.v1'},{capabilities:['health','dispatch']},{capabilities:['health','events.subscribe']}])
 assert.throws(()=>a.validateConfiguration({...f.c,...patch}),match('INVALID_CONFIGURATION'));
 f.config.externalOrchestrators.credentials=new ExternalCredentials(new Map());await assert.rejects(f.service.describe(f.access,f.c.id),match('INVALID_CONFIGURATION'));assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('Hermes does not advertise registry execution or event compatibility from remote feature flags',async()=>{
 const f=await fixture();try{assert.deepEqual((await f.service.describe(f.access,f.c.id)).capabilities,['health']);
 for(const run of [()=>f.service.agents(f.access,f.c.id,{limit:1}),()=>f.service.execution(f.access,f.c.id,'run_not_an_agent'),()=>f.service.events(f.access,f.c.id,{limit:1})])
 await assert.rejects(run(),match('UNSUPPORTED_CAPABILITY'));
 assert.ok(f.calls.every(c=>['/health','/v1/capabilities'].includes(c.path)));}finally{await f.close();}
});
test('Hermes source version and platform drift fail closed before capability negotiation',async()=>{
 for(const health of [{...recorded.health,version:'0.21.3'},{...recorded.health,version:undefined},{...recorded.health,platform:'another-agent'},{...recorded.health,status:'degraded'},null,[]]){
 const f=await fixture((_q,r)=>r.end(JSON.stringify(health)));try{const h=await f.service.health(f.access,f.c.id);assert.equal(h.state,'UNAVAILABLE');assert.equal(h.errorCode,'INVALID_PROVIDER_RESPONSE');assert.equal(f.calls.length,1);}finally{await f.close();}}
});
test('Hermes rejects unauthenticated or malformed capability declarations',async()=>{
 for(const caps of [{...recorded.capabilities,auth:{type:'bearer',required:false}},{...recorded.capabilities,auth:{type:'none',required:true}},{...recorded.capabilities,object:'other'},null,[]]){
 const f=await fixture((q,r)=>r.end(JSON.stringify(q.url==='/health'?recorded.health:caps)));try{const h=await f.service.health(f.access,f.c.id);assert.equal(h.state,'UNAVAILABLE');assert.equal(h.errorCode,'INVALID_PROVIDER_RESPONSE');assert.equal(f.calls.length,2);}finally{await f.close();}}
});
test('Hermes auth failure rate limits redirects malformed and oversized responses have safe codes and no retries',async()=>{
 for(const [status,body,code] of [[401,'private-body','AUTHENTICATION_FAILED'],[403,'private-body','AUTHORIZATION_FAILED'],[429,'{}','RATE_LIMITED'],[503,'{}','TRANSIENT_FAILURE'],[302,'{}','INVALID_CONFIGURATION'],[200,'invalid','INVALID_PROVIDER_RESPONSE'],[200,'x'.repeat(65537),'RESPONSE_LIMIT']]){
 const f=await fixture((_q,r)=>{r.statusCode=status;r.setHeader('Location','http://127.0.0.1/private');r.end(body);});try{const h=await f.service.health(f.access,f.c.id);assert.equal(h.state,'UNAVAILABLE');assert.equal(h.errorCode,code);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify([h,f.logs]).includes('private-body'));}finally{await f.close();}}
});
test('Hermes owner and capability authorization fail before networking and disabled profiles remain disconnected',async()=>{
 const f=await fixture();try{await assert.rejects(f.service.health({...f.access,ownerId:randomUUID()},f.c.id),match('NOT_FOUND'));
 await assert.rejects(f.service.health({...f.access,operations:[]},f.c.id),match('ACCESS_DENIED'));
 f.config.externalOrchestrators.connections=[{...f.c,enabled:false}];assert.equal((await f.service.health(f.access,f.c.id)).state,'DISABLED');assert.equal(f.calls.length,0);}finally{await f.close();}
});
test('Hermes interrupted connectivity has no automatic retry or agent lifecycle side effects',async()=>{
 const f=await fixture((_q,_r)=>{});try{const h=await f.service.health(f.access,f.c.id,AbortSignal.timeout(30));assert.equal(h.state,'UNAVAILABLE');assert.equal(h.errorCode,'ABORTED');assert.equal(f.calls.length,1);}finally{await f.close();}
});
test('Hermes adapter is registered through the actual application without startup provider traffic',async()=>{
 const {createApplication}=require('../dist/application'),{validateEnvironment}=require('../dist/config/configuration');
 const app=await createApplication(validateEnvironment({NODE_ENV:'test'}));try{await app.init();assert.deepEqual(app.get(AdapterRegistry).resolve('hermes.v1').capabilities,HERMES_CAPABILITIES);}finally{await app.close();}
});
test('Hermes CLI accepts exactly a connection UUID and no URLs credentials or remote commands',()=>{
 const {hermesConnectionArgument}=require('../dist/external-orchestrators/hermes-command');const id=randomUUID();
 assert.equal(hermesConnectionArgument([id]),id);
 for(const args of [[],[id,'run_123'],['https://hermes.example'],['--token'],['dispatch',id]])assert.throws(()=>hermesConnectionArgument(args),match('INVALID_INPUT'));
});
const runId='run_'+'a'.repeat(32),internalAgentId=randomUUID();
const registration={externalId:'configured-researcher',name:'Research Hermes',internalAgentId,npcId:'resident-slot-001',executionIds:[runId]};
test('Hermes explicitly configured identity survives model/display changes and only listed runs are read',async()=>{
 const providerRun={object:'hermes.run',run_id:runId,status:'running',updated_at:1794099600,output:'private-output',input:'private-prompt'};
 const f=await fixture((q,r)=>r.end(JSON.stringify(q.url==='/health'?recorded.health:q.url==='/v1/capabilities'?{...recorded.capabilities,model:'renamed-model'}:providerRun)),[registration]);
 try{const agents=await f.service.agents(f.access,f.c.id,{limit:1});assert.equal(agents.items[0].externalId,registration.externalId);assert.equal(agents.items[0].name,registration.name);
 const execution=await f.service.execution(f.access,f.c.id,runId);assert.equal(execution.externalAgentId,registration.externalId);assert.equal(execution.presentationStatus,'RUNNING');
 assert.ok(!JSON.stringify(execution).includes('private-'));const n=f.calls.length;
 await assert.rejects(f.service.execution(f.access,f.c.id,'run_'+'b'.repeat(32)),match('INVALID_INPUT'));
 assert.ok(f.calls.slice(n).every(c=>c.path==='/health'||c.path==='/v1/capabilities'));
 assert.ok(f.calls.every(c=>c.method==='GET'));}finally{await f.close();}
});
test('Hermes source-derived snapshot states dedupe across polls and preserve terminal/order boundaries',async()=>{
 const {hermesState,HERMES_DOMAIN}=require('../dist/external-orchestrators/hermes.adapter'),{ordering}=require('../dist/external-orchestrators/ingestion.domain');
 let status='running',updated=1794099600;
 const f=await fixture((q,r)=>r.end(JSON.stringify(q.url==='/health'?recorded.health:q.url==='/v1/capabilities'?recorded.capabilities:{object:'hermes.run',run_id:runId,status,updated_at:updated})),[registration]);
 try{const poll=async()=>(await f.service.events(f.access,f.c.id,{limit:1,cursor:runId})).items[0];const first=await poll(),duplicate=await poll();assert.equal(first.eventId,duplicate.eventId);
 status='waiting_for_approval';updated++;const waiting=await poll();assert.equal(waiting.normalizedStatus,'RUNNING');assert.equal(waiting.sourceStatus,status);
 assert.equal(ordering({status:'RUNNING',domain:HERMES_DOMAIN,sequence:first.sequence.value},waiting,HERMES_DOMAIN),'APPLIED');
 status='completed';updated++;const terminal=await poll();assert.equal(terminal.normalizedStatus,'COMPLETED');
 assert.equal(ordering({status:'COMPLETED',domain:HERMES_DOMAIN,sequence:terminal.sequence.value},first,HERMES_DOMAIN),'STALE');
 for(const state of ['interrupted','unknown','future-state'])assert.equal(hermesState(state).status,'UNKNOWN');
 status='failed';updated++;assert.equal(ordering({status:'COMPLETED',domain:HERMES_DOMAIN,sequence:terminal.sequence.value},await poll(),HERMES_DOMAIN),'DEFERRED_CONFLICT');
 }finally{await f.close();}
});
test('Hermes registration configuration rejects ambiguous identities routes and unbounded registrations',async()=>{
 const f=await fixture();try{for(const registrations of [[registration,registration],[{...registration,npcId:'invented-npc'}],[{...registration,executionIds:['../health']}],
 [{...registration,executionIds:[runId,runId]}],[{...registration,internalAgentId:'bad'}],[{...registration,externalId:'https://host'}]])
 assert.throws(()=>connection({...f.c,registeredAgents:registrations}),match('INVALID_CONFIGURATION'));
 assert.throws(()=>connection({...f.c,adapterType:'langgraph.v1',registeredAgents:[registration]}),match('INVALID_CONFIGURATION'));
 }finally{await f.close();}
});
test('Hermes malformed run identity and modification time are rejected without exposing payloads',async()=>{
 for(const patch of [{run_id:'another-run'},{object:'other'},{updated_at:null},{updated_at:-1},{updated_at:'yesterday'}]){
 const f=await fixture((q,r)=>r.end(JSON.stringify(q.url==='/health'?recorded.health:q.url==='/v1/capabilities'?recorded.capabilities:{object:'hermes.run',run_id:runId,status:'running',updated_at:1794099600,...patch})),[registration]);
 try{await assert.rejects(f.service.execution(f.access,f.c.id,runId),match('INVALID_PROVIDER_RESPONSE'));}finally{await f.close();}}
});
test('Hermes watch is finite backs off transient failures and never retries authorization',async()=>{
 const {boundedHermesWatch,hermesSyncArguments}=require('../dist/external-orchestrators/hermes-sync-command');let attempts=0;const delays=[];
 await boundedHermesWatch(4,async()=>{if(++attempts<3)throw Object.assign(Error(),{code:'TIMEOUT'});},async ms=>delays.push(ms));
 assert.equal(attempts,4);assert.deepEqual(delays,[10000,20000,5000]);attempts=0;
 await assert.rejects(boundedHermesWatch(100,async()=>{attempts++;throw Object.assign(Error(),{code:'AUTHENTICATION_FAILED'});},async()=>{}));assert.equal(attempts,1);
 attempts=0;await assert.rejects(boundedHermesWatch(100,async()=>{attempts++;throw Object.assign(Error(),{code:'TIMEOUT'});},async()=>{}));assert.equal(attempts,3);
 assert.equal(hermesSyncArguments(['watch',randomUUID(),'5']).iterations,5);
 for(const args of [['watch',randomUUID(),'101'],['sync',randomUUID(),'2'],['dispatch',randomUUID()]])assert.throws(()=>hermesSyncArguments(args),match('INVALID_INPUT'));
});
module.exports={fixture,registration,runId};
