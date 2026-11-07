import { LlmGenerateRequest, LlmGenerateResult, ProviderCapabilities, ResolvedProviderProfile, LlmRequestContext } from '../../contracts/provider.contract';
import { llmGenerateRequest, llmGenerateResult, providerProfile, tokenUsage, llmToolCalls } from '../../contracts/provider-validation';
import { modelIdentifier } from '../../contracts/validation';
import { RuntimeError } from '../../contracts/runtime-error.contract';
import { resumeHistory } from '../provider-continuation';
import { providerError } from '../provider-errors';

export const OPENAI_CAPABILITIES:ProviderCapabilities=Object.freeze({text:true,transportAbort:true,remoteCancellation:'unknown',
  structuredOutput:'none',toolCalls:true,streaming:false,tokenUsage:'optional'});

export function openaiRequest(value:LlmGenerateRequest,profile:ResolvedProviderProfile,maxOutputTokens=4096,context?:LlmRequestContext) {
  const request=llmGenerateRequest(value,maxOutputTokens,profile.capabilities.toolCalls),selected=providerProfile(profile);
  const resumed=request.continuation?resumeHistory('openai',request,context):undefined;
  if(!resumed&&request.messages.some(m=>m.role==='tool'||m.role==='assistant'&&m.calls))throw providerError('configuration');
  const input=resumed?[...resumed.native,...resumed.replies.map(m=>({type:'function_call_output',call_id:m.callId,output:m.content}))]:request.messages;
  return Object.freeze({model:selected.model,input,store:false,stream:false,background:false,
    ...(request.tools?.length?{tools:request.tools.map(t=>({type:'function',name:t.toolId,description:t.description,parameters:t.inputSchema,strict:true})),parallel_tool_calls:false}:{}),
    truncation:'disabled',max_output_tokens:request.maxOutputTokens});
}

// Protocol objects never escape this mapper. Extra API metadata is deliberately
// ignored; only a bounded, completed, text-only result crosses the neutral port.
export function openaiResponse(value:unknown,profile:ResolvedProviderProfile,maxOutputTokens:number):{
  result:LlmGenerateResult;actualModel:string;
} {
  try {
    if(!value||typeof value!=='object'||Array.isArray(value))throw providerError('invalid_response');
    const r=value as Record<string,unknown>;
    if(r.status==='incomplete'&&(r.incomplete_details as {reason?:unknown}|null)?.reason==='max_output_tokens')
      throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider');
    if(r.object!=='response'||r.status!=='completed'||r.error!=null||r.incomplete_details!=null||
      !Array.isArray(r.output)||r.output.length>32)throw providerError('invalid_response');
    const actualModel=modelIdentifier(r.model,'provider');
    // Aliases can legitimately resolve to a dated snapshot. Record the reported
    // model only as adapter diagnostics; the trusted request model is unchanged.
    const text:string[]=[],calls:unknown[]=[];
    for(const item of r.output) {
      if(!item||typeof item!=='object')throw providerError('invalid_response');
      if(item.type==='function_call'){
        if(!profile.capabilities.toolCalls)throw providerError('unsupported');
        if(item.status!==undefined&&item.status!=='completed'||typeof item.arguments!=='string'||Buffer.byteLength(item.arguments)>1024)throw providerError('invalid_response');
        calls.push({callId:item.call_id,toolId:item.name,arguments:JSON.parse(item.arguments)});continue;
      }
      if(item.type==='reasoning')continue; // Never expose reasoning summaries.
      if(item.type!=='message')throw providerError('unsupported');
      if(item.role!=='assistant'||item.status!=='completed'||!Array.isArray(item.content)||item.content.length>32)
        throw providerError('invalid_response');
      for(const content of item.content) {
        if(!content||typeof content!=='object')throw providerError('invalid_response');
        if(content.type==='refusal')throw providerError('invalid_response');
        if(content.type!=='output_text')throw providerError('unsupported');
        if(typeof content.text!=='string')throw providerError('invalid_response');
        text.push(content.text);
      }
    }
    let usage;
    if(r.usage!=null) {
      if(typeof r.usage!=='object'||Array.isArray(r.usage))throw providerError('invalid_response');
      const u=r.usage as Record<string,unknown>;
      usage=tokenUsage({inputTokens:u.input_tokens??null,outputTokens:u.output_tokens??null,totalTokens:u.total_tokens??null});
      if(usage.outputTokens!==null&&usage.outputTokens>maxOutputTokens)throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider');
    }
    return {actualModel,result:llmGenerateResult({...(calls.length?{kind:'tool_proposals',calls:llmToolCalls(calls)}:{kind:'text',text:text.join('')}),
      ...(usage&&profile.capabilities.tokenUsage!=='none'?{usage}:{})},profile.capabilities)};
  }catch(error) {
    if(error instanceof RuntimeError&&['OUTPUT_LIMIT_EXCEEDED','UNSUPPORTED_CAPABILITY'].includes(error.code))throw error;
    throw providerError('invalid_response');
  }
}

// Parse only closed protocol codes, never error.message or arbitrary diagnostics.
export function openaiStatusError(status:number,body:unknown):RuntimeError {
  const e=body&&typeof body==='object'?(body as {error?:unknown}).error:undefined;
  const code=e&&typeof e==='object'?(e as {code?:unknown}).code:undefined;
  const type=e&&typeof e==='object'?(e as {type?:unknown}).type:undefined;
  if(status===401||status===403)return providerError('authentication');
  if(status===404||code==='model_not_found')return providerError('missing_model');
  if(status===429) {
    if(type==='insufficient_quota'||['insufficient_quota','billing_hard_limit_reached','credit_balance_exhausted',
      'organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'].includes(String(code)))
      return providerError('quota_exhausted');
    return providerError('rate_limited');
  }
  if(status>=300&&status<400)return providerError('configuration');
  if(status>=400&&status<500)return new RuntimeError('INVALID_INPUT','provider');
  return providerError('unavailable');
}
