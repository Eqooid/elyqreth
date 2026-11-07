import { ProviderCapabilities, ResolvedProviderProfile, TokenUsage, LlmGenerateRequest, LlmGenerateResult, LlmRequestContext } from './provider.contract';
import { RuntimeError } from './runtime-error.contract';
import { toolValue } from '../tools/tool-validation';
import { validateToolDescription } from './tool-description';
import { isProviderContinuation } from '../providers/provider-continuation';
import { freeze, identifier, integer, invalid, modelIdentifier, record, safeText, token } from './validation';

export function providerCapabilities(value: unknown): ProviderCapabilities {
  const c = record(value,['text','transportAbort','remoteCancellation','structuredOutput','toolCalls','streaming','tokenUsage'],'provider');
  if (c.text !== true || c.transportAbort !== true || c.streaming !== false || typeof c.toolCalls !== 'boolean' ||
    !['unknown','best_effort'].includes(c.remoteCancellation as string) || !['none','json','schema'].includes(c.structuredOutput as string) ||
    c.tokenUsage !== undefined && !['none','optional'].includes(c.tokenUsage as string)) return invalid('provider');
  return freeze({text:true,transportAbort:true,remoteCancellation:c.remoteCancellation as ProviderCapabilities['remoteCancellation'],
    structuredOutput:c.structuredOutput as ProviderCapabilities['structuredOutput'],toolCalls:c.toolCalls,streaming:false,
    ...(c.tokenUsage === undefined ? {} : {tokenUsage:c.tokenUsage as 'none'|'optional'})});
}
export function providerProfile(value: unknown): ResolvedProviderProfile {
  const p = record(value,['id','profileVersion','model','capabilities','bindingDigest'],'provider');
  if(p.bindingDigest!==undefined && (typeof p.bindingDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.bindingDigest)))return invalid('provider');
  return freeze({id:token(p.id,'provider'),profileVersion:integer(p.profileVersion,1,2147483647,'provider'),
    model:modelIdentifier(p.model,'provider'),capabilities:providerCapabilities(p.capabilities),
    ...(p.bindingDigest===undefined?{}:{bindingDigest:p.bindingDigest as string})});
}
export function tokenUsage(value: unknown): TokenUsage {
  const u = record(value,['inputTokens','outputTokens','totalTokens'],'provider');
  const count = (v:unknown) => v === null ? null : integer(v,0,1000000000,'provider');
  const result = {inputTokens:count(u.inputTokens),outputTokens:count(u.outputTokens),totalTokens:count(u.totalTokens)};
  if (result.inputTokens !== null && result.outputTokens !== null && result.totalTokens !== null &&
    result.inputTokens + result.outputTokens !== result.totalTokens) return invalid('provider');
  return freeze(result);
}
function plainArray(value:unknown, max:number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1) return invalid('provider');
  for(let i=0;i<value.length;i++) {
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d || !Object.hasOwn(d,'value') || !d.enumerable) return invalid('provider');
  }
  return value;
}
export function llmToolCalls(value:unknown):readonly import('./provider.contract').LlmToolCall[] {
  const values=plainArray(value,2);if(!values.length)return invalid('provider');
  const seen=new Set<string>();
  return freeze(values.map(value=>{
    const c=record(value,['callId','toolId','arguments'],'provider');
    if(typeof c.callId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(c.callId)||seen.has(c.callId))return invalid('provider');
    seen.add(c.callId);
    const args=toolValue(c.arguments,1024);if(!args||typeof args!=='object'||Array.isArray(args))return invalid('provider');
    return freeze({callId:c.callId,toolId:token(c.toolId,'provider'),arguments:args});
  }));
}
export function llmGenerateRequest(value: unknown, maxOutputTokens = 4096, allowToolCalls=false): LlmGenerateRequest {
  const r=record(value,['messages','maxOutputTokens','output','tools','continuation'],'provider');
  const messages=plainArray(r.messages,8);if(!messages.length)return invalid('provider');
  const tools=r.tools===undefined?[]:plainArray(r.tools,2);
  if((tools.length||r.continuation!==undefined)&&!allowToolCalls)throw new RuntimeError('UNSUPPORTED_CAPABILITY','provider');
  const parsedTools=tools.map(validateToolDescription);
  if(new Set(parsedTools.map(t=>t.toolId)).size!==parsedTools.length)return invalid('provider');
  if(r.continuation!==undefined&&!isProviderContinuation(r.continuation))return invalid('provider');
  const pending=new Map<string,string>(),seen=new Set<string>();
  const parsed=messages.map(value=>{
    const m=record(value,['role','content','calls','callId','toolId'],'provider');
    if((m.role==='tool'||m.calls!==undefined)&&!allowToolCalls)throw new RuntimeError('UNSUPPORTED_CAPABILITY','provider');
    if(!['system','user','assistant','tool'].includes(m.role as string))return invalid('provider');
    if(m.role==='tool'){
      if(m.calls!==undefined||typeof m.callId!=='string'||pending.get(m.callId)!==m.toolId)return invalid('provider');
      pending.delete(m.callId);const content=safeText(m.content,'provider');if(Buffer.byteLength(content)>1024)return invalid('provider');
      return freeze({role:'tool' as const,callId:m.callId,toolId:m.toolId as string,content});
    }
    if(m.callId!==undefined||m.toolId!==undefined||pending.size)return invalid('provider');
    if(m.calls!==undefined){
      if(m.role!=='assistant'||m.content!=='')return invalid('provider');
      const calls=llmToolCalls(m.calls);
      for(const c of calls){if(seen.has(c.callId)||!parsedTools.some(t=>t.toolId===c.toolId))return invalid('provider');seen.add(c.callId);pending.set(c.callId,c.toolId);}
      return freeze({role:'assistant' as const,content:'',calls});
    }
    const content=safeText(m.content,'provider');if(content.length>16000)return invalid('provider');
    return freeze({role:m.role as 'system'|'user'|'assistant',content});
  });
  if(pending.size||parsed.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8'),0)>16384)return invalid('provider');
  const output=record(r.output,['kind'],'provider');if(output.kind!=='text')throw new RuntimeError('UNSUPPORTED_CAPABILITY','provider');
  const result=freeze({messages:freeze(parsed),maxOutputTokens:integer(r.maxOutputTokens,1,integer(maxOutputTokens,1,4096,'provider'),'provider'),output:freeze({kind:'text' as const}),
    ...(parsedTools.length?{tools:freeze(parsedTools)}:{}),...(r.continuation===undefined?{}:{continuation:r.continuation as import('./provider.contract').ProviderContinuation})});
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>32768)return invalid('provider');return result;
}
export function llmGenerateResult(value:unknown, capabilities:ProviderCapabilities): LlmGenerateResult {
  try {
    const r=record(value,['kind','text','usage','calls','continuation'],'provider');
    if(r.usage!==undefined&&capabilities.tokenUsage==='none')throw new RuntimeError('UNSUPPORTED_CAPABILITY','provider');
    const usage=r.usage===undefined?undefined:tokenUsage(r.usage);
    if(r.kind==='tool_proposals'){
      if(!capabilities.toolCalls)throw new RuntimeError('UNSUPPORTED_CAPABILITY','provider');
      if(r.text!==undefined||r.continuation!==undefined&&!isProviderContinuation(r.continuation))return invalid('provider');
      return freeze({kind:'tool_proposals',calls:llmToolCalls(r.calls),...(usage?{usage}:{}),
        ...(r.continuation===undefined?{}:{continuation:r.continuation as import('./provider.contract').ProviderContinuation})});
    }
    if(r.kind!=='text'||Object.hasOwn(r,'calls')||Object.hasOwn(r,'continuation'))return invalid('provider');
    const text=safeText(r.text,'provider');if(Buffer.byteLength(text)>32768)throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider');
    const result=freeze({kind:'text' as const,text,...(usage?{usage}:{})});
    if(Buffer.byteLength(JSON.stringify(result))>32768)throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider');return result;
  }catch(error){
    if(error instanceof RuntimeError&&['UNSUPPORTED_CAPABILITY','OUTPUT_LIMIT_EXCEEDED'].includes(error.code))throw error;
    throw new RuntimeError('INVALID_PROVIDER_OUTPUT','provider');
  }
}
const validatedContexts=new WeakSet<object>();
export function llmRequestContext(value:unknown): LlmRequestContext {
  if(value && typeof value==='object' && validatedContexts.has(value))return value as LlmRequestContext;
  const c=record(value,['executionId','correlationId','profile','deadlineAt','signal'],'provider');
  if (!(c.signal instanceof AbortSignal)) return invalid('provider');
  try { Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!.call(c.signal); } catch { return invalid('provider'); }
  if (typeof c.deadlineAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.deadlineAt) ||
    !Number.isFinite(Date.parse(c.deadlineAt)) || new Date(c.deadlineAt).toISOString() !== c.deadlineAt) return invalid('provider');
  const context={executionId:identifier(c.executionId,'provider'),correlationId:identifier(c.correlationId,'provider'),
    profile:providerProfile(c.profile),deadlineAt:c.deadlineAt,signal:c.signal};
  Object.defineProperty(context,'signal',{enumerable:false});
  const result=freeze(context);validatedContexts.add(result);return result;
}
