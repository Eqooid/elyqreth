import { createPublicKey } from 'node:crypto';
import { inspect } from 'node:util';
import type { JSONWebKeySet } from 'jose';
export type AccessRole = 'viewer' | 'operator';
export type AuthenticationConfiguration = Readonly<{ mode: 'local'; sessionSeconds: number }> |
  Readonly<{ mode: 'oidc'; issuer: string; audience: string; jwks: JSONWebKeySet;
    subjects: readonly Readonly<{ subject: string; role: AccessRole }>[] }>;
const keys = ['AUTH_SESSION_SECONDS','AUTH_OIDC_ISSUER','AUTH_OIDC_AUDIENCE','AUTH_OIDC_JWKS','AUTH_OIDC_SUBJECTS'];
export function authenticationEnvironment(env:Readonly<Record<string,string|undefined>>,hasDatabase:boolean,errors:string[]):AuthenticationConfiguration|undefined {
  const mode=env.AUTH_MODE??'disabled';
  if(mode==='disabled') { for(const key of keys)if(env[key]!==undefined)errors.push(key);return; }
  if(!['local','oidc'].includes(mode)||!hasDatabase||env.AGENT_REGISTRY_ENABLED!=='true')errors.push('AUTH_MODE');
  if(env.NODE_ENV!=='production'&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(env.API_HOST??'127.0.0.1'))errors.push('API_HOST');
  // Installation mode is exclusive; development bearer audiences cannot become a fallback.
  for(const key of ['AGENT_REGISTRY_TOKEN','CITY_READ_TOKEN','CITY_INTERACTION_TOKEN','COLLABORATION_READ_TOKEN'])
    if(env[key]!==undefined)errors.push(key);
  if(env.CITY_INTERACTION_ENABLED==='true')errors.push('CITY_INTERACTION_ENABLED');
  // External service-credential production integration remains T10; do not mint legacy grants with an empty token.
  if(env.EXTERNAL_ORCHESTRATORS_ENABLED==='true')errors.push('EXTERNAL_ORCHESTRATORS_ENABLED');
  try {
    let result:AuthenticationConfiguration;
    if(mode==='local') {
      if(keys.slice(1).some(key=>env[key]!==undefined))throw Error();
      const raw=env.AUTH_SESSION_SECONDS??'3600',seconds=Number(raw);
      if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(seconds)||seconds<300||seconds>86400)throw Error();
      result={mode,sessionSeconds:seconds};
    } else {
      if(mode!=='oidc'||env.AUTH_SESSION_SECONDS!==undefined)throw Error();
      const issuer=env.AUTH_OIDC_ISSUER??'',audience=env.AUTH_OIDC_AUDIENCE??'',url=new URL(issuer);
      if(url.href.replace(/\/$/,'')!==issuer.replace(/\/$/,'')||url.username||url.password||url.search||url.hash||
        url.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(audience))throw Error();
      const text=env.AUTH_OIDC_JWKS??'',mapping=env.AUTH_OIDC_SUBJECTS??'';
      if(Buffer.byteLength(text)>32768||Buffer.byteLength(mapping)>32768)throw Error();
      const published=JSON.parse(text) as JSONWebKeySet,subjects:unknown=JSON.parse(mapping);
      const jwks:JSONWebKeySet={keys:[]};
      if(!published||Object.keys(published).some(k=>k!=='keys')||!Array.isArray(published.keys)||!published.keys.length||published.keys.length>16)throw Error();
      const ids=new Set<string>();
      for(const key of published.keys){
        // An issuer may publish encryption/other-algorithm keys alongside signing keys.
        // They never enter the RS256 verifier; reject private key material in every entry.
        if(!key||typeof key!=='object'||Array.isArray(key)||['d','p','q','dp','dq','qi','oth','k'].some(k=>Object.hasOwn(key,k)))throw Error();
        if(key.kty!=='RSA'||key.use!==undefined&&key.use!=='sig'||key.alg!==undefined&&key.alg!=='RS256')continue;
        if(Object.keys(key).some(k=>!['kty','kid','n','e','alg','use','key_ops','x5c','x5t','x5t#S256'].includes(k))||key.kty!=='RSA'||
          key.key_ops!==undefined&&(!Array.isArray(key.key_ops)||key.key_ops.length!==1||key.key_ops[0]!=='verify')||
          typeof key.kid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(key.kid)||ids.has(key.kid)||key.alg!==undefined&&key.alg!=='RS256'||key.use!==undefined&&key.use!=='sig')throw Error();
        ids.add(key.kid);
        const publicKey=createPublicKey({key:key as import('node:crypto').JsonWebKey,format:'jwk'});
        if((publicKey.asymmetricKeyDetails?.modulusLength??0)<2048)throw Error();
        jwks.keys.push(Object.freeze({...key}));
      }
      if(!jwks.keys.length||jwks.keys.length>8)throw Error();
      if(!Array.isArray(subjects)||!subjects.length||subjects.length>64)throw Error();
      const seen=new Set<string>();
      const allowed=subjects.map((v:unknown)=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['subject','role'].includes(k)))throw Error();
        const s=v as {subject:string;role:AccessRole};
        if(typeof s.subject!=='string'||s.subject.length<1||s.subject.length>200||/[\x00-\x20\x7f]/.test(s.subject)||seen.has(s.subject)||!['viewer','operator'].includes(s.role))throw Error();
        seen.add(s.subject);return Object.freeze({subject:s.subject,role:s.role});
      });
      Object.freeze(jwks.keys);Object.freeze(jwks);
      result={mode,issuer,audience,jwks,subjects:Object.freeze(allowed)};
    }
    Object.defineProperties(result,{toJSON:{value:()=>({mode})},[inspect.custom]:{value:()=>({mode})}});
    return Object.freeze(result);
  } catch { errors.push('AUTH_MODE settings');return; }
}
