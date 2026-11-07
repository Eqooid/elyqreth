import { BadRequestException, CanActivate, ExecutionContext, Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { assertLocalRequest } from '../common/local-access.guard';

@Injectable()
export class CollaborationHttpGuard implements CanActivate {
  constructor(private readonly config: ApiConfig) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    // Explicit operator authentication; no inherited interaction-principal shortcut.
    assertLocalRequest(req, this.config.value, this.config.value.registry?.token);
    const lookup = req.path.endsWith('/lookup');
    const list = req.method === 'GET' && /\/(participants|delegations)$/.test(req.path);
    const queryKeys = lookup ? ['idempotencyKey'] : list ? ['limit', 'after'] : [];
    if (Object.keys(req.query).some(k => !queryKeys.includes(k) || typeof req.query[k] !== 'string')) throw new BadRequestException();
    if (req.method === 'POST') {
      if (Object.keys(req.query).length) throw new BadRequestException();
      if (!req.is('application/json')) throw new UnsupportedMediaTypeException();
      const keys = /\/(cancel|recover|reconcile)$/.test(req.path) ? (req.path === '/api/v1/collaborations/reconcile' ? ['limit','after'] : []) : req.path.endsWith('/activate') ? ['instruction', 'idempotencyKey'] : req.path.endsWith('/delegations') ? ['sourceAgentId', 'targetAgentId', 'parentTaskId', 'sourceExecutionId', 'idempotencyKey'] :
        ['rootTaskId', 'participantAgentIds', 'idempotencyKey'];
      const body: unknown = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) throw new BadRequestException();
    } else if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw new BadRequestException();
    return true;
  }
}
