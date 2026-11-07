'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {join}=require('node:path');
const {OllamaProvider}=require('../dist/runtime/providers/ollama/ollama.provider');
const {OllamaHttpTransport}=require('../dist/runtime/providers/ollama/ollama-http.transport');
const {ollamaRequest,ollamaResponse,OLLAMA_CAPABILITIES}=require('../dist/runtime/providers/ollama/ollama.mapper');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {fixture,response}=require('./ollama-fixtures.cjs');
const match=code=>e=>e instanceof RuntimeError&&e.code===code;
test('Ollama request maps ordered system/user/assistant messages with explicit finite options and no streaming/tools',()=>{
 const f=fixture();f.request.messages.push({role:'assistant',content:'Prior answer \u754c'});
 const body=ollamaRequest(f.request,f.profile);
 assert.equal(body.model,f.profile.model);assert.deepEqual(body.messages,f.request.messages);
 assert.equal(body.stream,false);assert.equal(body.keep_alive,0);assert.deepEqual(body.options,{num_predict:128,num_ctx:8192});
 assert.ok(Object.isFrozen(body.options));assert.equal(body.tools,undefined);assert.equal(body.think,undefined);
 for(const r of [{...f.request,maxOutputTokens:4097},{...f.request,options:{num_predict:-1}},
  {...f.request,messages:[{role:'user',content:'x'.repeat(16001)}]},
  {...f.request,messages:[{role:'user',content:'x'.repeat(7000)}],maxOutputTokens:1024}])assert.throws(()=>ollamaRequest(r,f.profile),match('INVALID_INPUT'));
 for(const r of [{...f.request,tools:[{}]},{...f.request,output:{kind:'json'}},{...f.request,messages:[{role:'tool',content:'x'}]}])
  assert.throws(()=>ollamaRequest(r,f.profile),match('UNSUPPORTED_CAPABILITY'));
 assert.throws(()=>ollamaRequest(f.request,{...f.profile,model:''}),match('INVALID_INPUT'));
});
test('Ollama response maps Unicode, optional reported usage and duration without returning reasoning or server DTOs',()=>{
 const f=fixture(),raw=response();raw.message.content='Hello \u{1f600} \u754c';raw.message.thinking='Private reasoning never expose';
 const mapped=ollamaResponse(raw,f.profile,128);assert.equal(mapped.result.text,raw.message.content);assert.equal(mapped.serverDurationMs,1);
 assert.deepEqual(mapped.result.usage,{inputTokens:2,outputTokens:3,totalTokens:5});assert.ok(!JSON.stringify(mapped).includes('Private'));
 const minimal={model:f.profile.model,message:{role:'assistant',content:'safe'},done:true};
 assert.deepEqual(ollamaResponse(minimal,f.profile,128),{result:{kind:'text',text:'safe'}});
 assert.deepEqual(ollamaResponse({...minimal,eval_count:3},f.profile,128).result.usage,{inputTokens:null,outputTokens:3,totalTokens:null});
 assert.equal(ollamaResponse(raw,{...f.profile,capabilities:{...f.profile.capabilities,tokenUsage:'none'}},128).result.usage,undefined);
});
test('Ollama response rejects malformed, incomplete, substituted, unsafe or excessive outputs and unsupported fields',()=>{
 const f=fixture();for(const patch of [{done:false},{model:'different'},{error:'private diagnostics'},
  {message:{role:'user',content:'safe'}},{message:{role:'assistant',content:''}},
  {message:{role:'assistant',content:'password=private'}},{eval_count:-1},{prompt_eval_count:1.5},{total_duration:-1},{done_reason:'load'}])
  assert.throws(()=>ollamaResponse({...response(),...patch},f.profile,128),match('INVALID_PROVIDER_OUTPUT'));
 for(const patch of [{done_reason:'length'},{eval_count:129},{message:{role:'assistant',content:'x'.repeat(32769)}}])
  assert.throws(()=>ollamaResponse({...response(),...patch},f.profile,128),match('OUTPUT_LIMIT_EXCEEDED'));
 assert.throws(()=>ollamaResponse({...response(),message:{role:'assistant',content:'safe',tool_calls:[{}]}},f.profile,128),match('UNSUPPORTED_CAPABILITY'));
});
test('Ollama provider resolves only its pinned private profile and never connects during construction/capability checks',async()=>{
 const f=fixture(),calls=[],logs=[];
 const provider=new OllamaProvider({value:f.config},{postChat:async(...args)=>{calls.push(args);return response();}},{info:(...args)=>logs.push(args)});
 assert.deepEqual(provider.capabilities(f.profile),OLLAMA_CAPABILITIES);assert.equal(calls.length,0);
 assert.equal((await provider.generate(f.request,f.context)).kind,'text');assert.equal(calls.length,1);
 assert.equal(calls[0][0].origin,f.settings.endpoint.origin);assert.equal(calls[0][1].stream,false);
 assert.ok(!JSON.stringify(logs).includes('Nonsensitive'));assert.equal(logs[0][1].serverDurationMs,1);
 for(const patch of [{model:'other'},{bindingDigest:'0'.repeat(64)},{profileVersion:2}])
  await assert.rejects(provider.generate(f.request,{...f.context,profile:{...f.profile,...patch}}),match('CONFIGURATION_ERROR'));
 assert.equal(calls.length,1);
 f.controller.abort('private');await assert.rejects(provider.generate(f.request,f.context),match('CANCELLED'));assert.equal(calls.length,1);
});
test('Ollama transport requires TLS verification and original-host identity, without proxy/global agent or header injection',async t=>{
 const https=require('node:https');let options;
 const mock=t.mock.method(https,'request',o=>{options=o;const req=new EventEmitter();req.end=()=>process.nextTick(()=>req.emit('error',Object.assign(new Error('private'),{code:'DEPTH_ZERO_SELF_SIGNED_CERT'})));req.destroy=()=>{};return req;});
 try{const f=fixture('https://ollama.test:11434'),transport=new OllamaHttpTransport(async()=>[{address:'127.0.0.1',family:4}]);
  await assert.rejects(transport.postChat(f.settings.endpoint,{},f.context),match('CONFIGURATION_ERROR'));
  assert.equal(options.rejectUnauthorized,true);assert.equal(options.servername,'ollama.test');assert.equal(options.hostname,'127.0.0.1');
  assert.equal(options.agent,false);assert.equal(options.headers.Host,'ollama.test:11434');assert.equal(options.path,'/api/chat');
  assert.equal(options.headers.Authorization,undefined);assert.ok(options.checkServerIdentity('wrong',{subjectaltname:'DNS:wrong'}));
 }finally{mock.mock.restore();}
});
test('live diagnostic is opt-in and malformed/non-loopback origins reject before any server request',async()=>{
 const script=join(__dirname,'ollama.live.cjs'),run=promisify(execFile);
 const disabled=await run(process.execPath,[script],{env:{...process.env,ELYQRETH_OLLAMA_LIVE:'false'},timeout:10000});
 assert.equal(JSON.parse(disabled.stdout).status,'NOT RUN');
 for(const origin of ['malformed-private-endpoint','http://169.254.169.254'])
  await assert.rejects(run(process.execPath,[script],{env:{...process.env,NODE_ENV:'test',ELYQRETH_OLLAMA_LIVE:'true',ELYQRETH_OLLAMA_LIVE_ORIGIN:origin},timeout:10000}),error=>{
   assert.equal(error.code,1);assert.equal(JSON.parse(error.stderr).error.code,'CONFIGURATION_ERROR');
   assert.ok(!error.stderr.includes(origin));return true;
  });
});

test('T12 a failing telemetry sink cannot invalidate a successful Ollama generation',async()=>{
 const f=fixture();let calls=0;
 const provider=new OllamaProvider({value:f.config},{postChat:async()=>{calls++;return response(f.profile.model);}},
  {info(){throw new Error('private logging sink failure');}});
 const result=await provider.generate(f.request,f.context);assert.equal(result.kind,'text');assert.equal(result.text,'Safe fixture answer');assert.equal(calls,1);
});
