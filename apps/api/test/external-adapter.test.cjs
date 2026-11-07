require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{inspect}=require('node:util');
const {fixture}=require('./external-adapter-fixtures.cjs');
const {AdapterRegistry}=require('../dist/external-orchestrators/adapter-registry');
const {AdapterError,statusError}=require('../dist/external-orchestrators/adapter.error');
const {connection,externalEnvironment,ExternalCredentials}=require('../dist/external-orchestrators/external-configuration');
const {agentDescriptor,executionDescriptor,eventEnvelope,resultDescriptor}=require('../dist/external-orchestrators/adapter.validation');
const {budget}=require('../dist/external-orchestrators/adapter-budget');
const match=code=>e=>e.code===code;

test('external registry rejects ambiguous/untrusted/unknown adapters and missing optional methods',()=>{
 const f=fixture();assert.equal(f.registry.resolve('fixture.v1').type,'fixture.v1');
 assert.throws(()=>new AdapterRegistry([f.adapter,f.adapter]),match('INVALID_CONFIGURATION'));
 assert.throws(()=>new AdapterRegistry([{...f.adapter,type:'../../arbitrary.js'}]),match('INVALID_CONFIGURATION'));
 assert.throws(()=>new AdapterRegistry([{...f.adapter,getResult:undefined}]),match('INVALID_CONFIGURATION'));
 assert.throws(()=>f.registry.resolve('not.registered'),match('UNKNOWN_ADAPTER'));
});
test('capabilities intersect implementation deployment and local policy without accepting stale generation',async()=>{
 const f=fixture({capabilities:['health','agents']});assert.deepEqual((await f.service.describe(f.access,f.c.id)).capabilities,['health','agents']);
 await assert.rejects(f.service.result(f.access,f.c.id,f.execution.externalId),match('UNSUPPORTED_CAPABILITY'));
 const denied=fixture({}, {async describe(){return {...f.provenance,capabilities:['health'],revision:'one',expiresAt:new Date(Date.now()+60000).toISOString()};}});
 await assert.rejects(denied.service.agents(denied.access,denied.c.id,{limit:1}),match('INVALID_PROVIDER_RESPONSE'));
 const gone=fixture();gone.adapter.capabilities.splice(0); // Registered methods and capability declarations were captured immutably.
 assert.ok((await gone.service.describe(gone.access,gone.c.id)).capabilities.includes('health'));
});
test('normalized observations preserve opaque scoped identities and external lifecycle instead of native state',async()=>{
 const f=fixture();assert.deepEqual((await f.service.agents(f.access,f.c.id,{limit:1})).items,[f.agent]);
 assert.equal((await f.service.executions(f.access,f.c.id,{limit:1})).items[0].sourceStatus,'vendor-hibernating');
 assert.equal((await f.service.execution(f.access,f.c.id,f.execution.externalId)).presentationStatus,'UNKNOWN');
 assert.equal((await f.service.result(f.access,f.c.id,f.execution.externalId)).reference,'opaque-result-1');
 assert.equal((await f.service.events(f.access,f.c.id,{limit:1})).items[0].sequence.value,'90071992547409930');
 assert.equal(f.calls.some(c=>['dispatch','cancel'].includes(c[0])),false);
});
test('observation-only and independently authorized controlled dispatch cannot invoke mutations in T06',async()=>{
 const f=fixture();await assert.rejects(f.service.mutation(f.access,f.c.id,'dispatch'),match('ACCESS_DENIED'));
 const controlled=fixture({mode:'CONTROLLED_DISPATCH'});
 await assert.rejects(controlled.service.mutation({...controlled.access,operations:['health']},controlled.c.id,'dispatch'),match('ACCESS_DENIED'));
 await assert.rejects(controlled.service.mutation(controlled.access,controlled.c.id,'dispatch'),match('OPERATION_DISABLED'));
 await assert.rejects(controlled.service.mutation(controlled.access,controlled.c.id,'cancel'),match('OPERATION_DISABLED'));
 assert.equal(controlled.calls.some(c=>['dispatch','cancel'].includes(c[0])),false);
});
test('ownership and operation authorization are checked before any adapter or health call',async()=>{
 const f=fixture();await assert.rejects(f.service.health({...f.access,ownerId:randomUUID()},f.c.id),match('NOT_FOUND'));
 await assert.rejects(f.service.agents({...f.access,operations:[]},f.c.id,{limit:1}),match('ACCESS_DENIED'));assert.equal(f.calls.length,0);
});
test('disabled connections return disabled health without IO and other operations reject',async()=>{
 const f=fixture({enabled:false});assert.equal((await f.service.health(f.access,f.c.id)).state,'DISABLED');
 await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),match('DISABLED'));assert.equal(f.calls.length,0);
});
test('descriptors reject forged provenance unsupported metadata unsafe strings getters and invalid times',()=>{
 const f=fixture();for(const patch of [{connectionId:randomUUID()},{generation:2},{namespace:'another'},{token:'do not expose'},{name:'Bearer dangerous-token-value'}])assert.throws(()=>agentDescriptor({...f.agent,...patch},f.c),match('INVALID_PROVIDER_RESPONSE'));
 let touched=false;assert.throws(()=>agentDescriptor({...f.agent,get name(){touched=true;return 'bad';}},f.c));assert.equal(touched,false);
 assert.throws(()=>executionDescriptor({...f.execution,presentationStatus:'NATIVE_SUCCEEDED'},f.c));
 assert.throws(()=>executionDescriptor({...f.execution,startedAt:'2026-10-28T00:00:01.000Z',finishedAt:'2026-10-28T00:00:00.000Z'},f.c));
 assert.throws(()=>eventEnvelope({...f.provenance,eventId:'one',kind:'execution.observed',receivedAt:new Date().toISOString()},f.c));
 assert.throws(()=>eventEnvelope({...f.provenance,eventId:'one',kind:'connection.observed',receivedAt:new Date().toISOString(),sequence:{domain:'run',value:90071992547409930}},f.c));
 assert.throws(()=>resultDescriptor({...f.provenance,executionId:'one',availability:'AVAILABLE'},f.c));
});
test('configuration rejects untrusted endpoint policy, invalid modes secrets TLS overrides and unknown fields',()=>{
 const f=fixture();for(const patch of [{endpoint:{...f.c.endpoint,origin:'file:///etc/passwd'}},{endpoint:{...f.c.endpoint,allowedAddresses:['169.254.169.254']}},{endpoint:{...f.c.endpoint,rejectUnauthorized:false}},{mode:'ADMIN'},{credential:'raw-secret'},{credentialRef:'OPENAI_API_KEY'}])assert.throws(()=>connection({...f.c,...patch}),match('INVALID_CONFIGURATION'));
});
test('environment connection profiles are opt-in fixed-owner bounded and credentials redact inspection',()=>{
 const f=fixture({credentialRef:'EXTERNAL_SECRET_FIXTURE'}),errors=[];
 const config=externalEnvironment({EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([f.c]),EXTERNAL_SECRET_FIXTURE:'fixture-bearer-value'},'test',{ownerId:f.c.ownerId},errors);
 assert.deepEqual(errors,[]);assert.equal(config.credentials.resolve(f.c.credentialRef),'fixture-bearer-value');assert.ok(!inspect(config).includes('fixture-bearer-value'));assert.ok(!JSON.stringify(config).includes('fixture-bearer-value'));
 for(const [env,mode,registry] of [[{EXTERNAL_ORCHESTRATORS:'[]'},'test',{}],[{EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:'[]'},'test',{}],[{EXTERNAL_ORCHESTRATORS_ENABLED:'true'},'production',{}]]){const e=[];externalEnvironment(env,mode,registry,e);assert.ok(e.length);}
 assert.equal(new ExternalCredentials(new Map([['one','value"with\\quotes']])).contains(JSON.stringify({name:'value"with\\quotes'})),true);
});
test('known credentials raw errors and hostile error codes do not escape normalized responses or logs',async()=>{
 const f=fixture({}, {async discoverAgents(){throw new Error('fixture-bearer-value private stack');}});
 await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),e=>e.code==='TRANSIENT_FAILURE'&&!String(e.stack).includes('fixture-bearer-value'));
 assert.ok(!JSON.stringify(f.logs).includes('fixture-bearer-value'));
 const leaked=fixture();leaked.agent.name='fixture-bearer-value';await assert.rejects(leaked.service.agents(leaked.access,leaked.c.id,{limit:1}),match('INVALID_PROVIDER_RESPONSE'));
 assert.ok(!JSON.stringify(new AdapterError('untrusted-secret-message')).includes('untrusted-secret-message'));
});
test('health normalizes unavailable and authentication errors without affecting native work',async()=>{
 const f=fixture({}, {async health(){throw new AdapterError('AUTHENTICATION_FAILED');}});
 const health=await f.service.health(f.access,f.c.id);assert.equal(health.state,'UNAVAILABLE');assert.equal(health.errorCode,'AUTHENTICATION_FAILED');
 for(const [status,code] of [[401,'AUTHENTICATION_FAILED'],[403,'AUTHORIZATION_FAILED'],[404,'NOT_FOUND'],[429,'RATE_LIMITED'],[503,'TRANSIENT_FAILURE'],[400,'PERMANENT_FAILURE']])assert.equal(statusError(status).code,code);
});
test('deadline and cancellation races consume late rejections and remove caller listeners',async()=>{
 const {getEventListeners}=require('node:events'),controller=new AbortController();
 await assert.rejects(budget(controller.signal,Date.now()+20,signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))),match('TIMEOUT'));
 assert.equal(getEventListeners(controller.signal,'abort').length,0);
 controller.abort('private reason');await assert.rejects(budget(controller.signal,Date.now()+5000,async()=>{throw Error('must not run');}),match('ABORTED'));
});
test('service concurrency remains bounded when reviewed code ignores cancellation',async()=>{
 const pending=[],f=fixture({}, {async discoverAgents(){return new Promise(resolve=>pending.push(resolve));}}),controllers=Array.from({length:2},()=>new AbortController());
 const work=controllers.map(c=>f.service.agents(f.access,f.c.id,{limit:1},c.signal).catch(e=>e));
 while(pending.length<2)await new Promise(resolve=>setImmediate(resolve));controllers.forEach(c=>c.abort());
 assert.ok((await Promise.all(work)).every(e=>e.code==='ABORTED'));
 await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),match('CAPACITY_EXCEEDED'));
 pending.forEach(resolve=>resolve({items:[],nextCursor:null}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.service.health(f.access,f.c.id)).state,'HEALTHY');
});
test('fresh deployment capability revocation and expiration disable reads before optional methods run',async()=>{
 let discovered=0;
 for(const expired of [false,true]){
  const f=fixture({}, {async describe(ctx){return {connectionId:ctx.connectionId,namespace:ctx.namespace,generation:ctx.generation,capabilities:['health'],revision:'revised',expiresAt:new Date(Date.now()+(expired?-1000:60000)).toISOString()};},async discoverAgents(){discovered++;throw Error();}});
  await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),match(expired?'INVALID_PROVIDER_RESPONSE':'UNSUPPORTED_CAPABILITY'));
 }
 assert.equal(discovered,0);
});
test('controlled dispatch requires remote dedupe and lookup in addition to local authorization',async()=>{
 const f=fixture({mode:'CONTROLLED_DISPATCH'},{async describe(ctx){return {connectionId:ctx.connectionId,namespace:ctx.namespace,generation:ctx.generation,capabilities:['health','dispatch'],revision:'one',expiresAt:new Date(Date.now()+60000).toISOString()};}});
 await assert.rejects(f.service.mutation(f.access,f.c.id,'dispatch'),match('UNSUPPORTED_CAPABILITY'));assert.equal(f.calls.some(c=>c[0]==='dispatch'),false);
});
test('minimal health-only adapters need no unsupported methods and emit only safe connection context',async()=>{
 const f=fixture({capabilities:['health'],credentialRef:'EXTERNAL_SECRET_FIXTURE'});
 const minimal=new AdapterRegistry([{type:'minimal.v1',capabilities:['health'],validateConfiguration(){},describe:f.adapter.describe,health:f.adapter.health}]);assert.equal(minimal.resolve('minimal.v1').getExecution,undefined);
 await f.service.health(f.access,f.c.id);const ctx=f.calls.find(c=>c[0]==='health')[1];assert.equal(ctx.credentialRef,undefined);assert.equal(ctx.ownerId,undefined);assert.ok(!JSON.stringify(ctx).includes('fixture-bearer-value'));
 const view=f.service.connection(f.access,f.c.id);assert.equal(view.endpoint,undefined);assert.equal(view.credentialRef,undefined);assert.equal(view.ownerId,undefined);
});
test('oversized pages forged result references and invalid configuration fail safely',async()=>{
 const f=fixture({}, {async discoverAgents(ctx){return {items:Array.from({length:2},()=>({connectionId:ctx.connectionId,namespace:ctx.namespace,generation:ctx.generation,externalId:'one',name:'One'})),nextCursor:null};}});
 await assert.rejects(f.service.agents(f.access,f.c.id,{limit:1}),match('INVALID_PROVIDER_RESPONSE'));
 await assert.rejects(f.service.agents(f.access,f.c.id,{limit:21}),match('INVALID_INPUT'));
 f.config.externalOrchestrators.connections=[{...f.c,enabled:'true'}];assert.throws(()=>f.service.onModuleInit(),match('INVALID_CONFIGURATION'));
});
test('actual service health deadline returns sanitized unavailable and releases cooperative resources',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered=false;
 const f=fixture({}, {async health(ctx){entered=true;return new Promise((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(ctx.signal.reason),{once:true}));}});
 const controller=new AbortController(),pending=f.service.health(f.access,f.c.id,controller.signal);
 await new Promise(r=>setImmediate(r));assert.equal(entered,true);t.mock.timers.tick(5000);
 const health=await pending;assert.equal(health.state,'UNAVAILABLE');assert.equal(health.errorCode,'TIMEOUT');assert.equal(require('node:events').getEventListeners(controller.signal,'abort').length,0);
});
