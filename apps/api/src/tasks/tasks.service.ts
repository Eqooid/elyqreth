import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { agents, orchestrators, tasks } from '../database/schema';
import { PersistenceTransaction, persistenceOwner, recordCreation, safePersistence } from '../common/persistence';
import { CreateTaskDto, ListTasksQueryDto, validTaskInput } from './dto/task.dto';
import { EventsService } from '../events/events.service';
import { authorizeInteractionMutation } from '../interaction/interaction.authorization';

type Task = typeof tasks.$inferSelect;
export function serializeTask(task: Task) {
  return { id: task.id, agentId: task.agentId, orchestratorId: task.orchestratorId, status: task.status,
    version: task.version, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null };
}

export function taskRequestHash(dto: CreateTaskDto): string {
  // Fixed key order; input object property order does not change semantic identity.
  return createHash('sha256').update(JSON.stringify({ agentId: dto.agentId.toLowerCase(), input: {
    instruction: dto.input.instruction, ...(dto.input.context !== undefined ? { context: dto.input.context } : {}),
  } })).digest('hex');
}

function assertTaskCreation(dto: CreateTaskDto): void {
    // Also protect internal callers from unvalidated input or credential-bearing data.
    if (!isUUID(dto.agentId) || !validTaskInput(dto.input) ||
      (dto.idempotencyKey !== undefined && (typeof dto.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(dto.idempotencyKey)))) throw new BadRequestException();
}

@Injectable()
export class TasksService {
  constructor(private readonly database: DatabaseService, private readonly config: ApiConfig, private readonly events: EventsService) {}
  private get ownerId(): string { return persistenceOwner(this.config); }

  async create(dto: CreateTaskDto) {
    assertTaskCreation(dto);
    return safePersistence(() => this.database.db.transaction(tx => this.createInTransaction(tx, dto)));
  }

  // Existing validation/persistence composed by trusted application services; caller owns commit.
  async createInTransaction(tx: PersistenceTransaction, dto: CreateTaskDto, correlationId?: string) {
    assertTaskCreation(dto);
    const requestHash = taskRequestHash(dto);
    const ownerId = this.ownerId;
    await authorizeInteractionMutation(tx,this.config.value,dto.agentId,'create');
    if (dto.idempotencyKey !== undefined) {
      // Serialize same owner/key before eligibility checks, including calls for different agents.
      // Hash collisions only cause extra serialization; DB uniqueness remains authoritative.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId + ':' + dto.idempotencyKey}, 0))`);
      const [existing] = await tx.select().from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.idempotencyKey, dto.idempotencyKey))).limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException();
        return { task: serializeTask(existing), created: false };
      }
    }
    const [agent] = await tx.select().from(agents)
      .where(and(eq(agents.id, dto.agentId), eq(agents.ownerId, ownerId))).for('share');
    if (!agent) throw new BadRequestException();
    if (agent.lifecycleStatus !== 'ACTIVE') throw new ConflictException();
    const [orchestrator] = await tx.select().from(orchestrators)
      .where(and(eq(orchestrators.id, agent.orchestratorId), eq(orchestrators.ownerId, ownerId))).for('share');
    if (!orchestrator) throw new BadRequestException();
    if (orchestrator.registrationStatus !== 'ENABLED') throw new ConflictException();
    // Persist intent even when connectivity is unknown/offline. No runnable capability is claimed.
    const [task] = await tx.insert(tasks).values({ ownerId, agentId: agent.id,
      orchestratorId: orchestrator.id, status: 'CREATED', input: { ...dto.input },
      ...(dto.idempotencyKey !== undefined ? { idempotencyKey: dto.idempotencyKey, requestHash } : {}),
    }).onConflictDoNothing({ target: [tasks.ownerId, tasks.idempotencyKey] }).returning();
    if (!task) {
      // Covers other writers using the unique constraint without the advisory lock.
      if (dto.idempotencyKey === undefined) throw new ServiceUnavailableException();
      const [existing] = await tx.select().from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.idempotencyKey, dto.idempotencyKey))).limit(1);
      if (!existing || existing.requestHash !== requestHash) throw new ConflictException();
      return { task: serializeTask(existing), created: false };
    }
    await recordCreation(tx, task, 'task', this.events, correlationId);
    return { task: serializeTask(task), created: true };
  }

  async get(id: string) {
    return safePersistence(async () => {
      const [task] = await this.database.db.select().from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.ownerId, this.ownerId))).limit(1);
      if (!task) throw new NotFoundException();
      return serializeTask(task);
    });
  }

  async list(query: ListTasksQueryDto) {
    if (query.createdFrom && query.createdTo && new Date(query.createdFrom) > new Date(query.createdTo)) throw new BadRequestException();
    return safePersistence(async () => {
      const filters = [eq(tasks.ownerId, this.ownerId)];
      if (query.status) filters.push(eq(tasks.status, query.status));
      if (query.agentId) filters.push(eq(tasks.agentId, query.agentId));
      if (query.orchestratorId) filters.push(eq(tasks.orchestratorId, query.orchestratorId));
      if (query.createdFrom) filters.push(gte(tasks.createdAt, new Date(query.createdFrom)));
      if (query.createdTo) filters.push(lte(tasks.createdAt, new Date(query.createdTo)));
      const rows = await this.database.db.select().from(tasks).where(and(...filters))
        .orderBy(asc(tasks.createdAt), asc(tasks.id)).limit(query.limit + 1).offset(query.offset);
      return { items: rows.slice(0, query.limit).map(serializeTask),
        pagination: { limit: query.limit, offset: query.offset, hasMore: rows.length > query.limit } };
    });
  }
}
