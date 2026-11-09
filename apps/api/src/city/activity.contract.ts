import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { TaskStatus, ExecutionStatus } from '../lifecycle/lifecycle-policy';

export type ActivityStatus='IDLE'|'QUEUED'|'RUNNING'|'UNKNOWN';
export interface ExternalActivityObservation {
  readonly source: 'Hermes'; readonly connectionId: string; readonly connectionName: string;
  readonly externalAgentId: string; readonly externalExecutionId: string | null;
  readonly mappingId: string | null; readonly version: number;
  readonly status: 'UNKNOWN'|'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED'; readonly sourceStatus: string | null;
  readonly observedAt: string | null; readonly lastSynchronizedAt: string | null;
  readonly freshness: 'UNKNOWN'|'RECENT_OBSERVATION'|'STALE'|'RETIRED'; readonly connectionHealth: 'UNKNOWN'|'DISABLED';
}
export interface ActivityQuery {readonly limit:number;readonly after?:string;readonly ids?:readonly string[];readonly boundOnly:boolean}
export interface AgentActivityProjection {
  readonly externalObservation?: ExternalActivityObservation;
  readonly schemaVersion:1;readonly agentId:string;readonly name:string;readonly agentType:'RULE_BASED'|'LLM'|'EXTERNAL';
  readonly availability:'ACTIVE'|'DISABLED'|'ARCHIVED';readonly agentVersion:number;
  readonly npcId:string|null;readonly bindingId:string|null;readonly activityStatus:ActivityStatus;
  readonly currentTask:{id:string;status:TaskStatus;version:number}|null;
  readonly currentExecution:{id:string;status:ExecutionStatus;version:number;attemptNumber:number}|null;
  readonly activeExecutionCount:number;readonly queuedTaskCount:number;readonly createdTaskCount:number;
  readonly recentOutcome:{taskId:string;executionId:string|null;status:'COMPLETED'|'FAILED'|'CANCELLED'|'UNKNOWN';
    executionStatus:ExecutionStatus|null;finishedAt:string}|null;
  readonly lastExecution:{id:string;taskId:string;status:ExecutionStatus}|null;
  readonly lastActivityAt:string;readonly observedAt:string;readonly requiresAttention:boolean;
  readonly statusReason:'NO_ACTIVE_WORK'|'AWAITING_QUEUE'|'PERSISTED_QUEUED'|'CURRENT_LEASE'|'INCONSISTENT_STATE'|
    'DEADLINE_EXPIRED'|'LEASE_UNVERIFIED'|'EXTERNAL_LIVENESS_UNVERIFIED';
}
export interface ActivityPage {readonly schemaVersion:1;readonly observedAt:string;readonly items:readonly AgentActivityProjection[];readonly nextCursor:string|null}
export function agentIdentifier(value:unknown):string {
  if(typeof value!=='string'||!isUUID(value))throw new BadRequestException();return value.toLowerCase();
}
export function activityQuery(value:unknown):ActivityQuery {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value) as object|null))throw new BadRequestException();
  const q=value as Record<string,unknown>;
  if(Reflect.ownKeys(q).some(k=>typeof k!=='string'||!['limit','after','ids','boundOnly'].includes(k)))throw new BadRequestException();
  const limit=q.limit??'20';
  if(typeof limit!=='string'||!/^\d{1,2}$/.test(limit)||Number(limit)<1||Number(limit)>20)throw new BadRequestException();
  if(q.boundOnly!==undefined&&!['true','false'].includes(q.boundOnly as string))throw new BadRequestException();
  let ids:string[]|undefined;
  if(q.ids!==undefined){
    if(typeof q.ids!=='string'||q.ids.length>739)throw new BadRequestException();
    ids=q.ids.split(',').map(agentIdentifier);if(ids.length>20||new Set(ids).size!==ids.length)throw new BadRequestException();
  }
  return {limit:Number(limit),boundOnly:q.boundOnly==='true',...(q.after===undefined?{}:{after:agentIdentifier(q.after)}),...(ids?{ids}:{})};
}
export function safeDate(value:unknown):string {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new ServiceUnavailableException();return new Date(value).toISOString();
}
