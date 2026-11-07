import { Injectable, HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { commandAudit, executions, tasks } from '../database/schema';
import { TasksService, taskRequestHash, serializeTask } from '../tasks/tasks.service';
import { validTaskInput } from '../tasks/dto/task.dto';
import { serializeExecution } from '../executions/executions.service';
import { RuntimeCoordinator } from '../runtime/runtime-coordinator';
import { RuntimeApiService } from '../runtime/http/runtime-api.service';
import { RuntimeError } from '../runtime/contracts/runtime-error.contract';
import { CollaborationApiService } from './collaboration-api.service';
import { CollaborationRepository, CollaborationTransaction } from './collaboration.repository';
import { CollaborationError, commandKey, identifier } from './collaboration.domain';
import { nativeSession } from './collaboration.policy';
import { validateNativeDelegation } from './native-delegation.validation';
import type { PersistenceTransaction } from '../common/persistence';
import { reconcileAggregate, terminalSession } from './collaboration-aggregation';
import { cancellationRequested } from './collaboration-control';

export interface ActivationInput { readonly instruction: string; readonly idempotencyKey: string }
export function activationTaskKey(ownerId: string, delegationId: string, key: string): string {
  return 'collaboration.' + createHash('sha256').update(JSON.stringify([identifier(ownerId), identifier(delegationId), commandKey(key)])).digest('hex');
}
export function childOutcome(status: string, taskStatus: string, resultAvailable: boolean): 'COMPLETED' | 'FAILED' | 'CANCELLED' | null {
  if (status === 'SUCCEEDED' && taskStatus === 'COMPLETED' && resultAvailable) return 'COMPLETED';
  if (['FAILED', 'TIMED_OUT'].includes(status) && taskStatus === 'FAILED') return 'FAILED';
  if (status === 'CANCELLED' && taskStatus === 'CANCELLED') return 'CANCELLED';
  return null;
}

@Injectable()
export class NativeCoordinationService {
  constructor(private readonly repository: CollaborationRepository, private readonly api: CollaborationApiService,
    private readonly taskService: TasksService, private readonly coordinator: RuntimeCoordinator,
    private readonly results: RuntimeApiService, private readonly config: ApiConfig) {}

  private async record(r: CollaborationTransaction, sessionId: string, id: string) {
    const session = await r.getSession(identifier(sessionId)); nativeSession(session.authority);
    const delegation = await r.getDelegation(identifier(id));
    if (delegation.sessionId !== session.id) throw new CollaborationError('NOT_FOUND');
    return { session, delegation };
  }
  private async child(tx: PersistenceTransaction, ownerId: string, taskId: string | null) {
    if (!taskId) return null;
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.id, taskId))).for('update');
    if (!task) throw new CollaborationError('NOT_FOUND'); return task;
  }
  /** Internal committed preparation boundary, also used to test interruption before dispatch. */
  async prepare(sessionId: string, id: string, input: ActivationInput) {
    this.coordinator.assertAdmitting();
    commandKey(input.idempotencyKey);
    if (!validTaskInput({ instruction: input.instruction })) throw new CollaborationError('INVALID_INPUT');
    return this.api.operatorChange('activate', async (r, tx, context) => {
      const { session, delegation } = await this.record(r, sessionId, id), ownerId = context.ownerId.toLowerCase();
      const key = activationTaskKey(ownerId, delegation.id, input.idempotencyKey);
      const dto = { agentId: delegation.targetAgentId, input: { instruction: input.instruction }, idempotencyKey: key };
      const existing = await this.child(tx, ownerId, delegation.childTaskId);
      if (existing) {
        if (existing.idempotencyKey !== key || existing.requestHash !== taskRequestHash(dto)) throw new CollaborationError('IDEMPOTENCY_CONFLICT');
        return { dispatch: false as const, delegationId: delegation.id, taskId: existing.id, taskVersion: existing.version, correlationId: context.correlationId };
      }
      if (delegation.status !== 'REQUESTED') throw new CollaborationError('INVALID_TRANSITION');
      const target = await validateNativeDelegation(tx, ownerId, session, delegation);
      const binding = this.config.value.runtime?.bindings.find(b => b.agentId === target.id && b.orchestratorId === target.orchestratorId);
      if (!binding || binding.definition.agentType !== target.type) throw new CollaborationError('INELIGIBLE_AGENT');
      let child;
      try { child = await this.taskService.createInTransaction(tx, dto, context.correlationId); }
      catch (error) {
        if (error instanceof HttpException) throw new CollaborationError(error.getStatus() === 400 ? 'INVALID_INPUT' : 'CONFLICT');
        throw error;
      }
      // A pre-created unrelated Task with the derived key is never silently adopted.
      if (!child.created) throw new CollaborationError('IDEMPOTENCY_CONFLICT');
      await r.updateDelegation(delegation.id, delegation.version, { childTaskId: child.task.id, status: 'ACCEPTED' });
      this.coordinator.assertAdmitting();
      return { dispatch: true as const, delegationId: delegation.id, taskId: child.task.id, taskVersion: child.task.version, correlationId: context.correlationId };
    });
  }

  async activate(sessionId: string, id: string, input: ActivationInput, signal: AbortSignal) {
    const prepared = await this.prepare(sessionId, id, input);
    let uncertain = false;
    if (prepared.dispatch) {
      let rejected: string | undefined;
      try {
        const outcome = await this.coordinator.executeTask({ taskId: prepared.taskId, taskVersion: prepared.taskVersion,
          delegationId: prepared.delegationId, correlationId: prepared.correlationId }, signal);
        uncertain = outcome.kind === 'unresolved';
      } catch (error) { uncertain = true; rejected = error instanceof RuntimeError ? error.code : 'INTERNAL_RUNTIME_ERROR'; }
      if (rejected && rejected!=='RUNTIME_DRAINING') await this.rejectUnstarted(sessionId, id, rejected);
    }
    const receipt = await this.observe(sessionId, id);
    return uncertain && receipt.dispatchState !== 'SETTLED' ? { ...receipt, dispatchState: 'RECOVERY_REQUIRED' } : receipt;
  }

  private async rejectUnstarted(sessionId: string, id: string, code: string) {
    try {
      const context = this.api.operatorContext();
      await this.repository.run(context, async (r, tx) => {
        const { delegation } = await this.record(r, sessionId, id);
        const task = await this.child(tx, context.ownerId, delegation.childTaskId);
        const [attempt] = task ? await tx.select({ id: executions.id }).from(executions)
          .where(and(eq(executions.ownerId, context.ownerId), eq(executions.taskId, task.id))).limit(1) : [];
        // The shared owner fence excludes an in-flight admission. Any committed attempt is observed, never guessed failed.
        if (delegation.status === 'ACCEPTED' && task?.status === 'CREATED' && !delegation.childExecutionId && !attempt &&
          !await cancellationRequested(tx, context.ownerId, delegation.sessionId, delegation.id)) {
          await r.updateDelegation(delegation.id, delegation.version, { status: 'FAILED' });
          await tx.insert(commandAudit).values({ ownerId: context.ownerId, actorReference: context.actorReference,
            commandType: 'delegation.dispatch_rejected', resourceType: 'delegation', resourceId: delegation.id,
            correlationId: context.correlationId, outcome: 'FAILED', details: { sessionId: delegation.sessionId, childTaskId: task.id, code } });
        }
      });
    } catch { /* Unknown persistence/commit remains inspectable, never redispatched or declared complete. */ }
  }

  /** Bounded read-through observation of this exact committed child; no timers/subscriptions. */
  async observe(sessionId: string, id: string) {
    const context = this.api.operatorContext();
    const known = await this.api.delegation(sessionId, id);
    let available = false;
    if (known.childTaskId && known.childExecutionId) try {
      available = (await this.results.result(known.childTaskId, known.childExecutionId)).availability === 'AVAILABLE';
    } catch { /* Keep unknown/corrupt/unavailable output from becoming fabricated success. */ }
    return this.repository.run(context, async (r, tx) => {
      let { delegation, session } = await this.record(r, sessionId, id);
      const task = await this.child(tx, context.ownerId, delegation.childTaskId);
      const [execution] = delegation.childExecutionId ? await tx.select().from(executions)
        .where(and(eq(executions.ownerId, context.ownerId), eq(executions.id, delegation.childExecutionId),
          eq(executions.taskId, delegation.childTaskId!))).for('share') : [];
      if (!terminalSession(session.status) && execution && task && execution.agentId === delegation.targetAgentId && execution.authority === 'NATIVE') {
        const outcome = childOutcome(execution.status, task.status, available && execution.resultAvailability === 'AVAILABLE');
        if (delegation.status === 'EXECUTING' && outcome === 'COMPLETED') {
          delegation = await r.updateDelegation(delegation.id, delegation.version, { status: 'AWAITING_RETURN' });
        }
        // A returned, authorized stable result reference satisfies this slice's handoff; no parent continuation/input merge.
        if (delegation.status === 'AWAITING_RETURN' && outcome === 'COMPLETED')
          delegation = await r.updateDelegation(delegation.id, delegation.version, { status: 'COMPLETED' });
        else if (delegation.status === 'EXECUTING' && (outcome === 'FAILED' || outcome === 'CANCELLED'))
          delegation = await r.updateDelegation(delegation.id, delegation.version, { status: outcome });
      }
      const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(delegation.status);
      const dispatchState = terminal ? 'SETTLED' : delegation.status === 'REQUESTED' && !task ? 'NOT_ACTIVATED' :
        execution?.status === 'RUNNING' && execution.leaseExpiresAt && execution.leaseExpiresAt.getTime() > Date.now() &&
        (!execution.deadlineAt || execution.deadlineAt.getTime() > Date.now()) ? 'RUNNING' : 'RECOVERY_REQUIRED';
      // Preserve T03's request-only reads: a bare REQUESTED intent does not activate its session.
      if (delegation.childTaskId || session.status !== 'CREATED') await reconcileAggregate(tx, r, context.ownerId, delegation.sessionId,
        delegation.status === 'COMPLETED' && !available ? [delegation.id] : []);
      return { delegation, childTask: task ? serializeTask(task) : null, childExecution: execution ? serializeExecution(execution) : null,
        dispatchState, resultAvailable: available, resultPath: available && task && execution ? `/api/v1/tasks/${task.id}/executions/${execution.id}/result` : null };
    });
  }
}
