import type { TokenUsage } from './provider.contract';
import { RuntimeExecutionRequest, isRuntimeExecutionRequest } from './execution-request.contract';
import { RuntimeError } from './runtime-error.contract';
import { freeze, identifier, integer, invalid, modelIdentifier, record, safeText, token } from './validation';
import { tokenUsage } from './provider-validation';

export type RuntimeOutput =
  | { readonly type: 'text.statistics.v1'; readonly data: {
      readonly codePointCount: number; readonly wordCount: number; readonly nonemptyLineCount: number } }
  | { readonly type: 'text'; readonly text: string };
// Successful candidate data, NOT authoritative persisted lifecycle status.
export interface RuntimeExecutionResult {
  readonly schemaVersion: 1;
  readonly executionId: string;
  readonly output: RuntimeOutput;
  readonly provider?: { readonly id: string; readonly model: string; readonly profileVersion: number;readonly providerId?:string };
  readonly usage?: TokenUsage;
  readonly toolSummary?: { readonly invocationCount: number };
}
export function createRuntimeExecutionResult(value: unknown, request: RuntimeExecutionRequest): RuntimeExecutionResult {
  if (!isRuntimeExecutionRequest(request)) return invalid('result');
  const input = record(value, ['schemaVersion','executionId','output','provider','usage','toolSummary'], 'result');
  if (input.schemaVersion !== 1 || identifier(input.executionId, 'result') !== request.ids.executionId) return invalid('result');
  const out = record(input.output, ['type','data','text'], 'result');
  if (out.type !== request.definition.outputType) return invalid('result');
  let output: RuntimeOutput;
  if (out.type === 'text.statistics.v1') {
    if (Object.hasOwn(out, 'text')) return invalid('result');
    const data = record(out.data, ['codePointCount','wordCount','nonemptyLineCount'], 'result');
    const codePointCount = integer(data.codePointCount, 0, 16000, 'result');
    output = freeze({ type: 'text.statistics.v1', data: freeze({ codePointCount,
      wordCount: integer(data.wordCount, 0, codePointCount, 'result'),
      nonemptyLineCount: integer(data.nonemptyLineCount, 0, codePointCount, 'result') }) });
  } else {
    if (Object.hasOwn(out, 'data')) return invalid('result');
    if (typeof out.text === 'string' && Buffer.byteLength(out.text, 'utf8') > request.definition.budget.maxResultBytes)
      throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED', 'result');
    output = freeze({ type: 'text', text: safeText(out.text, 'result') });
  }
  let provider: RuntimeExecutionResult['provider'];
  let usage: TokenUsage | undefined;
  if (Object.hasOwn(input, 'provider')) {
    if (request.definition.strategyType !== 'LLM') return invalid('result');
    const p = record(input.provider, ['id','model','profileVersion','providerId'], 'result');
    provider = freeze({ id: token(p.id, 'result'), model: modelIdentifier(p.model, 'result'),
      profileVersion: integer(p.profileVersion, 1, 2147483647, 'result'),...(p.providerId===undefined?{}:{providerId:token(p.providerId,'result')}) });
    const expected = request.definition.providerProfile;
    if (provider.id !== expected.id || provider.model !== expected.model || provider.profileVersion !== expected.profileVersion) return invalid('result');
  }
  if (Object.hasOwn(input, 'usage')) {
    if (request.definition.strategyType !== 'LLM') return invalid('result');
    try { usage = tokenUsage(input.usage); } catch { return invalid('result'); }
  }
  let toolSummary: RuntimeExecutionResult['toolSummary'];
  if (Object.hasOwn(input, 'toolSummary')) {
    const t = record(input.toolSummary, ['invocationCount'], 'result');
    toolSummary = freeze({ invocationCount: integer(t.invocationCount, 0, request.definition.budget.maxToolCalls, 'result') });
  }
  const result = { schemaVersion: 1 as const, executionId: request.ids.executionId, output,
    ...(provider ? { provider } : {}), ...(usage ? { usage } : {}), ...(toolSummary ? { toolSummary } : {}) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > request.definition.budget.maxResultBytes) throw new RuntimeError('OUTPUT_LIMIT_EXCEEDED', 'result');
  return freeze(result);
}
