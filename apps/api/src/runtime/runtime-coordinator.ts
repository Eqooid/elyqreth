import { RuntimeHostService } from './runtime-host.service';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RuntimeAdmission, RuntimeCompletion, RuntimePersistenceService, NATIVE_HEARTBEAT_MS } from './runtime-persistence.service';
import { StrategyRegistry } from './strategy-registry';
import { ExecuteTaskCommand, executionCommand } from './runtime-command';
import { RuntimeError } from './contracts/runtime-error.contract';
import { assertRuntimeActive } from './contracts/execution-context.contract';
import { createRuntimeExecutionResult } from './contracts/execution-result.contract';
import { performance } from 'node:perf_hooks';

export type RuntimeCoordinatorResult =
  | ({ readonly kind: 'finished'; readonly error?: ReturnType<RuntimeError['toJSON']>;
      readonly executionError?: ReturnType<RuntimeError['toJSON']> } & RuntimeCompletion)
  | { readonly kind: 'unresolved'; readonly taskId: string; readonly executionId: string;
      readonly error: ReturnType<RuntimeError['toJSON']>; readonly finalizationError: ReturnType<RuntimeError['toJSON']> };
const classified = (error: unknown) => error instanceof RuntimeError ? error : new RuntimeError('INTERNAL_RUNTIME_ERROR');

@Injectable()
export class RuntimeCoordinator implements OnModuleDestroy {
  // Local resource bound only. PostgreSQL independently fences cross-process starts.
  private active = false;
  constructor(private readonly persistence: RuntimePersistenceService, private readonly strategies: StrategyRegistry, private readonly host:RuntimeHostService) {}

  assertAdmitting(){this.host.assertAdmitting();}

  async queueTask(value: ExecuteTaskCommand) {
    this.host.assertAdmitting();
    const command = executionCommand(value);
    const controller=new AbortController(),release=this.host.acquire('queue',()=>controller.abort(new RuntimeError('CANCELLED','context')));
    try{const admission = await this.persistence.admit(command, false, controller.signal, d => this.strategies.resolve(d));
      return {task:admission.task,execution:admission.execution};
    }finally{release();}
  }

  async executeTask(value: ExecuteTaskCommand, signal?: AbortSignal): Promise<RuntimeCoordinatorResult> {
    this.host.assertAdmitting();
    const command = executionCommand(value);
    if (this.active) throw new RuntimeError('CAPACITY_EXCEEDED', 'request');
    const controller = new AbortController();
    if (signal !== undefined) {
      try {
        if (!(signal instanceof AbortSignal) || typeof Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get?.call(signal) !== 'boolean')
          throw new Error();
      } catch { throw new RuntimeError('INVALID_INPUT', 'context'); }
    }
    const callerAbort = () => controller.abort(new RuntimeError(signal?.reason instanceof RuntimeError && signal.reason.code==='DEADLINE_EXCEEDED'
      ? 'DEADLINE_EXCEEDED' : 'CANCELLED', 'context'));
    signal?.addEventListener('abort', callerAbort, {once:true});
    if (signal?.aborted) callerAbort();
    const releaseHost=this.host.acquire('execute',()=>controller.abort(new RuntimeError('CANCELLED','context')));
    this.active = true;
    let admission: RuntimeAdmission | undefined, timer: NodeJS.Timeout | undefined, heartbeatTimer: NodeJS.Timeout | undefined;
    const started=performance.now();
    const measure=(completion:RuntimeCompletion,error?:RuntimeError)=>{
      const event=completion.task.status==='COMPLETED'?'runtime.completed':completion.task.status==='CANCELLED'?'runtime.cancelled':
        completion.execution.status==='TIMED_OUT'?'runtime.timeout':'runtime.failed';
      admission?.context?.logger.info(event,{durationMs:Math.min(300000,Math.round(performance.now()-started)),...(error?{errorCode:error.code}:{})});
    };
    let heartbeat: Promise<void> | undefined, stopped = false, removeAbort = () => {};
    const stopHeartbeat = async () => {
      stopped = true; clearTimeout(heartbeatTimer); await heartbeat;
    };
    try {
      admission = await this.persistence.admit(command, true, controller.signal, d => this.strategies.resolve(d));
      const owned = admission;
      await this.persistence.heartbeat(owned); // Observe committed cancellation before dispatch.
      owned.context!.logger.info('runtime.started');
      const beat = () => {
        heartbeat = this.persistence.heartbeat(owned).catch(error => controller.abort(classified(error))).then(() => {
          if (!stopped && !controller.signal.aborted) heartbeatTimer = setTimeout(beat, NATIVE_HEARTBEAT_MS);
        });
      };
      heartbeatTimer = setTimeout(beat, NATIVE_HEARTBEAT_MS);
      timer = setTimeout(() => controller.abort(new RuntimeError('DEADLINE_EXCEEDED', 'context')),
        Math.max(0, Date.parse(owned.context!.deadlineAt) - Date.now()));
      assertRuntimeActive(owned.context!);
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(controller.signal.reason instanceof RuntimeError ? controller.signal.reason : new RuntimeError('CANCELLED'));
        controller.signal.addEventListener('abort', onAbort, {once:true});
        removeAbort = () => controller.signal.removeEventListener('abort', onAbort);
        if (controller.signal.aborted) onAbort();
      });
      // Promise.race installs rejection handlers even for a late throwing strategy.
      const candidate = await Promise.race([aborted, Promise.resolve().then(() => {
        this.host.assertAdmitting();
        assertRuntimeActive(owned.context!);
        return owned.strategy.execute(owned.request, owned.context!);
      })]);
      const result = createRuntimeExecutionResult(candidate, owned.request);
      assertRuntimeActive(owned.context!);
      await stopHeartbeat();
      const completed = await this.persistence.finish(owned, {result});
      measure(completed);
      return this.finished(completed);
    } catch (cause) {
      const classifiedCause = classified(cause);
      // A committed pre-drain claim that never dispatched is interrupted conservatively, never a business failure.
      const error = admission && classifiedCause.code==='RUNTIME_DRAINING' ? new RuntimeError('CANCELLED','context') : classifiedCause;
      // Stop child work even when a strategy fails without awaiting its children.
      if (!controller.signal.aborted) controller.abort(error);
      if (!admission) throw error; // Rejected admission never marks an unclaimed Task failed.
      await stopHeartbeat();
      try {
        const completed=await this.persistence.finish(admission, {error});measure(completed,error);
        return this.finished(completed, error);
      } catch (secondary) {
        try{admission.context?.logger.error(classified(secondary).code);}catch{/* Diagnostics never change unresolved durable outcomes. */}
        return {kind:'unresolved',taskId:admission.task.id,executionId:admission.execution.id,
          error:error.toJSON(),finalizationError:classified(secondary).toJSON()};
      }
    } finally {
      stopped = true; clearTimeout(timer); clearTimeout(heartbeatTimer);
      removeAbort(); signal?.removeEventListener('abort',callerAbort);
      if (!controller.signal.aborted) controller.abort(new RuntimeError('CANCELLED', 'context'));
      this.active = false; releaseHost();
    }
  }
  async onModuleDestroy(): Promise<void> { await this.host.stop(); }
  private finished(completion: RuntimeCompletion, error?: RuntimeError): RuntimeCoordinatorResult {
    error ??= completion.error ? new RuntimeError(completion.error.code) : undefined;
    if (!error && completion.task.status === 'FAILED') error = new RuntimeError('OUTCOME_UNCERTAIN');
    const original = error;
    if (completion.task.status === 'CANCELLED') error = new RuntimeError('CANCELLED');
    else if (completion.execution.status === 'TIMED_OUT') error = new RuntimeError('DEADLINE_EXCEEDED');
    return {kind:'finished',...completion,...(error ? {error:error.toJSON()} : {}),
      ...(original && error && original.code !== error.code ? {executionError:original.toJSON()} : {})};
  }
}
