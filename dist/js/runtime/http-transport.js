import {RuntimeApiError} from './validation.js';
/** @import {Timers,Clock} from './contracts' */
export const browserTimers=Object.freeze(/** @type {Timers} */({setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)}));
export const browserClock=Object.freeze({now:()=>globalThis.performance.now(),wallNow:()=>Date.now()});
/** Neutral local transport policy shared by the separate credential audiences. @param {string} value */
export function localOrigin(value){
 try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw 0;return u.origin;}
 catch{throw new RuntimeApiError('CONFIGURATION');}
}
/** Account access is same-origin HTTPS, or explicit loopback HTTP development. No URL-derived trust. @param {string} value @param {string} pageOrigin */
export function accountOrigin(value,pageOrigin){
 try{const u=new URL(value),page=new URL(pageOrigin);if(u.origin!==page.origin||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw 0;return u.origin;}
 catch{throw new RuntimeApiError('CONFIGURATION');}
}
/** @param {import('./contracts').ClientOptions} options */
export function clientOrigin(options){return options.access==='account'?accountOrigin(options.baseUrl,options.pageOrigin??globalThis.location?.origin??''):(localOrigin(options.pageOrigin??globalThis.location?.origin??''),localOrigin(options.baseUrl));}
/** @param {string} token @param {boolean} account */
export function validCredential(token,account){return typeof token==='string'&&(account?/^[A-Za-z0-9_.-]{32,16384}$/:/^[A-Za-z0-9_-]{32,128}$/).test(token);}
/** @param {Response} response @param {Clock} clock */
export function retryDelay(response,clock){
 const value=response.headers.get('retry-after');if(!value)return undefined;
 const delay=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-clock.wallNow();
 return Number.isFinite(delay)?Math.min(60000,Math.max(1000,delay)):undefined;
}
/** @param {Response} response @param {number} limit @param {AbortSignal} signal @returns {Promise<unknown>} */
async function readJson(response,limit,signal){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length')??0)>limit){void response.body?.cancel().catch(()=>{});throw new RuntimeApiError('SCHEMA');}
 const reader=response.body?.getReader();if(!reader)throw new RuntimeApiError('SCHEMA');
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 let total=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{while(true){if(signal.aborted)throw signal.reason;const part=await reader.read();if(signal.aborted)throw signal.reason;if(part.done)break;
   total+=part.value.byteLength;if(total>limit){cancel();throw new RuntimeApiError('SCHEMA');}text+=decoder.decode(part.value,{stream:true});}
  text+=decoder.decode();return JSON.parse(text);
 }catch(error){if(error instanceof RuntimeApiError)throw error;throw new RuntimeApiError('SCHEMA');}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
/** Transport owns no credentials, cache, retries, scopes or UI.
 * @param {string} url
 * @param {{fetchImpl:typeof fetch,timers:Timers,clock:Clock,timeoutMs:number,signal?:AbortSignal,method?:'GET'|'POST',headers:Record<string,string>,body?:string,
 * statuses?:readonly number[],maxBytes?:number,onDispatch?:()=>void,onStatus?:(status:number)=>void,
 * httpError?:(response:Response,body:unknown,retryAfterMs:number|undefined)=>Error}} options @returns {Promise<unknown>} */
export async function requestJson(url,options){
 const {signal,timers}=options,controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason instanceof RuntimeApiError?signal.reason:new RuntimeApiError('CANCELLED'));
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timeout=timers.setTimeout(()=>controller.abort(new RuntimeApiError('TIMEOUT')),options.timeoutMs);
 /** @type {()=>void} */let unlisten=()=>{};
 const interrupted=new Promise((_,reject)=>{const stop=()=>reject(controller.signal.reason);if(controller.signal.aborted)stop();else controller.signal.addEventListener('abort',stop,{once:true});unlisten=()=>controller.signal.removeEventListener('abort',stop);});
 /** @type {Error|undefined} */let httpFailure;
 try{
  const work=(async()=>{
   if(controller.signal.aborted)throw controller.signal.reason;options.onDispatch?.();
   const response=await options.fetchImpl(url,{method:options.method??'GET',headers:options.headers,...(options.body===undefined?{}:{body:options.body}),
    signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw controller.signal.reason;}
   options.onStatus?.(response.status);
   if(!response.ok){
    const retry=retryDelay(response,options.clock);
    if(options.httpError){let body;try{body=await readJson(response,8192,controller.signal);}catch{/* Keep safe HTTP status when diagnostics are malformed. */}httpFailure=options.httpError(response,body,retry);}
    else{void response.body?.cancel().catch(()=>{});httpFailure=new RuntimeApiError(response.status===401?'AUTH_REQUIRED':response.status===403?'FORBIDDEN':response.status===404?'NOT_FOUND':response.status===429?'RATE_LIMITED':response.status>=500?'SERVER':'VALIDATION',retry);}
    throw httpFailure;
   }
   if(!(options.statuses??[200]).includes(response.status)){void response.body?.cancel().catch(()=>{});throw new RuntimeApiError('SCHEMA');}
   return readJson(response,options.maxBytes??65536,controller.signal);
  })();
  return await Promise.race([work,interrupted]);
 }catch(error){if(controller.signal.aborted)throw controller.signal.reason;if(error===httpFailure||error instanceof RuntimeApiError)throw error;throw new RuntimeApiError('NETWORK');}
 finally{timers.clearTimeout(timeout);signal?.removeEventListener('abort',abort);unlisten();}
}
