import { Injectable } from '@nestjs/common';
import { isHexColor, isISO8601 } from 'class-validator';
import { ApiLogger } from '../../common/api-logger';
import { isRuntimeExecutionRequest, RuntimeExecutionRequest } from '../contracts/execution-request.contract';
import { RuntimeExecutionContext, RuntimeLogEvent, runtimeLogEvents, RuntimeLogMetrics, SafeRuntimeLogger, trackRuntimeDeadline } from '../contracts/execution-context.contract';
import { RuntimeError, isRuntimeErrorCode } from '../contracts/runtime-error.contract';
import { capabilities, freeze, integer, invalid, record, token } from '../contracts/validation';
import type { AuthorizedToolSet } from '../contracts/tool.contract';
import type { AgentMetadataDto } from '../../agents/dto/agent.dto';

export interface ExecutionContextInput {
  readonly request: RuntimeExecutionRequest;
  readonly deadlineAt: string;
  readonly signal: AbortSignal; // Owned/disposed by future coordinator, never this factory.
  readonly authorizedCapabilities?: readonly string[];
  readonly safeAgentConfiguration?: Readonly<AgentMetadataDto>;
}
function isNativeSignal(value: unknown): value is AbortSignal {
  if (!(value instanceof AbortSignal)) return false;
  try {
    const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    return typeof getter?.call(value) === 'boolean';
  } catch { return false; } // Prototype spoofing is not a native AbortSignal.
}
@Injectable()
export class ExecutionContextFactory {
  readonly #contexts=new WeakSet<object>();
  constructor(private readonly logger: ApiLogger) {}
  owns(value:unknown):value is RuntimeExecutionContext {return !!value&&typeof value==='object'&&this.#contexts.has(value);}

  create(value: ExecutionContextInput): RuntimeExecutionContext {
    const input = record(value, ['request','deadlineAt','signal','authorizedCapabilities','safeAgentConfiguration'], 'context');
    if (!isRuntimeExecutionRequest(input.request)) return invalid('context');
    const request = input.request;
    if (typeof input.deadlineAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.deadlineAt) ||
      !isISO8601(input.deadlineAt, { strict: true, strictSeparator: true })) return invalid('context');
    const now = Date.now(), deadline = Date.parse(input.deadlineAt);
    if (deadline <= now) throw new RuntimeError('DEADLINE_EXCEEDED', 'context');
    if (!Number.isFinite(deadline) || deadline - now > request.definition.budget.executionTimeoutMs || !isNativeSignal(input.signal)) return invalid('context');
    const authorized = capabilities(input.authorizedCapabilities === undefined ? [] : input.authorizedCapabilities, 'context');
    if (authorized.some(c => !request.definition.toolCapabilities.includes(c))) throw new RuntimeError('TOOL_DENIED', 'context');
    const configuration = record(input.safeAgentConfiguration === undefined ? {} : input.safeAgentConfiguration, ['category','color'], 'context');
    if (configuration.category !== undefined && !['general','research','design','build','test'].includes(configuration.category as string)) return invalid('context');
    if (configuration.color !== undefined && (typeof configuration.color !== 'string' || !isHexColor(configuration.color))) return invalid('context');
    const safeAgentConfiguration = freeze({ ...(configuration.category === undefined ? {} : { category: configuration.category as string }),
      ...(configuration.color === undefined ? {} : { color: (configuration.color as string).toLowerCase() }) });
    const logger: SafeRuntimeLogger = freeze({
      info: (event: RuntimeLogEvent, metrics: RuntimeLogMetrics = {}) => {
        if (!runtimeLogEvents.includes(event)) return invalid('context');
        const data = record(metrics, ['durationMs','toolInvocationCount','providerRequestCount','errorCode','providerId','toolId'], 'context');
        const fields: Record<string, unknown> = { ...request.ids };
        if (Object.hasOwn(data, 'durationMs')) fields.durationMs = integer(data.durationMs, 0, 300000, 'context');
        if (Object.hasOwn(data, 'toolInvocationCount')) fields.toolInvocationCount = integer(data.toolInvocationCount, 0, request.definition.budget.maxToolCalls, 'context');
        if (Object.hasOwn(data, 'providerRequestCount')) fields.providerRequestCount = integer(data.providerRequestCount, 0, request.definition.budget.maxProviderRounds, 'context');
        if (Object.hasOwn(data,'providerId')) fields.providerId=token(data.providerId,'context');
        if (Object.hasOwn(data,'toolId')) fields.toolId=token(data.toolId,'context');
        if (Object.hasOwn(data, 'errorCode')) {
          if (!isRuntimeErrorCode(data.errorCode)) return invalid('context');
          fields.errorCode = data.errorCode;
        }
        try { this.logger.info(event, fields); } catch { /* Telemetry failure must not change lifecycle decisions. */ }
      },
      error: code => {
        if (!isRuntimeErrorCode(code)) return invalid('context');
        try { this.logger.error('runtime.failure', { ...request.ids, errorCode: code }); } catch { /* Best-effort diagnostics only. */ }
      },
    });
    const context = { ids: request.ids, input: request.input, definition: request.definition,
      deadlineAt: new Date(deadline).toISOString(), signal: input.signal, authorizedCapabilities: authorized as AuthorizedToolSet,
      safeAgentConfiguration, logger };
    for (const key of ['input','definition','signal','authorizedCapabilities','safeAgentConfiguration','logger']) {
      Object.defineProperty(context, key, { enumerable: false });
    }
    // Logging a whole context must not dump input/config/AbortSignal.reason.
    Object.defineProperty(context, 'toJSON', { value: () => ({ ids: request.ids, deadlineAt: context.deadlineAt,
      definitionId: request.definition.definitionId, definitionVersion: request.definition.definitionVersion }) });
    const result=freeze(context);trackRuntimeDeadline(result, deadline - now);this.#contexts.add(result);return result;
  }
}
