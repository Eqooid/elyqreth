import { and, eq, sql } from 'drizzle-orm';
import type { PersistenceTransaction } from '../common/persistence';
import { collaborationDelegations } from '../database/schema';
import { CollaborationTransaction } from './collaboration.repository';
import { validateNativeDelegation } from './native-delegation.validation';
import { RuntimeError } from '../runtime/contracts/runtime-error.contract';
import type { ExecuteTaskCommand } from '../runtime/runtime-command';

/** Called inside existing native admission, before Task/attempt locks. No runtime module dependency. */
export async function delegatedAdmission(tx: PersistenceTransaction, ownerId: string, command: ExecuteTaskCommand, claim: boolean) {
  ownerId = ownerId.toLowerCase();
  const [reference] = await tx.select({ id: collaborationDelegations.id }).from(collaborationDelegations)
    .where(and(eq(collaborationDelegations.ownerId, ownerId), eq(collaborationDelegations.childTaskId, command.taskId))).limit(1);
  if (!reference && !command.delegationId) return null;
  if (!claim || !command.delegationId || reference?.id !== command.delegationId || !command.correlationId)
    throw new RuntimeError('ACCESS_DENIED', 'request');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId + ':collaboration'},0))`);
  const repository = new CollaborationTransaction(tx, { ownerId, actorReference: 'local-collaboration-runtime', correlationId: command.correlationId });
  const delegation = await repository.getDelegation(reference.id), session = await repository.getSession(delegation.sessionId);
  if (delegation.status !== 'ACCEPTED' || delegation.childTaskId !== command.taskId || delegation.childExecutionId !== null)
    throw new RuntimeError('ACCESS_DENIED', 'request');
  try { await validateNativeDelegation(tx, ownerId, session, delegation); }
  catch { throw new RuntimeError('ACCESS_DENIED', 'request'); }
  return { repository, delegation };
}
