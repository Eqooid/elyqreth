/** @import {NpcRuntimeBinding} from './npc-binding.contracts' */
/** @typedef {'IDLE'|'RUNNING'|'WAITING'|'COMPLETED'|'FAILED'|'CANCELLED'|'STALE'|'UNKNOWN'|'UNAVAILABLE'} VisualStatus */
/** Central presentation definitions; these are not runtime lifecycle states. */
export const NPC_VISUALS=Object.freeze({
 IDLE:Object.freeze({status:'IDLE',label:'Idle',glyph:'',color:'#B8DDF5'}),
 RUNNING:Object.freeze({status:'RUNNING',label:'Running (persisted state)',glyph:'>',color:'#B8DDF5'}),
 WAITING:Object.freeze({status:'WAITING',label:'Waiting',glyph:'=',color:'#B8DDF5'}),
 COMPLETED:Object.freeze({status:'COMPLETED',label:'Recently completed',glyph:'+',color:'#A4D5BA'}),
 FAILED:Object.freeze({status:'FAILED',label:'Last outcome failed',glyph:'!',color:'#FF809B'}),
 CANCELLED:Object.freeze({status:'CANCELLED',label:'Last outcome cancelled',glyph:'-',color:'#B5C3D0'}),
 STALE:Object.freeze({status:'STALE',label:'Stale connection data',glyph:'~',color:'#B5C3D0'}),
 UNKNOWN:Object.freeze({status:'UNKNOWN',label:'Unknown activity',glyph:'?',color:'#B5C3D0'}),
 UNAVAILABLE:Object.freeze({status:'UNAVAILABLE',label:'Agent association unavailable',glyph:'?',color:'#B5C3D0'})
});
/** @param {NpcRuntimeBinding|undefined} binding @param {boolean} [showCompletion] */
export function visualForBinding(binding,showCompletion=false){
 if(!binding||binding.state==='UNBOUND'||binding.state==='UNRESOLVED_NPC')return null;
 if(binding.state==='UNAVAILABLE_AGENT')return NPC_VISUALS.UNAVAILABLE;
 if(binding.state!=='RESOLVED'||!binding.activity)return NPC_VISUALS.UNKNOWN;
 if(binding.freshness!=='fresh')return binding.freshness==='stale'?NPC_VISUALS.STALE:NPC_VISUALS.UNKNOWN;
 const a=binding.activity;
 if(a.availability!=='ACTIVE')return NPC_VISUALS.UNAVAILABLE;
 if(a.externalObservation){
  const external=a.externalObservation;
  if(external.freshness==='STALE')return NPC_VISUALS.STALE;
  if(external.freshness!=='RECENT_OBSERVATION')return NPC_VISUALS.UNKNOWN;
  if(external.sourceStatus==='waiting_for_approval'||external.status==='QUEUED')return NPC_VISUALS.WAITING;
  if(external.sourceStatus==='running'&&external.status==='RUNNING')return NPC_VISUALS.RUNNING;
  if(external.status==='FAILED')return NPC_VISUALS.FAILED;
  if(external.status==='CANCELLED')return NPC_VISUALS.CANCELLED;
  if(external.status==='COMPLETED')return NPC_VISUALS.COMPLETED;
  return NPC_VISUALS.UNKNOWN;
 }
 if(a.activityStatus==='RUNNING')return NPC_VISUALS.RUNNING;
 if(a.activityStatus==='QUEUED')return NPC_VISUALS.WAITING;
 if(a.activityStatus!=='IDLE')return NPC_VISUALS.UNKNOWN;
 if(a.recentOutcome?.status==='FAILED')return NPC_VISUALS.FAILED;
 if(a.recentOutcome?.status==='CANCELLED')return NPC_VISUALS.CANCELLED;
 return showCompletion&&a.recentOutcome?.status==='COMPLETED'?NPC_VISUALS.COMPLETED:NPC_VISUALS.IDLE;
}
/** One subscription, bounded by current bindings. No timers or network, no NPC mutation.
 * @param {ReturnType<import('./npc-runtime-binding.js').createNpcRuntimeBindings>['view']} bindings
 * @param {()=>number} [now] monotonic milliseconds
 */
export function createNpcStatusPresentation(bindings,now=()=>performance.now()){
 /** @type {Map<string,{key:string,until:number}>} */const outcomes=new Map();
 let disposed=false;
 const off=bindings.subscribe(snapshot=>{
  // First missing sweep hides the association but retains its authorized record.
  // Keep only existing suppression keys through that uncertainty; auth/confirmed
  // removal empties the store and clears them. Never create a visual for it.
  const retained=new Set(Object.values(snapshot.runtime.activitiesByAgentId).map(a=>a.bindingId).filter(Boolean));
  for(const b of snapshot.linked){
   if(!b.agentId||!b.bindingId)continue;const id=b.bindingId;retained.add(id);
   const o=b.activity?.recentOutcome;if(!o)continue;
   const key=`${o.executionId??o.taskId}:${o.status}:${o.finishedAt}`;
   if(outcomes.get(id)?.key===key)continue;
   const age=Date.parse(b.observedAt??'')-Date.parse(o.finishedAt);
   outcomes.set(id,{key,until:now()+(Number.isFinite(age)&&age>=0?Math.max(0,5000-age):0)});
  }
  for(const id of outcomes.keys())if(!retained.has(id))outcomes.delete(id);
 });
 return Object.freeze({
  /** @param {object} entity */getForEntity(entity){
   if(disposed)return null;const b=bindings.getForEntity(entity),deadline=b?.bindingId?outcomes.get(b.bindingId)?.until:undefined;
   return visualForBinding(b,deadline!==undefined&&now()<deadline);
  },
  dispose(){if(disposed)return;disposed=true;off();outcomes.clear();}
 });
}
