import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { LocalAccessGuard } from '../common/local-access.guard';
import { InteractionService } from './interaction.service';

@Controller('api/v1') @UseGuards(LocalAccessGuard)
export class InteractionController {
 constructor(private readonly interaction:InteractionService){}
 private read(req:Request){if(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new BadRequestException();}
 @Get('tasks/lookup') lookup(@Query() query:Record<string,unknown>,@Req() req:Request){this.read(req);return this.interaction.lookup(query);}
 @Get('agents/:agentId/executions') history(@Param('agentId',new ParseUUIDPipe()) id:string,@Query() query:Record<string,unknown>,@Req() req:Request){this.read(req);return this.interaction.history(id,query);}
}
