'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {getEventListeners}=require('node:events');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {ToolRegistry}=require('../dist/runtime/tools/tool-registry');
const {CalculatorTool}=require('../dist/runtime/tools/calculator.tool');
const {CurrentDatetimeTool}=require('../dist/runtime/tools/current-datetime.tool');
const {toolValue}=require('../dist/runtime/tools/tool-validation');
const {validateEnvironment}=require('../dist/config/configuration');
const {createRuntimeExecutionRequest}=require('../dist/runtime/contracts/execution-request.contract');
const {fixture,invocation,match,CALC,TIME}=require('./tool-fixtures.cjs');

test('tool registry explicitly binds compiled handlers, rejects duplicates/unknown versions and lists immutable safe schemas',()=>{
 const calc=new CalculatorTool(),registry=new ToolRegistry([]);assert.deepEqual(registry.listDefinitions(),[]);
 registry.register(calc);const resolved=registry.resolve('calculator',1);assert.equal(resolved.definition.requiredCapability,CALC);
 assert.throws(()=>registry.register(calc),match('CONFIGURATION_ERROR'));assert.throws(()=>registry.resolve('unknown',1),match('TOOL_DENIED'));
 assert.throws(()=>registry.resolve('calculator',2),match('TOOL_DENIED'));
 for(const patch of [{timeoutMs:2001},{maxInputBytes:1025},{requiredCapability:'tool.other.v1'},{inputSchemaId:'https://schema'}])
  assert.throws(()=>new ToolRegistry([{...resolved,definition:{...resolved.definition,...patch}}]),match('CONFIGURATION_ERROR'));
 const definitions=registry.listDefinitions();assert.ok(Object.isFrozen(definitions));assert.ok(Object.isFrozen(definitions[0]));
 assert.equal(definitions[0].execute,undefined);assert.ok(!JSON.stringify(definitions).includes('parseInput'));
 calc.execute=()=>assert.fail('method replaced after registration');assert.notEqual(resolved.execute,calc.execute);
});

test('calculator performs bounded IEEE-754 operations deterministically without expression evaluation',async()=>{
 const f=fixture(),session=await f.service.openSession(f.context);
 for(const [operation,a,b,result] of [['add',12,8,20],['subtract',12,8,4],['multiply',12,8,96],['divide',12,8,1.5],['multiply',1000000,1000000,1e12],['add',-0,0,0]]){
  const input={operation,a,b};const first=await f.calculator.execute(input,session),second=await f.calculator.execute(input,session);
  assert.deepEqual(first,{result});assert.deepEqual(first,second);assert.ok(!Object.is(first.result,-0));
 }
});

test('calculator rejects unknown fields/operations, division by zero, finite-range violations and unsafe shapes',async()=>{
 const f=fixture(),session=await f.service.openSession(f.context);
 const inputs=[null,[],{},'1+2',{operation:'eval',a:1,b:2},{operation:'add',a:'1',b:2},
  ...[NaN,Infinity,-Infinity,1000001].map(a=>({operation:'add',a,b:1})),
  {operation:'divide',a:1,b:0},{operation:'add',a:1,b:2,source:'secret'},
  Object.assign(Object.create({inherited:true}),{operation:'add',a:1,b:2}),
  Object.defineProperty({operation:'add',b:2},'a',{enumerable:true,get:()=>assert.fail('getter called')})];
 for(const input of inputs)assert.throws(()=>f.calculator.parseInput(input),match('INVALID_INPUT'));
 await assert.rejects(f.calculator.execute({operation:'divide',a:1,b:1e-300},session),match('INVALID_INPUT'));
 for(const output of [{result:Infinity},{result:1e12+1},{result:1,stack:'private'},{}])assert.throws(()=>f.calculator.parseOutput(output));
});

test('Current DateTime uses its injected clock, enforces empty input, and returns canonical UTC only',async()=>{
 const f=fixture(),session=await f.service.openSession(f.context);
 assert.deepEqual(await f.time.execute({},session),{iso8601:'2026-10-23T12:00:00.000Z',timezone:'UTC'});
 for(const input of [undefined,null,[],{timezone:'Asia/Bangkok'},{extra:true}])assert.throws(()=>f.time.parseInput(input),match('INVALID_INPUT'));
 for(const output of [{iso8601:'2026-02-30T00:00:00.000Z',timezone:'UTC'},{iso8601:'2026-10-23T12:00:00+00:00',timezone:'UTC'},
  {iso8601:'2026-10-23T12:00:00.000Z',timezone:'local'},{iso8601:'2026-10-23T12:00:00.000Z',timezone:'UTC',secret:'private'}])
  assert.throws(()=>f.time.parseOutput(output));
 await assert.rejects(new CurrentDatetimeTool(()=>NaN).execute({},session),match('TOOL_FAILED'));
});

test('opaque sessions authorize both tools; caller-shaped contexts, copies and fabricated factory contexts cannot bypass claim origin',async()=>{
 const f=fixture();await assert.rejects(f.service.invoke(invocation(),f.context),match('TOOL_DENIED'));
 await assert.rejects(f.service.openSession({...f.context}),match('TOOL_DENIED'));
 const forged=f.factory.create({request:f.request,signal:f.controller.signal,deadlineAt:f.context.deadlineAt,authorizedCapabilities:[CALC,TIME]});
 await assert.rejects(f.service.openSession(forged),match('TOOL_DENIED'));
 const session=await f.service.openSession(f.context);assert.equal(await f.service.openSession(f.context),session);
 assert.deepEqual(await f.service.invoke(invocation(),session),{callId:'call_1',toolId:'calculator',output:{result:96}});
 assert.deepEqual((await f.service.invoke(invocation('call_2','current_datetime',{}),session)).output,{iso8601:'2026-10-23T12:00:00.000Z',timezone:'UTC'});
 assert.ok(Object.isFrozen(session.authorizedCapabilities));assert.ok(!JSON.stringify(session).includes('Private fixture'));
 await assert.rejects(f.service.invoke(invocation('call_3'),{...session}),match('TOOL_DENIED'));
 assert.ok(f.logs.every(([,metrics])=>!JSON.stringify(metrics).includes('multiply')));
});

test('default-deny, disabled platform policy, missing grants and cross-agent/owner substitution invoke no handler',async()=>{
 let called=0;const calc=new CalculatorTool(),handler={definition:calc.definition,parseInput:v=>calc.parseInput(v),parseOutput:v=>calc.parseOutput(v),execute:async()=>{called++;return {result:1};}};
 const f=fixture({grants:[CALC],allowed:[CALC],handlers:[handler]}),session=await f.service.openSession(f.context);
 await assert.rejects(f.service.invoke(invocation('date','current_datetime',{}),session),match('TOOL_DENIED'));
 await assert.rejects(f.service.invoke({...invocation(),authorizedCapabilities:[TIME]},session),match('INVALID_INPUT'));
 const noGrant=f.factory.create({request:f.request,signal:f.controller.signal,deadlineAt:f.context.deadlineAt});f.trusted.add(noGrant);
 await assert.rejects(f.service.openSession(noGrant),match('TOOL_DENIED'));
 for(const field of ['ownerId','agentId','executionId']){
  const request=createRuntimeExecutionRequest({ids:{...f.ids,[field]:require('node:crypto').randomUUID()},input:f.request.input,definition:f.definition});
  const forged=f.factory.create({request,authorizedCapabilities:[CALC],signal:f.controller.signal,deadlineAt:f.context.deadlineAt});
  await assert.rejects(f.service.openSession(forged),match('TOOL_DENIED'));
 }
 const disabled={...f.config,runtime:{bindings:f.config.runtime.bindings}};
 const {ToolExecutionService}=require('../dist/runtime/tools/tool-execution.service');
 await assert.rejects(new ToolExecutionService({value:disabled},f.registry,f.authority,f.factory).openSession(f.context),match('TOOL_DENIED'));
 assert.equal(called,0);
});

test('closed input and JSON limits reject unsupported arguments before handler execution without leaking secrets',async()=>{
 let calls=0;const c=new CalculatorTool(),f=fixture({handlers:[{definition:c.definition,parseInput:v=>c.parseInput(v),parseOutput:v=>v,execute:async()=>{calls++;return {result:1};}}]});
 const session=await f.service.openSession(f.context);
 for(const input of [{operation:'add',a:1,b:2,extra:'private'},{operation:'divide',a:1,b:0},'x'.repeat(1025),
  {operation:'add',a:NaN,b:2},{operation:'add',a:1,b:2,password:'private'}])
  await assert.rejects(f.service.invoke(invocation('invalid','calculator',input),session),e=>match('INVALID_INPUT')(e)&&!JSON.stringify(e).includes('private'));
 for(const patch of [{callId:'x'.repeat(129)},{callId:'../call'},{toolId:'../../shell'},{version:0},{input:undefined}])
  await assert.rejects(f.service.invoke({...invocation(),...patch},session),match('INVALID_INPUT'));
 assert.equal(calls,0);
});

test('tool output copying rejects nonserializable, secret, cyclic, accessor and oversized data before schema exposure',()=>{
 const cyclic={};cyclic.self=cyclic;
 for(const value of [cyclic,new Date(),{result:NaN},{result:undefined},{result:1n},{stack:'private'},
  {password:'private'},{text:'password=private'},Object.defineProperty({},'result',{enumerable:true,get:()=>assert.fail('getter')}),
  {array:Object.assign([1],{extra:true})}])assert.throws(()=>toolValue(value,1024,true),match('TOOL_FAILED'));
 assert.throws(()=>toolValue({text:'x'.repeat(1025)},1024,true),match('OUTPUT_LIMIT_EXCEEDED'));
 const safe=toolValue({nested:{items:[1,'safe']}},1024,true);assert.ok(Object.isFrozen(safe.nested.items));
});

test('per-execution call budget, sequential admission and duplicate IDs cannot reset by reopening or closing a session',async()=>{
 const f=fixture(),session=await f.service.openSession(f.context);
 await f.service.invoke(invocation('call_A'),session);
 await assert.rejects(f.service.invoke(invocation('call_A'),session),match('TOOL_DENIED'));
 await assert.rejects(f.service.invoke(invocation('call_A','calculator',{operation:'add',a:1,b:2}),session),match('TOOL_DENIED'));
 const reopened=await f.service.openSession(f.context);assert.equal(reopened,session);
 await f.service.invoke(invocation('call_B'),session);
 await assert.rejects(f.service.invoke(invocation('call_C'),session),match('CAPACITY_EXCEEDED'));
 f.service.closeSession(session);await assert.rejects(f.service.openSession(f.context),match('TOOL_DENIED'));
 const other=fixture(),second=await other.service.openSession(other.context);assert.equal((await other.service.invoke(invocation(),second)).output.result,96);
 await assert.rejects(f.service.invoke(invocation(),second),match('TOOL_DENIED'));
});

test('tool timeout/cancellation abort wait, ignore late results, quarantine the session and remove abort listeners',async()=>{
 for(const mode of ['timeout','cancel','close']){
  const c=new CalculatorTool();let release,entered,observed;
  const ready=new Promise(r=>entered=r),handler={definition:c.definition,parseInput:v=>c.parseInput(v),parseOutput:v=>c.parseOutput(v),
   execute:async(_v,context)=>{observed=context;entered();return new Promise(r=>release=r);}};
  const f=fixture({timeout:mode==='timeout'?15:1000,handlers:[handler]}),session=await f.service.openSession(f.context);
  const running=f.service.invoke(invocation(),session);await ready;
  await assert.rejects(f.service.invoke(invocation('parallel'),session),match('CAPACITY_EXCEEDED'));
  if(mode==='cancel')f.controller.abort('private reason');if(mode==='close')f.service.closeSession(session);
  await assert.rejects(running,match(mode==='timeout'?'DEADLINE_EXCEEDED':'CANCELLED'));assert.equal(observed.signal.aborted,true);
  release({result:96});await new Promise(r=>setImmediate(r));
  await assert.rejects(f.service.invoke(invocation('late'),session),match('TOOL_DENIED'));
  assert.equal(getEventListeners(f.context.signal,'abort').length,0);
 }
});

test('cancellation and expired deadlines reject before authorization; timeouts bound claim checks too',async()=>{
 const f=fixture(),before=f.checks();f.controller.abort('private');
 await assert.rejects(f.service.openSession(f.context),match('CANCELLED'));assert.equal(f.checks(),before);
 const g=fixture({timeout:5});g.authority.verify=async()=>new Promise(()=>{});
 await assert.rejects(g.service.openSession(g.context),match('DEADLINE_EXCEEDED'));
 const h=fixture(),session=await h.service.openSession(h.context);h.controller.abort(new RuntimeError('DEADLINE_EXCEEDED','context'));
 await assert.rejects(h.service.invoke(invocation(),session),match('DEADLINE_EXCEEDED'));
});

test('handler/schema failures are normalized, output schemas enforced and lost claim prevents a late success',async()=>{
 const c=new CalculatorTool();
 for(const raw of [{result:1,stack:'private'},null,{result:'wrong'},{result:1e13}]){
  const f=fixture({handlers:[{definition:c.definition,parseInput:v=>c.parseInput(v),parseOutput:v=>c.parseOutput(v),execute:async()=>raw}]}),session=await f.service.openSession(f.context);
  await assert.rejects(f.service.invoke(invocation(),session),match('TOOL_FAILED'));
 }
 for(const member of ['execute','parseInput','parseOutput']){
  const handler={definition:c.definition,parseInput:v=>c.parseInput(v),parseOutput:v=>c.parseOutput(v),execute:async()=>({result:1})};
  handler[member]=()=>{throw new Error('password=private')};
  const f=fixture({handlers:[handler]}),session=await f.service.openSession(f.context);
  await assert.rejects(f.service.invoke(invocation(),session),e=>match(member==='parseInput'?'INVALID_INPUT':'TOOL_FAILED')(e)&&!JSON.stringify(e).includes('private'));
 }
 const f=fixture(),session=await f.service.openSession(f.context);let calls=0;
 f.authority.verify=async()=>{if(++calls===2)throw new RuntimeError('LEASE_LOST','tool');};
 await assert.rejects(f.service.invoke(invocation(),session),match('LEASE_LOST'));
 await assert.rejects(f.service.invoke(invocation('late'),session),match('TOOL_DENIED'));
});

test('tool configuration is opt-in, compiled allowlisted, bounded and independent of provider credentials',()=>{
 const f=fixture();assert.deepEqual(f.config.runtime.tools.allowedCapabilities,[CALC,TIME]);assert.equal(f.config.llm,undefined);
 for(const patch of [{RUNTIME_TOOLS_ENABLED:'invalid'},{RUNTIME_TOOL_ALLOWLIST:'[]'},{RUNTIME_TOOL_ALLOWLIST:JSON.stringify([CALC,CALC])},
  {RUNTIME_TOOL_ALLOWLIST:JSON.stringify(['tool.shell.v1'])},{RUNTIME_TOOLS_ENABLED:'false'},
  {NODE_ENV:'production'},{RUNTIME_ENABLED:'false',RUNTIME_BINDINGS:undefined}])assert.throws(()=>validateEnvironment({...f.env,...patch}));
 const disabled=validateEnvironment({});assert.equal(disabled.runtime,undefined);
});

test('an expired execution is rejected before claim verification and oversized handler output never escapes',async t=>{
 const f=fixture(),before=f.checks(),now=t.mock.method(Date,'now',()=>Date.parse(f.context.deadlineAt)+1);
 try{await assert.rejects(f.service.openSession(f.context),match('DEADLINE_EXCEEDED'));assert.equal(f.checks(),before);}
 finally{now.mock.restore();}
 const c=new CalculatorTool(),g=fixture({handlers:[{definition:c.definition,parseInput:v=>c.parseInput(v),parseOutput:v=>v,
  execute:async()=>({text:'x'.repeat(1025)})}]}),session=await g.service.openSession(g.context);
 await assert.rejects(g.service.invoke(invocation(),session),match('OUTPUT_LIMIT_EXCEEDED'));
});
