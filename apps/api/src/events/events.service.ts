import { operationalMode } from '../auth/principal';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { agentEvents, agents, executions, tasks } from '../database/schema';
import type { PersistenceTransaction } from '../common/persistence';
import { persistenceOwner, safePersistence } from '../common/persistence';
import { assertEnvelope, EventContractError, EventType, eventDefinitions, knownEvent } from './contracts/event-contracts';
import { ListEventsQueryDto } from './list-events-query.dto';

type StoredEvent = typeof agentEvents.$inferSelect;
const utcOrNull = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
export interface StateEvent {
  eventType: EventType; aggregateId: string; ownerId: string; correlationId: string; executionId?: string;
}

export function serializeEvent(row: StoredEvent) {
  const envelope = {
    eventId: row.id, eventType: row.eventType, schemaVersion: row.schemaVersion, aggregateType: row.aggregateType,
    aggregateId: row.aggregateId, aggregateVersion: row.aggregateVersion, aggregateSequence: row.aggregateSequence.toString(),
    streamPosition: row.streamPosition.toString(), agentId: row.agentId, taskId: row.taskId, executionId: row.executionId,
    orchestratorId: row.orchestratorId, correlationId: row.correlationId, causationId: row.causationId,
    occurredAt: utcOrNull(row.occurredAt), recordedAt: utcOrNull(row.createdAt),
    payload: row.payload, contractStatus: 'VALID',
  };
  try { assertEnvelope(envelope); return envelope; }
  catch {
    // Preserve row identity/order without trusting legacy/unknown payloads or source strings.
    return { ...envelope, eventType: knownEvent(row.eventType) ? row.eventType : 'unsupported', payload: {},
      contractStatus: row.schemaVersion === 1 && knownEvent(row.eventType) ? 'INVALID' : 'UNSUPPORTED' };
  }
}

@Injectable()
export class EventsService {
  constructor(private readonly database: DatabaseService, private readonly config: ApiConfig) {}
  private get ownerId(): string {
    if (!operationalMode(this.config.value)) throw new ServiceUnavailableException();
    return persistenceOwner(this.config);
  }

  // Caller owns the transaction. No nested transaction, audit mutation or transport side effect.
  async appendState(tx: PersistenceTransaction, event: StateEvent) {
    if (!event || Object.keys(event).some(key => !['eventType','aggregateId','ownerId','correlationId','executionId'].includes(key)) ||
      !knownEvent(event.eventType) || event.ownerId !== this.ownerId || !isUUID(event.aggregateId) || !isUUID(event.correlationId) ||
      (event.executionId !== undefined && !isUUID(event.executionId))) throw new EventContractError();
    const aggregateType = eventDefinitions[event.eventType][0];
    let version: number, status: string, agentId: string, orchestratorId: string, taskId: string | null = null;
    let executionId: string | null = event.executionId ?? null, attemptNumber: number | undefined, occurredAt: Date;
    if (aggregateType === 'agent') {
      const [agent] = await tx.select().from(agents).where(and(eq(agents.id,event.aggregateId),eq(agents.ownerId,this.ownerId))).for('update');
      if (!agent || executionId) throw new EventContractError();
      version = agent.version; status = agent.lifecycleStatus; agentId = agent.id; orchestratorId = agent.orchestratorId; occurredAt = agent.updatedAt;
    } else if (aggregateType === 'task') {
      const [task] = await tx.select().from(tasks).where(and(eq(tasks.id,event.aggregateId),eq(tasks.ownerId,this.ownerId))).for('update');
      if (!task) throw new EventContractError();
      version = task.version; status = task.status; agentId = task.agentId; orchestratorId = task.orchestratorId; taskId = task.id; occurredAt = task.updatedAt;
      if (executionId) {
        const [execution] = await tx.select({id:executions.id}).from(executions).where(and(eq(executions.id,executionId),eq(executions.taskId,task.id),eq(executions.ownerId,this.ownerId))).limit(1);
        if (!execution) throw new EventContractError();
      }
    } else {
      // Parent-before-attempt lock order matches lifecycle operations; never reverse it.
      const [reference] = await tx.select({taskId:executions.taskId}).from(executions)
        .where(and(eq(executions.id,event.aggregateId),eq(executions.ownerId,this.ownerId))).limit(1);
      if (!reference) throw new EventContractError();
      await tx.select({id:tasks.id}).from(tasks).where(and(eq(tasks.id,reference.taskId),eq(tasks.ownerId,this.ownerId))).for('update');
      const [execution] = await tx.select().from(executions).where(and(eq(executions.id,event.aggregateId),eq(executions.ownerId,this.ownerId))).for('update');
      if (!execution || (executionId && executionId !== execution.id)) throw new EventContractError();
      version = execution.version; status = execution.status; agentId = execution.agentId; orchestratorId = execution.orchestratorId;
      taskId = execution.taskId; executionId = execution.id; attemptNumber = execution.attemptNumber; occurredAt = execution.updatedAt;
    }
    const [last] = await tx.select({value:sql<string>`coalesce(max(${agentEvents.aggregateSequence}),0)::text`}).from(agentEvents)
      .where(and(eq(agentEvents.ownerId,this.ownerId),eq(agentEvents.aggregateType,aggregateType),eq(agentEvents.aggregateId,event.aggregateId)));
    const payload = { [aggregateType === 'agent' ? 'lifecycleStatus' : 'status']: status, version,
      ...(attemptNumber !== undefined ? {attemptNumber} : {}) };
    // Validate before SQL; use a placeholder positive position until the trigger assigns the real cursor.
    const eventId = randomUUID();
    assertEnvelope({ eventId,eventType:event.eventType,schemaVersion:1,aggregateType,aggregateId:event.aggregateId,
      aggregateVersion:version,aggregateSequence:(BigInt(last?.value ?? '0')+1n).toString(),streamPosition:'1',
      agentId,taskId,executionId,orchestratorId,correlationId:event.correlationId,causationId:null,
      occurredAt:occurredAt.toISOString(),recordedAt:occurredAt.toISOString(),payload,contractStatus:'VALID' });
    const [stored] = await tx.insert(agentEvents).values({id:eventId,ownerId:this.ownerId,eventType:event.eventType,schemaVersion:1,
      aggregateType,aggregateId:event.aggregateId,aggregateVersion:version,aggregateSequence:BigInt(last?.value ?? '0')+1n,
      agentId,taskId,executionId,orchestratorId,correlationId:event.correlationId,occurredAt,payload,
      source:'elyqreth.contracts.v1',createdAt:sql`clock_timestamp()`}).returning();
    if (!stored) throw new EventContractError();
    const serialized = serializeEvent(stored);
    if (serialized.contractStatus !== 'VALID') throw new EventContractError();
    return serialized;
  }

  async history(kind: 'agent' | 'task' | 'execution', id: string, query: ListEventsQueryDto) {
    return safePersistence(async () => {
      const ownerId = this.ownerId;
      const table = kind === 'agent' ? agents : kind === 'task' ? tasks : executions;
      const [resource] = await this.database.db.select({id:table.id}).from(table)
        .where(and(eq(table.id,id),eq(table.ownerId,ownerId))).limit(1);
      if (!resource) throw new NotFoundException();
      const column = kind === 'agent' ? agentEvents.agentId : kind === 'task' ? agentEvents.taskId : agentEvents.executionId;
      const filters = [eq(agentEvents.ownerId,ownerId),eq(column,id)];
      if (query.eventType) filters.push(eq(agentEvents.eventType,query.eventType));
      if (query.correlationId) filters.push(eq(agentEvents.correlationId,query.correlationId));
      if (query.after !== undefined) filters.push(gt(agentEvents.streamPosition,BigInt(query.after)));
      const rows = await this.database.db.select().from(agentEvents).where(and(...filters))
        .orderBy(asc(agentEvents.streamPosition)).limit(query.limit+1).offset(query.offset);
      const page = rows.slice(0,query.limit);
      return {items:page.map(serializeEvent),pagination:{limit:query.limit,offset:query.offset,hasMore:rows.length>query.limit,
        nextAfter:page.at(-1)?.streamPosition.toString() ?? query.after ?? null}};
    });
  }
}
