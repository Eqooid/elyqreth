import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { isHexColor, isUUID } from 'class-validator';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { agents, executions, orchestrators, tasks } from '../database/schema';
import { PersistenceTransaction, persistenceOwner, recordCreation, safePersistence } from '../common/persistence';
import { PaginationQueryDto } from '../tasks/dto/task.dto';
import { EventsService } from '../events/events.service';
import { parseRuntimeSnapshot, RuntimeSnapshot } from '../runtime/contracts/runtime-snapshot';

type Execution = typeof executions.$inferSelect;
export type ExecutionAuthority = 'NATIVE' | 'EXTERNAL';

export function serializeExecution(execution: Execution) {
  let runtime;
  try { runtime=parseRuntimeSnapshot(execution.agentConfigSnapshot.runtime); } catch { /* Legacy/invalid snapshots expose no runtime configuration. */ }
  // Stored error text/references can originate in untrusted runtimes. Never echo them.
  const failed = execution.status === 'FAILED' || execution.status === 'TIMED_OUT' ||
    execution.errorCode !== null || execution.errorMessage !== null;
  return { id: execution.id, taskId: execution.taskId, agentId: execution.agentId,
    orchestratorId: execution.orchestratorId, attemptNumber: execution.attemptNumber, status: execution.status,
    version: execution.version, startedAt: execution.startedAt?.toISOString() ?? null,
    finishedAt: execution.finishedAt?.toISOString() ?? null,
    createdAt: execution.createdAt.toISOString(), updatedAt: execution.updatedAt.toISOString(),
    errorCode: failed ? (execution.status === 'TIMED_OUT' ? 'EXECUTION_TIMED_OUT' : 'EXECUTION_ERROR') : null,
    errorMessage: failed ? (execution.status === 'TIMED_OUT' ? 'Execution timed out.' : 'Execution reported an error.') : null,
    resultAvailability: execution.resultAvailability,
    strategyId:runtime?.definition.strategyId??null,correlationId:runtime?.correlationId??null,
    durationMs:execution.startedAt&&execution.finishedAt?Math.max(0,execution.finishedAt.getTime()-execution.startedAt.getTime()):null,
  };
}

export function nextAttemptNumber(maximum: number): number {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum >= 2147483647) throw new ConflictException();
  return maximum + 1;
}

export function executionConfigurationSnapshot(configuration: Record<string, unknown>): Record<string, unknown> {
  // Only T04's actual safe metadata schema is supported until runtime configuration is designed.
  if (Object.keys(configuration).some(key => !['category','color'].includes(key)) ||
    (configuration.category !== undefined && !['general','research','design','build','test'].includes(configuration.category as string)) ||
    (configuration.color !== undefined && (typeof configuration.color !== 'string' || !isHexColor(configuration.color)))) throw new ConflictException();
  return { ...configuration };
}

@Injectable()
export class ExecutionsService {
  constructor(private readonly database: DatabaseService, private readonly config: ApiConfig, private readonly events: EventsService) {}
  private get ownerId(): string { return persistenceOwner(this.config); }

  // Internal persistence primitive only. T06 must authorize scheduling/retry policy before calling.
  // No HTTP creation route, worker, task transition or execution takes place here.
  async createPending(taskId: string, authority: ExecutionAuthority) {
    if (!isUUID(taskId) || !['NATIVE','EXTERNAL'].includes(authority)) throw new BadRequestException();
    return safePersistence(() => this.database.db.transaction(tx => this.createPendingInTransaction(tx, taskId, authority)));
  }

  // T06 can compose allocation and its own lifecycle writes in one transaction.
  // The caller owns commit/rollback; this method performs no independent commit.
  async createPendingInTransaction(tx: PersistenceTransaction, taskId: string, authority: ExecutionAuthority, correlationId?: string, runtime?: RuntimeSnapshot) {
      if (!isUUID(taskId) || !['NATIVE','EXTERNAL'].includes(authority)) throw new BadRequestException();
      const ownerId = this.ownerId;
      const [task] = await tx.select().from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId))).for('update');
      if (!task) throw new NotFoundException();
      if (['COMPLETED','FAILED','CANCELLED'].includes(task.status)) throw new ConflictException();
      const [blocking] = await tx.select({ id: executions.id }).from(executions)
        .where(and(eq(executions.taskId, task.id), eq(executions.ownerId, ownerId), inArray(executions.status, ['PENDING','RUNNING','SUCCEEDED']))).limit(1);
      if (blocking) throw new ConflictException();
      const [agent] = await tx.select().from(agents)
        .where(and(eq(agents.id, task.agentId), eq(agents.ownerId, ownerId))).for('share');
      if (!agent || agent.orchestratorId !== task.orchestratorId || agent.lifecycleStatus !== 'ACTIVE') throw new ConflictException();
      const [orchestrator] = await tx.select().from(orchestrators)
        .where(and(eq(orchestrators.id, task.orchestratorId), eq(orchestrators.ownerId, ownerId))).for('share');
      if (!orchestrator || orchestrator.registrationStatus !== 'ENABLED') throw new ConflictException();
      const snapshot = runtime ? parseRuntimeSnapshot(runtime) : undefined;
      if (snapshot && (authority !== 'NATIVE' || snapshot.definition.agentType !== agent.type)) throw new ConflictException();
      const [last] = await tx.select({ maximum: sql<number>`coalesce(max(${executions.attemptNumber}),0)::int` })
        .from(executions).where(and(eq(executions.taskId, task.id), eq(executions.ownerId, ownerId)));
      const [execution] = await tx.insert(executions).values({
        ownerId, taskId: task.id, agentId: task.agentId, orchestratorId: task.orchestratorId,
        attemptNumber: nextAttemptNumber(last?.maximum ?? 0), status: 'PENDING', authority,
        configVersion: agent.version, agentConfigSnapshot: { ...executionConfigurationSnapshot(agent.configuration), ...(snapshot ? { runtime: snapshot } : {}) },
      }).returning();
      if (!execution) throw new ServiceUnavailableException();
      await recordCreation(tx, execution, 'execution', this.events, correlationId);
      return serializeExecution(execution);
  }

  private async requireTask(taskId: string) {
    const [task] = await this.database.db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, this.ownerId))).limit(1);
    if (!task) throw new NotFoundException();
  }

  async get(taskId: string, executionId: string) {
    return safePersistence(async () => {
      await this.requireTask(taskId);
      const [execution] = await this.database.db.select().from(executions)
        .where(and(eq(executions.id, executionId), eq(executions.taskId, taskId), eq(executions.ownerId, this.ownerId))).limit(1);
      if (!execution) throw new NotFoundException();
      return serializeExecution(execution);
    });
  }

  async list(taskId: string, query: PaginationQueryDto) {
    return safePersistence(async () => {
      await this.requireTask(taskId);
      const rows = await this.database.db.select().from(executions)
        .where(and(eq(executions.taskId, taskId), eq(executions.ownerId, this.ownerId)))
        .orderBy(asc(executions.attemptNumber), asc(executions.id)).limit(query.limit + 1).offset(query.offset);
      return { items: rows.slice(0, query.limit).map(serializeExecution),
        pagination: { limit: query.limit, offset: query.offset, hasMore: rows.length > query.limit } };
    });
  }
}
