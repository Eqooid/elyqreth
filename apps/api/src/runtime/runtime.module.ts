import { RuntimeHostModule } from '../runtime/runtime-host.module';
﻿import { Module } from '@nestjs/common';
import { ApiLogger } from '../common/api-logger';
import { ExecutionContextFactory } from './context/execution-context.factory';
import { RUNTIME_CONTEXT_FACTORY } from './tokens/runtime.tokens';
import { RUNTIME_STRATEGIES } from './tokens/runtime.tokens';
import { DatabaseModule } from '../database/database.module';
import { TasksModule } from '../tasks/tasks.module';
import { RuntimeApiController } from './http/runtime-api.controller';
import { RuntimeApiService } from './http/runtime-api.service';
import { RuntimeApiGuard } from './http/runtime-api.guard';
import { RuntimeApiFilter } from './http/runtime-api.filter';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { RuntimeCoordinator } from './runtime-coordinator';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { StrategyRegistry } from './strategy-registry';
import { LlmAgentStrategy, LLM_AGENT_ID } from './strategies/llm-agent.strategy';
import { TextStatisticsStrategy, TEXT_STATISTICS_ID } from './strategies/text-statistics.strategy';
import { LLM_PROVIDERS } from './tokens/runtime.tokens';
import { LlmProviderRegistry } from './providers/provider-registry';
import { ProviderSelectionService } from './providers/provider-selection.service';
import { OllamaProvider } from './providers/ollama/ollama.provider';
import { OllamaHttpTransport, OLLAMA_DNS, ollamaDns } from './providers/ollama/ollama-http.transport';

import { OpenaiProvider } from './providers/openai/openai.provider';
import { OpenaiHttpTransport, OPENAI_DNS, openaiDns } from './providers/openai/openai-http.transport';
import { CalculatorTool } from './tools/calculator.tool';
import { CurrentDatetimeTool } from './tools/current-datetime.tool';
import { ToolRegistry } from './tools/tool-registry';
import { ToolExecutionService } from './tools/tool-execution.service';
import { AUTHORIZED_TOOL_INVOKER, TOOL_CLOCK, TOOL_EXECUTION_AUTHORITY, TOOL_HANDLERS } from './tokens/runtime.tokens';

@Module({
  imports: [RuntimeHostModule, DatabaseModule, LifecycleModule, TasksModule],
  controllers: [RuntimeApiController],
  providers: [ApiLogger, RuntimeApiService, RuntimeApiGuard, RuntimeApiFilter, ExecutionContextFactory, { provide: RUNTIME_CONTEXT_FACTORY, useExisting: ExecutionContextFactory },
    TextStatisticsStrategy, {provide:OLLAMA_DNS,useValue:ollamaDns}, OllamaHttpTransport, OllamaProvider,
    {provide:OPENAI_DNS,useValue:openaiDns}, OpenaiHttpTransport, OpenaiProvider,
    {provide:LLM_PROVIDERS,inject:[OllamaProvider,OpenaiProvider],
      useFactory:(ollama:OllamaProvider,openai:OpenaiProvider)=>Object.freeze([ollama,openai])}, LlmProviderRegistry, ProviderSelectionService,
    LlmAgentStrategy,{provide:RUNTIME_STRATEGIES,inject:[TextStatisticsStrategy,LlmAgentStrategy],useFactory:(strategy:TextStatisticsStrategy,llm:LlmAgentStrategy) =>
      Object.freeze([Object.freeze({id:TEXT_STATISTICS_ID,strategy}),Object.freeze({id:LLM_AGENT_ID,strategy:llm})])}, StrategyRegistry, RuntimePersistenceService, RuntimeCoordinator,
    {provide:TOOL_CLOCK,useValue:()=>Date.now()},CalculatorTool,CurrentDatetimeTool,
    {provide:TOOL_HANDLERS,inject:[CalculatorTool,CurrentDatetimeTool],useFactory:(calculator:CalculatorTool,time:CurrentDatetimeTool)=>Object.freeze([calculator,time])},
    ToolRegistry,{provide:TOOL_EXECUTION_AUTHORITY,inject:[RuntimePersistenceService],
      useFactory:(persistence:RuntimePersistenceService)=>Object.freeze({verify:persistence.verifyToolContext.bind(persistence)})},
    ToolExecutionService,{provide:AUTHORIZED_TOOL_INVOKER,useExisting:ToolExecutionService}],
  exports: [RuntimeApiService, ExecutionContextFactory, RUNTIME_CONTEXT_FACTORY, StrategyRegistry, RuntimeCoordinator, LlmProviderRegistry, ProviderSelectionService,
    ToolRegistry,ToolExecutionService,AUTHORIZED_TOOL_INVOKER],
})
export class RuntimeModule {}

