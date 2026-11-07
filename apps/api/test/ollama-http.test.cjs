'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {join}=require('node:path');
const {getEventListeners}=require('node:events');
const {OllamaProvider}=require('../dist/runtime/providers/ollama/ollama.provider');
const {OllamaHttpTransport,ollamaDns}=require('../dist/runtime/providers/ollama/ollama-http.transport');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {withProviderDeadline}=require('../dist/runtime/providers/provider-deadline');
const {fixture,response}=require('./ollama-fixtures.cjs');
const code=name=>e=>e?.code===name;
async function server(handler){const s=createServer(handler);await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});
 return {origin:`http://127.0.0.1:${s.address().port}`,port:s.address().port,async close(){s.closeAllConnections();await new Promise(r=>s.close(r));}};}
function client(f,dns=ollamaDns){const logs=[];const provider=new OllamaProvider({value:f.config},new OllamaHttpTransport(dns),{info:(...v)=>logs.push(v)});
 const registry=new LlmProviderRegistry([provider]),selection=new ProviderSelectionService({value:f.config},registry);
 return {provider,registry,selection,selected:()=>selection.select(f.definition),logs};}
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};

test('real HTTP fixture: registry/selection map ordered chat request and Unicode usage with no eager calls or prompt logs',{timeout:10000},async()=>{
 const received=[];const s=await server(async(req,res)=>{const parts=[];for await(const part of req)parts.push(part);
  const body=JSON.parse(Buffer.concat(parts));received.push({method:req.method,path:req.url,headers:req.headers,body});json(res,{...response(),message:{role:'assistant',content:'Hello \u{1f600} \u754c',thinking:'private reasoning'}});});
 try{const f=fixture(s.origin),c=client(f);c.selection.onModuleInit();assert.equal(c.registry.resolve('ollama').id,'ollama');assert.equal(received.length,0);
  f.request.messages.push({role:'assistant',content:'Previous answer'});const result=await c.selected().provider.generate(f.request,f.context);
  assert.equal(received.length,1);assert.equal(received[0].path,'/api/chat');assert.equal(received[0].method,'POST');
  assert.deepEqual(received[0].body.messages,f.request.messages);assert.equal(received[0].body.options.num_predict,128);
  assert.equal(received[0].body.options.num_ctx,8192);assert.equal(received[0].body.stream,false);assert.equal(received[0].headers.authorization,undefined);
  assert.equal(result.text,'Hello \u{1f600} \u754c');assert.deepEqual(result.usage,{inputTokens:2,outputTokens:3,totalTokens:5});
  assert.equal(getEventListeners(f.context.signal,'abort').length,0);
  assert.ok(!JSON.stringify({logs:c.logs,result}).includes('Nonsensitive'));assert.ok(!JSON.stringify(result).includes('reasoning'));
  assert.throws(()=>c.registry.register(c.provider),code('CONFIGURATION_ERROR'));
 }finally{await s.close();}
});
test('HTTP statuses normalize without following redirects, retries, error-body leaks or provider fallback',{timeout:10000},async()=>{
 let status=400,calls=0;const s=await server((req,res)=>{calls++;res.statusCode=status;if(status===302)res.setHeader('location','http://169.254.169.254/private');json(res,{error:'private server diagnostics'});});
 try{const f=fixture(s.origin),c=client(f);for(const [s,expected]of [[400,'INVALID_INPUT'],[401,'PROVIDER_AUTH_FAILED'],[403,'PROVIDER_AUTH_FAILED'],[404,'MODEL_UNAVAILABLE'],[429,'PROVIDER_RATE_LIMITED'],[500,'PROVIDER_UNAVAILABLE'],[503,'PROVIDER_UNAVAILABLE'],[302,'CONFIGURATION_ERROR']]){
   status=s;await assert.rejects(c.selected().provider.generate(f.request,f.context),e=>e.code===expected&&!JSON.stringify(e).includes('private'));
  }assert.equal(calls,8);
 }finally{await s.close();}
});
test('header/body timeouts and caller cancellation actually close HTTP sockets; no startup/model dependency',{timeout:10000},async()=>{
 let body=false,entered;let ready;let socketsClosed=0;
 const s=await server((req,res)=>{req.socket.once('close',()=>socketsClosed++);if(body){res.writeHead(200,{'content-type':'application/json'});res.write('{');}entered?.();});
 try{for(const partial of [false,true]){body=partial;const f=fixture(s.origin,60);await assert.rejects(client(f).selected().provider.generate(f.request,f.context),code('DEADLINE_EXCEEDED'));}
  const f=fixture(s.origin);ready=new Promise(r=>entered=r);const running=client(f).selected().provider.generate(f.request,f.context);
  await ready;f.controller.abort('private abort reason');await assert.rejects(running,e=>e.code==='CANCELLED'&&!JSON.stringify(e).includes('private'));
  assert.equal(getEventListeners(f.context.signal,'abort').length,0);
  await new Promise(r=>setTimeout(r,50));assert.equal(socketsClosed,3);
 }finally{await s.close();}
});
test('invalid JSON/UTF-8, compressed or streaming bodies, oversized headers/body and incomplete responses fail safely',{timeout:10000},async()=>{
 let mode;const s=await server((req,res)=>{
  res.setHeader('content-type','application/json');
  if(mode==='json')return res.end('{bad');
  if(mode==='utf8')return res.end(Buffer.from([0xff,0xfe]));
  if(mode==='compressed'){res.setHeader('content-encoding','gzip');return json(res,response());}
  if(mode==='stream'){res.setHeader('content-type','application/x-ndjson');return res.end('{}\n{}');}
  if(mode==='headers'){res.setHeader('x-padding','x'.repeat(9000));return json(res,response());}
  if(mode==='length'){res.setHeader('content-length','70000');return res.end('x');}
  if(mode==='body'){res.writeHead(200);res.write('x'.repeat(40000));return res.end('x'.repeat(40000));}
  if(mode==='partial'){res.setHeader('content-length','400');res.write('{');setImmediate(()=>res.destroy());return;}
  json(res,{...response(),done:false});
 });
 try{const f=fixture(s.origin),c=client(f);for(const [name,expected]of [['json','INVALID_PROVIDER_OUTPUT'],['utf8','INVALID_PROVIDER_OUTPUT'],['compressed','INVALID_PROVIDER_OUTPUT'],['stream','INVALID_PROVIDER_OUTPUT'],['headers','INVALID_PROVIDER_OUTPUT'],['length','OUTPUT_LIMIT_EXCEEDED'],['body','OUTPUT_LIMIT_EXCEEDED'],['partial','PROVIDER_UNAVAILABLE'],['incomplete','INVALID_PROVIDER_OUTPUT']]){
   mode=name;await assert.rejects(c.selected().provider.generate(f.request,f.context),code(expected));
  }
 }finally{await s.close();}
});
test('DNS answers are checked on each request and IP pinned; rebinding, mixed answers and late DNS cannot dispatch',{timeout:10000},async()=>{
 let calls=0,hostHeader;const s=await server((req,res)=>{calls++;hostHeader=req.headers.host;json(res,response());});
 try{const f=fixture(`http://ollama.test:${s.port}`);let lookups=0;
  const c=client(f,async()=>{lookups++;return lookups===1?[{address:'127.0.0.1',family:4}]:[{address:'169.254.169.254',family:4}];});
  await c.selected().provider.generate(f.request,f.context);assert.equal(hostHeader,`ollama.test:${s.port}`);
  await assert.rejects(c.selected().provider.generate(f.request,f.context),code('CONFIGURATION_ERROR'));assert.equal(calls,1);assert.equal(lookups,2);
  await assert.rejects(client(f,async()=>[{address:'127.0.0.1',family:4},{address:'169.254.169.254',family:4}]).selected().provider.generate(f.request,f.context),code('CONFIGURATION_ERROR'));
  await assert.rejects(client(f,async()=>{throw Object.assign(new Error('private DNS details'),{code:'ENOTFOUND'});}).selected().provider.generate(f.request,f.context),code('PROVIDER_UNAVAILABLE'));
  let resolve;const slow=client(f,()=>new Promise(r=>resolve=r));const operation=slow.selected().provider.generate(f.request,f.context);
  while(!resolve)await new Promise(r=>setImmediate(r));f.controller.abort();await assert.rejects(operation,code('CANCELLED'));
  resolve([{address:'127.0.0.1',family:4}]);await new Promise(r=>setTimeout(r,30));assert.equal(calls,1);
 }finally{await s.close();}
});
test('connection refused normalizes and native transport ignores proxy environment even in a new process',{timeout:10000},async()=>{
 const unused=await server((req,res)=>res.end());const closedOrigin=unused.origin;await unused.close();
 const refused=fixture(closedOrigin);await assert.rejects(client(refused).selected().provider.generate(refused.request,refused.context),code('PROVIDER_UNAVAILABLE'));
 let targetCalls=0,proxyCalls=0;const target=await server((req,res)=>{targetCalls++;json(res,response());});
 const proxy=await server((req,res)=>{proxyCalls++;res.statusCode=500;res.end('proxy must not receive prompt');});
 try{const script=`const {fixture}=require('./test/ollama-fixtures.cjs'); const {OllamaProvider}=require('./dist/runtime/providers/ollama/ollama.provider'); const {OllamaHttpTransport,ollamaDns}=require('./dist/runtime/providers/ollama/ollama-http.transport'); const f=fixture(process.env.TEST_ORIGIN); new OllamaProvider({value:f.config},new OllamaHttpTransport(ollamaDns),{info(){}}).generate(f.request,f.context).then(r=>console.log(r.kind),e=>{console.error(e.toJSON());process.exitCode=1;});`;
  const out=await promisify(execFile)(process.execPath,['-e',script],{cwd:join(__dirname,'..'),timeout:8000,env:{...process.env,TEST_ORIGIN:target.origin,HTTP_PROXY:proxy.origin,HTTPS_PROXY:proxy.origin,ALL_PROXY:proxy.origin,NO_PROXY:'',NODE_USE_ENV_PROXY:'1'}});
  assert.equal(out.stdout.trim(),'text');assert.equal(out.stderr,'');assert.equal(targetCalls,1);assert.equal(proxyCalls,0);
 }finally{await target.close();await proxy.close();}
});
