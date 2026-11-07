'use strict';
// Privileged provider diagnostic, not Task execution. Never in the CI glob.
require('reflect-metadata');
const {randomUUID}=require('node:crypto');
const {llmEnvironment,providerSettingsDigest}=require('../dist/runtime/providers/provider-configuration');
const {OpenaiProvider}=require('../dist/runtime/providers/openai/openai.provider');
const {OpenaiHttpTransport,openaiDns}=require('../dist/runtime/providers/openai/openai-http.transport');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');

async function main(){
 if(process.env.ELYQRETH_OPENAI_LIVE!=='true'){
  console.log(JSON.stringify({status:'NOT RUN',reason:'Explicit ELYQRETH_OPENAI_LIVE=true is required'}));return;
 }
 if(!['development','test'].includes(process.env.NODE_ENV))throw new RuntimeError('ACCESS_DENIED','provider');
 const errors=[],llm=llmEnvironment(process.env,true,errors);
 if(errors.length||!llm)throw new RuntimeError('CONFIGURATION_ERROR','provider');
 const settings=llm.profiles.find(p=>p.id===process.env.ELYQRETH_OPENAI_LIVE_PROFILE&&p.providerId==='openai');
 if(!settings)throw new RuntimeError('CONFIGURATION_ERROR','provider');
 // Validate only the explicitly chosen profile; no other configured provider is
 // contacted. Reuse its isolated credential and reviewed endpoint/model policy.
 const config={value:{llm:{...llm,profiles:[settings],credentials:llm.credentials}}},logs=[];
 const provider=new OpenaiProvider(config,new OpenaiHttpTransport(openaiDns),{info:(_event,fields)=>logs.push(fields)});
 const profile={id:settings.id,profileVersion:settings.profileVersion,model:settings.model,capabilities:settings.capabilities,
  bindingDigest:providerSettingsDigest(settings)};
 const tokens=Math.min(128,llm.maxOutputTokens),timeout=Math.min(30000,llm.requestTimeoutMs);
 const definition={schemaVersion:1,definitionId:'diagnostic.openai',definitionVersion:1,agentType:'LLM',strategyType:'LLM',strategyId:'llm.text.v1',
  outputType:'text',providerProfile:profile,toolCapabilities:[],budget:{executionTimeoutMs:timeout,providerTimeoutMs:timeout,toolTimeoutMs:0,
  maxOutputTokens:tokens,maxProviderRounds:1,maxToolCalls:0,maxResultBytes:32768}};
 const selection=new ProviderSelectionService(config,new LlmProviderRegistry([provider]));selection.onModuleInit();
 const result=await selection.select(definition).provider.generate({messages:[{role:'user',content:'Reply with the word READY.'}],maxOutputTokens:tokens,output:{kind:'text'}},
  {executionId:randomUUID(),correlationId:randomUUID(),profile,deadlineAt:new Date(Date.now()+timeout).toISOString(),signal:new AbortController().signal});
 console.log(JSON.stringify({status:'PASS',kind:'live-provider-diagnostic',model:logs[0]?.model,textReturned:result.kind==='text'&&result.text.length>0,
  usage:result.usage??null,durationMs:logs[0]?.durationMs,taskExecution:false}));
}
main().catch(error=>{const safe=error instanceof RuntimeError?error:new RuntimeError('INTERNAL_RUNTIME_ERROR','provider');
 console.error(JSON.stringify({status:'FAIL',error:safe.toJSON()}));process.exitCode=1;});
