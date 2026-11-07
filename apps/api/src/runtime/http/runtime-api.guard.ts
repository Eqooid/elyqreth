import { BadRequestException, ExecutionContext, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Request } from 'express';
import { LocalAccessGuard } from '../../common/local-access.guard';
import { ApiConfig } from '../../config/config.module';

@Injectable()
export class RuntimeApiGuard extends LocalAccessGuard {
  constructor(private readonly runtimeConfig: ApiConfig) { super(runtimeConfig); }
  override canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);
    if (!this.runtimeConfig.value.runtime || !this.runtimeConfig.value.database) throw new NotFoundException();
    const req = context.switchToHttp().getRequest<Request>();
    if (Object.keys(req.query).length) throw new BadRequestException();
    if (req.method === 'POST') {
      if (!req.is('application/json')) throw new UnsupportedMediaTypeException();
      const body: unknown = req.body;
      const allowed = req.params.executionId ? ['taskVersion'] : [];
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException();
    } else if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body as object).length)) {
      throw new BadRequestException();
    }
    return true;
  }
}
