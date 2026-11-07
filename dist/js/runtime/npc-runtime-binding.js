import {NpcIdentityRegistry} from './npc-registry.js';
import {validNpcId} from '../npc-identity.js';
import {identifier} from './validation.js';
/** @import {RuntimeView,RuntimeSnapshot,AgentActivity} from './contracts' */
/** @import {ResidentSource,NpcIdentity,NpcRuntimeBinding,NpcBindingSnapshot} from './npc-binding.contracts' */

/** @param {unknown} value */
function uuid(value){try{return identifier(value)===value;}catch{return false;}}
/** @param {NpcRuntimeBinding|undefined} old @param {NpcRuntimeBinding} next */
function shared(old,next){return old&&Object.keys(next).every(key=>old[/** @type {keyof NpcRuntimeBinding} */(key)]===next[/** @type {keyof NpcRuntimeBinding} */(key)])?old:Object.freeze(next);}

/** Derived indexes only. No timers, fetch, lifecycle mutation or NPC mutation. */
class NpcRuntimeBindingOwner {
 #registry;#runtime;#offRuntime;#offNpcs;#disposed=false;
 /** @type {NpcBindingSnapshot} */#snapshot;
 /** @type {readonly NpcIdentity[]|undefined} */#lastNpcs;
 /** @type {Set<(snapshot:NpcBindingSnapshot)=>void>} */#listeners=new Set();
 /** @type {Map<NpcIdentity,NpcRuntimeBinding>} */#unbound=new Map();
 /** @param {RuntimeView} runtimeView @param {ResidentSource} source */
 constructor(runtimeView,source){
  this.#registry=new NpcIdentityRegistry(source);this.#runtime=runtimeView.getSnapshot();
  this.#snapshot=Object.freeze({disposed:false,runtime:this.#runtime,byAgent:Object.freeze(Object.create(null)),byNpc:Object.freeze(Object.create(null)),linked:Object.freeze([]),unresolved:Object.freeze([])});
  this.#reconcile();
  this.#offRuntime=runtimeView.subscribe(snapshot=>{if(this.#disposed)return;this.#runtime=snapshot;this.#reconcile();});
  this.#offNpcs=this.#registry.subscribe(()=>this.#reconcile());
 }
 getSnapshot(){return this.#snapshot;}
 /** @param {string} id */getByAgent(id){return this.#snapshot.byAgent[id];}
 /** @param {string} id */getByNpc(id){return this.#snapshot.byNpc[id];}
 /** Entity must be registered by the trusted functional resident source; its Agent metadata is ignored. @param {object} entity */
 getForEntity(entity){
  const npc=this.#registry.getForEntity(entity);if(!npc)return undefined;
  return npc.npcId?this.#snapshot.byNpc[npc.npcId]??this.#unbound.get(npc):this.#unbound.get(npc);
 }
 /** @param {string} npcId */getActivityForNpc(npcId){const record=this.getByNpc(npcId);return record?.state==='RESOLVED'?record.activity??undefined:undefined;}
 /** @param {string} npcId */isLinked(npcId){return this.getByNpc(npcId)?.state==='RESOLVED';}
 listLinked(){return this.#snapshot.linked;}
 /** @param {(snapshot:NpcBindingSnapshot)=>void} listener */
 subscribe(listener){if(this.#disposed)return ()=>{};this.#listeners.add(listener);try{listener(this.#snapshot);}catch{/* Consumer isolation. */}return ()=>{this.#listeners.delete(listener);};}
 reconcileNpcs(){this.#registry.refresh();}
 #reconcile(){
  if(this.#disposed)return;
  const npcs=this.#registry.getSnapshot(),runtime=this.#runtime,old=this.#snapshot;
  if(old.runtime===runtime&&this.#lastNpcs===npcs)return;this.#lastNpcs=npcs;
  /** @type {Record<string,NpcRuntimeBinding>} */const byAgent=Object.create(null),byNpc=Object.create(null);
  const missing=new Set(runtime.missingAgentIds),conflicts=new Set(),bindingOwners=new Map(),npcOwners=new Map(),pendingSlots=new Set(),invalidSlots=new Set();
  /** @type {{id:string,activity:AgentActivity,valid:boolean}[]} */const candidates=[];
  for(const [id,activity] of Object.entries(runtime.activitiesByAgentId)){
   if(missing.has(id)){if(validNpcId(activity.npcId))pendingSlots.add(activity.npcId);continue;}
   if(!uuid(id)||activity.agentId!==id)continue;
   const valid=activity.npcId===null&&activity.bindingId===null||validNpcId(activity.npcId)&&uuid(activity.bindingId);
   candidates.push({id,activity,valid});
   if(!valid){conflicts.add(id);if(validNpcId(activity.npcId))invalidSlots.add(activity.npcId);continue;}
   if(activity.npcId&&activity.bindingId){
    const priorNpc=npcOwners.get(activity.npcId),priorBinding=bindingOwners.get(activity.bindingId);
    if(priorNpc){conflicts.add(id);conflicts.add(priorNpc);}if(priorBinding){conflicts.add(id);conflicts.add(priorBinding);}
    npcOwners.set(activity.npcId,id);bindingOwners.set(activity.bindingId,id);
   }
  }
  for(const c of candidates)if(c.activity.npcId&&invalidSlots.has(c.activity.npcId))conflicts.add(c.id);
  /** @param {string|null} agentId @param {string|null} npcId @param {string|null} bindingId @param {NpcIdentity|null} npc @param {AgentActivity|null} activity @param {NpcRuntimeBinding['state']} state @param {NpcRuntimeBinding['reason']} reason @returns {NpcRuntimeBinding} */
  const record=(agentId,npcId,bindingId,npc,activity,state,reason)=>({agentId,npcId,bindingId,npc,activity,state,reason,
   freshness:runtime.freshness,observedAt:activity?.observedAt??null,lastSuccessfulSyncAt:runtime.lastSuccessfulSyncAt});
  for(const c of candidates){
   const a=c.activity,npcId=validNpcId(a.npcId)?a.npcId:null,npc=npcId?this.#registry.get(npcId)??null:null;
   let state=/** @type {NpcRuntimeBinding['state']} */('UNBOUND'),reason=/** @type {NpcRuntimeBinding['reason']} */('NO_AUTHORIZED_BINDING');
   if(conflicts.has(c.id)){state='UNKNOWN';reason=c.valid?'DUPLICATE_BINDING':'INVALID_BINDING';}
   else if(npcId&&this.#registry.hasConflict(npcId)){state='UNKNOWN';reason='DUPLICATE_IDENTITY';}
   else if(npcId){state=npc?'RESOLVED':'UNRESOLVED_NPC';reason=npc?'NONE':'NPC_NOT_PRESENT';}
   byAgent[c.id]=shared(old.byAgent[c.id],record(c.id,npcId,state==='UNKNOWN'?null:a.bindingId,state==='UNKNOWN'?null:npc,
    state==='UNKNOWN'?null:a,state,reason));
  }
  for(const candidate of candidates){const b=byAgent[candidate.id];if(!b?.npcId)continue;
   if(b.state==='UNKNOWN')byNpc[b.npcId]=shared(old.byNpc[b.npcId],record(null,b.npcId,null,this.#registry.get(b.npcId)??null,null,'UNKNOWN',b.reason));
   else if(!byNpc[b.npcId])byNpc[b.npcId]=b;
  }
  const nextUnbound=new Map();
  for(const npc of npcs){
   const pending=npc.npcId!==null&&pendingSlots.has(npc.npcId);
   const state=npc.ambiguous?'UNKNOWN':pending?'UNAVAILABLE_AGENT':'UNBOUND';
   const reason=npc.ambiguous?'DUPLICATE_IDENTITY':pending?'PENDING_REMOVAL':'NO_AUTHORIZED_BINDING';
   const fallback=shared(this.#unbound.get(npc),record(null,npc.npcId,null,npc,null,state,reason));nextUnbound.set(npc,fallback);
   if(npc.npcId&&!byNpc[npc.npcId])byNpc[npc.npcId]=shared(old.byNpc[npc.npcId],fallback);
  }
  this.#unbound=nextUnbound;
  const linked=Object.freeze(Object.values(byAgent).filter(b=>b.state==='RESOLVED').sort((a,b)=>(a.npcId??'')<(b.npcId??'')?-1:(a.npcId??'')>(b.npcId??'')?1:0));
  const unresolved=Object.freeze(Object.values(byAgent).filter(b=>b.state!=='RESOLVED').sort((a,b)=>(a.agentId??'')<(b.agentId??'')?-1:(a.agentId??'')>(b.agentId??'')?1:0));
  this.#snapshot=Object.freeze({disposed:false,runtime,byAgent:Object.freeze(byAgent),byNpc:Object.freeze(byNpc),linked,unresolved});
  for(const listener of [...this.#listeners]){try{listener(this.#snapshot);}catch{/* Consumer isolation. */}}
 }
 dispose(){
  if(this.#disposed)return;this.#disposed=true;this.#offRuntime();this.#offNpcs();this.#registry.dispose();this.#unbound.clear();
  this.#offRuntime=()=>{};this.#offNpcs=()=>{};this.#lastNpcs=undefined;
  this.#listeners.clear();
  // Read methods on a retained disposed facade reveal no former associations.
  this.#runtime=Object.freeze({...this.#runtime,phase:'DISCONNECTED',loading:false,refreshing:false,error:null,freshness:'unknown',stale:true,
   lastObservedAt:null,lastSuccessfulSyncAt:null,activitiesByAgentId:Object.freeze(Object.create(null)),missingAgentIds:Object.freeze([])});
  this.#snapshot=Object.freeze({disposed:true,runtime:this.#runtime,
   byAgent:Object.freeze(Object.create(null)),byNpc:Object.freeze(Object.create(null)),linked:Object.freeze([]),unresolved:Object.freeze([])});
 }
}
/** @param {RuntimeView} runtimeView @param {ResidentSource} source */
export function createNpcRuntimeBindings(runtimeView,source){
 const owner=new NpcRuntimeBindingOwner(runtimeView,source);
 const view=Object.freeze({getSnapshot:owner.getSnapshot.bind(owner),getByAgent:owner.getByAgent.bind(owner),getByNpc:owner.getByNpc.bind(owner),
  getForEntity:owner.getForEntity.bind(owner),getActivityForNpc:owner.getActivityForNpc.bind(owner),isLinked:owner.isLinked.bind(owner),
  listLinked:owner.listLinked.bind(owner),subscribe:owner.subscribe.bind(owner)});
 return Object.freeze({view,reconcileNpcs:owner.reconcileNpcs.bind(owner),dispose:owner.dispose.bind(owner)});
}
