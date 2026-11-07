import { Inject, Injectable } from '@nestjs/common';
import { Capability, OrchestratorAdapter } from './adapter.contract';
import { capabilityList, key } from './adapter.validation';
import { AdapterError } from './adapter.error';
export const EXTERNAL_ADAPTERS = Symbol('EXPLICIT_EXTERNAL_ADAPTERS');
const methods = {agents:'discoverAgents',executions:'discoverExecutions',status:'getExecution',result:'getResult','events.poll':'pollEvents','events.subscribe':'subscribeEvents',dispatch:'dispatch',cancel:'cancel','submission.lookup':'lookupSubmission'} as const;
@Injectable()
export class AdapterRegistry {
  readonly #entries = new Map<string,Readonly<OrchestratorAdapter>>();
  constructor(@Inject(EXTERNAL_ADAPTERS) registrations: readonly OrchestratorAdapter[]) {
    for (const adapter of registrations) {
      try {
        const type=key(adapter.type), caps=capabilityList(adapter.capabilities);
        if(this.#entries.has(type)||!caps.includes('health')||typeof adapter.describe!=='function'||typeof adapter.health!=='function'||typeof adapter.validateConfiguration!=='function')throw Error();
        for(const [cap,method] of Object.entries(methods)) if(caps.includes(cap as Capability)&&typeof adapter[method as keyof OrchestratorAdapter]!=='function')throw Error();
        if(caps.includes('dispatch.idempotent')&&!caps.includes('dispatch'))throw Error();
        const bound:Record<string,unknown>={type,capabilities:Object.freeze([...caps]),describe:adapter.describe.bind(adapter),health:adapter.health.bind(adapter),validateConfiguration:adapter.validateConfiguration.bind(adapter)};
        for(const method of Object.values(methods))if(typeof adapter[method]==='function')bound[method]=adapter[method]!.bind(adapter);
        this.#entries.set(type,Object.freeze(bound) as unknown as Readonly<OrchestratorAdapter>);
      } catch { throw new AdapterError('INVALID_CONFIGURATION'); }
    }
  }
  resolve(type:string) { const entry=this.#entries.get(type);if(!entry)throw new AdapterError('UNKNOWN_ADAPTER');return entry; }
}
