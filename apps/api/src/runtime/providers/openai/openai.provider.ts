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
import { OpenaiHttpTransport } from './openai-http.transport';
import { OPENAI_CAPABILITIES, openaiRequest, openaiResponse } from './openai.mapper';

@Injectable()
export class OpenaiProvider implements LlmProvider {
  readonly id='openai';
  constructor(private readonly config:ApiConfig,private readonly transport:OpenaiHttpTransport,private readonly logger:ApiLogger) {}
  private settings(value:ResolvedProviderProfile) {
    const profile=providerProfile(value),llm=this.config.value.llm;
    const settings=llm?.profiles.find(p=>p.id===profile.id&&p.providerId===this.id);
    if(!settings||settings.endpoint.network!=='public'||settings.endpoint.origin!=='https://api.openai.com'||!settings.credentialEnv)
      throw providerError('configuration');
    const expected=providerProfile({id:settings.id,profileVersion:settings.profileVersion,model:settings.model,
      capabilities:settings.capabilities,bindingDigest:providerSettingsDigest(settings)});
    if(!isDeepStrictEqual(profile,expected))throw providerError('configuration');
    if(!llm?.credentials.get(settings.id))throw providerError('authentication');
    return settings;
  }
  capabilities(profile:ResolvedProviderProfile) {this.settings(profile);return OPENAI_CAPABILITIES;}
  async generate(request:LlmGenerateRequest,value:LlmRequestContext) {
    const context=llmRequestContext(value),settings=this.settings(context.profile),llm=this.config.value.llm!;
    if(context.profile.capabilities.structuredOutput!=='none'||
      context.profile.capabilities.remoteCancellation!=='unknown')throw providerError('unsupported');
    const validated=llmGenerateRequest(request,llm.maxOutputTokens,context.profile.capabilities.toolCalls);
    const body=openaiRequest(validated,context.profile,llm.maxOutputTokens,context),started=Date.now();
    return withProviderDeadline(context,llm.requestTimeoutMs,async scoped=>{
      const raw=await this.transport.postResponses(settings.endpoint,body,scoped,llm.credentials.get(settings.id)!);
      const mapped=openaiResponse(raw,scoped.profile,body.max_output_tokens);
      try {
        this.logger.info('provider.transport.completed',{providerId:this.id,executionId:context.executionId,correlationId:context.correlationId,
          model:mapped.actualModel,durationMs:Math.min(300000,Math.max(0,Date.now()-started))});
      } catch { /* Diagnostic sink failures cannot invalidate a valid provider response. */ }
      if(mapped.result.kind==='tool_proposals'){
        const items=(raw as {output:unknown[]}).output;
        for(const item of items){
          const allowed=(item as {type?:string}).type==='reasoning'?['type','id','summary','encrypted_content','status']:
            (item as {type?:string}).type==='function_call'?['type','id','call_id','name','arguments','status']:['type','id','role','status','content','phase'];
          record(item,allowed,'provider');
          if((item as {type:string}).type==='reasoning'&&
            (typeof (item as {encrypted_content?:unknown}).encrypted_content!=='string'||!(item as {encrypted_content:string}).encrypted_content.length))
            throw providerError('invalid_response');
        }
        const continuation=historyContinuation(this.id,validated,context,[...body.input,...items],mapped.result.calls);
        return llmGenerateResult({...mapped.result,continuation},context.profile.capabilities);
      }
      return mapped.result;
    });
  }
}
