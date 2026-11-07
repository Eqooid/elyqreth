'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {inspect}=require('node:util');
const {getEventListeners}=require('node:events');
const {Module}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const {ConfigModule}=require('../dist/config/config.module');
const {validateEnvironment}=require('../dist/config/configuration');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {providerEndpoint}=require('../dist/runtime/providers/provider-configuration');
const {withProviderDeadline}=require('../dist/runtime/providers/provider-deadline');
const {providerError,normalizeProviderError,providerFailureAdvice}=require('../dist/runtime/providers/provider-errors');
const v=require('../dist/runtime/contracts/provider-validation');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {LLM_PROVIDERS}=require('../dist/runtime/tokens/runtime.tokens');
const f=require('./provider-fixtures.cjs');
const matches=code=>e=>e instanceof RuntimeError&&e.code===code;
const fake=(id='fixture.local',capabilities=f.capabilities())=>({id,capabilities:()=>capabilities,generate:async()=>({kind:'text',text:'test fixture only'})});
const context=(signal=new AbortController().signal)=>({executionId:randomUUID(),correlationId:randomUUID(),profile:f.profile(),deadlineAt:new Date(Date.now()+1000).toISOString(),signal});
const request=()=>({messages:[{role:'system',content:'Return plain text.'},{role:'user',content:'Nonsensitive fixture'}],maxOutputTokens:512,output:{kind:'text'}});

test('provider registry is empty by default; explicit registration binds methods and rejects duplicates/unknown IDs',async()=>{
 const registry=new LlmProviderRegistry([]);assert.throws(()=>registry.resolve('fixture.local'),matches('PROVIDER_UNAVAILABLE'));
 const adapter=fake();registry.register(adapter);adapter.generate=()=>assert.fail('replaced method');
 assert.deepEqual(await registry.resolve('fixture.local').generate(),{kind:'text',text:'test fixture only'});
 assert.throws(()=>registry.register(adapter),matches('CONFIGURATION_ERROR'));
 for(const id of ['../module','https://endpoint','Provider Class',''])assert.throws(()=>registry.resolve(id),matches('CONFIGURATION_ERROR'));
 for(const adapter of [{id:'x'},fake('bad id'),null])assert.throws(()=>registry.register(adapter),matches('CONFIGURATION_ERROR'));
});
test('optional provider configuration is disabled without credentials and validates exact profile/model/budget boundaries',()=>{
 assert.equal(validateEnvironment({}).llm,undefined);
 assert.equal(validateEnvironment({OPENAI_API_KEY:'unused-private-key'}).llm,undefined);
 const config=validateEnvironment(f.environment());assert.equal(config.llm.profiles[0].model,'fixture:model');assert.equal(config.llm.requestTimeoutMs,60000);assert.equal(config.llm.maxOutputTokens,512);
 for(const patch of [{RUNTIME_ENABLED:'false'},{NODE_ENV:'production'},{RUNTIME_LLM_ENABLED:'yes'},{LLM_PROFILES:'not-json'},
  {LLM_REQUEST_TIMEOUT_MS:'0'},{LLM_REQUEST_TIMEOUT_MS:'120001'},{LLM_REQUEST_TIMEOUT_MS:'1e3'},
  {LLM_MAX_OUTPUT_TOKENS:'0'},{LLM_MAX_OUTPUT_TOKENS:'4097'},{LLM_ALLOW_PAID:'yes'},{LLM_MODEL:'task-selected'}])
  assert.throws(()=>validateEnvironment({...f.environment(),...patch}));
 for(const patch of [{providerId:'../unsafe'},{model:''},{model:'x'.repeat(129)},{model:'https://endpoint/model'},
  {profileVersion:0},{configuration:{apiKey:'private'}},{capabilities:{...f.capabilities(),streaming:true}}])
  assert.throws(()=>validateEnvironment({...f.environment(),LLM_PROFILES:JSON.stringify([{...f.settings(),...patch}])}));
 assert.throws(()=>validateEnvironment({...f.environment(),LLM_PROFILES:JSON.stringify([f.settings(),f.settings()])}));
 assert.throws(()=>validateEnvironment({LLM_PROFILES:'[]'}));
});
test('endpoint configuration bounds exact origins and approved addresses; rejects credentials, metadata and network bypasses',()=>{
 assert.equal(providerEndpoint(f.settings().endpoint).origin,'http://127.0.0.1:11434');
 assert.equal(providerEndpoint({origin:'http://host.docker.internal:11434',network:'local',allowedAddresses:['192.168.65.2']}).network,'local');
 const bad=[{origin:'http://user:password@127.0.0.1:11434'},{origin:'http://127.0.0.1:11434/api/chat'},
  {origin:'http://127.0.0.1:11434?key=private'},{origin:'http://127.0.0.1:11434#fragment'},
  {origin:'ftp://127.0.0.1:11434'},{origin:'http://*.example:11434'},{origin:'http://localhost.:11434'},
  {origin:'http://169.254.169.254',allowedAddresses:['169.254.169.254']},
  {origin:'http://[::ffff:7f00:1]',allowedAddresses:['::ffff:7f00:1']},
  {origin:'http://[64:ff9b::7f00:1]',allowedAddresses:['64:ff9b::7f00:1']},
  {allowedAddresses:['0.0.0.0']},{allowedAddresses:['8.8.8.8']},{allowedAddresses:[]},
  {origin:'https://public.example',network:'public',allowedAddresses:['127.0.0.1']},
  {origin:'http://public.example',network:'public',allowedAddresses:['8.8.8.8']}];
 for(const address of ['fec0::1','2002:7f00:1::1','64:ff9b:1::a00:1','3fff::1'])
  bad.push({origin:'https://public.example',network:'public',allowedAddresses:[address]});
 for(const patch of bad)assert.throws(()=>providerEndpoint({...f.settings().endpoint,...patch}),e=>matches('CONFIGURATION_ERROR')(e)&&!JSON.stringify(e).includes('password'));
});
test('enabled cloud credentials are isolated from config/profile/inspection and require explicit paid consent',()=>{
 const secret='fixture-not-a-real-key',p={...f.settings(),id:'cloud.fixture',providerId:'fixture.cloud',credentialEnv:'FIXTURE_API_KEY',endpoint:{origin:'https://provider.example',network:'public',allowedAddresses:['8.8.8.8']}};
 const env={...f.environment(),LLM_PROFILES:JSON.stringify([p]),LLM_ALLOW_PAID:'true',FIXTURE_API_KEY:secret};
 const config=validateEnvironment(env);assert.equal(config.llm.credentials.get(p.id),secret);
 assert.ok(!JSON.stringify(config).includes(secret));assert.ok(!inspect(config,{depth:null,showHidden:true}).includes(secret));
 assert.ok(!JSON.stringify(config.llm.credentials).includes(secret));assert.ok(Object.isFrozen(config.llm.profiles[0].endpoint.allowedAddresses));
 for(const patch of [{LLM_ALLOW_PAID:'false'},{FIXTURE_API_KEY:undefined},{FIXTURE_API_KEY:'bad\nheader'}])
  assert.throws(()=>validateEnvironment({...env,...patch}),e=>!e.message.includes(secret));
 assert.throws(()=>validateEnvironment({...env,LLM_PROFILES:JSON.stringify([{...p,credentialEnv:'DATABASE_URL'}])}));
});
test('selection follows captured trusted profile/version/model exactly, ignores no fallback and refuses Task-level selection',async()=>{
 const config=validateEnvironment(f.environment()),registry=new LlmProviderRegistry([fake(),fake('fixture.backup')]);
 const selector=new ProviderSelectionService({value:config},registry);selector.onModuleInit();
 const selected=selector.select(f.definition());assert.equal(selected.provider.id,'fixture.local');assert.equal(selected.maxOutputTokens,512);
 assert.equal(selected.profile.model,'fixture:model');assert.ok(Object.isFrozen(selected.profile));assert.ok(!JSON.stringify(selected).includes('endpoint'));
 for(const patch of [{model:'other:model'},{id:'missing'},{profileVersion:2}])
  assert.throws(()=>selector.select({...f.definition(),providerProfile:{...f.profile(),...patch}}),matches('CONFIGURATION_ERROR'));
 assert.throws(()=>selector.select({...f.definition(),input:{providerId:'fixture.backup'}}),matches('INVALID_INPUT'));
 assert.throws(()=>selector.select({input:{provider:'fixture.backup'}}),matches('INVALID_INPUT'));
 for(const patch of [{providerId:'fixture.backup'},{endpoint:{...f.settings().endpoint,origin:'http://127.0.0.1:11435'}}]){
  const drift=validateEnvironment({...f.environment(),LLM_PROFILES:JSON.stringify([{...f.settings(),...patch}])});
  assert.throws(()=>new ProviderSelectionService({value:drift},registry).select(f.definition()),matches('CONFIGURATION_ERROR'));
 }
 const legacy=f.definition();delete legacy.providerProfile.bindingDigest;
 assert.throws(()=>selector.select(legacy),matches('CONFIGURATION_ERROR'));
 assert.throws(()=>new ProviderSelectionService({value:validateEnvironment({})},registry).select(f.definition()),matches('CONFIGURATION_ERROR'));
 assert.throws(()=>new ProviderSelectionService({value:config},new LlmProviderRegistry([])).select(f.definition()),matches('PROVIDER_UNAVAILABLE'));
 let fallback=0;const r=new LlmProviderRegistry([{...fake(),generate:async()=>{throw providerError('unavailable');}},{...fake('fixture.backup'),generate:async()=>{fallback++;}}]);
 await assert.rejects(new ProviderSelectionService({value:config},r).select(f.definition()).provider.generate(request(),context()),matches('PROVIDER_UNAVAILABLE'));assert.equal(fallback,0);
});
test('selected provider port enforces message/model/token/context/output limits before and after an injected adapter',async()=>{
 let calls=0;
 const raw={...fake(),generate:async()=>{calls++;return {kind:'text',text:'safe fixture output'};}};
 const registry=new LlmProviderRegistry([raw]),config=validateEnvironment(f.environment());
 const selected=new ProviderSelectionService({value:config},registry).select(f.definition());
 assert.equal((await selected.provider.generate(request(),context())).text,'safe fixture output');assert.equal(calls,1);
 for(const [r,c,code] of [[{...request(),maxOutputTokens:513},context(),'INVALID_INPUT'],
  [{...request(),tools:[{}]},context(),'UNSUPPORTED_CAPABILITY'],[request(),{...context(),profile:{...f.profile(),model:'other'}},'CONFIGURATION_ERROR']])
  await assert.rejects(selected.provider.generate(r,c),matches(code));
 assert.equal(calls,1);
 const bad=new ProviderSelectionService({value:config},new LlmProviderRegistry([{...fake(),generate:async()=>({kind:'text',text:'password=private'})}])).select(f.definition());
 await assert.rejects(bad.provider.generate(request(),context()),matches('INVALID_PROVIDER_OUTPUT'));
});
test('model/profile capabilities must fit adapter declarations rather than a provider brand assumption',()=>{
 const config=validateEnvironment(f.environment());
 const changed={...f.definition(),providerProfile:{...f.profile(),capabilities:{...f.capabilities(),structuredOutput:'schema'}}};
 const env={...f.environment(),LLM_PROFILES:JSON.stringify([{...f.settings(),capabilities:changed.providerProfile.capabilities}])};
 const selector=new ProviderSelectionService({value:validateEnvironment(env)},new LlmProviderRegistry([fake()]));
 assert.throws(()=>selector.select(changed),matches('UNSUPPORTED_CAPABILITY'));
 const noUsage=new ProviderSelectionService({value:config},new LlmProviderRegistry([fake('fixture.local',{...f.capabilities(),tokenUsage:'none'})]));
 assert.throws(()=>noUsage.select(f.definition()),matches('UNSUPPORTED_CAPABILITY'));
});
test('message/request validation copies and freezes bounded data and refuses tools/provider extensions or secrets',()=>{
 const raw=request(),parsed=v.llmGenerateRequest(raw);raw.messages[0].content='mutated';assert.equal(parsed.messages[0].content,'Return plain text.');assert.ok(Object.isFrozen(parsed.messages[0]));
 for(const patch of [{messages:[]},{messages:Array.from({length:9},()=>({role:'user',content:'x'}))},
  {messages:[{role:'developer',content:'x'}]},{messages:[{role:'user',content:''}]},{messages:[{role:'user',content:'api_key=private'}]},
  {messages:[{role:'user',content:'x'.repeat(16001)}]},{messages:[{role:'user',content:'\u754c'.repeat(6000)}]},
  {messages:[{role:'user',content:'x',apiKey:'private'}]},{maxOutputTokens:0},{maxOutputTokens:4097},{model:'task-override'},
  {messages:[Object.defineProperty({},'role',{enumerable:true,get(){assert.fail('getter invoked');}})]}])
  assert.throws(()=>v.llmGenerateRequest({...request(),...patch}),matches('INVALID_INPUT'));
 for(const patch of [{output:{kind:'json'}},{tools:[{}]},{messages:[{role:'tool',content:'x'}]}])
  assert.throws(()=>v.llmGenerateRequest({...request(),...patch}),matches('UNSUPPORTED_CAPABILITY'));
 assert.throws(()=>v.llmGenerateRequest(request(),128),matches('INVALID_INPUT'));
 const boundary={...request(),messages:[{role:'user',content:'x'.repeat(16000)},{role:'assistant',content:'y'.repeat(384)}]};
 assert.equal(v.llmGenerateRequest(boundary).messages.length,2);boundary.messages[1].content+='y';
 assert.throws(()=>v.llmGenerateRequest(boundary),matches('INVALID_INPUT'));
});
test('provider output/usage parsing is bounded, optional, safe and rejects incomplete or unsupported outputs',()=>{
 assert.deepEqual(v.llmGenerateResult({kind:'text',text:'safe answer'},f.capabilities()),{kind:'text',text:'safe answer'});
 const usage={inputTokens:2,outputTokens:3,totalTokens:5};assert.deepEqual(v.tokenUsage(usage),usage);
 assert.deepEqual(v.tokenUsage({inputTokens:null,outputTokens:null,totalTokens:null}),{inputTokens:null,outputTokens:null,totalTokens:null});
 for(const u of [{...usage,totalTokens:4},{...usage,inputTokens:-1},{...usage,outputTokens:NaN},{...usage,prompt:'private'},{}])assert.throws(()=>v.tokenUsage(u),matches('INVALID_INPUT'));
 for(const r of [{kind:'text',text:''},{kind:'text',text:'password=private'},{kind:'text',text:'safe',headers:{authorization:'private'}},{kind:'unknown',text:'safe'},
  {kind:'text',text:'safe',usage:{...usage,totalTokens:6}}])assert.throws(()=>v.llmGenerateResult(r,f.capabilities()),matches('INVALID_PROVIDER_OUTPUT'));
 assert.throws(()=>v.llmGenerateResult({kind:'text',text:'x'.repeat(32769)},f.capabilities()),matches('OUTPUT_LIMIT_EXCEEDED'));
 assert.throws(()=>v.llmGenerateResult({kind:'tool_proposals',calls:[]},f.capabilities()),matches('UNSUPPORTED_CAPABILITY'));
 assert.throws(()=>v.llmGenerateResult({kind:'text',text:'safe',usage},{...f.capabilities(),tokenUsage:'none'}),matches('UNSUPPORTED_CAPABILITY'));
 const overhead=Buffer.byteLength(JSON.stringify({kind:'text',text:''})),text='x'.repeat(32768-overhead);
 assert.equal(Buffer.byteLength(JSON.stringify(v.llmGenerateResult({kind:'text',text},f.capabilities()))),32768);
 assert.throws(()=>v.llmGenerateResult({kind:'text',text:text+'x'},f.capabilities()),matches('OUTPUT_LIMIT_EXCEEDED'));
});
test('provider deadline preserves identity, caps deadline, relays cancellation safely and removes timers/listeners',async()=>{
 const parent=new AbortController(),input=context(parent.signal);let child;
 assert.equal(await withProviderDeadline(v.llmRequestContext(input),100,c=>{child=c;assert.equal(v.llmRequestContext(c),c);return Promise.resolve(42);}),42);
 assert.equal(child.executionId,input.executionId);assert.equal(child.correlationId,input.correlationId);assert.notEqual(child.signal,parent.signal);
 assert.ok(Date.parse(child.deadlineAt)<=Date.parse(input.deadlineAt));assert.equal(getEventListeners(parent.signal,'abort').length,0);
 let entered;const ready=new Promise(r=>entered=r);
 const pending=withProviderDeadline(input,1000,async c=>{child=c;entered();await new Promise(()=>{});});
 await ready;parent.abort('secret raw reason');await assert.rejects(pending,e=>matches('CANCELLED')(e)&&!JSON.stringify(e).includes('secret'));
 assert.equal(child.signal.aborted,true);assert.equal(getEventListeners(parent.signal,'abort').length,0);
 let invoked=0;await assert.rejects(withProviderDeadline(context(parent.signal),100,async()=>{invoked++;}),matches('CANCELLED'));assert.equal(invoked,0);
 await assert.rejects(withProviderDeadline({...context(),deadlineAt:'2000-01-01T00:00:00.000Z'},100,async()=>{invoked++;}),matches('DEADLINE_EXCEEDED'));assert.equal(invoked,0);
 const expired=new AbortController();expired.abort(new RuntimeError('DEADLINE_EXCEEDED','context'));
 await assert.rejects(withProviderDeadline(context(expired.signal),100,async()=>{invoked++;}),matches('DEADLINE_EXCEEDED'));assert.equal(invoked,0);
});
test('provider timeout rejects a noncooperative operation, consumes late rejection and normalizes unknown failures',async()=>{
 let rejectLate,observed;const input=context();
 await assert.rejects(withProviderDeadline(input,10,c=>{observed=c;return new Promise((_,reject)=>{rejectLate=reject;});}),matches('DEADLINE_EXCEEDED'));
 assert.equal(observed.signal.aborted,true);rejectLate(new Error('late private response'));await new Promise(r=>setImmediate(r));
 assert.equal(getEventListeners(input.signal,'abort').length,0);
 await assert.rejects(withProviderDeadline(context(),100,async()=>{throw new Error('provider secret');}),e=>matches('INTERNAL_RUNTIME_ERROR')(e)&&!JSON.stringify(e).includes('secret'));
 for(const c of [{...context(),deadlineAt:'2024-02-31T00:00:00.000Z'},{...context(),signal:Object.create(AbortSignal.prototype)},
  {...context(),apiKey:'private'}])assert.throws(()=>v.llmRequestContext(c),matches('INVALID_INPUT'));
});
test('closed error normalization preserves stable categories without vendor bodies or automatic retries',()=>{
 const mapping={not_registered:'PROVIDER_UNAVAILABLE',configuration:'CONFIGURATION_ERROR',missing_model:'MODEL_UNAVAILABLE',unsupported:'UNSUPPORTED_CAPABILITY',unavailable:'PROVIDER_UNAVAILABLE',timeout:'DEADLINE_EXCEEDED',cancelled:'CANCELLED',invalid_response:'INVALID_PROVIDER_OUTPUT',rate_limited:'PROVIDER_RATE_LIMITED',authentication:'PROVIDER_AUTH_FAILED',internal:'INTERNAL_RUNTIME_ERROR'};
 for(const [kind,code] of Object.entries(mapping)){const e=providerError(kind);assert.equal(e.code,code);assert.equal(normalizeProviderError(e),e);assert.equal(providerFailureAdvice(e).automaticRetry,false);assert.ok(!JSON.stringify(e).includes('stack'));}
 assert.equal(normalizeProviderError({status:401,headers:{authorization:'private'},message:'private'}).code,'INTERNAL_RUNTIME_ERROR');
 assert.equal(providerError('arbitrary').code,'INTERNAL_RUNTIME_ERROR');
});
test('Nest DI starts empty without providers; configured unavailable adapters fail closed, test fake never generates at startup',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',()=>assert.fail('network at startup'));
 const connect=t.mock.method(require('node:net').Socket.prototype,'connect',()=>assert.fail('socket at startup'));
 let generated=0;
 async function open(config,providers){class TestModule{};Module({imports:[ConfigModule.register(config)],providers:[{provide:LLM_PROVIDERS,useValue:providers},LlmProviderRegistry,ProviderSelectionService]})(TestModule);return NestFactory.createApplicationContext(TestModule,{logger:false,abortOnError:false});}
 let app;try{
  app=await open(validateEnvironment({}),[]);assert.ok(app.get(ProviderSelectionService));assert.throws(()=>app.get(LlmProviderRegistry).resolve('none'),matches('PROVIDER_UNAVAILABLE'));await app.close();app=undefined;
  await assert.rejects(open(validateEnvironment(f.environment()),[]),matches('PROVIDER_UNAVAILABLE'));
  app=await open(validateEnvironment(f.environment()),[{...fake(),generate:async()=>{generated++;return {kind:'text',text:'test'};}}]);
  assert.equal(app.get(ProviderSelectionService).select(f.definition()).profile.id,'local.small');assert.equal(generated,0);
 }finally{await app?.close();fetch.mock.restore();connect.mock.restore();}
});
