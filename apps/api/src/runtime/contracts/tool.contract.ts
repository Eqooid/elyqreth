import type { ExecutionIdentifiers } from './execution-request.contract';

export type ToolIdentifier = string;
export type ToolCapability = `tool.${string}`;
export type AuthorizedToolSet = readonly ToolCapability[];
export interface ToolInvocationRequest {
  readonly callId: string;
  readonly toolId: ToolIdentifier;
  readonly version: number;
  readonly input: unknown; // Untrusted proposal, must pass the registered input schema.
}
export interface ToolExecutionContext {
  readonly ids: ExecutionIdentifiers;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly authorizedCapabilities: AuthorizedToolSet;
}
export interface ToolDefinition {
  readonly id: ToolIdentifier;
  readonly version: number;
  readonly requiredCapability: ToolCapability;
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}
export interface ToolHandler<Input = unknown, Output = unknown> extends Pick<ToolContract<Input,Output>,'parseInput'|'parseOutput'> {
  readonly definition: ToolDefinition;
  execute(input: Input, context: ToolExecutionContext): Promise<Output>;
}
export type ToolExecutionRequest = ToolInvocationRequest;
export type ToolExecutionError = import('./runtime-error.contract').RuntimeError;
// Bound by RuntimeModule to the existing persisted native claim verifier.
// Test fixtures may replace this authority; ordinary callers cannot mint it.
export interface ToolExecutionAuthority {
  verify(context: import('./execution-context.contract').RuntimeExecutionContext): Promise<void>;
}
export interface ToolContract<Input, Output> extends ToolDefinition {
  parseInput(value: unknown): Input;
  parseOutput(value: unknown): Output;
}
export interface ToolExecutionResult<Output> {
  readonly callId: string;
  readonly toolId: ToolIdentifier;
  readonly output: Output;
}
// Bound to a permissioned invoker in T08, not provided by T02's module/context.
export interface AuthorizedToolInvoker {
  invoke(request: ToolInvocationRequest, context: ToolExecutionContext): Promise<ToolExecutionResult<unknown>>;
}
