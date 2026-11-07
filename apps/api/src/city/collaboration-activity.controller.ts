import { Controller,Get,Param,ParseUUIDPipe,Query,UseGuards,UseFilters,Injectable,CanActivate,ExecutionContext,BadRequestException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { assertLocalRequest } from '../common/local-access.guard';
import { CollaborationApiFilter } from '../collaboration/collaboration-api.filter';
import { CollaborationActivityService } from './collaboration-activity.service';
@Injectable()
export class CollaborationActivityGuard implements CanActivate{
 constructor(private readonly config:ApiConfig){}
 canActivate(ctx:ExecutionContext){const req=ctx.switchToHttp().getRequest<Request>();const config=this.config.value,read=config.collaborationRead?.token,supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+(read??''));const limited=!!read&&supplied.length===expected.length&&timingSafeEqual(supplied,expected);assertLocalRequest(req,config,limited?read:config.registry?.token);if(req.method!=='GET'||req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new BadRequestException();return true;}
}
@Controller('api/v1/collaboration-activity') @UseGuards(CollaborationActivityGuard) @UseFilters(CollaborationApiFilter)
export class CollaborationActivityController{
 constructor(private readonly activity:CollaborationActivityService){}
 @Get() list(@Query() q:unknown){return this.activity.list(q);}
 @Get('agents/:agentId') agent(@Param('agentId',new ParseUUIDPipe()) id:string,@Query() q:unknown){return this.activity.agent(id,q);}
 @Get(':sessionId/snapshot') snapshot(@Param('sessionId',new ParseUUIDPipe()) id:string,@Query() q:unknown){return this.activity.snapshot(id,q);}
 @Get(':sessionId/timeline') timeline(@Param('sessionId',new ParseUUIDPipe()) id:string,@Query() q:unknown){return this.activity.timeline(id,q);}
 @Get(':sessionId/events') events(@Param('sessionId',new ParseUUIDPipe()) id:string,@Query() q:unknown){return this.activity.events(id,q);}
}
