import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeApiClient} from '../dist/js/runtime/api-client.js';
import {normalizeActivity,normalizePage} from '../dist/js/runtime/validation.js';
import {id,token,activity,page,response,deferred,flush,FakeClock} from './runtime-fixtures.js';
function client(fetchImpl,clock=new FakeClock()){
 const c=new RuntimeApiClient({baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',fetchImpl,timers:clock,clock});c.authorize(token);return c;
}
test('runtime client uses exact city GET contracts, approved origin, pagination, credentials and safe request policy',async()=>{
 const calls=[],c=client(async(url,options)=>{calls.push({url,options});return response(String(url).includes('/activity')?activity():page([activity(2)]));});
 assert.equal((await c.fetchActivity(id(1))).agentId,id(1));
 await c.fetchPage({limit:1,after:id(1),ids:[id(2)]});
 assert.equal(calls[0].url,`http://127.0.0.1:3001/api/v1/cities/elyqreth/agents/${id(1)}/activity`);
 const u=new URL(calls[1].url);assert.equal(u.searchParams.get('after'),id(1));assert.equal(u.searchParams.get('ids'),id(2));
 for(const {options} of calls){assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,`Bearer ${token}`);}
 assert.equal(JSON.stringify(c),'{}');c.clearCredential();await assert.rejects(c.fetchPage(),{code:'AUTH_REQUIRED'});
});
test('runtime client validates optional null fields, preserves UNKNOWN and rejects malformed/partial RUNNING data',()=>{
 const minimal=activity();for(const key of ['currentTask','currentExecution','npcId','bindingId','recentOutcome','lastExecution'])delete minimal[key];
 const normalized=normalizeActivity(minimal);assert.equal(normalized.currentExecution,null);assert.ok(Object.isFrozen(normalized));
 assert.equal(normalizeActivity(activity(1,{activityStatus:'UNKNOWN',requiresAttention:true,statusReason:'LEASE_UNVERIFIED'})).activityStatus,'UNKNOWN');
 for(const patch of [{activityStatus:'WORKING'},{activityStatus:'RUNNING'},{observedAt:'yesterday'},{lastActivityAt:'2026-02-30T12:00:00.000Z'},
  {npcId:'resident-slot-001'},{activeExecutionCount:Infinity},{agentVersion:0},{schemaVersion:2}])assert.throws(()=>normalizeActivity(activity(1,patch)),{code:'SCHEMA'});
 const raw=activity(1,{configuration:{apiKey:'do-not-copy'},input:'private',name:'<script>text only</script>'});
 assert.ok(!JSON.stringify(normalizeActivity(raw)).includes('do-not-copy'));assert.equal(normalizeActivity(raw).name,raw.name);
});
test('runtime page validation handles empty scope and rejects unsorted, repeated, malformed or inconsistent pagination',()=>{
 assert.deepEqual(normalizePage(page()).items,[]);
 for(const value of [page([activity(2),activity(1)]),page([activity(),activity()]),page([],id(1)),page([activity()],id(2)),
  {...page(),nextCursor:undefined},{...page(),items:[{...activity(),observedAt:'2026-10-24T12:00:01.000Z'}]}])assert.throws(()=>normalizePage(value),{code:'SCHEMA'});
});
test('runtime client normalizes HTTP errors without retaining response diagnostics or exposing credentials',async()=>{
 for(const [status,code] of [[401,'AUTH_REQUIRED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[400,'VALIDATION'],[429,'RATE_LIMITED'],[503,'SERVER']]){
  const c=client(async()=>response({stack:'secret raw server content'},status,{'retry-after':'9'}));
  await assert.rejects(c.fetchPage(),error=>{assert.equal(error.code,code);assert.ok(!JSON.stringify(error).includes('secret'));if(status===429)assert.equal(error.retryAfterMs,9000);return true;});
 }
 const c=client(async()=>{throw Error('private network diagnostics');});await assert.rejects(c.fetchPage(),{code:'NETWORK'});
});
test('runtime response parsing enforces content type, JSON/UTF-8, actual byte limits and single-Agent identity',async()=>{
 const bad=[()=>response('not JSON'),()=>response(page(),206),()=>response(page(),200,{'content-type':'text/html'}),()=>response('x'.repeat(65537)),
  ()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}})];
 for(const make of bad)await assert.rejects(client(async()=>make()).fetchPage(),{code:'SCHEMA'});
 await assert.rejects(client(async()=>response(activity(2))).fetchActivity(id(1)),{code:'SCHEMA'});
 await assert.rejects(client(async()=>response(page([activity(2)]))).fetchPage({ids:[id(1)]}),{code:'SCHEMA'});
 await assert.rejects(client(async()=>response(page())).fetchPage({provider:'openai'}),{code:'VALIDATION'});
});
test('runtime client propagates cancellation, removes caller listeners and enforces timeout even for ignored signals',async()=>{
 const clock=new FakeClock(),pending=deferred();let transportSignal,calls=0;
 const c=client(async(_,options)=>{calls++;transportSignal=options.signal;return pending.promise;},clock);
 const before=new AbortController();before.abort();await assert.rejects(c.fetchPage({},{signal:before.signal}),{code:'CANCELLED'});assert.equal(calls,0);
 const caller=new AbortController();let adds=0,removes=0;const add=caller.signal.addEventListener.bind(caller.signal),remove=caller.signal.removeEventListener.bind(caller.signal);
 caller.signal.addEventListener=(...args)=>{adds++;return add(...args);};caller.signal.removeEventListener=(...args)=>{removes++;return remove(...args);};
 const result=c.fetchPage({},{signal:caller.signal});const rejected=assert.rejects(result,{code:'CANCELLED'});caller.abort('sensitive reason');await rejected;
 assert.equal(transportSignal.aborted,true);assert.equal(adds,removes);assert.equal(clock.timers.size,0);
 const timed=c.fetchPage();const expired=assert.rejects(timed,{code:'TIMEOUT'});await clock.advance(5000);await expired;assert.equal(clock.timers.size,0);
 pending.resolve(response(page()));await flush();
});
test('runtime client cancels a streaming body and rejects remote origins or invalid trusted configuration',async()=>{
 let cancelled=false;const caller=new AbortController();
 const c=client(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
 const result=c.fetchPage({},{signal:caller.signal});await flush();const rejected=assert.rejects(result,{code:'CANCELLED'});caller.abort();await rejected;await flush();assert.equal(cancelled,true);
 for(const baseUrl of ['https://api.openai.com','http://evil.invalid','http://user:pass@localhost:3001','http://127.0.0.1:3001/path','http://127.0.0.1:3001?x=1'])
  assert.throws(()=>new RuntimeApiClient({baseUrl,pageOrigin:'http://127.0.0.1:5173'}),{code:'CONFIGURATION'});
 assert.throws(()=>new RuntimeApiClient({baseUrl:'http://127.0.0.1:3001',pageOrigin:'https://public.invalid'}),{code:'CONFIGURATION'});
 assert.throws(()=>client(async()=>response(page())).authorize('short'),{code:'CONFIGURATION'});
});
