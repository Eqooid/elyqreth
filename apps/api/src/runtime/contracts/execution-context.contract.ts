import type { AgentMetadataDto } from '../../agents/dto/agent.dto';
import type { TaskInput } from '../../tasks/dto/task.dto';
import type { RuntimeDefinition } from './definition.contract';
import type { ExecutionIdentifiers } from './execution-request.contract';
import type { AuthorizedToolSet } from './tool.contract';
import { RuntimeError, RuntimeErrorCode } from './runtime-error.contract';
import { performance } from 'node:perf_hooks';

const elapsedDeadlines = new WeakMap<object, { started: number; remaining: number }>();
// Factory-only bookkeeping: no serializable clock or caller-controlled budget.
export function trackRuntimeDeadline(context: RuntimeExecutionContext, remainingMs: number): void {
  if (elapsedDeadlines.has(context)) throw new RuntimeError('CONFIGURATION_ERROR', 'context');
  elapsedDeadlines.set(context, { started: performance.now(), remaining: remainingMs });
}

export interface RuntimeLogMetrics {
  readonly durationMs?: number;
  readonly toolInvocationCount?: number;
  readonly providerRequestCount?: number;
  readonly errorCode?: RuntimeErrorCode;
  readonly providerId?: string;
  readonly toolId?: string;
}
export const runtimeLogEvents = Object.freeze(['runtime.diagnostic','runtime.budget','runtime.started','runtime.completed','runtime.failed',
  'runtime.cancelled','runtime.timeout','runtime.conflict','provider.started','provider.completed','provider.failed','tool.started','tool.completed','tool.failed'] as const);
export type RuntimeLogEvent = typeof runtimeLogEvents[number];
export interface SafeRuntimeLogger {
  info(event: RuntimeLogEvent, metrics?: RuntimeLogMetrics): void;
  error(code: RuntimeErrorCode): void;
}
export interface RuntimeExecutionContext {
  readonly ids: ExecutionIdentifiers;
  readonly input: Readonly<TaskInput>;
  readonly definition: RuntimeDefinition;
  readonly safeAgentConfiguration: Readonly<AgentMetadataDto>;
  readonly authorizedCapabilities: AuthorizedToolSet;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly logger: SafeRuntimeLogger;
}
// Cooperative check only: coordinator must invoke at safe points and enforce I/O.
export function assertRuntimeActive(context: RuntimeExecutionContext): void {
  if (context.signal.aborted) throw new RuntimeError(context.signal.reason instanceof RuntimeError&&
    ['DEADLINE_EXCEEDED','LEASE_LOST'].includes(context.signal.reason.code)?context.signal.reason.code:'CANCELLED', 'context');
  if (Date.now() >= Date.parse(context.deadlineAt)) throw new RuntimeError('DEADLINE_EXCEEDED', 'context');
  const elapsed = elapsedDeadlines.get(context);
  if (elapsed && performance.now() - elapsed.started >= elapsed.remaining)
    throw new RuntimeError('DEADLINE_EXCEEDED', 'context');
}
