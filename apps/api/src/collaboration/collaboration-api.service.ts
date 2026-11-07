import { actorReference as authenticatedActor } from '../auth/principal';
import { operationalMode } from '../auth/principal';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import { requestContext } from '../common/request-context';
import type { PersistenceTransaction } from '../common/persistence';
import { agents, commandAudit, collaborationDelegations, collaborationParticipants, executions, orchestrators, tasks } from '../database/schema';
import { CollaborationRepository, CollaborationTransaction } from './collaboration.repository';
import { CollaborationError, CollaborationScope, identifier, PageQuery } from './collaboration.domain';
import { CreateCollaborationDto, RequestDelegationDto } from './collaboration.dto';
import { activeMembers, eligibleAgent, nativeSession, openSession, parentContext, successfulSource } from './collaboration.policy';
import { cancellationRequested } from './collaboration-control';

@Injectable()
export class CollaborationApiService {
  constructor(private readonly repository: CollaborationRepository, private readonly config: ApiConfig, private readonly logger: ApiLogger) {}
  operatorContext(): CollaborationScope {
    const c = this.config.value, requestId = requestContext.getStore()?.requestId;
    if (!c.registry || !operationalMode(c)) throw new CollaborationError('NOT_FOUND');
    return { ownerId: c.registry.ownerId, actorReference: authenticatedActor('local-collaboration-operator'),
      correlationId: requestId && isUUID(requestId) ? requestId.toLowerCase() : randomUUID() };
  }
  async operatorChange<T>(operation: 'create' | 'request' | 'activate', fn: (r: CollaborationTransaction, tx: PersistenceTransaction, c: CollaborationScope) => Promise<T>): Promise<T> {
    const context = this.operatorContext();
    try {
      const value = await this.repository.run(context, (r, tx) => fn(r, tx, context));
      try { this.logger.info('collaboration.authorized', { operation, correlationId: context.correlationId }); } catch { /* Diagnostics only. */ }
      return value;
    } catch (error) {
      if (error instanceof CollaborationError) {
        try { this.logger.info('collaboration.denied', { operation, code: error.code, correlationId: context.correlationId }); } catch { /* Diagnostics only. */ }
        // A rejected authenticated attempt is distinct from accepted domain facts. Never masks the original error.
        if (error.code !== 'PERSISTENCE_UNAVAILABLE') try {
          await this.repository.run(context, async (_, tx) => {
            await tx.insert(commandAudit).values({ ownerId: context.ownerId, actorReference: context.actorReference,
              commandType: `collaboration.${operation}.rejected`, resourceType: 'collaboration',
              correlationId: context.correlationId, outcome: 'REJECTED', details: { code: error.code } });
          });
        } catch { /* No credentials/driver diagnostics; denial remains authoritative. */ }
      }
      throw error;
    }
  }
  private async task(tx: PersistenceTransaction, ownerId: string, id: string) {
    const [row] = await tx.select({ id: tasks.id, agentId: tasks.agentId, orchestratorId: tasks.orchestratorId, status: tasks.status })
      .from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.id, identifier(id)))).for('share');
    if (!row) throw new CollaborationError('NOT_FOUND');
    return row;
  }
  private async agentRows(tx: PersistenceTransaction, ownerId: string, ids: readonly string[]) {
    const normalized = [...new Set(ids.map(identifier))].sort();
    const rows = await tx.select({ id: agents.id, orchestratorId: agents.orchestratorId, lifecycleStatus: agents.lifecycleStatus, type: agents.type })
      .from(agents).where(and(eq(agents.ownerId, ownerId), inArray(agents.id, normalized))).orderBy(asc(agents.id)).for('share');
    if (rows.length !== normalized.length) throw new CollaborationError('NOT_FOUND');
    return rows;
  }
  private async eligibleRoutes(tx: PersistenceTransaction, ownerId: string, rows: Awaited<ReturnType<CollaborationApiService['agentRows']>>) {
    const routes = await tx.select({ id: orchestrators.id, status: orchestrators.registrationStatus }).from(orchestrators)
      .where(and(eq(orchestrators.ownerId, ownerId), inArray(orchestrators.id, [...new Set(rows.map(a => a.orchestratorId))])))
      .orderBy(asc(orchestrators.id)).for('share');
    for (const agent of rows) eligibleAgent(agent, routes.some(r => r.id === agent.orchestratorId && r.status === 'ENABLED'));
  }
  async create(input: CreateCollaborationDto) {
    return this.operatorChange('create', async (r, tx, c) => {
      const parent = await this.task(tx, c.ownerId, input.rootTaskId);
      const ids = input.participantAgentIds.map(identifier);
      if (ids.length !== 2 || new Set(ids).size !== 2 || !ids.includes(parent.agentId)) throw new CollaborationError('INVALID_RELATION');
      const rows = await this.agentRows(tx, c.ownerId, ids), existing = await r.findSessionByKey(input.idempotencyKey);
      if (!existing) {
        await this.eligibleRoutes(tx, c.ownerId, rows);
        if (['FAILED', 'CANCELLED'].includes(parent.status) || !rows.some(a => a.id === parent.agentId && a.orchestratorId === parent.orchestratorId))
          throw new CollaborationError('INELIGIBLE_TASK');
      }
      const value = await r.createSession({ authority: 'NATIVE', rootTaskId: parent.id, participantAgentIds: ids, idempotencyKey: input.idempotencyKey });
      nativeSession(value.authority);
      return { value, created: !existing };
    });
  }
  async detail(id: string) {
    return this.repository.run(this.operatorContext(), async r => { const value = await r.getSession(id); nativeSession(value.authority); return value; });
  }
  async lookupSession(key: string) {
    return this.repository.run(this.operatorContext(), async r => { const value = await r.findSessionByKey(key); if (value) nativeSession(value.authority); return { collaboration: value }; });
  }
  async participants(id: string, query: PageQuery) {
    return this.repository.run(this.operatorContext(), async r => { nativeSession((await r.getSession(id)).authority); return r.listParticipants(id, query); });
  }
  async request(sessionId: string, input: RequestDelegationDto) {
    sessionId = identifier(sessionId);
    return this.operatorChange('request', async (r, tx, c) => {
      const session = await r.getSession(sessionId); nativeSession(session.authority);
      const parent = await this.task(tx, c.ownerId, input.parentTaskId);
      // Parent lock precedes attempt and Agent locks, matching the existing native lifecycle convention.
      const [attempt] = await tx.select({ id: executions.id, taskId: executions.taskId, agentId: executions.agentId,
        status: executions.status, authority: executions.authority }).from(executions)
        .where(and(eq(executions.ownerId, c.ownerId), eq(executions.taskId, parent.id)))
        .orderBy(desc(executions.attemptNumber)).limit(1).for('share');
      const rows = await this.agentRows(tx, c.ownerId, [input.sourceAgentId, input.targetAgentId]);
      const existing = await r.findDelegationByKey(input.idempotencyKey);
      // Recovery is an authorized read of the original intent, not another admission or lifecycle action.
      if (!existing) {
        openSession(session.status);
        if (await cancellationRequested(tx, c.ownerId, session.id)) throw new CollaborationError('INVALID_TRANSITION');
        await this.eligibleRoutes(tx, c.ownerId, rows);
        const members = await tx.select({ agentId: collaborationParticipants.agentId, role: collaborationParticipants.role, leftAt: collaborationParticipants.leftAt })
          .from(collaborationParticipants).where(and(eq(collaborationParticipants.ownerId, c.ownerId), eq(collaborationParticipants.sessionId, session.id))).for('share');
        activeMembers(members, input.sourceAgentId, input.targetAgentId);
        if (members.filter(m => m.leftAt === null).length !== 2) throw new CollaborationError('LIMIT_EXCEEDED');
        const source = rows.find(a => a.id === input.sourceAgentId);
        if (!source) throw new CollaborationError('NOT_FOUND');
        successfulSource(parent, attempt, source, input.sourceExecutionId);
        const relations = await tx.select({ parentTaskId: collaborationDelegations.parentTaskId, childTaskId: collaborationDelegations.childTaskId,
          continuationTaskId: collaborationDelegations.continuationTaskId, status: collaborationDelegations.status }).from(collaborationDelegations)
          .where(and(eq(collaborationDelegations.ownerId, c.ownerId), eq(collaborationDelegations.sessionId, session.id))).limit(3);
        parentContext(session.rootTaskId, relations, parent.id);
        if (relations.some(d => ['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(d.status))) throw new CollaborationError('INVALID_TRANSITION');
      }
      const value = await r.createDelegation({ ...input, sessionId });
      return { value, created: !existing };
    });
  }
  async delegation(sessionId: string, id: string) {
    return this.repository.run(this.operatorContext(), async r => {
      const session = await r.getSession(sessionId); nativeSession(session.authority);
      const value = await r.getDelegation(id);
      if (value.sessionId !== session.id) throw new CollaborationError('NOT_FOUND');
      return value;
    });
  }
  async history(sessionId: string, query: PageQuery) {
    return this.repository.run(this.operatorContext(), async r => { nativeSession((await r.getSession(sessionId)).authority); return r.listDelegations(sessionId, query); });
  }
  async lookupDelegation(sessionId: string, key: string) {
    return this.repository.run(this.operatorContext(), async r => {
      const session = await r.getSession(sessionId); nativeSession(session.authority);
      const value = await r.findDelegationByKey(key);
      return { delegation: value?.sessionId === session.id ? value : null };
    });
  }
}
