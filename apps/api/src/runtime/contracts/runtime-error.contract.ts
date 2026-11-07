export const runtimeErrorMessages = Object.freeze({
  INVALID_INPUT: 'Runtime input is invalid.',
  CONFIGURATION_ERROR: 'Runtime configuration is invalid.',
  STRATEGY_NOT_FOUND: 'Runtime strategy is unavailable.',
  DEFINITION_UNAVAILABLE: 'Runtime definition is unavailable.',
  ACCESS_DENIED: 'Runtime access is denied.',
  UNSUPPORTED_CAPABILITY: 'Runtime capability is unsupported.',
  CAPACITY_EXCEEDED: 'Runtime capacity is unavailable.',
  RUNTIME_DRAINING: 'Native runtime admission is unavailable during drain.',
  PROVIDER_UNAVAILABLE: 'Model provider is unavailable.',
  PROVIDER_AUTH_FAILED: 'Model provider access failed.',
  PROVIDER_QUOTA_EXCEEDED: 'Model provider quota is exhausted.',
  PROVIDER_RATE_LIMITED: 'Model provider capacity is unavailable.',
  MODEL_UNAVAILABLE: 'Configured model is unavailable.',
  INVALID_PROVIDER_OUTPUT: 'Model output is invalid.',
  OUTPUT_LIMIT_EXCEEDED: 'Runtime output exceeds its limit.',
  TOOL_DENIED: 'Tool access is denied.',
  TOOL_FAILED: 'Tool operation failed.',
  DEADLINE_EXCEEDED: 'Runtime deadline was exceeded.',
  CANCELLED: 'Runtime operation was cancelled.',
  LEASE_LOST: 'Runtime ownership is unavailable.',
  OUTCOME_UNCERTAIN: 'Runtime outcome requires reconciliation.',
  PERSISTENCE_UNAVAILABLE: 'Runtime persistence is unavailable.',
  INTERNAL_RUNTIME_ERROR: 'Runtime operation failed.',
});
export type RuntimeErrorCode = keyof typeof runtimeErrorMessages;
export type RuntimeStage = 'request' | 'definition' | 'context' | 'result' | 'provider' | 'tool';
export const isRuntimeErrorCode = (value: unknown): value is RuntimeErrorCode =>
  typeof value === 'string' && Object.hasOwn(runtimeErrorMessages, value);

// No free-text message, cause, provider body or arbitrary diagnostics accepted.
export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly stage: RuntimeStage | undefined;
  constructor(code: RuntimeErrorCode, stage?: RuntimeStage) {
    const safeCode = isRuntimeErrorCode(code) ? code : 'INTERNAL_RUNTIME_ERROR';
    super(runtimeErrorMessages[safeCode]);
    this.name = 'RuntimeError';
    this.code = safeCode;
    this.stage = ['request', 'definition', 'context', 'result', 'provider', 'tool'].includes(stage ?? '') ? stage : undefined;
    Object.freeze(this);
  }
  toJSON() { return { code: this.code, message: runtimeErrorMessages[this.code] }; }
}
