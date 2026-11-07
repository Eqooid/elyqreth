import {test} from 'node:test';import assert from 'node:assert/strict';
import {InteractionApiClient,InteractionApiError,createSubmissionIntent} from '../dist/js/runtime/interaction/index.js';
import {RuntimeApiClient} from '../dist/js/runtime/api-client.js';
import {FakeClock,deferred,flush,response,page} from './runtime-fixtures.js';
import {id,stamp,agent,task,taskDetail,execution,result,started,intent,ref,execRef,grant} from './interaction-fixtures.js';
const token='I'.repeat(40),connection={baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173'};
function client(fetchImpl,options={}){const c=new InteractionApiClient({...connection,fetchImpl,...options});c.authorize(token);return c;}

test('interaction client stays disabled without credentials, validates local configuration and keeps both audiences independent',async()=>{
 let calls=0;const c=new InteractionApiClient({...connection,fetchImpl:async()=>{calls++;return response(agent());}});
 assert.equal(c.hasCredential,false);await assert.rejects(c.getAgent(id(1)),{code:'AUTH_REQUIRED'});assert.equal(calls,0);
 for(const patch of [{baseUrl:'https://public.invalid'},{pageOrigin:'https://public.invalid'},{baseUrl:connection.baseUrl+'/api'},{executeTimeoutMs:5000},{timeoutMs:0}])assert.throws(()=>new InteractionApiClient({...connection,...patch}),{code:'CONFIGURATION'});
 assert.throws(()=>c.authorize('short'),{code:'CONFIGURATION'});c.authorize(token);await c.getAgent(id(1));assert.equal(calls,1);
 assert.ok(!JSON.stringify(c).includes(token));c.clearCredential();assert.equal(c.hasCredential,false);
 const city=new RuntimeApiClient({...connection,fetchImpl:async()=>response(page())});city.authorize('C'.repeat(40));await city.fetchPage();assert.equal(c.hasCredential,false);
});
test('Agent eligibility, Task/detail/status and execution requests use fixed routes, exact references and safe headers',async()=>{
 const calls=[];const replies=[agent(),taskDetail(),{...taskDetail(),latestExecutionId:id(3)},{...execution(),actionEligibility:grant}];
 const c=client(async(url,options)=>{calls.push({url,options});return response(replies.shift());});
 assert.equal((await c.getAgent(id(1),{requestId:'safe.request-1'})).actionEligibility.canCreateTask,true);
 assert.equal((await c.getTask(ref())).id,id(2));assert.equal((await c.getTaskStatus(ref())).latestExecutionId,id(3));
 assert.equal((await c.getExecution(execRef())).status,'SUCCEEDED');
 assert.deepEqual(calls.map(x=>new URL(x.url).pathname),[`/api/v1/agents/${id(1)}`,`/api/v1/tasks/${id(2)}`,`/api/v1/tasks/${id(2)}/status`,`/api/v1/tasks/${id(2)}/executions/${id(3)}`]);
 for(const {options} of calls){assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,`Bearer ${token}`);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.body,undefined);}
 assert.equal(calls[0].options.headers['X-Request-Id'],'safe.request-1');
});
test('Task submission preserves body idempotency and input across explicit same-intent replays, with no implicit execution',async()=>{
 const calls=[];const c=client(async(url,options)=>{calls.push({url,options});return response(taskDetail(),calls.length===1?201:200);});
 const frozen=createSubmissionIntent(id(1),{instruction:'  Keep spacing  ',context:'Public context'});
 assert.ok(Object.isFrozen(frozen)&&Object.isFrozen(frozen.input));assert.match(frozen.idempotencyKey,/^city\.[0-9a-f-]{36}$/);
 assert.notEqual(createSubmissionIntent(id(1),{instruction:'another'}).idempotencyKey,frozen.idempotencyKey);
 await c.createTask(frozen);await c.createTask(frozen);assert.equal(calls.length,2);
 assert.equal(calls[0].options.body,calls[1].options.body);assert.deepEqual(JSON.parse(calls[0].options.body),frozen);
 assert.equal(calls[0].options.headers['Idempotency-Key'],undefined);assert.equal(calls[0].options.headers['If-Match'],undefined);
 assert.ok(calls.every(x=>new URL(x.url).pathname==='/api/v1/tasks'));
});
test('execute and cancel quote the correct versions and never manufacture a local status transition',async()=>{
 const calls=[];const running=execution({status:'RUNNING',finishedAt:null,durationMs:null,resultAvailability:'PENDING'});
 const c=client(async(url,options)=>{calls.push({url,options});return response(calls.length===1?started():{task:task({status:'RUNNING'}),execution:running});});
 const completed=await c.executeTask(ref(),7);assert.equal(completed.execution.id,id(3));assert.equal(completed.task.status,'COMPLETED');
 const acknowledged=await c.cancelExecution(execRef(),{taskVersion:9,executionVersion:11});assert.equal(acknowledged.execution.status,'RUNNING');
 assert.equal(calls[0].options.headers['If-Match'],'"7"');assert.deepEqual(JSON.parse(calls[0].options.body),{});
 assert.equal(calls[1].options.headers['If-Match'],'"11"');assert.deepEqual(JSON.parse(calls[1].options.body),{taskVersion:9});
});
test('result retrieval handles structured/text, pending, unavailable and disclosure-restricted output without raw metadata',async()=>{
 const cases=[{execution:execution(),availability:'AVAILABLE',result:result()},
  {execution:execution(),availability:'AVAILABLE',result:result({output:{type:'text',text:'<img onerror=alert(1)>'},provider:{id:'private-profile'}})},
  {execution:execution({status:'PENDING',startedAt:null,finishedAt:null,durationMs:null,resultAvailability:'PENDING'}),availability:'PENDING',result:null},
  {execution:execution({status:'FAILED',errorCode:'EXECUTION_ERROR',errorMessage:'private raw error',resultAvailability:'UNAVAILABLE'}),availability:'UNAVAILABLE',result:null},
  {execution:execution(),availability:'UNAVAILABLE',result:null,displayReason:'DISCLOSURE_RESTRICTED'}];
 for(const value of cases){const c=client(async()=>response({...value,rawToolArguments:{secret:'hidden'}}));const read=await c.getResult(execRef());
  assert.ok(Object.isFrozen(read));assert.equal(read.availability,value.availability);assert.equal(read.rawToolArguments,undefined);
  assert.ok(!JSON.stringify(read).includes('private-profile'));assert.ok(!JSON.stringify(read).includes('private raw error'));
 }
 const c=client(async()=>response(started({result:null,displayReason:'DISCLOSURE_RESTRICTED'})));assert.equal((await c.executeTask(ref(),1)).result,null);
});
test('history reads exactly one bounded page, preserves opaque cursor and backend microsecond ordering',async()=>{
 const calls=[],before='v1.opaque',next='v1.next';const items=[execution({id:id(2)}),execution({id:id(9)})];
 const c=client(async(url)=>{calls.push(url);return response({items,pagination:{limit:2,nextCursor:next}});});
 const history=await c.listAgentExecutions(id(1),{limit:2,before});assert.equal(calls.length,1);assert.deepEqual(history.items.map(e=>e.id),[id(2),id(9)]);
 assert.equal(new URL(calls[0]).searchParams.get('before'),before);assert.equal(history.pagination.nextCursor,next);
});
test('recovery returns a nullable exact Task reference without repeating Create or Start',async()=>{
 const calls=[];const c=client(async(url,options)=>{calls.push({url,options});return response({task:calls.length===1?task():null});});
 assert.equal((await c.findTaskByIntent(id(1),'city.same.key')).task.id,id(2));assert.equal((await c.findTaskByIntent(id(1),'city.same.key')).task,null);
 for(const call of calls){const url=new URL(call.url);assert.equal(url.pathname,'/api/v1/tasks/lookup');assert.equal(url.searchParams.get('idempotencyKey'),'city.same.key');assert.equal(call.options.method,'GET');}
});
test('input limits, unsupported fields, identifiers, query limits and versions fail before dispatch without leaking input',async()=>{
 let calls=0;const c=client(async()=>{calls++;return response(taskDetail());});
 const bad=[()=>c.createTask({...intent(),ownerId:id(5)}),()=>c.createTask({...intent(),input:{instruction:'x'.repeat(16001)}}),()=>c.createTask({...intent(),input:{instruction:'valid',context:'x'.repeat(16001)}}),
  ()=>c.createTask({...intent(),input:{instruction:'\u0000'}}),()=>c.createTask({...intent(),input:{instruction:'password=private-value'}}),()=>c.createTask({...intent(),idempotencyKey:''}),
  ()=>c.createTask({...intent(),input:{instruction:'😀'.repeat(8000),context:'😀'.repeat(8000)}}),()=>c.getAgent('bad/id'),()=>c.executeTask(ref(),'1'),()=>c.executeTask(ref(),2147483648),
  ()=>c.cancelExecution(execRef(),{taskVersion:1,executionVersion:1,ownerId:id(1)}),()=>c.listAgentExecutions(id(1),{limit:21}),()=>c.listAgentExecutions(id(1),{offset:0}),()=>c.getAgent(id(1),{requestId:'unsafe\nheader'})];
 for(const work of bad)await assert.rejects(work(),error=>{assert.equal(error.code,'VALIDATION');assert.ok(!JSON.stringify(error).includes('private-value'));return true;});
 assert.equal(calls,0);
});
test('malformed, wrong-identity and unknown lifecycle responses fail safely instead of becoming authoritative state',async()=>{
 for(const body of [agent({id:id(6)}),agent({actionEligibility:undefined}),agent({lifecycleStatus:'OFFLINE'}),agent({createdAt:'yesterday'})])await assert.rejects(client(async()=>response(body)).getAgent(id(1)),{code:'SCHEMA'});
 await assert.rejects(client(async()=>response(taskDetail({agentId:id(8)}))).createTask(intent()),{code:'SCHEMA',outcome:'UNKNOWN'});
 await assert.rejects(client(async()=>response({...execution({taskId:id(8)}),actionEligibility:grant})).getExecution(execRef()),{code:'SCHEMA'});
 await assert.rejects(client(async()=>response(started({correlationId:id(9)}))).executeTask(ref(),1),{code:'SCHEMA'});
 for(const body of [{execution:execution(),availability:'AVAILABLE',result:result({output:{type:'text',text:''}})},
  {execution:execution(),availability:'AVAILABLE',result:result({output:{type:'unknown',data:'unsupported'}})},
  {execution:execution(),availability:'AVAILABLE',result:result({executionId:id(8)})}])await assert.rejects(client(async()=>response(body)).getResult(execRef()),{code:'SCHEMA'});
});
test('HTTP errors retain only closed backend codes and safe request IDs, distinguish conflicts and never retry',async()=>{
 for(const [status,backendCode,code] of [[400,'INVALID_INPUT','VALIDATION'],[401,'UNAUTHORIZED','AUTH_REQUIRED'],[403,'ACCESS_DENIED','FORBIDDEN'],[404,'NOT_FOUND','NOT_FOUND'],[409,'CAPACITY_EXCEEDED','CONFLICT'],[422,'TOOL_FAILED','RUNTIME_FAILURE'],[429,'PROVIDER_RATE_LIMITED','RATE_LIMITED'],[500,'INTERNAL_RUNTIME_ERROR','RUNTIME_FAILURE'],[503,'PROVIDER_UNAVAILABLE','SERVER'],[504,'DEADLINE_EXCEEDED','TIMEOUT']]){
  let calls=0;const c=client(async()=>{calls++;return response({code:backendCode,message:'private prompt or provider error',stack:'secret',requestId:'safe-123'},status,{'retry-after':'999'});});
  await assert.rejects(c.createTask(intent()),error=>{assert.equal(error.code,code);assert.equal(error.backendCode,backendCode);assert.equal(error.status,status);assert.equal(error.outcome,'UNKNOWN');assert.equal(error.requestId,'safe-123');assert.equal(error.retryAfterMs,60000);assert.ok(!JSON.stringify(error).includes('private prompt'));return true;});assert.equal(calls,1);
  if(status===401){assert.equal(c.hasCredential,false);await assert.rejects(c.getAgent(id(1)),{code:'AUTH_REQUIRED'});assert.equal(calls,1);}
  if(status===403)assert.equal(c.hasCredential,true);
 }
 const c=client(async()=>response({code:'UNTRUSTED_SECRET_CODE',requestId:'unsafe\n',message:'diagnostics'},409));await assert.rejects(c.executeTask(ref(),1),e=>e.backendCode===undefined&&e.requestId===undefined&&e.code==='CONFLICT');
});
test('network failure is distinct from malformed/oversized response and leaves mutation outcome uncertain',async()=>{
 const c=client(async()=>{throw Error('private DNS/credential diagnostic');});await assert.rejects(c.createTask(intent()),{code:'NETWORK',outcome:'UNKNOWN',source:'network'});
 for(const fetch of [async()=>response('broken JSON'),async()=>response(agent(),200,{'content-type':'text/html'}),async()=>response('x'.repeat(131073)),async()=>new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}})])await assert.rejects(client(fetch).getAgent(id(1)),{code:'SCHEMA'});
});
test('read and mutation abort, fixed execution wait and noncooperative fetches clean timers and preserve caller signals',async()=>{
 const clock=new FakeClock(),pending=deferred(),c=client(()=>pending.promise,{clock,timers:clock});
 const waiting=c.getAgent(id(1));const rejected=assert.rejects(waiting,{code:'TIMEOUT',source:'timeout'});await clock.advance(5000);await rejected;assert.equal(clock.timers.size,0);
 const executionWait=c.executeTask(ref(),1);const rejectedExecution=assert.rejects(executionWait,{code:'TIMEOUT',outcome:'UNKNOWN'});await clock.advance(30000);assert.equal(clock.timers.size,1);await clock.advance(5000);await rejectedExecution;assert.equal(clock.timers.size,0);
 const signal=new AbortController(),mutation=c.createTask(intent(),{signal:signal.signal});const rejectedMutation=assert.rejects(mutation,{code:'CANCELLED',outcome:'UNKNOWN'});signal.abort('private caller reason');await rejectedMutation;assert.equal(clock.timers.size,0);
 const before=new AbortController();before.abort();let calls=0;const early=client(async()=>{calls++;return response(taskDetail());},{clock,timers:clock});await assert.rejects(early.createTask(intent(),{signal:before.signal}),{code:'CANCELLED',outcome:'NOT_SENT'});assert.equal(calls,0);
 pending.resolve(response(agent()));await flush();
});
test('credential changes and authorization failures fence late responses and cancel other in-flight requests',async()=>{
 const late=deferred(),c=client(()=>late.promise),old=c.getAgent(id(1));const oldRejected=assert.rejects(old,{code:'CANCELLED'});c.authorize('J'.repeat(40));await oldRejected;late.resolve(response(agent()));await flush();
 let calls=0;const gate=deferred(),d=client(async()=>++calls===1?gate.promise:response({},401));const first=d.createTask(intent());const firstRejected=assert.rejects(first,{code:'AUTH_REQUIRED',outcome:'UNKNOWN'});
 await assert.rejects(d.getAgent(id(1)),{code:'AUTH_REQUIRED',status:401});await firstRejected;assert.equal(d.hasCredential,false);gate.resolve(response(taskDetail()));await flush();
});
test('caller abort listeners and partial response readers are disposed, including dispose while waiting',async()=>{
 const clock=new FakeClock(),controller=new AbortController();let adds=0,removes=0;
 const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
 controller.signal.addEventListener=(...args)=>{adds++;return add(...args);};controller.signal.removeEventListener=(...args)=>{removes++;return remove(...args);};
 const c=client(async()=>response(agent()),{clock,timers:clock});await c.getAgent(id(1),{signal:controller.signal});assert.equal(adds,removes);assert.equal(controller.signal.aborted,false);assert.equal(clock.timers.size,0);
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
 const d=client(async()=>new Response(stream,{headers:{'content-type':'application/json'}}),{clock,timers:clock});const waiting=d.getAgent(id(1));const rejected=assert.rejects(waiting,{code:'CANCELLED'});await flush();d.dispose();await rejected;await flush();assert.equal(cancelled,true);assert.equal(clock.timers.size,0);
});
test('an operation-specific 403 does not cancel an independently pending execution or revoke its credential',async()=>{
 const pending=deferred();let calls=0;const c=client(async()=>++calls===1?pending.promise:response({code:'TOOL_DENIED'},403));
 const executing=c.executeTask(ref(),1);await assert.rejects(c.getAgent(id(1)),{code:'FORBIDDEN',backendCode:'TOOL_DENIED'});
 pending.resolve(response(started()));assert.equal((await executing).execution.status,'SUCCEEDED');assert.equal(c.hasCredential,true);
});
test('aborting or changing credentials after error headers wins over a stalled old error body',async()=>{
 for(const status of [401,404]){
  const clock=new FakeClock(),caller=new AbortController();const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}});
  const c=client(async()=>new Response(stream,{status,headers:{'content-type':'application/json'}}),{clock,timers:clock});
  const pending=c.createTask(intent(),{signal:caller.signal}),rejected=assert.rejects(pending,{code:'CANCELLED',source:'abort',outcome:'UNKNOWN'});await flush();
  if(status===401)c.authorize('J'.repeat(40));else caller.abort();await rejected;assert.equal(clock.timers.size,0);
  if(status===401)assert.equal(c.hasCredential,true);
 }
});
test('credentials cannot be used as support IDs or echoed from error support metadata',async()=>{
 let calls=0;const c=client(async()=>{calls++;return response({code:'CONFLICT'},409,{'x-request-id':token});});
 await assert.rejects(c.getAgent(id(1),{requestId:token}),{code:'VALIDATION'});assert.equal(calls,0);
 await assert.rejects(c.createTask(intent()),error=>error.requestId===undefined&&!JSON.stringify(error).includes(token));
});
