import {TaskSubmissionOwner} from './submission-owner.js';
import {ExecutionLifecycleOwner} from './lifecycle-owner.js';
import {ExecutionResultsOwner} from './results-owner.js';
import {InteractionRecoveryJournal} from './recovery-journal.js';
/** @import {NpcRuntimeBinding} from '../npc-binding.contracts' */
/** @import {RuntimeSnapshot} from '../contracts' */
/** A page-owned composition boundary, not another authoritative store or scheduler. */
export class InteractionSession {
 #client;#journal;#disposed=false;#closing=false;#suspended=false;#composing=false;#generation=0;#message='';#lastSweep='';#activitySignature='';
 /** @type {NpcRuntimeBinding|null} */#binding=null;
 /** @type {RuntimeSnapshot|undefined} */#runtime;
 /** @type {import('./recovery-journal.js').Locator|null} */#restoreAction=null;
 /** @type {AbortController|null} */#restoring=null;
 /** @type {Promise<void>|null} */#restoreFlight=null;
 /** @type {Map<string,number>} */#attempts=new Map();
 /** @type {Map<string,string>} */#seen=new Map();
 /** @type {Set<()=>void>} */#listeners=new Set();
 /** @param {import('./api-client.js').InteractionApiClient} client @param {{baseUrl:string,refresh?:()=>unknown,journal?:InteractionRecoveryJournal}} options */
 constructor(client,options){this.#client=client;this.#journal=options.journal??new InteractionRecoveryJournal(options.baseUrl);
  const record=/** @param {import('./recovery-journal.js').Locator} row */row=>{if(this.#closing||this.#disposed)return;const a=this.#runtime?.activitiesByAgentId[row.agentId];if(this.#runtime?.freshness==='fresh'&&(a&&(a.bindingId!==row.bindingId||a.npcId!==row.npcId)||this.#runtime.missingAgentIds.includes(row.agentId))){this.#journal.forget(row.agentId,row.bindingId);return;}this.#journal.put(row);};
  const lost=()=>this.disconnect();
  this.submission=new TaskSubmissionOwner(client,options.refresh,record);
  this.lifecycle=new ExecutionLifecycleOwner(client,options.refresh,lost,(row,confirmed)=>{if(row.action||this.#journal.hasTask(row))record(!row.action&&!confirmed&&this.#journal.actionForTask(row)==='START'?{...row,action:'START'}:row);if(row.executionId){const value=this.lifecycle.getSnapshot().execution;if(value?.id===row.executionId)this.#invalidate(value.agentId,value.id,value.version);}});
  this.results=new ExecutionResultsOwner(client,lost);
  this.#unsub=[this.submission.subscribe(()=>{if(!client.hasCredential&&!this.#closing&&!this.#suspended){this.disconnect();return;}this.#compose();if(!this.submission.getSnapshot().busy&&!this.#restoring&&!this.#closing&&!this.#suspended)queueMicrotask(()=>{if(!this.#disposed)void this.restore();});this.#emit();}),
   this.lifecycle.subscribe(()=>{this.#compose();const e=this.lifecycle.getSnapshot().execution;if(e)this.#invalidate(e.agentId,e.id,e.version);this.#emit();}),this.results.subscribe(()=>this.#emit())];
 }
 /** @type {(()=>void)[]} */#unsub=[];
 /** @param {()=>void} fn */subscribe(fn){this.#listeners.add(fn);return ()=>{this.#listeners.delete(fn);};}
 #emit(){if(!this.#disposed&&!this.#closing)for(const fn of this.#listeners)try{fn();}catch{/* View isolation. */}}
 getSnapshot(){return Object.freeze({restoring:!!this.#restoring,recoveryMessage:this.#message,journalAvailable:this.#journal.available,connected:this.#client.hasCredential});}
 #compose(){if(this.#composing||this.#closing||this.#disposed)return;this.#composing=true;try{const task=this.submission.getSnapshot();this.lifecycle.select(this.#binding,task.task);const recovery=this.#restoreAction;if(recovery&&task.task?.id===recovery.taskId&&this.#binding?.agentId===recovery.agentId&&this.#binding.bindingId===recovery.bindingId){this.#restoreAction=null;if(recovery.action==='START'||recovery.action==='CANCEL')this.lifecycle.restoreRecovery(recovery.action);}this.results.select(this.#binding,this.lifecycle.getSnapshot().execution);}finally{this.#composing=false;}}
 /** @param {string} agentId @param {string} id @param {number} version */#invalidate(agentId,id,version){const key=`${agentId}/${id}`,prior=this.#seen.get(key);if(prior===String(version))return;this.#seen.set(key,String(version));if(this.#seen.size>80)this.#seen.delete(/** @type {string} */(this.#seen.keys().next().value));this.results.invalidateHistory(agentId,id,version);}
 /** Existing binding notifications carry completed Phase3 sweeps; no new subscriptions or timers are installed. @param {NpcRuntimeBinding|null|undefined} binding @param {RuntimeSnapshot} [runtime] */
 select(binding,runtime){if(this.#disposed||this.#suspended)return;const old=this.#binding,b=binding?.state==='RESOLVED'?binding:null;
  const changed=old?.agentId!==b?.agentId||old?.bindingId!==b?.bindingId||old?.npcId!==b?.npcId;
  if(changed){this.#restoring?.abort();this.#restoring=null;this.#restoreFlight=null;this.#restoreAction=null;this.#message='';}
  this.#binding=b;this.#runtime=runtime;
  if(runtime?.freshness==='fresh')for(const row of this.#journal.list()){const a=runtime.activitiesByAgentId[row.agentId];if(a&&(a.bindingId!==row.bindingId||a.npcId!==row.npcId)||runtime.missingAgentIds.includes(row.agentId)){this.#journal.forget(row.agentId,row.bindingId);this.submission.forgetBinding(row.agentId,row.bindingId);this.lifecycle.forgetBinding(row.agentId,row.bindingId);}}
  if(changed&&b?.agentId&&b.bindingId&&b.npcId&&!this.#journal.find({agentId:b.agentId,bindingId:b.bindingId,npcId:b.npcId}))this.#attempts.set(`${b.agentId}/${b.bindingId}`,3);this.submission.select(b??undefined);this.#compose();
  const stamp=b?.freshness==='fresh'?b.lastSuccessfulSyncAt??'':null,sweep=!!stamp&&stamp!==this.#lastSweep;
  if(stamp)this.#lastSweep=stamp;
  const a=b?.activity,signature=JSON.stringify([b?.agentId,b?.bindingId,a?.currentExecution?.id,a?.currentExecution?.version,a?.lastExecution?.id,a?.lastExecution?.status,a?.recentOutcome?.finishedAt]);
  if(signature!==this.#activitySignature){this.#activitySignature=signature;if(b?.agentId)this.results.invalidateHistory(b.agentId,a?.currentExecution?.id,a?.currentExecution?.version);}
  if(b?.freshness==='fresh'&&this.#client.hasCredential){
   if(old?.freshness!=='fresh'&&!changed){void this.submission.check();void this.lifecycle.refresh();}
   if(changed||sweep)void this.restore();
  }
  this.#emit();
 }
 /** Explicit/manual calls can reset the bounded three-attempt restore budget. No mutation is replayed. @param {boolean} [manual] */
 restore(manual=false){if(this.#restoreFlight)return this.#restoreFlight;const flight=this.#restore(manual);this.#restoreFlight=flight;const release=()=>{if(this.#restoreFlight===flight)this.#restoreFlight=null;};void flight.then(release,release);return flight;}
 /** @param {boolean} manual */async #restore(manual){const b=this.#binding;if(!b?.agentId||!b.bindingId||!b.npcId||b.freshness!=='fresh'||!this.#client.hasCredential||this.#restoring)return;
  const scope={agentId:b.agentId,bindingId:b.bindingId,npcId:b.npcId},key=`${b.agentId}/${b.bindingId}`;if(manual)this.#attempts.delete(key);
  const row=this.#journal.find(scope),state=this.submission.getSnapshot();if(!row||state.task||state.recoverable)return;
  if(state.busy){queueMicrotask(()=>{if(!this.#disposed&&this.#binding===b&&!this.submission.getSnapshot().busy)void this.restore();});return;}
  const attempts=this.#attempts.get(key)??0;if(attempts>=3)return;this.#attempts.set(key,attempts+1);
  const controller=new AbortController(),generation=this.#generation;this.#restoring=controller;this.#restoreAction=row;this.#message='Reauthorizing recovery identifiers; no cached lifecycle or mutation replay.';this.#emit();
  try{
   await this.submission.restore(row,controller.signal);if(controller.signal.aborted||generation!==this.#generation)return;this.#compose();
   await this.lifecycle.refresh();if(controller.signal.aborted||generation!==this.#generation)return;
   this.#message='Recovery lookup completed from authoritative backend data. No mutation was replayed.';this.#attempts.set(key,3);
  }catch(error){if(!controller.signal.aborted&&generation===this.#generation){const code=/** @type {{code?:string}} */(error)?.code;if(['AUTH_REQUIRED','FORBIDDEN','NOT_FOUND'].includes(code??''))this.#journal.forget(scope.agentId,scope.bindingId);this.#message='Recovery read unavailable. Use Restore context to recheck; do not replay an unknown mutation.';}}
  finally{if(this.#restoring===controller){this.#restoring=null;this.#emit();}}
 }
 /** Reconnection clears protected data; only page suspension retains the identifier-only journal. */
 disconnect(preserve=false){if(this.#closing)return;this.#closing=true;this.#generation++;this.#suspended=preserve;this.#restoring?.abort();this.#restoring=null;this.#restoreFlight=null;this.#restoreAction=null;if(!preserve)this.#journal.clear();this.#client.clearCredential();this.submission.disconnect();this.lifecycle.clear();this.results.clear();this.#binding=null;this.#runtime=undefined;this.#lastSweep='';this.#activitySignature='';this.#attempts.clear();this.#seen.clear();this.#message='';this.#closing=false;this.#emit();}
 suspend(){this.disconnect(true);}
 dispose(){if(this.#disposed)return;this.disconnect(this.#suspended);this.#disposed=true;for(const off of this.#unsub)off();this.#unsub=[];this.submission.dispose();this.lifecycle.dispose();this.results.dispose();this.#listeners.clear();}
}
