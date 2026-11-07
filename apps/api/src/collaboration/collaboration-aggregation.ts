import { and, eq, sql } from 'drizzle-orm';
import { collaborationDelegations, executions, tasks } from '../database/schema';
import type { PersistenceTransaction } from '../common/persistence';
import type { CollaborationTransaction } from './collaboration.repository';
import type { SessionStatus } from './collaboration.domain';
import { cancellationRequested } from './collaboration-control';

export const terminalDelegation = (s: string) => ['COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(s);
export const terminalSession = (s: string) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(s);
export function aggregateState(states: readonly string[], cancel: boolean, uncertain: boolean): SessionStatus {
  if (uncertain) return 'WAITING';
  if (!states.length) return cancel ? 'CANCELLED' : 'CREATED';
  if (states.some(s => !terminalDelegation(s)))
    return !cancel && !states.some(s => ['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(s)) && states.includes('EXECUTING') ? 'ACTIVE' : 'WAITING';
  if (states.some(s => ['FAILED', 'REJECTED', 'EXPIRED'].includes(s))) return 'FAILED';
  // Proven completion wins over a cancellation that arrived too late.
  if (states.every(s => s === 'COMPLETED')) return 'COMPLETED';
  return 'CANCELLED';
}
/** Exact session, bounded first recipe. No subscriptions or runtime side effects. */
export async function reconcileAggregate(tx: PersistenceTransaction, r: CollaborationTransaction, ownerId: string, sessionId: string, unavailableResults: readonly string[] = []) {
  let session = await r.getSession(sessionId);
  if (terminalSession(session.status)) return session;
  const rows = await tx.select().from(collaborationDelegations).where(and(eq(collaborationDelegations.ownerId, ownerId), eq(collaborationDelegations.sessionId, sessionId))).limit(3);
  const clock = await tx.execute(sql`select extract(epoch from clock_timestamp()) * 1000 as now`);
  const now = Number(clock.rows[0]!.now);
  let uncertain = rows.length > 2 || unavailableResults.length > 0;
  for (const d of rows) {
    if (['EXECUTING', 'AWAITING_RETURN', 'COMPLETED'].includes(d.status) && !d.childExecutionId) uncertain = true;
    if (d.childTaskId) {
      const [task] = await tx.select({ agentId: tasks.agentId, status: tasks.status }).from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.id, d.childTaskId)));
      if (!task || task.agentId !== d.targetAgentId ||
        (d.status === 'COMPLETED' && task.status !== 'COMPLETED') || (d.status === 'CANCELLED' && task.status !== 'CANCELLED') ||
        (d.status === 'FAILED' && !!d.childExecutionId && task.status !== 'FAILED')) uncertain = true;
    }
  }
  for (const d of rows) if (d.childExecutionId) {
    const [e] = await tx.select({ status: executions.status, reconciliation: executions.reconciliationState, taskId: executions.taskId, agentId: executions.agentId,
      authority: executions.authority, leaseExpiresAt: executions.leaseExpiresAt, deadlineAt: executions.deadlineAt, resultAvailability: executions.resultAvailability })
      .from(executions).where(and(eq(executions.ownerId, ownerId), eq(executions.id, d.childExecutionId)));
    if (!e || e.taskId !== d.childTaskId || e.agentId !== d.targetAgentId || e.authority !== 'NATIVE' ||
      ['CANCELLATION_UNCONFIRMED', 'NATIVE_OUTCOME_UNCERTAIN'].includes(e.reconciliation) ||
      (e.status === 'RUNNING' && (!e.leaseExpiresAt || !e.deadlineAt || e.leaseExpiresAt.getTime() <= now || e.deadlineAt.getTime() <= now)) ||
      (d.status === 'EXECUTING' && e.status !== 'RUNNING') ||
      (d.status === 'COMPLETED' && (e.status !== 'SUCCEEDED' || e.resultAvailability !== 'AVAILABLE')) ||
      (d.status === 'FAILED' && !['FAILED','TIMED_OUT'].includes(e.status)) ||
      (d.status === 'CANCELLED' && e.status !== 'CANCELLED') ||
      (terminalDelegation(d.status) && ['PENDING', 'RUNNING'].includes(e.status))) uncertain = true;
  }
  const target = aggregateState(rows.map(d => d.status), await cancellationRequested(tx, ownerId, sessionId), uncertain);
  if (target === 'CREATED' || target === session.status) return session;
  if (session.status === 'CREATED') session = await r.updateSession(session.id, session.version, 'ACTIVE');
  if (session.status === 'WAITING' && target === 'COMPLETED') session = await r.updateSession(session.id, session.version, 'ACTIVE');
  if (session.status !== target) session = await r.updateSession(session.id, session.version, target);
  return session;
}
