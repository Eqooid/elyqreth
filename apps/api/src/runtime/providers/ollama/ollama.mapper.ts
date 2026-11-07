import { LlmGenerateRequest, LlmGenerateResult, ResolvedProviderProfile, ProviderCapabilities, LlmRequestContext } from '../../contracts/provider.contract';
import { llmGenerateRequest, llmGenerateResult, providerProfile, tokenUsage, llmToolCalls } from '../../contracts/provider-validation';
import { integer, record } from '../../contracts/validation';
import { providerError } from '../provider-errors';
import { randomUUID } from 'node:crypto';
import { resumeHistory } from '../provider-continuation';
import { RuntimeError } from '../../contracts/runtime-error.contract';

export const OLLAMA_CAPABILITIES:ProviderCapabilities=Object.freeze({text:true,transportAbort:true,remoteCancellation:'unknown',
  structuredOutput:'none',toolCalls:true,streaming:false,tokenUsage:'optional'});
export const OLLAMA_CONTEXT_TOKENS=8192;
export function ollamaRequest(value:LlmGenerateRequest,profile:ResolvedProviderProfile,maxOutputTokens=4096,context?:LlmRequestContext) {
  const request=llmGenerateRequest(value,maxOutputTokens,profile.capabilities.toolCalls),selected=providerProfile(profile);
  // Conservative byte admission + template reserve, not invented token usage.
  // Models/templates still require operator verification of their context needs.
  const bytes=request.messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8'),0);
  if(bytes+request.maxOutputTokens+1024>OLLAMA_CONTEXT_TOKENS)throw new RuntimeError('INVALID_INPUT','provider');
  if(request.continuation&&!context)throw providerError('configuration');
  const mapMessage=(m:typeof request.messages[number]):unknown=>m.role==='tool'?{role:'tool',tool_name:m.toolId,content:m.content}:
    m.role==='assistant'&&m.calls?{role:'assistant',content:'',tool_calls:m.calls.map((c,index)=>({id:c.callId,type:'function',function:{index,name:c.toolId,arguments:c.arguments}}))}:m;
  const resumed=request.continuation?resumeHistory('ollama',request,context):undefined;
  const messages=resumed?[...resumed.native,...resumed.replies.map(mapMessage)]:request.messages.map(mapMessage);
  return Object.freeze({model:selected.model,messages,stream:false,keep_alive:0,
    ...(request.tools?.length?{tools:request.tools.map(t=>({type:'function',function:{name:t.toolId,description:t.description,parameters:t.inputSchema}}))}:{}),
    options:Object.freeze({num_predict:request.maxOutputTokens,num_ctx:OLLAMA_CONTEXT_TOKENS})});
}
export function ollamaResponse(value:unknown,profile:ResolvedProviderProfile,maxOutputTokens:number):{
  result:LlmGenerateResult;serverDurationMs?:number;
} {
  try {
    const response=record(value,['model','created_at','message','done','done_reason','total_duration','load_duration',
      'prompt_eval_count','prompt_eval_cached_count','prompt_eval_duration','eval_count','eval_duration','logprobs','error'],'provider');
    if(response.error!==undefined || response.model!==profile.model || response.done!==true)throw providerError('invalid_response');
    if(response.done_reason==='length')throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider');
    if(response.done_reason!==undefined && response.done_reason!=='stop')throw providerError('invalid_response');
    const message=record(response.message,['role','content','thinking','tool_calls','images'],'provider');
    if(message.role!=='assistant' || message.thinking!==undefined&&typeof message.thinking!=='string')throw providerError('invalid_response');
    for(const extra of [message.images,response.logprobs]){
      if(extra!==undefined&&(!Array.isArray(extra)||extra.length))throw providerError('unsupported');
    }
    let calls;
    if(message.tool_calls!==undefined){
      if(!Array.isArray(message.tool_calls)||message.tool_calls.length>2)throw providerError('invalid_response');
      if(message.tool_calls.length){
        if(!profile.capabilities.toolCalls)throw providerError('unsupported');
        calls=llmToolCalls(message.tool_calls.map((value:unknown)=>{
          const call=record(value,['id','type','function'],'provider'),f=record(call.function,['name','arguments','index'],'provider');
          if(call.type!==undefined&&call.type!=='function')throw providerError('unsupported');
          if(f.index!==undefined)integer(f.index,0,1,'provider');
          return {callId:call.id??('ollama_'+randomUUID()),toolId:f.name,arguments:f.arguments};
        }));
      }
    }
    const count=(value:unknown)=>value===undefined?null:integer(value,0,1000000000,'provider');
    const inputTokens=count(response.prompt_eval_count),outputTokens=count(response.eval_count);
    if(outputTokens!==null && outputTokens>maxOutputTokens)throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider');
    const usage=inputTokens===null&&outputTokens===null?undefined:tokenUsage({inputTokens,outputTokens,
      totalTokens:inputTokens===null||outputTokens===null?null:inputTokens+outputTokens});
    let serverDurationMs:number|undefined;
    for(const name of ['total_duration','load_duration','prompt_eval_duration','eval_duration'])
      if(response[name]!==undefined)integer(response[name],0,300000000000000,'provider');
    if(response.total_duration!==undefined)serverDurationMs=Math.ceil((response.total_duration as number)/1000000);
    if(response.prompt_eval_cached_count!==undefined)integer(response.prompt_eval_cached_count,0,1000000000,'provider');
    return {result:llmGenerateResult({...(calls?{kind:'tool_proposals',calls}:{kind:'text',text:message.content}),...(usage&&profile.capabilities.tokenUsage!=='none'?{usage}:{})},profile.capabilities),
      ...(serverDurationMs===undefined?{}:{serverDurationMs})};
  }catch(error){
    if(error instanceof RuntimeError && ['UNSUPPORTED_CAPABILITY','OUTPUT_LIMIT_EXCEEDED'].includes(error.code))throw error;
    throw providerError('invalid_response');
  }
}
