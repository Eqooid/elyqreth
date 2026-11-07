import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { PersistenceTransaction } from '../common/persistence';
import { agents, collaborationDelegations, collaborationParticipants, executions, orchestrators, tasks } from '../database/schema';
import { CollaborationError } from './collaboration.domain';
import { activeMembers, eligibleAgent, nativeSession, openSession, parentContext, successfulSource } from './collaboration.policy';
import { cancellationRequested } from './collaboration-control';

type Reference = { id: string; sessionId: string; sourceAgentId: string; targetAgentId: string; parentTaskId: string; sourceExecutionId: string | null };
/** Shared activation/admission policy. Locks are held until the caller's transaction commits. */
export async function validateNativeDelegation(tx: PersistenceTransaction, ownerId: string,
  session: { id: string; authority: string; status: string; rootTaskId: string | null }, delegation: Reference) {
  nativeSession(session.authority); openSession(session.status);
  if (await cancellationRequested(tx, ownerId, session.id, delegation.id)) throw new CollaborationError('INVALID_TRANSITION');
  if (delegation.sessionId !== session.id) throw new CollaborationError('NOT_FOUND');
  const [parent] = await tx.select({ id: tasks.id, agentId: tasks.agentId, orchestratorId: tasks.orchestratorId, status: tasks.status })
    .from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.id, delegation.parentTaskId))).for('share');
  if (!parent) throw new CollaborationError('NOT_FOUND');
  const [attempt] = await tx.select({ id: executions.id, taskId: executions.taskId, agentId: executions.agentId, status: executions.status, authority: executions.authority })
    .from(executions).where(and(eq(executions.ownerId, ownerId), eq(executions.taskId, parent.id)))
    .orderBy(desc(executions.attemptNumber)).limit(1).for('share');
  const participants = await tx.select({ agentId: collaborationParticipants.agentId, role: collaborationParticipants.role, leftAt: collaborationParticipants.leftAt })
    .from(collaborationParticipants).where(and(eq(collaborationParticipants.ownerId, ownerId), eq(collaborationParticipants.sessionId, session.id),
      isNull(collaborationParticipants.leftAt))).limit(3).for('share');
  activeMembers(participants, delegation.sourceAgentId, delegation.targetAgentId);
  if (participants.filter(p => p.leftAt === null).length !== 2) throw new CollaborationError('LIMIT_EXCEEDED');
  // Exact pair locks only; never lock all of an owner's unrelated Agents.
  const pair = [];
  for (const id of [delegation.sourceAgentId, delegation.targetAgentId].sort()) {
    const [agent] = await tx.select({ id: agents.id, type: agents.type, lifecycleStatus: agents.lifecycleStatus, orchestratorId: agents.orchestratorId })
      .from(agents).where(and(eq(agents.ownerId, ownerId), eq(agents.id, id))).for('share');
    if (!agent) throw new CollaborationError('NOT_FOUND'); pair.push(agent);
  }
  for (const agent of pair) {
    const [route] = await tx.select({ type: orchestrators.type, status: orchestrators.registrationStatus }).from(orchestrators)
      .where(and(eq(orchestrators.ownerId, ownerId), eq(orchestrators.id, agent.orchestratorId))).for('share');
    eligibleAgent(agent, route?.status === 'ENABLED' && route.type === 'native');
  }
  const source = pair.find(a => a.id === delegation.sourceAgentId)!;
  if (!delegation.sourceExecutionId) throw new CollaborationError('INELIGIBLE_TASK');
  successfulSource(parent, attempt, source, delegation.sourceExecutionId);
  const relations = await tx.select({ parentTaskId: collaborationDelegations.parentTaskId, childTaskId: collaborationDelegations.childTaskId,
    continuationTaskId: collaborationDelegations.continuationTaskId, status: collaborationDelegations.status }).from(collaborationDelegations)
    .where(and(eq(collaborationDelegations.ownerId, ownerId), eq(collaborationDelegations.sessionId, session.id), ne(collaborationDelegations.id, delegation.id))).limit(3);
  parentContext(session.rootTaskId, relations, parent.id);
  if (relations.some(d => ['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(d.status))) throw new CollaborationError('INVALID_TRANSITION');
  return pair.find(a => a.id === delegation.targetAgentId)!;
}
