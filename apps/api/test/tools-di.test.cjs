const { closedApplication } = require('./helpers/production-configuration.cjs');
'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Module}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const {ConfigModule}=require('../dist/config/config.module');
const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
const {ToolRegistry}=require('../dist/runtime/tools/tool-registry');
const {ToolExecutionService}=require('../dist/runtime/tools/tool-execution.service');
const {CalculatorTool}=require('../dist/runtime/tools/calculator.tool');
const {CurrentDatetimeTool}=require('../dist/runtime/tools/current-datetime.tool');
const tokens=require('../dist/runtime/tokens/runtime.tokens');
const {fixture,invocation,match,CALC}=require('./tool-fixtures.cjs');

test('Nest DI invokes real calculator/time through the permissioned port without providers or eager tool execution',async t=>{
 const f=fixture(),socket=t.mock.method(require('node:net').Socket.prototype,'connect',()=>assert.fail('external connection'));
 let clockCalls=0,app;
 class ToolsTestModule{};
 Module({imports:[ConfigModule.register(f.config)],providers:[{provide:ExecutionContextFactory,useValue:f.factory},
  {provide:tokens.TOOL_CLOCK,useValue:()=>{clockCalls++;return Date.parse('2026-10-23T12:00:00.000Z');}},CalculatorTool,CurrentDatetimeTool,
  {provide:tokens.TOOL_HANDLERS,inject:[CalculatorTool,CurrentDatetimeTool],useFactory:(c,d)=>[c,d]},ToolRegistry,
  {provide:tokens.TOOL_EXECUTION_AUTHORITY,useValue:f.authority},ToolExecutionService,
  {provide:tokens.AUTHORIZED_TOOL_INVOKER,useExisting:ToolExecutionService}]})(ToolsTestModule);
 try{
  app=await NestFactory.createApplicationContext(ToolsTestModule,{logger:false,abortOnError:false});
  assert.equal(clockCalls,0);const service=app.get(tokens.AUTHORIZED_TOOL_INVOKER);assert.equal(service,app.get(ToolExecutionService));
  const session=await service.openSession(f.context);assert.equal((await service.invoke(invocation(),session)).output.result,96);
  assert.equal((await service.invoke(invocation('clock','current_datetime',{}),session)).output.timezone,'UTC');assert.equal(clockCalls,1);
  await assert.rejects(service.invoke(invocation('excess'),session),match('CAPACITY_EXCEEDED'));
  await assert.rejects(service.invoke(invocation(),f.context),match('TOOL_DENIED'));
 }finally{await app?.close();socket.mock.restore();}
});

test('registered tools do not imply grants, and a narrowed platform allowlist blocks an otherwise granted tool before input inspection',async()=>{
 const f=fixture({grants:[CALC]}),session=await f.service.openSession(f.context);
 assert.equal(f.registry.resolve('current_datetime',1).definition.id,'current_datetime');
 await assert.rejects(f.service.invoke(invocation('clock','current_datetime',Object.defineProperty({},'secret',{enumerable:true,get:()=>assert.fail('unauthorized input inspected')})),session),match('TOOL_DENIED'));
 const g=fixture(),config={...g.config,runtime:{...g.config.runtime,tools:{allowedCapabilities:[CALC]}}};
 const narrowed=new ToolExecutionService({value:config},g.registry,g.authority,g.factory),scoped=await narrowed.openSession(g.context);
 await assert.rejects(narrowed.invoke(invocation('clock','current_datetime',{}),scoped),match('TOOL_DENIED'));
 assert.equal((await narrowed.invoke(invocation(),scoped)).output.result,96);
});

test('application has no public tool execution route in development or production, while health and DI stay available',async()=>{
 const {createApplication}=require('../dist/application'),{validateEnvironment}=require('../dist/config/configuration');
 for(const env of [{},{NODE_ENV:'production',CORS_ORIGINS:'https://example.test'}]){
  const app=await closedApplication(env);
  try{
   await app.listen(0,'127.0.0.1');assert.ok(app.get(ToolRegistry));assert.ok(app.get(ToolExecutionService));
   for(const path of ['/api/v1/tools/calculator','/api/v1/tools/execute','/api/v1/runtime/tools']){
    const response=await fetch(`${await app.getUrl()}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(invocation())});
    assert.equal(response.status,404);const body=await response.json();assert.ok(!JSON.stringify(body).includes('multiply'));
   }
   assert.equal((await fetch(`${await app.getUrl()}/health`)).status,200);
  }finally{await app.close();}
 }
});

test('an existing session cannot retain a capability after trusted platform policy narrows',async()=>{
 const f=fixture(),holder={value:f.config},service=new ToolExecutionService(holder,f.registry,f.authority,f.factory);
 const session=await service.openSession(f.context);
 // Production configuration is immutable; this simulates a future trusted
 // policy reload without allowing clients to supply any policy or grant.
 holder.value={...f.config,runtime:{...f.config.runtime,tools:{allowedCapabilities:[CALC]}}};
 await assert.rejects(service.invoke(invocation('clock','current_datetime',{}),session),match('TOOL_DENIED'));
 assert.equal((await service.invoke(invocation(),session)).output.result,96);
});
