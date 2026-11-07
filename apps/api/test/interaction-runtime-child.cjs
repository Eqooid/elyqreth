// Test-only process: genuine Nest/coordinator/persistence with a controlled strategy barrier.
// Configuration arrives over private IPC, never argv/logs/browser or a public test endpoint.
require('reflect-metadata');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {ApiLogger}=require('../dist/common/api-logger');
const {RuntimeCoordinator}=require('../dist/runtime/runtime-coordinator');
const {StrategyRegistry}=require('../dist/runtime/strategy-registry');
const {TextStatisticsStrategy}=require('../dist/runtime/strategies/text-statistics.strategy');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
let app,release,mode='success',dispatches=0;
process.on('message',async message=>{
 try{
  if(message?.kind==='open'){
   app=await createApplication(validateEnvironment(message.env));app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};
   const genuine=app.get(TextStatisticsStrategy);
   app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',execute:async(r,c)=>{
    dispatches++;process.send({kind:'entered',taskId:r.ids.taskId,executionId:r.ids.executionId});
    const selected=mode;let abort;
    try{await new Promise((resolve,reject)=>{release=resolve;abort=()=>reject(c.signal.reason);c.signal.addEventListener('abort',abort,{once:true});if(c.signal.aborted)abort();});}
    finally{c.signal.removeEventListener('abort',abort);release=null;}
    if(selected==='failure')throw new RuntimeError('INTERNAL_RUNTIME_ERROR');return genuine.execute(r,c);
   }}}]);await app.listen(message.port??0,'127.0.0.1');process.send({kind:'ready',origin:await app.getUrl()});
  }else if(message?.kind==='mode'){mode=message.mode;process.send({kind:'mode-set'});}
  else if(message?.kind==='release'){release?.();process.send({kind:'released'});}
  else if(message?.kind==='inspect')process.send({kind:'inspection',dispatches});
  else if(message?.kind==='close'){await app?.close();process.send({kind:'closed'});process.disconnect();}
 }catch(error){process.send?.({kind:'fixture-error',name:error?.name,code:error?.code,message:error?.message});process.exitCode=1;}
});
