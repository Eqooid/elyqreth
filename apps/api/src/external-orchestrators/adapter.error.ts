export const errorCodes = ['INVALID_INPUT','INVALID_CONFIGURATION','UNKNOWN_ADAPTER','UNSUPPORTED_CAPABILITY','ACCESS_DENIED','DISABLED','OPERATION_DISABLED',
  'AUTHENTICATION_FAILED','AUTHORIZATION_FAILED','CONNECTION_UNAVAILABLE','TIMEOUT','ABORTED','RATE_LIMITED','INVALID_PROVIDER_RESPONSE','NOT_FOUND',
  'TRANSIENT_FAILURE','PERMANENT_FAILURE','CAPACITY_EXCEEDED','RESPONSE_LIMIT'] as const;
export type AdapterErrorCode = typeof errorCodes[number];
export class AdapterError extends Error {
  readonly retryable: boolean;
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode) {
    const safe=errorCodes.includes(code)?code:'PERMANENT_FAILURE';
    super(safe); this.name = 'AdapterError'; this.code=safe;
    this.retryable = ['CONNECTION_UNAVAILABLE','TIMEOUT','RATE_LIMITED','TRANSIENT_FAILURE','CAPACITY_EXCEEDED'].includes(safe);
    Object.freeze(this);
  }
  toJSON() { return { code: this.code, retryable: this.retryable }; }
}
export function adapterError(error: unknown): AdapterError { return error instanceof AdapterError ? error : new AdapterError('TRANSIENT_FAILURE'); }
export function statusError(status: number): AdapterError {
  return new AdapterError(status === 401 ? 'AUTHENTICATION_FAILED' : status === 403 ? 'AUTHORIZATION_FAILED' : status === 404 ? 'NOT_FOUND' :
    status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'TRANSIENT_FAILURE' : 'PERMANENT_FAILURE');
}
