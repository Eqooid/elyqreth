import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {tmpdir,platform,arch} from 'node:os';
import {join} from 'node:path';
import {CollaborationOwner} from '../dist/js/runtime/collaboration/owner.js';
import {CollaborationApiClient} from '../dist/js/runtime/collaboration/api-client.js';
import {agent,snapshot,events,binding,id,stamp} from '../tests/collaboration-fixtures.js';
import {FakeClock,response,flush} from '../tests/runtime-fixtures.js';
assert.equal(typeof global.gc,'function','Use node --expose-gc');
const scenarios=[];
for(const count of [1,5,20]){
 global.gc();const before=process.memoryUsage().heapUsed,start=performance.now(),clock=new FakeClock(),requests={agent:0,snapshot:0,events:0};
 const client=new CollaborationApiClient({baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',timers:clock,clock,fetchImpl:async url=>{const p=new URL(url).pathname;if(p.includes('/agents/')){requests.agent++;return response(agent(Number(p.split('/').at(-1).slice(-3))));}if(p.endsWith('/snapshot')){requests.snapshot++;return response(snapshot());}requests.events++;return response(events());}});
 const owner=new CollaborationOwner(client,{now:clock.wallNow});let notifications=0;const unsubscribe=owner.subscribe(()=>notifications++);client.authorize('R'.repeat(40));
 for(let cycle=0;cycle<20;cycle++)for(let n=1;n<=count;n++){
  owner.select(binding(n));owner.open(true);await owner.refresh();if(owner.getSnapshot().selectedId!==id(50))await owner.openCollaboration(id(50));
  const stamp2=new Date(Date.parse(stamp)+(cycle*count+n)*1000).toISOString();owner.select(binding(n,{lastSuccessfulSyncAt:stamp2}));owner.select(binding(n,{lastSuccessfulSyncAt:stamp2}));await flush();owner.open(false);
 }
 owner.dispose();unsubscribe();const atDispose=notifications;owner.select(binding());owner.open(true);await flush();assert.equal(notifications,atDispose);assert.equal(client.hasCredential,false);assert.equal(clock.timers.size,0);assert.equal(owner.getSnapshot().agent,null);assert.equal(owner.getSnapshot().snapshot,null);
 const interactions=20*count;assert.ok(requests.events>0&&requests.events<=interactions);assert.ok(requests.snapshot>=interactions&&requests.snapshot<=interactions*2,JSON.stringify({count,requests,interactions}));assert.ok(requests.agent>=interactions&&requests.agent<=interactions*3);
 global.gc();scenarios.push({mappedAgents:count,selections:interactions,duplicateSweepSignals:interactions,requests,notifications,postDisposeNotifications:0,pendingRequestTimers:clock.timers.size,durationMs:Math.round((performance.now()-start)*100)/100,retainedHeapDeltaBytes:process.memoryUsage().heapUsed-before});
}
const result={status:'PASS',platform:platform(),arch:arch(),node:process.version,fixture:'Actual frontend owner/client with deterministic HTTP boundary and forced GC; not browser FPS or production throughput',scenarios,limits:'Observed memory/time only, no capacity/zero-allocation claim. One selected NPC at a time; no per-NPC connection.'};
writeFileSync(join(tmpdir(),'elyqreth-p5-t11-profile.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
