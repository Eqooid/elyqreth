import { assertAccount, AccountPrincipal } from '../auth/principal';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import type { ApiConfiguration } from '../config/configuration';
import { isLoopback } from '../agents/registry-configuration';
import { interactionPrincipal, interactionRequest } from '../interaction/interaction.context';
import type { LocalPrincipal } from './local-principal';

// Shared transport restrictions; the caller chooses the explicit credential audience.
export function assertLocalRequest(req:Request,config:ApiConfiguration,token:string|undefined):LocalPrincipal|AccountPrincipal {
  if(config.authentication)return assertAccount(req,config);
  const {nodeEnv,host,corsOrigins}=config;
  if(!token||!['development','test'].includes(nodeEnv)||!isLoopback(host))throw new NotFoundException();
  if(!isLoopback(req.socket.remoteAddress??''))throw new ForbiddenException();
  if(!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host??''))throw new ForbiddenException();
  if(req.headers.origin!==undefined&&!corsOrigins.includes(req.headers.origin))throw new ForbiddenException();
  const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new UnauthorizedException();
  // Resolve only configured, authenticated audiences. No client owner/tenant/actor claims.
  const audience = token === config.registry?.token ? 'operator' :
    token === config.cityRead?.token ? 'city-read' : token === config.interaction?.token ? 'interaction' :
    token === config.collaborationRead?.token ? 'collaboration-read' : undefined;
  if (!audience || !config.registry) throw new ForbiddenException();
  return Object.freeze({ kind: 'LOCAL_CREDENTIAL', audience, ownerId: config.registry.ownerId,
    actorReference: `local-${audience}` });
}

// Shared T04 development boundary, not a production authentication system.
@Injectable()
export class LocalAccessGuard implements CanActivate {
  constructor(private readonly config: ApiConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const actor = interactionPrincipal();
    if (actor) {
      // A scoped grant is not an operator credential. It cannot be inherited by a
      // different request, rewritten route, rotated token or changed configuration.
      if (!interactionRequest(req)) throw new ForbiddenException();
      const principal = assertLocalRequest(req, this.config.value, this.config.value.interaction?.token);
      if (principal.audience !== 'interaction' || actor.ownerId !== principal.ownerId ||
        !this.config.value.interaction?.agentIds.includes(actor.agentId)) throw new ForbiddenException();
      return true;
    }
    assertLocalRequest(req,this.config.value,this.config.value.registry?.token);
    return true;
  }
}
