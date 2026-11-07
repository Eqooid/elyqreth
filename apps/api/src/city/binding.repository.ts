import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module';
import { agents, cityAgentBindings as bindings, commandAudit } from '../database/schema';
import type { PersistenceTransaction } from '../common/persistence';
import { BindingError, BindingResponse, CITY_ID, encodeRevision, NPC_MANIFEST_VERSION } from './binding.contract';

const fields={id:bindings.id,agentId:bindings.agentId,cityId:bindings.cityId,npcId:bindings.npcId,
  enabled:bindings.enabled,visualizationMode:bindings.visualizationMode,createdAt:bindings.createdAt,updatedAt:bindings.updatedAt,
  stamp:sql<string>`to_char(${bindings.updatedAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`};
type Row={id:string;agentId:string;cityId:string;npcId:string;enabled:boolean;visualizationMode:'PASSIVE'|'WORK_ACTIVITY';createdAt:Date;updatedAt:Date;stamp:string};
function response(row:Row):BindingResponse {
  return Object.freeze({id:row.id,agentId:row.agentId,cityId:row.cityId,npcId:row.npcId,enabled:row.enabled,
    visualizationMode:row.visualizationMode,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),
    revision:encodeRevision(row.stamp),manifestVersion:NPC_MANIFEST_VERSION});
}
// One existing Drizzle transaction boundary; no caller-supplied SQL or runtime dependencies.
export class BindingTransaction {
  constructor(private readonly tx:PersistenceTransaction,private readonly ownerId:string,private readonly write:boolean) {}
  async agent(agentId:string) {
    const [row]=await this.tx.select({id:agents.id,status:agents.lifecycleStatus}).from(agents)
      .where(and(eq(agents.ownerId,this.ownerId),eq(agents.id,agentId))).for('share');
    if(!row)throw new BindingError('NOT_FOUND');return row;
  }
  async find(key:'id'|'agentId'|'npcId',value:string,activeOnly=false):Promise<BindingResponse|null> {
    const query=this.tx.select(fields).from(bindings).where(and(eq(bindings.ownerId,this.ownerId),eq(bindings.cityId,CITY_ID),
      eq(bindings[key],value),...(activeOnly?[eq(bindings.enabled,true)]:[])))
      .orderBy(asc(bindings.id)).limit(1);
    const [row]=await (this.write?query.for('update'):query);
    return row?response(row):null;
  }
  async insert(agentId:string,npcId:string):Promise<BindingResponse> {
    const [row]=await this.tx.insert(bindings).values({ownerId:this.ownerId,agentId,npcId,cityId:CITY_ID,visualizationMode:'PASSIVE'}).returning(fields);
    if(!row)throw new BindingError('PERSISTENCE_UNAVAILABLE');
    await this.audit('city.binding.created',row.id);return response(row);
  }
  async disable(id:string):Promise<BindingResponse> {
    const [row]=await this.tx.update(bindings).set({enabled:false}).where(and(eq(bindings.id,id),eq(bindings.ownerId,this.ownerId),eq(bindings.cityId,CITY_ID))).returning(fields);
    if(!row)throw new BindingError('NOT_FOUND');await this.audit('city.binding.disabled',id);return response(row);
  }
  async list(limit:number,after:string|undefined,includeDisabled:boolean) {
    const rows=await this.tx.select(fields).from(bindings).where(and(eq(bindings.ownerId,this.ownerId),eq(bindings.cityId,CITY_ID),
      ...(includeDisabled?[]:[eq(bindings.enabled,true)]),...(after?[gt(bindings.id,after)]:[])))
      .orderBy(asc(bindings.id)).limit(limit+1);
    const items=rows.slice(0,limit).map(response);return {items,nextCursor:rows.length>limit?items.at(-1)!.id:null};
  }
  private async audit(commandType:string,resourceId:string) {
    await this.tx.insert(commandAudit).values({ownerId:this.ownerId,actorReference:'local-development-operator',commandType,
      resourceType:'city_binding',resourceId,correlationId:randomUUID(),outcome:'ACCEPTED',details:{manifestVersion:NPC_MANIFEST_VERSION}});
  }
}
@Injectable()
export class AgentNpcBindingRepository {
  constructor(private readonly database:DatabaseService) {}
  async run<T>(ownerId:string,write:boolean,operation:(tx:BindingTransaction)=>Promise<T>):Promise<T> {
    try {
      return await this.database.db.transaction(async tx=>{
        // PostgreSQL serializes local binding writers per owner/city, across processes.
        // The existing unique indexes also protect against writers outside this service.
        if(write)await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId+':'+CITY_ID+':bindings'},0))`);
        return operation(new BindingTransaction(tx,ownerId,write));
      });
    } catch(error) {
      if(error instanceof BindingError)throw error;
      const e=error as {code?:string;cause?:{code?:string}}|null,code=e?.cause?.code??e?.code;
      throw new BindingError(['23505','23503','40001','40P01'].includes(code??'')?'CONFLICT':'PERSISTENCE_UNAVAILABLE');
    }
  }
}
