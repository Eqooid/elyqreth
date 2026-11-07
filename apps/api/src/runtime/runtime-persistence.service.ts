import { RuntimeHostService } from './runtime-host.service';
import { operationalMode } from '../auth/principal';
import { delegatedAdmission } from '../collaboration/native-delegation.admission';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { agents, executionResults, executions, orchestrators, tasks } from '../database/schema';
import { PersistenceTransaction } from '../common/persistence';
import { TaskLifecycleService } from '../lifecycle/task-lifecycle.service';
import { LifecycleError } from '../lifecycle/lifecycle-policy';
import { serializeTask } from '../tasks/tasks.service';
import { executionConfigurationSnapshot, serializeExecution } from '../executions/executions.service';
import { isLoopback } from '../agents/registry-configuration';
import { ExecutionContextFactory } from './context/execution-context.factory';
import { createRuntimeExecutionRequest, RuntimeExecutionRequest } from './contracts/execution-request.contract';
import { createRuntimeExecutionResult, RuntimeExecutionResult } from './contracts/execution-result.contract';
import { RuntimeError, RuntimeErrorCode } from './contracts/runtime-error.contract';
import { RuntimeDefinition } from './contracts/definition.contract';
import { definitionDigest, parseRuntimeSnapshot, runtimeSnapshot } from './contracts/runtime-snapshot';
import { AgentStrategy } from './contracts/agent-strategy.contract';
import { RuntimeExecutionContext } from './contracts/execution-context.contract';
import { ExecuteTaskCommand } from './runtime-command';
import { authorizeInteractionMutation } from '../interaction/interaction.authorization';

type Task = typeof tasks.$inferSelect;
type Execution = typeof executions.$inferSelect;
type Pair = { task: ReturnType<typeof serializeTask>; execution: ReturnType<typeof serializeExecution> };
export interface RuntimeAdmission extends Pair {
  request: RuntimeExecutionRequest; strategy: AgentStrategy; context?: RuntimeExecutionContext; leaseToken?: string;
}
export interface RuntimeCompletion extends Pair {
  resultReference?: string; result?: RuntimeExecutionResult; observed?: boolean; error?: ReturnType<RuntimeError['toJSON']>;
}
export const NATIVE_LEASE_MS = 20000;
export const NATIVE_HEARTBEAT_MS = 5000;

@Injectable()
export class RuntimePersistenceService {
  // Only contexts from successfully committed claims get tool authority. A
  // caller-created request/context or copied admission cannot mint this proof.
  readonly #toolClaims=new WeakMap<RuntimeExecutionContext,RuntimeAdmission>();
  constructor(private readonly database: DatabaseService, private readonly config: ApiConfig,
    private readonly lifecycle: TaskLifecycleService, private readonly contexts: ExecutionContextFactory, private readonly host:RuntimeHostService) {}

  private settings() {
    const value = this.config.value;
    if (!value.runtime || !value.registry || !operationalMode(value))
      throw new RuntimeError('ACCESS_DENIED', 'request');
    return { ownerId: value.registry.ownerId, bindings: value.runtime.bindings };
  }
  private async transaction<T>(fn: (tx: PersistenceTransaction) => Promise<T>): Promise<T> {
    this.settings();
    try { return await this.database.db.transaction(fn); }
    catch (error) {
      if (error instanceof RuntimeError) throw error;
      if (error instanceof LifecycleError) throw new RuntimeError(
        ['LIFECYCLE_CONFLICT','ALREADY_TERMINAL'].includes(error.code) ? 'LEASE_LOST' : 'INVALID_INPUT', 'request');
      const wrapped = error as {code?: string; cause?: {code?: string}} | null;
      if (['23505','40001','40P01'].includes(wrapped?.cause?.code ?? wrapped?.code ?? '')) throw new RuntimeError('CAPACITY_EXCEEDED', 'request');
      throw new RuntimeError('PERSISTENCE_UNAVAILABLE', 'request');
    }
  }
  private async task(tx: PersistenceTransaction, taskId: string) {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.ownerId, this.settings().ownerId))).for('update');
    if (!task) throw new RuntimeError('DEFINITION_UNAVAILABLE', 'request');
    return task;
  }
  private async attempt(tx: PersistenceTransaction, task: Task) {
    const [execution] = await tx.select().from(executions).where(and(eq(executions.taskId, task.id), eq(executions.ownerId, task.ownerId)))
      .orderBy(desc(executions.attemptNumber)).limit(1).for('update');
    return execution;
  }
  private async agentLock(tx: PersistenceTransaction, task: Task) {
    const [agent] = await tx.select().from(agents).where(and(eq(agents.id, task.agentId), eq(agents.ownerId, task.ownerId))).for('update');
    if (!agent || agent.lifecycleStatus !== 'ACTIVE' || agent.orchestratorId !== task.orchestratorId)
      throw new RuntimeError('ACCESS_DENIED', 'request');
    return agent;
  }
  private async now(tx: PersistenceTransaction): Promise<number> {
    const result = await tx.execute(sql`select clock_timestamp()::text as instant`);
    return Date.parse(String(result.rows[0]?.instant));
  }

  async admit(command: ExecuteTaskCommand, claim: boolean, signal: AbortSignal,
    resolve: (definition: RuntimeDefinition) => AgentStrategy): Promise<RuntimeAdmission> {
    this.settings();this.host.assertAdmitting();
    const admitted=await this.transaction(async tx => {
      const delegated = await delegatedAdmission(tx, this.settings().ownerId, command, claim);
      let task = await this.task(tx, command.taskId);
      if (task.version !== command.taskVersion) throw new RuntimeError('CAPACITY_EXCEEDED', 'request');
      if (!['CREATED','QUEUED'].includes(task.status)) throw new RuntimeError(task.status === 'RUNNING' ? 'CAPACITY_EXCEEDED' : 'ACCESS_DENIED', 'request');
      let execution = await this.attempt(tx, task);
      await authorizeInteractionMutation(tx,this.config.value,task.agentId,'execute',()=>{throw new RuntimeError('ACCESS_DENIED','request');});
      const agent = await this.agentLock(tx, task);
      try { executionConfigurationSnapshot(agent.configuration); }
      catch { throw new RuntimeError('CONFIGURATION_ERROR', 'definition'); }
      const binding = this.settings().bindings.find(b => b.agentId === task.agentId && b.orchestratorId === task.orchestratorId);
      if (!binding || binding.definition.agentType !== agent.type) throw new RuntimeError('DEFINITION_UNAVAILABLE', 'definition');
      const strategy = resolve(binding.definition); // Resolve before any durable mutation.
      const [route] = await tx.select().from(orchestrators).where(and(eq(orchestrators.id, task.orchestratorId),eq(orchestrators.ownerId,task.ownerId))).for('share');
      if (!route || route.registrationStatus !== 'ENABLED' || route.type !== 'native') throw new RuntimeError('ACCESS_DENIED', 'request');
      const [blocked] = await tx.select({id:executions.id}).from(executions).where(and(eq(executions.ownerId,task.ownerId),
        eq(executions.agentId,task.agentId),eq(executions.authority,'NATIVE'), ...(execution ? [ne(executions.id,execution.id)] : []),
        or(eq(executions.status,'RUNNING'),inArray(executions.reconciliationState,['CANCELLATION_UNCONFIRMED','NATIVE_OUTCOME_UNCERTAIN'])))).limit(1);
      if (blocked) throw new RuntimeError('CAPACITY_EXCEEDED', 'request');
      let snapshot;
      if (execution) {
        if (execution.status !== 'PENDING' || execution.authority !== 'NATIVE') throw new RuntimeError('ACCESS_DENIED', 'request');
        snapshot = parseRuntimeSnapshot(execution.agentConfigSnapshot.runtime);
        if (snapshot.digest !== definitionDigest(binding.definition) || command.correlationId && command.correlationId !== snapshot.correlationId)
          throw new RuntimeError('DEFINITION_UNAVAILABLE', 'definition');
      } else snapshot = runtimeSnapshot(binding.definition, command.correlationId ?? randomUUID());
      if (task.status === 'CREATED') {
        await this.lifecycle.queueInTransaction(tx, task.id, { taskVersion: task.version, authority: 'NATIVE' }, snapshot);
        task = await this.task(tx, task.id);
        execution = await this.attempt(tx, task);
      }
      if (!execution || execution.agentId !== task.agentId || execution.orchestratorId !== task.orchestratorId)
        throw new RuntimeError('INVALID_INPUT', 'request');
      const now = await this.now(tx);
      // The context validates against the Node clock; never extend its budget
      // when PostgreSQL's clock is slightly ahead. Database time still fences leases.
      const deadline = Math.min(Math.min(now, Date.now()) + snapshot.definition.budget.executionTimeoutMs, task.deadlineAt?.getTime() ?? Infinity,
        execution.deadlineAt?.getTime() ?? Infinity);
      if (deadline <= now) throw new RuntimeError('DEADLINE_EXCEEDED', 'context');
      const request = createRuntimeExecutionRequest({ ids: { ownerId: task.ownerId, taskId: task.id, executionId: execution.id,
        agentId: task.agentId, orchestratorId: task.orchestratorId, correlationId: snapshot.correlationId }, input: task.input, definition: snapshot.definition });
      const metadata = { ...execution.agentConfigSnapshot }; delete metadata.runtime;
      const context = this.contexts.create({ request, deadlineAt: new Date(deadline).toISOString(), signal,
        authorizedCapabilities: snapshot.definition.toolCapabilities.filter(cap=>this.config.value.runtime?.tools?.allowedCapabilities.includes(cap)),
        safeAgentConfiguration: executionConfigurationSnapshot(metadata) });
      if (signal.aborted) throw new RuntimeError('CANCELLED', 'context');
      const leaseToken = randomUUID();
      await tx.update(executions).set({ deadlineAt: new Date(deadline), ...(claim ? {
        leaseToken, leaseOwner: randomUUID(), leaseExpiresAt: new Date(now + NATIVE_LEASE_MS), lastHeartbeatAt: new Date(now) } : {}) })
        .where(eq(executions.id, execution.id));
      execution = (await this.attempt(tx, task))!;
      if (claim) {
        await this.lifecycle.startInTransaction(tx, task.id, execution.id,
          { taskVersion: task.version, executionVersion: execution.version }, {leaseToken,correlationId:snapshot.correlationId});
        task = await this.task(tx, task.id); execution = (await this.attempt(tx, task))!;
      }
      if (delegated) await delegated.repository.updateDelegation(delegated.delegation.id, delegated.delegation.version, { childExecutionId: execution.id, status: 'EXECUTING' });
      this.host.assertAdmitting();
      return { task: serializeTask(task), execution: serializeExecution(execution), request, strategy,
        ...(claim ? {context,leaseToken} : {}) };
    });
    if(claim&&admitted.context)this.#toolClaims.set(admitted.context,Object.freeze({...admitted,
      task:Object.freeze({...admitted.task}),execution:Object.freeze({...admitted.execution})}));
    return admitted;
  }

  async verifyToolContext(context:RuntimeExecutionContext):Promise<void> {
    const admission=this.#toolClaims.get(context);
    if(!admission)throw new RuntimeError('TOOL_DENIED','tool');
    await this.transaction(async tx=>{
      const task=await this.task(tx,admission.task.id),execution=await this.attempt(tx,task);
      this.assertClaim(task,execution,admission);await this.agentLock(tx,task);
      const [route]=await tx.select().from(orchestrators).where(and(eq(orchestrators.id,task.orchestratorId),eq(orchestrators.ownerId,task.ownerId))).for('share');
      if(!route||route.registrationStatus!=='ENABLED'||route.type!=='native')throw new RuntimeError('TOOL_DENIED','tool');
      const now=await this.now(tx);
      if(execution!.leaseExpiresAt!.getTime()<=now)throw new RuntimeError('LEASE_LOST','tool');
      if(execution!.deadlineAt!.getTime()<=now)throw new RuntimeError('DEADLINE_EXCEEDED','tool');
    });
  }

  async heartbeat(admission: RuntimeAdmission): Promise<void> {
    await this.transaction(async tx => {
      const task = await this.task(tx, admission.task.id), execution = await this.attempt(tx, task);
      this.assertClaim(task, execution, admission);
      const now = await this.now(tx);
      if (execution!.leaseExpiresAt!.getTime() <= now) throw new RuntimeError('LEASE_LOST', 'context');
      if (execution!.deadlineAt!.getTime() <= now) throw new RuntimeError('DEADLINE_EXCEEDED', 'context');
      await tx.update(executions).set({ leaseExpiresAt:new Date(now + NATIVE_LEASE_MS),lastHeartbeatAt:new Date(now) }).where(eq(executions.id,execution!.id));
    });
  }
  private assertClaim(task: Task, execution: Execution | undefined, admission: RuntimeAdmission) {
    this.assertIdentity(task, execution, admission);
    if (task.status === 'CANCELLED') throw new RuntimeError('CANCELLED', 'context');
    if (!execution || task.status !== 'RUNNING' || execution.status !== 'RUNNING' || execution.id !== admission.execution.id ||
      execution.leaseToken !== admission.leaseToken || !execution.leaseExpiresAt || !execution.deadlineAt)
      throw new RuntimeError('LEASE_LOST', 'context');
  }
  private assertIdentity(task: Task, execution: Execution | undefined, admission: RuntimeAdmission) {
    const ids = admission.request.ids;
    if (!execution || execution.id !== ids.executionId || task.id !== ids.taskId || task.ownerId !== ids.ownerId ||
      task.agentId !== ids.agentId || task.orchestratorId !== ids.orchestratorId)
      throw new RuntimeError('LEASE_LOST', 'context');
  }

  async finish(admission: RuntimeAdmission, outcome: {result?: RuntimeExecutionResult; error?: RuntimeError}): Promise<RuntimeCompletion> {
    return this.transaction(async tx => {
      const task = await this.task(tx, admission.task.id), execution = await this.attempt(tx, task);
      if (!execution || execution.id !== admission.execution.id) throw new RuntimeError('LEASE_LOST', 'context');
      this.assertIdentity(task, execution, admission);
      if (['COMPLETED','FAILED','CANCELLED'].includes(task.status)) {
        const expected = task.status === 'COMPLETED' ? ['SUCCEEDED'] : task.status === 'CANCELLED' ? ['CANCELLED'] : ['FAILED','TIMED_OUT'];
        if (!expected.includes(execution.status)) throw new RuntimeError('OUTCOME_UNCERTAIN', 'context');
        return {task:serializeTask(task),execution:serializeExecution(execution),observed:true};
      }
      this.assertClaim(task, execution, admission);
      await this.agentLockForFinish(tx, task);
      const now = await this.now(tx);
      if (execution.leaseExpiresAt!.getTime() <= now) throw new RuntimeError('LEASE_LOST', 'context');
      let error = outcome.error;
      if (admission.context?.signal.aborted && !error) error = admission.context.signal.reason instanceof RuntimeError ? admission.context.signal.reason : new RuntimeError('CANCELLED');
      if (execution.deadlineAt!.getTime() <= now) error = new RuntimeError('DEADLINE_EXCEEDED', 'context');
      const runtime = {leaseToken:admission.leaseToken!,correlationId:admission.request.ids.correlationId,
        ...(error ? {errorCode:error.code} : {}), uncertain: !!error && ['CANCELLED','DEADLINE_EXCEEDED','OUTCOME_UNCERTAIN'].includes(error.code)};
      const versions = {taskVersion:task.version,executionVersion:execution.version};
      if (error?.code === 'CANCELLED') {
        const pair = await this.lifecycle.cancelInTransaction(tx, task.id, {...versions,executionId:execution.id}, runtime.correlationId);
        return {task:pair.task,execution:pair.execution!,error:error.toJSON()};
      }
      if (error) {
        const pair = await this.lifecycle.finishInTransaction(tx, task.id, execution.id,
          {...versions,errorCode:error.code === 'PROVIDER_UNAVAILABLE' ? 'RUNTIME_UNAVAILABLE' : 'EXECUTION_FAILED'},
          error.code === 'DEADLINE_EXCEEDED' ? 'TIMED_OUT' : 'FAILED',runtime);
        return {task:pair.task,execution:pair.execution!,error:error.toJSON()};
      }
      const result = createRuntimeExecutionResult(outcome.result, admission.request);
      const [stored] = await tx.insert(executionResults).values({ownerId:task.ownerId,executionId:execution.id,body:result}).returning();
      if (!stored) throw new RuntimeError('PERSISTENCE_UNAVAILABLE', 'result');
      const reference = `result:${stored.id}`;
      const pair = await this.lifecycle.finishInTransaction(tx, task.id, execution.id, {...versions,resultReference:reference},'SUCCEEDED',runtime);
      return {task:pair.task,execution:pair.execution!,resultReference:reference,result};
    });
  }
  private async agentLockForFinish(tx: PersistenceTransaction, task: Task) {
    // Administrative disabling does not prevent an already running attempt ending.
    await tx.select({id:agents.id}).from(agents).where(and(eq(agents.id,task.agentId),eq(agents.ownerId,task.ownerId))).for('update');
  }
}
