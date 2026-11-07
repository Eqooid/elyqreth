'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateEnvironment}=require('../dist/config/configuration');
const {providerSettingsDigest}=require('../dist/runtime/providers/provider-configuration');
const {modelToolDescription}=require('../dist/runtime/contracts/tool-description');
const v=require('../dist/runtime/contracts/provider-validation');
const {OllamaProvider}=require('../dist/runtime/providers/ollama/ollama.provider');
const {OpenaiProvider}=require('../dist/runtime/providers/openai/openai.provider');
const {ollamaRequest,ollamaResponse}=require('../dist/runtime/providers/ollama/ollama.mapper');
const {openaiRequest,openaiResponse}=require('../dist/runtime/providers/openai/openai.mapper');
const {match}=require('./llm-fixtures.cjs');
function fixture(kind){
 const f=require('./'+kind+'-fixtures.cjs').fixture(),settings={...f.settings,capabilities:{...f.settings.capabilities,toolCalls:true}};
 const env=kind==='openai'?f.env:require('./provider-fixtures.cjs').environment();
 const config=validateEnvironment({...env,LLM_PROFILES:JSON.stringify([settings])}),profile={...f.profile,capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)};
 return {...f,config,settings,profile,context:{...f.context,profile},request:{...f.request,tools:[modelToolDescription('calculator',1)]}};
}
const args={operation:'multiply',a:12,b:8};
const ollamaCall=()=>({...require('./ollama-fixtures.cjs').response(),message:{role:'assistant',content:'',thinking:'Private bounded reasoning',
 tool_calls:[{id:'native_call_1',type:'function',function:{index:0,name:'calculator',arguments:args}}]}});
const openaiCall=()=>({...require('./openai-fixtures.cjs').response(),output:[
 {type:'reasoning',id:'rs_fixture',summary:[],encrypted_content:'opaque_reasoning_cipher'},
 {type:'function_call',id:'fc_fixture',call_id:'native_call_1',name:'calculator',arguments:JSON.stringify(args),status:'completed'}]});
function follow(f,result){return {...f.request,messages:[...f.request.messages,{role:'assistant',content:'',calls:result.calls},
 {role:'tool',callId:result.calls[0].callId,toolId:'calculator',content:'{"result":96}'}],continuation:result.continuation};}

test('provider-neutral tool schemas are compiled, closed and capability gated; malformed/cyclic/getter proposals never become commands',()=>{
 const f=fixture('ollama'),description=f.request.tools[0];assert.equal(description.inputSchema.additionalProperties,false);
 assert.equal(v.llmGenerateRequest(f.request,512,true).tools[0],description);
 assert.throws(()=>v.llmGenerateRequest(f.request,512,false),match('UNSUPPORTED_CAPABILITY'));
 for(const input of [{...f.request,tools:[{...description,inputSchema:{$ref:'http://internal'}}]},
  {...f.request,tools:[description,description]},{...f.request,continuation:{}},
  {...f.request,messages:[...f.request.messages,{role:'tool',toolId:'calculator',callId:'missing',content:'{}'}]}])assert.throws(()=>v.llmGenerateRequest(input,512,true));
 const cyclic={};cyclic.self=cyclic;
 for(const args of ['not JSON',[],cyclic,{secret:'private'},Object.defineProperty({},'a',{enumerable:true,get:()=>assert.fail('getter')} )])
  assert.throws(()=>v.llmGenerateResult({kind:'tool_proposals',calls:[{callId:'c',toolId:'calculator',arguments:args}]},f.profile.capabilities),match('INVALID_PROVIDER_OUTPUT'));
});

test('Ollama maps approved schemas/native IDs/arguments and replays private thinking plus ordered named tool results',async()=>{
 const f=fixture('ollama'),sent=[],logs=[];
 const provider=new OllamaProvider({value:f.config},{postChat:async(_e,body)=>{sent.push(body);return sent.length===1?ollamaCall():require('./ollama-fixtures.cjs').response();}},{info:(...a)=>logs.push(a)});
 const first=await provider.generate(f.request,f.context);assert.equal(first.kind,'tool_proposals');assert.equal(first.calls[0].callId,'native_call_1');
 const final=await provider.generate(follow(f,first),f.context);assert.equal(final.kind,'text');
 assert.equal(sent[0].tools[0].function.name,'calculator');assert.equal(sent[0].tools[0].function.parameters.type,'object');
 assert.equal(sent[1].messages.at(-2).thinking,'Private bounded reasoning');assert.equal(sent[1].messages.at(-1).tool_name,'calculator');
 assert.equal(sent[1].messages.at(-1).content,'{"result":96}');assert.ok(!JSON.stringify(first).includes('Private bounded reasoning'));
 assert.ok(!JSON.stringify(logs).includes('Private bounded reasoning'));assert.equal(sent[0].stream,false);
 const raw=ollamaCall();delete raw.message.tool_calls[0].id;assert.match(ollamaResponse(raw,f.profile,128).result.calls[0].callId,/^ollama_/);
 const whitespace=ollamaCall();whitespace.message.thinking='\n';whitespace.message.content=' ';
 assert.equal((await new OllamaProvider({value:f.config},{postChat:async()=>whitespace},{info(){}}).generate(f.request,f.context)).kind,'tool_proposals');
});

test('OpenAI replays complete stateless function/reasoning items and emits correlated function_call_output without stored responses',async()=>{
 const f=fixture('openai'),sent=[],logs=[];
 const provider=new OpenaiProvider({value:f.config},{postResponses:async(_e,body)=>{sent.push(body);return sent.length===1?openaiCall():require('./openai-fixtures.cjs').response();}},{info:(...a)=>logs.push(a)});
 const first=await provider.generate(f.request,f.context);assert.equal(first.calls[0].callId,'native_call_1');assert.deepEqual(first.calls[0].arguments,args);
 assert.ok(!JSON.stringify(first).includes('opaque_reasoning_cipher'));assert.ok(!require('node:util').inspect(first).includes('opaque_reasoning_cipher'));
 const final=await provider.generate(follow(f,first),f.context);assert.equal(final.kind,'text');
 assert.equal(sent[0].tools[0].type,'function');assert.equal(sent[0].tools[0].strict,true);assert.equal(sent[0].parallel_tool_calls,false);
 assert.equal(sent[1].input.at(-3).encrypted_content,'opaque_reasoning_cipher');assert.equal(sent[1].input.at(-2).id,'fc_fixture');
 assert.deepEqual(sent[1].input.at(-1),{type:'function_call_output',call_id:'native_call_1',output:'{"result":96}'});
 assert.equal(sent[1].store,false);assert.equal(sent[1].previous_response_id,undefined);assert.ok(!JSON.stringify(logs).includes('opaque_reasoning_cipher'));
});

test('continuation refuses transcript/schema tampering, cross-Execution/correlation reuse and forged handles before another provider call',async()=>{
 for(const kind of ['ollama','openai']){
  const f=fixture(kind);let count=0;
  const provider=kind==='ollama'?new OllamaProvider({value:f.config},{postChat:async()=>{count++;return ollamaCall();}},{info(){}}):
   new OpenaiProvider({value:f.config},{postResponses:async()=>{count++;return openaiCall();}},{info(){}});
  const first=await provider.generate(f.request,f.context),next=follow(f,first);
  for(const field of ['executionId','correlationId'])await assert.rejects(provider.generate(next,{...f.context,[field]:require('node:crypto').randomUUID()}),match('CONFIGURATION_ERROR'));
  await assert.rejects(provider.generate({...next,messages:[{role:'system',content:'tampered'},...next.messages.slice(1)]},f.context),match('CONFIGURATION_ERROR'));
  await assert.rejects(provider.generate({...next,continuation:{}},f.context),match('INVALID_INPUT'));
  await assert.rejects(provider.generate({...f.request,continuation:first.continuation},f.context),match('CONFIGURATION_ERROR'));
  assert.equal(count,1);
 }
});

test('native malformed/incomplete/duplicate calls, missing reasoning continuation and unsupported text-only profiles fail closed',async()=>{
 for(const kind of ['ollama','openai']){
  const f=fixture(kind),response=kind==='ollama'?ollamaCall:openaiCall,mapper=kind==='ollama'?ollamaResponse:openaiResponse;
  assert.throws(()=>mapper(response(),{...f.profile,capabilities:{...f.profile.capabilities,toolCalls:false}},128),match('UNSUPPORTED_CAPABILITY'));
  const raw=response();if(kind==='ollama')raw.message.tool_calls[0].function.arguments='unparsed prose';else raw.output[1].arguments='unparsed prose';
  assert.throws(()=>mapper(raw,f.profile,128),match('INVALID_PROVIDER_OUTPUT'));
  const duplicated=response();if(kind==='ollama')duplicated.message.tool_calls.push(duplicated.message.tool_calls[0]);else duplicated.output.push(duplicated.output[1]);
  assert.throws(()=>mapper(duplicated,f.profile,128),match('INVALID_PROVIDER_OUTPUT'));
 }
 const f=fixture('openai'),raw=openaiCall();delete raw.output[0].encrypted_content;
 await assert.rejects(new OpenaiProvider({value:f.config},{postResponses:async()=>raw},{info(){}}).generate(f.request,f.context),match('INVALID_PROVIDER_OUTPUT'));
 const incomplete=openaiCall();incomplete.output[1].status='incomplete';assert.throws(()=>openaiResponse(incomplete,f.profile,128),match('INVALID_PROVIDER_OUTPUT'));
});
