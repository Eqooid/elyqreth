import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ApiConfig } from '../../../config/config.module';
import { ApiLogger } from '../../../common/api-logger';
import { LlmProvider, LlmGenerateRequest, LlmRequestContext, ResolvedProviderProfile } from '../../contracts/provider.contract';
import { llmRequestContext, providerProfile, llmGenerateRequest, llmGenerateResult } from '../../contracts/provider-validation';
import { providerSettingsDigest } from '../provider-configuration';
import { providerError } from '../provider-errors';
import { historyContinuation } from '../provider-continuation';
import { record } from '../../contracts/validation';
import { withProviderDeadline } from '../provider-deadline';
import { OllamaHttpTransport } from './ollama-http.transport';
import { OLLAMA_CAPABILITIES, ollamaRequest, ollamaResponse } from './ollama.mapper';

@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly id='ollama';
  constructor(private readonly config:ApiConfig,private readonly transport:OllamaHttpTransport,private readonly logger:ApiLogger) {}
  private settings(value:ResolvedProviderProfile) {
    const profile=providerProfile(value),settings=this.config.value.llm?.profiles.find(p=>p.id===profile.id&&p.providerId===this.id);
    if(!settings||settings.endpoint.network!=='local'||settings.credentialEnv!==undefined)throw providerError('configuration');
    const expected=providerProfile({id:settings.id,profileVersion:settings.profileVersion,model:settings.model,
      capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)});
    if(!isDeepStrictEqual(profile,expected))throw providerError('configuration');
    return settings;
  }
  capabilities(profile:ResolvedProviderProfile) {this.settings(profile);return OLLAMA_CAPABILITIES;}
  async generate(request:LlmGenerateRequest,value:LlmRequestContext) {
    const context=llmRequestContext(value),settings=this.settings(context.profile),llm=this.config.value.llm!;
    if(context.profile.capabilities.structuredOutput!=='none'||
      context.profile.capabilities.remoteCancellation!=='unknown')throw providerError('unsupported');
    const validated=llmGenerateRequest(request,llm.maxOutputTokens,context.profile.capabilities.toolCalls);
    const body=ollamaRequest(validated,context.profile,llm.maxOutputTokens,context),started=Date.now();
    return withProviderDeadline(context,llm.requestTimeoutMs,async scoped=>{
      const response=await this.transport.postChat(settings.endpoint,body,scoped);
      const mapped=ollamaResponse(response,scoped.profile,body.options.num_predict);
      try {
        this.logger.info('provider.transport.completed',{providerId:this.id,executionId:context.executionId,correlationId:context.correlationId,
          durationMs:Math.min(300000,Math.max(0,Date.now()-started)),...(mapped.serverDurationMs===undefined?{}:{serverDurationMs:mapped.serverDurationMs})});
      } catch { /* Diagnostic sink failures cannot invalidate a valid provider response. */ }
      if(mapped.result.kind==='tool_proposals'){
        const raw=record(response,['model','created_at','message','done','done_reason','total_duration','load_duration','prompt_eval_count','prompt_eval_cached_count','prompt_eval_duration','eval_count','eval_duration','logprobs','error'],'provider');
        const message=record(raw.message,['role','content','thinking','tool_calls','images'],'provider');
        const assistant={role:'assistant',content:typeof message.content==='string'?message.content:'',
          ...(message.thinking===undefined?{}:{thinking:message.thinking}),
          tool_calls:mapped.result.calls.map((c,index)=>({id:c.callId,type:'function',function:{index,name:c.toolId,arguments:c.arguments}}))};
        const continuation=historyContinuation(this.id,validated,context,[...body.messages,assistant],mapped.result.calls);
        return llmGenerateResult({...mapped.result,continuation},context.profile.capabilities);
      }
      return mapped.result;
    });
  }
}
