require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto'),{createServer}=require('node:http');
const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {ConfigModule}=require('../dist/config/config.module'),{validateEnvironment}=require('../dist/config/configuration');
const {HermesObservationModule}=require('../dist/external-orchestrators/hermes-observation.module');
const {HermesObservationService}=require('../dist/external-orchestrators/hermes-observation.service');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority');
const {AgentActivityProjectionService}=require('../dist/city/activity.service');
const {HERMES_DOMAIN,HERMES_CAPABILITIES}=require('../dist/external-orchestrators/hermes.adapter');
const fixture=require('./fixtures/hermes-0.21.2-connectivity.json');
module.exports=({row,getUrl})=>{
 test('Hermes configured registration uses real registry mapping inbox and NPC projection with restart-safe identity',async()=>{
  const owner=await row("INSERT INTO owners(name) VALUES ('hermes-config-test') RETURNING id"),connectionId=randomUUID(),agentId=randomUUID(),runId='run_'+randomUUID().replaceAll('-','');
  let status='running',updated=1794099600,offline=false,app;
  const key=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex'),calls=[];
  const server=createServer((q,r)=>{calls.push(q.url);assert.equal(q.headers.authorization,'Bearer '+key);r.setHeader('Content-Type','application/json');
   if(offline){r.statusCode=503;r.end('{}');return;}
   r.end(JSON.stringify(q.url==='/health'?fixture.health:q.url==='/v1/capabilities'?fixture.capabilities:{object:'hermes.run',run_id:runId,status,updated_at:updated,output:'not-projected-sensitive-output'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile={id:connectionId,ownerId:owner.id,adapterType:'hermes.v1',name:'Configured Hermes',namespace:'integration-test',generation:1,mode:'OBSERVATION_ONLY',enabled:true,
   endpoint:{origin:`http://127.0.0.1:${server.address().port}`,network:'local',allowedAddresses:['127.0.0.1']},credentialRef:'EXTERNAL_SECRET_HERMES_TEST',capabilities:HERMES_CAPABILITIES,
   registeredAgents:[{externalId:'configured-worker',name:'Hermes researcher',internalAgentId:agentId,npcId:'resident-slot-001',executionIds:[runId]}]};
  const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,
   EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([profile]),EXTERNAL_SECRET_HERMES_TEST:key});
  async function open(){class Root{};Module({imports:[ConfigModule.register(config),HermesObservationModule]})(Root);app=await NestFactory.createApplicationContext(Root,{logger:false,abortOnError:false});}
  const session=kind=>app.get(IngestionAuthority).authorize(token,connectionId,randomUUID(),kind,HERMES_DOMAIN);
  const sync=()=>app.get(HermesObservationService).sync(session('operator'),session('ingestion'));
  const projection=()=>app.get(AgentActivityProjectionService).single(agentId);
  try{
   await open();const service=app.get(HermesObservationService);await service.apply(session('operator'));await service.apply(session('operator'));
   assert.equal((await row('SELECT count(*)::int n FROM agents WHERE owner_id=$1',[owner.id])).n,1);
   assert.equal((await row('SELECT count(*)::int n FROM city_agent_bindings WHERE owner_id=$1 AND enabled',[owner.id])).n,1);
   await sync();let view=await projection();assert.equal(view.npcId,'resident-slot-001');assert.equal(view.externalObservation.status,'RUNNING');assert.equal(view.externalObservation.freshness,'RECENT_OBSERVATION');assert.equal(view.currentExecution,null);
   const mappingId=view.externalObservation.mappingId;assert.equal((await sync())[0].duplicate,true);
   status='interrupted';updated++;await sync();assert.equal((await projection()).externalObservation.status,'UNKNOWN');
   status='running';updated++;await sync();assert.equal((await projection()).externalObservation.status,'RUNNING');
   status='waiting_for_approval';updated++;await sync();view=await projection();assert.equal(view.externalObservation.sourceStatus,status);
   status='completed';updated++;await sync();assert.equal((await projection()).externalObservation.status,'COMPLETED');
   await app.close();app=null;await open();assert.equal((await sync())[0].duplicate,true);assert.equal((await projection()).externalObservation.mappingId,mappingId);
   status='running';updated--;assert.equal((await sync())[0].status,'STALE');assert.equal((await projection()).externalObservation.status,'COMPLETED');
   offline=true;await assert.rejects(sync(),e=>e.code==='TRANSIENT_FAILURE');assert.equal((await projection()).externalObservation.status,'COMPLETED');
   assert.equal((await row('SELECT count(*)::int n FROM tasks WHERE owner_id=$1',[owner.id])).n,0);
   assert.equal((await row('SELECT count(*)::int n FROM executions WHERE owner_id=$1',[owner.id])).n,0);
   assert.ok(!JSON.stringify(await projection()).includes('not-projected-sensitive-output'));
  }finally{await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });
};
