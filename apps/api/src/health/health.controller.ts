import { RuntimeHostService } from '../runtime/runtime-host.service';
import { Controller, Get, Req, Res, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReadinessService } from './readiness.service';
import { internalProbe } from './readiness-access';

@Controller()
export class HealthController {
  constructor(private readonly readiness:ReadinessService,private readonly runtime:RuntimeHostService){}
  @Get('ready') async ready(@Req() req:Request,@Res({passthrough:true}) response:Response){
    if(!internalProbe(req))throw new NotFoundException();
    const ready=await this.readiness.ready();
    if(req.query.diagnostics==='true'){response.status(ready?200:503);return {status:ready?'ready':'not-ready',service:'elyqreth-api',runtime:this.runtime.snapshot(),readiness:this.readiness.snapshot()};}
    if(req.query.runtime==='true'){response.status(ready?200:503);return {status:ready?'ready':'not-ready',service:'elyqreth-api',runtime:this.runtime.snapshot()};}
    if(!ready)throw new ServiceUnavailableException();
    return {status:'ready',service:'elyqreth-api'};
  }
  @Get('health')
  getHealth(): { status: 'ok'; service: 'elyqreth-api' } {
    return { status: 'ok', service: 'elyqreth-api' };
  }
}
