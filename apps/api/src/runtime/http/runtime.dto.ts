import { IsInt, Max, Min } from 'class-validator';

import type { serializeTask } from '../../tasks/tasks.service';
import type { serializeExecution } from '../../executions/executions.service';
import type { RuntimeExecutionResult } from '../contracts/execution-result.contract';

type TaskView = ReturnType<typeof serializeTask>;
type ExecutionView = ReturnType<typeof serializeExecution>;
export type TaskRuntimeStatusResponse = TaskView & { latestExecutionId: string | null };
export interface ExecutionResultResponse {
  execution: ExecutionView;
  availability: 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE';
  result: RuntimeExecutionResult | null;
}
export interface RuntimeExecutionResponse {
  kind: 'finished'; task: TaskView; execution: ExecutionView;
  correlationId: string; result: RuntimeExecutionResult | null;
}

export class CancelExecutionDto {
  @IsInt() @Min(1) @Max(2147483647) taskVersion!: number;
}
