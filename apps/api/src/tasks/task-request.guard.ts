import { BadRequestException, ExecutionContext, Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { LocalAccessGuard } from '../common/local-access.guard';
import { validTaskInput } from './dto/task.dto';

@Injectable()
export class TaskRequestGuard extends LocalAccessGuard {
  constructor(config: ApiConfig) { super(config); }
  override canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);
    const req = context.switchToHttp().getRequest<Request>();
    const allowedQuery = req.params.id ? [] :
      ['limit', 'offset', 'status', 'agentId', 'orchestratorId', 'createdFrom', 'createdTo'];
    if (Object.keys(req.query).some(key => req.method !== 'GET' || !allowedQuery.includes(key))) throw new BadRequestException();
    if (req.method === 'POST') {
      if (!req.is('application/json')) throw new UnsupportedMediaTypeException();
      const body: unknown = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['agentId', 'input', 'idempotencyKey'].includes(key))) throw new BadRequestException();
      if (!validTaskInput((body as Record<string, unknown>).input)) throw new BadRequestException();
    } else if (req.body !== undefined && Object.keys(req.body as object).length) throw new BadRequestException();
    return true;
  }
}
