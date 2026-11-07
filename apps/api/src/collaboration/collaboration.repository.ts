import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module';
import { agentEvents, collaborationSessions as sessions, collaborationParticipants as participants,
  collaborationDelegations as delegations, commandAudit } from '../database/schema';
import type { PersistenceTransaction } from '../common/persistence';
import { CollaborationError, CollaborationScope, DelegationStatus, PageQuery, SessionStatus,
  commandHash, commandKey, identifier, page, scope, transition, version } from './collaboration.domain';

type Session = typeof sessions.$inferSelect;
type Delegation = typeof delegations.$inferSelect;
function sessionView(row: Session) {
  return Object.freeze({ id: row.id, authority: row.authority, rootTaskId: row.rootTaskId, status: row.status, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null });
}
function delegationView(row: Delegation) {
  return Object.freeze({ id: row.id, sessionId: row.sessionId, sourceAgentId: row.sourceAgentId, targetAgentId: row.targetAgentId,
    parentTaskId: row.parentTaskId, childTaskId: row.childTaskId, continuationTaskId: row.continuationTaskId,
    sourceExecutionId: row.sourceExecutionId, childExecutionId: row.childExecutionId, continuationExecutionId: row.continuationExecutionId,
    status: row.status, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null });
}
export interface CreateSession {
  readonly authority?: 'NATIVE' | 'EXTERNAL'; readonly rootTaskId?: string; readonly participantAgentIds: readonly string[];
  readonly idempotencyKey: string;
}
export interface CreateDelegation {
  readonly sessionId: string; readonly sourceAgentId: string; readonly targetAgentId: string; readonly parentTaskId: string;
  readonly sourceExecutionId?: string; readonly idempotencyKey: string;
}
export interface DelegationUpdate {
  readonly status?: DelegationStatus; readonly childTaskId?: string; readonly childExecutionId?: string;
  readonly continuationTaskId?: string; readonly continuationExecutionId?: string;
}
type Fact = 'collaboration.created' | 'collaboration.state_changed' | 'collaboration.participant_added' |
  'collaboration.participant_left' | 'delegation.recorded' | 'delegation.state_changed' | 'delegation.child_associated' | 'delegation.correlated';

/** Internal persistence facade. The caller must establish authorization; this is not a principal resolver. */
export class CollaborationTransaction {
  constructor(private readonly tx: PersistenceTransaction, private readonly context: CollaborationScope) {}
  private get ownerId() { return this.context.ownerId; }
  private async session(id: string) {
    const [row] = await this.tx.select().from(sessions).where(and(eq(sessions.id, identifier(id)), eq(sessions.ownerId, this.ownerId))).for('update');
    if (!row) throw new CollaborationError('NOT_FOUND');
    return row;
  }
  private async delegation(id: string) {
    const [row] = await this.tx.select().from(delegations).where(and(eq(delegations.id, identifier(id)), eq(delegations.ownerId, this.ownerId))).for('update');
    if (!row) throw new CollaborationError('NOT_FOUND');
    return row;
  }
  private open(row: Session) {
    if (!['CREATED', 'ACTIVE', 'WAITING'].includes(row.status)) throw new CollaborationError('INVALID_TRANSITION');
  }
  private expected(actual: number, expected: number) {
    if (actual !== version(expected)) throw new CollaborationError('CONFLICT');
  }
  private async fact(eventType: Fact, session: Session, delegation?: Delegation, agentId?: string) {
    const record = delegation ?? session, kind = delegation ? 'delegation' : 'collaboration';
    const payload = { status: record.status, version: record.version, ...(agentId ? { participantAgentId: agentId } : {}),
      ...(delegation ? { sourceAgentId: delegation.sourceAgentId, targetAgentId: delegation.targetAgentId, parentTaskId: delegation.parentTaskId, childTaskId: delegation.childTaskId,
        sourceExecutionId: delegation.sourceExecutionId, childExecutionId: delegation.childExecutionId,
        continuationTaskId: delegation.continuationTaskId, continuationExecutionId: delegation.continuationExecutionId } : {}) };
    await this.tx.insert(agentEvents).values({ ownerId: this.ownerId, eventType, aggregateType: kind, aggregateId: record.id,
      collaborationId: session.id, delegationId: delegation?.id ?? null, aggregateVersion: record.version, aggregateSequence: BigInt(record.version),
      source: 'elyqreth.collaboration.v1', sourceEventId: `${kind}:${record.id}:${record.version}`,
      correlationId: this.context.correlationId, payload, occurredAt: record.updatedAt });
    // The existing event trigger creates the outbox entry in this same transaction. No publisher.
    await this.tx.insert(commandAudit).values({ ownerId: this.ownerId, actorReference: this.context.actorReference,
      commandType: eventType, resourceType: kind, resourceId: record.id, correlationId: this.context.correlationId,
      outcome: 'ACCEPTED', details: { sessionId: session.id, version: record.version, ...(delegation ? { sourceAgentId: delegation.sourceAgentId, targetAgentId: delegation.targetAgentId, parentTaskId: delegation.parentTaskId, sourceExecutionId: delegation.sourceExecutionId } : {}) } });
  }
  async createSession(input: CreateSession) {
    const key = commandKey(input.idempotencyKey), authority = input.authority ?? 'NATIVE';
    if (!['NATIVE', 'EXTERNAL'].includes(authority) || !Array.isArray(input.participantAgentIds) ||
      input.participantAgentIds.length < 1 || input.participantAgentIds.length > 20) throw new CollaborationError('INVALID_INPUT');
    const ids = input.participantAgentIds.map(identifier).sort();
    if (new Set(ids).size !== ids.length) throw new CollaborationError('INVALID_INPUT');
    const rootTaskId = input.rootTaskId === undefined ? null : identifier(input.rootTaskId);
    const hash = commandHash([authority, rootTaskId, ...ids]);
    const [existing] = await this.tx.select().from(sessions).where(and(eq(sessions.ownerId, this.ownerId),
      eq(sessions.actorReference, this.context.actorReference), eq(sessions.idempotencyKey, key)));
    if (existing) {
      if (existing.requestHash !== hash) throw new CollaborationError('IDEMPOTENCY_CONFLICT');
      return sessionView(existing);
    }
    const [created] = await this.tx.insert(sessions).values({ ownerId: this.ownerId, authority, rootTaskId,
      actorReference: this.context.actorReference, idempotencyKey: key, requestHash: hash }).returning();
    if (!created) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    await this.fact('collaboration.created', created);
    for (const agentId of ids) await this.addParticipant(created.id, agentId);
    return this.getSession(created.id);
  }
  async findSessionByKey(key: string) {
    const [row] = await this.tx.select().from(sessions).where(and(eq(sessions.ownerId, this.ownerId),
      eq(sessions.actorReference, this.context.actorReference), eq(sessions.idempotencyKey, commandKey(key))));
    return row ? sessionView(row) : null;
  }
  async getSession(id: string) { return sessionView(await this.session(id)); }
  async listSessions(query: PageQuery = {}) {
    const q = page(query);
    const rows = await this.tx.select().from(sessions).where(and(eq(sessions.ownerId, this.ownerId), ...(q.after ? [gt(sessions.id, q.after)] : [])))
      .orderBy(asc(sessions.id)).limit(q.limit + 1);
    return { items: rows.slice(0, q.limit).map(sessionView), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }
  async addParticipant(sessionId: string, agentId: string, role: 'COORDINATOR' | 'DELEGATE' = 'DELEGATE') {
    const session = await this.session(sessionId); this.open(session); agentId = identifier(agentId);
    if (!['COORDINATOR', 'DELEGATE'].includes(role)) throw new CollaborationError('INVALID_INPUT');
    const [prior] = await this.tx.select().from(participants).where(and(eq(participants.ownerId, this.ownerId),
      eq(participants.sessionId, session.id), eq(participants.agentId, agentId)));
    if (prior) {
      if (prior.role !== role || prior.leftAt) throw new CollaborationError('CONFLICT');
      return prior.id;
    }
    const [member] = await this.tx.insert(participants).values({ ownerId: this.ownerId, sessionId: session.id, agentId, role }).returning();
    if (!member) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    const [updated] = await this.tx.update(sessions).set({ updatedAt: sql`clock_timestamp()` }).where(eq(sessions.id, session.id)).returning();
    if (!updated) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    await this.fact('collaboration.participant_added', updated, undefined, agentId);
    return member.id;
  }
  async leaveParticipant(sessionId: string, agentId: string, expectedVersion: number) {
    const session = await this.session(sessionId); this.open(session); this.expected(session.version, expectedVersion);
    const [member] = await this.tx.update(participants).set({ leftAt: sql`clock_timestamp()` }).where(and(eq(participants.ownerId, this.ownerId),
      eq(participants.sessionId, session.id), eq(participants.agentId, identifier(agentId)))).returning();
    if (!member) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    if (!member) throw new CollaborationError('NOT_FOUND');
    const [updated] = await this.tx.update(sessions).set({ updatedAt: sql`clock_timestamp()` }).where(eq(sessions.id, session.id)).returning();
    if (!updated) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    await this.fact('collaboration.participant_left', updated, undefined, member.agentId);
    return sessionView(updated);
  }
  async listParticipants(sessionId: string, query: PageQuery = {}) {
    const session = await this.session(sessionId), q = page(query);
    const rows = await this.tx.select().from(participants).where(and(eq(participants.ownerId, this.ownerId), eq(participants.sessionId, session.id),
      ...(q.after ? [gt(participants.id, q.after)] : []))).orderBy(asc(participants.id)).limit(q.limit + 1);
    return { items: rows.slice(0, q.limit).map(r => ({ id: r.id, agentId: r.agentId, role: r.role,
      joinedAt: r.joinedAt.toISOString(), leftAt: r.leftAt?.toISOString() ?? null })), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }
  async updateSession(id: string, expectedVersion: number, status: SessionStatus) {
    const current = await this.session(id); this.expected(current.version, expectedVersion); transition('session', current.status, status);
    const [updated] = await this.tx.update(sessions).set({ status,
      finishedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? sql`clock_timestamp()` : null }).where(eq(sessions.id, current.id)).returning();
    if (!updated) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    await this.fact('collaboration.state_changed', updated);
    return sessionView(updated);
  }
  async createDelegation(input: CreateDelegation) {
    const key = commandKey(input.idempotencyKey), sessionId = identifier(input.sessionId), sourceAgentId = identifier(input.sourceAgentId),
      targetAgentId = identifier(input.targetAgentId), parentTaskId = identifier(input.parentTaskId),
      sourceExecutionId = input.sourceExecutionId === undefined ? null : identifier(input.sourceExecutionId);
    if (sourceAgentId === targetAgentId) throw new CollaborationError('INVALID_INPUT');
    const hash = commandHash([sessionId, sourceAgentId, targetAgentId, parentTaskId, sourceExecutionId]);
    const session = await this.session(sessionId);
    const existing = await this.findDelegationByKey(key);
    if (existing) {
      const [stored] = await this.tx.select().from(delegations).where(eq(delegations.id, existing.id));
      if (!stored || stored.requestHash !== hash) throw new CollaborationError('IDEMPOTENCY_CONFLICT');
      return existing;
    }
    this.open(session);
    const [created] = await this.tx.insert(delegations).values({ ownerId: this.ownerId, sessionId, sourceAgentId, targetAgentId,
      parentTaskId, sourceExecutionId, actorReference: this.context.actorReference, idempotencyKey: key, requestHash: hash }).returning();
    if (!created) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    await this.fact('delegation.recorded', session, created);
    return delegationView(created);
  }
  async getDelegation(id: string) { return delegationView(await this.delegation(id)); }
  async findDelegationByKey(key: string) {
    const [row] = await this.tx.select().from(delegations).where(and(eq(delegations.ownerId, this.ownerId),
      eq(delegations.actorReference, this.context.actorReference), eq(delegations.idempotencyKey, commandKey(key))));
    return row ? delegationView(row) : null;
  }
  async listDelegations(sessionId: string, query: PageQuery = {}) {
    const session = await this.session(sessionId), q = page(query);
    const rows = await this.tx.select().from(delegations).where(and(eq(delegations.ownerId, this.ownerId), eq(delegations.sessionId, session.id),
      ...(q.after ? [gt(delegations.id, q.after)] : []))).orderBy(asc(delegations.id)).limit(q.limit + 1);
    return { items: rows.slice(0, q.limit).map(delegationView), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }
  async updateDelegation(id: string, expectedVersion: number, patch: DelegationUpdate) {
    const current = await this.delegation(id), session = await this.session(current.sessionId); this.open(session);
    this.expected(current.version, expectedVersion);
    const keys = Object.keys(patch), allowed = ['status', 'childTaskId', 'childExecutionId', 'continuationTaskId', 'continuationExecutionId'];
    if (!keys.length || keys.some(k => !allowed.includes(k))) throw new CollaborationError('INVALID_INPUT');
    const update: Partial<typeof delegations.$inferInsert> = {};
    for (const key of ['childTaskId', 'childExecutionId', 'continuationTaskId', 'continuationExecutionId'] as const)
      if (Object.hasOwn(patch, key)) update[key] = identifier(patch[key]);
    if (patch.status !== undefined) { transition('delegation', current.status, patch.status); update.status = patch.status; }
    if (!Object.keys(update).length) throw new CollaborationError('INVALID_INPUT');
    const [updated] = await this.tx.update(delegations).set({ ...update, ...(patch.status && !delegationTransitionsOpen(patch.status) ? { finishedAt: sql`clock_timestamp()` } : {}) }).where(eq(delegations.id, current.id)).returning();
    if (!updated) throw new CollaborationError('PERSISTENCE_UNAVAILABLE');
    await this.fact(current.childTaskId !== updated.childTaskId ? 'delegation.child_associated' :
      current.status !== updated.status ? 'delegation.state_changed' : 'delegation.correlated', session, updated);
    return delegationView(updated);
  }
}
function delegationTransitionsOpen(status: DelegationStatus) { return ['REQUESTED', 'ACCEPTED', 'EXECUTING', 'AWAITING_RETURN'].includes(status); }

@Injectable()
export class CollaborationRepository {
  constructor(private readonly database: DatabaseService) {}
  /** Caller can compose existing persistence work on the same transaction; no network/runtime side effects. */
  async run<T>(context: CollaborationScope, operation: (repository: CollaborationTransaction, tx: PersistenceTransaction) => Promise<T>): Promise<T> {
    const trusted = scope(context);
    try {
      return await this.database.db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${trusted.ownerId + ':collaboration'},0))`);
        return operation(new CollaborationTransaction(tx, trusted), tx);
      });
    } catch (error) {
      if (error instanceof CollaborationError) throw error;
      const candidate = error as { code?: string; cause?: { code?: string } } | null, code = candidate?.cause?.code ?? candidate?.code;
      throw new CollaborationError(['23505', '40001', '40P01'].includes(code ?? '') ? 'CONFLICT' :
        ['23503', '23514', '22P02'].includes(code ?? '') ? 'INVALID_INPUT' : 'PERSISTENCE_UNAVAILABLE');
    }
  }
}
