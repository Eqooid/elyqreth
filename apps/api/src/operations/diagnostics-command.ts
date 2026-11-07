import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { sql } from 'drizzle-orm';
import { ConfigModule } from '../config/config.module';
import { loadConfiguration } from '../config/configuration';
import { DatabaseModule,DatabaseService } from '../database/database.module';

/** Explicit host-operator command, never an HTTP route or a metric. No arbitrary SQL/owner arguments. */
export async function operationalReport(database:DatabaseService,ownerId:string){
 if(!isUUID(ownerId))throw new Error('Configured owner is required.');
 return database.db.transaction(async tx=>{
  await tx.execute(sql`set transaction isolation level repeatable read read only`);
  await tx.execute(sql`set local statement_timeout='2000ms'`);
  const tasks=await tx.execute(sql`select id,agent_id,status,version,cancel_requested_at,deadline_at,updated_at from tasks where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  const executions=await tx.execute(sql`select id,task_id,agent_id,authority,status,attempt_number,lease_expires_at,deadline_at,reconciliation_state,updated_at from executions where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  const collaborations=await tx.execute(sql`select id,authority,status,root_task_id,updated_at from collaboration_sessions where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  const delegations=await tx.execute(sql`select id,session_id,parent_task_id,source_agent_id,target_agent_id,child_task_id,child_execution_id,status,updated_at from collaboration_delegations where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  const inbox=await tx.execute(sql`select id,source_id,status,created_at as received_at,processed_at,correlation_id from external_event_inbox where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  const external=await tx.execute(sql`select id,source_id,agent_mapping_id,status,observed_at,collaboration_id,delegation_id from external_execution_mappings where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  const audit=await tx.execute(sql`select id,command_type,resource_type,resource_id,outcome,correlation_id,created_at,
   case when actor_reference ~ '^(local-user:[a-f0-9-]{36}|oidc:[a-f0-9]{64}|[a-z][a-z0-9_.-]{0,63})$' then actor_reference else '[redacted]' end as actor_reference
   from command_audit where owner_id=${ownerId} order by created_at desc,id desc limit 20`);
  return {schemaVersion:1,ownerId,scope:'latest_20_per_section_not_complete_backlog',observedAt:new Date().toISOString(),
   tasks:tasks.rows,executions:executions.rows,collaborations:collaborations.rows,delegations:delegations.rows,inbox:inbox.rows,external:external.rows,audit:audit.rows};
 });
}
async function main(){
 if(process.argv.length!==2)throw new Error();
 const config=loadConfiguration();if(!config.registry||!config.database)throw new Error();
 class Root{};Module({imports:[ConfigModule.register(config),DatabaseModule]})(Root);
 const app=await NestFactory.createApplicationContext(Root,{logger:false,abortOnError:false});
 try{process.stdout.write(JSON.stringify(await operationalReport(app.get(DatabaseService),config.registry.ownerId))+'\n');}finally{await app.close();}
}
if(require.main===module)void main().catch(()=>{process.stderr.write('Operational diagnostics failed. Check configured owner, runtime database role, schema and connectivity.\n');process.exitCode=1;});
