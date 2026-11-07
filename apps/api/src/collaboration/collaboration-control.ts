import { and, eq, or } from 'drizzle-orm';
import { commandAudit } from '../database/schema';
import type { PersistenceTransaction } from '../common/persistence';
import type { CollaborationScope } from './collaboration.domain';

export const RECOVERY_LIMIT = 3;
/** Called under the existing owner collaboration transaction fence. Audit is the durable command journal. */
export async function cancellationRequested(tx: PersistenceTransaction, ownerId: string, sessionId: string, delegationId?: string) {
  const [intent] = await tx.select({ id: commandAudit.id }).from(commandAudit).where(and(eq(commandAudit.ownerId, ownerId), or(
    and(eq(commandAudit.resourceType, 'collaboration'), eq(commandAudit.resourceId, sessionId), eq(commandAudit.commandType, 'collaboration.cancel.requested')),
    ...(delegationId ? [and(eq(commandAudit.resourceType, 'delegation'), eq(commandAudit.resourceId, delegationId), eq(commandAudit.commandType, 'delegation.cancel.requested'))] : [])
  ))).limit(1);
  return !!intent;
}
export async function controlAudit(tx: PersistenceTransaction, context: CollaborationScope, type: string,
  resourceType: 'collaboration' | 'delegation', id: string, details: Record<string, string | number | null>, outcome: 'ACCEPTED' | 'FAILED' = 'ACCEPTED') {
  await tx.insert(commandAudit).values({ ownerId: context.ownerId, actorReference: context.actorReference,
    commandType: type, resourceType, resourceId: id, correlationId: context.correlationId, outcome, details });
}
