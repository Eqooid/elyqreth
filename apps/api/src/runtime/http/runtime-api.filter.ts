import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { ApiRequest } from '../../common/http-foundation';
import { RuntimeError, RuntimeErrorCode } from '../contracts/runtime-error.contract';

export function runtimeHttpStatus(code: RuntimeErrorCode): number {
  if(code==='RUNTIME_DRAINING')return 503;
  if (code === 'INTERNAL_RUNTIME_ERROR') return 500;
  if (code === 'ACCESS_DENIED' || code === 'TOOL_DENIED') return 403;
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'DEADLINE_EXCEEDED') return 504;
  if (['CAPACITY_EXCEEDED','CANCELLED','LEASE_LOST','DEFINITION_UNAVAILABLE'].includes(code)) return 409;
  if (['PROVIDER_RATE_LIMITED','PROVIDER_QUOTA_EXCEEDED'].includes(code)) return 429;
  if (['PROVIDER_UNAVAILABLE','PERSISTENCE_UNAVAILABLE','OUTCOME_UNCERTAIN','CONFIGURATION_ERROR','STRATEGY_NOT_FOUND'].includes(code)) return 503;
  if (['PROVIDER_AUTH_FAILED','MODEL_UNAVAILABLE','INVALID_PROVIDER_OUTPUT'].includes(code)) return 502;
  return 422;
}
@Catch(RuntimeError)
export class RuntimeApiFilter implements ExceptionFilter {
  catch(error: RuntimeError, host: ArgumentsHost): void {
    const http = host.switchToHttp(), req = http.getRequest<ApiRequest>(), res = http.getResponse<Response>();
    if (res.destroyed) return;
    res.status(runtimeHttpStatus(error.code)).json({statusCode:runtimeHttpStatus(error.code),
      message:error.message,code:error.code,requestId:req.requestId});
  }
}
