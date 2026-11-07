import { Injectable } from '@nestjs/common';
import { CompletionCommand, ExecutionCommand, FailureCommand, TaskLifecycleService } from './task-lifecycle.service';

// Execution-facing names share the exact same atomic coordinator and state policy.
@Injectable()
export class ExecutionLifecycleService {
  constructor(private readonly lifecycle: TaskLifecycleService) {}
  startExecution(taskId: string, executionId: string, command: ExecutionCommand) {
    return this.lifecycle.startTask(taskId, executionId, command);
  }
  succeedExecution(taskId: string, executionId: string, command: CompletionCommand) {
    return this.lifecycle.completeTask(taskId, executionId, command);
  }
  failExecution(taskId: string, executionId: string, command: FailureCommand) {
    return this.lifecycle.failTask(taskId, executionId, command);
  }
  cancelExecution(taskId: string, executionId: string, command: ExecutionCommand) {
    return this.lifecycle.cancelTask(taskId, { ...command, executionId });
  }
  timeoutExecution(taskId: string, executionId: string, command: ExecutionCommand) {
    return this.lifecycle.timeoutTask(taskId, executionId, command);
  }
}
