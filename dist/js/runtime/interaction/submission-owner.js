import {createSubmissionIntent} from './index.js';
import {taskInput} from './validation.js';
/** @import {Agent,Task,SubmissionIntent} from './contracts' */
/** @import {NpcRuntimeBinding} from '../npc-binding.contracts' */
/** @typedef {{draft:string,phase:string,message:string,agent:Agent|null,task:Task|null,intent:SubmissionIntent|null,recoveryKey:string|null,scope:{agentId:string,bindingId:string,npcId:string},busy:boolean}} Entry */
/** Small application-owned form journal. No execution, timers, polling or durable storage. */
export class TaskSubmissionOwner {
 #client;#refresh;#record;#generation=0;#disposed=false;
 /** @type {NpcRuntimeBinding|null} */#selection=null;
 /** @type {Map<string,Entry>} */#entries=new Map();
 /** @type {Set<()=>void>} */#listeners=new Set();
 /** @param {import('./api-client.js').InteractionApiClient} client @param {()=>unknown} [refresh] @param {(locator:import('./recovery-journal.js').Locator)=>void} [record] */
 constructor(client,refresh=()=>{},record=()=>{}){this.#client=client;this.#refresh=refresh;this.#record=record;}
 /** @param {()=>void} fn */subscribe(fn){this.#listeners.add(fn);return ()=>{this.#listeners.delete(fn);};}
 #emit(){if(!this.#disposed)for(const fn of this.#listeners)try{fn();}catch{/* View isolation. */}}
 /** @param {NpcRuntimeBinding|undefined} binding */
 select(binding){
  const next=binding?.state==='RESOLVED'&&binding.agentId&&binding.npcId&&binding.bindingId?binding:null;
  const oldKey=this.#key(),key=next?`${next.agentId}/${next.bindingId}/${next.npcId}`:null;
  this.#selection=next;
  if(key&&next&&!this.#entries.has(key)&&this.#entries.size<20)this.#entries.set(key,{draft:'',phase:'IDLE',message:'Create a saved Task. Execution starts only through the separate explicit Start control.',agent:null,task:null,intent:null,recoveryKey:null,scope:{agentId:/** @type {string} */(next.agentId),bindingId:/** @type {string} */(next.bindingId),npcId:/** @type {string} */(next.npcId)},busy:false});
  if(oldKey!==key){this.#emit();if(key&&this.#client.hasCredential)queueMicrotask(()=>{if(!this.#disposed&&this.#key()===key)void this.check();});}
 }
 #key(){const b=this.#selection;return b?`${b.agentId}/${b.bindingId}/${b.npcId}`:null;}
 #entry(){const key=this.#key();return key?this.#entries.get(key):undefined;}
 getSnapshot(){const e=this.#entry(),b=this.#selection;return Object.freeze({binding:b,connected:this.#client.hasCredential,
  draft:e?.draft??'',phase:e?.phase??'IDLE',message:e?.message??'Interaction journal is full. Resolve pending Tasks or disconnect before changing scope.',agent:e?.agent??null,task:e?.task??null,
  busy:e?.busy??false,recoverable:!!e?.intent||!!e?.recoveryKey,canSubmit:!!e&&!e.busy&&!e.intent&&!e.recoveryKey&&!e.task&&this.#client.hasCredential&&b?.freshness==='fresh'&&(!b.activity||b.activity.availability==='ACTIVE')&&!!e.agent?.actionEligibility.canCreateTask,
  canRetry:!!e?.intent&&!e.busy&&this.#client.hasCredential&&b?.freshness==='fresh',canRecover:(!!e?.intent||!!e?.recoveryKey)&&!e?.busy&&this.#client.hasCredential&&b?.freshness==='fresh'});}
 /** Replacing identity clears all drafts and pending-response scope. @param {string} token */
 connect(token){this.#client.authorize(token);this.#generation++;this.#entries.clear();const b=this.#selection;this.#selection=null;this.select(b??undefined);this.#emit();}
 disconnect(){this.#generation++;this.#client.clearCredential();this.#entries.clear();const b=this.#selection;this.#selection=null;this.select(b??undefined);this.#emit();}
 /** @param {string} draft */setDraft(draft){const e=this.#entry();if(!e||e.busy||e.intent||e.recoveryKey||e.task)return;e.draft=draft;if(e.phase==='ERROR'){e.phase='IDLE';e.message='Ready to validate.';}this.#emit();}
 /** Confirmed binding invalidation erases caches but does not abort a captured mutation. @param {string} agentId @param {string} bindingId */forgetBinding(agentId,bindingId){for(const [key,e]of this.#entries)if(e.scope.agentId===agentId&&e.scope.bindingId===bindingId)this.#entries.delete(key);this.#emit();}
 newTask(){const e=this.#entry();if(!e||e.busy||e.intent||e.recoveryKey)return;e.task=null;e.draft='';e.phase='IDLE';e.message='Create a saved Task; it will not start automatically.';this.#emit();}
 async check(){const e=this.#entry(),b=this.#selection;if(!e||!b?.agentId||e.busy||!this.#client.hasCredential)return;
  const generation=this.#generation;e.busy=true;if(!e.intent&&!e.task)e.message='Checking Agent access and Task creation permission.';this.#emit();
  try{e.agent=await this.#client.getAgent(b.agentId);if(generation!==this.#generation)return;
   if(!e.intent&&!e.task)e.message=e.agent.actionEligibility.canCreateTask?'Task creation available. This does not imply execution is available.':'This Agent cannot currently accept a Task.';
  }catch(error){if(generation===this.#generation)this.#failure(e,error,false);}finally{if(generation===this.#generation){e.busy=false;this.#emit();}}
 }
 /** Explicit same-intent retry only. No mutation retries run automatically. @param {boolean} [retry] */
 async submit(retry=false){const e=this.#entry(),b=this.#selection;if(!e||!b?.agentId||e.busy||!this.#client.hasCredential||b.freshness!=='fresh'||e.task||e.recoveryKey||(!retry&&e.intent)||retry&&!e.intent)return;
  e.phase='VALIDATING';e.message='Validating Task instructions.';
  try{if(!retry){taskInput({instruction:e.draft});e.intent=createSubmissionIntent(b.agentId,{instruction:e.draft});}}
  catch{e.phase='ERROR';e.message='Enter instructions (maximum 16,000 characters and 32 KiB JSON). Credentials and unsupported control characters are not accepted.';this.#emit();return;}
  const intent=e.intent;if(!intent)return;const generation=this.#generation;e.busy=true;this.#emit();
  try{
   const agent=await this.#client.getAgent(intent.agentId);if(generation!==this.#generation)return;e.agent=agent;
   // Selection can change, but this operation keeps its original binding. A confirmed unbinding stops a not-yet-dispatched Create.
   if(this.#selection?.agentId!==b.agentId||this.#selection.bindingId!==b.bindingId||this.#selection.freshness!=='fresh'){
    e.phase='RECOVERY_REQUIRED';e.message='Selection or binding changed before Create. Return to this binding to reconcile or retry the same intent.';return;}
   if(!agent.actionEligibility.canCreateTask){e.phase='ERROR';e.message='This Agent cannot currently accept a Task.';e.intent=null;return;}
   e.phase='SUBMITTING';e.message='Saving Task. No Execution will be started.';this.#emit();
   this.#record({...e.scope,idempotencyKey:intent.idempotencyKey,action:'CREATE'});
   const task=await this.#client.createTask(intent);if(generation!==this.#generation)return;this.#success(e,task);
  }catch(error){if(generation===this.#generation)this.#failure(e,error,true);}finally{if(generation===this.#generation){e.busy=false;this.#emit();}}
 }
 async recover(){const e=this.#entry(),key=e?.intent?.idempotencyKey??e?.recoveryKey;if(!e||!key||e.busy||!this.#client.hasCredential||this.#selection?.freshness!=='fresh')return;
  const generation=this.#generation;e.busy=true;e.message='Checking the original submission key.';this.#emit();
  try{const response=await this.#client.findTaskByIntent(e.scope.agentId,key);if(generation!==this.#generation)return;
   if(response.task)this.#success(e,response.task);else{e.phase='RECOVERY_REQUIRED';e.message='No committed Task found yet. This does not prove the original request failed. Check again or explicitly retry the same intent.';}
  }catch(error){if(generation===this.#generation)this.#failure(e,error,true);}finally{if(generation===this.#generation){e.busy=false;this.#emit();}}
 }
 /** Read-only reauthorization; a stored locator is never a stored lifecycle value or replayable private payload. @param {import('./recovery-journal.js').Locator} locator @param {AbortSignal} [signal] */
 async restore(locator,signal){const e=this.#entry(),b=this.#selection;if(!e||!b||e.busy||e.task||e.intent||e.scope.agentId!==locator.agentId||e.scope.bindingId!==locator.bindingId||e.scope.npcId!==locator.npcId)return;
  const generation=this.#generation;e.busy=true;if(!locator.taskId)e.recoveryKey=locator.idempotencyKey??null;e.message='Reauthorizing stored recovery identifiers.';this.#emit();
  try{const agent=await this.#client.getAgent(locator.agentId,{signal});const task=locator.taskId?await this.#client.getTask({agentId:locator.agentId,taskId:locator.taskId},{signal}):(await this.#client.findTaskByIntent(locator.agentId,/** @type {string} */(locator.idempotencyKey),{signal})).task;
   if(generation!==this.#generation||signal?.aborted)return;e.agent=agent;if(task)this.#success(e,task,locator.action==='START'||locator.action==='CANCEL'?locator.action:null);else{e.recoveryKey=locator.idempotencyKey??null;e.phase='RECOVERY_REQUIRED';e.message='Original Create outcome is still unresolved. Only its key was retained; check again. Private instructions were not stored and will not be replayed.';}
  }catch(error){if(generation===this.#generation&&!signal?.aborted)this.#failure(e,error,false);throw error;}finally{if(generation===this.#generation){e.busy=false;this.#emit();}}
 }
 /** @param {Entry} e @param {Task} task @param {'START'|'CANCEL'|null} [restoredAction] */#success(e,task,restoredAction=null){this.#record({...e.scope,taskId:task.id,...(e.intent?{idempotencyKey:e.intent.idempotencyKey}:e.recoveryKey?{idempotencyKey:e.recoveryKey}:{}),action:restoredAction});e.task=task;e.intent=null;e.recoveryKey=null;e.draft='';e.phase='SUBMITTED';e.message='Task reference confirmed by backend. No Execution was started by saving this Task.';try{Promise.resolve(this.#refresh()).catch(()=>{});}catch{/* Saved Task remains confirmed. */}}
 /** @param {Entry} e @param {unknown} error @param {boolean} mutation */#failure(e,error,mutation){
  const failure=/** @type {{code?:string,outcome?:string}} */(error),code=failure?.code;
  if(code==='AUTH_REQUIRED'){this.disconnect();return;}
  // A transient eligibility read cannot unconfirm a saved Task; denial still erases protected references.
  e.agent=null;if(mutation||code==='FORBIDDEN'||code==='NOT_FOUND')e.task=null;
  e.phase=(e.intent||e.recoveryKey)&&(mutation||failure?.outcome==='UNKNOWN')?'RECOVERY_REQUIRED':'ERROR';
  e.message=code==='FORBIDDEN'?'Access denied. Protected Agent details cleared. Recheck access before continuing.':code==='NOT_FOUND'?'Agent or Task unavailable. Recheck the current binding.':code==='CONFLICT'?'Request conflict. Reconcile the original key before trying again.':code==='RATE_LIMITED'?'Request limited. Wait before checking again.':e.phase==='RECOVERY_REQUIRED'?'Submission outcome is unresolved. Check the original key; do not create another submission.':'Agent access could not be verified. Check the connection and try again.';
 }
 dispose(){this.disconnect();this.#disposed=true;this.#listeners.clear();}
}
