require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {HermesObservationService}=require('../dist/external-orchestrators/hermes-observation.service');
const {HERMES_DOMAIN}=require('../dist/external-orchestrators/hermes.adapter');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority');
const {connection,ExternalCredentials}=require('../dist/external-orchestrators/external-configuration');
const {withExternalActivity}=require('../dist/city/external-activity.mapper');
const {mapAgentActivity}=require('../dist/city/activity.mapper');
const now='2026-11-08T01:00:00.000Z',runId='run_'+'a'.repeat(32);
function fixture(){const calls=[],ownerId=randomUUID(),connectionId=randomUUID(),agentId=randomUUID(),token='synthetic-local-operator-key-123456';
 const c=connection({id:connectionId,ownerId,adapterType:'hermes.v1',name:'Hermes fixture',namespace:'manual',generation:1,mode:'OBSERVATION_ONLY',enabled:true,
 endpoint:{origin:'http://127.0.0.1:8642',network:'local',allowedAddresses:['127.0.0.1']},credentialRef:'EXTERNAL_SECRET_HERMES_TEST',capabilities:['health','agents','status','events.poll'],
 registeredAgents:[{externalId:'manual-worker',name:'Renamable display',internalAgentId:agentId,npcId:'resident-slot-001',executionIds:[runId]}]});
 const config={value:{nodeEnv:'test',host:'127.0.0.1',registry:{ownerId,token},externalOrchestrators:{connections:[c],credentials:new ExternalCredentials(new Map([['EXTERNAL_SECRET_HERMES_TEST','synthetic-hermes-secret']]))}}};
 const authority=new IngestionAuthority(config),op=authority.authorize(token,c.id,randomUUID(),'operator',HERMES_DOMAIN),source=authority.authorize(token,c.id,randomUUID(),'ingestion',HERMES_DOMAIN);
 const agents={get:async()=>({id:agentId,type:'EXTERNAL',orchestratorId:connectionId,lifecycleStatus:'ACTIVE'}),registerConfiguredHermes:async()=>{calls.push(['register']);return {};},registerConfiguredHermesConnection:async()=>{calls.push(['connection']);}};
 const bindings={byAgent:async()=>null,byNpc:async()=>null,create:async v=>{calls.push(['bind',v]);return {...v,id:randomUUID()};}};
 const event={connectionId,namespace:c.namespace,generation:1,eventId:'one',kind:'execution.observed',externalAgentId:'manual-worker',externalExecutionId:runId,
 sourceStatus:'running',normalizedStatus:'RUNNING',receivedAt:now,sequence:{domain:HERMES_DOMAIN,value:'20000000000000001'}};
 const adapters={execution:async()=>{calls.push(['read']);return {};},events:async()=>{calls.push(['poll']);return {items:[event]};}};
 const ingestion={mapAgent:async v=>{calls.push(['mapAgent']);return {id:randomUUID()};},mapExecution:async()=>{calls.push(['mapRun']);return {};},resolveExecution:async()=>({id:randomUUID()}),
 ingest:async(_source,event)=>{calls.push(['ingest',event]);return {receipt:{status:event.kind==='agent.observed'?'OBSERVED':'APPLIED'},duplicate:false};}};
 return {calls,c,agentId,config,authority,op,source,agents,bindings,adapters,ingestion,event,service:new HermesObservationService(authority,adapters,ingestion,agents,bindings)};
}
test('Hermes config apply validates provider association and uses existing explicit mapping and NPC binding services',async()=>{
 const f=fixture(),result=await f.service.apply(f.op);assert.equal(result[0].agentId,f.agentId);assert.deepEqual(f.calls.map(c=>c[0]),['read','connection','register','mapAgent','mapRun','bind']);
});
test('Hermes config apply cannot take over native Agents or conflicting existing NPC bindings',async()=>{
 for(const conflict of ['native','npc']){const f=fixture();if(conflict==='native')f.agents.get=async()=>({type:'LLM',orchestratorId:f.c.id,lifecycleStatus:'ACTIVE'});
 else f.bindings.byNpc=async()=>({agentId:randomUUID()});await assert.rejects(f.service.apply(f.op));assert.equal(f.calls.length,0);}
});
test('Hermes sync keeps source approval separate rejects copied grants and never refreshes stale/conflicting snapshots',async()=>{
 const f=fixture();await assert.rejects(f.service.sync(f.op,{...f.source}),e=>e.code==='ACCESS_DENIED');assert.equal(f.calls.length,0);
 await f.service.sync(f.op,f.source);assert.deepEqual(f.calls.filter(c=>c[0]==='ingest').map(c=>c[1].kind),['execution.observed','agent.observed']);
 f.calls.length=0;f.ingestion.ingest=async()=>({receipt:{status:'STALE'},duplicate:false});await f.service.sync(f.op,f.source);assert.deepEqual(f.calls.map(c=>c[0]),['poll']);
});
test('Hermes identity/run config changes revoke existing sessions before provider access',async()=>{
 const f=fixture();f.config.value.externalOrchestrators.connections=[{...f.c,registeredAgents:[{...f.c.registeredAgents[0],executionIds:[]}]}];
 await assert.rejects(f.service.sync(f.op,f.source),e=>e.code==='ACCESS_DENIED');assert.equal(f.calls.length,0);
});
test('Hermes external projection is current-source scoped and separates freshness from native lifecycle',()=>{
 const f=fixture(),raw={agent:{id:f.agentId,name:'Registry name',type:'EXTERNAL',availability:'ACTIVE',version:1},binding:null,current:null,outcome:null,lastExecution:null,
 activeCount:0,queuedCount:0,createdCount:0,lastActivityAt:now,external:{mappingId:randomUUID(),version:2,status:'RUNNING',sourceStatus:'running',observedAt:now,lastSynchronizedAt:now,
 externalExecutionId:runId,externalAgentId:'manual-worker',mappingStatus:'ACTIVE',connectionId:f.c.id,namespace:f.c.namespace,generation:1,registrationStatus:'ENABLED'}};
 const project=(at=now)=>withExternalActivity(mapAgentActivity(raw,at),raw,f.config.value.externalOrchestrators);
 assert.equal(project().externalObservation.freshness,'RECENT_OBSERVATION');assert.equal(project().currentExecution,null);assert.equal(project().activityStatus,'UNKNOWN');
 assert.equal(project('2026-11-08T01:00:31.000Z').externalObservation.freshness,'STALE');
 raw.external.unknownSourceStatus='interrupted';assert.equal(project().externalObservation.status,'UNKNOWN');assert.equal(project().externalObservation.sourceStatus,'interrupted');
 raw.external.generation=2;
 assert.equal(project().externalObservation.status,'UNKNOWN');assert.equal(project().externalObservation.externalExecutionId,null);
});
test('configured Hermes creation obeys existing registered-DISABLED then ACTIVE event contracts',async()=>{
 const {AgentsService}=require('../dist/agents/agents.service'),schema=require('../dist/database/schema'),{eventDefinitions}=require('../dist/events/contracts/event-contracts');
 const ownerId=randomUUID(),routeId=randomUUID(),agentId=randomUUID(),events=[];let stored=null,checks=0;
 const tx={select:()=>({from:table=>({where:()=>({for:async()=>table===schema.orchestrators?[{id:routeId,ownerId,type:'hermes.v1',registrationStatus:'ENABLED'}]:stored?[stored]:[]})})}),
  insert:table=>({values:value=>{if(table!==schema.agents)return Promise.resolve();stored={...value,version:1,description:null,createdAt:new Date(now),updatedAt:new Date(now)};return {returning:async()=>[stored]};}}),
  update:()=>({set:value=>({where:()=>({returning:async()=>{stored={...stored,...value,version:2};return [stored];}})})})};
 const service=new AgentsService({db:{transaction:run=>run(tx)}},{value:{registry:{ownerId}}},{appendState:async(_tx,event)=>{
  assert.equal(stored.lifecycleStatus,eventDefinitions[event.eventType][1]);events.push(event.eventType);
 }});
 const result=await service.registerConfiguredHermes(agentId,'Configured worker',routeId,()=>{checks++;});
 assert.equal(result.lifecycleStatus,'ACTIVE');assert.deepEqual(events,['agent.registered','agent.active']);assert.ok(checks>=3);
 const repeated=await service.registerConfiguredHermes(agentId,'Renamed display',routeId,()=>{});assert.equal(repeated.id,result.id);assert.equal(events.length,2);
});
