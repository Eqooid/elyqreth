import {localOrigin,accountOrigin} from '../http-transport.js';
import {identifier} from '../validation.js';
import {validNpcId} from '../../npc-identity.js';
/** @typedef {{agentId:string,bindingId:string,npcId:string,taskId?:string,executionId?:string,idempotencyKey?:string,action:'CREATE'|'START'|'CANCEL'|null}} Locator */
/** @typedef {Locator & {savedAt:number,expiresAt:number}} SavedLocator */
export const RECOVERY_STORAGE_KEY='elyqreth.interaction.locators.v1';
const TTL=30*60*1000;
/** @param {unknown} input @returns {Locator} */
function locator(input){
 const r=/** @type {Record<string,unknown>} */(input);if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['agentId','bindingId','npcId','taskId','executionId','idempotencyKey','action'].includes(k)))throw Error('Invalid locator');
 for(const key of ['agentId','bindingId','taskId','executionId'])if(r[key]!==undefined&&identifier(r[key])!==r[key])throw Error('Invalid ID');
 if(!r.agentId||!r.bindingId||!validNpcId(r.npcId)||!['CREATE','START','CANCEL',null].includes(/** @type {string|null} */(r.action))||!r.taskId&&!r.idempotencyKey||r.executionId&&!r.taskId||r.idempotencyKey!==undefined&&(typeof r.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(r.idempotencyKey)))throw Error('Invalid locator');
 return Object.freeze(/** @type {Locator} */(r));
}
/** Identifiers only, untrusted until authorized backend lookup. Never persist credentials, instructions, names, lifecycle values or results. */
export class InteractionRecoveryJournal {
 #origin;#now;#available=true;
 /** @type {Pick<Storage,'getItem'|'setItem'|'removeItem'>|null|undefined} */#storage;
 /** @type {SavedLocator[]} */#rows=[];
 /** @param {string} origin @param {{storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null,now?:()=>number,access?:'account'}} [options] */
 constructor(origin,options={}){this.#origin=options.access==='account'?accountOrigin(origin,origin):localOrigin(origin);this.#now=options.now??Date.now;
  try{this.#storage=options.storage===undefined?globalThis.sessionStorage:options.storage;if(!this.#storage)this.#available=false;const raw=this.#storage?.getItem(RECOVERY_STORAGE_KEY);if(raw){if(raw.length>16384)throw Error('Oversized journal');const data=JSON.parse(raw);if(data.schemaVersion!==1||data.origin!==this.#origin||!Array.isArray(data.rows)||data.rows.length>20||Object.keys(data).some(k=>!['schemaVersion','origin','rows'].includes(k)))throw Error('Invalid journal');
   this.#rows=data.rows.map((/** @type {SavedLocator} */row)=>{const {savedAt,expiresAt,...ids}=row;const value=locator(ids),now=this.#now();if(!Number.isSafeInteger(savedAt)||!Number.isSafeInteger(expiresAt)||expiresAt!==savedAt+TTL||savedAt>now+5000)throw Error('Invalid expiry');return Object.freeze({...value,savedAt,expiresAt});}).filter((/** @type {SavedLocator} */row)=>row.expiresAt>this.#now());
   if(this.#rows.length!==data.rows.length)this.#save();
  }}catch{this.#rows=[];try{this.#storage?.removeItem(RECOVERY_STORAGE_KEY);}catch{this.#available=false;}}
 }
 get available(){return this.#available;}
 list(){return Object.freeze(this.#rows.filter(r=>r.expiresAt>this.#now()));}
 #save(){try{if(!this.#rows.length)this.#storage?.removeItem(RECOVERY_STORAGE_KEY);else this.#storage?.setItem(RECOVERY_STORAGE_KEY,JSON.stringify({schemaVersion:1,origin:this.#origin,rows:this.#rows}));}catch{this.#available=false;}}
 /** @param {Locator} input */put(input){try{const value=locator(input),now=this.#now();this.#rows=this.#rows.filter(r=>r.expiresAt>now);
  const index=this.#rows.findIndex(r=>r.agentId===value.agentId&&r.bindingId===value.bindingId&&r.npcId===value.npcId&&(!!value.taskId&&r.taskId===value.taskId||!!value.idempotencyKey&&r.idempotencyKey===value.idempotencyKey));
  if(index<0&&this.#rows.length>=20){const settled=this.#rows.findIndex(r=>r.action===null);if(settled<0){this.#available=false;return;}this.#rows.splice(settled,1);}
  const prior=index>=0?this.#rows[index]:null,keys=/** @type {(keyof Locator)[]} */(['agentId','bindingId','npcId','taskId','executionId','idempotencyKey','action']);if(prior&&keys.every(k=>value[k]===undefined||value[k]===prior[k]))return;
  const changedIntent=!prior||value.action!==null&&value.action!==prior.action||prior.action==='CREATE'&&!!value.taskId;
  const savedAt=changedIntent?now:/** @type {SavedLocator} */(prior).savedAt,row=Object.freeze({...prior,...value,savedAt,expiresAt:savedAt+TTL});if(index>=0)this.#rows[index]=row;else this.#rows.push(row);this.#save();
 }catch{this.#available=false;}}
 /** @param {{agentId:string,bindingId:string,npcId:string}} scope */find(scope){return this.#rows.filter(r=>r.expiresAt>this.#now()&&r.agentId===scope.agentId&&r.bindingId===scope.bindingId&&r.npcId===scope.npcId).sort((a,b)=>Number(!!b.action)-Number(!!a.action)||b.savedAt-a.savedAt)[0]??null;}
 /** @param {Locator} row */hasTask(row){return this.#rows.some(r=>r.agentId===row.agentId&&r.bindingId===row.bindingId&&r.npcId===row.npcId&&r.taskId===row.taskId);}
 /** @param {Locator} row */actionForTask(row){return this.#rows.find(r=>r.agentId===row.agentId&&r.bindingId===row.bindingId&&r.npcId===row.npcId&&r.taskId===row.taskId)?.action??null;}
 /** @param {string} agentId @param {string} bindingId */forget(agentId,bindingId){this.#rows=this.#rows.filter(r=>r.agentId!==agentId||r.bindingId!==bindingId);this.#save();}
 clear(){this.#rows=[];try{this.#storage?.removeItem(RECOVERY_STORAGE_KEY);}catch{this.#available=false;}}
}
