/** @import {Execution,ExecutionReference,ResultResponse} from './contracts' */
/** @import {NpcRuntimeBinding} from '../npc-binding.contracts' */
const same=(/** @type {ExecutionReference|null} */a,/** @type {ExecutionReference|null} */b)=>a?.agentId===b?.agentId&&a?.taskId===b?.taskId&&a?.executionId===b?.executionId;
/** Lazy, read-only, single-scope observation. One history page and one selected result, no timers or mutation methods. */
export class ExecutionResultsOwner {
 #client;#authLost;#scope='';#generation=0;#disposed=false;#denied=false;#fingerprint='';
 /** @type {NpcRuntimeBinding|null} */#binding=null;
 /** @type {Execution|null} */#current=null;
 /** @type {ExecutionReference|null} */#selected=null;
 /** @type {'CURRENT'|'HISTORY'} */#mode='CURRENT';
 #resultOpen=false;#historyOpen=false;#historyLoaded=false;#historyError='';#resultError='';#detailStale=false;#historyRevision=0;#loadedRevision=0;#retriedRevision=-1;
 /** @type {Map<string,number>} */#knownVersions=new Map();
 /** @type {Execution|null} */#detail=null;
 /** @type {ResultResponse|null} */#result=null;
 /** @type {readonly Execution[]} */#items=Object.freeze([]);
 /** @type {(string|null)[]} */#cursors=[null];#page=0;
 /** @type {string|null} */#nextCursor=null;
 /** @type {AbortController|null} */#historyRequest=null;
 /** @type {AbortController|null} */#resultRequest=null;
 /** @type {Set<()=>void>} */#listeners=new Set();
 /** @param {import('./api-client.js').InteractionApiClient} client @param {()=>void} [authLost] */
 constructor(client,authLost=()=>{}){this.#client=client;this.#authLost=authLost;}
 /** @param {()=>void} fn */subscribe(fn){this.#listeners.add(fn);return ()=>{this.#listeners.delete(fn);};}
 #emit(){if(!this.#disposed)for(const fn of this.#listeners)try{fn();}catch{/* View isolation. */}}
 #usable(){return !!this.#scope&&this.#binding?.freshness==='fresh'&&this.#client.hasCredential&&!this.#disposed;}
 #abortResult(){this.#resultRequest?.abort();this.#resultRequest=null;}
 #abortHistory(){this.#historyRequest?.abort();this.#historyRequest=null;}
 /** Current lifecycle detail remains owned by T05. Result/history selection never writes back. @param {NpcRuntimeBinding|null|undefined} binding @param {Execution|null} [execution] */
 select(binding,execution=null){
  const b=binding?.state==='RESOLVED'?binding:null,scope=b?.agentId&&b.bindingId&&b.npcId?`${b.agentId}/${b.bindingId}/${b.npcId}`:'';
  const changed=scope!==this.#scope,wasFresh=this.#binding?.freshness==='fresh';
  if(changed){this.#generation++;this.#abortResult();this.#abortHistory();this.#scope=scope;this.#mode='CURRENT';this.#selected=null;this.#detail=null;this.#result=null;this.#items=Object.freeze([]);this.#cursors=[null];this.#page=0;this.#nextCursor=null;this.#historyLoaded=false;this.#historyError='';this.#resultError='';this.#denied=false;this.#fingerprint='';this.#detailStale=false;this.#knownVersions.clear();this.#historyRevision=0;this.#loadedRevision=0;this.#retriedRevision=-1;}
  this.#binding=b;this.#current=execution?.agentId===b?.agentId?execution:null;
  const current=this.#current,ref=current?Object.freeze({agentId:current.agentId,taskId:current.taskId,executionId:current.id}):null;
  const fingerprint=current?`${current.id}/${current.version}/${current.status}/${current.resultAvailability}`:'';
  const updated=fingerprint!==this.#fingerprint;this.#fingerprint=fingerprint;
  if(this.#mode==='CURRENT'&&!same(this.#selected,ref)){this.#abortResult();this.#selected=ref;this.#detail=null;this.#result=null;this.#resultError='';}
  if(!this.#usable()){this.#abortResult();this.#abortHistory();this.#detailStale=!!this.#detail;}
  else if(!this.#denied){
   if(this.#resultOpen&&this.#selected&&(changed||this.#mode==='CURRENT'&&updated||!wasFresh))queueMicrotask(()=>{if(this.#usable()&&this.#resultOpen)void this.refreshResult();});
   if(this.#historyOpen&&!this.#historyLoaded&&(changed||!wasFresh))queueMicrotask(()=>{if(this.#usable()&&this.#historyOpen)void this.refreshHistory();});
  }
  if(changed||updated||wasFresh!==(b?.freshness==='fresh'))this.#emit();
 }
 getSnapshot(){return Object.freeze({agentId:this.#binding?.agentId??null,mode:this.#mode,selected:this.#selected,current:this.#current,detail:this.#detail,result:this.#result,
  detailStale:this.#detailStale||this.#binding?.freshness!=='fresh',resultLoading:!!this.#resultRequest,resultError:this.#resultError,
  items:this.#items,historyLoaded:this.#historyLoaded,historyLoading:!!this.#historyRequest,historyError:this.#historyError,page:this.#page+1,
  canRead:this.#usable(),canNext:this.#usable()&&!this.#historyRequest&&!!this.#nextCursor&&this.#page<19,canPrevious:this.#usable()&&!this.#historyRequest&&this.#page>0,
  pageLimitReached:!!this.#nextCursor&&this.#page>=19,historyDirty:this.#historyRevision!==this.#loadedRevision});}
 /** @param {boolean} open */openResult(open){this.#resultOpen=open;if(!open)this.#abortResult();else if(!this.#result&&this.#selected)void this.refreshResult();this.#emit();}
 /** @param {boolean} open */openHistory(open){this.#historyOpen=open;if(!open)this.#abortHistory();else if(!this.#historyLoaded||this.#page===0&&this.#historyRevision!==this.#loadedRevision)void this.refreshHistory();this.#emit();}
 /** Targeted invalidation, never a second poller or a historical-selection change. @param {string} agentId @param {string} [executionId] @param {number} [version] */
 invalidateHistory(agentId,executionId,version){if(this.#binding?.agentId!==agentId)return;
  if(executionId&&version!==undefined){if((this.#knownVersions.get(executionId)??0)>=version)return;this.#knownVersions.set(executionId,version);if(this.#knownVersions.size>40)this.#knownVersions.delete(/** @type {string} */(this.#knownVersions.keys().next().value));}
  this.#historyRevision++;if(this.#historyOpen&&this.#page===0&&!this.#historyRequest&&!this.#denied)queueMicrotask(()=>{if(this.#usable()&&this.#historyOpen&&this.#page===0)void this.refreshHistory();});this.#emit();
 }
 /** Only IDs in the currently authorized bounded page can become historical selections. @param {string} id */
 selectHistory(id){const item=this.#items.find(e=>e.id===id);if(!item||!this.#usable())return;this.#abortResult();this.#mode='HISTORY';this.#selected=Object.freeze({agentId:item.agentId,taskId:item.taskId,executionId:item.id});this.#detail=null;this.#result=null;this.#resultError='';this.#resultOpen=true;void this.refreshResult();this.#emit();}
 returnToCurrent(){this.#abortResult();this.#mode='CURRENT';const e=this.#current;this.#selected=e?Object.freeze({agentId:e.agentId,taskId:e.taskId,executionId:e.id}):null;this.#detail=null;this.#result=null;this.#resultError='';if(this.#selected&&this.#resultOpen)void this.refreshResult();this.#emit();}
 async refreshResult(){const ref=this.#selected;if(!ref||!this.#usable()||this.#resultRequest)return;
  const controller=new AbortController(),generation=this.#generation;this.#resultRequest=controller;this.#resultError='';this.#detailStale=!!this.#detail;this.#emit();
  const valid=()=>generation===this.#generation&&this.#resultRequest===controller&&!controller.signal.aborted;
  try{
   // Reuse validated current metadata; historical details are obtained lazily for this exact reference.
   const known=this.#mode==='CURRENT'&&this.#current?.id===ref.executionId?this.#current:await this.#client.getExecution(ref,{signal:controller.signal});
   if(!valid())return;const minimum=this.#detail?.id===ref.executionId?this.#detail.version:0;
   if(known.version<minimum||this.#detail?.id===known.id&&this.#detail.version===known.version&&this.#detail.status!==known.status)throw Error('Older detail observation');this.#detail=known;this.#emit();
   const result=await this.#client.getResult(ref,{signal:controller.signal});if(!valid())return;
   if(result.execution.version<Math.max(known.version,minimum)||result.execution.version===known.version&&result.execution.status!==known.status)throw Error('Older result observation');
   this.#detail=result.execution;this.#result=result;this.#detailStale=false;this.#denied=false;
  }catch(error){if(valid())this.#failure(error,'result');}
  finally{if(valid()){this.#resultRequest=null;this.#emit();}}
 }
 async refreshHistory(){if(this.#historyRequest||!this.#usable())return;await this.#history(0,null,true);}
 async nextPage(){if(!this.getSnapshot().canNext||!this.#nextCursor)return;await this.#history(this.#page+1,this.#nextCursor,false);}
 async previousPage(){if(!this.getSnapshot().canPrevious)return;await this.#history(this.#page-1,this.#cursors[this.#page-1],false);}
 /** @param {number} page @param {string|null} cursor @param {boolean} reset */
 async #history(page,cursor,reset){const agentId=this.#binding?.agentId;if(!agentId||!this.#usable()||this.#historyRequest)return;
  const controller=new AbortController(),generation=this.#generation,revision=this.#historyRevision;this.#historyRequest=controller;this.#historyError='';this.#emit();
  const valid=()=>generation===this.#generation&&this.#historyRequest===controller&&!controller.signal.aborted;
  try{
   const result=await this.#client.listAgentExecutions(agentId,{limit:10,...(cursor?{before:cursor}:{})},{signal:controller.signal});if(!valid())return;
   if(result.pagination.nextCursor&&[...this.#cursors.slice(0,page+1),cursor].includes(result.pagination.nextCursor))throw Error('Cursor loop');
   if(!reset&&page>this.#page&&result.items.some(item=>this.#items.some(old=>old.id===item.id)))throw Error('Repeated page');
   if(result.items.some(item=>item.version<(this.#knownVersions.get(item.id)??0)))throw Error('Older history observation');
   this.#items=result.items;this.#nextCursor=result.pagination.nextCursor;this.#page=page;
   this.#cursors=reset?[null]:[...this.#cursors.slice(0,page),cursor];this.#historyLoaded=true;this.#denied=false;this.#loadedRevision=revision;
  }catch(error){if(valid())this.#failure(error,'history');}
  finally{if(valid()){this.#historyRequest=null;if(this.#historyRevision!==this.#loadedRevision&&this.#retriedRevision!==this.#historyRevision&&this.#historyOpen&&this.#page===0&&!this.#denied){this.#retriedRevision=this.#historyRevision;queueMicrotask(()=>{if(this.#usable()&&this.#historyOpen)void this.refreshHistory();});}this.#emit();}}
 }
 /** @param {unknown} error @param {'result'|'history'} target */
 #failure(error,target){const code=/** @type {{code?:string}} */(error)?.code;
  if(code==='AUTH_REQUIRED'){this.clear();this.#authLost();return;}
  if(code==='FORBIDDEN'||code==='NOT_FOUND'){this.#generation++;this.#abortResult();this.#abortHistory();this.#detail=null;this.#result=null;this.#items=Object.freeze([]);this.#historyLoaded=false;this.#cursors=[null];this.#page=0;this.#nextCursor=null;this.#denied=true;}
  const message=code==='FORBIDDEN'?'Access denied. Protected result/history data cleared.':code==='NOT_FOUND'?'Execution or Agent unavailable. Protected result/history data cleared.':code==='SCHEMA'?'Unsupported or invalid response. No unvalidated output is displayed.':code==='TIMEOUT'?'Request timed out. Use a read-only refresh to try again.':code==='RATE_LIMITED'?'Request limited. Wait before refreshing.':'Read unavailable. Check connectivity and refresh; this does not mean execution failed.';
  if(target==='result'){this.#resultError=message;this.#detailStale=true;}else this.#historyError=message;this.#emit();
 }
 clear(){this.select(null,null);}
 dispose(){this.clear();this.#disposed=true;this.#abortResult();this.#abortHistory();this.#listeners.clear();}
}
