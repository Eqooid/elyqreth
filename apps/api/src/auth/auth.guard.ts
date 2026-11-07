import { Injectable,CanActivate,ExecutionContext,ForbiddenException,UnauthorizedException,NotFoundException,BadRequestException,UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { AuthenticationService } from './auth.service';
import { establishAccount,assertAccount } from './principal';
import { internalProbe } from '../health/readiness-access';
@Injectable()
export class AuthenticationGuard implements CanActivate{
 constructor(private readonly config:ApiConfig,private readonly authentication:AuthenticationService){}
 async canActivate(context:ExecutionContext){
  const c=this.config.value,req=context.switchToHttp().getRequest<Request>();if(!c.authentication)return true;
  if(req.path==='/ready'){if(internalProbe(req))return true;throw new NotFoundException();}
  if(req.path==='/health'&&['GET','HEAD'].includes(req.method))return true;
  if(req.headers.origin!==undefined&&!c.corsOrigins.includes(req.headers.origin))throw new ForbiddenException();
  if(req.path.startsWith('/api/v1/auth/')){
   if(Object.keys(req.query).length)throw new BadRequestException();
   if(req.path==='/api/v1/auth/login'&&req.method==='POST'&&!req.is('application/json'))throw new UnsupportedMediaTypeException();
   if(req.path!=='/api/v1/auth/login'&&req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new BadRequestException();
  }
  if(req.path==='/api/v1/auth/login'&&req.method==='POST'){
   if(c.authentication.mode!=='local')throw new NotFoundException();return true;
  }
  const header=req.headers.authorization;
  if(typeof header!=='string'||!/^Bearer [A-Za-z0-9_.-]{1,16384}$/.test(header))throw new UnauthorizedException();
  const principal=await this.authentication.authenticate(header.slice(7));establishAccount(req,c,principal);assertAccount(req,c);return true;
 }
}
