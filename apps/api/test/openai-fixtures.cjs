'use strict';
const {randomUUID}=require('node:crypto');
const base=require('./provider-fixtures.cjs');
const {validateEnvironment}=require('../dist/config/configuration');
const {providerSettingsDigest}=require('../dist/runtime/providers/provider-configuration');
const {OPENAI_CAPABILITIES}=require('../dist/runtime/providers/openai/openai.mapper');
// Noncredential sentinel used only with test transports; never sent to a server.
const TEST_KEY='mock-only-not-a-real-credential';
function fixture(timeout=1000){
 const settings={...base.settings(),id:'cloud.reviewed',providerId:'openai',model:'reviewed-model',capabilities:{...OPENAI_CAPABILITIES,toolCalls:false},
  endpoint:{origin:'https://api.openai.com',network:'public',allowedAddresses:['8.8.8.8']},credentialEnv:'OPENAI_API_KEY'};
 const env={...base.environment(),LLM_ALLOW_PAID:'true',OPENAI_API_KEY:TEST_KEY,LLM_REQUEST_TIMEOUT_MS:String(timeout),LLM_PROFILES:JSON.stringify([settings])};
 const config=validateEnvironment(env),profile={id:settings.id,profileVersion:1,model:settings.model,capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)};
 const definition={...base.definition(),providerProfile:profile},controller=new AbortController();
 const context={executionId:randomUUID(),correlationId:randomUUID(),profile,deadlineAt:new Date(Date.now()+10000).toISOString(),signal:controller.signal};
 const request={messages:[{role:'system',content:'Answer briefly.'},{role:'user',content:'Harmless fixture'}],maxOutputTokens:128,output:{kind:'text'}};
 return {settings,env,config,profile,definition,controller,context,request};
}
const response=()=>({id:'resp_fixture',object:'response',status:'completed',model:'reviewed-model-snapshot',error:null,incomplete_details:null,
 output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Safe answer',annotations:[]}]}],
 usage:{input_tokens:2,output_tokens:3,total_tokens:5}});
module.exports={fixture,response,TEST_KEY};
