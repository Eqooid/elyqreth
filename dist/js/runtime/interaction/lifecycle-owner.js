/** @import {Task,TaskRuntimeStatus,Execution,ExecutionDetail,TaskReference} from './contracts' */
/** @import {NpcRuntimeBinding} from '../npc-binding.contracts' */
/** @typedef {Task & Partial<Pick<TaskRuntimeStatus,'actionEligibility'|'latestExecutionId'>>} TaskView */
/** @typedef {Execution & Partial<Pick<ExecutionDetail,'actionEligibility'>>} ExecutionView */
/** @typedef {{ref:TaskReference,bindingId:string,npcId:string,task:TaskView|null,execution:ExecutionView|null,fresh:boolean,denied:boolean,receivedAt:string|null,message:string,startPending:boolean,cancelPending:boolean,startDispatched:boolean,cancelDispatched:boolean,cancelAcknowledged:boolean,recovery:'START'|'CANCEL'|null,reading:Promise<void>|null,readController:AbortController|null,readSequence:number}} Entry */
const active=(/** @type {ExecutionView|null} */e)=>!!e&&['PENDING','RUNNING'].includes(e.status);
/** Version-fenced lifecycle observation and explicit actions. No execution engine, result cache, timers or polling. */
export class ExecutionLifecycleOwner {
 #client;#refresh;#authLost;#record;#generation=0;#disposed=false;#fingerprint='';
 /** @type {NpcRuntimeBinding|null} */#binding=null;
 /** @type {Entry|null} */#selected=null;
 /** @type {{entry:Entry,executionId:string}|null} */#confirmation=null;
 /** @type {Map<string,Entry>} */#entries=new Map();
 /** @type {Set<()=>void>} */#listeners=new Set();
 /** @param {import('./api-client.js').InteractionApiClient} client @param {()=>unknown} [refresh] @param {()=>void} [authLost] @param {(locator:import('./recovery-journal.js').Locator,confirmedActiveOrTerminal:boolean)=>void} [record] */
 constructor(client,refresh=()=>{},authLost=()=>{},record=()=>{}){this.#client=client;this.#refresh=refresh;this.#authLost=authLost;this.#record=record;}
 /** @param {()=>void} listener */subscribe(listener){this.#listeners.add(listener);return ()=>{this.#listeners.delete(listener);};}
 #emit(){if(!this.#disposed)for(const listener of this.#listeners)try{listener();}catch{/* Consumer isolation. */}}
 #refreshActivity(){try{Promise.resolve(this.#refresh()).catch(()=>{});}catch{/* Detail availability is independent. */}}
 /** Trusted binding plus explicit saved Task, or an existing projection reference after reload. @param {NpcRuntimeBinding|null|undefined} binding @param {Task|null} [saved] */
 select(binding,saved=null){
  this.#binding=binding?.state==='RESOLVED'?binding:null;const b=this.#binding,a=b?.activity;
  const taskId=saved?.agentId===b?.agentId?saved?.id:a?.currentTask?.id??a?.lastExecution?.taskId??a?.recentOutcome?.taskId;
  const key=b?.agentId&&b.bindingId&&taskId?`${b.agentId}/${b.bindingId}/${taskId}`:null;
  if(key&&!this.#entries.has(key)){
   if(this.#entries.size>=40){const candidate=[...this.#entries].find(([,e])=>e!==this.#selected&&!e.startPending&&!e.cancelPending&&!e.reading&&!e.recovery);if(candidate)this.#entries.delete(candidate[0]);}
   if(this.#entries.size<40)this.#entries.set(key,{ref:Object.freeze({agentId:/** @type {string} */(b?.agentId),taskId:/** @type {string} */(taskId)}),bindingId:/** @type {string} */(b?.bindingId),npcId:/** @type {string} */(b?.npcId),task:null,execution:null,fresh:false,denied:false,receivedAt:null,message:'Read authoritative Task and Execution details before acting.',startPending:false,cancelPending:false,startDispatched:false,cancelDispatched:false,cancelAcknowledged:false,recovery:null,reading:null,readController:null,readSequence:0});
  }
  const next=key?this.#entries.get(key)??null:null,changed=next!==this.#selected;if(changed&&this.#selected&&!this.#selected.startPending&&!this.#selected.cancelPending)this.#abortRead(this.#selected);this.#selected=next;
  if(changed)this.#confirmation=null;
  const fingerprint=JSON.stringify([key,a?.currentTask?.id,a?.currentTask?.version,a?.currentExecution?.id,a?.currentExecution?.version,a?.lastExecution?.id,a?.lastExecution?.status,a?.recentOutcome?.finishedAt,
   next&&(next.startPending||next.cancelPending||next.recovery||active(next.execution))?b?.lastSuccessfulSyncAt:null]);
  if(changed||fingerprint!==this.#fingerprint){this.#fingerprint=fingerprint;
   if(next&&!next.denied&&b?.freshness==='fresh'&&this.#client.hasCredential)queueMicrotask(()=>{if(!this.#disposed&&this.#selected===next)void this.#read(next);});
  }
 }
 /** @param {Entry|null} e */#contextFresh(e){return !!e&&this.#selected===e&&this.#binding?.freshness==='fresh'&&this.#binding.bindingId===e.bindingId&&this.#binding.agentId===e.ref.agentId&&this.#client.hasCredential;}
 /** @param {Entry|null} e */#canStart(e){return !!e&&this.#contextFresh(e)&&(!this.#binding?.activity||this.#binding.activity.availability==='ACTIVE')&&e.fresh&&!e.reading&&!e.startPending&&!e.cancelPending&&!e.recovery&&!!e.task?.actionEligibility?.canRequestStart&&['CREATED','QUEUED'].includes(e.task.status)&&(!e.execution||e.execution.status==='PENDING');}
 /** Task-level eligibility has no execution context; only the exact Execution detail supplies cancel permission. @param {Entry|null} e */#canCancel(e){return !!e&&this.#contextFresh(e)&&e.fresh&&!e.reading&&!e.cancelPending&&!e.cancelAcknowledged&&active(e.execution)&&!!e.task&&['QUEUED','RUNNING'].includes(e.task.status)&&!!e.execution?.actionEligibility?.canRequestCancel;}
 getSnapshot(){const e=this.#selected;return Object.freeze({task:e?.task??null,execution:e?.execution??null,fresh:!!e?.fresh&&this.#contextFresh(e),receivedAt:e?.receivedAt??null,
  reading:!!e?.reading,startPending:!!e?.startPending,cancelPending:!!e?.cancelPending,recovery:e?.recovery??null,canStart:this.#canStart(e),canCancel:this.#canCancel(e),confirmation:this.#confirmation?.entry===e?this.#confirmation.executionId:null,
  message:e?.message??'No saved or projected Task reference is available. Save a Task first, or wait for authorized activity synchronization.'});}
 /** No per-frame calls: selection, relevant shared activity changes and explicit refresh only. */
 async refresh(){const e=this.#selected;if(e&&this.#contextFresh(e))await this.#read(e);}
 /** @param {'START'|'CANCEL'} action */restoreRecovery(action){const e=this.#selected;if(e){e.recovery=action;e.fresh=false;e.message='Recovering an earlier action through authoritative reads; no mutation will be replayed.';this.#emit();}}
 /** @param {Entry} e */#abortRead(e){e.readController?.abort();e.readController=null;e.readSequence++;e.reading=null;e.fresh=false;}
 /** @param {Entry} e */#save(e){this.#record({...e.ref,bindingId:e.bindingId,npcId:e.npcId,...(e.execution?{executionId:e.execution.id}:{}),action:e.cancelDispatched?'CANCEL':e.startDispatched?'START':e.recovery},!!e.task&&!['CREATED','QUEUED'].includes(e.task.status));}
 /** @param {Entry} e */async #read(e){if(e.reading)return e.reading;if(!this.#client.hasCredential||this.#disposed)return;
  const generation=this.#generation,sequence=++e.readSequence,controller=new AbortController();e.readController=controller;
  const operation=(async()=>{try{
   const task=await this.#client.getTaskStatus(e.ref,{signal:controller.signal});
   const execution=task.latestExecutionId?await this.#client.getExecution({...e.ref,executionId:task.latestExecutionId},{signal:controller.signal}):null;
   if(generation!==this.#generation||sequence!==e.readSequence)return;
   if(!this.#apply(e,task,execution)){e.fresh=false;e.message='Delayed lifecycle response ignored. Refresh before acting.';return;}e.denied=false;e.receivedAt=new Date().toISOString();
   const coherent=!execution?['CREATED','CANCELLED'].includes(task.status):task.status==='QUEUED'&&execution.status==='PENDING'||task.status==='RUNNING'&&execution.status==='RUNNING'||task.status==='COMPLETED'&&execution.status==='SUCCEEDED'||task.status==='FAILED'&&['FAILED','TIMED_OUT'].includes(execution.status)||task.status==='CANCELLED'&&execution.status==='CANCELLED';
   e.fresh=coherent;
   if(!coherent){e.message='Lifecycle changed between reads. Details are uncertain; refresh before acting.';return;}
   if(e.recovery==='START'&&(task.status==='CREATED'||task.status==='QUEUED'&&execution?.status==='PENDING')){
    e.message='Start outcome remains unresolved. No repeat Start is allowed. Refresh to reconcile; a missing running record does not prove Start was rejected.';
   }else{e.recovery=null;e.message=e.cancelAcknowledged&&active(e.execution)?'Cancellation acknowledged; awaiting a persisted terminal outcome.':'Authoritative persisted lifecycle retrieved. Agent-wide activity is a separate sampled projection.';}this.#save(e);
  }catch(error){if(generation===this.#generation&&sequence===e.readSequence&&!controller.signal.aborted)this.#failure(e,error,null);}
  finally{if(generation===this.#generation&&sequence===e.readSequence){e.reading=null;e.readController=null;this.#emit();}}})();
  e.reading=operation;this.#emit();return operation;
 }
 /** Monotonic versions apply per resource, never across unrelated Agents or Executions. @param {Entry} e @param {TaskView} task @param {ExecutionView|null} execution */
 #apply(e,task,execution){
  if(task.agentId!==e.ref.agentId||task.id!==e.ref.taskId||execution&&(execution.agentId!==e.ref.agentId||execution.taskId!==e.ref.taskId))throw Error('Reference mismatch');
  if(e.task&&task.version<e.task.version)return false;
  if(e.task&&task.version===e.task.version&&task.status!==e.task.status)throw Error('Inconsistent version');
  if(execution&&e.execution?.id===execution.id){if(execution.version<e.execution.version)return false;if(execution.version===e.execution.version&&execution.status!==e.execution.status)throw Error('Inconsistent version');}
  e.task=task;e.execution=execution;return true;
 }
 async start(){const e=this.#selected;if(!this.#canStart(e)||!e)return;const generation=this.#generation;e.startPending=true;e.message='Start request pending. This is not a backend RUNNING status.';this.#confirmation=null;this.#emit();
  try{
   await this.#read(e);if(generation!==this.#generation)return;
   if(!this.#contextFresh(e)||!e.fresh||!e.task?.actionEligibility?.canRequestStart||e.recovery){e.message='Start was not sent: binding, lifecycle or eligibility changed. Refresh before acting.';return;}
   e.startDispatched=true;this.#save(e);const response=this.#client.executeTask(e.ref,e.task.version);this.#refreshActivity();
   const finished=await response;if(generation!==this.#generation)return;
   this.#abortRead(e);this.#apply(e,finished.task,finished.execution);e.fresh=false;e.message='Start response received. Refreshing authoritative lifecycle.';
  }catch(error){if(generation===this.#generation)this.#failure(e,error,'START');}
  finally{if(generation===this.#generation){e.startPending=false;e.startDispatched=false;this.#refreshActivity();await this.#read(e);this.#emit();}}
 }
 requestCancel(){const e=this.#selected;if(!this.#canCancel(e)||!e?.execution)return;this.#confirmation={entry:e,executionId:e.execution.id};this.#emit();}
 dismissCancel(){this.#confirmation=null;this.#emit();}
 /** @param {string} agentId @param {string} bindingId */forgetBinding(agentId,bindingId){for(const [key,e]of this.#entries)if(e.ref.agentId===agentId&&e.bindingId===bindingId){if(!e.startPending&&!e.cancelPending)this.#abortRead(e);this.#entries.delete(key);if(this.#selected===e){this.#selected=null;this.#binding=null;this.#confirmation=null;}}this.#emit();}
 async confirmCancel(){const confirmed=this.#confirmation,e=confirmed?.entry;if(!e||this.#selected!==e||!this.#canCancel(e))return;
  const generation=this.#generation;e.cancelPending=true;this.#confirmation=null;e.message='Cancellation request pending; persisted status has not been changed locally.';this.#emit();
  try{
   await this.#read(e);if(generation!==this.#generation)return;
   if(!this.#contextFresh(e)||!e.fresh||!e.execution||e.execution.id!==confirmed.executionId||!e.execution.actionEligibility?.canRequestCancel||!e.task||!['QUEUED','RUNNING'].includes(e.task.status)){e.message='Cancellation was not sent: the persisted outcome or eligibility changed.';return;}
   e.cancelDispatched=true;this.#save(e);const pair=await this.#client.cancelExecution({...e.ref,executionId:confirmed.executionId},{taskVersion:e.task.version,executionVersion:e.execution.version});
   if(generation!==this.#generation)return;this.#abortRead(e);this.#apply(e,pair.task,pair.execution);e.cancelAcknowledged=true;e.fresh=false;e.message='Cancellation acknowledged. Reading the persisted outcome; no local CANCELLED transition was assumed.';
  }catch(error){if(generation===this.#generation)this.#failure(e,error,'CANCEL');}
  finally{if(generation===this.#generation){e.cancelPending=false;e.cancelDispatched=false;this.#refreshActivity();await this.#read(e);this.#emit();}}
 }
 /** @param {Entry} e @param {unknown} error @param {'START'|'CANCEL'|null} action */
 #failure(e,error,action){const code=/** @type {{code?:string}} */(error)?.code;e.fresh=false;
  if(code==='AUTH_REQUIRED'){this.clear();this.#authLost();return;}
  if(code==='FORBIDDEN'||code==='NOT_FOUND'){e.task=null;e.execution=null;e.denied=true;this.#confirmation=null;e.message='Execution access unavailable. Protected details cleared; recheck the current binding and access.';}
  else e.message=code==='CONFLICT'?'Lifecycle/version conflict. Reconcile the persisted winner; the action will not be repeated automatically.':'Lifecycle request unavailable or outcome uncertain. Refresh authoritative details; no mutation will be retried automatically.';
  if(action)e.recovery=action;
 }
 /** Scope change/disconnect fences all pending completions; the shared client owner aborts HTTP waits separately. */
 clear(){this.#generation++;for(const e of this.#entries.values())this.#abortRead(e);this.#entries.clear();this.#selected=null;this.#binding=null;this.#confirmation=null;this.#fingerprint='';this.#emit();}
 dispose(){this.clear();this.#disposed=true;this.#listeners.clear();}
}
