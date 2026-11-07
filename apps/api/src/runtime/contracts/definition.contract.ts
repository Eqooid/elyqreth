import type { agentTypes } from '../../agents/dto/agent.dto';
import type { ProviderCapabilities, ResolvedProviderProfile } from './provider.contract';
import { capabilities, freeze, integer, invalid, record, token, safeText } from './validation';
import { providerCapabilities, providerProfile as parseProviderProfile } from './provider-validation';

export type NativeAgentType = Extract<(typeof agentTypes)[number], 'RULE_BASED' | 'LLM'>;
export interface RuntimeBudget {
  readonly executionTimeoutMs: number;
  readonly providerTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxProviderRounds: number;
  readonly maxToolCalls: number;
  readonly maxResultBytes: number;
}
interface DefinitionBase {
  readonly schemaVersion: 1;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly budget: RuntimeBudget;
  readonly toolCapabilities: readonly string[];
}
export type RuntimeDefinition = DefinitionBase & (
  | { readonly agentType: 'RULE_BASED'; readonly strategyType: 'RULE_BASED'; readonly strategyId: 'text.stats.v1'; readonly outputType: 'text.statistics.v1' }
  | { readonly agentType: 'LLM'; readonly strategyType: 'LLM'; readonly strategyId: 'llm.text.v1'; readonly outputType: 'text'; readonly providerProfile: ResolvedProviderProfile;readonly systemInstructions?:string }
);

export function createRuntimeDefinition(value: unknown): RuntimeDefinition {
  const stage = 'definition';
  const input = record(value, ['schemaVersion','definitionId','definitionVersion','agentType','strategyType','strategyId','outputType','budget','toolCapabilities','providerProfile','systemInstructions'], stage);
  if (input.schemaVersion !== 1 || input.agentType !== input.strategyType || (input.agentType !== 'RULE_BASED' && input.agentType !== 'LLM')) return invalid(stage);
  const rule = input.agentType === 'RULE_BASED';
  if (input.strategyId !== (rule ? 'text.stats.v1' : 'llm.text.v1') || input.outputType !== (rule ? 'text.statistics.v1' : 'text')) return invalid(stage);
  const b = record(input.budget, ['executionTimeoutMs','providerTimeoutMs','toolTimeoutMs','maxOutputTokens','maxProviderRounds','maxToolCalls','maxResultBytes'], stage);
  const budget = freeze({
    executionTimeoutMs: integer(b.executionTimeoutMs, 1, 300000, stage),
    providerTimeoutMs: integer(b.providerTimeoutMs, rule ? 0 : 1, rule ? 0 : 300000, stage),
    toolTimeoutMs: integer(b.toolTimeoutMs, 0, 2000, stage),
    maxOutputTokens: integer(b.maxOutputTokens, rule ? 0 : 1, rule ? 0 : 4096, stage),
    maxProviderRounds: integer(b.maxProviderRounds, rule ? 0 : 1, rule ? 0 : 3, stage),
    maxToolCalls: integer(b.maxToolCalls, 0, rule ? 0 : 2, stage),
    maxResultBytes: integer(b.maxResultBytes, 1, 32768, stage),
  });
  if (budget.providerTimeoutMs > budget.executionTimeoutMs || budget.toolTimeoutMs > budget.executionTimeoutMs ||
    budget.maxToolCalls > 0 && budget.maxProviderRounds < 2 ||
    (budget.maxToolCalls > 0) !== (budget.toolTimeoutMs > 0)) return invalid(stage);
  const grants = capabilities(input.toolCapabilities, stage);
  if ((rule && grants.length > 0) || (!budget.maxToolCalls && grants.length > 0)) return invalid(stage);
  const base = { schemaVersion: 1 as const, definitionId: token(input.definitionId, stage),
    definitionVersion: integer(input.definitionVersion, 1, 2147483647, stage), budget, toolCapabilities: grants };
  if (rule) {
    if (Object.hasOwn(input, 'providerProfile')||Object.hasOwn(input,'systemInstructions')) return invalid(stage);
    return freeze({ ...base, agentType: 'RULE_BASED', strategyType: 'RULE_BASED', strategyId: 'text.stats.v1', outputType: 'text.statistics.v1' });
  }
  const p = record(input.providerProfile, ['id','profileVersion','model','capabilities','bindingDigest'], stage);
  const c = record(p.capabilities, ['text','transportAbort','remoteCancellation','structuredOutput','toolCalls','streaming','tokenUsage'], stage);
  if (c.text !== true || c.transportAbort !== true || c.streaming !== false || typeof c.toolCalls !== 'boolean' ||
    (c.remoteCancellation !== 'unknown' && c.remoteCancellation !== 'best_effort') ||
    (c.structuredOutput !== 'none' && c.structuredOutput !== 'json' && c.structuredOutput !== 'schema') ||
    budget.maxToolCalls > 0 && !c.toolCalls) return invalid(stage);
  const validatedCapabilities: ProviderCapabilities = providerCapabilities(c);
  const providerProfile = parseProviderProfile({ ...p, capabilities: validatedCapabilities });
  let systemInstructions:string|undefined;
  if(input.systemInstructions!==undefined){systemInstructions=safeText(input.systemInstructions,stage);if(systemInstructions.length>2048||Buffer.byteLength(systemInstructions)>4096)return invalid(stage);}
  return freeze({ ...base, agentType: 'LLM', strategyType: 'LLM', strategyId: 'llm.text.v1', outputType: 'text', providerProfile,
    ...(systemInstructions===undefined?{}:{systemInstructions}) });
}
