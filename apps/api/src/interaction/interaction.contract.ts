import { BadRequestException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import type { serializeTask } from '../tasks/tasks.service';
import type { serializeExecution } from '../executions/executions.service';
import type { serializeAgent } from '../agents/agents.service';
import type { CreateTaskDto } from '../tasks/dto/task.dto';
import type { ExecutionResultResponse, RuntimeExecutionResponse } from '../runtime/http/runtime.dto';
import type { RuntimeExecutionResult } from '../runtime/contracts/execution-result.contract';

export interface InteractionEligibility {readonly canCreateTask:boolean;readonly canRequestStart:boolean;readonly canRequestCancel:boolean;
 readonly reason:'INVALID_STATE'|'NOT_SUPPORTED'|'UNAVAILABLE'|null}
export type InteractionTask=ReturnType<typeof serializeTask>&{actionEligibility:InteractionEligibility};
export type InteractionExecution=ReturnType<typeof serializeExecution>&{actionEligibility:InteractionEligibility};
export type InteractionAgent=ReturnType<typeof serializeAgent>&{actionEligibility:InteractionEligibility};
export type InteractionCreateTask=Omit<CreateTaskDto,'idempotencyKey'>&{idempotencyKey:string};
export type InteractionResult=Omit<RuntimeExecutionResult,'provider'>;
export type InteractionResultResponse=Omit<ExecutionResultResponse,'result'>&{result:InteractionResult|null;displayReason?:'DISCLOSURE_RESTRICTED'};
export type InteractionStartResponse=Omit<RuntimeExecutionResponse,'result'>&{result:InteractionResult|null;displayReason?:'DISCLOSURE_RESTRICTED'};
export interface InteractionCancellationResponse {readonly task:ReturnType<typeof serializeTask>;readonly execution:ReturnType<typeof serializeExecution>|null}
export interface InteractionErrorResponse {readonly statusCode:number;readonly code?:string;readonly message:string;readonly requestId?:string}
export interface IntentLookup {readonly task:ReturnType<typeof serializeTask>|null}
export interface AgentExecutionHistory {readonly items:readonly ReturnType<typeof serializeExecution>[];readonly pagination:{readonly limit:number;readonly nextCursor:string|null}}
export function uuid(value:unknown):string {if(typeof value!=='string'||!isUUID(value))throw new BadRequestException();return value.toLowerCase();}
export function historyQuery(query:Record<string,unknown>,agentId:string):{limit:number;boundary?:{stamp:string;id:string}} {
 if(Object.keys(query).some(k=>!['limit','before'].includes(k)))throw new BadRequestException();
 const limit=query.limit??'10';if(typeof limit!=='string'||!/^\d{1,2}$/.test(limit)||Number(limit)<1||Number(limit)>20)throw new BadRequestException();
 if(query.before===undefined)return {limit:Number(limit)};
 try{if(typeof query.before!=='string'||query.before.length>256||!/^v1\.[A-Za-z0-9_-]+$/.test(query.before))throw 0;
  const text=Buffer.from(query.before.slice(3),'base64url').toString('utf8');if('v1.'+Buffer.from(text).toString('base64url')!==query.before)throw 0;
  const value:unknown=JSON.parse(text);if(!Array.isArray(value)||value.length!==3||value[0]!==agentId||typeof value[1]!=='string'||
   !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value[1])||!isISO8601(value[1],{strict:true,strictSeparator:true}))throw 0;
  return {limit:Number(limit),boundary:{stamp:value[1],id:uuid(value[2])}};
 }catch{throw new BadRequestException();}
}
export function historyCursor(agentId:string,stamp:string,id:string):string {return 'v1.'+Buffer.from(JSON.stringify([agentId,stamp,id])).toString('base64url');}
