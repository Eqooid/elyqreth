import { Body,Controller,Get,Post,Req,HttpCode,NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { AuthenticationService } from './auth.service';
import { assertAccount } from './principal';
@Controller('api/v1/auth')
export class AuthenticationController{
 constructor(private readonly authentication:AuthenticationService,private readonly config:ApiConfig){}
 @Post('login') @HttpCode(200) login(@Body() body:unknown){return this.authentication.login(body);}
 @Get('me') me(@Req() request:Request){
  if(!this.config.value.authentication)throw new NotFoundException();
  const p=assertAccount(request,this.config.value);return {kind:p.kind,role:p.audience,ownerId:p.ownerId,actorReference:p.actorReference};
 }
 @Post('logout') @HttpCode(200) logout(@Req() request:Request){if(!this.config.value.authentication)throw new NotFoundException();return this.authentication.logout(assertAccount(request,this.config.value));}
}
