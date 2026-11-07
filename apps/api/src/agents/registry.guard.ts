import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { LocalAccessGuard } from '../common/local-access.guard';

@Injectable()
export class RegistryGuard extends LocalAccessGuard {
  constructor(config: ApiConfig) { super(config); }

  override canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);
    const req = context.switchToHttp().getRequest<Request>();
    if ((req.method !== 'GET' || req.params?.id) && Object.keys(req.query ?? {}).length) throw new BadRequestException();
    // Inspect raw keys too: class-transformer intentionally drops constructor/__proto__.
    // Such fields must be rejected rather than silently stripped from these commands.
    const body: unknown = req.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const allowed = req.method === 'PATCH' ? ['name', 'description', 'capabilities', 'configuration'] :
        req.method === 'POST' && !req.params?.id ? ['name', 'description', 'type', 'orchestratorId', 'capabilities', 'configuration'] : [];
      if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException();
      const metadata: unknown = (body as Record<string, unknown>).configuration;
      if (metadata && typeof metadata === 'object' &&
        Object.keys(metadata).some(key => !['category', 'color'].includes(key))) throw new BadRequestException();
    }
    return true;
  }
}
