import { actorReference as authenticatedActor } from '../auth/principal';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { agents, commandAudit, orchestrators, owners } from '../database/schema';
import { EventsService } from '../events/events.service';
import { EventType } from '../events/contracts/event-contracts';
import { isUUID } from 'class-validator';
import { CreateAgentDto, ListAgentsQueryDto, UpdateAgentDto } from './dto/agent.dto';

type Agent = typeof agents.$inferSelect;
type Status = Agent['lifecycleStatus'];
type Transaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

export function serializeAgent(agent: Agent) {
  // T03 allows legacy arbitrary JSON: never serialize it back to API consumers.
  return {
    id: agent.id, name: agent.name, description: agent.description, type: agent.type,
    orchestratorId: agent.orchestratorId, lifecycleStatus: agent.lifecycleStatus,
    capabilities: agent.capabilities, version: agent.version,
    createdAt: agent.createdAt.toISOString(), updatedAt: agent.updatedAt.toISOString(),
  };
}

export function expectedVersion(header: string | undefined): number {
  if (!header || !/^"[1-9][0-9]{0,9}"$/.test(header)) throw new BadRequestException();
  const version = Number(header.slice(1, -1));
  if (version > 2147483647) throw new BadRequestException();
  return version;
}

export function lifecycleTransition(current: Status, target: Status): boolean {
  if (current === target) return false;
  if (current === 'ARCHIVED') throw new ConflictException();
  return true; // ACTIVE/DISABLED can toggle or permanently archive.
}

@Injectable()
export class AgentsService implements OnModuleInit {
  constructor(private readonly database: DatabaseService, private readonly config: ApiConfig, private readonly events: EventsService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.value.registry) return;
    const [owner] = await this.database.db.select({ id: owners.id }).from(owners)
      .where(eq(owners.id, this.ownerId)).limit(1);
    if (!owner) throw new Error('Agent registry owner scope does not exist. Provision it before enabling the registry.');
  }

  private get ownerId(): string {
    const owner = this.config.value.registry?.ownerId;
    if (!owner) throw new ServiceUnavailableException();
    return owner;
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      // Drizzle wraps driver errors. Never pass query/parameters or driver text to HTTP/logs.
      const candidate = error as { code?: string; cause?: { code?: string } };
      const code = candidate.cause?.code ?? candidate.code;
      if (code === '23505' || code === '40001' || code === '40P01') throw new ConflictException();
      if (code === '23503' || code === '23514') throw new BadRequestException();
      if (code || (error instanceof Error && error.message.startsWith('Failed query:'))) throw new ServiceUnavailableException();
      throw error;
    }
  }

  async get(id: string) {
    return this.safe(async () => {
      const [agent] = await this.database.db.select().from(agents)
        .where(and(eq(agents.id, id), eq(agents.ownerId, this.ownerId))).limit(1);
      if (!agent) throw new NotFoundException();
      return serializeAgent(agent);
    });
  }

  async list(query: ListAgentsQueryDto) {
    return this.safe(async () => {
      const filters = [eq(agents.ownerId, this.ownerId)];
      if (query.status) filters.push(eq(agents.lifecycleStatus, query.status));
      if (query.type) filters.push(eq(agents.type, query.type));
      if (query.orchestratorId) filters.push(eq(agents.orchestratorId, query.orchestratorId));
      if (query.search) filters.push(ilike(agents.name, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`));
      const rows = await this.database.db.select().from(agents).where(and(...filters))
        .orderBy(asc(agents.createdAt), asc(agents.id)).limit(query.limit + 1).offset(query.offset);
      return { items: rows.slice(0, query.limit).map(serializeAgent),
        pagination: { limit: query.limit, offset: query.offset, hasMore: rows.length > query.limit } };
    });
  }

  async create(dto: CreateAgentDto) {
    return this.safe(() => this.database.db.transaction(async tx => {
      const [orchestrator] = await tx.select({ id: orchestrators.id }).from(orchestrators)
        .where(and(eq(orchestrators.id, dto.orchestratorId), eq(orchestrators.ownerId, this.ownerId))).limit(1);
      if (!orchestrator) throw new BadRequestException();
      // Disabled or disconnected orchestrators can own registrations; no connection is made.
      const [agent] = await tx.insert(agents).values({
        ownerId: this.ownerId, orchestratorId: dto.orchestratorId, name: dto.name,
        description: dto.description ?? null, type: dto.type, lifecycleStatus: 'DISABLED',
        capabilities: dto.capabilities ?? [], configuration: { ...dto.configuration },
      }).returning();
      if (!agent) throw new ServiceUnavailableException();
      await this.record(tx, agent, 'agent.registered');
      return serializeAgent(agent);
    }));
  }

  /** Internal configuration application only; no new HTTP creation surface.
   * Caller declares a stable Registry UUID so interrupted/repeated application converges.
   * Existing registrations, especially native/disabled ones, are never taken over. */
  async registerConfiguredHermes(id: string, name: string, orchestratorId: string, authorize: () => void) {
    authorize();
    if (!isUUID(id) || !isUUID(orchestratorId) || !name || name.length > 160 || /[\u0000-\u001f\u007f]/u.test(name))
      throw new BadRequestException();
    return this.safe(() => this.database.db.transaction(async tx => {
      authorize();
      const [route] = await tx.select().from(orchestrators).where(and(eq(orchestrators.id, orchestratorId), eq(orchestrators.ownerId, this.ownerId))).for('share');
      if (!route || route.type !== 'hermes.v1' || route.registrationStatus !== 'ENABLED') throw new BadRequestException();
      const [existing] = await tx.select().from(agents).where(and(eq(agents.id, id), eq(agents.ownerId, this.ownerId))).for('update');
      if (existing) {
        if (existing.type !== 'EXTERNAL' || existing.orchestratorId !== orchestratorId || existing.lifecycleStatus === 'ARCHIVED') throw new ConflictException();
        authorize(); return serializeAgent(existing);
      }
      const [created] = await tx.insert(agents).values({ id, ownerId: this.ownerId, orchestratorId, name,
        type: 'EXTERNAL', lifecycleStatus: 'DISABLED', capabilities: [], configuration: {} }).returning();
      if (!created) throw new ServiceUnavailableException();
      await this.record(tx, created, 'agent.registered');
      const [active] = await tx.update(agents).set({ lifecycleStatus: 'ACTIVE' }).where(eq(agents.id, created.id)).returning();
      if (!active) throw new ServiceUnavailableException();
      await this.record(tx, active, 'agent.active');
      authorize();
      return serializeAgent(active);
    }));
  }

  async registerConfiguredHermesConnection(id: string, name: string, authorize: () => void) {
    authorize();
    if (!isUUID(id) || !name || name.length > 160 || /[\u0000-\u001f\u007f]/u.test(name)) throw new BadRequestException();
    return this.safe(() => this.database.db.transaction(async tx => {
      authorize();
      const [existing] = await tx.select().from(orchestrators).where(eq(orchestrators.id, id)).for('update');
      if (existing) {
        if (existing.ownerId !== this.ownerId || existing.type !== 'hermes.v1' || existing.registrationStatus !== 'ENABLED') throw new ConflictException();
        authorize(); return existing.id;
      }
      const [created] = await tx.insert(orchestrators).values({ id, ownerId: this.ownerId, name, type: 'hermes.v1', registrationStatus: 'ENABLED' }).returning();
      if (!created) throw new ServiceUnavailableException();
      await tx.insert(commandAudit).values({ ownerId: this.ownerId, actorReference: authenticatedActor('local-development-operator'),
        commandType: 'external.connection.registered', resourceType: 'orchestrator', resourceId: id, correlationId: randomUUID(), outcome: 'ACCEPTED', details: {} });
      authorize(); return created.id;
    }));
  }

  async update(id: string, dto: UpdateAgentDto, version: number) {
    if (!Object.values(dto).some(value => value !== undefined)) throw new BadRequestException();
    return this.mutate(id, version, 'agent.updated', agent => {
      if (agent.lifecycleStatus === 'ARCHIVED') throw new ConflictException();
      // Explicit assignment prevents mass assignment even if this method is called internally.
      return {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.capabilities !== undefined ? { capabilities: dto.capabilities } : {}),
        ...(dto.configuration !== undefined ? { configuration: { ...dto.configuration } } : {}),
      };
    });
  }

  async lifecycle(id: string, status: Status, version: number) {
    const event = {ACTIVE:'agent.active',DISABLED:'agent.disabled',ARCHIVED:'agent.archived'} as const;
    return this.mutate(id, version, event[status], agent =>
      lifecycleTransition(agent.lifecycleStatus, status) ? { lifecycleStatus: status } : undefined);
  }

  private async mutate(id: string, version: number, event: EventType,
    changes: (agent: Agent) => Partial<typeof agents.$inferInsert> | undefined) {
    return this.safe(() => this.database.db.transaction(async tx => {
      const [agent] = await tx.select().from(agents)
        .where(and(eq(agents.id, id), eq(agents.ownerId, this.ownerId))).for('update');
      if (!agent) throw new NotFoundException();
      const values = changes(agent);
      if (!values) return serializeAgent(agent);
      if (agent.version !== version) throw new ConflictException();
      if (Object.entries(values).every(([key,value]) => isDeepStrictEqual(agent[key as keyof Agent],value))) return serializeAgent(agent);
      const [updated] = await tx.update(agents).set(values).where(eq(agents.id, agent.id)).returning();
      if (!updated) throw new ServiceUnavailableException();
      await this.record(tx, updated, event);
      return serializeAgent(updated);
    }));
  }

  private async record(tx: Transaction, agent: Agent, eventType: EventType) {
    const correlationId = randomUUID();
    await this.events.appendState(tx,{ownerId:this.ownerId,eventType,aggregateId:agent.id,correlationId});
    await tx.insert(commandAudit).values({ ownerId: this.ownerId,
      actorReference: authenticatedActor('local-development-operator'), commandType: eventType, resourceType: 'agent',
      resourceId: agent.id, correlationId, outcome: 'ACCEPTED', details: { version: agent.version } });
  }
}
