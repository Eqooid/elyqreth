import { Injectable } from '@nestjs/common';
import { AgentStrategy } from '../contracts/agent-strategy.contract';
import { RuntimeExecutionRequest, isRuntimeExecutionRequest } from '../contracts/execution-request.contract';
import { RuntimeExecutionContext, assertRuntimeActive } from '../contracts/execution-context.contract';
import { createRuntimeExecutionResult, RuntimeExecutionResult } from '../contracts/execution-result.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { invalid, record } from '../contracts/validation';
import { validTaskInput, TaskInput } from '../../tasks/dto/task.dto';

export const TEXT_STATISTICS_ID = 'text.stats.v1';

// Validate independently as well as at Task/request admission. Never trim the
// analyzed string or treat its contents as executable instructions.
export function textStatisticsInput(value: unknown): Readonly<TaskInput> {
  const input = record(value, ['instruction', 'context'], 'request');
  if (!validTaskInput(input)) return invalid('request');
  return Object.freeze({ instruction: input.instruction,
    ...(input.context === undefined ? {} : { context: input.context }) });
}

@Injectable()
export class TextStatisticsStrategy implements AgentStrategy {
  readonly type = 'RULE_BASED' as const;

  async execute(request: RuntimeExecutionRequest, context: RuntimeExecutionContext): Promise<RuntimeExecutionResult> {
    assertRuntimeActive(context);
    if (!isRuntimeExecutionRequest(request)) return invalid('request');
    if (request.definition.strategyId !== TEXT_STATISTICS_ID || context.definition !== request.definition ||
      context.ids !== request.ids || context.input !== request.input)
      throw new RuntimeError('CONFIGURATION_ERROR', 'definition');
    const { instruction } = textStatisticsInput(request.input);
    // Unicode code points, not UTF-16 units or grapheme clusters. Whitespace
    // tokenization follows ECMAScript \s; CRLF and bare CR each form one break.
    const codePointCount = Array.from(instruction).length;
    const wordCount = instruction.match(/\S+/gu)?.length ?? 0;
    const nonemptyLineCount = instruction.split(/\r\n|[\r\n\u2028\u2029]/u).filter(line => line.trim().length > 0).length;
    assertRuntimeActive(context);
    return createRuntimeExecutionResult({ schemaVersion: 1, executionId: request.ids.executionId,
      output: { type: 'text.statistics.v1', data: { codePointCount, wordCount, nonemptyLineCount } } }, request);
  }
}
