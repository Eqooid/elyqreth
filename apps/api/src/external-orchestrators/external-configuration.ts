import { inspect } from 'node:util';
import { createHash } from 'node:crypto';
import { providerEndpoint } from '../runtime/providers/provider-configuration';
import type { RegistryConfiguration } from '../agents/registry-configuration';
import { Connection } from './adapter.contract';
import { capabilityList, object, uuid, key, number, text } from './adapter.validation';
import { AdapterError } from './adapter.error';

export class ExternalCredentials {
  readonly #values: ReadonlyMap<string,string>;
  constructor(values: ReadonlyMap<string,string>) { this.#values = new Map(values); Object.freeze(this); }
  // Internal transport seam only. Never exposed by an HTTP controller/context/descriptor.
  resolve(reference: string | undefined) { return reference === undefined ? undefined : this.#values.get(reference); }
  contains(value: string) { return [...this.#values.values()].some(secret => value.includes(secret)||value.includes(JSON.stringify(secret).slice(1,-1))); }
  toJSON() { return '[isolated external credentials]'; }
  [inspect.custom]() { return this.toJSON(); }
}
export interface ExternalConfiguration { readonly connections: readonly Connection[]; readonly credentials: ExternalCredentials }
/** Internal policy/credential binding; never return this fingerprint in descriptors or diagnostics. */
export function connectionBinding(value:Connection,credentials:ExternalCredentials|undefined):string {
  const c=connection(value),secret=credentials?.resolve(c.credentialRef);
  if(c.credentialRef&&(!secret||!/^[\x21-\x7e]{8,4096}$/.test(secret)))throw new AdapterError('INVALID_CONFIGURATION');
  return createHash('sha256').update(JSON.stringify({id:c.id,ownerId:c.ownerId,adapterType:c.adapterType,namespace:c.namespace,generation:c.generation,
    mode:c.mode,enabled:c.enabled,endpoint:{...c.endpoint,allowedAddresses:[...c.endpoint.allowedAddresses].sort()},
    capabilities:[...c.capabilities].sort(),credentialRef:c.credentialRef??null,secret:secret??null})).digest('hex');
}
export function connection(value: unknown): Connection {
  try {
    const v = object(value,['id','ownerId','adapterType','name','namespace','generation','mode','enabled','endpoint','credentialRef','capabilities']);
    if (!['OBSERVATION_ONLY','CONTROLLED_DISPATCH'].includes(v.mode as string) || typeof v.enabled !== 'boolean' ||
      (v.credentialRef !== undefined && (typeof v.credentialRef !== 'string' || !/^EXTERNAL_SECRET_[A-Z0-9_]{1,80}$/.test(v.credentialRef)))) throw Error();
    return Object.freeze({id:uuid(v.id),ownerId:uuid(v.ownerId),adapterType:key(v.adapterType),name:text(v.name,160),namespace:key(v.namespace),generation:number(v.generation,1000000),
      mode:v.mode as Connection['mode'],enabled:v.enabled,endpoint:providerEndpoint(v.endpoint),capabilities:capabilityList(v.capabilities),
      ...(v.credentialRef === undefined ? {} : {credentialRef:v.credentialRef as string})});
  } catch { throw new AdapterError('INVALID_CONFIGURATION'); }
}
export function externalEnvironment(env: Readonly<Record<string,string|undefined>>, nodeEnv: string, registry: RegistryConfiguration | undefined, errors: string[]): ExternalConfiguration | undefined {
  if (env.EXTERNAL_ORCHESTRATORS_ENABLED === undefined || env.EXTERNAL_ORCHESTRATORS_ENABLED === 'false') {
    if (env.EXTERNAL_ORCHESTRATORS !== undefined) errors.push('EXTERNAL_ORCHESTRATORS'); return undefined;
  }
  try {
    if (env.EXTERNAL_ORCHESTRATORS_ENABLED !== 'true' || !registry || !['development','test'].includes(nodeEnv)) throw Error();
    const raw=env.EXTERNAL_ORCHESTRATORS??''; if (Buffer.byteLength(raw)>32768) throw Error();
    const data:unknown=JSON.parse(raw);if (!Array.isArray(data) || !data.length || data.length>16) throw Error();
    const seen=new Set<string>(), secrets=new Map<string,string>(),secretValues=new Set<string>();
    const connections=data.map(value=>{
      const c=connection(value); if(c.ownerId !== registry.ownerId.toLowerCase() || seen.has(c.id)) throw Error();seen.add(c.id);
      if(c.credentialRef){const secret=env[c.credentialRef];if(!secret||!/^[\x21-\x7e]{8,4096}$/.test(secret)||secrets.has(c.credentialRef)||secretValues.has(secret))throw Error();secrets.set(c.credentialRef,secret);secretValues.add(secret);}
      return c;
    });
    const credentials=new ExternalCredentials(secrets);
    if(credentials.contains(JSON.stringify(connections)))throw Error();
    return Object.freeze({connections:Object.freeze(connections),credentials});
  } catch { errors.push('EXTERNAL_ORCHESTRATORS'); return undefined; }
}
export function safeConnection(c: Connection) { return Object.freeze({id:c.id,adapterType:c.adapterType,name:c.name,namespace:c.namespace,generation:c.generation,mode:c.mode,enabled:c.enabled}); }
