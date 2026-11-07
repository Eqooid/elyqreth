import { isUUID } from 'class-validator';

export const CITY_ID = 'elyqreth';
export const NPC_MANIFEST_VERSION = 1;
export const NPC_IDS: readonly string[] = Object.freeze(Array.from({length:20},(_,i)=>`resident-slot-${String(i+1).padStart(3,'0')}`));
const messages = Object.freeze({
  INVALID_COMMAND:'Binding command is invalid.', ACCESS_DENIED:'Binding access is disabled.',
  NOT_FOUND:'Binding resource was not found.', CONFLICT:'Binding conflicts with current state.',
  AGENT_UNAVAILABLE:'Agent cannot receive a new binding.', PERSISTENCE_UNAVAILABLE:'Binding persistence is unavailable.',
});
export type BindingErrorCode = keyof typeof messages;
export class BindingError extends Error {
  constructor(readonly code:BindingErrorCode) { super(messages[code]);this.name='BindingError'; }
  toJSON() {return {code:this.code,message:messages[this.code]};}
}
export interface CreateBindingCommand {readonly agentId:string;readonly npcId:string}
export interface RemoveBindingCommand {readonly bindingId:string;readonly revision:string}
export interface ReassignBindingCommand extends CreateBindingCommand,RemoveBindingCommand {}
export interface ListBindingsQuery {readonly limit?:number;readonly after?:string;readonly includeDisabled?:boolean}
export interface BindingResponse {
  readonly id:string;readonly agentId:string;readonly cityId:string;readonly npcId:string;
  readonly enabled:boolean;readonly visualizationMode:'PASSIVE'|'WORK_ACTIVITY';
  readonly createdAt:string;readonly updatedAt:string;readonly revision:string;readonly manifestVersion:number;
}
export function object(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value) as object|null)||
    Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key)))throw new BindingError('INVALID_COMMAND');
  return value as Record<string,unknown>;
}
export function uuid(value:unknown):string {
  if(typeof value!=='string'||!isUUID(value))throw new BindingError('INVALID_COMMAND');return value.toLowerCase();
}
export function npcId(value:unknown):string {
  if(typeof value!=='string'||!NPC_IDS.includes(value))throw new BindingError('INVALID_COMMAND');return value;
}
export function encodeRevision(timestamp:string):string {return 'v1.'+Buffer.from(timestamp,'utf8').toString('base64url');}
export function revision(value:unknown):string {
  if(typeof value!=='string'||value.length>80||!/^v1\.[A-Za-z0-9_-]+$/.test(value))throw new BindingError('INVALID_COMMAND');
  const decoded=Buffer.from(value.slice(3),'base64url').toString('utf8');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(decoded)||encodeRevision(decoded)!==value)
    throw new BindingError('INVALID_COMMAND');
  return value;
}
export function createCommand(value:unknown):CreateBindingCommand {
  const v=object(value,['agentId','npcId']);return {agentId:uuid(v.agentId),npcId:npcId(v.npcId)};
}
export function removeCommand(value:unknown):RemoveBindingCommand {
  const v=object(value,['bindingId','revision']);return {bindingId:uuid(v.bindingId),revision:revision(v.revision)};
}
export function reassignCommand(value:unknown):ReassignBindingCommand {
  const v=object(value,['agentId','npcId','bindingId','revision']);
  return {...createCommand({agentId:v.agentId,npcId:v.npcId}),...removeCommand({bindingId:v.bindingId,revision:v.revision})};
}
export function listQuery(value:unknown):Required<Pick<ListBindingsQuery,'limit'|'includeDisabled'>>&Pick<ListBindingsQuery,'after'> {
  const v=object(value,['limit','after','includeDisabled']),limit=v.limit??20,includeDisabled=v.includeDisabled??false;
  if(!Number.isInteger(limit)||typeof limit!=='number'||limit<1||limit>20||typeof includeDisabled!=='boolean')throw new BindingError('INVALID_COMMAND');
  return {limit,includeDisabled,...(v.after===undefined?{}:{after:uuid(v.after)})};
}
