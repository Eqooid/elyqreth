import { BadRequestException, CanActivate, Controller, ExecutionContext, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { assertLocalRequest } from '../common/local-access.guard';
import { AgentActivityProjectionService } from './activity.service';

@Injectable()
export class CityReadGuard implements CanActivate {
  constructor(private readonly config:ApiConfig) {}
  canActivate(context:ExecutionContext):boolean {
    const req=context.switchToHttp().getRequest<Request>(),c=this.config.value;
    assertLocalRequest(req,c,c.registry&&c.cityRead?c.cityRead.token:undefined);
    if(req.params.cityId!=='elyqreth')throw new NotFoundException();
    if(req.method!=='GET'||req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new BadRequestException();
    return true;
  }
}
@Controller('api/v1/cities/:cityId/agents') @UseGuards(CityReadGuard)
export class CityActivityController {
  constructor(private readonly activity:AgentActivityProjectionService) {}
  @Get() batch(@Query() query:unknown) {return this.activity.batch(query,true);}
  @Get(':agentId/activity') single(@Param('agentId',new ParseUUIDPipe()) agentId:string,@Query() query:Record<string,unknown>) {
    if(Object.keys(query).length)throw new BadRequestException();return this.activity.single(agentId,true);
  }
}
