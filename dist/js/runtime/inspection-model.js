/** @import {NpcRuntimeBinding} from './npc-binding.contracts' */
/** @import {RuntimeSnapshot} from './contracts' */
/** @typedef {Readonly<{id:string,taskId:string,status:string,current:boolean,latest:boolean,attemptNumber:number|null,finishedAt:string|null,taskStatus:string|null}>} InspectionExecution */
const executionStates=new Set(['PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT']);
const taskStates=new Set(['CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED']);
/** Safe presentation fallback, not lifecycle logic. @param {unknown} value @param {Set<string>} states */
const status=(value,states)=>typeof value==='string'&&states.has(value)?value:'UNKNOWN';
/** @param {unknown} value */
export function recordedTimestamp(value){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;
 try{return new Date(value).toISOString()===value?value:null;}catch{return null;}
}
/** At most three authorized projection references, not a client history store.
 * @param {NpcRuntimeBinding|undefined} binding */
export function inspectionExecutions(binding){
 if(binding?.state!=='RESOLVED'||!binding.activity)return Object.freeze([]);
 const a=binding.activity;
 /** @type {Map<string,InspectionExecution>} */const rows=new Map();
 if(a.currentExecution&&a.currentTask)rows.set(a.currentExecution.id,Object.freeze({id:a.currentExecution.id,taskId:a.currentTask.id,
  status:status(a.currentExecution.status,executionStates),current:true,latest:a.lastExecution?.id===a.currentExecution.id,
  attemptNumber:a.currentExecution.attemptNumber,finishedAt:null,taskStatus:status(a.currentTask.status,taskStates)}));
 const o=a.recentOutcome;
 if(o?.executionId&&!rows.has(o.executionId))rows.set(o.executionId,Object.freeze({id:o.executionId,taskId:o.taskId,
  status:status(o.executionStatus,executionStates),current:false,latest:a.lastExecution?.id===o.executionId,attemptNumber:null,
  finishedAt:recordedTimestamp(o.finishedAt),taskStatus:status(o.status,taskStates)}));
 const last=a.lastExecution;
 if(last&&!rows.has(last.id))rows.set(last.id,Object.freeze({id:last.id,taskId:last.taskId,status:status(last.status,executionStates),
  current:false,latest:true,attemptNumber:null,finishedAt:null,taskStatus:null}));
 return Object.freeze([...rows.values()].sort((a,b)=>Number(b.current)-Number(a.current)||Number(b.latest)-Number(a.latest)||a.id.localeCompare(b.id)));
}
/** Only recentOutcome is a timestamped lifecycle fact; never invent audit events.
 * @param {NpcRuntimeBinding|undefined} binding */
export function inspectionTimeline(binding){
 if(binding?.state!=='RESOLVED'||!binding.activity?.recentOutcome)return Object.freeze([]);
 const o=binding.activity.recentOutcome,time=recordedTimestamp(o.finishedAt);if(!time)return Object.freeze([]);
 const label=({COMPLETED:'Task completed',FAILED:'Task failed',CANCELLED:'Task cancelled',UNKNOWN:'Task outcome unknown'})[o.status]??'Task outcome unknown';
 return Object.freeze([Object.freeze({key:`${o.executionId??o.taskId}:${o.status}:${time}`,label,time,taskId:o.taskId,executionId:o.executionId})]);
}
/** @param {RuntimeSnapshot|undefined} runtime @param {NpcRuntimeBinding|undefined} binding */
export function inspectionConnection(runtime,binding){
 if(runtime?.phase==='AUTH_REQUIRED'||runtime?.error?.code==='AUTH_REQUIRED'||runtime?.error?.code==='FORBIDDEN')return 'Authorization unavailable; protected data cleared.';
 if(runtime?.loading)return 'Loading authorized Agent activity.';
 if(runtime?.phase==='DISCONNECTED')return 'Runtime disconnected.';
 if(runtime?.error)return 'Runtime synchronization unavailable; retained data may be stale.';
 if(binding?.state==='UNAVAILABLE_AGENT')return 'Agent association unavailable.';
 if(binding?.freshness!=='fresh')return 'Recorded data is stale or freshness is unknown.';
 if(runtime?.refreshing)return 'Refreshing recorded backend activity.';
 if(runtime?.phase==='PAUSED')return 'Synchronization paused; showing recorded data.';
 return 'Freshly synchronized recorded backend activity; process liveness is not guaranteed.';
}
/** Selection state only: no data cache, subscriptions, timers or transport. */
export class NpcInspectionSelection {
 #scope='';#selected='';#hadAssociation=false;
 clear(){this.clearProtected();this.#hadAssociation=false;}
 clearProtected(){this.#scope='';this.#selected='';}
 hadAssociation(){return this.#hadAssociation;}
 /** @param {NpcRuntimeBinding|undefined} binding */
 #identity(binding){return binding?.state==='RESOLVED'?`${binding.npc?.entityId}:${binding.npcId}:${binding.agentId}:${binding.bindingId}`:'';}
 /** @param {NpcRuntimeBinding|undefined} binding */
 read(binding){const scope=this.#identity(binding);if(scope!==this.#scope){this.clearProtected();this.#scope=scope;}
  this.#hadAssociation=Boolean(scope);
  const executions=inspectionExecutions(binding),selected=executions.find(e=>e.id===this.#selected)??executions[0]??null;
  this.#selected=selected?.id??'';
  return Object.freeze({scope,executions,selected,timeline:inspectionTimeline(binding)});
 }
 /** Membership is verified against current authorized data, never DOM claims.
  * @param {NpcRuntimeBinding|undefined} binding @param {string} id */
 select(binding,id){const model=this.read(binding);if(!model.scope||!model.executions.some(e=>e.id===id))return false;this.#selected=id;return true;}
}
