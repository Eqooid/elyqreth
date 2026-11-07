import { operationalMode } from '../../auth/principal';
﻿import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { ApiConfig } from '../../config/config.module';
import { ApiLogger } from '../../common/api-logger';
import { safePersistence } from '../../common/persistence';
import { isLoopback } from '../../agents/registry-configuration';
import { DatabaseService } from '../../database/database.module';
import { executions, executionResults, tasks } from '../../database/schema';
import { TasksService } from '../../tasks/tasks.service';
import { serializeExecution } from '../../executions/executions.service';
import { TaskLifecycleService } from '../../lifecycle/task-lifecycle.service';
import { LifecycleError } from '../../lifecycle/lifecycle-policy';
import { RuntimeCoordinator } from '../runtime-coordinator';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { parseRuntimeSnapshot } from '../contracts/runtime-snapshot';
import { createRuntimeExecutionRequest } from '../contracts/execution-request.contract';
import { createRuntimeExecutionResult } from '../contracts/execution-result.contract';
import type { ExecutionResultResponse, RuntimeExecutionResponse, TaskRuntimeStatusResponse } from './runtime.dto';

@Injectable()
export class RuntimeApiService {
  constructor(private readonly config:ApiConfig,private readonly database:DatabaseService,
    private readonly taskReads:TasksService,private readonly coordinator:RuntimeCoordinator,
    private readonly lifecycle:TaskLifecycleService,private readonly logger:ApiLogger) {}
  private log(event:string,fields:Record<string,unknown>):void {
    try { this.logger.info(event,fields); } catch { /* Telemetry does not decide committed lifecycle outcomes. */ }
  }
  private settings() {
    const c=this.config.value;
    if(!c.runtime||!c.registry||!c.database||!operationalMode(c))throw new NotFoundException();
    return {ownerId:c.registry.ownerId,bindings:c.runtime.bindings};
  }
  private allow(agentId:string,orchestratorId:string) {
    if(!this.settings().bindings.some(b=>b.agentId===agentId&&b.orchestratorId===orchestratorId))throw new RuntimeError('ACCESS_DENIED','request');
  }
  private async latest(taskId:string) {
    const {ownerId}=this.settings();
    const [row]=await safePersistence(()=>this.database.db.select().from(executions)
      .where(and(eq(executions.taskId,taskId),eq(executions.ownerId,ownerId))).orderBy(desc(executions.attemptNumber)).limit(1));
    return row;
  }
  private async ownedExecution(taskId:string,executionId:string) {
    const {ownerId}=this.settings();
    const [row]=await safePersistence(()=>this.database.db.select({execution:executions,input:tasks.input,body:executionResults.body})
      .from(executions).innerJoin(tasks,and(eq(tasks.id,executions.taskId),eq(tasks.ownerId,ownerId)))
      .leftJoin(executionResults,and(eq(executionResults.executionId,executions.id),eq(executionResults.ownerId,ownerId)))
      .where(and(eq(executions.id,executionId),eq(executions.taskId,taskId),eq(executions.ownerId,ownerId))).limit(1));
    if(!row)throw new NotFoundException();return row;
  }
  async taskStatus(taskId:string):Promise<TaskRuntimeStatusResponse> {
    this.settings();const task=await this.taskReads.get(taskId),latest=await this.latest(taskId);
    return {...task,latestExecutionId:latest?.id??null};
  }
  async result(taskId:string,executionId:string):Promise<ExecutionResultResponse> {
    const row=await this.ownedExecution(taskId,executionId),execution=row.execution;
    const pending=['PENDING','RUNNING'].includes(execution.status);
    if(execution.status==='SUCCEEDED'&&row.body===null&&execution.resultAvailability==='AVAILABLE')
      throw new RuntimeError('OUTCOME_UNCERTAIN','result');
    if(execution.status!=='SUCCEEDED'||row.body===null)return {execution:serializeExecution(execution),
      availability:pending?'PENDING':'UNAVAILABLE',result:null};
    let result;
    try {
      const snapshot=parseRuntimeSnapshot(execution.agentConfigSnapshot.runtime);
      const request=createRuntimeExecutionRequest({ids:{ownerId:execution.ownerId,taskId:execution.taskId,executionId:execution.id,
        agentId:execution.agentId,orchestratorId:execution.orchestratorId,correlationId:snapshot.correlationId},
        input:row.input,definition:snapshot.definition});
      result=createRuntimeExecutionResult(row.body,request);
    } catch {throw new RuntimeError('OUTCOME_UNCERTAIN','result');}
    return {execution:serializeExecution(execution),availability:'AVAILABLE',result};
  }
  async execute(taskId:string,taskVersion:number,signal:AbortSignal):Promise<RuntimeExecutionResponse> {
    this.settings();const task=await this.taskReads.get(taskId);this.allow(task.agentId,task.orchestratorId);
    if(!['CREATED','QUEUED'].includes(task.status)){
      this.log('runtime.conflict',{taskId,errorCode:'CAPACITY_EXCEEDED'});throw new RuntimeError('CAPACITY_EXCEEDED','request');
    }
    const existing=await this.latest(taskId);
    const correlationId=existing?.agentConfigSnapshot.runtime?parseRuntimeSnapshot(existing.agentConfigSnapshot.runtime).correlationId:randomUUID();
    this.log('runtime.requested',{taskId,agentId:task.agentId,correlationId});
    const outcome=await this.coordinator.executeTask({taskId,taskVersion,correlationId},signal).catch(error=>{
      if(error instanceof RuntimeError&&['CAPACITY_EXCEEDED','LEASE_LOST'].includes(error.code))
        this.log('runtime.conflict',{taskId,correlationId,errorCode:error.code});
      throw error;
    });
    if(outcome.kind==='unresolved')throw new RuntimeError('OUTCOME_UNCERTAIN');
    if(outcome.task.status!=='COMPLETED')throw new RuntimeError(outcome.error?.code??'INTERNAL_RUNTIME_ERROR');
    // An idempotent finalizer can observe a competing committed success without
    // carrying its body. Return the canonical persisted result, never a late candidate.
    const result=outcome.result??(await this.result(taskId,outcome.execution.id)).result;
    if(!result)throw new RuntimeError('OUTCOME_UNCERTAIN','result');
    return {kind:outcome.kind,task:outcome.task,execution:outcome.execution,correlationId,result};
  }
  async cancel(taskId:string,executionId:string,taskVersion:number,executionVersion:number) {
    const {execution}=await this.ownedExecution(taskId,executionId);this.allow(execution.agentId,execution.orchestratorId);
    if(execution.authority!=='NATIVE'||!execution.agentConfigSnapshot.runtime)throw new RuntimeError('ACCESS_DENIED','request');
    const fields={taskId,executionId,agentId:execution.agentId,correlationId:serializeExecution(execution).correlationId};
    this.log('runtime.cancellation.requested',fields);
    try {
      const result=await this.lifecycle.cancelTask(taskId,{taskVersion,executionId,executionVersion});
      this.log('runtime.cancellation.recorded',fields);return result;
    }
    catch(error){
      if(error instanceof LifecycleError){
        if(['TASK_NOT_FOUND','EXECUTION_NOT_FOUND','EXECUTION_TASK_MISMATCH'].includes(error.code))throw new NotFoundException();
        if(error.code==='PERSISTENCE_UNAVAILABLE')throw new RuntimeError('PERSISTENCE_UNAVAILABLE');
        throw new RuntimeError('CAPACITY_EXCEEDED','request');
      }
      throw error;
    }
  }
}
