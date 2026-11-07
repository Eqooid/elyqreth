import type {AgentActivity,RuntimeSnapshot} from './contracts';
export interface ResidentSource {
 getResidents():readonly object[];
 subscribeResidents(listener:()=>void):()=>void;
}
export interface NpcIdentity {readonly entityId:number;readonly npcId:string|null;readonly ambiguous:boolean}
export interface NpcRuntimeBinding {
 readonly agentId:string|null;readonly npcId:string|null;readonly bindingId:string|null;
 readonly state:'RESOLVED'|'UNRESOLVED_NPC'|'UNBOUND'|'UNAVAILABLE_AGENT'|'UNKNOWN';
 readonly reason:'NONE'|'NO_AUTHORIZED_BINDING'|'NPC_NOT_PRESENT'|'DUPLICATE_IDENTITY'|'DUPLICATE_BINDING'|'INVALID_BINDING'|'PENDING_REMOVAL';
 readonly npc:NpcIdentity|null;readonly activity:AgentActivity|null;
 readonly freshness:RuntimeSnapshot['freshness'];readonly observedAt:string|null;readonly lastSuccessfulSyncAt:string|null;
}
export interface NpcBindingSnapshot {
 readonly disposed:boolean;
 readonly runtime:RuntimeSnapshot;
 readonly byAgent:Readonly<Record<string,NpcRuntimeBinding>>;
 readonly byNpc:Readonly<Record<string,NpcRuntimeBinding>>;
 readonly linked:readonly NpcRuntimeBinding[];
 readonly unresolved:readonly NpcRuntimeBinding[];
}
