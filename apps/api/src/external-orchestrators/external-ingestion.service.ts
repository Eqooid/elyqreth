import { Injectable } from '@nestjs/common';
import { and,asc,eq,gt,inArray,isNull,sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import type { PersistenceTransaction } from '../common/persistence';
import { orchestrators,agents,collaborationSessions,collaborationParticipants,collaborationDelegations,commandAudit,
  externalSources as sources,externalAgentMappings as agentMaps,externalExecutionMappings as executionMaps,externalInbox as inbox } from '../database/schema';
import { IngestionAuthority,SourceSession } from './ingestion-authority';
import { IngestionError,eventHash,ordering,normalizeExternalStatus } from './ingestion.domain';
import { eventEnvelope,object,text,uuid,number } from './adapter.validation';
import type { ExternalEventEnvelope } from './adapter.contract';
type Grant=ReturnType<IngestionAuthority['check']>;
type Tx=PersistenceTransaction;
type Source=typeof sources.$inferSelect;
type Receipt=typeof inbox.$inferSelect;
const finalReceipt=(status:string)=>['APPLIED','STALE','OBSERVED'].includes(status);
const receiptView=(r:Receipt)=>Object.freeze({id:r.id,eventId:r.eventId,status:r.status,externalAgentId:typeof r.event.externalAgentId==='string'?r.event.externalAgentId:null,externalExecutionId:typeof r.event.externalExecutionId==='string'?r.event.externalExecutionId:null,receivedAt:r.receivedAt.toISOString(),processedAt:r.processedAt?.toISOString()??null});

@Injectable()
export class ExternalIngestionService {
  constructor(private readonly database:DatabaseService,private readonly authority:IngestionAuthority,private readonly config:ApiConfig,private readonly logger:ApiLogger){}
  private async transaction<T>(session:SourceSession,operator:boolean,run:(tx:Tx,g:Grant,s:Source)=>Promise<T>):Promise<T> {
    const g=this.authority.check(session,operator);
    try{return await this.database.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${g.connection.ownerId+':external-ingestion'},0))`);
      this.authority.check(session,operator);
      const [registration]=await tx.select().from(orchestrators).where(and(eq(orchestrators.id,g.connection.id),eq(orchestrators.ownerId,g.connection.ownerId))).for('share');
      if(!registration||registration.type==='native'||registration.type!==g.connection.adapterType||registration.registrationStatus!=='ENABLED')throw new IngestionError('ACCESS_DENIED');
      await tx.insert(sources).values({ownerId:g.connection.ownerId,connectionId:g.connection.id,namespace:g.connection.namespace,generation:g.connection.generation,adapterType:g.connection.adapterType,orderingDomain:g.domain}).onConflictDoNothing();
      const [s]=await tx.select().from(sources).where(and(eq(sources.ownerId,g.connection.ownerId),eq(sources.connectionId,g.connection.id),eq(sources.namespace,g.connection.namespace),eq(sources.generation,g.connection.generation))).for('update');
      if(!s||s.adapterType!==g.connection.adapterType||s.orderingDomain!==g.domain)throw new IngestionError('MAPPING_CONFLICT');
      const result=await run(tx,g,s);
      this.authority.check(session,operator); // Revalidate after asynchronous mutation, before commit.
      return result;
    });}catch(error){
      if(error instanceof IngestionError)throw error;
      const candidate=error as {code?:string;cause?:{code?:string}}|null,code=candidate?.cause?.code??candidate?.code;
      throw new IngestionError(['23505','40001','40P01'].includes(code??'')?'CONFLICT':['23503','23514','22P02'].includes(code??'')?'INVALID_CORRELATION':'PERSISTENCE_UNAVAILABLE');
    }
  }
  private audit(tx:Tx,g:Grant,type:string,id:string,details:Record<string,string|null>) {
    return tx.insert(commandAudit).values({ownerId:g.connection.ownerId,actorReference:g.kind==='operator'?'local-external-operator':'trusted-external-source-session',commandType:type,resourceType:'external',resourceId:id,correlationId:g.correlationId,outcome:'ACCEPTED',details});
  }
  private diagnostic(session:SourceSession,outcome:string,code?:string) {
    try{const g=this.authority.check(session);this.logger.info('external.ingestion',{connectionId:g.connection.id,correlationId:g.correlationId,outcome,...(code?{code}:{})});}
    catch{try{this.logger.info('external.ingestion.authorization_denied',{code:'ACCESS_DENIED',outcome:outcome==='REJECTED'?'REJECTED':'UNCONFIRMED'});}catch{/* No untrusted identity or payload diagnostics. */}}
  }
  private async validAgent(tx:Tx,s:Source,m:typeof agentMaps.$inferSelect|undefined) {
    if(!m||m.status!=='ACTIVE')return false;
    if(m.internalAgentId){const [a]=await tx.select().from(agents).where(and(eq(agents.id,m.internalAgentId),eq(agents.ownerId,s.ownerId))).for('share');if(!a||a.type!=='EXTERNAL'||a.orchestratorId!==s.connectionId||a.lifecycleStatus==='ARCHIVED')return false;}
    return true;
  }
  async mapAgent(session:SourceSession,input:unknown) {
    let v:Record<string,unknown>,externalId:string,internalAgentId:string|null;
    try{v=object(input,['externalId','internalAgentId']);externalId=text(v.externalId);internalAgentId=v.internalAgentId===undefined?null:uuid(v.internalAgentId);}catch{throw new IngestionError('INVALID_INPUT');}
    return this.transaction(session,true,async(tx,g,s)=>{
      const [old]=await tx.select().from(agentMaps).where(and(eq(agentMaps.ownerId,s.ownerId),eq(agentMaps.sourceId,s.id),eq(agentMaps.externalId,externalId)));
      if(old){if(old.internalAgentId!==internalAgentId||!await this.validAgent(tx,s,old))throw new IngestionError('MAPPING_CONFLICT');return old;}
      if(internalAgentId){const [a]=await tx.select().from(agents).where(and(eq(agents.ownerId,s.ownerId),eq(agents.id,internalAgentId))).for('share');if(!a||a.type!=='EXTERNAL'||a.orchestratorId!==s.connectionId||a.lifecycleStatus==='ARCHIVED')throw new IngestionError('INVALID_CORRELATION');}
      const [m]=await tx.insert(agentMaps).values({ownerId:s.ownerId,sourceId:s.id,externalId,internalAgentId}).returning();if(!m)throw new IngestionError('PERSISTENCE_UNAVAILABLE');
      await this.audit(tx,g,'external.agent.mapped',m.id,{connectionId:s.connectionId,sourceId:s.id});return m;
    });
  }
  async tombstone(session:SourceSession,mappingId:string,expectedVersion:number) {
    try{mappingId=uuid(mappingId);number(expectedVersion,2147483647);}catch{throw new IngestionError('INVALID_INPUT');}
    return this.transaction(session,true,async(tx,g,s)=>{
      // Explicitly retire old incarnations of the same owned connection; never silently rebind/reactivate.
      const [m]=await tx.select({mapping:agentMaps,source:sources}).from(agentMaps).innerJoin(sources,and(eq(agentMaps.sourceId,sources.id),eq(agentMaps.ownerId,sources.ownerId)))
        .where(and(eq(agentMaps.id,mappingId),eq(agentMaps.ownerId,s.ownerId),eq(sources.connectionId,s.connectionId)));
      if(!m)throw new IngestionError('NOT_FOUND');if(m.mapping.status==='TOMBSTONED')return m.mapping;
      if(m.mapping.version!==expectedVersion)throw new IngestionError('CONFLICT');
      const [updated]=await tx.update(agentMaps).set({status:'TOMBSTONED'}).where(eq(agentMaps.id,mappingId)).returning();
      await this.audit(tx,g,'external.agent.tombstoned',mappingId,{connectionId:s.connectionId,sourceId:m.source.id});return updated!;
    });
  }
  private async correlation(tx:Tx,s:Source,m:typeof agentMaps.$inferSelect,collaborationId:string|null,delegationId:string|null) {
    if(!collaborationId){if(delegationId)throw new IngestionError('INVALID_CORRELATION');return;}
    const [collaboration]=await tx.select().from(collaborationSessions).where(and(eq(collaborationSessions.id,collaborationId),eq(collaborationSessions.ownerId,s.ownerId))).for('share');
    if(!collaboration||collaboration.authority!=='EXTERNAL'||!m.internalAgentId)throw new IngestionError('INVALID_CORRELATION');
    const [member]=await tx.select({id:collaborationParticipants.id}).from(collaborationParticipants).where(and(eq(collaborationParticipants.ownerId,s.ownerId),eq(collaborationParticipants.sessionId,collaborationId),eq(collaborationParticipants.agentId,m.internalAgentId),isNull(collaborationParticipants.leftAt))).limit(1).for('share');
    if(!member)throw new IngestionError('INVALID_CORRELATION');
    if(delegationId){const [d]=await tx.select().from(collaborationDelegations).where(and(eq(collaborationDelegations.id,delegationId),eq(collaborationDelegations.ownerId,s.ownerId),eq(collaborationDelegations.sessionId,collaborationId))).for('share');if(!d||d.targetAgentId!==m.internalAgentId)throw new IngestionError('INVALID_CORRELATION');}
  }
  async mapExecution(session:SourceSession,input:unknown) {
    let externalId:string,externalAgentId:string,collaborationId:string|null,delegationId:string|null;
    try{const v=object(input,['externalId','externalAgentId','collaborationId','delegationId']);externalId=text(v.externalId);externalAgentId=text(v.externalAgentId);collaborationId=v.collaborationId===undefined?null:uuid(v.collaborationId);delegationId=v.delegationId===undefined?null:uuid(v.delegationId);}catch{throw new IngestionError('INVALID_INPUT');}
    return this.transaction(session,true,async(tx,g,s)=>{
      const [m]=await tx.select().from(agentMaps).where(and(eq(agentMaps.ownerId,s.ownerId),eq(agentMaps.sourceId,s.id),eq(agentMaps.externalId,externalAgentId)));
      if(!await this.validAgent(tx,s,m))throw new IngestionError('INVALID_CORRELATION');
      await this.correlation(tx,s,m!,collaborationId,delegationId);
      const [old]=await tx.select().from(executionMaps).where(and(eq(executionMaps.ownerId,s.ownerId),eq(executionMaps.sourceId,s.id),eq(executionMaps.externalId,externalId)));
      if(old){if(old.agentMappingId!==m!.id||old.collaborationId!==collaborationId||old.delegationId!==delegationId)throw new IngestionError('MAPPING_CONFLICT');return old;}
      const [row]=await tx.insert(executionMaps).values({ownerId:s.ownerId,sourceId:s.id,externalId,agentMappingId:m!.id,collaborationId,delegationId}).returning();if(!row)throw new IngestionError('PERSISTENCE_UNAVAILABLE');
      await this.audit(tx,g,'external.execution.mapped',row.id,{connectionId:s.connectionId,agentMappingId:m!.id});return row;
    });
  }
  async resolveAgent(session:SourceSession,externalId:string) {externalId=text(externalId);return this.transaction(session,false,async(tx,_g,s)=>{
    const [m]=await tx.select().from(agentMaps).where(and(eq(agentMaps.ownerId,s.ownerId),eq(agentMaps.sourceId,s.id),eq(agentMaps.externalId,externalId)));return m??null;
  });}
  async resolveExecution(session:SourceSession,externalId:string) {externalId=text(externalId);return this.transaction(session,false,async(tx,_g,s)=>{
    const [m]=await tx.select().from(executionMaps).where(and(eq(executionMaps.ownerId,s.ownerId),eq(executionMaps.sourceId,s.id),eq(executionMaps.externalId,externalId)));return m??null;
  });}
  private parse(session:SourceSession,input:unknown):ExternalEventEnvelope {
    const g=this.authority.check(session);
    if(g.kind!=='ingestion')throw new IngestionError('ACCESS_DENIED');
    try{const normalized=eventEnvelope(input,g.connection),encoded=JSON.stringify(normalized),token=this.config.value.registry?.token;
      if(Buffer.byteLength(encoded)>12000||this.config.value.externalOrchestrators?.credentials.contains(encoded)||token&&encoded.includes(token))throw Error();
      return Object.freeze({...normalized,receivedAt:new Date().toISOString()});
    }catch{throw new IngestionError('INVALID_INPUT');}
  }
  /** Durable receipt commits independently so interruption before projection is safely replayable. */
  async receive(session:SourceSession,input:unknown) {
    try{const event=this.parse(session,input),hash=eventHash(event);
    const received=await this.transaction(session,false,async(tx,g,s)=>{
      const [old]=await tx.select().from(inbox).where(and(eq(inbox.ownerId,s.ownerId),eq(inbox.sourceId,s.id),eq(inbox.eventId,event.eventId)));
      if(old){if(old.contentHash!==hash)throw new IngestionError('IDEMPOTENCY_CONFLICT');return {duplicate:true,receipt:receiptView(old)};}
      const [row]=await tx.insert(inbox).values({ownerId:s.ownerId,sourceId:s.id,eventId:event.eventId,contentHash:hash,event:event as unknown as Record<string,unknown>,correlationId:g.correlationId}).returning();
      if(!row)throw new IngestionError('PERSISTENCE_UNAVAILABLE');await this.audit(tx,g,'external.event.accepted',row.id,{connectionId:s.connectionId,sourceId:s.id});return {duplicate:false,receipt:receiptView(row)};
    });this.diagnostic(session,received.duplicate?'DUPLICATE':'ACCEPTED');return received;
    }catch(error){this.diagnostic(session,'REJECTED',error instanceof IngestionError?error.code:'PERSISTENCE_UNAVAILABLE');throw error;}
  }
  async ingest(session:SourceSession,input:unknown) {
    const received=await this.receive(session,input);
    try{return {...received,receipt:await this.process(session,received.receipt.id),outcome:received.duplicate?'DUPLICATE':'ACCEPTED'};}
    catch(error){if(!(error instanceof IngestionError)||error.code!=='PERSISTENCE_UNAVAILABLE')throw error;this.diagnostic(session,'PROJECTION_FAILED',error.code);return {...received,outcome:'DEFERRED',errorCode:error.code};}
  }
  async process(session:SourceSession,receiptId:string) {
    try{receiptId=uuid(receiptId);}catch{throw new IngestionError('INVALID_INPUT');}
    const processed=await this.transaction(session,false,async(tx,g,s)=>{
      const [row]=await tx.select().from(inbox).where(and(eq(inbox.id,receiptId),eq(inbox.ownerId,s.ownerId),eq(inbox.sourceId,s.id))).for('update');
      if(!row)throw new IngestionError('NOT_FOUND');if(finalReceipt(row.status))return {receipt:receiptView(row),changed:false};
      const event=eventEnvelope(row.event,g.connection);if(eventHash(event)!==row.contentHash)throw new IngestionError('CONFLICT');
      let status:typeof row.status='OBSERVED',projectionId:string|null=null;
      const [m]=event.externalAgentId?await tx.select().from(agentMaps).where(and(eq(agentMaps.ownerId,s.ownerId),eq(agentMaps.sourceId,s.id),eq(agentMaps.externalId,event.externalAgentId))):[];
      if(event.externalAgentId&&!await this.validAgent(tx,s,m))status='DEFERRED_MAPPING';
      else if(event.kind==='execution.observed'){
        const [execution]=await tx.select().from(executionMaps).where(and(eq(executionMaps.ownerId,s.ownerId),eq(executionMaps.sourceId,s.id),eq(executionMaps.externalId,event.externalExecutionId!))).for('update');
        if(!execution)status='DEFERRED_MAPPING';
        else if(execution.agentMappingId!==m!.id)status='DEFERRED_CONFLICT';
        else {
          projectionId=execution.id;
          // Correlation is revalidated on application; it never writes collaboration/native status.
          try{await this.correlation(tx,s,m!,execution.collaborationId,execution.delegationId);}catch(error){if(error instanceof IngestionError&&error.code==='INVALID_CORRELATION')status='DEFERRED_CONFLICT';else throw error;}
          if(status!=='DEFERRED_CONFLICT')status=ordering({status:execution.status,domain:execution.sequenceDomain,sequence:execution.sequence},event,s.orderingDomain);
          if(status==='APPLIED'){
            await tx.update(executionMaps).set({status:event.normalizedStatus??normalizeExternalStatus(event.sourceStatus),sourceStatus:event.sourceStatus??null,sequenceDomain:event.sequence!.domain,sequence:event.sequence!.value,
              lastEventId:event.eventId,occurredAt:event.occurredAt?new Date(event.occurredAt):null,observedAt:row.receivedAt}).where(eq(executionMaps.id,execution.id));
          }
        }
      }
      if(status===row.status)return {receipt:receiptView(row),changed:false};
      const [updated]=await tx.update(inbox).set({status,processedAt:new Date()}).where(eq(inbox.id,row.id)).returning();
      await this.audit(tx,g,`external.event.${status.toLowerCase()}`,row.id,{connectionId:s.connectionId,sourceId:s.id,executionMappingId:projectionId,receiptCorrelationId:row.correlationId});return {receipt:receiptView(updated!),changed:true};
    });
    if(processed.changed)this.diagnostic(session,'PROJECTION_'+processed.receipt.status);
    return processed.receipt;
  }
  async replay(session:SourceSession,query:{limit?:number;after?:string}={}) {
    let limit:number,after:string|undefined;try{const q=object(query,['limit','after']);limit=q.limit===undefined?10:number(q.limit,20);after=q.after===undefined?undefined:uuid(q.after);}catch{throw new IngestionError('INVALID_INPUT');}
    const ids=await this.transaction(session,true,(tx,_g,s)=>tx.select({id:inbox.id}).from(inbox).where(and(eq(inbox.ownerId,s.ownerId),eq(inbox.sourceId,s.id),inArray(inbox.status,['PENDING','DEFERRED_MAPPING','DEFERRED_ORDERING','DEFERRED_CONFLICT']),...(after?[gt(inbox.id,after)]:[]))).orderBy(asc(inbox.id)).limit(limit+1));
    const items=[];for(const row of ids.slice(0,limit))items.push(await this.process(session,row.id));
    return {items,nextCursor:ids.length>limit?ids[limit-1]!.id:null};
  }
  async history(session:SourceSession,query:{limit?:number;after?:string}={}) {
    let limit:number,after:string|undefined;try{const q=object(query,['limit','after']);limit=q.limit===undefined?10:number(q.limit,20);after=q.after===undefined?undefined:uuid(q.after);}catch{throw new IngestionError('INVALID_INPUT');}
    return this.transaction(session,true,async(tx,_g,s)=>{
      const rows=await tx.select().from(inbox).where(and(eq(inbox.ownerId,s.ownerId),eq(inbox.sourceId,s.id),...(after?[gt(inbox.id,after)]:[]))).orderBy(asc(inbox.id)).limit(limit+1);
      return {items:rows.slice(0,limit).map(receiptView),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
    });
  }
}
