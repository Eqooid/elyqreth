import {accountOrigin,requestJson,browserTimers,browserClock} from '../http-transport.js';
import {RuntimeApiError} from '../validation.js';
/** @typedef {{kind:'LOCAL_ACCOUNT'|'OIDC',role:'viewer'|'operator',ownerId:string,actorReference:string}} Principal */
/** @param {unknown} value @param {string} origin */
export function accessConfiguration(value,origin){
 const r=/** @type {Record<string,unknown>} */(value);
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>k!=='mode')||!['disabled','local','oidc'].includes(String(r.mode)))throw new RuntimeApiError('CONFIGURATION');
 if(r.mode!=='disabled')accountOrigin(origin,origin);
 return Object.freeze({mode:/** @type {'disabled'|'local'|'oidc'} */(r.mode)});
}
/** @param {unknown} value @returns {Principal} */
function principal(value){const p=/** @type {Principal} */(value);if(!p||!['LOCAL_ACCOUNT','OIDC'].includes(p.kind)||!['viewer','operator'].includes(p.role)||typeof p.ownerId!=='string'||!/^[a-f0-9-]{36}$/i.test(p.ownerId)||typeof p.actorReference!=='string'||p.actorReference.length>128)throw new RuntimeApiError('SCHEMA');return Object.freeze({kind:p.kind,role:p.role,ownerId:p.ownerId,actorReference:p.actorReference});}
/** One session authority. Memory-only bearer, no cookies, refresh tokens, persistence or lifecycle authority. */
export class AccessSession{
 #origin;#mode;#fetch;#token='';#generation=0;#controller=new AbortController();#disposed=false;
 /** @type {Set<()=>void>} */#listeners=new Set();
 /** @type {Set<AbortController>} */#pending=new Set();
 /** @type {{phase:string,principal:Principal|null,message:string}} */#state={phase:'INITIALIZING',principal:null,message:''};
 /** @param {{origin:string,mode:'local'|'oidc',fetchImpl?:typeof fetch}} options */
 constructor(options){if(!['local','oidc'].includes(options.mode))throw new RuntimeApiError('CONFIGURATION');this.#origin=accountOrigin(options.origin,options.origin);this.#mode=options.mode;this.#fetch=options.fetchImpl??globalThis.fetch.bind(globalThis);}
 getSnapshot(){return Object.freeze({...this.#state});}
 /** @param {()=>void} fn */subscribe(fn){this.#listeners.add(fn);return()=>{this.#listeners.delete(fn);};}
 #emit(){for(const fn of this.#listeners)try{fn();}catch{/* Isolate views. */}}
 /** @param {string} phase @param {string} [message] */
 #clear(phase,message=''){this.#generation++;this.#controller.abort();this.#controller=new AbortController();for(const c of this.#pending)c.abort();this.#token='';this.#state={phase,principal:null,message};this.#emit();}
 bootstrap(){if(this.#state.phase==='INITIALIZING')this.#clear('UNAUTHENTICATED','Sign in to inspect protected Agent activity. The city remains available.');}
 /** @param {string} path @param {{token?:string,body?:unknown,signal?:AbortSignal}} [options] */
 #request(path,options={}){return requestJson(this.#origin+'/api/v1/auth/'+path,{fetchImpl:this.#fetch,timers:browserTimers,clock:browserClock,timeoutMs:10000,signal:options.signal,method:options.body===undefined?'GET':'POST',maxBytes:32768,headers:{Accept:'application/json',...(options.token?{Authorization:'Bearer '+options.token}:{}),...(options.body===undefined?{}:{'Content-Type':'application/json'})},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});}
 /** @param {{username?:string,password?:string,accessToken?:string}} input */
 async login(input){if(this.#disposed)return;this.#clear('INITIALIZING','Verifying access...');const generation=this.#generation,signal=this.#controller.signal;
 try{let token=input.accessToken??'';
  if(this.#mode==='local'){const row=/** @type {{accessToken?:unknown,tokenType?:unknown,expiresAt?:unknown}} */(await this.#request('login',{body:{username:input.username,password:input.password},signal}));if(row.tokenType!=='Bearer'||typeof row.accessToken!=='string'||typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt)))throw new RuntimeApiError('SCHEMA');token=row.accessToken;}
  if(!/^[A-Za-z0-9_.-]{32,16384}$/.test(token))throw new RuntimeApiError('VALIDATION');
  const p=principal(await this.#request('me',{token,signal}));if(signal.aborted||generation!==this.#generation)return;
  if(p.kind!==(this.#mode==='local'?'LOCAL_ACCOUNT':'OIDC'))throw new RuntimeApiError('SCHEMA');
  this.#token=token;this.#state={phase:'AUTHENTICATED',principal:p,message:`Authenticated ${p.role}.`};this.#emit();
 }catch(error){if(signal.aborted||generation!==this.#generation)return;const code=/** @type {{code?:string}} */(error)?.code;this.#clear(code==='AUTH_REQUIRED'||code==='FORBIDDEN'?'UNAUTHENTICATED':'ERROR',code==='AUTH_REQUIRED'?'Authentication failed.':code==='FORBIDDEN'?'Access is not granted.':'Authentication service unavailable or response invalid. Retry explicitly.');}}
 /** Used only by trusted page composition after /me succeeds; never expose via globals or DOM. @param {(token:string,fetchImpl:typeof fetch)=>void} fn */
 connect(fn){if(this.#state.phase!=='AUTHENTICATED'||!this.#token)throw new RuntimeApiError('AUTH_REQUIRED');fn(this.#token,this.fetch);}
 /** Single gate for all protected clients; stale completion cannot survive a session change. @type {typeof fetch} */
 fetch=async(input,init={})=>{if(this.#state.phase!=='AUTHENTICATED'||!this.#token)throw new RuntimeApiError('AUTH_REQUIRED');const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,this.#origin);if(url.origin!==this.#origin||!url.pathname.startsWith('/api/v1/')||url.username||url.password||url.hash)throw new RuntimeApiError('CONFIGURATION');
  const c=new AbortController(),generation=this.#generation,abort=()=>c.abort();init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)c.abort();this.#pending.add(c);
  try{const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+this.#token);const response=await this.#fetch(url.href,{...init,headers,signal:c.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
   if(generation!==this.#generation||c.signal.aborted){void response.body?.cancel().catch(()=>{});throw new RuntimeApiError('CANCELLED');}
   if(response.status===401)this.expire();return response;
  }finally{this.#pending.delete(c);init.signal?.removeEventListener('abort',abort);}};
 /** Revalidate on tab visibility/online; network errors suspend access, never claim revocation. */
 async revalidate(){if(this.#state.phase!=='AUTHENTICATED')return;const generation=this.#generation,signal=this.#controller.signal;
  try{const p=principal(await this.#request('me',{token:this.#token,signal}));if(generation!==this.#generation||signal.aborted)return;this.#state={phase:'AUTHENTICATED',principal:p,message:`Authenticated ${p.role}.`};this.#emit();}
  catch(error){if(generation!==this.#generation||signal.aborted)return;const code=/** @type {{code?:string}} */(error)?.code;if(code==='AUTH_REQUIRED')this.expire();else this.#clear('ERROR','Access recheck unavailable. Protected data cleared; sign in again.');}}
 expire(){this.#clear('EXPIRED','Session expired or revoked. Sign in again.');}
 /** Local cleanup is immediate even if revocation fails. OIDC has no backend logout endpoint. */
 async logout(){const token=this.#token;this.#clear('UNAUTHENTICATED',this.#mode==='local'?'Signed out locally. Revoking session...':'Signed out locally. Issuer token remains valid until expiry or issuer policy.');const generation=this.#generation;
  if(!token||this.#mode!=='local')return;
  try{await this.#request('logout',{token,body:{}});if(generation===this.#generation){this.#state.message='Signed out; server session revoked.';this.#emit();}}
  catch{if(generation===this.#generation){this.#state.message='Signed out locally. Server revocation was not confirmed; the session may remain valid until expiry.';this.#emit();}}}
 leavePage(){this.#clear('UNAUTHENTICATED','Page access cleared. Sign in again; server revocation was not requested.');}
 remoteLogout(){this.#clear('UNAUTHENTICATED','Signed out in another tab.');}
 dispose(){this.#disposed=true;this.#clear('UNAUTHENTICATED');this.#listeners.clear();}
}
