import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { safePersistence } from '../common/persistence';
import { agents, cityAgentBindings as bindings, executions, tasks, orchestrators } from '../database/schema';
import { CITY_ID, NPC_IDS } from '../city/binding.contract';
import { serializeTask } from '../tasks/tasks.service';
import { serializeExecution } from '../executions/executions.service';
import { definitionDigest, parseRuntimeSnapshot } from '../runtime/contracts/runtime-snapshot';
import { AgentExecutionHistory, historyCursor, historyQuery, IntentLookup, InteractionEligibility, uuid } from './interaction.contract';
import { interactionPrincipal } from './interaction.context';

@Injectable()
export class InteractionService {
 constructor(private readonly database:DatabaseService,private readonly config:ApiConfig){}
 async agent(value:unknown) {
  const id=uuid(value),c=this.config.value;
  if(!c.registry||interactionPrincipal()&&!c.interaction?.agentIds.includes(id))throw new NotFoundException();
  if(!interactionPrincipal()){
   const [agent]=await safePersistence(()=>this.database.db.select().from(agents).where(and(eq(agents.id,id),eq(agents.ownerId,c.registry!.ownerId))).limit(1));
   if(!agent)throw new NotFoundException();return agent;
  }
  const [row]=await safePersistence(()=>this.database.db.select({agent:agents}).from(agents).innerJoin(bindings,
   and(eq(bindings.agentId,agents.id),eq(bindings.ownerId,agents.ownerId),eq(bindings.cityId,CITY_ID),eq(bindings.enabled,true),
    eq(bindings.visualizationMode,'PASSIVE'),inArray(bindings.npcId,[...NPC_IDS])))
   .where(and(eq(agents.id,id),eq(agents.ownerId,c.registry!.ownerId))).limit(1));
  if(!row)throw new NotFoundException();return row.agent;
 }
 async task(value:unknown) {
  const id=uuid(value),owner=this.config.value.registry?.ownerId;if(!owner)throw new NotFoundException();
  const [row]=await safePersistence(()=>this.database.db.select().from(tasks).where(and(eq(tasks.id,id),eq(tasks.ownerId,owner))).limit(1));
  if(!row)throw new NotFoundException();await this.agent(row.agentId);return row;
 }
 async execution(taskId:string,value:unknown) {
  const task=await this.task(taskId),id=uuid(value);
  const [row]=await safePersistence(()=>this.database.db.select().from(executions).where(and(eq(executions.id,id),eq(executions.taskId,task.id),eq(executions.ownerId,task.ownerId),eq(executions.agentId,task.agentId))).limit(1));
  if(!row)throw new NotFoundException();return row;
 }
 async eligibility(agentId:string,taskId?:string,executionId?:string):Promise<InteractionEligibility> {
  const agent=await this.agent(agentId),c=this.config.value;
  const runtime=c.runtime?.bindings.find(b=>b.agentId===agent.id&&b.orchestratorId===agent.orchestratorId),configured=!!runtime;
  const supported=['RULE_BASED','LLM'].includes(agent.type),active=agent.lifecycleStatus==='ACTIVE';
  const [route]=await safePersistence(()=>this.database.db.select({status:orchestrators.registrationStatus}).from(orchestrators)
   .where(and(eq(orchestrators.id,agent.orchestratorId),eq(orchestrators.ownerId,agent.ownerId))).limit(1));
  const enabled=route?.status==='ENABLED';
  const task=taskId?await this.task(taskId):undefined,execution=task&&executionId?await this.execution(task.id,executionId):undefined;
  let queuedReady=task?.status!=='QUEUED';
  if(task?.status==='QUEUED'&&runtime){
   const [pending]=await safePersistence(()=>this.database.db.select().from(executions).where(and(eq(executions.taskId,task.id),eq(executions.ownerId,agent.ownerId))).orderBy(desc(executions.attemptNumber)).limit(1));
   try{queuedReady=!!pending&&pending.status==='PENDING'&&pending.authority==='NATIVE'&&parseRuntimeSnapshot(pending.agentConfigSnapshot.runtime).digest===definitionDigest(runtime.definition);}catch{/* Unsupported queued attempts stay non-actionable. */}
  }
  const [blocked]=await safePersistence(()=>this.database.db.select({id:executions.id}).from(executions).where(and(eq(executions.ownerId,agent.ownerId),
   eq(executions.agentId,agent.id),eq(executions.authority,'NATIVE'),or(eq(executions.status,'RUNNING'),inArray(executions.reconciliationState,['CANCELLATION_UNCONFIRMED','NATIVE_OUTCOME_UNCERTAIN'])))).limit(1));
  let native=false;if(execution?.authority==='NATIVE')try{parseRuntimeSnapshot(execution.agentConfigSnapshot.runtime);native=true;}catch{/* No guessed capability for legacy attempts. */}
  const canCreateTask=supported&&active&&enabled;
  const canRequestStart=!!task&&['CREATED','QUEUED'].includes(task.status)&&queuedReady&&active&&enabled&&supported&&configured&&!blocked;
  const canRequestCancel=!!execution&&!!task&&configured&&native&&['PENDING','RUNNING'].includes(execution.status)&&['QUEUED','RUNNING'].includes(task.status);
  return {canCreateTask,canRequestStart,canRequestCancel,reason:!supported?'NOT_SUPPORTED':!active||!enabled||!configured||blocked?'UNAVAILABLE':
   task&&!canRequestStart&&!canRequestCancel?'INVALID_STATE':null};
 }
 async lookup(query:Record<string,unknown>):Promise<IntentLookup> {
  if(Object.keys(query).some(k=>!['agentId','idempotencyKey'].includes(k)))throw new BadRequestException();
  const agent=await this.agent(query.agentId),key=query.idempotencyKey;
  if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(key))throw new BadRequestException();
  const [task]=await safePersistence(()=>this.database.db.select().from(tasks).where(and(eq(tasks.ownerId,agent.ownerId),eq(tasks.agentId,agent.id),eq(tasks.idempotencyKey,key))).limit(1));
  return {task:task?serializeTask(task):null};
 }
 async history(agentId:string,query:Record<string,unknown>):Promise<AgentExecutionHistory> {
  const agent=await this.agent(agentId),q=historyQuery(query,agent.id),e=executions;
  const rows=await safePersistence(()=>this.database.db.select({execution:e,stamp:sql<string>`to_char(${e.createdAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`})
   .from(e).innerJoin(tasks,and(eq(tasks.id,e.taskId),eq(tasks.ownerId,e.ownerId),eq(tasks.agentId,e.agentId)))
   .where(and(eq(e.ownerId,agent.ownerId),eq(e.agentId,agent.id),...(q.boundary?[sql`(${e.createdAt},${e.id}) < (${q.boundary.stamp}::timestamptz,${q.boundary.id}::uuid)`]:[])))
   .orderBy(sql`${e.createdAt} desc nulls last`,sql`${e.id} desc nulls last`).limit(q.limit+1));
  const selected=rows.slice(0,q.limit),last=selected.at(-1);
  return {items:selected.map(row=>serializeExecution(row.execution)),pagination:{limit:q.limit,nextCursor:rows.length>q.limit&&last?historyCursor(agent.id,last.stamp,last.execution.id):null}};
 }
}
