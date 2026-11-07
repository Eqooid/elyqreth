require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {ConfigModule}=require('../dist/config/config.module'),{validateEnvironment}=require('../dist/config/configuration');
const {DatabaseService}=require('../dist/database/database.module');const {ApiLogger}=require('../dist/common/api-logger');
const {ExternalIngestionModule}=require('../dist/external-orchestrators/external-ingestion.module');
const {ExternalIngestionService}=require('../dist/external-orchestrators/external-ingestion.service');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority');
const {CollaborationRepository}=require('../dist/collaboration/collaboration.repository');
const match=code=>e=>e.code===code;
module.exports=({row,getUrl,getPool,securityOnly=false})=>{
 async function fixture(domain='run',provided){
  const owner=provided?.owner??await row("INSERT INTO owners(name) VALUES ('external-owned-test') RETURNING id");
  const route=provided?.route??await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'external-source','fixture.v1','ENABLED') RETURNING id",[owner.id]);
  const agent=provided?.agent??await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'Approved external identity','EXTERNAL','DISABLED') RETURNING id",[owner.id,route.id]);
  const token=provided?.token??randomBytes(32).toString('hex'),profile={id:route.id,ownerId:owner.id,adapterType:'fixture.v1',name:'Trusted source',namespace:provided?.namespace??'installation-a',generation:provided?.generation??1,mode:'OBSERVATION_ONLY',enabled:true,endpoint:{origin:'https://orchestrator.example',network:'public',allowedAddresses:['8.8.8.8']},capabilities:['health','events.poll'],...(provided?.credentialRef?{credentialRef:provided.credentialRef}:{})};
  const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([profile]),...(provided?.credentialRef?{[provided.credentialRef]:provided.secret}:{})});
  let app,service,authority,operator,source;const logs=[];
  async function open(){class FixtureRoot{};Module({imports:[ConfigModule.register(config),ExternalIngestionModule,require('../dist/runtime/runtime-host.module').RuntimeHostModule]})(FixtureRoot);app=await NestFactory.createApplicationContext(FixtureRoot,{logger:false,abortOnError:false});app.get(ApiLogger).info=(...v)=>logs.push(v);service=app.get(ExternalIngestionService);authority=app.get(IngestionAuthority);operator=authority.authorize(token,route.id,randomUUID(),'operator',domain??undefined);source=authority.authorize(token,route.id,randomUUID(),'ingestion',domain??undefined);}
  await open();const event=(patch={})=>({connectionId:route.id,namespace:profile.namespace,generation:profile.generation,eventId:randomUUID(),kind:'execution.observed',externalAgentId:'opaque-agent',externalExecutionId:'opaque-run',sourceStatus:'RUNNING',receivedAt:new Date().toISOString(),...(domain?{sequence:{domain,value:'1'}}:{}),...patch});
  return {owner,route,agent,token,profile,config,logs,event,get app(){return app;},get service(){return service;},get authority(){return authority;},get operator(){return operator;},get source(){return source;},
   async map(){const a=await service.mapAgent(operator,{externalId:'opaque-agent',internalAgentId:agent.id});const e=await service.mapExecution(operator,{externalId:'opaque-run',externalAgentId:'opaque-agent'});return {a,e};},
   async restart(){await app.close();await open();},close:()=>app.close()};
 }
 test('T10 revocation at the precommit cut rolls back receipt and audit and permits safe explicit retry',async()=>{
  const f=await fixture();try{
   await f.map();const config=f.app.get(require('../dist/config/config.module').ApiConfig),original=f.service.audit.bind(f.service),event=f.event();
   f.service.audit=async(...args)=>{await original(...args);if(args[2]==='external.event.accepted')config.value={...f.config,externalOrchestrators:{...f.config.externalOrchestrators,connections:[{...f.profile,enabled:false}]}};};
   await assert.rejects(f.service.receive(f.source,event),match('ACCESS_DENIED'));
   assert.equal((await row('SELECT count(*)::int n FROM external_event_inbox WHERE owner_id=$1',[f.owner.id])).n,0);
   assert.equal((await row("SELECT count(*)::int n FROM command_audit WHERE owner_id=$1 AND command_type='external.event.accepted'",[f.owner.id])).n,0);
   config.value=f.config;f.service.audit=original;
   const done=await f.service.ingest(f.source,event);assert.equal(done.duplicate,false);assert.equal(done.receipt.status,'APPLIED');
  }finally{await f.close();}
 });
 test('T10 provider-key rotation and new process grants preserve durable connection identity and replay protection',async()=>{
  const f=await fixture('run',{credentialRef:'EXTERNAL_SECRET_ROTATION',secret:'synthetic-provider-before-rotation'});let fresh;
  try{
   await f.map();const event=f.event(),first=await f.service.ingest(f.source,event),before=await f.service.resolveExecution(f.operator,'opaque-run');
   const inherited=f.source;await f.close();
   fresh=await fixture('run',{owner:f.owner,route:f.route,agent:f.agent,token:f.token,credentialRef:'EXTERNAL_SECRET_ROTATION',secret:'synthetic-provider-after-rotation'});
   await assert.rejects(fresh.service.ingest(inherited,event),match('ACCESS_DENIED'));
   const replay=await fresh.service.ingest(fresh.source,event);assert.equal(replay.duplicate,true);assert.equal(replay.receipt.id,first.receipt.id);
   const current=await fresh.service.resolveExecution(fresh.operator,'opaque-run');assert.equal(current.id,before.id);assert.equal(current.version,before.version);
   assert.ok(!JSON.stringify(fresh.config).includes('synthetic-provider-after-rotation'));
  }finally{if(fresh)await fresh.close();else await f.close();}
 });
 test('T10 concurrent duplicate delivery during native drain stays connection-scoped under restricted SQL grants',async()=>{
  const a=await fixture(),b=await fixture();try{
   await a.map();await b.map();await a.app.get(require('../dist/runtime/runtime-host.service').RuntimeHostService).beginDrain();
   const event=a.event({eventId:'shared-safe-event-id'}),other=b.event({eventId:'shared-safe-event-id'});
   await assert.rejects(a.service.ingest(a.source,other),match('INVALID_INPUT'));
   const all=await Promise.all(Array.from({length:6},()=>a.service.ingest(a.source,event)));
   assert.equal(new Set(all.map(r=>r.receipt.id)).size,1);assert.equal(all.filter(r=>!r.duplicate).length,1);
   const accepted=await b.service.ingest(b.source,other);assert.notEqual(accepted.receipt.id,all[0].receipt.id);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE owner_id IN ($1,$2)',[a.owner.id,b.owner.id])).n,0);
   assert.equal((await row('SELECT count(*)::int n FROM external_event_inbox WHERE owner_id IN ($1,$2)',[a.owner.id,b.owner.id])).n,2);
  }finally{await a.close();await b.close();}
 });
 test('T11 ingestion diagnostics distinguish invalid authority, duplicate receipt and actual projection transitions without payloads',async()=>{
  const f=await fixture(),logs=[];try{
   f.service.logger.info=(...args)=>logs.push(args);
   await f.map();await assert.rejects(f.service.ingest({...f.source},f.event()),match('ACCESS_DENIED'));
   const denial=logs.find(v=>v[0]==='external.ingestion.authorization_denied');assert.ok(denial);assert.equal(denial[1].connectionId,undefined);
   const event=f.event();await f.service.ingest(f.source,event);await f.service.ingest(f.source,event);
   assert.equal(logs.filter(v=>v[0]==='external.ingestion'&&v[1].outcome==='PROJECTION_APPLIED').length,1);
   assert.equal(logs.filter(v=>v[0]==='external.ingestion'&&v[1].outcome==='DUPLICATE').length,1);
   await f.service.ingest(f.source,f.event({eventId:'stale-observation',sourceStatus:'QUEUED',sequence:{domain:'run',value:'0'}}));
   assert.ok(logs.some(v=>v[0]==='external.ingestion'&&v[1].outcome==='PROJECTION_STALE'));
   assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).status,'RUNNING');assert.ok(!JSON.stringify(logs).includes(f.token));
  }finally{await f.close();}
 });
 test('T11 host operational report uses restricted read-only queries, bounded owner scope and no payloads',async()=>{
  const a=await fixture(),b=await fixture();try{
   await a.map();await b.map();await a.service.ingest(a.source,a.event());await b.service.ingest(b.source,b.event());
   const {operationalReport}=require('../dist/operations/diagnostics-command');
   const before=await row('SELECT count(*)::int n FROM command_audit');
   const report=await operationalReport(a.app.get(DatabaseService),a.owner.id),encoded=JSON.stringify(report);
   assert.equal(report.ownerId,a.owner.id);assert.equal(report.inbox.length,1);assert.equal(report.external.length,1);assert.ok(report.audit.length<=20);
   for(const forbidden of [b.owner.id,b.route.id,a.token,'instruction','password','details'])assert.ok(!encoded.includes(forbidden));
   assert.deepEqual(await row('SELECT count(*)::int n FROM command_audit'),before);
   await assert.rejects(operationalReport(a.app.get(DatabaseService),'untrusted-owner'));
  }finally{await a.close();await b.close();}
 });
 if(securityOnly)return;
 test('T09 trusted external observations and replay remain independent of native admission drain',async()=>{
  const f=await fixture();try{
   await f.map();const before=await row('SELECT count(*)::int n FROM executions');
   await f.app.get(require('../dist/runtime/runtime-host.service').RuntimeHostService).beginDrain();
   const event=f.event();assert.equal((await f.service.ingest(f.source,event)).receipt.status,'APPLIED');
   assert.equal((await f.service.ingest(f.source,event)).outcome,'DUPLICATE');
   assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).status,'RUNNING');
   assert.deepEqual(await row('SELECT count(*)::int n FROM executions'),before);
  }finally{await f.close();}
 });
 test('P5 T07 trusted real DI PostgreSQL ingestion maps and observes RUNNING to COMPLETED without native work',async()=>{
  const f=await fixture();try{
   const before=await row('SELECT (SELECT count(*)::int FROM tasks) tasks,(SELECT count(*)::int FROM executions) executions,(SELECT count(*)::int FROM agents) agents');
   const {a,e}=await f.map();assert.equal((await f.service.resolveAgent(f.operator,'opaque-agent')).id,a.id);
   const running=await f.service.ingest(f.source,f.event());assert.equal(running.receipt.status,'APPLIED');
   const done=f.event({sourceStatus:'COMPLETED',sequence:{domain:'run',value:'2'}});assert.equal((await f.service.ingest(f.source,done)).receipt.status,'APPLIED');
   const observed=await f.service.resolveExecution(f.operator,'opaque-run');assert.equal(observed.id,e.id);assert.equal(observed.status,'COMPLETED');assert.equal(observed.sourceStatus,'COMPLETED');assert.equal(observed.lastEventId,done.eventId);
   assert.equal((await row('SELECT lifecycle_status FROM agents WHERE id=$1',[f.agent.id])).lifecycle_status,'DISABLED');
   assert.deepEqual(await row('SELECT (SELECT count(*)::int FROM tasks) tasks,(SELECT count(*)::int FROM executions) executions,(SELECT count(*)::int FROM agents) agents'),before);
  }finally{await f.close();}
 });
 test('P5 T07 identical concurrent receipts deduplicate durably across restart without audit/projection duplication',async()=>{
  const f=await fixture();try{
   await f.map();const event=f.event();const all=await Promise.all(Array.from({length:6},()=>f.service.ingest(f.source,event)));
   assert.equal(new Set(all.map(r=>r.receipt.id)).size,1);assert.equal(all.filter(r=>!r.duplicate).length,1);
   const before=await row('SELECT count(*)::int n FROM command_audit WHERE owner_id=$1',[f.owner.id]);
   await f.restart();const replay=await f.service.ingest(f.source,{...event,receivedAt:'2026-10-28T00:00:00.000Z'});assert.equal(replay.outcome,'DUPLICATE');
   assert.deepEqual(await row('SELECT count(*)::int n FROM command_audit WHERE owner_id=$1',[f.owner.id]),before);
   assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).version,2);
   await assert.rejects(f.service.ingest(f.source,{...event,sourceStatus:'FAILED'}),match('IDEMPOTENCY_CONFLICT'));
  }finally{await f.close();}
 });
 test('P5 T07 out-of-order, equal-version and changed-terminal events preserve the last accepted source evidence',async()=>{
  const f=await fixture();try{
   await f.map();await f.service.ingest(f.source,f.event({sourceStatus:'COMPLETED',sequence:{domain:'run',value:'90071992547409930'}}));
   const state=await f.service.resolveExecution(f.operator,'opaque-run');
   assert.equal((await f.service.ingest(f.source,f.event({sequence:{domain:'run',value:'90071992547409929'}}))).receipt.status,'STALE');
   assert.equal((await f.service.ingest(f.source,f.event({sequence:{domain:'run',value:'90071992547409930'}}))).receipt.status,'DEFERRED_CONFLICT');
   assert.equal((await f.service.ingest(f.source,f.event({sourceStatus:'FAILED',sequence:{domain:'run',value:'90071992547409931'}}))).receipt.status,'DEFERRED_CONFLICT');
   assert.deepEqual(await f.service.resolveExecution(f.operator,'opaque-run'),state);
  }finally{await f.close();}
 });
 test('P5 T07 unknown provider status is retained and unsequenced/unapproved ordering stays deferred',async()=>{
  const f=await fixture();try{
   await f.map();await f.service.ingest(f.source,f.event({sourceStatus:'vendor-hibernating'}));
   let state=await f.service.resolveExecution(f.operator,'opaque-run');assert.equal(state.status,'UNKNOWN');assert.equal(state.sourceStatus,'vendor-hibernating');
   assert.equal((await f.service.ingest(f.source,f.event({sequence:undefined}))).receipt.status,'DEFERRED_ORDERING');
   assert.equal((await f.service.ingest(f.source,f.event({sequence:{domain:'wrong-domain',value:'2'}}))).receipt.status,'DEFERRED_ORDERING');
   await f.service.ingest(f.source,f.event({sequence:{domain:'run',value:'2'}}));state=await f.service.resolveExecution(f.operator,'opaque-run');
   assert.equal((await f.service.ingest(f.source,f.event({sourceStatus:'unknown-again',sequence:{domain:'run',value:'3'}}))).receipt.status,'DEFERRED_ORDERING');
   assert.deepEqual(await f.service.resolveExecution(f.operator,'opaque-run'),state);
  }finally{await f.close();}
 });
 test('P5 T07 an unsequenced source contract cannot claim terminal projection certainty',async()=>{
  const f=await fixture(null);try{await f.map();const event=f.event({sourceStatus:'COMPLETED',sequence:undefined});assert.equal((await f.service.ingest(f.source,event)).receipt.status,'DEFERRED_ORDERING');assert.equal((await f.service.ingest(f.source,f.event({sequence:{domain:'run',value:'1'}}))).receipt.status,'DEFERRED_ORDERING');assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).status,'UNKNOWN');}finally{await f.close();}
 });
 test('P5 T07 durable receipt survives interruption and missing mapping resolves by bounded replay',async()=>{
  const f=await fixture();try{
   const event=f.event(),received=await f.service.receive(f.source,event);assert.equal(received.receipt.status,'PENDING');await f.restart();
   const pending=await f.service.replay(f.operator,{limit:1});assert.equal(pending.items[0].status,'DEFERRED_MAPPING');
   await f.map();assert.equal((await f.service.replay(f.operator,{limit:1})).items[0].status,'APPLIED');assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).status,'RUNNING');
   assert.deepEqual((await f.service.replay(f.operator)).items,[]);
  }finally{await f.close();}
 });
 test('P5 T07 failed projection rolls back state/audit but retains committed receipt for recovery',async()=>{
  const f=await fixture();try{
   const {e}=await f.map();await getPool().query(`CREATE FUNCTION p5_t07_projection_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${e.id}'::uuid THEN RAISE EXCEPTION 'private projection fault' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t07_projection_fault BEFORE UPDATE ON external_execution_mappings FOR EACH ROW EXECUTE FUNCTION p5_t07_projection_fault()');
   let outcome;try{outcome=await f.service.ingest(f.source,f.event());assert.equal(outcome.outcome,'DEFERRED');assert.equal(outcome.receipt.status,'PENDING');assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).status,'UNKNOWN');}
   finally{await getPool().query('DROP TRIGGER p5_t07_projection_fault ON external_execution_mappings');await getPool().query('DROP FUNCTION p5_t07_projection_fault()');}
   await f.restart();const recovered=await f.service.replay(f.operator);assert.equal(recovered.items[0].id,outcome.receipt.id);assert.equal(recovered.items[0].status,'APPLIED');
  }finally{await f.close();}
 });
 test('P5 T07 forged sessions cross-source payloads cross-owner mappings and lifecycle metadata are rejected',async()=>{
  const a=await fixture(),b=await fixture();try{
   await assert.rejects(a.service.receive({},a.event()),match('ACCESS_DENIED'));
   await assert.rejects(a.service.receive(a.operator,a.event()),match('ACCESS_DENIED'));
   await assert.rejects(a.service.receive(b.source,a.event()),match('ACCESS_DENIED'));
   await assert.rejects(a.service.mapAgent(a.source,{externalId:'not-approved'}),match('ACCESS_DENIED'));
   for(const patch of [{connectionId:b.route.id},{namespace:'another'},{generation:2},{ownerId:b.owner.id},{status:'COMPLETED'},{payload:{secret:'no'}},{sourceStatus:a.token}])await assert.rejects(a.service.ingest(a.source,a.event(patch)),match('INVALID_INPUT'));
   await assert.rejects(a.service.mapAgent(a.operator,{externalId:'forged',internalAgentId:b.agent.id}),match('INVALID_CORRELATION'));
   assert.ok(!JSON.stringify(a.logs).includes(a.token));
  }finally{await a.close();await b.close();}
 });
 test('P5 T07 connection-scoped identical external IDs and explicit generation tombstones preserve history',async()=>{
  const a=await fixture(),b=await fixture();let next;try{
   const original=await a.map(),other=await b.map();assert.notEqual(original.a.id,other.a.id);assert.notEqual(original.e.id,other.e.id);
   await a.close();next=await fixture('run',{owner:a.owner,route:a.route,agent:a.agent,token:a.token,generation:2});
   await assert.rejects(next.service.mapAgent(next.operator,{externalId:'opaque-agent',internalAgentId:next.agent.id}),match('CONFLICT'));
   await next.service.tombstone(next.operator,original.a.id,original.a.version);
   const replacement=await next.service.mapAgent(next.operator,{externalId:'opaque-agent',internalAgentId:next.agent.id});assert.notEqual(replacement.id,original.a.id);
   const old=await row('SELECT status,internal_agent_id FROM external_agent_mappings WHERE id=$1',[original.a.id]);assert.equal(old.status,'TOMBSTONED');assert.equal(old.internal_agent_id,a.agent.id);
   await assert.rejects(getPool().query("UPDATE external_agent_mappings SET status='ACTIVE' WHERE id=$1",[original.a.id]),e=>e.code==='23514');
  }finally{await next?.close();await a.close();await b.close();}
 });
 test('P5 T07 database constraints reject invalid ownership native identity takeover and ambiguous duplicate mappings',async()=>{
  const a=await fixture(),b=await fixture();try{
   const {a:m}=await a.map();
   await assert.rejects(getPool().query('INSERT INTO external_agent_mappings(owner_id,source_id,external_id,internal_agent_id) VALUES ($1,$2,$3,$4)',[a.owner.id,m.sourceId,'cross-owner',b.agent.id]),e=>['23503','23514'].includes(e.code));
   await assert.rejects(getPool().query('INSERT INTO external_agent_mappings(owner_id,source_id,external_id) VALUES ($1,$2,$3)',[a.owner.id,m.sourceId,m.externalId]),e=>e.code==='23505');
   const nativeRoute=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native','native','ENABLED') RETURNING id",[a.owner.id]);
   const native=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'Native','RULE_BASED') RETURNING id",[a.owner.id,nativeRoute.id]);
   await assert.rejects(a.service.mapAgent(a.operator,{externalId:'native-pretender',internalAgentId:native.id}),match('INVALID_CORRELATION'));
   await assert.rejects(getPool().query('INSERT INTO external_agent_mappings(owner_id,source_id,external_id,internal_agent_id) VALUES ($1,$2,$3,$4)',[a.owner.id,m.sourceId,'native-direct',native.id]),e=>e.code==='23514');
  }finally{await a.close();await b.close();}
 });
 test('P5 T07 external-owned collaboration correlation is explicit and never completes native collaboration',async()=>{
  const f=await fixture();try{
   await f.service.mapAgent(f.operator,{externalId:'opaque-agent',internalAgentId:f.agent.id});
   const repo=new CollaborationRepository(f.app.get(DatabaseService)),scope={ownerId:f.owner.id,actorReference:'external-approved-test',correlationId:randomUUID()};
   const external=await repo.run(scope,r=>r.createSession({authority:'EXTERNAL',participantAgentIds:[f.agent.id],idempotencyKey:randomUUID()}));
   const native=await repo.run(scope,r=>r.createSession({authority:'NATIVE',participantAgentIds:[f.agent.id],idempotencyKey:randomUUID()}));
   await assert.rejects(f.service.mapExecution(f.operator,{externalId:'forged-native',externalAgentId:'opaque-agent',collaborationId:native.id}),match('INVALID_CORRELATION'));
   await f.service.mapExecution(f.operator,{externalId:'opaque-run',externalAgentId:'opaque-agent',collaborationId:external.id});
   await f.service.ingest(f.source,f.event({sourceStatus:'COMPLETED'}));
   assert.equal((await repo.run(scope,r=>r.getSession(external.id))).status,'CREATED');assert.equal((await repo.run(scope,r=>r.getSession(native.id))).status,'CREATED');
  }finally{await f.close();}
 });
 test('P5 T07 mapping and replay races serialize across independent service instances',async()=>{
  const f=await fixture();let second;try{
   const mapped=await Promise.all(Array.from({length:4},()=>f.service.mapAgent(f.operator,{externalId:'opaque-agent',internalAgentId:f.agent.id})));assert.equal(new Set(mapped.map(m=>m.id)).size,1);
   await f.service.mapExecution(f.operator,{externalId:'opaque-run',externalAgentId:'opaque-agent'});await f.service.receive(f.source,f.event());
   second=await fixture('run',{owner:f.owner,route:f.route,agent:f.agent,token:f.token});
   await Promise.all([f.service.replay(f.operator),second.service.replay(second.operator)]);assert.equal((await f.service.resolveExecution(f.operator,'opaque-run')).version,2);
   const accepted=await row("SELECT count(*)::int n FROM command_audit WHERE owner_id=$1 AND command_type='external.event.applied'",[f.owner.id]);assert.equal(accepted.n,1);
  }finally{await second?.close();await f.close();}
 });
 test('P5 T07 explicit external delegation correlation preserves target identity and never mutates Task or delegation',async()=>{
  const f=await fixture();try{
   const sourceAgent=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'Source external Agent','EXTERNAL','ACTIVE') RETURNING id",[f.owner.id,f.route.id]);
   const parent=await row("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,'{}') RETURNING id",[f.owner.id,sourceAgent.id,f.route.id]);
   const repo=new CollaborationRepository(f.app.get(DatabaseService)),scope={ownerId:f.owner.id,actorReference:'external-approved-test',correlationId:randomUUID()};
   const c=await repo.run(scope,r=>r.createSession({authority:'EXTERNAL',rootTaskId:parent.id,participantAgentIds:[sourceAgent.id,f.agent.id],idempotencyKey:randomUUID()}));
   const d=await repo.run(scope,r=>r.createDelegation({sessionId:c.id,sourceAgentId:sourceAgent.id,targetAgentId:f.agent.id,parentTaskId:parent.id,idempotencyKey:randomUUID()}));
   await f.service.mapAgent(f.operator,{externalId:'opaque-agent',internalAgentId:f.agent.id});await f.service.mapAgent(f.operator,{externalId:'source-agent',internalAgentId:sourceAgent.id});
   await assert.rejects(f.service.mapExecution(f.operator,{externalId:'wrong-target',externalAgentId:'source-agent',collaborationId:c.id,delegationId:d.id}),match('INVALID_CORRELATION'));
   await f.service.mapExecution(f.operator,{externalId:'opaque-run',externalAgentId:'opaque-agent',collaborationId:c.id,delegationId:d.id});
   await f.service.ingest(f.source,f.event({sourceStatus:'COMPLETED'}));const observed=await f.service.resolveExecution(f.operator,'opaque-run');assert.equal(observed.delegationId,d.id);assert.equal(observed.status,'COMPLETED');
   assert.equal((await repo.run(scope,r=>r.getDelegation(d.id))).status,'REQUESTED');assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[parent.id])).status,'CREATED');
  }finally{await f.close();}
 });
 test('P5 T07 bounded history and disabled registered source prevent injection without losing receipts',async()=>{
  const f=await fixture();try{
   await f.service.receive(f.source,f.event());await f.service.receive(f.source,f.event());
   const first=await f.service.history(f.operator,{limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);
   const last=await f.service.history(f.operator,{limit:1,after:first.nextCursor});assert.equal(last.items.length,1);assert.equal(last.nextCursor,null);assert.notEqual(first.items[0].id,last.items[0].id);
   await assert.rejects(f.service.replay(f.operator,{limit:21}),match('INVALID_INPUT'));
   await getPool().query("UPDATE orchestrators SET registration_status='DISABLED' WHERE id=$1",[f.route.id]);
   await assert.rejects(f.service.receive(f.source,f.event()),match('ACCESS_DENIED'));
   await getPool().query("UPDATE orchestrators SET registration_status='ENABLED' WHERE id=$1",[f.route.id]);assert.equal((await f.service.history(f.operator)).items.length,2);
  }finally{await f.close();}
 });
 test('P5 T07 migration upgrades populated pre-ingestion schema without rewriting legacy identities',async()=>{
  const {Pool}=require('pg'),{randomBytes}=require('node:crypto'),{mkdtempSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join,resolve}=require('node:path');
  const {drizzle}=require('drizzle-orm/node-postgres'),{migrate}=require('drizzle-orm/node-postgres/migrator'),{migrateDatabase,migrationFolder}=require('../dist/database/migrate');
  const db='elyqreth_t07_upgrade_'+randomBytes(12).toString('hex');assert.match(db,/^elyqreth_t07_upgrade_[a-f0-9]{24}$/);
  const folder=mkdtempSync(join(tmpdir(),'elyqreth-t07-upgrade-')),url=new URL(getUrl());url.pathname='/'+db;let pool,created=false;
  try{
   await getPool().query(`CREATE DATABASE "${db}"`);created=true;pool=new Pool({connectionString:url.href});
   const journal=JSON.parse(readFileSync(join(migrationFolder,'meta/_journal.json'),'utf8'));const fullMigrationCount=journal.entries.length;journal.entries=journal.entries.filter(e=>e.idx<7);mkdirSync(join(folder,'meta'));
   writeFileSync(join(folder,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)copyFileSync(join(migrationFolder,e.tag+'.sql'),join(folder,e.tag+'.sql'));
   await migrate(drizzle(pool),{migrationsFolder:folder});
   const owner=(await pool.query("INSERT INTO owners(name) VALUES ('legacy-upgrade') RETURNING id")).rows[0];
   const route=(await pool.query("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'legacy','native') RETURNING id",[owner.id])).rows[0];
   const agent=(await pool.query("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'Legacy Agent','RULE_BASED') RETURNING id",[owner.id,route.id])).rows[0];
   const task=(await pool.query('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,$4) RETURNING *',[owner.id,agent.id,route.id,{instruction:'Legacy input remains unchanged'}])).rows[0];
   const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:url.href,DATABASE_SSL_MODE:'disable'});await migrateDatabase(config.database);
   assert.deepEqual((await pool.query('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0],task);
   assert.equal((await pool.query('SELECT count(*)::int n FROM external_event_inbox')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM drizzle.__drizzle_migrations')).rows[0].n,fullMigrationCount);
  }finally{
   await pool?.end();if(created)await getPool().query(`DROP DATABASE "${db}"`);
   const absolute=resolve(folder),prefix=resolve(tmpdir())+require('node:path').sep;assert.ok(absolute.startsWith(prefix)&&require('node:path').basename(absolute).startsWith('elyqreth-t07-upgrade-'));rmSync(absolute,{recursive:true,force:true});
  }
 });
};
