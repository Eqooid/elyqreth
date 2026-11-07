'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {getEventListeners}=require('node:events');
const {fixture,text,proposal,CALC,match}=require('./llm-fixtures.cjs');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {assertRuntimeActive}=require('../dist/runtime/contracts/execution-context.contract');
const {withProviderDeadline}=require('../dist/runtime/providers/provider-deadline');
const {withToolDeadline}=require('../dist/runtime/tools/tool-deadline');

const providerContext=f=>({executionId:f.ids.executionId,correlationId:f.ids.correlationId,profile:f.profile,
 deadlineAt:f.context.deadlineAt,signal:f.controller.signal});

test('T10 execution monotonic budget expires despite backward wall clock changes and cannot reset',t=>{
 let elapsed=1000;const wall=Date.now();t.mock.method(performance,'now',()=>elapsed);
 const f=fixture();assertRuntimeActive(f.context);
 t.mock.method(Date,'now',()=>wall-3600000);elapsed+=30001;
 assert.throws(()=>assertRuntimeActive(f.context),match('DEADLINE_EXCEEDED'));
 assert.throws(()=>assertRuntimeActive(f.context),match('DEADLINE_EXCEEDED'));
});

test('T10 provider and tool guards reject late success after elapsed expiry even if wall time rolls back',async t=>{
 let elapsed=1000;const wall=Date.now();t.mock.method(performance,'now',()=>elapsed);
 const f=fixture();
 await assert.rejects(withProviderDeadline(providerContext(f),500,async()=>{
  t.mock.method(Date,'now',()=>wall-3600000);elapsed+=501;return text();
 }),match('DEADLINE_EXCEEDED'));
 assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
 t.mock.restoreAll();elapsed=1000;t.mock.method(performance,'now',()=>elapsed);
 const g=fixture();
 await assert.rejects(withToolDeadline(g.context,500,async()=>{
  t.mock.method(Date,'now',()=>Date.parse(g.context.deadlineAt)-3600000);elapsed+=501;return {};
 }),match('DEADLINE_EXCEEDED'));
 assert.equal(getEventListeners(g.controller.signal,'abort').length,0);
});

test('T10 lease loss, explicit abort and deadline retain distinct classifications through provider guard',async()=>{
 for(const code of ['LEASE_LOST','CANCELLED','DEADLINE_EXCEEDED']){
  const f=fixture();f.controller.abort(new RuntimeError(code));let invoked=false;
  await assert.rejects(withProviderDeadline(providerContext(f),500,async()=>{invoked=true;}),match(code));
  assert.equal(invoked,false);assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
 }
});

test('T10 remaining execution time bounds each provider request without extending the original deadline',async t=>{
 const f=fixture(),start=Date.now(),end=Date.parse(f.context.deadlineAt),observed=[];
 t.mock.method(Date,'now',()=>end-200);
 await withProviderDeadline(providerContext(f),1000,async c=>{observed.push(Date.parse(c.deadlineAt));return text();});
 t.mock.method(Date,'now',()=>end-20);
 await withProviderDeadline(providerContext(f),1000,async c=>{observed.push(Date.parse(c.deadlineAt));return text();});
 assert.deepEqual(observed,[end,end]);assert.ok(end>start);
 t.mock.method(Date,'now',()=>end);
 await assert.rejects(withProviderDeadline(providerContext(f),1000,async()=>assert.fail()),match('DEADLINE_EXCEEDED'));
});

test('T10 cancellation after a tool result prevents both the next tool and next model round',async()=>{
 const f=fixture(async()=>proposal(),{grants:[CALC]});
 const invoke=f.tools.invoke.bind(f.tools);f.tools.invoke=async(...args)=>{const result=await invoke(...args);f.controller.abort();return result;};
 await assert.rejects(f.run(),match('CANCELLED'));assert.equal(f.calls.length,1);
 assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
});

test('T10 total execution elapsed limit stops a multi-step loop despite short fresh provider timeouts',async t=>{
 let elapsed=1000;t.mock.method(performance,'now',()=>elapsed);
 const f=fixture(async(_r,_c,n)=>{if(n===1)return proposal();elapsed+=30001;return text();},{grants:[CALC]});
 await assert.rejects(f.run(),match('DEADLINE_EXCEEDED'));assert.equal(f.calls.length,2);
 assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
});

test('T10 provider/tool parent abort listeners are removed on success and unexpected failure',async()=>{
 for(const fail of [false,true])for(const provider of [false,true]){
  const f=fixture();const op=async()=>{if(fail)throw new Error('secret stack');return {};};
  const run=provider?()=>withProviderDeadline(providerContext(f),500,op):()=>withToolDeadline(f.context,500,op);
  if(fail)await assert.rejects(run());else await run();
  assert.equal(getEventListeners(f.controller.signal,'abort').length,0);assert.equal(f.controller.signal.aborted,false);
 }
});

test('T10 elapsed tool authorization time cannot grant a fresh handler timeout after wall-clock rollback',async t=>{
 let elapsed=1000;const wall=Date.now();t.mock.method(performance,'now',()=>elapsed);
 const f=fixture(undefined,{grants:[CALC]});let invoked=false;
 const {ToolRegistry}=require('../dist/runtime/tools/tool-registry');
 const {ToolExecutionService}=require('../dist/runtime/tools/tool-execution.service');
 const registry=new ToolRegistry([{definition:f.calculator.definition,parseInput:v=>f.calculator.parseInput(v),
  parseOutput:v=>f.calculator.parseOutput(v),execute:async()=>{invoked=true;return {result:96};}}]);
 const tools=new ToolExecutionService({value:f.config},registry,f.authority,f.factory);
 const session=await tools.openSession(f.context);
 f.authority.verify=async()=>{elapsed+=1001;t.mock.method(Date,'now',()=>wall-3600000);};
 await assert.rejects(tools.invoke({callId:'t10_1',toolId:'calculator',version:1,input:{operation:'multiply',a:12,b:8}},session),match('DEADLINE_EXCEEDED'));
 assert.equal(invoked,false);tools.closeSession(session);
});
