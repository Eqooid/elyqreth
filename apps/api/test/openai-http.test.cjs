'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter,getEventListeners}=require('node:events');
const {OpenaiHttpTransport}=require('../dist/runtime/providers/openai/openai-http.transport');
const {OpenaiProvider}=require('../dist/runtime/providers/openai/openai.provider');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {fixture,response,TEST_KEY}=require('./openai-fixtures.cjs');
const match=code=>e=>e instanceof RuntimeError&&e.code===code;

// Controlled native HTTPS seam: no real DNS, socket, credential or paid call.
// Exercises the production framing/parser/abort code, not an alternate adapter.
function server(t,handler){
 const calls=[];let destroyed=0;
 const mock=t.mock.method(require('node:https'),'request',(options,callback)=>{
  const req=new EventEmitter(),entry={options};calls.push(entry);
  const abort=()=>process.nextTick(()=>req.emit('error',Object.assign(new Error('private abort'),{code:'ABORT_ERR'})));
  options.signal.addEventListener('abort',abort,{once:true});
  req.destroy=()=>{destroyed++;options.signal.removeEventListener('abort',abort);};
  req.end=body=>{entry.body=JSON.parse(body.toString('utf8'));process.nextTick(()=>{
   if(options.signal.aborted)return abort();
   const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json'};res.destroy=req.destroy;
   const send=(body=response(),status=200,headers={})=>{
    res.statusCode=status;Object.assign(res.headers,headers);callback(res);
    process.nextTick(()=>{res.emit('data',Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body)));res.emit('end');options.signal.removeEventListener('abort',abort);});
   };
   handler({req,res,send,options});
  });};return req;
 });
 return {calls,get destroyed(){return destroyed;},restore:()=>mock.mock.restore()};
}
const dns=async()=>[{address:'8.8.8.8',family:4}];

test('mocked HTTPS integration preserves selection, official TLS authority, pinned IP, finite body and safe result mapping',async t=>{
 const f=fixture(),http=server(t,({send})=>send()),transport=new OpenaiHttpTransport(dns);
 try {
  const provider=new OpenaiProvider({value:f.config},transport,{info(){}}),selection=new ProviderSelectionService({value:f.config},new LlmProviderRegistry([provider]));
  selection.onModuleInit();assert.equal(http.calls.length,0);
  const result=await selection.select(f.definition).provider.generate(f.request,f.context),{options:o,body}=http.calls[0];
  assert.equal(result.text,'Safe answer');assert.deepEqual(result.usage,{inputTokens:2,outputTokens:3,totalTokens:5});
  assert.equal(o.protocol,'https:');assert.equal(o.hostname,'8.8.8.8');assert.equal(o.port,443);assert.equal(o.path,'/v1/responses');
  assert.equal(o.headers.Host,'api.openai.com');assert.equal(o.servername,'api.openai.com');assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);
  assert.equal(o.headers.Authorization,'Bearer '+TEST_KEY);assert.equal(o.headers['Accept-Encoding'],'identity');
  assert.ok(o.checkServerIdentity('other',{subjectaltname:'DNS:other'}));
  assert.equal(body.model,f.settings.model);assert.equal(body.store,false);assert.deepEqual(body.input,f.request.messages);
  assert.equal(http.calls.length,1);assert.equal(getEventListeners(f.context.signal,'abort').length,0);
 }finally{http.restore();}
});

test('OpenAI HTTP status normalization covers authentication, model access, rate limits, quota, redirects and server failures without retries',async t=>{
 for(const [status,error,code] of [[400,{},'INVALID_INPUT'],[401,{},'PROVIDER_AUTH_FAILED'],[403,{},'PROVIDER_AUTH_FAILED'],
  [404,{},'MODEL_UNAVAILABLE'],[429,{},'PROVIDER_RATE_LIMITED'],[429,{code:'insufficient_quota'},'PROVIDER_QUOTA_EXCEEDED'],
  [500,{},'PROVIDER_UNAVAILABLE'],[503,{},'PROVIDER_UNAVAILABLE'],[307,{},'CONFIGURATION_ERROR']]) {
  const f=fixture(),http=server(t,({send})=>send({error:{...error,message:TEST_KEY}},status));
  try{await assert.rejects(new OpenaiHttpTransport(dns).postResponses(f.settings.endpoint,{},f.context,TEST_KEY),
   e=>match(code)(e)&&!JSON.stringify(e).includes(TEST_KEY));assert.equal(http.calls.length,1);}finally{http.restore();}
 }
});

test('OpenAI transport rejects malformed UTF8/JSON, oversized responses, unsupported compression and missing JSON content type',async t=>{
 for(const [body,headers,code] of [['not json',{},'INVALID_PROVIDER_OUTPUT'],[Buffer.from([0xc3,0x28]),{},'INVALID_PROVIDER_OUTPUT'],
  ['x'.repeat(65537),{},'OUTPUT_LIMIT_EXCEEDED'],[response(),{'content-length':'65537'},'OUTPUT_LIMIT_EXCEEDED'],
  [response(),{'content-encoding':'gzip'},'INVALID_PROVIDER_OUTPUT'],[response(),{'content-type':'text/html'},'INVALID_PROVIDER_OUTPUT']]) {
  const f=fixture(),http=server(t,({send})=>send(body,200,headers));
  try{await assert.rejects(new OpenaiHttpTransport(dns).postResponses(f.settings.endpoint,{},f.context,TEST_KEY),match(code));}finally{http.restore();}
 }
});

test('OpenAI DNS/endpoint admission rejects mixed answers, rebinding and untrusted destinations before sending credentials',async t=>{
 const f=fixture(),http=server(t,()=>assert.fail('unexpected HTTPS'));
 try{
  for(const answers of [[],[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}],
   [{address:'8.8.8.8',family:6}]])
   await assert.rejects(new OpenaiHttpTransport(async()=>answers).postResponses(f.settings.endpoint,{},f.context,TEST_KEY),match('CONFIGURATION_ERROR'));
  for(const origin of ['https://other.example','https://api.openai.com:444','http://api.openai.com'])
   await assert.rejects(new OpenaiHttpTransport(dns).postResponses({...f.settings.endpoint,origin}, {},f.context,TEST_KEY),match('CONFIGURATION_ERROR'));
  await assert.rejects(new OpenaiHttpTransport(async()=>{throw new Error('private DNS');}).postResponses(f.settings.endpoint,{},f.context,TEST_KEY),match('PROVIDER_UNAVAILABLE'));
  await assert.rejects(new OpenaiHttpTransport(dns).postResponses(f.settings.endpoint,{text:'x'.repeat(32769)},f.context,TEST_KEY),match('INVALID_INPUT'));
  await assert.rejects(new OpenaiHttpTransport(dns).postResponses(f.settings.endpoint,{},f.context,'bad\r\nkey'),match('PROVIDER_AUTH_FAILED'));
  assert.equal(http.calls.length,0);
 }finally{http.restore();}
});

test('OpenAI native transport aborts timed out and explicitly cancelled requests and consumes late DNS safely',async t=>{
 for(const cancel of [false,true]){
  const f=fixture(cancel?1000:15),http=server(t,()=>{}),transport=new OpenaiHttpTransport(dns);
  try{
   const provider=new OpenaiProvider({value:f.config},transport,{info(){}}),pending=provider.generate(f.request,f.context);
   if(cancel)setTimeout(()=>f.controller.abort('private cancellation'),5);
   await assert.rejects(pending,match(cancel?'CANCELLED':'DEADLINE_EXCEEDED'));
   await new Promise(r=>setImmediate(r));assert.equal(http.calls.length,1);assert.ok(http.destroyed>0);
   assert.equal(getEventListeners(f.context.signal,'abort').length,0);
  }finally{http.restore();}
 }
 const f=fixture(15);let complete;const dnsWait=new Promise(r=>complete=r),http=server(t,()=>assert.fail('late DNS socket'));
 try{
  const pending=new OpenaiProvider({value:f.config},new OpenaiHttpTransport(()=>dnsWait),{info(){}}).generate(f.request,f.context);
  await assert.rejects(pending,match('DEADLINE_EXCEEDED'));complete(await dns());await new Promise(r=>setImmediate(r));assert.equal(http.calls.length,0);
 }finally{http.restore();}
});

test('OpenAI transport normalizes TLS, network and unexpected failures without raw messages or response bodies',async t=>{
 for(const [errorCode,code] of [['ECONNREFUSED','PROVIDER_UNAVAILABLE'],['ENOTFOUND','PROVIDER_UNAVAILABLE'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT','CONFIGURATION_ERROR'],['HPE_INVALID_HEADER_TOKEN','INVALID_PROVIDER_OUTPUT'],['UNEXPECTED','PROVIDER_UNAVAILABLE']]){
  const f=fixture(),http=server(t,({req})=>req.emit('error',Object.assign(new Error(TEST_KEY),{code:errorCode})));
  try{await assert.rejects(new OpenaiHttpTransport(dns).postResponses(f.settings.endpoint,{},f.context,TEST_KEY),
   e=>match(code)(e)&&!JSON.stringify(e).includes(TEST_KEY));assert.equal(http.calls.length,1);}finally{http.restore();}
 }
});
