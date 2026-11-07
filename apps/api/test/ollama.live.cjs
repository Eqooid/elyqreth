'use strict';
// Opt-in provider diagnostic only. UUIDs identify this probe; no Agent, Task,
// Execution or fake database/user record is created. Never part of CI globs.
require('reflect-metadata');
const {randomUUID}=require('node:crypto');
const {get}=require('node:http');
const {llmEnvironment,providerSettingsDigest}=require('../dist/runtime/providers/provider-configuration');
const {OllamaProvider}=require('../dist/runtime/providers/ollama/ollama.provider');
const {OllamaHttpTransport,ollamaDns}=require('../dist/runtime/providers/ollama/ollama-http.transport');
const {OLLAMA_CAPABILITIES}=require('../dist/runtime/providers/ollama/ollama.mapper');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');

async function installed(origin){
 return new Promise((resolve,reject)=>{
  const request=get(new URL('/api/tags',origin),{agent:false,maxHeaderSize:8192,signal:AbortSignal.timeout(3000),headers:{Accept:'application/json','Accept-Encoding':'identity'}},response=>{
   if(response.statusCode!==200){response.destroy();reject(new Error('unavailable'));return;}
   let size=0;const chunks=[];response.on('error',reject);
   response.on('data',chunk=>{size+=chunk.length;if(size>65536){response.destroy();request.destroy();reject(new Error('oversized'));}else chunks.push(chunk);});
   response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('invalid'));}});
  });request.on('error',reject);
 });
}
async function main(){
 if(process.env.ELYQRETH_OLLAMA_LIVE!=='true'){console.log(JSON.stringify({status:'NOT RUN',reason:'Explicit ELYQRETH_OLLAMA_LIVE=true is required'}));return;}
 if(process.env.NODE_ENV==='production')throw new RuntimeError('ACCESS_DENIED','provider');
 const origin=process.env.ELYQRETH_OLLAMA_LIVE_ORIGIN??'http://127.0.0.1:11434',model=process.env.ELYQRETH_OLLAMA_LIVE_MODEL;
 let url;try{url=new URL(origin);}catch{throw new RuntimeError('CONFIGURATION_ERROR','provider');}
 // Standalone live diagnostics are deliberately host-loopback HTTP only.
 if(url.origin!==origin||url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname))throw new RuntimeError('CONFIGURATION_ERROR','provider');
 if(!model)throw new RuntimeError('CONFIGURATION_ERROR','provider');
 let tags;try{tags=await installed(origin);}catch{console.log(JSON.stringify({status:'NOT RUN',reason:'Local Ollama server/model listing unavailable'}));return;}
 const entry=Array.isArray(tags.models)?tags.models.find(m=>m?.name===model||m?.model===model):undefined;
 if(!entry||typeof entry.digest!=='string'||!/^[a-f0-9]{64}$/.test(entry.digest)){
  console.log(JSON.stringify({status:'NOT RUN',reason:'Requested installed model and digest not found; no pull performed'}));return;
 }
 if(process.env.ELYQRETH_OLLAMA_LIVE_DIGEST && process.env.ELYQRETH_OLLAMA_LIVE_DIGEST!==entry.digest)throw new RuntimeError('MODEL_UNAVAILABLE','provider');
 const settings={id:'diagnostic.local',profileVersion:1,providerId:'ollama',model,capabilities:{...OLLAMA_CAPABILITIES,toolCalls:false},
  endpoint:{origin,network:'local',allowedAddresses:[url.hostname==='[::1]'?'::1':'127.0.0.1']}};
 const errors=[],llm=llmEnvironment({RUNTIME_LLM_ENABLED:'true',LLM_PROFILES:JSON.stringify([settings]),
  LLM_REQUEST_TIMEOUT_MS:'60000',LLM_MAX_OUTPUT_TOKENS:'256'},true,errors);
 if(errors.length||!llm)throw new RuntimeError('CONFIGURATION_ERROR','provider');
 const config={value:{llm}},logs=[];
 const provider=new OllamaProvider(config,new OllamaHttpTransport(ollamaDns),{info:(_event,metrics)=>logs.push(metrics)});
 const profile={id:settings.id,profileVersion:1,model,capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)};
 const definition={schemaVersion:1,definitionId:'diagnostic.ollama',definitionVersion:1,agentType:'LLM',strategyType:'LLM',strategyId:'llm.text.v1',
  outputType:'text',providerProfile:profile,toolCapabilities:[],budget:{executionTimeoutMs:60000,providerTimeoutMs:60000,toolTimeoutMs:0,maxOutputTokens:256,maxProviderRounds:1,maxToolCalls:0,maxResultBytes:32768}};
 const selection=new ProviderSelectionService(config,new LlmProviderRegistry([provider]));selection.onModuleInit();
 const context={executionId:randomUUID(),correlationId:randomUUID(),profile,deadlineAt:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
 const result=await selection.select(definition).provider.generate({messages:[{role:'user',content:'Reply with the word READY. /no_think'}],maxOutputTokens:256,output:{kind:'text'}},context);
 console.log(JSON.stringify({status:'PASS',kind:'live-provider-diagnostic',model,modelDigest:entry.digest,text:result.text,
  usage:result.usage??null,durationMs:logs[0]?.durationMs,timeoutMs:60000,taskExecution:false}));
}
main().catch(error=>{const safe=error instanceof RuntimeError?error:new RuntimeError('INTERNAL_RUNTIME_ERROR','provider');console.error(JSON.stringify({status:'FAIL',error:safe.toJSON()}));process.exitCode=1;});
