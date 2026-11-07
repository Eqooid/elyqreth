export type TaskStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
export type LifecycleErrorCode = 'INVALID_COMMAND' | 'ACCESS_DISABLED' | 'TASK_NOT_FOUND' | 'EXECUTION_NOT_FOUND' |
  'EXECUTION_TASK_MISMATCH' | 'INVALID_TASK_TRANSITION' | 'INVALID_EXECUTION_TRANSITION' |
  'ALREADY_TERMINAL' | 'LIFECYCLE_CONFLICT' | 'INCONSISTENT_STATE' | 'RESULT_NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE';

export class LifecycleError extends Error {
  constructor(readonly code: LifecycleErrorCode) {
    super(code); // Stable identifiers only; no request, DB or runtime messages.
    this.name = 'LifecycleError';
  }
}

export const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  CREATED: Object.freeze(['QUEUED', 'CANCELLED'] as const),
  QUEUED: Object.freeze(['RUNNING', 'FAILED', 'CANCELLED'] as const),
  RUNNING: Object.freeze(['COMPLETED', 'FAILED', 'CANCELLED'] as const),
  COMPLETED: Object.freeze([]), FAILED: Object.freeze([]), CANCELLED: Object.freeze([]),
});
export const executionTransitions: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> = Object.freeze({
  PENDING: Object.freeze(['RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const),
  RUNNING: Object.freeze(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const),
  SUCCEEDED: Object.freeze([]), FAILED: Object.freeze([]), CANCELLED: Object.freeze([]), TIMED_OUT: Object.freeze([]),
});

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!taskTransitions[from]?.length) throw new LifecycleError('ALREADY_TERMINAL');
  if (!taskTransitions[from].includes(to)) throw new LifecycleError('INVALID_TASK_TRANSITION');
}
export function assertExecutionTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!executionTransitions[from]?.length) throw new LifecycleError('ALREADY_TERMINAL');
  if (!executionTransitions[from].includes(to)) throw new LifecycleError('INVALID_EXECUTION_TRANSITION');
}

export const failureMessages = Object.freeze({
  EXECUTION_FAILED: 'Execution failed.', PROCESS_INTERRUPTED: 'Execution was interrupted.',
  RUNTIME_UNAVAILABLE: 'Execution runtime was unavailable.',
});
export type FailureCode = keyof typeof failureMessages;
