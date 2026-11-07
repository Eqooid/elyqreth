import type { NativeAgentType } from './definition.contract';
import type { RuntimeExecutionRequest } from './execution-request.contract';
import type { RuntimeExecutionContext } from './execution-context.contract';
import type { RuntimeExecutionResult } from './execution-result.contract';

export interface AgentStrategy {
  readonly type: NativeAgentType;
  validateDefinition?(definition: import('./definition.contract').RuntimeDefinition):void;
  execute(request: RuntimeExecutionRequest, context: RuntimeExecutionContext): Promise<RuntimeExecutionResult>;
}
