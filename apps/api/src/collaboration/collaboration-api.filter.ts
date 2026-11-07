import { RuntimeError } from '../runtime/contracts/runtime-error.contract';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable } from '@nestjs/common';
import { Response } from 'express';
import { ApiLogger } from '../common/api-logger';
import { ApiRequest } from '../common/http-foundation';
import { CollaborationError } from './collaboration.domain';

export function collaborationError(exception: unknown): { status: number; code: string } {
  if(exception instanceof RuntimeError && exception.code==='RUNTIME_DRAINING')return {status:503,code:'RUNTIME_DRAINING'};
  if (exception instanceof CollaborationError) return { status: ({ NOT_FOUND: 404, INVALID_INPUT: 400, ACCESS_DENIED: 403,
    PERSISTENCE_UNAVAILABLE: 503 } as Record<string, number>)[exception.code] ?? 409, code: exception.code };
  const status = exception instanceof HttpException ? exception.getStatus() : 500;
  return { status, code: ({ 400: 'INVALID_INPUT', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' } as Record<number, string>)[status] ?? 'INTERNAL_ERROR' };
}
@Injectable() @Catch()
export class CollaborationApiFilter implements ExceptionFilter {
  constructor(private readonly logger: ApiLogger) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp(), req = ctx.getRequest<ApiRequest>(), res = ctx.getResponse<Response>();
    const { status, code } = collaborationError(exception);
    if (status >= 500) try { this.logger.error('collaboration.failed', { statusCode: status }); } catch { /* Safe response independent of diagnostics. */ }
    if (res.headersSent) { res.end(); return; }
    const message = status === 400 ? 'Request is invalid.' : status === 401 ? 'Authentication required.' :
      status === 403 ? 'Access denied.' : status === 404 ? 'Route not found.' : status === 409 ? 'Request conflicts with current state.' :
      status === 503 ? 'Service unavailable.' : status >= 500 ? 'Internal server error.' : 'Request failed.';
    res.status(status).json({ statusCode: status, code, message, requestId: req.requestId });
  }
}
