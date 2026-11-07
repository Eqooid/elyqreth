import { identifier, integer, record } from './contracts/validation';

export interface ExecuteTaskCommand { readonly taskId: string; readonly taskVersion: number; readonly correlationId?: string; readonly delegationId?: string }
export function executionCommand(value: unknown): ExecuteTaskCommand {
  const c = record(value, ['taskId','taskVersion','correlationId','delegationId'], 'request');
  return Object.freeze({ taskId: identifier(c.taskId, 'request'), taskVersion: integer(c.taskVersion, 1, 2147483647, 'request'),
    ...(c.correlationId === undefined ? {} : { correlationId: identifier(c.correlationId, 'request') }),
    ...(c.delegationId === undefined ? {} : { delegationId: identifier(c.delegationId, 'request') }) });
}
