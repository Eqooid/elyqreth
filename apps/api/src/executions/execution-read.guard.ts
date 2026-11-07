import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { LocalAccessGuard } from '../common/local-access.guard';

@Injectable()
export class ExecutionReadGuard extends LocalAccessGuard {
  constructor(config: ApiConfig) { super(config); }
  override canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);
    const req = context.switchToHttp().getRequest<Request>();
    const allowed = req.params.executionId ? [] : ['limit','offset'];
    if (Object.keys(req.query).some(key => !allowed.includes(key)) ||
      (req.body !== undefined && Object.keys(req.body as object).length)) throw new BadRequestException();
    return true;
  }
}
