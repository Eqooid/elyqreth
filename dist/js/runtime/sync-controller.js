import {RuntimeApiClient,browserTimers,browserClock} from './api-client.js';
import {RuntimeActivityStore} from './runtime-store.js';
import {RuntimeApiError,agentScope} from './validation.js';
/** @import {SyncOptions,ConnectOptions,RuntimeSnapshot,AgentActivity} from './contracts' */

/** @param {number|undefined} value @param {number} fallback @param {number} min @param {number} max */
function bounded(value,fallback,min,max){const n=value??fallback;if(!Number.isInteger(n)||n<min||n>max)throw new RuntimeApiError('CONFIGURATION');return n;}
function visibility(){return {isHidden:()=>typeof document!=='undefined'&&document.hidden,
 /** @param {()=>void} fn */listen(fn){if(typeof document==='undefined')return ()=>{};document.addEventListener('visibilitychange',fn);return ()=>document.removeEventListener('visibilitychange',fn);}};}
function online(){return {listen:/** @type {(fn:()=>void)=>()=>void} */(fn=>{if(typeof window==='undefined')return ()=>{};window.addEventListener('online',fn);return ()=>window.removeEventListener('online',fn);})};}

export class RuntimeSyncController {
 #store=new RuntimeActivityStore();#timers;#clock;#random;#options;#visibility;#online;
 /** @type {RuntimeApiClient|undefined} */#client;
 /** @type {readonly string[]|undefined} */#scope;
 #generation=0;#connected=false;#blocked=false;#failures=0;#pending=false;#disposed=false;
 /** @type {number|undefined} */#pollTimer;
 /** @type {number|undefined} */#freshTimer;
 /** @type {number|null} */#received=null;
 /** @type {AbortController|undefined} */#abort;
 /** @type {Promise<void>|undefined} */#flight;
 /** @type {(()=>void)[]} */#listeners=[];
 /** @param {SyncOptions} [options] */
 constructor(options={}){
  this.#options={intervalMs:bounded(options.intervalMs,2000,1000,60000),timeoutMs:bounded(options.timeoutMs,5000,100,30000),
   staleMs:bounded(options.staleMs,6000,1000,120000),unknownMs:bounded(options.unknownMs,30000,2000,600000),
   maxPages:bounded(options.maxPages,5,1,5),maxAgents:bounded(options.maxAgents,100,1,100),pageSize:bounded(options.pageSize,20,1,20),fetchImpl:options.fetchImpl};
  if(this.#options.staleMs<this.#options.intervalMs||this.#options.unknownMs<=this.#options.staleMs)throw new RuntimeApiError('CONFIGURATION');
  this.#timers=options.timers??browserTimers;this.#clock=options.clock??browserClock;this.#random=options.random??Math.random;
  this.#visibility=options.visibility??visibility();this.#online=options.online??online();
 }
 getSnapshot(){return this.#store.getSnapshot();}
 /** @param {string} id */getAgent(id){return this.#store.getAgent(id);}
 /** @param {string} id */getByNpc(id){return this.#store.getByNpc(id);}
 /** @param {(state:RuntimeSnapshot)=>void} fn */subscribe(fn){if(this.#disposed)throw new RuntimeApiError('CONFIGURATION');return this.#store.subscribe(fn);}
 /** @param {ConnectOptions} connection */
 connect(connection){
  if(this.#disposed)throw new RuntimeApiError('CONFIGURATION');
  this.disconnect();
  try{
   this.#scope=agentScope(connection.agentIds);
   this.#client=new RuntimeApiClient({baseUrl:connection.baseUrl,access:connection.access,...(connection.access==='account'?{fetchImpl:connection.fetchImpl}:{}),...(connection.pageOrigin?{pageOrigin:connection.pageOrigin}:{}),
    ...(this.#options.fetchImpl?{fetchImpl:this.#options.fetchImpl}:{}),timeoutMs:this.#options.timeoutMs,timers:this.#timers,clock:this.#clock});
   this.#client.authorize(connection.token);this.#connected=true;this.#blocked=false;
   this.#listeners=[this.#visibility.listen(()=>this.#visibilityChanged()),this.#online.listen(()=>{
    if(this.#connected&&!this.#blocked&&!this.#visibility.isHidden()&&this.#pollTimer===undefined&&!this.#flight)void this.refresh();
   })];
   if(this.#visibility.isHidden()||this.#scope?.length===0)this.#store.update({phase:'PAUSED'});else void this.refresh();
  }catch(error){this.disconnect();const safe=error instanceof RuntimeApiError?error:new RuntimeApiError('CONFIGURATION');this.#store.clear('ERROR',safe.toJSON());throw safe;}
 }
 /** Scope change invalidates all cached identity data, without expanding backend authorization. @param {readonly string[]|undefined} ids */
 setScope(ids){
  if(!this.#connected)throw new RuntimeApiError('AUTH_REQUIRED');const scope=agentScope(ids);
  this.#invalidate();this.#scope=scope;this.#blocked=false;this.#failures=0;this.#received=null;this.#store.clear();
  if(this.#visibility.isHidden()||this.#scope?.length===0)this.#store.update({phase:'PAUSED'});else void this.refresh();
 }
 disconnect(){
  this.#connected=false;this.#blocked=false;this.#pending=false;this.#invalidate();this.#client?.clearCredential();this.#client=undefined;
  this.#scope=undefined;this.#failures=0;this.#received=null;for(const remove of this.#listeners)remove();this.#listeners=[];this.#store.clear();
 }
 dispose(){this.disconnect();this.#store.dispose();this.#disposed=true;}
 #invalidate(){
  this.#generation++;this.#abort?.abort(new RuntimeApiError('CANCELLED'));this.#abort=undefined;
  if(this.#pollTimer!==undefined)this.#timers.clearTimeout(this.#pollTimer);this.#pollTimer=undefined;
  if(this.#freshTimer!==undefined)this.#timers.clearTimeout(this.#freshTimer);this.#freshTimer=undefined;
 }
 #visibilityChanged(){
  if(!this.#connected||this.#blocked)return;
  if(this.#visibility.isHidden()){
   this.#invalidate();this.#pending=false;this.#store.update({phase:'PAUSED',loading:false,refreshing:false,stale:true,freshness:this.#received===null?'unknown':'stale'});this.#freshness();
  }else{this.#generation++;this.#pending=false;void this.refresh();}
 }
 #freshness(){
  if(this.#freshTimer!==undefined)this.#timers.clearTimeout(this.#freshTimer);this.#freshTimer=undefined;
  if(this.#received===null||!this.#connected)return;
  const age=Math.max(0,this.#clock.now()-this.#received),state=this.#store.getSnapshot();
  if(age>=this.#options.unknownMs){if(state.freshness!=='unknown')this.#store.update({freshness:'unknown',stale:true});return;}
  if(age>=this.#options.staleMs&&state.freshness==='fresh')this.#store.update({freshness:'stale',stale:true});
  const next=age<this.#options.staleMs?this.#options.staleMs:this.#options.unknownMs;
  this.#freshTimer=this.#timers.setTimeout(()=>this.#freshness(),Math.max(1,next-age));
 }
 /** Coalesces callers into one logical sweep; it never starts an execution. @returns {Promise<void>} */
 refresh(){
  if(!this.#connected||this.#blocked||this.#visibility.isHidden()||this.#scope?.length===0)return Promise.resolve();
  if(this.#flight){if(!this.#abort||this.#abort.signal.aborted)this.#pending=true;return this.#flight;}
  if(this.#pollTimer!==undefined)this.#timers.clearTimeout(this.#pollTimer);this.#pollTimer=undefined;
  const generation=this.#generation,controller=new AbortController();this.#abort=controller;let delay=this.#options.intervalMs;
  const deadline=this.#timers.setTimeout(()=>controller.abort(new RuntimeApiError('TIMEOUT')),this.#options.timeoutMs);
  // Publish the in-flight handle before notifying observers: trusted subscribers
  // may request refresh, change scope, hide or disconnect synchronously.
  /** @type {(value:Promise<{items:AgentActivity[],observedAt:string}>)=>void} */let start=()=>{};
  /** @type {Promise<{items:AgentActivity[],observedAt:string}>} */const work=new Promise(resolve=>{start=resolve;});
  const flight=work.then(result=>{
   if(generation!==this.#generation||!this.#connected)return;
   this.#store.commit(result.items,result.observedAt,new Date(this.#clock.wallNow()).toISOString());
   if(generation!==this.#generation||!this.#connected)return;
   this.#failures=0;this.#received=this.#clock.now();this.#freshness();
  }).catch(error=>{
   if(generation!==this.#generation||!this.#connected)return;
   const safe=error instanceof RuntimeApiError?error:new RuntimeApiError('NETWORK');
   if(['AUTH_REQUIRED','FORBIDDEN'].includes(safe.code)){
    this.disconnect();this.#store.clear('AUTH_REQUIRED',safe.toJSON());return;
   }
   if(['CONFIGURATION','VALIDATION','SCHEMA','LIMIT_EXCEEDED','NOT_FOUND'].includes(safe.code))this.#blocked=true;
   if(safe.code==='NOT_FOUND')this.#store.clear('ERROR',safe.toJSON());
   else this.#store.update({phase:'ERROR',loading:false,refreshing:false,error:safe.toJSON(),stale:true,freshness:this.#received===null?'unknown':'stale'});
   this.#failures=Math.min(5,this.#failures+1);
   const jitter=.8+Math.max(0,Math.min(1,this.#random()))*.4;
   delay=Math.max(Math.min(30000,2000*2**(this.#failures-1)*jitter),safe.retryAfterMs??0);this.#freshness();
  }).finally(()=>{
   this.#timers.clearTimeout(deadline);
   if(this.#flight===flight)this.#flight=undefined;
   if(this.#abort===controller)this.#abort=undefined;
   if(this.#pending&&this.#connected&&!this.#blocked&&!this.#visibility.isHidden()){this.#pending=false;void this.refresh();}
   else if(generation===this.#generation&&this.#connected&&!this.#blocked&&!this.#visibility.isHidden())
    this.#pollTimer=this.#timers.setTimeout(()=>{this.#pollTimer=undefined;void this.refresh();},delay);
  });
  this.#flight=flight;
  this.#store.update({phase:this.#received===null?'LOADING':'REFRESHING',loading:this.#received===null,refreshing:this.#received!==null,error:null});
  start(this.#sweep(controller.signal));return flight;
 }
 /** @param {AbortSignal} signal */
 async #sweep(signal){
  const client=this.#client;if(!client)throw new RuntimeApiError('AUTH_REQUIRED');
  /** @type {AgentActivity[]} */const items=[];const seen=new Set(),bindings=new Set(),npcs=new Set();let after,observedAt;
  for(let page=0;page<this.#options.maxPages;page++){
   const result=await client.fetchPage({limit:this.#options.pageSize,...(after?{after}:{}),...(this.#scope?{ids:this.#scope}:{})},{signal});
   if(signal.aborted)throw signal.reason;
   if(observedAt===undefined||result.observedAt<observedAt)observedAt=result.observedAt;
   for(const item of result.items){
    if(seen.has(item.agentId)||item.bindingId&&bindings.has(item.bindingId)||item.npcId&&npcs.has(item.npcId))
     throw new RuntimeApiError(page>0?'STALE_SNAPSHOT':'SCHEMA');
    seen.add(item.agentId);if(item.bindingId)bindings.add(item.bindingId);if(item.npcId)npcs.add(item.npcId);items.push(item);
   }
   if(items.length>this.#options.maxAgents)throw new RuntimeApiError('LIMIT_EXCEEDED');
   if(result.nextCursor===null)return {items,observedAt};after=result.nextCursor;
  }
  throw new RuntimeApiError('LIMIT_EXCEEDED');
 }
}
