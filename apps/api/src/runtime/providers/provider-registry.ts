import { Inject, Injectable } from '@nestjs/common';
import { LlmProvider } from '../contracts/provider.contract';
import { token } from '../contracts/validation';
import { LLM_PROVIDERS } from '../tokens/runtime.tokens';
import { providerError } from './provider-errors';

@Injectable()
export class LlmProviderRegistry {
  private readonly providers=new Map<string,LlmProvider>();
  constructor(@Inject(LLM_PROVIDERS) providers:readonly LlmProvider[]) {
    for(const provider of providers)this.register(provider);
  }
  register(provider:LlmProvider):void {
    let id:string;
    try { id=token(provider?.id,'provider'); }catch {throw providerError('configuration');}
    if(this.providers.has(id)||typeof provider.generate!=='function'||typeof provider.capabilities!=='function')throw providerError('configuration');
    this.providers.set(id,Object.freeze({id,capabilities:provider.capabilities.bind(provider),generate:provider.generate.bind(provider)}));
  }
  resolve(providerId:string):LlmProvider {
    try {token(providerId,'provider');}catch{throw providerError('configuration');}
    const provider=this.providers.get(providerId);
    if(!provider)throw providerError('not_registered');
    return provider;
  }
}
