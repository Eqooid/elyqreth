import { Injectable } from '@nestjs/common';
import { createHash,timingSafeEqual } from 'node:crypto';
import { ApiConfig } from '../config/config.module';
import { isLoopback } from '../agents/registry-configuration';
import { Connection } from './adapter.contract';
import { uuid,key } from './adapter.validation';
import { IngestionError } from './ingestion.domain';
import { connectionBinding } from './external-configuration';
export interface SourceSession { readonly sourceSession: true }
type Grant={connection:Connection;kind:'operator'|'ingestion';correlationId:string;domain:string|null;credentialHash:Buffer;binding:string;expires:number};
const digest=(value:string)=>createHash('sha256').update(value).digest();
@Injectable()
export class IngestionAuthority {
  readonly #sessions=new WeakMap<object,Grant>();
  constructor(private readonly config:ApiConfig){}
  /** Internal local operator approval only; never expose this as a generic webhook/principal constructor. */
  authorize(credential:string,connectionId:string,correlationId:string,kind:'operator'|'ingestion',orderingDomain?:string):SourceSession {
    const config=this.config.value;
    if(config.authentication||!config.registry?.token||!['development','test'].includes(config.nodeEnv)||!isLoopback(config.host)||typeof credential!=='string'||credential.length>4096||
      !timingSafeEqual(digest(credential),digest(config.registry.token)))throw new IngestionError('ACCESS_DENIED');
    let id:string,correlation:string,domain:string|null;
    try{id=uuid(connectionId);correlation=uuid(correlationId);domain=orderingDomain===undefined?null:key(orderingDomain);}catch{throw new IngestionError('INVALID_INPUT');}
    const connection=config.externalOrchestrators?.connections.find(c=>c.id===id&&c.ownerId===config.registry!.ownerId);
    if(!connection||!connection.enabled||!['operator','ingestion'].includes(kind))throw new IngestionError('NOT_FOUND');
    if(kind==='ingestion'&&!connection.capabilities.some(c=>['events.poll','events.subscribe','events.webhook'].includes(c)))throw new IngestionError('ACCESS_DENIED');
    let binding:string;try{binding=connectionBinding(connection,config.externalOrchestrators?.credentials);}catch{throw new IngestionError('ACCESS_DENIED');}
    const session=Object.freeze({sourceSession:true as const});this.#sessions.set(session,Object.freeze({connection,kind,correlationId:correlation,domain,credentialHash:digest(credential),binding,expires:Date.now()+300000}));return session;
  }
  check(session:SourceSession,operator=false):Readonly<Pick<Grant,'connection'|'kind'|'correlationId'|'domain'>> {
    const grant=session&&typeof session==='object'?this.#sessions.get(session):undefined,config=this.config.value;
    if(!grant||grant.expires<=Date.now()||operator&&grant.kind!=='operator'||config.authentication||!config.registry?.token||!['development','test'].includes(config.nodeEnv)||!isLoopback(config.host)||
      !timingSafeEqual(grant.credentialHash,digest(config.registry.token)))throw new IngestionError('ACCESS_DENIED');
    const current=config.externalOrchestrators?.connections.find(c=>c.id===grant.connection.id&&c.ownerId===grant.connection.ownerId);
    if(!current?.enabled||current.ownerId!==config.registry.ownerId||current.namespace!==grant.connection.namespace||current.generation!==grant.connection.generation||current.adapterType!==grant.connection.adapterType||
      grant.kind==='ingestion'&&!current.capabilities.some(c=>['events.poll','events.subscribe','events.webhook'].includes(c)))
      throw new IngestionError('ACCESS_DENIED');
    try{if(connectionBinding(current,config.externalOrchestrators?.credentials)!==grant.binding)throw 0;}catch{throw new IngestionError('ACCESS_DENIED');}
    // Never expose mutable authorization state, its expiry or credential fingerprint to a session holder.
    return Object.freeze({connection:grant.connection,kind:grant.kind,correlationId:grant.correlationId,domain:grant.domain});
  }
}
