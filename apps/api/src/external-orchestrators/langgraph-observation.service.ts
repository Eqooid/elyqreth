import { Injectable } from '@nestjs/common';
import { IngestionAuthority,SourceSession } from './ingestion-authority';
import { ExternalIngestionService } from './external-ingestion.service';
import { ExternalAdapterService } from './external-adapter.service';
import { LANGGRAPH_CAPABILITIES,LANGGRAPH_DOMAIN } from './langgraph.adapter';
import { AdapterError } from './adapter.error';
@Injectable()
export class LangGraphObservationService {
  constructor(private readonly authority:IngestionAuthority,private readonly adapters:ExternalAdapterService,private readonly ingestion:ExternalIngestionService){}
  private access(session:SourceSession){const g=this.authority.check(session,true);if(g.connection.adapterType!=='langgraph.v1'||g.domain!==LANGGRAPH_DOMAIN)throw new AdapterError('ACCESS_DENIED');return {g,access:{ownerId:g.connection.ownerId,correlationId:g.correlationId,operations:LANGGRAPH_CAPABILITIES}};}
  async discover(session:SourceSession,limit=10,cursor?:string){const {g,access}=this.access(session);const result=await this.adapters.agents(access,g.connection.id,{limit,...(cursor===undefined?{}:{cursor})});this.access(session);return result;}
  async approve(session:SourceSession,executionId:string,signal=new AbortController().signal){
    const {g,access}=this.access(session);const run=await this.adapters.execution(access,g.connection.id,executionId,signal);
    // This explicit operator command approves only provider-verified identities, never Registry Agents/NPCs.
    await this.ingestion.mapAgent(session,{externalId:run.externalAgentId});
    return this.ingestion.mapExecution(session,{externalId:run.externalId,externalAgentId:run.externalAgentId});
  }
  async observe(operator:SourceSession,source:SourceSession,executionId:string,signal=new AbortController().signal){
    const {g,access}=this.access(operator),delivery=this.authority.check(source);
    if(delivery.kind!=='ingestion'||delivery.connection.id!==g.connection.id||delivery.connection.namespace!==g.connection.namespace||delivery.connection.generation!==g.connection.generation||delivery.domain!==LANGGRAPH_DOMAIN)throw new AdapterError('ACCESS_DENIED');
    const mapping=await this.ingestion.resolveExecution(operator,executionId);if(!mapping)throw new AdapterError('NOT_FOUND');
    const page=await this.adapters.events(access,g.connection.id,{limit:1,cursor:executionId},signal);
    this.access(operator);this.authority.check(source);
    const outcomes=[];for(const event of page.items)outcomes.push(await this.ingestion.ingest(source,event));return outcomes;
  }
  async result(session:SourceSession,executionId:string,signal=new AbortController().signal){const {g,access}=this.access(session);if(!await this.ingestion.resolveExecution(session,executionId))throw new AdapterError('NOT_FOUND');this.access(session);const result=await this.adapters.result(access,g.connection.id,executionId,signal);this.access(session);return result;}
}
