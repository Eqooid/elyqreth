import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeIntegration,runtimeIntegration} from '../dist/js/runtime/index.js';
import {RuntimeActivityStore} from '../dist/js/runtime/runtime-store.js';
import {normalizeActivity} from '../dist/js/runtime/validation.js';
import {id,token,otherToken,stamp,activity,page,response,deferred,flush,FakeClock,browserEvents} from './runtime-fixtures.js';
const connection={baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',token};
function setup(fetchImpl,options={}){const clock=new FakeClock(),events=browserEvents();
 const integration=createRuntimeIntegration({timers:clock,clock,random:()=>.5,fetchImpl,...events,...options});
 return {integration,clock,events,connect:()=>integration.connect(connection)};
}
test('disabled application boundary is SSR-safe, credential-free and provides a read-only T05 view without starting polling',()=>{
 assert.equal(runtimeIntegration.getSnapshot().phase,'DISCONNECTED');assert.ok(Object.isFrozen(runtimeIntegration.view));
 assert.equal(runtimeIntegration.view.connect,undefined);assert.equal(runtimeIntegration.view.refresh,undefined);
 const s=setup(async()=>{throw Error('must not fetch');});let calls=0;const a=s.integration.subscribe(()=>calls++),b=s.integration.subscribe(()=>calls++);
 assert.equal(calls,2);assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);a();b();s.integration.dispose();
});
test('initial loading, successful state, periodic refresh and multiple consumers share exactly one poller',async()=>{
 let requests=0;const s=setup(async()=>{requests++;return response(page([activity(1,{npcId:'resident-slot-001',bindingId:id(20)})]));});
 const states=[];s.integration.subscribe(v=>states.push(v));s.integration.subscribe(()=>{});s.connect();assert.equal(s.integration.getSnapshot().loading,true);
 await s.integration.refresh();assert.equal(requests,1);const first=s.integration.getAgent(id(1));
 assert.equal(s.integration.getSnapshot().phase,'READY');assert.equal(s.integration.getSnapshot().freshness,'fresh');assert.equal(s.integration.getByNpc('resident-slot-001'),first);
 assert.throws(()=>{first.name='mutate';},TypeError);assert.ok(states.some(s=>s.loading));assert.equal(s.integration.getSnapshot().lastObservedAt,stamp);
 await s.clock.advance(1999);assert.equal(requests,1);await s.clock.advance(1);assert.equal(requests,2);assert.equal(s.integration.getAgent(id(1)),first);
 s.integration.dispose();assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);
});
test('manual refresh coalesces with an active cycle and preserves last snapshot while refreshing',async()=>{
 let calls=0;const slow=deferred(),s=setup(async()=>++calls===1?response(page([activity()])):slow.promise);
 s.connect();await s.integration.refresh();const one=s.integration.refresh(),two=s.integration.refresh();assert.equal(one,two);assert.equal(calls,2);
 assert.equal(s.integration.getSnapshot().refreshing,true);assert.equal(s.integration.getAgent(id(1)).agentId,id(1));
 slow.resolve(response(page([activity(1,{availability:'DISABLED',agentVersion:2})])));await one;
 assert.equal(s.integration.getAgent(id(1)).availability,'DISABLED');assert.equal(calls,2);s.integration.dispose();
});
test('network failures mark last snapshot stale and recover through bounded exponential backoff without raw diagnostics',async()=>{
 let mode='ok',calls=0;const s=setup(async()=>{calls++;if(mode==='error')throw Error('secret diagnostic');return response(page([activity()]));});
 s.connect();await s.integration.refresh();mode='error';await s.integration.refresh();assert.equal(s.integration.getSnapshot().error.code,'NETWORK');
 assert.equal(s.integration.getSnapshot().stale,true);assert.equal(s.integration.getAgent(id(1)).agentId,id(1));assert.ok(!JSON.stringify(s.integration.getSnapshot()).includes('secret diagnostic'));
 await s.clock.advance(2000);assert.equal(calls,3);await s.clock.advance(3999);assert.equal(calls,3);mode='ok';await s.clock.advance(1);
 assert.equal(calls,4);assert.equal(s.integration.getSnapshot().freshness,'fresh');assert.equal(s.integration.getSnapshot().error,null);s.integration.dispose();
});
test('authentication expiration wipes identities and credentials, detaches listeners and requires explicit reconnect',async()=>{
 for(const status of [401,403]){
  let calls=0;const s=setup(async()=>++calls===1?response(page([activity()])):response({diagnostic:'private'},status));
  s.connect();await s.integration.refresh();await s.integration.refresh();assert.equal(s.integration.getSnapshot().phase,'AUTH_REQUIRED');
  assert.deepEqual(Object.keys(s.integration.getSnapshot().activitiesByAgentId),[]);assert.equal(s.events.listeners(),0);assert.equal(s.clock.timers.size,0);
  await s.clock.advance(60000);await s.integration.refresh();assert.equal(calls,2);s.integration.dispose();
 }
});
test('credential and Agent scope changes clear immediately and reject late responses from an old generation',async()=>{
 const old=deferred(),requests=[];const s=setup(async(url,options)=>{requests.push({url,options});return requests.length===1?old.promise:response(page([activity(2)]));});
 s.connect();assert.equal(requests.length,1);s.integration.connect({...connection,token:otherToken,agentIds:[id(2)]});
 assert.deepEqual(Object.keys(s.integration.getSnapshot().activitiesByAgentId),[]);await flush();await s.integration.refresh();
 assert.equal(s.integration.getAgent(id(2)).agentId,id(2));assert.equal(requests[0].options.signal.aborted,true);
 assert.equal(requests[1].options.headers.Authorization,`Bearer ${otherToken}`);assert.equal(new URL(requests[1].url).searchParams.get('ids'),id(2));
 old.resolve(response(page([activity(1)])));await flush();assert.equal(s.integration.getAgent(id(1)),undefined);assert.ok(!JSON.stringify(s.integration.getSnapshot()).includes(otherToken));
 s.integration.setScope([id(2)]);assert.equal(s.integration.getAgent(id(2)),undefined);await flush();await s.integration.refresh();assert.equal(s.integration.getAgent(id(2)).agentId,id(2));s.integration.dispose();
});
test('complete paginated sweeps commit atomically; failed partial pages cannot delete or replace existing Agents',async()=>{
 let mode='one',calls=0;const slow=deferred();const s=setup(async url=>{
  calls++;if(mode==='one')return response(page([activity()]));
  if(new URL(url).searchParams.has('after'))return mode==='fail'?response({},503):slow.promise;
  return response(page([activity(1,{agentVersion:2})],id(1)));
 },{pageSize:1});
 s.connect();await s.integration.refresh();mode='pages';const sweep=s.integration.refresh();await flush();assert.equal(s.integration.getAgent(id(1)).agentVersion,1);
 slow.resolve(response(page([activity(2)])));await sweep;assert.equal(s.integration.getAgent(id(1)).agentVersion,2);assert.ok(s.integration.getAgent(id(2)));
 mode='fail';await s.integration.refresh();assert.ok(s.integration.getAgent(id(2)));assert.deepEqual(s.integration.getSnapshot().missingAgentIds,[]);s.integration.dispose();
});
test('Agents disappear only after confirmed complete sweeps; missing entries are unavailable immediately and binding changes do not linger',async()=>{
 let items=[activity(1,{npcId:'resident-slot-001',bindingId:id(10)})];const s=setup(async()=>response(page(items)));
 s.connect();await s.integration.refresh();items=[activity()];await s.integration.refresh();assert.equal(s.integration.getByNpc('resident-slot-001'),undefined);
 items=[];await s.integration.refresh();assert.equal(s.integration.getAgent(id(1)),undefined);assert.deepEqual(s.integration.getSnapshot().missingAgentIds,[id(1)]);
 assert.ok(s.integration.getSnapshot().activitiesByAgentId[id(1)]);await s.integration.refresh();assert.deepEqual(Object.keys(s.integration.getSnapshot().activitiesByAgentId),[]);s.integration.dispose();
});
test('known inaccessible batch scope (404) clears cached data and stops, never broadens scope automatically',async()=>{
 let calls=0;const s=setup(async()=>++calls===1?response(page([activity()])):response({},404));s.connect();await s.integration.refresh();
 await s.integration.refresh();assert.equal(s.integration.getSnapshot().error.code,'NOT_FOUND');assert.deepEqual(Object.keys(s.integration.getSnapshot().activitiesByAgentId),[]);
 await s.clock.advance(60000);assert.equal(calls,2);s.integration.dispose();
});
test('an explicit empty Agent scope clears state and pauses without expanding to all authorized Agents',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return response(page([activity()]));});s.connect();await s.integration.refresh();
 s.integration.setScope([]);assert.equal(s.integration.getSnapshot().phase,'PAUSED');assert.equal(s.integration.getAgent(id(1)),undefined);
 await s.clock.advance(60000);await s.integration.refresh();assert.equal(calls,1);
 s.integration.setScope([id(1)]);await flush();await s.integration.refresh();assert.ok(s.integration.getAgent(id(1)));s.integration.dispose();
});
test('stale age uses monotonic receipt time independently of backend timestamp and transitions to unknown during a slow refresh',async()=>{
 let calls=0;const pending=deferred(),s=setup(async()=>++calls===1?response(page([activity()])):pending.promise,{intervalMs:10000,staleMs:12000,unknownMs:30000,timeoutMs:30000});
 s.connect();await s.integration.refresh();assert.equal(s.integration.getSnapshot().lastSuccessfulSyncAt,stamp);
 await s.clock.advance(10000);assert.equal(s.integration.getSnapshot().refreshing,true);await s.clock.advance(2000);assert.equal(s.integration.getSnapshot().freshness,'stale');
 await s.clock.advance(18000);assert.equal(s.integration.getSnapshot().freshness,'unknown');assert.equal(s.integration.getAgent(id(1)).activityStatus,'IDLE');
 s.integration.dispose();pending.resolve(response(page()));await flush();assert.equal(s.clock.timers.size,0);
});
test('visibility pause aborts requests, suppresses hidden polling and resumes exactly one authoritative refresh',async()=>{
 let calls=0;const pending=deferred(),s=setup(async()=>++calls===1?pending.promise:response(page([activity(2)])));
 s.connect();s.events.hide(true);await flush();assert.equal(s.integration.getSnapshot().phase,'PAUSED');await s.clock.advance(40000);assert.equal(calls,1);
 s.events.hide(false);await flush();assert.equal(calls,2);assert.equal(s.integration.getAgent(id(2)).agentId,id(2));
 pending.resolve(response(page([activity()])));await flush();assert.equal(s.integration.getAgent(id(1)),undefined);
 s.events.networkOnline();s.events.networkOnline();await flush();assert.equal(calls,2);s.integration.dispose();
});
test('one cycle timeout budget spans all pages and late outcomes never become successful snapshots',async()=>{
 let calls=0;const first=deferred(),last=deferred(),s=setup(async()=>++calls===1?first.promise:last.promise,{pageSize:1});s.connect();
 await s.clock.advance(3000);first.resolve(response(page([activity()],id(1))));await flush();assert.equal(calls,2);
 await s.clock.advance(2000);assert.equal(s.integration.getSnapshot().error.code,'TIMEOUT');assert.equal(s.integration.getAgent(id(1)),undefined);
 last.resolve(response(page([activity(2)])));await flush();assert.equal(s.integration.getSnapshot().phase,'ERROR');s.integration.dispose();
});
test('rate limits honor Retry-After; malformed data and page/resource limits stop automatic retries',async()=>{
 let calls=0;const s=setup(async()=>++calls===1?response({},429,{'retry-after':'9'}):response(page()));s.connect();await s.integration.refresh();
 await s.clock.advance(8999);assert.equal(calls,1);await s.clock.advance(1);assert.equal(calls,2);s.integration.dispose();
 for(const [payload,options,code] of [[{bad:'shape'},{},'SCHEMA'],[page([activity()],id(1)),{maxPages:1,pageSize:1},'LIMIT_EXCEEDED']]){
  let n=0;const f=setup(async()=>{n++;return response(payload);},options);f.connect();await f.integration.refresh();assert.equal(f.integration.getSnapshot().error.code,code);
  await f.clock.advance(60000);assert.equal(n,1);f.integration.dispose();
 }
});
test('cross-page duplicate NPC bindings reject a mixed snapshot instead of leaking an ambiguous T05 association',async()=>{
 const s=setup(async url=>new URL(url).searchParams.has('after')?response(page([activity(2,{npcId:'resident-slot-001',bindingId:id(12)})])):
  response(page([activity(1,{npcId:'resident-slot-001',bindingId:id(11)})],id(1))),{pageSize:1});s.connect();await s.integration.refresh();
 assert.equal(s.integration.getSnapshot().error.code,'STALE_SNAPSHOT');assert.equal(s.integration.getAgent(id(1)),undefined);s.integration.dispose();
});
test('store observers are isolated, unchanged objects are shared, and 100 connect/disconnect cycles clean resources',async()=>{
 const store=new RuntimeActivityStore(),a=normalizeActivity(activity());let notifications=0;
 store.subscribe(()=>{throw Error('consumer');});const remove=store.subscribe(()=>notifications++);store.commit([a],stamp,stamp);const prior=store.getAgent(id(1));store.commit([normalizeActivity(activity())],stamp,stamp);
 assert.equal(store.getAgent(id(1)),prior);assert.equal(notifications,3);remove();store.dispose();
 const s=setup(async()=>response(page()));for(let i=0;i<100;i++){s.connect();await s.integration.refresh();s.integration.disconnect();assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);}
 s.integration.dispose();assert.throws(()=>s.integration.connect(connection),{code:'CONFIGURATION'});assert.throws(()=>s.integration.subscribe(()=>{}),{code:'CONFIGURATION'});
});
