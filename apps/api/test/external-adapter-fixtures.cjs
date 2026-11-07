require('reflect-metadata');
const {randomUUID}=require('node:crypto');
const {connection,ExternalCredentials}=require('../dist/external-orchestrators/external-configuration');
const {AdapterRegistry}=require('../dist/external-orchestrators/adapter-registry');
const {ExternalAdapterService}=require('../dist/external-orchestrators/external-adapter.service');
const {capabilities}=require('../dist/external-orchestrators/adapter.contract');
function fixture(patch={},methods={}) {
 const c=connection({id:randomUUID(),ownerId:randomUUID(),adapterType:'fixture.v1',name:'Reviewed test connection',namespace:'installation-a',generation:1,
  mode:'OBSERVATION_ONLY',enabled:true,endpoint:{origin:'https://orchestrator.example',network:'public',allowedAddresses:['8.8.8.8']},capabilities:[...capabilities],...patch});
 const provenance={connectionId:c.id,namespace:c.namespace,generation:c.generation},calls=[];
 const agent={...provenance,externalId:'opaque/agent:one',name:'Safe agent'};
 const execution={...provenance,externalId:'opaque/run:one',externalAgentId:agent.externalId,sourceStatus:'vendor-hibernating',presentationStatus:'UNKNOWN'};
 const adapter={type:'fixture.v1',capabilities:[...capabilities],validateConfiguration(){},
  async describe(ctx){calls.push(['describe',ctx]);return {...provenance,capabilities:[...capabilities],revision:'revision-1',expiresAt:new Date(Date.now()+60000).toISOString()};},
  async health(ctx){calls.push(['health',ctx]);return {...provenance,state:'HEALTHY',checkedAt:new Date().toISOString()};},
  async discoverAgents(ctx,page){calls.push(['agents',ctx,page]);return {items:[agent],nextCursor:null};},
  async discoverExecutions(){return {items:[execution],nextCursor:null};},async getExecution(){return execution;},
  async getResult(){return {...provenance,executionId:execution.externalId,availability:'AVAILABLE',reference:'opaque-result-1'};},
  async pollEvents(){return {items:[{...provenance,eventId:'provider-event-1',kind:'execution.observed',externalExecutionId:execution.externalId,externalAgentId:agent.externalId,receivedAt:new Date().toISOString(),sequence:{domain:'run-incarnation',value:'90071992547409930'}}],nextCursor:null};},
  async *subscribeEvents(){},async dispatch(){calls.push(['dispatch']);return execution;},async cancel(){calls.push(['cancel']);return execution;},async lookupSubmission(){return execution;},...methods};
 const credentials=new ExternalCredentials(new Map([['EXTERNAL_SECRET_FIXTURE','fixture-bearer-value']]));
 const config={externalOrchestrators:{connections:[c],credentials}},logs=[],registry=new AdapterRegistry([adapter]);
 const logger={info:(...v)=>logs.push(v)},transport={get:async()=>{throw Error('No network allowed in contract fixture');}};
 const service=new ExternalAdapterService({value:config},registry,transport,logger);
 const access={ownerId:c.ownerId,correlationId:randomUUID(),operations:[...capabilities]};
 return {c,provenance,calls,agent,execution,adapter,config,credentials,logs,registry,logger,transport,service,access};
}
module.exports={fixture};
