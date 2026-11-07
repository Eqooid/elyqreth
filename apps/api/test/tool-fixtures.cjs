'use strict';
require('reflect-metadata');
const {randomUUID}=require('node:crypto');
const base=require('./provider-fixtures.cjs');
const {validateEnvironment}=require('../dist/config/configuration');
const {createRuntimeExecutionRequest}=require('../dist/runtime/contracts/execution-request.contract');
const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
const {CalculatorTool}=require('../dist/runtime/tools/calculator.tool');
const {CurrentDatetimeTool}=require('../dist/runtime/tools/current-datetime.tool');
const {ToolRegistry}=require('../dist/runtime/tools/tool-registry');
const {ToolExecutionService}=require('../dist/runtime/tools/tool-execution.service');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const CALC='tool.calculator.v1',TIME='tool.current_datetime.v1';
function fixture({grants=[CALC,TIME],allowed=[CALC,TIME],handlers,timeout=1000,maxCalls=2}={}) {
 const ids=Object.fromEntries(['ownerId','taskId','executionId','agentId','orchestratorId','correlationId'].map(k=>[k,randomUUID()]));
 const definition={...base.definition(),toolCapabilities:grants,
  providerProfile:{...base.profile(),capabilities:{...base.capabilities(),toolCalls:true}},
  budget:{...base.definition().budget,maxToolCalls:maxCalls,toolTimeoutMs:timeout,maxProviderRounds:3}};
 const env={...base.environment(),RUNTIME_LLM_ENABLED:'false',LLM_PROFILES:undefined,
  AGENT_REGISTRY_OWNER_ID:ids.ownerId,RUNTIME_TOOLS_ENABLED:'true',RUNTIME_TOOL_ALLOWLIST:JSON.stringify(allowed),
  RUNTIME_BINDINGS:JSON.stringify([{agentId:ids.agentId,orchestratorId:ids.orchestratorId,definition}])};
 const config=validateEnvironment(env),logs=[],logger={info:(...args)=>logs.push(args),error:(...args)=>logs.push(args)};
 const factory=new ExecutionContextFactory(logger),request=createRuntimeExecutionRequest({ids,input:{instruction:'Private fixture content'},definition});
 const controller=new AbortController(),context=factory.create({request,authorizedCapabilities:grants,signal:controller.signal,deadlineAt:new Date(Date.now()+30000).toISOString()});
 const trusted=new WeakSet([context]);let checks=0;
 // Test-only claim authority, never registered in the real RuntimeModule.
 const authority={verify:async c=>{checks++;if(!trusted.has(c))throw new RuntimeError('TOOL_DENIED','tool');}};
 const calculator=new CalculatorTool(),time=new CurrentDatetimeTool(()=>Date.parse('2026-10-23T12:00:00.000Z'));
 const registry=new ToolRegistry(handlers??[calculator,time]),service=new ToolExecutionService({value:config},registry,authority,factory);
 return {ids,definition,env,config,logs,logger,factory,request,controller,context,trusted,authority,calculator,time,registry,service,checks:()=>checks};
}
const invocation=(callId='call_1',toolId='calculator',input={operation:'multiply',a:12,b:8})=>({callId,toolId,version:1,input});
const match=code=>e=>e instanceof RuntimeError&&e.code===code;
module.exports={fixture,invocation,match,CALC,TIME};
