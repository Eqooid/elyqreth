import { RuntimeError } from '../runtime/contracts/runtime-error.contract';
import { RuntimeHostService } from '../runtime/runtime-host.service';
import { actorReference as authenticatedActor } from '../auth/principal';
import { operationalMode } from '../auth/principal';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { agents, commandAudit, executionResults, executions, orchestrators, tasks } from '../database/schema';
import { EventsService } from '../events/events.service';
import { EventType } from '../events/contracts/event-contracts';
import { PersistenceTransaction } from '../common/persistence';
import { ExecutionAuthority, ExecutionsService, serializeExecution } from '../executions/executions.service';
import { RuntimeSnapshot } from '../runtime/contracts/runtime-snapshot';
import { RuntimeErrorCode, isRuntimeErrorCode } from '../runtime/contracts/runtime-error.contract';
import { serializeTask } from '../tasks/tasks.service';
import { assertExecutionTransition, assertTaskTransition, FailureCode, failureMessages, LifecycleError } from './lifecycle-policy';
import { authorizeInteractionMutation } from '../interaction/interaction.authorization';
import { interactionPrincipal } from '../interaction/interaction.context';

export interface RuntimeTransition { leaseToken: string; correlationId: string; errorCode?: RuntimeErrorCode; uncertain?: boolean }

type Task = typeof tasks.$inferSelect;
type Execution = typeof executions.$inferSelect;
export interface TaskCommand { taskVersion: number }
export interface ExecutionCommand extends TaskCommand { executionVersion: number }
export interface QueueCommand extends TaskCommand { authority: ExecutionAuthority }
export interface CompletionCommand extends ExecutionCommand { resultReference?: string | null }
export interface FailureCommand extends ExecutionCommand { errorCode: FailureCode }
export interface CancellationCommand extends TaskCommand { executionId?: string; executionVersion?: number }

function command(value: unknown, keys: readonly string[], needsExecution = false): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !keys.includes(key))) throw new LifecycleError('INVALID_COMMAND');
  const versions = value as Record<string, unknown>;
  for (const key of needsExecution ? ['taskVersion','executionVersion'] : ['taskVersion']) {
    if (!Number.isInteger(versions[key]) || Number(versions[key]) < 1 || Number(versions[key]) > 2147483647) throw new LifecycleError('INVALID_COMMAND');
  }
}
const identifiers = (...ids: string[]) => { if (ids.some(id => !isUUID(id))) throw new LifecycleError('INVALID_COMMAND'); };

@Injectable()
export class TaskLifecycleService {
  constructor(private readonly database: DatabaseService, private readonly config: ApiConfig,
    private readonly attempts: ExecutionsService, private readonly events: EventsService, private readonly host:RuntimeHostService) {}

  private get ownerId(): string {
    const { registry, nodeEnv } = this.config.value;
    if (!registry || !operationalMode(this.config.value)) throw new LifecycleError('ACCESS_DISABLED');
    return registry.ownerId;
  }

  private async transaction<T>(operation: (tx: PersistenceTransaction) => Promise<T>): Promise<T> {
    void this.ownerId;
    try { return await this.database.db.transaction(operation); }
    catch (error) {
      if (error instanceof LifecycleError || error instanceof RuntimeError) throw error;
      const wrapped = error as { code?: string; cause?: { code?: string }; getStatus?: () => number } | null;
      const code = wrapped?.cause?.code ?? wrapped?.code;
      if (['23505','40001','40P01','55P03'].includes(code ?? '') || wrapped?.getStatus?.() === 409) throw new LifecycleError('LIFECYCLE_CONFLICT');
      if (['23503','23514'].includes(code ?? '')) throw new LifecycleError('INCONSISTENT_STATE');
      throw new LifecycleError('PERSISTENCE_UNAVAILABLE');
    }
  }

  private async lockTask(tx: PersistenceTransaction, id: string): Promise<Task> {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, this.ownerId))).for('update');
    if (!task) throw new LifecycleError('TASK_NOT_FOUND');
    return task;
  }

  private async lockExecution(tx: PersistenceTransaction, task: Task, id: string): Promise<Execution> {
    const [execution] = await tx.select().from(executions)
      .where(and(eq(executions.id, id), eq(executions.ownerId, this.ownerId))).for('update');
    if (!execution) throw new LifecycleError('EXECUTION_NOT_FOUND');
    if (execution.taskId !== task.id || execution.agentId !== task.agentId || execution.orchestratorId !== task.orchestratorId)
      throw new LifecycleError('EXECUTION_TASK_MISMATCH');
    const [latest] = await tx.select({ id: executions.id }).from(executions)
      .where(and(eq(executions.taskId, task.id), eq(executions.ownerId, this.ownerId)))
      .orderBy(desc(executions.attemptNumber)).limit(1);
    if (latest?.id !== execution.id) throw new LifecycleError('LIFECYCLE_CONFLICT');
    const [priorSuccess] = await tx.select({ id: executions.id }).from(executions)
      .where(and(eq(executions.taskId, task.id), eq(executions.ownerId, this.ownerId),
        eq(executions.status, 'SUCCEEDED'), ne(executions.id, execution.id))).limit(1);
    if (priorSuccess) throw new LifecycleError('INCONSISTENT_STATE');
    return execution;
  }

  private versions(task: Task, expected: TaskCommand, execution?: Execution) {
    if (task.version !== expected.taskVersion || (execution && execution.version !== (expected as ExecutionCommand).executionVersion))
      throw new LifecycleError('LIFECYCLE_CONFLICT');
  }

  private async eligible(tx: PersistenceTransaction, task: Task) {
    const [agent] = await tx.select().from(agents)
      .where(and(eq(agents.id, task.agentId), eq(agents.ownerId, this.ownerId))).for('share');
    const [route] = await tx.select().from(orchestrators)
      .where(and(eq(orchestrators.id, task.orchestratorId), eq(orchestrators.ownerId, this.ownerId))).for('share');
    if (!agent || agent.orchestratorId !== task.orchestratorId || agent.lifecycleStatus !== 'ACTIVE' || !route || route.registrationStatus !== 'ENABLED')
      throw new LifecycleError('LIFECYCLE_CONFLICT');
  }

  private async instant(tx: PersistenceTransaction) {
    // Keep PostgreSQL's microseconds; a JS Date would truncate same-millisecond writes.
    const result = await tx.execute(sql`select clock_timestamp()::text as instant`);
    return sql`${String(result.rows[0]?.instant)}::timestamptz`;
  }

  private state(task: Task, execution: Execution | null) {
    return { task: serializeTask(task), execution: execution ? serializeExecution(execution) : null };
  }

  async queueTask(taskId: string, input: QueueCommand) {
    identifiers(taskId); command(input, ['taskVersion','authority']);
    if (!['NATIVE','EXTERNAL'].includes(input.authority)) throw new LifecycleError('INVALID_COMMAND');
    return this.transaction(tx => this.queueInTransaction(tx, taskId, input));
  }

  async queueInTransaction(tx: PersistenceTransaction, taskId: string, input: QueueCommand, runtime?: RuntimeSnapshot) {
      const task = await this.lockTask(tx, taskId);
      this.versions(task, input); assertTaskTransition(task.status, 'QUEUED');
      const correlationId = runtime?.correlationId ?? randomUUID();
      await this.eligible(tx, task);
      const [success] = await tx.select({ id: executions.id }).from(executions)
        .where(and(eq(executions.taskId, task.id), eq(executions.ownerId, this.ownerId), eq(executions.status, 'SUCCEEDED'))).limit(1);
      if (success) throw new LifecycleError('INCONSISTENT_STATE');
      const [existing] = await tx.select().from(executions)
        .where(and(eq(executions.taskId, task.id), eq(executions.ownerId, this.ownerId)))
        .orderBy(desc(executions.attemptNumber)).limit(1).for('update');
      let execution: Execution;
      if (existing) {
        if (existing.status !== 'PENDING' || existing.authority !== input.authority || existing.agentId !== task.agentId || existing.orchestratorId !== task.orchestratorId)
          throw new LifecycleError('INCONSISTENT_STATE');
        if (runtime && !isDeepStrictEqual(existing.agentConfigSnapshot.runtime, runtime)) throw new LifecycleError('INCONSISTENT_STATE');
        execution = existing; // Adopt T05's existing pending record without overwriting history.
      } else {
        const created = await this.attempts.createPendingInTransaction(tx, task.id, input.authority, correlationId, runtime);
        execution = await this.lockExecution(tx, task, created.id);
      }
      const [updated] = await tx.update(tasks).set({ status: 'QUEUED' }).where(eq(tasks.id, task.id)).returning();
      if (!updated) throw new LifecycleError('INCONSISTENT_STATE');
      await this.record(tx, updated, null, 'task.queued', undefined, correlationId, execution.id);
      return this.state(updated, execution);
  }

  async startTask(taskId: string, executionId: string, input: ExecutionCommand) {
    identifiers(taskId, executionId); command(input, ['taskVersion','executionVersion'], true);
    return this.transaction(tx => this.startInTransaction(tx, taskId, executionId, input));
  }

  async startInTransaction(tx: PersistenceTransaction, taskId: string, executionId: string, input: ExecutionCommand, runtime?: RuntimeTransition) {
      const task = await this.lockTask(tx, taskId);
      const execution = await this.lockExecution(tx, task, executionId);
      if(execution.authority==='NATIVE')this.host.assertAdmitting();
      await this.runtimeFence(tx, execution, runtime);
      this.versions(task, input, execution);
      assertTaskTransition(task.status, 'RUNNING'); assertExecutionTransition(execution.status, 'RUNNING');
      if (task.status !== 'QUEUED' || execution.status !== 'PENDING') throw new LifecycleError('INCONSISTENT_STATE');
      await this.eligible(tx, task);
      const now = await this.instant(tx);
      const [updatedExecution] = await tx.update(executions).set({ status: 'RUNNING', startedAt: now })
        .where(eq(executions.id, execution.id)).returning();
      const [updatedTask] = await tx.update(tasks).set({ status: 'RUNNING' }).where(eq(tasks.id, task.id)).returning();
      if (!updatedTask || !updatedExecution) throw new LifecycleError('INCONSISTENT_STATE');
      await this.record(tx, updatedTask, updatedExecution, 'task.started', 'execution.started', runtime?.correlationId, undefined, runtime);
      if(execution.authority==='NATIVE')this.host.assertAdmitting();
      return this.state(updatedTask, updatedExecution);
  }

  async completeTask(taskId: string, executionId: string, input: CompletionCommand) {
    identifiers(taskId, executionId); command(input, ['taskVersion','executionVersion','resultReference'], true);
    if (input.resultReference !== undefined && input.resultReference !== null &&
      (typeof input.resultReference !== 'string' || !/^result:[0-9a-f-]{36}$/i.test(input.resultReference) || !isUUID(input.resultReference.slice(7))))
      throw new LifecycleError('INVALID_COMMAND');
    return this.finish(taskId, executionId, input, 'SUCCEEDED');
  }

  async failTask(taskId: string, executionId: string, input: FailureCommand) {
    identifiers(taskId, executionId); command(input, ['taskVersion','executionVersion','errorCode'], true);
    if (!Object.hasOwn(failureMessages, input.errorCode)) throw new LifecycleError('INVALID_COMMAND');
    return this.finish(taskId, executionId, input, 'FAILED');
  }

  async timeoutTask(taskId: string, executionId: string, input: ExecutionCommand) {
    identifiers(taskId, executionId); command(input, ['taskVersion','executionVersion'], true);
    return this.finish(taskId, executionId, input, 'TIMED_OUT');
  }

  private async finish(taskId: string, executionId: string, input: CompletionCommand | FailureCommand,
    status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT') {
    return this.transaction(tx => this.finishInTransaction(tx, taskId, executionId, input, status));
  }

  async finishInTransaction(tx: PersistenceTransaction, taskId: string, executionId: string, input: CompletionCommand | FailureCommand, status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT', runtime?: RuntimeTransition) {
      const task = await this.lockTask(tx, taskId);
      const execution = await this.lockExecution(tx, task, executionId);
      await this.runtimeFence(tx, execution, runtime);
      this.versions(task, input, execution);
      const taskStatus = status === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED';
      assertTaskTransition(task.status, taskStatus); assertExecutionTransition(execution.status, status);
      if ((execution.status === 'PENDING' && task.status !== 'QUEUED') ||
        (execution.status === 'RUNNING' && task.status !== 'RUNNING')) throw new LifecycleError('INCONSISTENT_STATE');
      let reference: string | null = null;
      if (status === 'SUCCEEDED') {
        reference = (input as CompletionCommand).resultReference?.toLowerCase() ?? null;
        if (reference) {
          const [result] = await tx.select({ id: executionResults.id }).from(executionResults)
            .where(and(eq(executionResults.id, reference.slice(7)), eq(executionResults.executionId, execution.id), eq(executionResults.ownerId, this.ownerId))).limit(1);
          if (!result) throw new LifecycleError('RESULT_NOT_FOUND');
        }
      }
      const errorCode = status === 'TIMED_OUT' ? 'EXECUTION_TIMED_OUT' : status === 'FAILED' ? (input as FailureCommand).errorCode : null;
      const errorMessage = status === 'TIMED_OUT' ? 'Execution timed out.' : status === 'FAILED' ? failureMessages[(input as FailureCommand).errorCode] : null;
      const now = await this.instant(tx);
      const [updatedExecution] = await tx.update(executions).set({ status, finishedAt: now, errorCode, errorMessage,
        resultReference: reference, resultAvailability: reference ? 'AVAILABLE' : 'NONE',
        ...(runtime ? { leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
          reconciliationState: runtime.uncertain ? 'NATIVE_OUTCOME_UNCERTAIN' : 'NONE' } : {}) })
        .where(eq(executions.id, execution.id)).returning();
      const [updatedTask] = await tx.update(tasks).set({ status: taskStatus, completedAt: now,
        statusReason: errorCode }).where(eq(tasks.id, task.id)).returning();
      if (!updatedTask || !updatedExecution) throw new LifecycleError('INCONSISTENT_STATE');
      await this.record(tx, updatedTask, updatedExecution, status === 'SUCCEEDED' ? 'task.completed' : 'task.failed',
        status === 'SUCCEEDED' ? 'execution.completed' : status === 'TIMED_OUT' ? 'execution.timed_out' : 'execution.failed',
        runtime?.correlationId, undefined, runtime);
      return this.state(updatedTask, updatedExecution);
  }

  async cancelTask(taskId: string, input: CancellationCommand) {
    identifiers(taskId); command(input, ['taskVersion','executionId','executionVersion']);
    if (input.executionId !== undefined) {
      identifiers(input.executionId);
      command(input, ['taskVersion','executionId','executionVersion'], true);
    } else if (input.executionVersion !== undefined) throw new LifecycleError('INVALID_COMMAND');
    return this.transaction(async tx => {
      const task=await this.lockTask(tx,taskId);
      await authorizeInteractionMutation(tx,this.config.value,task.agentId,'cancel',()=>{throw new LifecycleError('ACCESS_DISABLED');});
      return this.cancelInTransaction(tx,taskId,input);
    });
  }

  async cancelInTransaction(tx: PersistenceTransaction, taskId: string, input: CancellationCommand, correlationId?: string) {
      const task = await this.lockTask(tx, taskId);
      this.versions(task, input); assertTaskTransition(task.status, 'CANCELLED');
      const [active] = await tx.select().from(executions).where(and(eq(executions.taskId, task.id),
        eq(executions.ownerId, this.ownerId), inArray(executions.status, ['PENDING','RUNNING']))).limit(1);
      const [success] = await tx.select({ id: executions.id }).from(executions).where(and(eq(executions.taskId, task.id),
        eq(executions.ownerId, this.ownerId), eq(executions.status, 'SUCCEEDED'))).limit(1);
      if (success) throw new LifecycleError('INCONSISTENT_STATE');
      let execution: Execution | null = null;
      if (input.executionId) execution = await this.lockExecution(tx, task, input.executionId);
      if (active && !execution) throw new LifecycleError('INVALID_COMMAND');
      if (execution) {
        this.versions(task, input, execution); assertExecutionTransition(execution.status, 'CANCELLED');
        if (active?.id !== execution.id || (task.status === 'RUNNING') !== (execution.status === 'RUNNING')) throw new LifecycleError('INCONSISTENT_STATE');
        if (execution.agentConfigSnapshot.runtime) await tx.select({id:agents.id}).from(agents)
          .where(and(eq(agents.id,task.agentId),eq(agents.ownerId,this.ownerId))).for('update');
      } else if (task.status !== 'CREATED') throw new LifecycleError('INCONSISTENT_STATE');
      const now = await this.instant(tx);
      let updatedExecution: Execution | null = null;
      if (execution) {
        [updatedExecution = null] = await tx.update(executions).set({ status: 'CANCELLED', finishedAt: now,
          errorCode: null, errorMessage: null,
          reconciliationState: execution.status === 'RUNNING' ? 'CANCELLATION_UNCONFIRMED' : execution.reconciliationState })
          .where(eq(executions.id, execution.id)).returning();
        if (!updatedExecution) throw new LifecycleError('INCONSISTENT_STATE');
      }
      const [updatedTask] = await tx.update(tasks).set({ status: 'CANCELLED', completedAt: now,
        cancelRequestedAt: now, statusReason: 'ADMINISTRATIVE_CANCELLATION' }).where(eq(tasks.id, task.id)).returning();
      if (!updatedTask) throw new LifecycleError('INCONSISTENT_STATE');
      const snapshot = execution?.agentConfigSnapshot.runtime as {correlationId?: string} | undefined;
      await this.record(tx, updatedTask, updatedExecution, 'task.cancelled', updatedExecution ? 'execution.cancelled' : undefined,
        correlationId ?? (snapshot?.correlationId && isUUID(snapshot.correlationId) ? snapshot.correlationId : undefined));
      return this.state(updatedTask, updatedExecution);
  }

  private async runtimeFence(tx: PersistenceTransaction, execution: Execution, runtime?: RuntimeTransition) {
    if (!execution.agentConfigSnapshot.runtime) return;
    if (!runtime || !isUUID(runtime.leaseToken) || !isUUID(runtime.correlationId) || execution.leaseToken !== runtime.leaseToken)
      throw new LifecycleError('LIFECYCLE_CONFLICT');
    const check = await tx.execute(sql`select 1 from executions where id=${execution.id}::uuid and lease_expires_at > clock_timestamp()`);
    if (!check.rows.length) throw new LifecycleError('LIFECYCLE_CONFLICT');
  }

  private async record(tx: PersistenceTransaction, task: Task, execution: Execution | null,
    taskEvent: EventType, executionEvent?: EventType, correlationId: string = randomUUID(), relatedExecutionId?: string, runtime?: RuntimeTransition) {
    for (const [aggregate, type, record] of [[execution, executionEvent, 'execution'], [task, taskEvent, 'task']] as const) {
      if (!aggregate || !type) continue;
      const executionId = record === 'execution' ? aggregate.id : execution?.id ?? relatedExecutionId;
      await this.events.appendState(tx,{ownerId:this.ownerId,eventType:type,aggregateId:aggregate.id,correlationId,
        ...(executionId ? {executionId} : {})});
    }
    await tx.insert(commandAudit).values({ ownerId: this.ownerId, actorReference: runtime ? 'native-runtime' : authenticatedActor(interactionPrincipal()?'local-city-interaction':'local-development-operator'),
      commandType: taskEvent, resourceType: 'task', resourceId: task.id, correlationId, outcome: 'ACCEPTED',
      details: { taskVersion: task.version, ...(execution ? { executionVersion: execution.version } : {}),
        ...(runtime?.errorCode && isRuntimeErrorCode(runtime.errorCode) ? { runtimeErrorCode: runtime.errorCode } : {}) } });
  }
}
