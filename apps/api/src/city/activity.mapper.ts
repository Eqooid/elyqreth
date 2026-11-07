import { ServiceUnavailableException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { executionTransitions, taskTransitions, ExecutionStatus, TaskStatus } from '../lifecycle/lifecycle-policy';
import { AgentActivityProjection, safeDate } from './activity.contract';
import { NPC_IDS } from './binding.contract';
import { NATIVE_LEASE_MS } from '../runtime/runtime-persistence.service';

function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ServiceUnavailableException();return value as Record<string,unknown>;
}
function id(value:unknown):string {if(typeof value!=='string'||!isUUID(value))throw new ServiceUnavailableException();return value;}
function integer(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new ServiceUnavailableException();return value;}
const taskStatus=(v:unknown):v is TaskStatus=>typeof v==='string'&&Object.hasOwn(taskTransitions,v);
const executionStatus=(v:unknown):v is ExecutionStatus=>typeof v==='string'&&Object.hasOwn(executionTransitions,v);
export function mapAgentActivity(value:unknown,observedAt:string):AgentActivityProjection {
  observedAt=safeDate(observedAt);
  const raw=record(value),a=record(raw.agent),agentId=id(a.id);
  if(typeof a.name!=='string'||a.name.length>160||!['ACTIVE','DISABLED','ARCHIVED'].includes(a.availability as string)||
    !['RULE_BASED','LLM','EXTERNAL'].includes(a.type as string))throw new ServiceUnavailableException();
  const binding=raw.binding===null?null:record(raw.binding);
  if(binding&&!NPC_IDS.includes(binding.npcId as string))throw new ServiceUnavailableException();
  let status:AgentActivityProjection['activityStatus']='IDLE',reason:AgentActivityProjection['statusReason']='NO_ACTIVE_WORK';
  let attention=false,currentTask:AgentActivityProjection['currentTask']=null,currentExecution:AgentActivityProjection['currentExecution']=null;
  const unknown=(r:AgentActivityProjection['statusReason'])=>{status='UNKNOWN';reason=r;attention=true;};
  if(raw.current!==null){
    const t=record(raw.current),e=t.execution===null?null:record(t.execution);
    if(t.agent_id!==agentId||!taskStatus(t.status))unknown('INCONSISTENT_STATE');
    else {
      currentTask={id:id(t.id),status:t.status,version:integer(t.version)};
      let valid=true;
      if(e){
        if(e.agent_id!==agentId||e.task_id!==t.id||!executionStatus(e.status))valid=false;
        else currentExecution={id:id(e.id),status:e.status,version:integer(e.version),attemptNumber:integer(e.attempt_number)};
      }
      if(!valid||(t.status==='RUNNING'&&e?.status!=='RUNNING')||
        (e?.status==='RUNNING'&&t.status!=='RUNNING')||
        (e?.status==='PENDING'&&!['CREATED','QUEUED'].includes(t.status))||
        (e&&['SUCCEEDED','FAILED','CANCELLED','TIMED_OUT'].includes(e.status as string))||
        (integer(t.active_count)>0&&!['PENDING','RUNNING'].includes(e?.status as string)))unknown('INCONSISTENT_STATE');
      else if(t.deadline_at!==null&&Date.parse(safeDate(t.deadline_at))<=Date.parse(observedAt)||
        e?.deadline_at!=null&&Date.parse(safeDate(e.deadline_at))<=Date.parse(observedAt))unknown('DEADLINE_EXPIRED');
      else if(e?.status==='RUNNING'){
        if(e.reconciliation_state!=='NONE')unknown('INCONSISTENT_STATE');
        else if(e.authority!=='NATIVE')unknown('EXTERNAL_LIVENESS_UNVERIFIED');
        else if(e.lease_expires_at===null||e.last_heartbeat_at===null||
          Date.parse(safeDate(e.lease_expires_at))<=Date.parse(observedAt)||Date.parse(safeDate(e.last_heartbeat_at))>Date.parse(observedAt)||
          Date.parse(observedAt)-Date.parse(safeDate(e.last_heartbeat_at))>NATIVE_LEASE_MS)unknown('LEASE_UNVERIFIED');
        else {status='RUNNING';reason='CURRENT_LEASE';}
      } else if(t.status==='QUEUED'||e?.status==='PENDING'){status='QUEUED';reason='PERSISTED_QUEUED';}
      else if(t.status==='CREATED')reason='AWAITING_QUEUE';
      else unknown('INCONSISTENT_STATE');
    }
  }
  let recentOutcome:AgentActivityProjection['recentOutcome']=null;
  if(raw.outcome!==null){
    const o=record(raw.outcome),hasExecution=o.execution_id!==null;
    const outcomeStatus:NonNullable<AgentActivityProjection['recentOutcome']>['status']=o.status==='SUCCEEDED'?'COMPLETED':
      ['FAILED','TIMED_OUT'].includes(o.status as string)?'FAILED':o.status==='CANCELLED'?'CANCELLED':'UNKNOWN';
    const expected=o.status==='SUCCEEDED'?'COMPLETED':o.status==='TIMED_OUT'?'FAILED':o.status;
    const inconsistent=o.agent_id!==agentId||!taskStatus(o.task_status)||outcomeStatus==='UNKNOWN'||
      (['COMPLETED','FAILED','CANCELLED'].includes(o.task_status as string)&&o.task_status!==expected)||
      (o.status==='SUCCEEDED'&&o.task_status!=='COMPLETED');
    if(inconsistent)unknown('INCONSISTENT_STATE');
    recentOutcome={taskId:id(o.task_id),executionId:hasExecution?id(o.execution_id):null,status:inconsistent?'UNKNOWN':outcomeStatus,
      executionStatus:hasExecution&&executionStatus(o.status)?o.status:null,finishedAt:safeDate(o.finished_at)};
  }
  let lastExecution:AgentActivityProjection['lastExecution']=null;
  if(raw.lastExecution!==null){const e=record(raw.lastExecution);
    if(e.agent_id!==agentId||!executionStatus(e.status))unknown('INCONSISTENT_STATE');
    else lastExecution={id:id(e.id),taskId:id(e.task_id),status:e.status};
  }
  const activeCount=integer(raw.activeCount);
  if(activeCount>0&&currentTask===null)unknown('INCONSISTENT_STATE');
  return Object.freeze({schemaVersion:1,agentId,name:a.name,agentType:a.type as AgentActivityProjection['agentType'],
    availability:a.availability as AgentActivityProjection['availability'],agentVersion:integer(a.version),
    npcId:binding?binding.npcId as string:null,bindingId:binding?id(binding.id):null,
    activityStatus:status,statusReason:reason,requiresAttention:attention,currentTask,currentExecution,
    activeExecutionCount:activeCount,queuedTaskCount:integer(raw.queuedCount),createdTaskCount:integer(raw.createdCount),
    recentOutcome,lastExecution,lastActivityAt:safeDate(raw.lastActivityAt),observedAt});
}
