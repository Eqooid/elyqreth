import { operationalMode } from '../auth/principal';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import { isLoopback } from '../agents/registry-configuration';
import { AgentActivityRepository } from './activity.repository';
import { activityQuery, ActivityPage, agentIdentifier, safeDate } from './activity.contract';
import { mapAgentActivity } from './activity.mapper';
import { withExternalActivity } from './external-activity.mapper';

@Injectable()
export class AgentActivityProjectionService {
  constructor(private readonly config:ApiConfig,private readonly repository:AgentActivityRepository,private readonly logger:ApiLogger) {}
  private scope(cityRead:boolean):string {
    const c=this.config.value;
    if(!operationalMode(c)||!c.database||!c.registry||(cityRead&&!c.cityRead))throw new NotFoundException();
    return c.registry.ownerId;
  }
  private log(event:string,fields:Record<string,unknown>) {try{this.logger.info(event,fields);}catch{/* Read results do not depend on diagnostics. */}}
  async single(value:unknown,cityRead=false) {
    const id=agentIdentifier(value),page=await this.batch({ids:id},cityRead);
    if(!page.items[0])throw new NotFoundException();return page.items[0];
  }
  async batch(value:unknown={},cityRead=false):Promise<ActivityPage> {
    const owner=this.scope(cityRead),q=activityQuery(value),start=performance.now();
    this.log('projection.started',{requestedAgentCount:q.ids?.length??q.limit,audience:cityRead?'city':'operator'});
    try {
      const result=await this.repository.page(owner,q,cityRead||q.boundOnly) as {items?:unknown;observed_at?:unknown;matched_count?:unknown};
      if(!result||!Array.isArray(result.items)||result.items.length>q.limit+1)throw new ServiceUnavailableException();
      if(q.ids&&result.matched_count!==q.ids.length)throw new NotFoundException(); // Entire requested set rejected uniformly.
      const observedAt=safeDate(result.observed_at),hasMore=result.items.length>q.limit;
      const items=result.items.slice(0,q.limit).map(row=>withExternalActivity(mapAgentActivity(row,observedAt),row,this.config.value.externalOrchestrators));
      const response:ActivityPage={schemaVersion:1,observedAt,items,nextCursor:hasMore?items.at(-1)!.agentId:null};
      if(Buffer.byteLength(JSON.stringify(response),'utf8')>65536)throw new ServiceUnavailableException();
      this.log('projection.completed',{durationMs:Math.round((performance.now()-start)*100)/100,returnedAgentCount:items.length,
        inconsistentAgentCount:items.filter(a=>a.requiresAttention).length});
      return response;
    } catch(error) {
      this.log('projection.failed',{durationMs:Math.round((performance.now()-start)*100)/100,
        errorCode:error instanceof NotFoundException?'NOT_FOUND':'PROJECTION_UNAVAILABLE'});
      if(error instanceof NotFoundException||error instanceof ServiceUnavailableException)throw error;
      throw new ServiceUnavailableException();
    }
  }
}
