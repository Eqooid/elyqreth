require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./external-adapter-fixtures.cjs');
const {ExternalCredentials,externalEnvironment}=require('../dist/external-orchestrators/external-configuration');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority');
const {ExternalHttpTransport}=require('../dist/external-orchestrators/external-http.transport');
const match=code=>e=>e.code===code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('T10 endpoint policy denies cloud platform services, port zero and URL authority encodings while allowing reviewed private TLS',()=>{
 const {connection}=require('../dist/external-orchestrators/external-configuration'),f=fixture();
 for(const endpoint of [
  {...f.c.endpoint,allowedAddresses:['168.63.129.16']},
  {...f.c.endpoint,origin:'https://orchestrator.example:0'},
  {...f.c.endpoint,origin:'https://0x7f000001'},
  {...f.c.endpoint,origin:'https://%31%32%37.0.0.1'},
  {...f.c.endpoint,origin:'https://orchestrator.example#fragment'},
 ])assert.throws(()=>connection({...f.c,endpoint}),match('INVALID_CONFIGURATION'));
 for(const address of ['fd00:ec2::254','fd00:ec2::123','FD00:0EC2:0:0:0:0:0:0254','fd20:ce::254','fd20:ce:0000::0254'])
  assert.throws(()=>connection({...f.c,endpoint:{origin:'https://private.example',network:'local',allowedAddresses:[address]}}),match('INVALID_CONFIGURATION'));
 for(const [origin,address] of [['https://private.example:8443','10.20.30.40'],['https://[fd00::10]:8443','fd00::10']])
  assert.equal(connection({...f.c,endpoint:{origin,network:'local',allowedAddresses:[address]}}).endpoint.origin,origin);
});

test('T10 production enabling and named-account legacy ingestion stay closed without an approved source policy',()=>{
 const f=fixture(),{validateEnvironment}=require('../dist/config/configuration');
 const env={NODE_ENV:'production',API_HOST:'0.0.0.0',API_PORT:'3001',CORS_ORIGINS:'https://city.example.invalid',
  DATABASE_URL:'postgresql://runtime:synthetic-nondefault-credential@db.example.invalid/elyqreth',AUTH_MODE:'local',
  AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:f.c.ownerId,EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([f.c])};
 assert.throws(()=>validateEnvironment(env),e=>e.message.includes('EXTERNAL_ORCHESTRATORS')&&!e.message.includes('synthetic-nondefault-credential'));
 const auth=new IngestionAuthority({value:{...f.config,nodeEnv:'production',host:'0.0.0.0',authentication:{mode:'local'},registry:{ownerId:f.c.ownerId,token:'never-a-production-source'}}});
 assert.throws(()=>auth.authorize('never-a-production-source',f.c.id,randomUUID(),'ingestion','run'),match('ACCESS_DENIED'));
});

test('T10 source grants bind endpoint pins, mode, capabilities, credential reference and credential value',()=>{
 for(const update of [f=>({...f.c,endpoint:{...f.c.endpoint,allowedAddresses:['8.8.4.4']}}),f=>({...f.c,mode:'CONTROLLED_DISPATCH'}),
  f=>({...f.c,capabilities:['health']}),f=>({...f.c,credentialRef:'EXTERNAL_SECRET_REPLACEMENT'})]){
  const f=fixture({credentialRef:'EXTERNAL_SECRET_FIXTURE'}),token='synthetic-operator-credential',config={value:{...f.config,nodeEnv:'test',host:'127.0.0.1',registry:{ownerId:f.c.ownerId,token}}};
  const auth=new IngestionAuthority(config),grant=auth.authorize(token,f.c.id,randomUUID(),'operator','run');
  config.value.externalOrchestrators.connections=[update(f)];assert.throws(()=>auth.check(grant),match('ACCESS_DENIED'));
 }
 const f=fixture({credentialRef:'EXTERNAL_SECRET_FIXTURE'}),token='synthetic-operator-credential',config={value:{...f.config,nodeEnv:'test',host:'127.0.0.1',registry:{ownerId:f.c.ownerId,token}}};
 const auth=new IngestionAuthority(config),grant=auth.authorize(token,f.c.id,randomUUID(),'ingestion','run');
 config.value.externalOrchestrators.credentials=new ExternalCredentials(new Map([['EXTERNAL_SECRET_FIXTURE','synthetic-rotated-provider-credential']]));
 assert.throws(()=>auth.check(grant),match('ACCESS_DENIED'));
});

test('T10 missing referenced credentials fail before adapter or network work',async()=>{
 const f=fixture({credentialRef:'EXTERNAL_SECRET_FIXTURE'});f.config.externalOrchestrators.credentials=new ExternalCredentials(new Map());
 await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),match('INVALID_CONFIGURATION'));assert.equal(f.calls.length,0);
});

test('T10 rotation during negotiation never sends a new credential to a captured old connection',async()=>{
 let entered,release;const ready=new Promise(r=>entered=r),waiting=new Promise(r=>release=r);
 const f=fixture({credentialRef:'EXTERNAL_SECRET_FIXTURE'},{async describe(ctx){entered();await waiting;await ctx.http.get('/info');return {...f.provenance,capabilities:f.c.capabilities,revision:'one',expiresAt:new Date(Date.now()+60000).toISOString()};}});
 let reads=0;f.transport.get=async()=>{reads++;return {}};
 const pending=f.service.describe(f.access,f.c.id);await ready;
 f.config.externalOrchestrators.credentials=new ExternalCredentials(new Map([['EXTERNAL_SECRET_FIXTURE','synthetic-rotated-provider-credential']]));release();
 await assert.rejects(pending,match('ACCESS_DENIED'));assert.equal(reads,0);
});

test('T10 one stalled adapter connection cannot consume every operation slot',async()=>{
 const waiting=[],f=fixture({}, {async discoverAgents(){return new Promise(resolve=>waiting.push(resolve));}}),controllers=[new AbortController(),new AbortController()];
 const busy=controllers.map(c=>f.service.agents(f.access,f.c.id,{limit:1},c.signal).catch(e=>e));
 try{
  while(waiting.length<2)await tick();
  const third=new AbortController(),overflow=f.service.agents(f.access,f.c.id,{limit:1},third.signal);third.abort();
  await assert.rejects(overflow,match('CAPACITY_EXCEEDED'));
  const other={...f.c,id:randomUUID()};f.config.externalOrchestrators.connections=[f.c,other];
  // Capability provenance follows the actual connection, not the fixture's first connection.
  f.service.registry=new (require('../dist/external-orchestrators/adapter-registry').AdapterRegistry)([{...f.adapter,
   async describe(ctx){return {connectionId:ctx.connectionId,namespace:ctx.namespace,generation:ctx.generation,capabilities:['health'],revision:'one',expiresAt:new Date(Date.now()+60000).toISOString()};},
   async health(ctx){return {connectionId:ctx.connectionId,namespace:ctx.namespace,generation:ctx.generation,state:'HEALTHY',checkedAt:new Date().toISOString()};}}]);
  assert.equal((await f.service.health(f.access,other.id)).state,'HEALTHY');
 }finally{controllers.forEach(c=>c.abort());waiting.forEach(resolve=>resolve({items:[],nextCursor:null}));await Promise.all(busy);}
});

test('T10 one unresolved DNS connection leaves transport capacity for another connection',async()=>{
 const f=fixture(),waiting=[],transport=new ExternalHttpTransport(()=>new Promise(r=>waiting.push(r))),controllers=[new AbortController(),new AbortController()];
 const busy=controllers.map(c=>transport.get(f.c,'/health',c.signal,Date.now()+5000).catch(e=>e));
 try{
  while(waiting.length<2)await tick();const third=new AbortController(),overflow=assert.rejects(transport.get(f.c,'/health',third.signal,Date.now()+5000),match('CAPACITY_EXCEEDED'));await tick();third.abort();
  await overflow;
  const other={...f.c,id:randomUUID()};await assert.rejects(transport.get(other,'//not-a-route',new AbortController().signal,Date.now()+5000),match('INVALID_CONFIGURATION'));
 }finally{controllers.forEach(c=>c.abort());waiting.forEach(r=>r([{address:'8.8.8.8',family:4}]));await Promise.all(busy);await tick();}
});

test('T10 external credentials cannot be reused by distinct configured connections',()=>{
 const f=fixture({credentialRef:'EXTERNAL_SECRET_FIXTURE'});
 for(const second of [{...f.c,id:randomUUID()},{...f.c,id:randomUUID(),credentialRef:'EXTERNAL_SECRET_OTHER'}]){
  const errors=[];const config=externalEnvironment({EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([f.c,second]),EXTERNAL_SECRET_FIXTURE:'synthetic-shared-value',EXTERNAL_SECRET_OTHER:'synthetic-shared-value'},'test',{ownerId:f.c.ownerId},errors);
  assert.equal(config,undefined);assert.deepEqual(errors,['EXTERNAL_ORCHESTRATORS']);
 }
});

test('T10 operator revocation during awaited discovery or result retrieval prevents returning stale-authorized data',async()=>{
 const {LangGraphObservationService}=require('../dist/external-orchestrators/langgraph-observation.service'),{IngestionError}=require('../dist/external-orchestrators/ingestion.domain');
 const {LANGGRAPH_DOMAIN}=require('../dist/external-orchestrators/langgraph.adapter');
 for(const method of ['discover','result']){
  let valid=true,enter,release;const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r);
  const authority={check(){if(!valid)throw new IngestionError('ACCESS_DENIED');return {connection:{id:randomUUID(),ownerId:randomUUID(),adapterType:'langgraph.v1'},domain:LANGGRAPH_DOMAIN};}};
  const read=async()=>{enter();await waiting;return {items:[]};};
  const service=new LangGraphObservationService(authority,{agents:read,result:read},{resolveExecution:async()=>({})});
  const pending=method==='discover'?service.discover({}):service.result({},'opaque-test-run');
  await entered;valid=false;release();await assert.rejects(pending,match('ACCESS_DENIED'));
 }
});
