import { Injectable,OnModuleInit } from '@nestjs/common';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import { AdapterRegistry } from './adapter-registry';
import { ExternalHttpTransport } from './external-http.transport';
import { AdapterError,adapterError } from './adapter.error';
import { AdapterContext,Capability,Connection,ExternalAccess,OrchestratorAdapter,PageInput,ConnectionHealth } from './adapter.contract';
import { agentDescriptor,executionDescriptor,eventEnvelope,resultDescriptor,health,snapshot,text,uuid,list,object,number } from './adapter.validation';
import { budget,CONCURRENCY,CONNECTION_CONCURRENCY,REQUEST_MS,RESPONSE_BYTES } from './adapter-budget';
import { safeConnection,connection,connectionBinding } from './external-configuration';

@Injectable()
export class ExternalAdapterService implements OnModuleInit {
  private active=0;
  private readonly connections=new Map<string,number>();
  constructor(private readonly config:ApiConfig,private readonly registry:AdapterRegistry,private readonly transport:ExternalHttpTransport,private readonly logger:ApiLogger) {}
  onModuleInit() {
    const seen=new Set<string>();
    for(const c of this.config.value.externalOrchestrators?.connections??[]){
      try{const parsed=connection(c);connectionBinding(parsed,this.config.value.externalOrchestrators?.credentials);if(seen.has(parsed.id))throw Error();seen.add(parsed.id);this.registry.resolve(c.adapterType).validateConfiguration(parsed);}catch{throw new AdapterError('INVALID_CONFIGURATION');}
    }
  }
  private owned(access:ExternalAccess,id:string,operation:Capability) {
    let owner:string,connectionId:string;
    try{owner=uuid(access.ownerId);connectionId=uuid(id);uuid(access.correlationId);if(!list(access.operations,12,v=>text(v)).includes(operation))throw Error();}
    catch{throw new AdapterError('ACCESS_DENIED');}
    const c=this.config.value.externalOrchestrators?.connections.find(c=>c.id===connectionId&&c.ownerId===owner);
    if(!c)throw new AdapterError('NOT_FOUND');return c;
  }
  describe(access:ExternalAccess,id:string,signal=new AbortController().signal) {return this.run(access,id,'health',signal,async(_a,_ctx,_c,s)=>s);}
  async health(access:ExternalAccess,id:string,signal=new AbortController().signal):Promise<ConnectionHealth> {
    const c=this.owned(access,id,'health');
    if(!c.enabled)return {connectionId:c.id,namespace:c.namespace,generation:c.generation,state:'DISABLED',checkedAt:new Date().toISOString()};
    try{return await this.run(access,id,'health',signal,async(a,ctx,c)=>health(await a.health(ctx),c));}
    catch(error){return {connectionId:c.id,namespace:c.namespace,generation:c.generation,state:'UNAVAILABLE',checkedAt:new Date().toISOString(),errorCode:adapterError(error).code};}
  }
  connection(access:ExternalAccess,id:string) {return safeConnection(this.owned(access,id,'health'));}
  private page(value:PageInput):PageInput {
    try{const v=object(value,['limit','cursor']);return Object.freeze({limit:number(v.limit,20),...(v.cursor===undefined?{}:{cursor:text(v.cursor)})});}
    catch{throw new AdapterError('INVALID_INPUT');}
  }
  private reference(value:string) {try{return text(value);}catch{throw new AdapterError('INVALID_INPUT');}}
  private parsePage<T>(value:unknown,limit:number,parse:(v:unknown)=>T) {
    const v=object(value,['items','nextCursor']);return Object.freeze({items:list(v.items,limit,parse),nextCursor:v.nextCursor===null?null:text(v.nextCursor)});
  }
  async agents(access:ExternalAccess,id:string,page:PageInput,signal=new AbortController().signal) {
    const q=this.page(page);return this.run(access,id,'agents',signal,async(a,ctx,c)=>this.parsePage(await a.discoverAgents!(ctx,q),q.limit,v=>agentDescriptor(v,c)));
  }
  async executions(access:ExternalAccess,id:string,page:PageInput,signal=new AbortController().signal) {
    const q=this.page(page);return this.run(access,id,'executions',signal,async(a,ctx,c)=>this.parsePage(await a.discoverExecutions!(ctx,q),q.limit,v=>executionDescriptor(v,c)));
  }
  async execution(access:ExternalAccess,id:string,externalId:string,signal=new AbortController().signal) {
    externalId=this.reference(externalId);return this.run(access,id,'status',signal,async(a,ctx,c)=>{const result=executionDescriptor(await a.getExecution!(ctx,externalId),c);if(result.externalId!==externalId)throw new AdapterError('INVALID_PROVIDER_RESPONSE');return result;});
  }
  async result(access:ExternalAccess,id:string,externalId:string,signal=new AbortController().signal) {
    externalId=this.reference(externalId);return this.run(access,id,'result',signal,async(a,ctx,c)=>{const result=resultDescriptor(await a.getResult!(ctx,externalId),c);if(result.executionId!==externalId)throw new AdapterError('INVALID_PROVIDER_RESPONSE');return result;});
  }
  async events(access:ExternalAccess,id:string,page:PageInput,signal=new AbortController().signal) {
    const q=this.page(page);return this.run(access,id,'events.poll',signal,async(a,ctx,c)=>this.parsePage(await a.pollEvents!(ctx,q),q.limit,v=>eventEnvelope(v,c)));
  }
  /** Foundation gate only. A durable remote command protocol must be reviewed before enabling dispatch. */
  mutation(access:ExternalAccess,id:string,operation:'dispatch'|'cancel',signal=new AbortController().signal) {
    return this.run(access,id,operation,signal,async()=>{throw new AdapterError('OPERATION_DISABLED');});
  }
  private async run<T>(access:ExternalAccess,id:string,operation:Capability,signal:AbortSignal,
    call:(adapter:Readonly<OrchestratorAdapter>,ctx:AdapterContext,c:Connection,s:ReturnType<typeof snapshot>)=>Promise<T>):Promise<T> {
    const c=this.owned(access,id,operation);
    if(!c.enabled)throw new AdapterError('DISABLED');
    if(['dispatch','cancel'].includes(operation)&&c.mode!=='CONTROLLED_DISPATCH')throw new AdapterError('ACCESS_DENIED');
    const adapter=this.registry.resolve(c.adapterType);
    if(!c.capabilities.includes(operation)||!adapter.capabilities.includes(operation))throw new AdapterError('UNSUPPORTED_CAPABILITY');
    const binding=connectionBinding(c,this.config.value.externalOrchestrators?.credentials),credential=this.config.value.externalOrchestrators?.credentials.resolve(c.credentialRef);
    const assertCurrent=()=>{const current=this.config.value.externalOrchestrators?.connections.find(v=>v.id===c.id&&v.ownerId===c.ownerId);
      try{if(!current||connectionBinding(current,this.config.value.externalOrchestrators?.credentials)!==binding)throw 0;}catch{throw new AdapterError('ACCESS_DENIED');}};
    const count=this.connections.get(c.id)??0;
    if(this.active>=CONCURRENCY||count>=CONNECTION_CONCURRENCY)throw new AdapterError('CAPACITY_EXCEEDED');
    this.active++;this.connections.set(c.id,count+1);let started=false;
    const release=()=>{this.active--;const count=this.connections.get(c.id)!-1;if(count)this.connections.set(c.id,count);else this.connections.delete(c.id);};
    const begun=Date.now(),deadline=begun+REQUEST_MS;
    try {
      const output=await budget(signal,deadline,active=>{
        started=true;
        const ctx:AdapterContext=Object.freeze({connectionId:c.id,namespace:c.namespace,generation:c.generation,correlationId:access.correlationId,deadlineAt:new Date(deadline).toISOString(),signal:active,
          http:Object.freeze({search:(path:string,body:Readonly<Record<string,unknown>>)=>{assertCurrent();return this.transport.search(c,path,body,active,deadline,credential);},get:(path:string)=>{assertCurrent();return this.transport.get(c,path,active,deadline,credential);}})});
        const pending=(async()=>{
          const negotiated=snapshot(await adapter.describe(ctx),c);if(active.aborted)throw active.reason;assertCurrent();
          const effective=negotiated.capabilities.filter(cap=>adapter.capabilities.includes(cap)&&c.capabilities.includes(cap)&&
            (c.mode==='CONTROLLED_DISPATCH'||!['dispatch','cancel','dispatch.idempotent'].includes(cap)));
          if(!effective.includes(operation))throw new AdapterError('UNSUPPORTED_CAPABILITY');
          if(['dispatch','cancel'].includes(operation)&&(!effective.includes('dispatch.idempotent')||!effective.includes('submission.lookup')))throw new AdapterError('UNSUPPORTED_CAPABILITY');
          const result=await call(adapter,ctx,c,Object.freeze({...negotiated,capabilities:Object.freeze(effective)}));
          if(active.aborted)throw active.reason;assertCurrent();
          const encoded=JSON.stringify(result);if(encoded.length>RESPONSE_BYTES||Buffer.byteLength(encoded)>RESPONSE_BYTES)throw new AdapterError('RESPONSE_LIMIT');
          if(this.config.value.externalOrchestrators?.credentials.contains(encoded)||credential&&(encoded.includes(credential)||encoded.includes(JSON.stringify(credential).slice(1,-1))))throw new AdapterError('INVALID_PROVIDER_RESPONSE');return result;
        })();
        // Keep the slot until actual settlement if a reviewed adapter ignores cancellation.
        return pending.finally(release);
      });
      try{this.logger.info('external.operation',{connectionId:c.id,adapterType:c.adapterType,operation,mode:c.mode,correlationId:access.correlationId,durationMs:Date.now()-begun,outcome:'SUCCEEDED'});}catch{}
      return output;
    } catch(error){const safe=adapterError(error);try{this.logger.info('external.operation',{connectionId:c.id,adapterType:c.adapterType,operation,mode:c.mode,correlationId:access.correlationId,durationMs:Date.now()-begun,outcome:'FAILED',code:safe.code});}catch{}throw safe;}
    finally{if(!started)release();}
  }
}
