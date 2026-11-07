'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Module}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const {OpenaiProvider}=require('../dist/runtime/providers/openai/openai.provider');
const {openaiRequest,openaiResponse,openaiStatusError,OPENAI_CAPABILITIES}=require('../dist/runtime/providers/openai/openai.mapper');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {ProviderCredentials}=require('../dist/runtime/providers/provider-configuration');
const {providerFailureAdvice}=require('../dist/runtime/providers/provider-errors');
const {validateEnvironment}=require('../dist/config/configuration');
const {ConfigModule}=require('../dist/config/config.module');
const {LLM_PROVIDERS}=require('../dist/runtime/tokens/runtime.tokens');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {fixture,response,TEST_KEY}=require('./openai-fixtures.cjs');
const match=code=>e=>e instanceof RuntimeError&&e.code===code;

test('Responses request preserves roles/order with finite text-only foreground settings and no retention state',()=>{
 const f=fixture();f.request.messages.push({role:'assistant',content:'Prior answer \u754c'});
 const body=openaiRequest(f.request,f.profile);
 assert.deepEqual(body,{model:f.profile.model,input:f.request.messages,store:false,stream:false,background:false,truncation:'disabled',max_output_tokens:128});
 assert.ok(Object.isFrozen(body.input));assert.equal(body.tools,undefined);assert.equal(body.previous_response_id,undefined);
 for(const patch of [{maxOutputTokens:0},{maxOutputTokens:4097},{temperature:1},
  {messages:[]},{messages:Array(9).fill({role:'user',content:'safe'})},{messages:[{role:'user',content:'x'.repeat(16001)}]},
  {messages:[{role:'user',content:''}]}])assert.throws(()=>openaiRequest({...f.request,...patch},f.profile),match('INVALID_INPUT'));
 for(const patch of [{tools:[{}]},{output:{kind:'json'}},{messages:[{role:'tool',content:'x'}]}])
  assert.throws(()=>openaiRequest({...f.request,...patch},f.profile),match('UNSUPPORTED_CAPABILITY'));
 for(const model of ['', 'https://internal', 'x'.repeat(129)])assert.throws(()=>openaiRequest(f.request,{...f.profile,model}),match('INVALID_INPUT'));
});

test('Responses output scans ordered text items, discards reasoning, preserves Unicode and reports optional usage',()=>{
 const f=fixture(),r=response();r.output.unshift({type:'reasoning',summary:[{text:'private reasoning'}]});
 r.output[1].content[0].text='Hello \u{1f600}';r.output.push({type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:' \u754c'}]});
 const mapped=openaiResponse(r,f.profile,128);
 assert.equal(mapped.result.text,'Hello \u{1f600} \u754c');assert.equal(mapped.actualModel,'reviewed-model-snapshot');
 assert.deepEqual(mapped.result.usage,{inputTokens:2,outputTokens:3,totalTokens:5});assert.ok(!JSON.stringify(mapped).includes('private'));
 delete r.usage;assert.equal(openaiResponse(r,f.profile,128).result.usage,undefined);
 r.usage={output_tokens:3};assert.deepEqual(openaiResponse(r,f.profile,128).result.usage,{inputTokens:null,outputTokens:3,totalTokens:null});
 assert.equal(openaiResponse(r,{...f.profile,capabilities:{...f.profile.capabilities,tokenUsage:'none'}},128).result.usage,undefined);
});

test('Responses rejects incomplete, refusal, filtered, empty, malformed and unsafe output rather than trusting HTTP 200',()=>{
 const f=fixture();for(const patch of [{status:'in_progress'},{status:'failed'},{object:'other'},{model:''},{output:[]},
  {error:{message:'private'}},{incomplete_details:{reason:'content_filter'}},{usage:{input_tokens:-1}},
  {usage:{input_tokens:1,output_tokens:2,total_tokens:4}},
  {output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'private'}]}]},
  {output:[{type:'message',role:'assistant',status:'incomplete',content:[]}]},
  {output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:''}]}]},
  {output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'password=private'}]}]}])
  assert.throws(()=>openaiResponse({...response(),...patch},f.profile,128),match('INVALID_PROVIDER_OUTPUT'));
 assert.throws(()=>openaiResponse({...response(),output:[{type:'function_call'}]},f.profile,128),match('UNSUPPORTED_CAPABILITY'));
 for(const patch of [{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},{usage:{output_tokens:129}},
  {output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'x'.repeat(32769)}]}]}])
  assert.throws(()=>openaiResponse({...response(),...patch},f.profile,128),match('OUTPUT_LIMIT_EXCEEDED'));
 for(const r of [null,[],{},'private'])assert.throws(()=>openaiResponse(r,f.profile,128),match('INVALID_PROVIDER_OUTPUT'));
});

test('OpenAI errors distinguish rate limiting from nonretryable quota without leaking request/provider diagnostics',()=>{
 for(const [status,code] of [[400,'INVALID_INPUT'],[401,'PROVIDER_AUTH_FAILED'],[403,'PROVIDER_AUTH_FAILED'],[404,'MODEL_UNAVAILABLE'],
  [429,'PROVIDER_RATE_LIMITED'],[500,'PROVIDER_UNAVAILABLE'],[503,'PROVIDER_UNAVAILABLE'],[302,'CONFIGURATION_ERROR']]) {
  const error=openaiStatusError(status,{error:{message:TEST_KEY}});assert.equal(error.code,code);assert.ok(!JSON.stringify(error).includes(TEST_KEY));
 }
 for(const code of ['insufficient_quota','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded']){
  const e=openaiStatusError(429,{error:{code,message:TEST_KEY}});assert.equal(e.code,'PROVIDER_QUOTA_EXCEEDED');
  assert.equal(providerFailureAdvice(e).potentiallyTransient,false);assert.equal(providerFailureAdvice(e).automaticRetry,false);
 }
 assert.equal(openaiStatusError(400,{error:{code:'model_not_found'}}).code,'MODEL_UNAVAILABLE');
});

test('OpenAI configuration requires paid consent, private credential reference and official endpoint; unused key is optional',()=>{
 const f=fixture();assert.ok(!JSON.stringify(f.config).includes(TEST_KEY));
 assert.doesNotThrow(()=>validateEnvironment({}));
 for(const patch of [{OPENAI_API_KEY:''},{LLM_ALLOW_PAID:'false'},{LLM_REQUEST_TIMEOUT_MS:'120001'},{LLM_MAX_OUTPUT_TOKENS:'4097'}])
  assert.throws(()=>validateEnvironment({...f.env,...patch}));
 for(const endpoint of [{...f.settings.endpoint,origin:'https://other.example'},
  {...f.settings.endpoint,origin:'http://api.openai.com'},{...f.settings.endpoint,origin:'https://api.openai.com:444'},
  {...f.settings.endpoint,allowedAddresses:['127.0.0.1']}])
  assert.throws(()=>validateEnvironment({...f.env,LLM_PROFILES:JSON.stringify([{...f.settings,endpoint}])}));
});

test('OpenAI direct port pins trusted selection and logs only safe identifiers/model/duration without provider calls at startup',async()=>{
 const f=fixture(),calls=[],logs=[];
 const provider=new OpenaiProvider({value:f.config},{postResponses:async(...args)=>{calls.push(args);return response();}},{info:(...args)=>logs.push(args)});
 assert.deepEqual(provider.capabilities(f.profile),OPENAI_CAPABILITIES);assert.equal(calls.length,0);
 const selector=new ProviderSelectionService({value:f.config},new LlmProviderRegistry([provider]));selector.onModuleInit();
 const result=await selector.select(f.definition).provider.generate(f.request,f.context);
 assert.equal(result.text,'Safe answer');assert.equal(calls.length,1);assert.equal(calls[0][3],TEST_KEY);
 assert.equal(logs[0][1].model,'reviewed-model-snapshot');assert.ok(!JSON.stringify(logs).includes(TEST_KEY));assert.ok(!JSON.stringify(logs).includes('Harmless'));
 for(const patch of [{model:'task-model'},{bindingDigest:'0'.repeat(64)}])
  await assert.rejects(provider.generate(f.request,{...f.context,profile:{...f.profile,...patch}}),match('CONFIGURATION_ERROR'));
 const config={...f.config,llm:{...f.config.llm,credentials:new ProviderCredentials(new Map())}};
 await assert.rejects(new OpenaiProvider({value:config},{postResponses:()=>assert.fail('transport')},{info(){}}).generate(f.request,f.context),match('PROVIDER_AUTH_FAILED'));
 assert.equal(calls.length,1);
});

test('OpenAI deadline/cancellation bound noncooperative transport and normalize unexpected failures without retries or fallback',async()=>{
 const f=fixture(15);let calls=0,signal;
 const provider=new OpenaiProvider({value:f.config},{postResponses:async(_e,_b,c)=>{calls++;signal=c.signal;await new Promise(()=>{});}},{info(){}});
 await assert.rejects(provider.generate(f.request,f.context),match('DEADLINE_EXCEEDED'));assert.equal(signal.aborted,true);assert.equal(calls,1);
 const g=fixture();let entered;const ready=new Promise(r=>entered=r);
 const p=new OpenaiProvider({value:g.config},{postResponses:async(_e,_b,c)=>{signal=c.signal;entered();await new Promise(()=>{});}},{info(){}});
 const pending=p.generate(g.request,g.context);await ready;g.controller.abort(TEST_KEY);
 await assert.rejects(pending,match('CANCELLED'));assert.equal(signal.aborted,true);
 await assert.rejects(p.generate(g.request,g.context),match('CANCELLED'));
 const h=fixture();await assert.rejects(new OpenaiProvider({value:h.config},{postResponses:async()=>{throw new Error(TEST_KEY);}},{info(){}}).generate(h.request,h.context),
  e=>match('INTERNAL_RUNTIME_ERROR')(e)&&!JSON.stringify(e).includes(TEST_KEY));
});

test('Nest DI supports OpenAI selection with no eager network and both empty configuration and preserved Ollama registration',async t=>{
 const socket=t.mock.method(require('node:net').Socket.prototype,'connect',()=>assert.fail('socket at startup'));
 let app,calls=0;
 try {
  const f=fixture(),provider=new OpenaiProvider({value:f.config},{postResponses:async()=>{calls++;return response();}},{info(){}});
  class FixtureModule{};Module({imports:[ConfigModule.register(f.config)],providers:[{provide:LLM_PROVIDERS,useValue:[provider]},LlmProviderRegistry,ProviderSelectionService]})(FixtureModule);
  app=await NestFactory.createApplicationContext(FixtureModule,{logger:false,abortOnError:false});
  assert.equal(app.get(LlmProviderRegistry).resolve('openai').id,'openai');assert.equal(calls,0);
  assert.equal((await app.get(ProviderSelectionService).select(f.definition).provider.generate(f.request,f.context)).text,'Safe answer');
  assert.equal(calls,1);assert.throws(()=>app.get(LlmProviderRegistry).resolve('unregistered'),match('PROVIDER_UNAVAILABLE'));
  assert.throws(()=>new LlmProviderRegistry([provider,provider]),match('CONFIGURATION_ERROR'));
 } finally {await app?.close();socket.mock.restore();}
});

test('paid live diagnostic is disabled by default and refuses production before reading credentials or opening a socket',async()=>{
 const run=require('node:util').promisify(require('node:child_process').execFile),script=require('node:path').join(__dirname,'openai.live.cjs');
 const disabled=await run(process.execPath,[script],{env:{...process.env,ELYQRETH_OPENAI_LIVE:'false'},timeout:10000});
 assert.equal(JSON.parse(disabled.stdout).status,'NOT RUN');
 await assert.rejects(run(process.execPath,[script],{env:{...process.env,ELYQRETH_OPENAI_LIVE:'true',NODE_ENV:'production'},timeout:10000}),e=>{
  assert.equal(JSON.parse(e.stderr).error.code,'ACCESS_DENIED');assert.ok(!e.stderr.includes(TEST_KEY));return true;
 });
});

test('T12 a failing telemetry sink cannot invalidate a successful OpenAI generation',async()=>{
 const f=fixture();let calls=0;
 const provider=new OpenaiProvider({value:f.config},{postResponses:async()=>{calls++;return response();}},
  {info(){throw new Error('private logging sink failure');}});
 const result=await provider.generate(f.request,f.context);assert.equal(result.kind,'text');assert.equal(result.text,'Safe answer');assert.equal(calls,1);
});
