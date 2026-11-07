require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {ordering,eventHash,normalizeExternalStatus}=require('../dist/external-orchestrators/ingestion.domain');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority');
const {fixture}=require('./external-adapter-fixtures.cjs');
const event=(sequence='2',sourceStatus='RUNNING')=>({connectionId:randomUUID(),namespace:'installation-a',generation:1,eventId:'event-1',kind:'execution.observed',externalAgentId:'agent',externalExecutionId:'run',sourceStatus,receivedAt:new Date().toISOString(),sequence:{domain:'run',value:sequence}});
test('external normalization keeps unknown states distinct from native lifecycle',()=>{
 for(const s of ['QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'])assert.equal(normalizeExternalStatus(s),s);
 for(const s of [undefined,'done','TIMED_OUT','SUCCEEDED','vendor-suspended'])assert.equal(normalizeExternalStatus(s),'UNKNOWN');
});
test('ordering uses exact approved source sequence domain and arbitrary precision',()=>{
 assert.equal(ordering({status:'UNKNOWN',domain:null,sequence:null},event(),null),'DEFERRED_ORDERING');
 assert.equal(ordering({status:'UNKNOWN',domain:null,sequence:null},event(),'another-domain'),'DEFERRED_ORDERING');
 assert.equal(ordering({status:'RUNNING',domain:'run',sequence:'90071992547409930'},event('90071992547409931'),'run'),'APPLIED');
 assert.equal(ordering({status:'RUNNING',domain:'run',sequence:'3'},event('2'),'run'),'STALE');
 assert.equal(ordering({status:'RUNNING',domain:'run',sequence:'2'},event('2'),'run'),'DEFERRED_CONFLICT');
});
test('terminal and known observations never regress from newer conflicting or unknown events',()=>{
 for(const status of ['COMPLETED','FAILED','CANCELLED'])assert.equal(ordering({status,domain:'run',sequence:'1'},event('2'),'run'),'DEFERRED_CONFLICT');
 assert.equal(ordering({status:'RUNNING',domain:'run',sequence:'1'},event('2','QUEUED'),'run'),'DEFERRED_CONFLICT');
 assert.equal(ordering({status:'RUNNING',domain:'run',sequence:'1'},event('2','vendor-unknown'),'run'),'DEFERRED_ORDERING');
});
test('dedupe canonical hash excludes receipt time but preserves all source evidence',()=>{
 const e=event();assert.equal(eventHash(e),eventHash({...e,receivedAt:'2026-10-28T00:00:00.000Z'}));
 assert.notEqual(eventHash(e),eventHash({...e,sourceStatus:'COMPLETED'}));assert.notEqual(eventHash(e),eventHash({...e,generation:2}));
});
test('trusted internal grants cannot be forged copied escalated rotated or replayed across source generations',()=>{
 const f=fixture(),token='operator-fixture-key-32-characters',config={value:{...f.config,nodeEnv:'test',host:'127.0.0.1',registry:{ownerId:f.c.ownerId,token}}},auth=new IngestionAuthority(config);
 assert.throws(()=>auth.authorize('wrong',f.c.id,randomUUID(),'ingestion','run'),e=>e.code==='ACCESS_DENIED');
 const grant=auth.authorize(token,f.c.id,randomUUID(),'ingestion','run');assert.equal(auth.check(grant).domain,'run');
 const metadata=auth.check(grant);assert.equal(Object.isFrozen(metadata),true);assert.equal(metadata.credentialHash,undefined);assert.equal(metadata.expires,undefined);metadata.kind='operator';
 for(const forged of [{},{...grant},null])assert.throws(()=>auth.check(forged),e=>e.code==='ACCESS_DENIED');
 assert.throws(()=>auth.check(grant,true),e=>e.code==='ACCESS_DENIED');
 config.value.registry={...config.value.registry,token:'rotated-key-32-characters'};assert.throws(()=>auth.check(grant),e=>e.code==='ACCESS_DENIED');
 config.value.registry={...config.value.registry,token};config.value.externalOrchestrators.connections=[{...f.c,generation:2}];assert.throws(()=>auth.check(grant),e=>e.code==='ACCESS_DENIED');
});
test('internal source grants expire and disabled configurations revoke ingestion immediately',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-28T00:00:00.000Z')});
 const f=fixture(),token='operator-fixture-key-32-characters',config={value:{...f.config,nodeEnv:'test',host:'127.0.0.1',registry:{ownerId:f.c.ownerId,token}}},auth=new IngestionAuthority(config);
 const grant=auth.authorize(token,f.c.id,randomUUID(),'ingestion','run');t.mock.timers.tick(300001);assert.throws(()=>auth.check(grant),e=>e.code==='ACCESS_DENIED');
 const fresh=auth.authorize(token,f.c.id,randomUUID(),'ingestion','run');config.value.externalOrchestrators.connections=[{...f.c,enabled:false}];assert.throws(()=>auth.check(fresh),e=>e.code==='ACCESS_DENIED');
});
test('actual application exposes no generic external event webhook or mapping endpoint',async()=>{
 const {createApplication}=require('../dist/application'),{validateEnvironment}=require('../dist/config/configuration');
 const app=await createApplication(validateEnvironment({NODE_ENV:'test'}));try{await app.listen(0,'127.0.0.1');for(const path of ['/api/v1/external-events','/api/v1/external-mappings'])assert.equal((await fetch(await app.getUrl()+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);}finally{await app.close();}
});

test('legacy ingestion credentials cannot become empty-token grants in a named-account installation',()=>{
 const f=fixture(),config={value:{...f.config,nodeEnv:'test',host:'127.0.0.1',authentication:{mode:'local',sessionSeconds:3600},registry:{ownerId:f.c.ownerId,token:''}}};
 const authority=new IngestionAuthority(config);
 assert.throws(()=>authority.authorize('',f.c.id,randomUUID(),'operator'),e=>e.code==='ACCESS_DENIED');
 config.value.authentication=undefined;
 assert.throws(()=>authority.authorize('',f.c.id,randomUUID(),'operator'),e=>e.code==='ACCESS_DENIED');
});
