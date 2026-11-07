import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { LlmRequestContext, ProviderContinuation, LlmGenerateRequest, LlmToolCall, LlmMessage } from '../contracts/provider.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { toolValue } from '../tools/tool-validation';

// Immutable state travels explicitly with one loop. No singleton conversation
// keyed by Agent/Execution ID; WeakMap storage disappears with the opaque handle.
const states=new WeakMap<object,{binding:string;data:unknown}>();
const binding=(providerId:string,c:LlmRequestContext)=>JSON.stringify([providerId,c.executionId,c.correlationId,c.profile]);
export const transcriptDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function isProviderContinuation(value:unknown):value is ProviderContinuation {
  return !!value&&typeof value==='object'&&states.has(value);
}
export function createProviderContinuation(providerId:string,context:LlmRequestContext,data:unknown):ProviderContinuation {
  const handle={};Object.defineProperty(handle,'toJSON',{value:()=> '[opaque provider continuation]'});
  Object.defineProperty(handle,inspect.custom,{value:()=> '[opaque provider continuation]'});
  states.set(handle,{binding:binding(providerId,context),data});return Object.freeze(handle);
}
export function readProviderContinuation<T>(value:ProviderContinuation,providerId:string,context:LlmRequestContext):T {
  const state=states.get(value);
  if(!state||state.binding!==binding(providerId,context))throw new RuntimeError('CONFIGURATION_ERROR','provider');
  return state.data as T;
}
interface History {readonly native:readonly unknown[];readonly digest:string;readonly count:number;readonly calls:readonly LlmToolCall[];readonly tools:string}
export function historyContinuation(providerId:string,request:LlmGenerateRequest,context:LlmRequestContext,
  native:readonly unknown[],calls:readonly LlmToolCall[]):ProviderContinuation {
  let copy:readonly unknown[];
  try{copy=toolValue(native,16384,false,{maxDepth:8,allowEmpty:true}) as readonly unknown[];}
  catch(error){throw new RuntimeError(error instanceof RuntimeError&&error.code==='OUTPUT_LIMIT_EXCEEDED'?'OUTPUT_LIMIT_EXCEEDED':'INVALID_PROVIDER_OUTPUT','provider');}
  return createProviderContinuation(providerId,context,Object.freeze({native:copy,digest:transcriptDigest(request.messages),
    count:request.messages.length,calls,tools:transcriptDigest(request.tools??[])} satisfies History));
}
export function resumeHistory(providerId:string,request:LlmGenerateRequest,context?:LlmRequestContext):{
  native:readonly unknown[];replies:readonly Extract<LlmMessage,{role:'tool'}>[];
} {
  if(!request.continuation||!context)throw new RuntimeError('CONFIGURATION_ERROR','provider');
  const h=readProviderContinuation<History>(request.continuation,providerId,context),tail=request.messages.slice(h.count);
  if(tail.length!==h.calls.length+1||transcriptDigest(request.messages.slice(0,h.count))!==h.digest||transcriptDigest(request.tools??[])!==h.tools||
    transcriptDigest(tail[0])!==transcriptDigest({role:'assistant',content:'',calls:h.calls}))
    throw new RuntimeError('CONFIGURATION_ERROR','provider');
  const replies=tail.slice(1) as Extract<LlmMessage,{role:'tool'}>[];
  if(replies.some((m,i)=>m.role!=='tool'||m.callId!==h.calls[i]!.callId||m.toolId!==h.calls[i]!.toolId))
    throw new RuntimeError('CONFIGURATION_ERROR','provider');
  return {native:h.native,replies};
}
