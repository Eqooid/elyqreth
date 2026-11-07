import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { mergeMap, Observable } from 'rxjs';
import { ApiConfig } from '../config/config.module';
import { InteractionService } from './interaction.service';
import { interactionPrincipal } from './interaction.context';
import { accountPrincipal } from '../auth/principal';

@Injectable()
export class InteractionInterceptor implements NestInterceptor {
 constructor(private readonly access:InteractionService,private readonly config:ApiConfig){}
 intercept(context:ExecutionContext,next:CallHandler):Observable<unknown> {
  const actor=interactionPrincipal(),account=accountPrincipal();
  if(!actor&&account){
   const request=context.switchToHttp().getRequest<Request>();
   // Presentation eligibility only; existing route guards and mutation services remain authoritative.
   return next.handle().pipe(mergeMap(async(value:unknown)=>{
    const data=value as Record<string,unknown>;let agentId:string|undefined,taskId:string|undefined,executionId:string|undefined;
    if(request.method==='GET'&&/^\/api\/v1\/agents\/[^/]+$/.test(request.path))agentId=String(data.id);
    else if(/^\/api\/v1\/tasks\/[^/]+(?:\/status|\/executions\/[^/]+)?$/.test(request.path)&&data.id&&data.agentId){
     agentId=String(data.agentId);if(data.taskId){taskId=String(data.taskId);executionId=String(data.id);}else taskId=String(data.id);
    }else if(request.method==='POST'&&request.path==='/api/v1/tasks'&&data.id&&data.agentId){agentId=String(data.agentId);taskId=String(data.id);}
    if(!agentId)return value;
    const eligibility=await this.access.eligibility(agentId,taskId,executionId);
    return {...data,actionEligibility:account.audience==='operator'?eligibility:{canCreateTask:false,canRequestStart:false,canRequestCancel:false,reason:'UNAVAILABLE'}};
   }));
  }
  if(!actor)return next.handle();
  const req=context.switchToHttp().getRequest<Request>();
  return next.handle().pipe(mergeMap(async(value:unknown)=>{
   // Existing serializers produce plain safe DTOs. No ORM or raw SDK objects reach this boundary.
   const data=value as Record<string,unknown>;
   if(req.path.endsWith('/result')||actor.operation==='execute'){
    const result=data.result as {output:{type:string};schemaVersion:number;executionId:string;usage?:unknown;toolSummary?:unknown}|null;
    if(result){const permitted=result.output.type!=='text'||this.config.value.interaction!.textAgentIds.includes(actor.agentId);
     const safe=permitted?{schemaVersion:result.schemaVersion,executionId:result.executionId,output:result.output,
      ...(result.usage?{usage:result.usage}:{}),...(result.toolSummary?{toolSummary:result.toolSummary}:{})}:null;
     return {...data,result:safe,...(!permitted?{...(req.path.endsWith('/result')?{availability:'UNAVAILABLE'}:{}),displayReason:'DISCLOSURE_RESTRICTED'}:{})};
    }return data;
   }
   if(req.path.endsWith('/lookup')||req.path.endsWith('/executions'))return data;
   if(/^\/api\/v1\/agents\/[^/]+$/.test(req.path))return {...data,actionEligibility:await this.access.eligibility(actor.agentId)};
   if(data.id&&data.taskId)return {...data,actionEligibility:await this.access.eligibility(actor.agentId,String(data.taskId),String(data.id))};
   if(data.id&&data.agentId&&actor.operation!=='cancel')return {...data,actionEligibility:await this.access.eligibility(actor.agentId,String(data.id))};
   return data;
  }));
 }
}
