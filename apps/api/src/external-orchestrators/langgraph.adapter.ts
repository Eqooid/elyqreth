import { createHash } from 'node:crypto';
import { AdapterContext,Capability,Connection,OrchestratorAdapter,PageInput,ExternalExecutionDescriptor } from './adapter.contract';
import { AdapterError } from './adapter.error';
import { text,uuid } from './adapter.validation';
export const LANGGRAPH_DOMAIN='langgraph-run-phase-v1';
export const LANGGRAPH_CAPABILITIES:readonly Capability[]=Object.freeze(['health','agents','status','result','events.poll']);
const provenance=(c:AdapterContext)=>({connectionId:c.connectionId,namespace:c.namespace,generation:c.generation});
/** Only one run's monotone lifecycle phase, NOT a fabricated provider event revision. */
export function langgraphState(raw:string):{status:ExternalExecutionDescriptor['presentationStatus'];phase:string} {
  switch(raw){case 'pending':return {status:'QUEUED',phase:'1'};case 'running':return {status:'RUNNING',phase:'2'};
    case 'success':return {status:'COMPLETED',phase:'3'};case 'error':case 'timeout':return {status:'FAILED',phase:'3'};
    default:return {status:'UNKNOWN',phase:'0'};} // interrupted is resumable, never claim CANCELLED.
}
function row(v:unknown):Record<string,unknown> {
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return v as Record<string,unknown>;
}
export function runKey(thread:string,run:string){return uuid(thread)+':'+uuid(run);}
function ids(id:string){const parts=id.split(':');if(parts.length!==2)throw new AdapterError('INVALID_INPUT');try{const thread=uuid(parts[0]),run=uuid(parts[1]);if(thread+':'+run!==id)throw Error();return {thread,run};}catch{throw new AdapterError('INVALID_INPUT');}}
function safeName(value:unknown){try{return text(value,160);}catch{throw new AdapterError('INVALID_PROVIDER_RESPONSE');}}
export class LangGraphAdapter implements OrchestratorAdapter {
  readonly type='langgraph.v1';readonly capabilities=LANGGRAPH_CAPABILITIES;
  validateConfiguration(c:Connection){if(c.adapterType!==this.type||c.mode!=='OBSERVATION_ONLY'||c.endpoint.network==='public'&&!c.credentialRef||c.capabilities.some(v=>!this.capabilities.includes(v)))throw new AdapterError('INVALID_CONFIGURATION');}
  async describe(ctx:AdapterContext){return {...provenance(ctx),capabilities:this.capabilities,revision:'langgraph-observation-v1',expiresAt:new Date(Date.now()+60000).toISOString()};}
  async health(ctx:AdapterContext){const info=row(await ctx.http.get('/info'));safeName(info.version);return {...provenance(ctx),state:'HEALTHY' as const,checkedAt:new Date().toISOString()};}
  async discoverAgents(ctx:AdapterContext,page:PageInput){
    const offset=page.cursor===undefined?0:Number(page.cursor);
    if(!Number.isSafeInteger(offset)||offset<0||offset>10000||page.cursor!==undefined&&String(offset)!==page.cursor)throw new AdapterError('INVALID_INPUT');
    if(!ctx.http.search)throw new AdapterError('UNSUPPORTED_CAPABILITY');
    const data=await ctx.http.search('/assistants/search',{limit:page.limit,offset});
    if(!Array.isArray(data)||data.length>page.limit)throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    const items=data.map(value=>{const a=row(value);const id=uuid(a.assistant_id);safeName(a.graph_id);return {...provenance(ctx),externalId:id,name:safeName(a.name),description:'LangGraph assistant (configured graph instance)'};});
    if(new Set(items.map(a=>a.externalId)).size!==items.length)throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    return {items,nextCursor:data.length===page.limit&&offset+page.limit<=10000?String(offset+page.limit):null};
  }
  private async read(ctx:AdapterContext,id:string){const key=ids(id),data=row(await ctx.http.get(`/threads/${key.thread}/runs/${key.run}`));
    if(uuid(data.thread_id)!==key.thread||uuid(data.run_id)!==key.run)throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    return {key,data,agent:uuid(data.assistant_id),raw:text(data.status,128)};
  }
  async getExecution(ctx:AdapterContext,id:string):Promise<ExternalExecutionDescriptor>{const r=await this.read(ctx,id);return {...provenance(ctx),externalId:id,externalAgentId:r.agent,sourceStatus:r.raw,presentationStatus:langgraphState(r.raw).status};}
  async getResult(ctx:AdapterContext,id:string){
    const r=await this.read(ctx,id),state=langgraphState(r.raw).status;
    if(state!=='COMPLETED')return {...provenance(ctx),executionId:id,availability:(state==='RUNNING'||state==='QUEUED'?'PENDING':'UNAVAILABLE') as 'PENDING'|'UNAVAILABLE'};
    // Agent Server may fall back to thread values after stream retention. Only read the latest run.
    const latest=async()=>{const runs=await ctx.http.get(`/threads/${r.key.thread}/runs?limit=1&offset=0`);if(!Array.isArray(runs)||runs.length!==1)return false;const v=row(runs[0]);return uuid(v.run_id)===r.key.run&&uuid(v.thread_id)===r.key.thread&&v.status==='success';};
    if(!await latest())return {...provenance(ctx),executionId:id,availability:'UNAVAILABLE' as const};
    const checkpoint=async()=>{const state=row(await ctx.http.get(`/threads/${r.key.thread}/state`)),metadata=row(state.metadata);if(metadata.run_id!==r.key.run||metadata.thread_id!==r.key.thread||metadata.source!=='loop'||!Array.isArray(state.next)||state.next.length)return null;return {id:uuid(row(state.checkpoint).checkpoint_id),hash:createHash('sha256').update(JSON.stringify(state.values)).digest('hex')};};
    const before=await checkpoint();if(!before)return {...provenance(ctx),executionId:id,availability:'UNAVAILABLE' as const};
    const output=await ctx.http.get(`/threads/${r.key.thread}/runs/${r.key.run}/join`);
    if(!await latest())return {...provenance(ctx),executionId:id,availability:'UNAVAILABLE' as const};
    const after=await checkpoint(),hash=createHash('sha256').update(JSON.stringify(output)).digest('hex');
    if(!after||after.id!==before.id||before.hash!==hash||after.hash!==hash)return {...provenance(ctx),executionId:id,availability:'UNAVAILABLE' as const};
    return {...provenance(ctx),executionId:id,availability:'AVAILABLE' as const,reference:'sha256:'+hash};
  }
  async pollEvents(ctx:AdapterContext,page:PageInput){
    if(!page.cursor)throw new AdapterError('INVALID_INPUT');
    const r=await this.getExecution(ctx,page.cursor),phase=langgraphState(r.sourceStatus);
    // Stable per-run/status identity dedupes polling and restarts. No receipt-time ordering.
    const eventId=createHash('sha256').update(JSON.stringify([r.externalId,r.externalAgentId,r.sourceStatus])).digest('hex');
    return {items:[{...provenance(ctx),eventId,kind:'execution.observed' as const,externalAgentId:r.externalAgentId,externalExecutionId:r.externalId,
      sourceStatus:r.sourceStatus,normalizedStatus:phase.status,receivedAt:new Date().toISOString(),sequence:{domain:LANGGRAPH_DOMAIN,value:phase.phase}}],nextCursor:null};
  }
}
