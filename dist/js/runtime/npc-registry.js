import {validNpcId} from '../npc-identity.js';
/** @import {ResidentSource,NpcIdentity} from './npc-binding.contracts' */

/** Indexes only functional residents supplied by the trusted simulation owner. */
export class NpcIdentityRegistry {
 /** @type {ResidentSource|undefined} */#source;
 #remove;
 /** @type {WeakMap<object,NpcIdentity>} */#entities=new WeakMap();
 /** @type {Map<string,NpcIdentity>} */#slots=new Map();
 /** @type {Set<string>} */#conflicts=new Set();
 /** @type {readonly NpcIdentity[]} */#snapshot=Object.freeze([]);
 /** @type {Set<()=>void>} */#listeners=new Set();
 #disposed=false;
 /** @param {ResidentSource} source */
 constructor(source){this.#source=source;this.refresh();this.#remove=source.subscribeResidents(()=>this.refresh());}
 getSnapshot(){return this.#snapshot;}
 /** @param {object} entity */getForEntity(entity){return this.#entities.get(entity);}
 /** @param {string} npcId */get(npcId){return this.#slots.get(npcId);}
 /** @param {string} npcId */hasConflict(npcId){return this.#conflicts.has(npcId);}
 /** @param {()=>void} listener */
 subscribe(listener){if(this.#disposed)return ()=>{};this.#listeners.add(listener);try{listener();}catch{/* Consumer isolation. */}return ()=>{this.#listeners.delete(listener);};}
 refresh(){
  if(this.#disposed)return;
  /** @type {{entity:object,entityId:number,npcId:string|null}[]} */const candidates=[];
  /** @type {Map<number,number>} */const ids=new Map();
  /** @type {Map<string,number>} */const slots=new Map();
  for(const entity of this.#source?.getResidents()??[]){
   if(!entity||typeof entity!=='object')continue;
   const raw=/** @type {{id?:unknown,decorative?:unknown}} */(entity);if(raw.decorative===true||typeof raw.id!=='number'||!Number.isSafeInteger(raw.id)||raw.id<1)continue;
   const descriptor=Object.getOwnPropertyDescriptor(entity,'npcId');
   const npcId=descriptor&&!descriptor.writable&&!descriptor.configurable&&validNpcId(descriptor.value)?/** @type {string} */(descriptor.value):null;
   candidates.push({entity,entityId:raw.id,npcId});ids.set(raw.id,(ids.get(raw.id)??0)+1);if(npcId)slots.set(npcId,(slots.get(npcId)??0)+1);
  }
  const old=new Map(this.#snapshot.map(n=>[`${n.entityId}:${n.npcId}:${n.ambiguous}`,n]));
  const entities=new WeakMap(),indexed=new Map(),conflicts=new Set();
  const next=candidates.map(c=>{
   const ambiguous=(ids.get(c.entityId)??0)>1||c.npcId!==null&&(slots.get(c.npcId)??0)>1;
   const identity=old.get(`${c.entityId}:${c.npcId}:${ambiguous}`)??Object.freeze({entityId:c.entityId,npcId:c.npcId,ambiguous});
   entities.set(c.entity,identity);
   if(c.npcId){if(ambiguous)conflicts.add(c.npcId);else indexed.set(c.npcId,identity);}return identity;
  });
  for(const slot of conflicts)indexed.delete(slot);
  this.#entities=entities;this.#slots=indexed;this.#conflicts=conflicts;
  if(next.length===this.#snapshot.length&&next.every((n,i)=>n===this.#snapshot[i]))return;
  this.#snapshot=Object.freeze(next);for(const listener of [...this.#listeners]){try{listener();}catch{/* Consumer isolation. */}}
 }
 dispose(){this.#disposed=true;this.#remove();this.#remove=()=>{};this.#source=undefined;this.#listeners.clear();this.#entities=new WeakMap();this.#slots.clear();this.#conflicts.clear();this.#snapshot=Object.freeze([]);}
}
