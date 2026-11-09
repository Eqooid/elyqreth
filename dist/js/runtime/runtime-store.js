import {RuntimeApiError} from './validation.js';
/** @import {AgentActivity,RuntimeSnapshot,SafeError} from './contracts' */
/** Store contains views only: no token, transport, execution policy or simulation objects. */
export class RuntimeActivityStore {
 /** @type {Set<(snapshot:RuntimeSnapshot)=>void>} */#subscribers=new Set();
 /** @type {RuntimeSnapshot} */#state;
 /** @type {Map<string,number>} */#missing=new Map();
 constructor(){this.#state=this.#empty('DISCONNECTED');}
 /** @param {RuntimeSnapshot['phase']} phase @returns {RuntimeSnapshot} */
 #empty(phase){return Object.freeze({phase,activitiesByAgentId:Object.freeze(Object.create(null)),missingAgentIds:Object.freeze([]),
  loading:false,refreshing:false,error:null,freshness:'unknown',stale:true,lastObservedAt:null,lastSuccessfulSyncAt:null});}
 getSnapshot(){return this.#state;}
 /** Missing-on-first-complete-sweep entries are not usable by T05. @param {string} id */
 getAgent(id){return this.#state.missingAgentIds.includes(id)?undefined:this.#state.activitiesByAgentId[id];}
 /** Lookup only; it does not attach to a resident. @param {string} npcId */
 getByNpc(npcId){return Object.values(this.#state.activitiesByAgentId).find(a=>a.npcId===npcId&&!this.#state.missingAgentIds.includes(a.agentId));}
 /** @param {(snapshot:RuntimeSnapshot)=>void} subscriber */
 subscribe(subscriber){this.#subscribers.add(subscriber);try{subscriber(this.#state);}catch{/* Consumer isolation. */}return ()=>{this.#subscribers.delete(subscriber);};}
 /** @param {Partial<RuntimeSnapshot>} patch */
 update(patch){this.#state=Object.freeze({...this.#state,...patch});for(const listener of [...this.#subscribers]){try{listener(this.#state);}catch{/* One consumer cannot break synchronization. */}}}
 dispose(){this.#subscribers.clear();}
 /** @param {RuntimeSnapshot['phase']} [phase] @param {SafeError|null} [error] */
 clear(phase='DISCONNECTED',error=null){this.#missing.clear();this.update({...this.#empty(phase),error});}
 /** @param {readonly AgentActivity[]} items @param {string} observedAt @param {string} receivedAt */
 commit(items,observedAt,receivedAt){
  /** @type {Record<string,AgentActivity>} */const next=Object.create(null);const old=this.#state.activitiesByAgentId;
  // Validate the entire sweep before changing missing-entry counters or publishing.
  // Versions are comparable only for the same persisted entity, never unrelated attempts.
  for(const item of items){const previous=old[item.agentId];if(!previous)continue;
   if(item.agentVersion<previous.agentVersion||
    item.externalObservation?.mappingId&&item.externalObservation.mappingId===previous.externalObservation?.mappingId&&
      item.externalObservation.version<previous.externalObservation.version||
    item.currentTask&&previous.currentTask&&item.currentTask.id===previous.currentTask.id&&item.currentTask.version<previous.currentTask.version||
    item.currentExecution&&previous.currentExecution&&item.currentExecution.id===previous.currentExecution.id&&item.currentExecution.version<previous.currentExecution.version)
    throw new RuntimeApiError('STALE_SNAPSHOT');
  }
  for(const item of items){const previous=old[item.agentId];next[item.agentId]=previous&&JSON.stringify(previous)===JSON.stringify(item)?previous:item;this.#missing.delete(item.agentId);}
  for(const [id,item] of Object.entries(old)){if(!next[id]){const misses=(this.#missing.get(id)??0)+1;if(misses<2){this.#missing.set(id,misses);next[id]=item;}else this.#missing.delete(id);}}
  this.update({phase:'READY',activitiesByAgentId:Object.freeze(next),missingAgentIds:Object.freeze([...this.#missing.keys()]),loading:false,refreshing:false,
   error:null,freshness:'fresh',stale:false,lastObservedAt:observedAt,lastSuccessfulSyncAt:receivedAt});
 }
}
