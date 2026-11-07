import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { collaborationDelegations, collaborationSessions, commandAudit, executions, tasks } from '../database/schema';
import { TaskLifecycleService } from '../lifecycle/task-lifecycle.service';
import { RuntimeCoordinator } from '../runtime/runtime-coordinator';
import { CollaborationApiService } from './collaboration-api.service';
import { CollaborationRepository } from './collaboration.repository';
import { NativeCoordinationService } from './native-coordination.service';
import { CollaborationError, identifier, page, PageQuery } from './collaboration.domain';
import { cancellationRequested, controlAudit, RECOVERY_LIMIT } from './collaboration-control';
import { reconcileAggregate, terminalDelegation, terminalSession } from './collaboration-aggregation';
import { validateNativeDelegation } from './native-delegation.validation';
import { nativeSession } from './collaboration.policy';
import { RuntimeError } from '../runtime/contracts/runtime-error.contract';

@Injectable()
export class CollaborationRecoveryService {
  constructor(private readonly repository: CollaborationRepository, private readonly api: CollaborationApiService,
    private readonly coordination: NativeCoordinationService, private readonly lifecycle: TaskLifecycleService,
    private readonly runtime: RuntimeCoordinator) {}

  private async requestCancellation(sessionId: string, delegationId?: string) {
    const context = this.api.operatorContext();
    await this.repository.run(context, async (r, tx) => {
      const session = await r.getSession(identifier(sessionId)); nativeSession(session.authority);
      const d = delegationId ? await r.getDelegation(identifier(delegationId)) : null;
      if (d && d.sessionId !== session.id) throw new CollaborationError('NOT_FOUND');
      if (terminalSession(session.status) || (d && terminalDelegation(d.status))) return;
      // Exact command/resource identity is idempotent under the durable owner fence.
      if (!await cancellationRequested(tx, context.ownerId, session.id, d?.id))
        await controlAudit(tx, context, d ? 'delegation.cancel.requested' : 'collaboration.cancel.requested',
          d ? 'delegation' : 'collaboration', d?.id ?? session.id, { sessionId: session.id, delegationId: d?.id ?? null });
    });
  }
  private async cancelChild(sessionId: string, id: string) {
    const context = this.api.operatorContext();
    await this.repository.run(context, async (r, tx) => {
      const session = await r.getSession(sessionId); nativeSession(session.authority);
      const d = await r.getDelegation(id);
      if (d.sessionId !== session.id) throw new CollaborationError('NOT_FOUND');
      if (terminalSession(session.status) || terminalDelegation(d.status) || !await cancellationRequested(tx, context.ownerId, session.id, id)) return;
      if (!d.childTaskId) { await r.updateDelegation(id, d.version, { status: 'CANCELLED' }); return; }
      const [task] = await tx.select().from(tasks).where(and(eq(tasks.ownerId, context.ownerId), eq(tasks.id, d.childTaskId))).for('update');
      const [execution] = d.childExecutionId ? await tx.select().from(executions).where(and(eq(executions.ownerId, context.ownerId), eq(executions.id, d.childExecutionId))).for('update') : [];
      if (!task || task.agentId !== d.targetAgentId || (execution && (execution.taskId !== task.id || execution.agentId !== d.targetAgentId || execution.authority !== 'NATIVE')))
        throw new CollaborationError('INVALID_RELATION');
      if (execution && ['PENDING', 'RUNNING'].includes(execution.status)) {
        await this.lifecycle.cancelInTransaction(tx, task.id, { taskVersion: task.version, executionId: execution.id, executionVersion: execution.version }, context.correlationId);
      } else if (!execution && task.status === 'CREATED') {
        // Never cancel a possibly admitted but uncorrelated attempt.
        const [attempt] = await tx.select({ id: executions.id }).from(executions).where(and(eq(executions.ownerId, context.ownerId), eq(executions.taskId, task.id))).limit(1);
        if (attempt) throw new CollaborationError('INVALID_RELATION');
        await this.lifecycle.cancelInTransaction(tx, task.id, { taskVersion: task.version }, context.correlationId);
        await r.updateDelegation(id, d.version, { status: 'CANCELLED' });
      }
      // Terminal native winners are observed by the existing coordination service, never overwritten here.
    });
  }
  async cancel(sessionId: string, delegationId?: string) {
    await this.requestCancellation(sessionId, delegationId);
    return this.reconcile(sessionId);
  }
  async reconcile(sessionId: string) {
    sessionId = identifier(sessionId);
    const context = this.api.operatorContext();
    const ids = await this.repository.run(context, async r => {
      nativeSession((await r.getSession(sessionId)).authority);
      const rows = await r.listDelegations(sessionId, { limit: 3 });
      if (rows.nextCursor || rows.items.length > 2) throw new CollaborationError('LIMIT_EXCEEDED');
      return rows.items.map(d => d.id);
    });
    const delegations = [];
    for (const id of ids) {
      await this.cancelChild(sessionId, id);
      const receipt = await this.coordination.observe(sessionId, id);
      const diagnostics = await this.repository.run(context, async (_, tx) => {
        const attempts = await tx.select({ id: commandAudit.id }).from(commandAudit).where(and(eq(commandAudit.ownerId, context.ownerId),
          eq(commandAudit.resourceType, 'delegation'), eq(commandAudit.resourceId, id), eq(commandAudit.commandType, 'delegation.recovery.dispatch'))).limit(RECOVERY_LIMIT);
        let attention: string | null = null;
        const [execution] = receipt.childExecution ? await tx.select({ reconciliationState: executions.reconciliationState }).from(executions)
          .where(and(eq(executions.ownerId, context.ownerId), eq(executions.id, receipt.childExecution.id))) : [];
        if (execution && ['CANCELLATION_UNCONFIRMED', 'NATIVE_OUTCOME_UNCERTAIN'].includes(execution.reconciliationState)) attention = execution.reconciliationState;
        else if (['EXECUTING', 'AWAITING_RETURN', 'COMPLETED'].includes(receipt.delegation.status) && !receipt.childExecution) attention = 'CORRELATION_MISMATCH';
        else if (receipt.delegation.status === 'COMPLETED' && !receipt.resultAvailable) attention = 'RESULT_UNAVAILABLE';
        else if (receipt.dispatchState === 'RECOVERY_REQUIRED') attention = attempts.length >= RECOVERY_LIMIT ? 'RECOVERY_EXHAUSTED' : receipt.childExecution ? 'OUTCOME_UNCERTAIN' : 'DISPATCH_NOT_ADMITTED';
        return { recoveryAttempts: attempts.length, attention };
      });
      delegations.push({ ...receipt, ...diagnostics });
    }
    const unavailable = delegations.filter(d => d.delegation.status === 'COMPLETED' && !d.resultAvailable).map(d => d.delegation.id);
    const collaboration = await this.repository.run(context, (r, tx) => reconcileAggregate(tx, r, context.ownerId, sessionId, unavailable));
    return { collaboration, delegations, requiresAttention: delegations.some(d => !!d.attention || (terminalSession(collaboration.status) && !terminalDelegation(d.delegation.status))) };
  }
  async batch(query: PageQuery = {}) {
    const q = page(query), context = this.api.operatorContext();
    const rows = await this.repository.run(context, (_, tx) => tx.select({ id: collaborationSessions.id }).from(collaborationSessions)
      .where(and(eq(collaborationSessions.ownerId, context.ownerId), eq(collaborationSessions.authority, 'NATIVE'),
        inArray(collaborationSessions.status, ['CREATED', 'ACTIVE', 'WAITING']), ...(q.after ? [gt(collaborationSessions.id, q.after)] : [])))
      .orderBy(asc(collaborationSessions.id)).limit(q.limit + 1));
    const items = [];
    for (const row of rows.slice(0, q.limit)) items.push(await this.reconcile(row.id));
    return { items, nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }
  async recover(sessionId: string, id: string, signal: AbortSignal) {
    this.runtime.assertAdmitting();
    const context = this.api.operatorContext();
    // Reconcile/cancel first; recovery never races past a persisted cancellation intent.
    await this.reconcile(sessionId);
    const command = await this.repository.run(context, async (r, tx) => {
      const session = await r.getSession(identifier(sessionId)), d = await r.getDelegation(identifier(id));
      nativeSession(session.authority);
      if (d.sessionId !== session.id) throw new CollaborationError('NOT_FOUND');
      if (d.status !== 'ACCEPTED' || !d.childTaskId || d.childExecutionId || terminalSession(session.status)) return null;
      await validateNativeDelegation(tx, context.ownerId, session, d);
      const [task] = await tx.select().from(tasks).where(and(eq(tasks.ownerId, context.ownerId), eq(tasks.id, d.childTaskId))).for('update');
      const [attempt] = await tx.select({ id: executions.id }).from(executions).where(and(eq(executions.ownerId, context.ownerId), eq(executions.taskId, d.childTaskId))).limit(1);
      if (!task || task.status !== 'CREATED' || task.agentId !== d.targetAgentId || attempt) return null;
      const tries = await tx.select({ id: commandAudit.id }).from(commandAudit).where(and(eq(commandAudit.ownerId, context.ownerId),
        eq(commandAudit.resourceType, 'delegation'), eq(commandAudit.resourceId, id), eq(commandAudit.commandType, 'delegation.recovery.dispatch'))).limit(RECOVERY_LIMIT);
      if (tries.length >= RECOVERY_LIMIT) return null;
      await controlAudit(tx, context, 'delegation.recovery.dispatch', 'delegation', d.id,
        { sessionId: session.id, parentTaskId: d.parentTaskId, childTaskId: task.id, sourceAgentId: d.sourceAgentId, targetAgentId: d.targetAgentId, attempt: tries.length + 1 });
      this.runtime.assertAdmitting();
      return { taskId: task.id, taskVersion: task.version, delegationId: d.id, correlationId: context.correlationId };
    });
    if (command) try { await this.runtime.executeTask(command, signal); }
    catch (error) {
      // Safe durable diagnosis; a failed diagnostic write must not fabricate a native failure.
      try { await this.repository.run(context, (_, tx) => controlAudit(tx, context, 'delegation.recovery.blocked', 'delegation', command.delegationId,
        { sessionId, childTaskId: command.taskId, code: error instanceof RuntimeError ? error.code : 'INTERNAL_RUNTIME_ERROR' }, 'FAILED')); } catch { /* Inspect canonical state. */ }
    }
    return this.reconcile(sessionId);
  }
}
