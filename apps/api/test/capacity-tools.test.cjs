const {test}=require('node:test'),assert=require('node:assert/strict');
const {statistics,boundedStage}=require('./capacity-tools.cjs');
test('T14 nearest-rank latency statistics do not fabricate empty observations',()=>{
 assert.equal(statistics([]).p95Ms,null);assert.deepEqual(statistics([4,1,3,2]),{samples:4,p50Ms:2,p95Ms:4,maxMs:4});
});
test('T14 capacity generator rejects unbounded work and drains admitted operations on stop',async()=>{
 await assert.rejects(boundedStage({count:65,concurrency:1}));await assert.rejects(boundedStage({count:2,concurrency:9}));
 let active=0,peak=0;const r=await boundedStage({name:'synthetic',count:8,concurrency:2,operation:async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return 200;}});
 assert.equal(r.status,'PASS');assert.equal(r.completed,8);assert.equal(peak,2);assert.equal(active,0);
 const rejected=await boundedStage({name:'rejection',count:8,concurrency:1,operation:async()=>503});assert.equal(rejected.completed,1);assert.equal(rejected.status,'FAIL');
});
test('T14 safety stop prevents new work without targeting an external endpoint',async()=>{
 let calls=0;const result=await boundedStage({name:'rss-stop',count:4,concurrency:1,rssLimit:1,operation:async()=>{calls++;return 200;}});assert.equal(calls,0);assert.equal(result.status,'FAIL');
});
