import { BlockList, isIP } from 'node:net';
import { inspect } from 'node:util';
import { ProviderCapabilities } from '../contracts/provider.contract';
import { providerCapabilities } from '../contracts/provider-validation';
import { freeze, integer, modelIdentifier, record, token } from '../contracts/validation';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { createHash } from 'node:crypto';

export interface ProviderSettings {
  readonly id:string; readonly profileVersion:number; readonly providerId:string; readonly model:string;
  readonly capabilities:ProviderCapabilities;
  readonly endpoint: {readonly origin:string; readonly network:'local'|'public'; readonly allowedAddresses:readonly string[]};
  readonly credentialEnv?:string;
}
// Adapter-only injection seam. No credential is enumerable or returned in a
// resolved profile/context/request. Privileged code is not a security sandbox.
export class ProviderCredentials {
  readonly #values:ReadonlyMap<string,string>;
  constructor(values:ReadonlyMap<string,string>) { this.#values=new Map(values);Object.freeze(this); }
  get(profileId:string):string|undefined { return this.#values.get(profileId); }
  toJSON() { return '[isolated provider credentials]'; }
  [inspect.custom]() { return '[isolated provider credentials]'; }
}
export interface LlmConfiguration {
  readonly profiles:readonly ProviderSettings[]; readonly requestTimeoutMs:number; readonly maxOutputTokens:number;
  readonly credentials:ProviderCredentials;
}
export function providerSettingsDigest(settings:ProviderSettings):string {
  return createHash('sha256').update(JSON.stringify({id:settings.id,profileVersion:settings.profileVersion,
    providerId:settings.providerId,model:settings.model,capabilities:providerCapabilities(settings.capabilities),
    endpoint:{origin:settings.endpoint.origin,network:settings.endpoint.network,allowedAddresses:[...settings.endpoint.allowedAddresses].sort()},
    credentialEnv:settings.credentialEnv??null})).digest('hex');
}
const local=new BlockList();
for(const [address,prefix] of [['127.0.0.0',8],['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16]] as const)local.addSubnet(address,prefix,'ipv4');
local.addAddress('::1','ipv6');local.addSubnet('fc00::',7,'ipv6');
const nonpublic4=new BlockList(),nonpublic6=new BlockList(),mapped6=new BlockList(),global6=new BlockList();
const platform4=new BlockList(),platform6=new BlockList();
platform4.addAddress('168.63.129.16','ipv4'); // Azure WireServer, not an external provider.
platform6.addSubnet('fd00:ec2::',32,'ipv6'); // AWS reserved platform-service range, including IMDS.
platform6.addAddress('fd20:ce::254','ipv6'); // Google Cloud IPv6 metadata endpoint.
global6.addSubnet('2000::',3,'ipv6');
mapped6.addSubnet('::ffff:0:0',96,'ipv6');mapped6.addSubnet('64:ff9b::',96,'ipv6');
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
 ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)nonpublic4.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',23],
 ['2001:db8::',32],['2002::',16],['3fff::',20],['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8]] as const)nonpublic6.addSubnet(address,prefix,'ipv6');

function parseEndpoint(value:unknown):ProviderSettings['endpoint'] {
  const e=record(value,['origin','network','allowedAddresses'],'provider');
  if(typeof e.origin!=='string' || e.origin.length>512 || !['local','public'].includes(e.network as string) ||
    !Array.isArray(e.allowedAddresses) || !e.allowedAddresses.length || e.allowedAddresses.length>16)throw new Error('endpoint');
  const url=new URL(e.origin);
  if(url.origin!==e.origin || url.username || url.password || url.search || url.hash || url.pathname!=='/' ||
    !['http:','https:'].includes(url.protocol) || url.port==='0' || e.network==='public' && url.protocol!=='https:')throw new Error('endpoint');
  const addresses=e.allowedAddresses.map((address:unknown)=>{
    if(typeof address!=='string' || !isIP(address))throw new Error('address');
    const family=isIP(address)===4?'ipv4':'ipv6';
    const nonpublic=family==='ipv4'?nonpublic4:nonpublic6;
    // A trusted private destination policy never authorizes cloud metadata/platform services.
    if((family==='ipv4'?platform4:platform6).check(address,family))throw new Error('address');
    if(e.network==='local' ? !local.check(address,family) : nonpublic.check(address,family) || family==='ipv6'&&!global6.check(address,'ipv6'))throw new Error('address');
    // Reject mapped/NAT64 variants even if a platform's local subnet comparison changes.
    if(isIP(address)===6 && (mapped6.check(address,'ipv6') || address.includes('.')))throw new Error('address');
    return address.toLowerCase();
  });
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(host.includes('*') || host.endsWith('.') || !isIP(host) && !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host))throw new Error('host');
  if(isIP(host) && !addresses.some(address=>{
    const exact=new BlockList();exact.addAddress(address,isIP(address)===4?'ipv4':'ipv6');
    return exact.check(host,isIP(host)===4?'ipv4':'ipv6');
  }))throw new Error('address');
  return freeze({origin:url.origin,network:e.network as 'local'|'public',allowedAddresses:freeze([...new Set(addresses)])});
}
export function providerEndpoint(value:unknown):ProviderSettings['endpoint'] {
  try { return parseEndpoint(value); }
  catch { throw new RuntimeError('CONFIGURATION_ERROR','provider'); }
}
export function llmEnvironment(env:Readonly<Record<string,string|undefined>>, hasRuntime:boolean, errors:string[]):LlmConfiguration|undefined {
  // These ambiguous aliases must not silently override a captured exact profile.
  for(const key of ['LLM_PROVIDER','LLM_MODEL','LLM_DEFAULT_PROVIDER','LLM_ENABLED_PROFILES','OLLAMA_BASE_URL','OLLAMA_MODEL','OPENAI_MODEL','OPENAI_ENABLED'])
    if(env[key]!==undefined)errors.push(key);
  if(env.RUNTIME_LLM_ENABLED!==undefined && !['false','true'].includes(env.RUNTIME_LLM_ENABLED))errors.push('RUNTIME_LLM_ENABLED');
  if(env.RUNTIME_LLM_ENABLED!=='true') {
    for(const key of ['LLM_PROFILES','LLM_REQUEST_TIMEOUT_MS','LLM_MAX_OUTPUT_TOKENS','LLM_ALLOW_PAID'])if(env[key]!==undefined)errors.push(key);
    return undefined;
  }
  if(!hasRuntime)errors.push('RUNTIME_LLM_ENABLED');
  if(env.LLM_ALLOW_PAID!==undefined && !['false','true'].includes(env.LLM_ALLOW_PAID))errors.push('LLM_ALLOW_PAID');
  try {
    const boundedNumber=(key:string,fallback:number,max:number)=>{
      const raw=env[key]??String(fallback);if(!/^[1-9]\d*$/.test(raw))throw new Error(key);
      return integer(Number(raw),1,max,'provider');
    };
    const requestTimeoutMs=boundedNumber('LLM_REQUEST_TIMEOUT_MS',60000,120000);
    const maxOutputTokens=boundedNumber('LLM_MAX_OUTPUT_TOKENS',512,4096);
    const text=env.LLM_PROFILES??'';
    if(Buffer.byteLength(text,'utf8')>32768)throw new Error('profiles');
    const data:unknown=JSON.parse(text);
    if(!Array.isArray(data)||!data.length||data.length>16)throw new Error('profiles');
    const seen=new Set<string>(),secrets=new Map<string,string>();
    const profiles=data.map(value=>{
      const p=record(value,['id','profileVersion','providerId','model','capabilities','endpoint','credentialEnv'],'provider');
      const id=token(p.id,'provider');if(seen.has(id))throw new Error('duplicate');seen.add(id);
      const endpoint=providerEndpoint(p.endpoint);
      if(p.providerId==='openai'&&(endpoint.origin!=='https://api.openai.com'||endpoint.network!=='public'))throw new Error('openai endpoint');
      if(endpoint.network==='public' && (env.LLM_ALLOW_PAID!=='true'||p.credentialEnv===undefined))throw new Error('public');
      let credentialEnv:string|undefined;
      if(p.credentialEnv!==undefined) {
        if(typeof p.credentialEnv!=='string'|| !/^[A-Z][A-Z0-9_]{0,47}_API_KEY$/.test(p.credentialEnv))throw new Error('credential');
        credentialEnv=p.credentialEnv;
        const secret=env[credentialEnv];
        if(!secret || !/^[!-~]{8,4096}$/.test(secret))throw new Error('credential');
        secrets.set(id,secret);
      }
      return freeze({id,profileVersion:integer(p.profileVersion,1,2147483647,'provider'),providerId:token(p.providerId,'provider'),
        model:modelIdentifier(p.model,'provider'),capabilities:providerCapabilities(p.capabilities),endpoint,...(credentialEnv?{credentialEnv}:{})});
    });
    const config={profiles:freeze(profiles),requestTimeoutMs,maxOutputTokens} as LlmConfiguration;
    Object.defineProperty(config,'credentials',{value:new ProviderCredentials(secrets),enumerable:false});
    return freeze(config);
  } catch { errors.push('LLM_PROFILES/budgets');return undefined; }
}
