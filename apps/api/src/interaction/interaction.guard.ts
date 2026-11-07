import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiConfig } from '../config/config.module';
import { assertLocalRequest } from '../common/local-access.guard';
import { ApiLogger } from '../common/api-logger';
import { InteractionService } from './interaction.service';
import { establishInteraction, InteractionPrincipal } from './interaction.context';
import { uuid } from './interaction.contract';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class InteractionGuard implements CanActivate {
 constructor(private readonly config:ApiConfig,private readonly access:InteractionService,private readonly logger:ApiLogger){}
 private log(event:string,fields:Record<string,unknown>){try{this.logger.info(event,fields);}catch{/* Diagnostics do not decide authorization. */}}
 async canActivate(context:ExecutionContext):Promise<boolean> {
  const req=context.switchToHttp().getRequest<Request>(),c=this.config.value,token=c.interaction?.token;
  // Wrong/absent credentials continue to existing guards; never an operator fallback.
  const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token??''}`);
  if(!token||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return true;
  const principal=assertLocalRequest(req,c,token);
  establishInteraction({ownerId:principal.ownerId,agentId:'',operation:'read'},req);
  let agentId:string,operation:InteractionPrincipal['operation']='read';const path=req.path;let match:RegExpMatchArray|null;
  try{
   if(req.method==='POST'&&path==='/api/v1/tasks'){
    agentId=uuid(req.body?.agentId);operation='create';
    if(typeof req.body?.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(req.body.idempotencyKey))throw new BadRequestException();
    const agent=await this.access.agent(agentId);if(!['RULE_BASED','LLM'].includes(agent.type))throw new ForbiddenException();
   }else if(req.method==='GET'&&path==='/api/v1/tasks/lookup'){agentId=uuid(req.query.agentId);await this.access.agent(agentId);}
   else if(req.method==='GET'&&(match=path.match(/^\/api\/v1\/agents\/([^/]+)(?:\/executions)?$/))){agentId=uuid(match[1]);await this.access.agent(agentId);}
   else if((match=path.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/(status|execute|executions)(?:\/([^/]+)(?:\/(cancel|result))?)?)?$/))){
    const [,,section,executionId,action]=match;
    const read=req.method==='GET'&&section!=='execute'&&action!=='cancel';
    const execute=req.method==='POST'&&section==='execute'&&!executionId;
    const cancel=req.method==='POST'&&section==='executions'&&!!executionId&&action==='cancel';
    if(!read&&!execute&&!cancel)throw new ForbiddenException();
    const task=await this.access.task(match[1]);agentId=task.agentId;
    if(executionId)await this.access.execution(task.id,executionId);
    operation=execute?'execute':cancel?'cancel':'read';
   }else throw new ForbiddenException();
   establishInteraction({ownerId:principal.ownerId,agentId,operation},req);
   this.log('interaction.authorized',{audience:'interaction',operation});return true;
  }catch(error){this.log('interaction.denied',{audience:'interaction'});throw error;}
 }
}
