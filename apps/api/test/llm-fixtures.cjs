'use strict';
require('reflect-metadata');
const {randomUUID}=require('node:crypto');
const base=require('./provider-fixtures.cjs');
const {validateEnvironment}=require('../dist/config/configuration');
const {providerSettingsDigest}=require('../dist/runtime/providers/provider-configuration');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
const {createRuntimeExecutionRequest}=require('../dist/runtime/contracts/execution-request.contract');
const {ToolExecutionService}=require('../dist/runtime/tools/tool-execution.service');
const {ToolRegistry}=require('../dist/runtime/tools/tool-registry');
const {CalculatorTool}=require('../dist/runtime/tools/calculator.tool');
const {CurrentDatetimeTool}=require('../dist/runtime/tools/current-datetime.tool');
const {LlmAgentStrategy}=require('../dist/runtime/strategies/llm-agent.strategy');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const CALC='tool.calculator.v1',TIME='tool.current_datetime.v1';
const usage={inputTokens:2,outputTokens:3,totalTokens:5};
const text=(answer='Safe final answer')=>({kind:'text',text:answer,usage});
const proposal=(callId='call_1',toolId='calculator',args={operation:'multiply',a:12,b:8})=>({kind:'tool_proposals',calls:[{callId,toolId,arguments:args}],usage});
function configuration({ids,grants=[],rounds=3,providerId='fixture.local',model='fixture:model',budget={},requestTimeoutMs=1000}={}){
 ids??=Object.fromEntries(['ownerId','taskId','executionId','agentId','orchestratorId','correlationId'].map(k=>[k,randomUUID()]));
 const settings={...base.settings(),providerId,model,capabilities:{...base.capabilities(),toolCalls:grants.length>0}};
 const profile={id:settings.id,profileVersion:settings.profileVersion,model,capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)};
 const definition={...base.definition(),providerProfile:profile,systemInstructions:'Use approved tools where appropriate. /no_think',toolCapabilities:grants,
  budget:{...base.definition().budget,maxOutputTokens:4096,maxProviderRounds:rounds,maxToolCalls:grants.length?2:0,toolTimeoutMs:grants.length?1000:0,...budget}};
 const env={...base.environment(),AGENT_REGISTRY_OWNER_ID:ids.ownerId,RUNTIME_BINDINGS:JSON.stringify([{agentId:ids.agentId,orchestratorId:ids.orchestratorId,definition}]),
  LLM_PROFILES:JSON.stringify([settings]),LLM_REQUEST_TIMEOUT_MS:String(requestTimeoutMs),LLM_MAX_OUTPUT_TOKENS:'512',
  RUNTIME_TOOLS_ENABLED:grants.length?'true':'false',RUNTIME_TOOL_ALLOWLIST:grants.length?JSON.stringify(grants):undefined};
 const config=validateEnvironment(env);return {ids,settings,profile,definition,env,config};
}
function fixture(script=async()=>text(),options={}) {
 const f=configuration(options),logs=[],controller=new AbortController(),factory=new ExecutionContextFactory({info:(...a)=>logs.push(a),error:(...a)=>logs.push(a)});
 const request=createRuntimeExecutionRequest({ids:f.ids,input:options.input??{instruction:'Calculate a product',context:'User data only'},definition:f.definition});
 const context=factory.create({request,authorizedCapabilities:options.grants??[],signal:controller.signal,deadlineAt:new Date(Date.now()+30000).toISOString()});
 const authority={verify:async c=>{if(c!==context)throw new RuntimeError('TOOL_DENIED','tool');}},calls=[];
 const provider={id:f.settings.providerId,capabilities:()=>f.settings.capabilities,generate:async(r,c)=>{calls.push({request:r,context:c});return script(r,c,calls.length);}};
 const selection=new ProviderSelectionService({value:f.config},new LlmProviderRegistry([provider]));selection.onModuleInit();
 const calculator=new CalculatorTool(),clock=new CurrentDatetimeTool(()=>Date.parse('2026-10-23T12:00:00.000Z'));
 const registry=new ToolRegistry([calculator,clock]),tools=new ToolExecutionService({value:f.config},registry,authority,factory);
 const strategy=new LlmAgentStrategy(selection,tools,authority);
 return {...f,logs,controller,factory,request,context,authority,calls,provider,selection,calculator,clock,registry,tools,strategy,
  run:()=>strategy.execute(request,context)};
}
module.exports={configuration,fixture,text,proposal,usage,CALC,TIME,match:code=>e=>e instanceof RuntimeError&&e.code===code};
