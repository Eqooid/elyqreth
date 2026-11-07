import { actorReference as authenticatedActor } from '../auth/principal';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { commandAudit } from '../database/schema';
import type { EventsService } from '../events/events.service';
import { interactionPrincipal } from '../interaction/interaction.context';

export type PersistenceTransaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

export function persistenceOwner(config: ApiConfig): string {
  const ownerId = config.value.registry?.ownerId;
  if (!ownerId) throw new ServiceUnavailableException();
  return ownerId;
}

export async function safePersistence<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const candidate = error as { code?: string; cause?: { code?: string } } | null;
    const code = candidate?.cause?.code ?? candidate?.code;
    if (['23505', '40001', '40P01'].includes(code ?? '')) throw new ConflictException();
    if (['23503', '23514'].includes(code ?? '')) throw new BadRequestException();
    if (code || (error instanceof Error && error.message.startsWith('Failed query:'))) throw new ServiceUnavailableException();
    throw error;
  }
}

// No publisher: append a fact and accepted-command audit in the caller's transaction.
// Existing PostgreSQL triggers assign owner ordering and persist the outbox row.
export async function recordCreation(tx: PersistenceTransaction,
  resource: { id: string; ownerId: string; agentId: string; orchestratorId: string },
  kind: 'task' | 'execution', events: EventsService, correlationId: string = randomUUID()) {
  const eventType = `${kind}.created`;
  await events.appendState(tx, {ownerId:resource.ownerId,aggregateId:resource.id,
    eventType:kind === 'task' ? 'task.created' : 'execution.created',correlationId});
  await tx.insert(commandAudit).values({ ownerId: resource.ownerId,
    actorReference: authenticatedActor(interactionPrincipal()?'local-city-interaction':'local-development-operator'), commandType: eventType, resourceType: kind,
    resourceId: resource.id, correlationId, outcome: 'ACCEPTED', details: { version: 1 } });
}
