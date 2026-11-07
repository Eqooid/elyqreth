import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { LocalAccessGuard } from '../common/local-access.guard';

@Injectable()
export class EventHistoryGuard extends LocalAccessGuard {
  constructor(config:ApiConfig) {super(config);}
  override canActivate(context:ExecutionContext):boolean {
    super.canActivate(context);
    const request=context.switchToHttp().getRequest<Request>();
    if (Object.keys(request.query).some(key=>!['limit','offset','eventType','correlationId','after'].includes(key)) ||
      (request.query.after !== undefined && request.query.offset !== undefined && request.query.offset !== '0') ||
      (request.body !== undefined && Object.keys(request.body as object).length)) throw new BadRequestException();
    return true;
  }
}
