import { validTaskInput } from '../../tasks/dto/task.dto';
import type { TaskInput } from '../../tasks/dto/task.dto';
import { createRuntimeDefinition, RuntimeDefinition } from './definition.contract';
import { freeze, identifier, invalid, record } from './validation';

export interface ExecutionIdentifiers {
  readonly ownerId: string; readonly taskId: string; readonly executionId: string;
  readonly agentId: string; readonly orchestratorId: string; readonly correlationId: string;
}
declare const validatedRequest: unique symbol;
export interface RuntimeExecutionRequest {
  readonly ids: ExecutionIdentifiers;
  readonly input: Readonly<TaskInput>;
  readonly definition: RuntimeDefinition;
  readonly [validatedRequest]: true;
}
const requests = new WeakSet<object>();
export function isRuntimeExecutionRequest(value: unknown): value is RuntimeExecutionRequest {
  return !!value && typeof value === 'object' && requests.has(value);
}
// Trusted internal construction only. Shape validation is not DB authorization.
export function createRuntimeExecutionRequest(value: unknown): RuntimeExecutionRequest {
  const input = record(value, ['ids','input','definition'], 'request');
  const i = record(input.ids, ['ownerId','taskId','executionId','agentId','orchestratorId','correlationId'], 'request');
  const ids: ExecutionIdentifiers = freeze({ ownerId: identifier(i.ownerId, 'request'), taskId: identifier(i.taskId, 'request'),
    executionId: identifier(i.executionId, 'request'), agentId: identifier(i.agentId, 'request'),
    orchestratorId: identifier(i.orchestratorId, 'request'), correlationId: identifier(i.correlationId, 'request') });
  const payload = record(input.input, ['instruction','context'], 'request');
  if (!validTaskInput(payload)) return invalid('request');
  const taskInput = freeze({ instruction: payload.instruction, ...(payload.context === undefined ? {} : { context: payload.context }) });
  const definition = createRuntimeDefinition(input.definition);
  const request = { ids, input: taskInput, definition };
  Object.defineProperty(request, 'input', { enumerable: false });
  Object.defineProperty(request, 'definition', { enumerable: false });
  Object.defineProperty(request, 'toJSON', { value: () => ({ ids, definitionId: definition.definitionId, definitionVersion: definition.definitionVersion }) });
  const result = freeze(request) as RuntimeExecutionRequest;
  requests.add(result);
  return result;
}
