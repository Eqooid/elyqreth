require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{createServer}=require('node:http');
const recorded=require('./fixtures/langgraph-0.16.8.json');
const {LangGraphAdapter,langgraphState,runKey,LANGGRAPH_DOMAIN,LANGGRAPH_CAPABILITIES}=require('../dist/external-orchestrators/langgraph.adapter');
const {AdapterRegistry}=require('../dist/external-orchestrators/adapter-registry');
const {ExternalAdapterService}=require('../dist/external-orchestrators/external-adapter.service');
const {ExternalHttpTransport}=require('../dist/external-orchestrators/external-http.transport');
const {connection,ExternalCredentials}=require('../dist/external-orchestrators/external-configuration');
const match=code=>e=>e.code===code;
async function fixture(handler){
 const calls=[],logs=[];let status=recorded.run.status;
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;calls.push({path:req.url,method:req.method,headers:req.headers,body});res.setHeader('Content-Type','application/json');
 if(handler)return handler(req,res,body);
 const value=req.url==='/info'?recorded.info:req.url==='/assistants/search'?recorded.assistants:req.url.includes('?')?[{...recorded.run,status}]:req.url.endsWith('/state')?recorded.state:req.url.endsWith('/join')?recorded.result:{...recorded.run,status};res.end(JSON.stringify(value));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const c=connection({id:randomUUID(),ownerId:randomUUID(),adapterType:'langgraph.v1',name:'Reference',namespace:'reference-test',generation:1,enabled:true,mode:'OBSERVATION_ONLY',credentialRef:'EXTERNAL_SECRET_REFERENCE',endpoint:{origin:`http://127.0.0.1:${server.address().port}`,network:'local',allowedAddresses:['127.0.0.1']},capabilities:LANGGRAPH_CAPABILITIES});
 const config={externalOrchestrators:{connections:[c],credentials:new ExternalCredentials(new Map([['EXTERNAL_SECRET_REFERENCE','test-private-api-key']]))}};
 const service=new ExternalAdapterService({value:config},new AdapterRegistry([new LangGraphAdapter()]),new ExternalHttpTransport(async()=>{throw Error('No DNS');}),{info:(...v)=>logs.push(v)});service.onModuleInit();
 return {c,service,calls,logs,access:{ownerId:c.ownerId,correlationId:randomUUID(),operations:LANGGRAPH_CAPABILITIES},setStatus:v=>status=v,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
const key=runKey(recorded.run.thread_id,recorded.run.run_id);
test('LangGraph real recorded API fixture: health discovery status and bounded result metadata over pinned HTTP',async()=>{
 const f=await fixture();try{
 assert.equal((await f.service.health(f.access,f.c.id)).state,'HEALTHY');
 const page=await f.service.agents(f.access,f.c.id,{limit:2});assert.equal(page.items[0].externalId,recorded.run.assistant_id);assert.equal(page.nextCursor,null);
 assert.deepEqual(JSON.parse(f.calls.find(c=>c.method==='POST').body),{limit:2,offset:0});
 const run=await f.service.execution(f.access,f.c.id,key);assert.equal(run.sourceStatus,'success');assert.equal(run.presentationStatus,'COMPLETED');assert.equal(run.startedAt,undefined);
 const result=await f.service.result(f.access,f.c.id,key);assert.equal(result.availability,'AVAILABLE');assert.equal(result.reference,'sha256:'+createHash('sha256').update(JSON.stringify(recorded.result)).digest('hex'));
 assert.ok(f.calls.every(c=>c.headers['x-api-key']==='test-private-api-key'&&!c.headers.authorization));assert.ok(!JSON.stringify(f.logs).includes('test-private-api-key'));
 }finally{await f.close();}
});
test('LangGraph source statuses retain unknown/resumable interruption and map only reviewed terminal semantics',()=>{
 for(const [raw,expected] of [['pending','QUEUED'],['running','RUNNING'],['success','COMPLETED'],['error','FAILED'],['timeout','FAILED'],['interrupted','UNKNOWN'],['cancelled','UNKNOWN'],['vendor-new','UNKNOWN']])assert.equal(langgraphState(raw).status,expected);
});
test('LangGraph polling uses stable run/status identities and lifecycle phase, never receive time as source order',async()=>{
 const f=await fixture();try{const a=(await f.service.events(f.access,f.c.id,{limit:1,cursor:key})).items[0],b=(await f.service.events(f.access,f.c.id,{limit:1,cursor:key})).items[0];assert.equal(a.eventId,b.eventId);assert.equal(a.sourceStatus,'success');assert.equal(a.normalizedStatus,'COMPLETED');assert.deepEqual(a.sequence,{domain:LANGGRAPH_DOMAIN,value:'3'});assert.equal(a.occurredAt,undefined);
 }finally{await f.close();}
});
test('LangGraph configuration rejects dispatch mode unsupported capability and missing public credential',()=>{
 const a=new LangGraphAdapter();for(const c of [{adapterType:'langgraph.v1',mode:'CONTROLLED_DISPATCH',endpoint:{network:'local'},capabilities:[]},{adapterType:'langgraph.v1',mode:'OBSERVATION_ONLY',endpoint:{network:'public'},capabilities:[]},{adapterType:'langgraph.v1',mode:'OBSERVATION_ONLY',endpoint:{network:'local'},capabilities:['dispatch']}])assert.throws(()=>a.validateConfiguration(c),match('INVALID_CONFIGURATION'));
});
test('LangGraph ownership and observation-only gates reject mutations discovery scope and arbitrary run paths',async()=>{
 const f=await fixture();try{await assert.rejects(f.service.agents({...f.access,ownerId:randomUUID()},f.c.id,{limit:1}),match('NOT_FOUND'));await assert.rejects(f.service.mutation(f.access,f.c.id,'dispatch'),match('ACCESS_DENIED'));await assert.rejects(f.service.execution(f.access,f.c.id,'../../secret'),match('INVALID_INPUT'));await assert.rejects(f.service.executions({...f.access,operations:[...f.access.operations,'executions']},f.c.id,{limit:1}),match('UNSUPPORTED_CAPABILITY'));assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('LangGraph transport classifies auth rate redirects malformed and excessive responses without secrets or retries',async()=>{
 for(const [status,body,code] of [[401,'private-secret','AUTHENTICATION_FAILED'],[403,'{}','AUTHORIZATION_FAILED'],[429,'{}','RATE_LIMITED'],[503,'{}','TRANSIENT_FAILURE'],[302,'{}','INVALID_CONFIGURATION'],[200,'invalid','INVALID_PROVIDER_RESPONSE'],[200,'x'.repeat(65537),'RESPONSE_LIMIT'],[200,'{}','INVALID_PROVIDER_RESPONSE']]){const f=await fixture((_q,r)=>{r.statusCode=status;r.setHeader('Location','http://127.0.0.1/private');r.end(body);});try{const health=await f.service.health(f.access,f.c.id);assert.equal(health.state,'UNAVAILABLE');assert.equal(health.errorCode,code);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(health).includes('private-secret'));}finally{await f.close();}}
});
test('LangGraph caller timeout and abort release transport slots and listeners',async()=>{
 const f=await fixture((_q,_r)=>{});try{const signal=AbortSignal.timeout(30);await assert.rejects(f.service.execution(f.access,f.c.id,key,signal),match('ABORTED'));}finally{await f.close();}
});
test('LangGraph bounded discovery rejects invalid offset pages and malformed provider identity',async()=>{
 const f=await fixture((_q,r)=>r.end(JSON.stringify([{...recorded.assistants[0],assistant_id:'not-a-uuid'}])));try{await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1,cursor:'-1'}),match('INVALID_INPUT'));assert.equal(f.calls.length,0);await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),match('INVALID_PROVIDER_RESPONSE'));}finally{await f.close();}
});
test('LangGraph results remain pending for active runs and unavailable when a later thread run replaces result context',async()=>{
 const f=await fixture();try{f.setStatus('running');assert.equal((await f.service.result(f.access,f.c.id,key)).availability,'PENDING');assert.ok(!f.calls.some(c=>c.path.endsWith('/join')));}finally{await f.close();}
 const g=await fixture((q,r)=>r.end(JSON.stringify(q.url.includes('?')?[{...recorded.run,run_id:randomUUID()}]:recorded.run)));try{assert.equal((await g.service.result(g.access,g.c.id,key)).availability,'UNAVAILABLE');assert.ok(!g.calls.some(c=>c.path.endsWith('/join')));}finally{await g.close();}
});
test('LangGraph transport POST seam rejects every route/body/provider except reviewed bounded assistant search',async()=>{
 const f=await fixture(),transport=new ExternalHttpTransport(async()=>[]);try{for(const [c,p,b] of [[f.c,'/threads',{}],[f.c,'/assistants/search',{limit:1,offset:0,owner:'forged'}],[{...f.c,adapterType:'fixture.v1'},'/assistants/search',{limit:1,offset:0}],[f.c,'/assistants/search',{limit:21,offset:0}]])await assert.rejects(transport.search(c,p,b,new AbortController().signal,Date.now()+5000),match('INVALID_INPUT'));assert.equal(f.calls.length,0);}finally{await f.close();}
});
module.exports={fixture};

test('LangGraph result checkpoint provenance rejects manual state edits and unrelated run output',async()=>{
 for(const patch of [{metadata:{...recorded.state.metadata,source:'update'}},{metadata:{...recorded.state.metadata,run_id:randomUUID()}},{values:{value:'different-run-output'}}]){const f=await fixture((q,r)=>{const value=q.url.endsWith('/state')?{...recorded.state,...patch}:q.url.includes('?')?[recorded.run]:q.url.endsWith('/join')?recorded.result:recorded.run;r.end(JSON.stringify(value));});try{assert.equal((await f.service.result(f.access,f.c.id,key)).availability,'UNAVAILABLE');}finally{await f.close();}}
});
