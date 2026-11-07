import { RuntimeError, RuntimeErrorCode } from '../contracts/runtime-error.contract';

export type ProviderFailure = 'not_registered'|'configuration'|'missing_model'|'unsupported'|'unavailable'|'timeout'|'cancelled'|'invalid_response'|'rate_limited'|'authentication'|'quota_exhausted'|'internal';
const codes:Readonly<Record<ProviderFailure,RuntimeErrorCode>>=Object.freeze({not_registered:'PROVIDER_UNAVAILABLE',configuration:'CONFIGURATION_ERROR',
  missing_model:'MODEL_UNAVAILABLE',unsupported:'UNSUPPORTED_CAPABILITY',unavailable:'PROVIDER_UNAVAILABLE',timeout:'DEADLINE_EXCEEDED',
  cancelled:'CANCELLED',invalid_response:'INVALID_PROVIDER_OUTPUT',rate_limited:'PROVIDER_RATE_LIMITED',authentication:'PROVIDER_AUTH_FAILED',quota_exhausted:'PROVIDER_QUOTA_EXCEEDED',internal:'INTERNAL_RUNTIME_ERROR'});
// Future adapters map protocol facts to this closed classification. Never parse
// error messages, emit a vendor response body or preserve arbitrary error.cause.
export function providerError(kind:ProviderFailure):RuntimeError {
  return new RuntimeError(Object.hasOwn(codes,kind)?codes[kind]:'INTERNAL_RUNTIME_ERROR','provider');
}
export function normalizeProviderError(error:unknown):RuntimeError {
  return error instanceof RuntimeError ? error : providerError('internal');
}
export function providerFailureAdvice(error:RuntimeError) {
  return Object.freeze({potentiallyTransient:['PROVIDER_UNAVAILABLE','PROVIDER_RATE_LIMITED'].includes(error.code),
    outcomeUncertain:['DEADLINE_EXCEEDED','CANCELLED','OUTCOME_UNCERTAIN'].includes(error.code),automaticRetry:false as const});
}
