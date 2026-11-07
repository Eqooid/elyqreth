import { operationalMode } from '../../auth/principal';
import { Inject, Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ApiConfig } from '../../config/config.module';
import { isLoopback } from '../../agents/registry-configuration';
import { RuntimeExecutionContext } from '../contracts/execution-context.contract';
import { AuthorizedToolInvoker, ToolExecutionAuthority, ToolExecutionContext, ToolExecutionResult, ToolInvocationRequest } from '../contracts/tool.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { capabilities, integer, record, token } from '../contracts/validation';
import { TOOL_EXECUTION_AUTHORITY } from '../tokens/runtime.tokens';
import { ToolRegistry } from './tool-registry';
import { assertToolActive, withToolDeadline } from './tool-deadline';
import { toolValue } from './tool-validation';
import { ExecutionContextFactory } from '../context/execution-context.factory';
import { performance } from 'node:perf_hooks';

interface Session {
  readonly runtime:RuntimeExecutionContext;readonly context:ToolExecutionContext;
  readonly seen:Set<string>;calls:number;active:boolean;closed:boolean;cancel?:()=>void;
}
@Injectable()
export class ToolExecutionService implements AuthorizedToolInvoker {
  readonly #sessions=new WeakMap<ToolExecutionContext,Session>();
  readonly #contexts=new WeakMap<RuntimeExecutionContext,Session>();
  constructor(private readonly config:ApiConfig,private readonly registry:ToolRegistry,
    @Inject(TOOL_EXECUTION_AUTHORITY) private readonly authority:ToolExecutionAuthority,
    private readonly contexts:ExecutionContextFactory) {}

  private grants(context:RuntimeExecutionContext) {
    const c=this.config.value,policy=c.runtime?.tools;
    if(!policy||!c.registry||!operationalMode(c)||context.ids.ownerId!==c.registry.ownerId)
      throw new RuntimeError('TOOL_DENIED','tool');
    const binding=c.runtime!.bindings.find(b=>b.agentId===context.ids.agentId&&b.orchestratorId===context.ids.orchestratorId);
    if(!binding||!isDeepStrictEqual(binding.definition,context.definition)||context.definition.budget.maxToolCalls<1||context.definition.budget.toolTimeoutMs<1)
      throw new RuntimeError('TOOL_DENIED','tool');
    const granted=capabilities(context.authorizedCapabilities,'tool').filter(cap=>
      policy.allowedCapabilities.includes(cap)&&binding.definition.toolCapabilities.includes(cap));
    if(!granted.length)throw new RuntimeError('TOOL_DENIED','tool');
    return Object.freeze(granted) as ToolExecutionContext['authorizedCapabilities'];
  }
  async openSession(context:RuntimeExecutionContext):Promise<ToolExecutionContext> {
    // Reject non-factory objects before reading context properties. A session
    // still requires the independent committed-claim check before issuance.
    if(!this.contexts.owns(context))throw new RuntimeError('TOOL_DENIED','tool');
    assertToolActive(context);const authorizedCapabilities=this.grants(context);
    try {await withToolDeadline(context,context.definition.budget.toolTimeoutMs,()=>this.authority.verify(context));}
    catch(error){throw error instanceof RuntimeError?error:new RuntimeError('TOOL_FAILED','tool');}
    const existing=this.#contexts.get(context);
    if(existing){if(existing.closed)throw new RuntimeError('TOOL_DENIED','tool');return existing.context;}
    const scoped={ids:context.ids,deadlineAt:context.deadlineAt,signal:context.signal,authorizedCapabilities};
    for(const key of ['signal','authorizedCapabilities'])Object.defineProperty(scoped,key,{enumerable:false});
    Object.freeze(scoped);
    const state:Session={runtime:context,context:scoped,seen:new Set(),calls:0,active:false,closed:false};
    this.#contexts.set(context,state);this.#sessions.set(scoped,state);return scoped;
  }
  closeSession(context:ToolExecutionContext):void {
    const state=this.#sessions.get(context);if(!state)throw new RuntimeError('TOOL_DENIED','tool');
    state.closed=true;state.cancel?.();
  }
  listAuthorizedDefinitions(context:ToolExecutionContext) {
    const state=this.#sessions.get(context);
    if(!state||state.closed)throw new RuntimeError('TOOL_DENIED','tool');
    assertToolActive(context);const grants=this.grants(state.runtime);
    return Object.freeze(this.registry.listDefinitions().filter(d=>grants.includes(d.requiredCapability)&&context.authorizedCapabilities.includes(d.requiredCapability)));
  }
  private prepare(value:ToolInvocationRequest,context:ToolExecutionContext) {
    const state=this.#sessions.get(context);
    if(!state||state.closed)throw new RuntimeError('TOOL_DENIED','tool');
    assertToolActive(context);const currentGrants=this.grants(state.runtime);
    const r=record(value,['callId','toolId','version','input'],'tool');
    if(typeof r.callId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(r.callId))throw new RuntimeError('INVALID_INPUT','tool');
    const callId=r.callId,toolId=token(r.toolId,'tool'),version=integer(r.version,1,1000,'tool');
    const handler=this.registry.resolve(toolId,version),d=handler.definition;
    if(!currentGrants.includes(d.requiredCapability)||!context.authorizedCapabilities.includes(d.requiredCapability))throw new RuntimeError('TOOL_DENIED','tool');
    if(state.seen.has(callId))throw new RuntimeError('TOOL_DENIED','tool');
    if(state.active||state.calls>=state.runtime.definition.budget.maxToolCalls)throw new RuntimeError('CAPACITY_EXCEEDED','tool');
    // Authorize before inspecting arguments; invalid calls never invoke handlers.
    let input:unknown;
    try {input=toolValue(handler.parseInput(toolValue(r.input,d.maxInputBytes)),d.maxInputBytes);}
    catch(error){throw error instanceof RuntimeError&&error.code==='INVALID_INPUT'?error:new RuntimeError('INVALID_INPUT','tool');}
    return {state,callId,toolId,handler,input};
  }
  validateRequests(requests:readonly ToolInvocationRequest[],context:ToolExecutionContext):void {
    if(!Array.isArray(requests)||!requests.length||requests.length>2)throw new RuntimeError('INVALID_INPUT','tool');
    const ids=new Set<string>();
    for(const request of requests){
      const {state,callId}=this.prepare(request,context);
      if(ids.has(callId))throw new RuntimeError('TOOL_DENIED','tool');ids.add(callId);
      if(state.calls+requests.length>state.runtime.definition.budget.maxToolCalls)throw new RuntimeError('CAPACITY_EXCEEDED','tool');
    }
  }
  async invoke(value:ToolInvocationRequest,context:ToolExecutionContext):Promise<ToolExecutionResult<unknown>> {
    const {state,callId,toolId,handler,input}=this.prepare(value,context),d=handler.definition;
    const started=performance.now();
    state.seen.add(callId);state.calls++;state.active=true;
    try {
      return await withToolDeadline(context,Math.min(d.timeoutMs,state.runtime.definition.budget.toolTimeoutMs),async scoped=>{
        await this.authority.verify(state.runtime);assertToolActive(scoped);
        if(state.closed)throw new RuntimeError('TOOL_DENIED','tool');
        state.runtime.logger.info('tool.started',{toolId});
        const raw=await handler.execute(input,scoped);assertToolActive(scoped);
        let output:unknown;
        try {output=toolValue(handler.parseOutput(toolValue(raw,d.maxOutputBytes,true)),d.maxOutputBytes,true);}
        catch(error){throw error instanceof RuntimeError&&error.code==='OUTPUT_LIMIT_EXCEEDED'?error:new RuntimeError('TOOL_FAILED','tool');}
        await this.authority.verify(state.runtime);assertToolActive(scoped);
        if(state.closed)throw new RuntimeError('TOOL_DENIED','tool');
        state.runtime.logger.info('runtime.budget',{toolInvocationCount:state.calls});
        state.runtime.logger.info('tool.completed',{toolId,durationMs:Math.min(300000,Math.round(performance.now()-started))});
        return Object.freeze({callId,toolId,output});
      },cancel=>{state.cancel=cancel;});
    }catch(error){
      state.runtime.logger.info('tool.failed',{toolId,durationMs:Math.min(300000,Math.round(performance.now()-started)),
        errorCode:error instanceof RuntimeError?error.code:'TOOL_FAILED'});
      if(error instanceof RuntimeError){
        if(['CANCELLED','DEADLINE_EXCEEDED','LEASE_LOST'].includes(error.code))state.closed=true;
        throw error;
      }
      throw new RuntimeError('TOOL_FAILED','tool');
    }finally{state.active=false;delete state.cancel;}
  }
}
