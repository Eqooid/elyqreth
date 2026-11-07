import { Inject, Injectable } from '@nestjs/common';
import { AgentStrategy } from './contracts/agent-strategy.contract';
import { RuntimeDefinition } from './contracts/definition.contract';
import { RuntimeError } from './contracts/runtime-error.contract';
import { RUNTIME_STRATEGIES } from './tokens/runtime.tokens';

export interface StrategyRegistration { readonly id: string; readonly strategy: AgentStrategy }
@Injectable()
export class StrategyRegistry {
  private readonly entries = new Map<string, AgentStrategy>();
  constructor(@Inject(RUNTIME_STRATEGIES) registrations: readonly StrategyRegistration[]) {
    for (const entry of registrations) this.register(entry.id, entry.strategy);
  }
  // Internal explicit registration; never a controller/dynamic module loader.
  register(id: string, strategy: AgentStrategy): void {
    const type = id === 'text.stats.v1' ? 'RULE_BASED' : id === 'llm.text.v1' ? 'LLM' : undefined;
    if (!type || !strategy || strategy.type !== type || typeof strategy.execute !== 'function' || this.entries.has(id))
      throw new RuntimeError('CONFIGURATION_ERROR', 'definition');
    // Bind once so callers cannot replace the method after admission.
    this.entries.set(id, Object.freeze({ type, execute: strategy.execute.bind(strategy),
      ...(strategy.validateDefinition?{validateDefinition:strategy.validateDefinition.bind(strategy)}:{}) }));
  }
  resolve(definition: RuntimeDefinition): AgentStrategy {
    const strategy = this.entries.get(definition.strategyId);
    if (!strategy || strategy.type !== definition.strategyType) throw new RuntimeError('STRATEGY_NOT_FOUND', 'definition');
    strategy.validateDefinition?.(definition);return strategy;
  }
}
