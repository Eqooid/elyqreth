import {RuntimeApiError,normalizeActivity,normalizePage,identifier,agentScope} from './validation.js';
import {browserTimers,browserClock,clientOrigin,validCredential,requestJson} from './http-transport.js';
export {browserTimers,browserClock} from './http-transport.js';
/** @import {ClientOptions,ActivityQuery,Timers,Clock} from './contracts' */
/** Fixed city GET audience only. Credential lives in a private field, never a store or config export. */
export class RuntimeApiClient {
 #origin;#fetch;#timeout;#timers;#clock;#token='';#account=false;
 /** @param {ClientOptions} options */
 constructor(options){
  this.#origin=clientOrigin(options);this.#account=options.access==='account';
  this.#fetch=options.fetchImpl??globalThis.fetch.bind(globalThis);this.#timeout=options.timeoutMs??5000;
  if(!Number.isInteger(this.#timeout)||this.#timeout<100||this.#timeout>30000)throw new RuntimeApiError('CONFIGURATION');
  this.#timers=options.timers??browserTimers;this.#clock=options.clock??browserClock;
 }
 /** @param {string} token */
 authorize(token){if(!validCredential(token,this.#account))throw new RuntimeApiError('CONFIGURATION');this.#token=token;}
 clearCredential(){this.#token='';}
 /** @param {string} agentId @param {{signal?:AbortSignal}} [options] */
 async fetchActivity(agentId,options={}){
  let id;try{id=identifier(agentId);}catch{throw new RuntimeApiError('VALIDATION');}
  const result=normalizeActivity(await this.#request(`/api/v1/cities/elyqreth/agents/${id}/activity`,options.signal));
  if(result.agentId!==id)throw new RuntimeApiError('SCHEMA');return result;
 }
 /** @param {ActivityQuery} [query] @param {{signal?:AbortSignal}} [options] */
 async fetchPage(query={},options={}){
  if(!query||typeof query!=='object'||Array.isArray(query)||Reflect.ownKeys(query).some(k=>typeof k!=='string'||!['limit','after','ids'].includes(k)))throw new RuntimeApiError('VALIDATION');
  const limit=query.limit??20;if(!Number.isInteger(limit)||limit<1||limit>20)throw new RuntimeApiError('VALIDATION');
  const params=new URLSearchParams({limit:String(limit)}),ids=agentScope(query.ids);
  if(ids&&ids.length===0)throw new RuntimeApiError('VALIDATION');
  let after;try{after=query.after===undefined?undefined:identifier(query.after);}catch{throw new RuntimeApiError('VALIDATION');}
  if(after)params.set('after',after);if(ids)params.set('ids',ids.join(','));
  const page=normalizePage(await this.#request('/api/v1/cities/elyqreth/agents?'+params,options.signal),limit,after);
  if(ids&&page.items.some(item=>!ids.includes(item.agentId)))throw new RuntimeApiError('SCHEMA');return page;
 }
 /** @param {string} path @param {AbortSignal|undefined} signal @returns {Promise<unknown>} */
 async #request(path,signal){
  if(!this.#token)throw new RuntimeApiError('AUTH_REQUIRED');
  return requestJson(this.#origin+path,{fetchImpl:this.#fetch,timers:this.#timers,clock:this.#clock,timeoutMs:this.#timeout,signal,
   headers:{Authorization:`Bearer ${this.#token}`,Accept:'application/json'}});
 }
}
