const {randomUUID}=require('node:crypto');
const {validateEnvironment}=require('../dist/config/configuration');
const {providerSettingsDigest}=require('../dist/runtime/providers/provider-configuration');
const {OLLAMA_CAPABILITIES}=require('../dist/runtime/providers/ollama/ollama.mapper');
const base=require('./provider-fixtures.cjs');
function fixture(origin='http://127.0.0.1:11434',timeout=1000){
 const settings={...base.settings(),providerId:'ollama',capabilities:{...OLLAMA_CAPABILITIES,toolCalls:false},endpoint:{origin,network:'local',allowedAddresses:['127.0.0.1']}};
 const config=validateEnvironment({...base.environment(),LLM_REQUEST_TIMEOUT_MS:String(timeout),LLM_PROFILES:JSON.stringify([settings])});
 const profile={id:settings.id,profileVersion:settings.profileVersion,model:settings.model,capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)};
 const definition={...base.definition(),providerProfile:profile};
 const controller=new AbortController();
 const context={executionId:randomUUID(),correlationId:randomUUID(),profile,deadlineAt:new Date(Date.now()+10000).toISOString(),signal:controller.signal};
 const request={messages:[{role:'system',content:'Return short plain text.'},{role:'user',content:'Nonsensitive fixture'}],maxOutputTokens:128,output:{kind:'text'}};
 return {settings,config,profile,definition,controller,context,request};
}
const response=(model='fixture:model')=>({model,message:{role:'assistant',content:'Safe fixture answer'},done:true,done_reason:'stop',prompt_eval_count:2,eval_count:3,total_duration:1000000});
module.exports={fixture,response};
