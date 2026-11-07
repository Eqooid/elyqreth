import { Injectable, OnModuleInit } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ApiConfig } from '../../config/config.module';
import { createRuntimeDefinition, RuntimeDefinition } from '../contracts/definition.contract';
import { LlmProvider, LlmGenerateRequest, LlmRequestContext } from '../contracts/provider.contract';
import { providerCapabilities, providerProfile, llmGenerateRequest, llmGenerateResult, llmRequestContext } from '../contracts/provider-validation';
import { LlmProviderRegistry } from './provider-registry';
import { ProviderSettings, providerSettingsDigest } from './provider-configuration';
import { normalizeProviderError, providerError } from './provider-errors';
import { withProviderDeadline } from './provider-deadline';

@Injectable()
export class ProviderSelectionService implements OnModuleInit {
  constructor(private readonly config:ApiConfig,private readonly registry:LlmProviderRegistry) {}
  private resolve(settings:ProviderSettings) {
    const profile=providerProfile({id:settings.id,profileVersion:settings.profileVersion,model:settings.model,capabilities:settings.capabilities,
      bindingDigest:providerSettingsDigest(settings)});
    const provider=this.registry.resolve(settings.providerId);
    let actual;
    try { actual=providerCapabilities(provider.capabilities(profile)); }
    catch(error) { throw normalizeProviderError(error); }
    const declared=profile.capabilities,rank={none:0,json:1,schema:2};
    if(declared.toolCalls&&!actual.toolCalls || rank[declared.structuredOutput]>rank[actual.structuredOutput] ||
      declared.remoteCancellation==='best_effort'&&actual.remoteCancellation!=='best_effort' ||
      declared.tokenUsage==='optional'&&actual.tokenUsage==='none')throw providerError('unsupported');
    return {provider,profile};
  }
  onModuleInit():void {
    // Validate configured adapter availability without generating/probing models.
    for(const settings of this.config.value.llm?.profiles??[])this.resolve(settings);
  }
  select(value:RuntimeDefinition) {
    const definition=createRuntimeDefinition(value);
    if(definition.strategyType!=='LLM')throw providerError('unsupported');
    const llm=this.config.value.llm;
    if(!llm)throw providerError('configuration');
    const settings=llm.profiles.find(p=>p.id===definition.providerProfile.id);
    if(!settings)throw providerError('configuration');
    const selected=this.resolve(settings);
    if(!isDeepStrictEqual(selected.profile,definition.providerProfile))throw providerError('configuration');
    const requestTimeoutMs=Math.min(llm.requestTimeoutMs,definition.budget.providerTimeoutMs);
    const maxOutputTokens=Math.min(llm.maxOutputTokens,definition.budget.maxOutputTokens);
    const checkProfile=(value:unknown)=>{
      if(!isDeepStrictEqual(providerProfile(value),selected.profile))throw providerError('configuration');
      return selected.profile.capabilities;
    };
    // Shared guarded port, not an agent strategy or HTTP adapter. Validation and
    // deadline enforcement are mandatory before a future adapter is invoked.
    const provider:LlmProvider=Object.freeze({id:selected.provider.id,capabilities:checkProfile,
      generate:async(request:LlmGenerateRequest,context:LlmRequestContext)=>{
        const scoped=llmRequestContext(context);checkProfile(scoped.profile);
        const validated=llmGenerateRequest(request,maxOutputTokens,selected.profile.capabilities.toolCalls);
        const result=await withProviderDeadline(scoped,requestTimeoutMs,ctx=>selected.provider.generate(validated,ctx));
        return llmGenerateResult(result,selected.profile.capabilities);
      }});
    return Object.freeze({provider,profile:selected.profile,requestTimeoutMs,maxOutputTokens});
  }
}
