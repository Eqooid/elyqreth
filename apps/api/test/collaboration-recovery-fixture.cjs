const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID,randomBytes}=require('node:crypto');
const {createApplication}=require('../dist/application');const {validateEnvironment}=require('../dist/config/configuration');const {ApiLogger}=require('../dist/common/api-logger');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {NativeCoordinationService}=require('../dist/collaboration/native-coordination.service');const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');const {definition,deferred}=require('./runtime-fixtures.cjs');
module.exports=({row,getUrl,getPool})=>{
 async function fixture(timeout=120000,extra={}){
  const owner=await row("INSERT INTO owners(name) VALUES ('native-collaboration') RETURNING id"),route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native','native','ENABLED') RETURNING id",[owner.id]);
  const agents=[];for(let i=0;i<2;i++)agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,$3,'RULE_BASED','ACTIVE') RETURNING id",[owner.id,route.id,'Native '+i]));
  const token=randomBytes(32).toString('hex'),config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token,RUNTIME_ENABLED:'true',
   RUNTIME_BINDINGS:JSON.stringify(agents.map((a,i)=>({agentId:a.id,orchestratorId:route.id,definition:definition(i===1?timeout:120000)}))),...extra});
  let app;const open=async()=>{app=await createApplication(config);app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};await app.listen(0,'127.0.0.1');};await open();
  const http=async(path,method='GET',body,headers={},auth=token)=>{
   const res=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:res.status,data:await res.json()};
  };
  const root=await http('tasks','POST',{agentId:agents[0].id,input:{instruction:'Parent task stays complete'},idempotencyKey:randomUUID()});assert.equal(root.status,201);
  const parent=await http(`tasks/${root.data.id}/execute`,'POST',{}, {'if-match':`"${root.data.version}"`});assert.equal(parent.status,200);
  const session=await http('collaborations','POST',{rootTaskId:root.data.id,participantAgentIds:agents.map(a=>a.id),idempotencyKey:randomUUID()});assert.equal(session.status,201);
  const requested=await http(`collaborations/${session.data.id}/delegations`,'POST',{sourceAgentId:agents[0].id,targetAgentId:agents[1].id,parentTaskId:root.data.id,sourceExecutionId:parent.data.execution.id,idempotencyKey:randomUUID()});assert.equal(requested.status,201);
  const d=requested.data,path=`collaborations/${session.data.id}/delegations/${d.id}`,input={instruction:'Three child words',idempotencyKey:randomUUID()};
  const activate=(value=input,auth=token)=>http(path+'/activate','POST',value,{},auth);
  const control=fn=>{const real=app.get(TextStatisticsStrategy);app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:(r,c)=>fn(r,c,real)}}]);};
  return {owner,route,agents,parent:parent.data,session:session.data,d,path,input,http,activate,control,token,config,
   app:()=>app,service:()=>app.get(NativeCoordinationService),coordinator:()=>app.get(RuntimeCoordinator),restart:async()=>{await app.close();await open();},close:()=>app.close()};
 }
 return fixture;
};
