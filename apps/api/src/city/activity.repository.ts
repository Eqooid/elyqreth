import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module';
import { ActivityQuery } from './activity.contract';
import { NPC_IDS } from './binding.contract';

// A single SELECT gives one PostgreSQL MVCC snapshot, including binding removal
// and paired lifecycle changes. All JSON objects below contain selected columns only.
export function activitySql(ownerId:string,q:ActivityQuery,boundOnly:boolean) {
  const ids=q.ids??[],npcList=sql.join(NPC_IDS.map(id=>sql`${id}`),sql`, `);
  return sql`
WITH authorized AS NOT MATERIALIZED (
 SELECT a.id,a.name,a.type,a.lifecycle_status,a.version,a.updated_at,
        b.id AS binding_id,b.npc_id
 FROM agents a LEFT JOIN city_agent_bindings b ON b.agent_id=a.id AND b.owner_id=a.owner_id
   AND b.city_id='elyqreth' AND b.enabled AND b.visualization_mode='PASSIVE' AND b.npc_id IN (${npcList})
 WHERE a.owner_id=${ownerId}::uuid
   AND (${ids.length===0} OR a.id IN (${ids.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `):sql`NULL::uuid`}))
   AND (${!boundOnly} OR b.id IS NOT NULL)
), page AS (
 SELECT * FROM authorized WHERE (${q.after??null}::uuid IS NULL OR id>${q.after??null}::uuid)
 ORDER BY id LIMIT ${q.limit+1}
), task_facts AS MATERIALIZED (
 SELECT t.id,t.agent_id,t.status,t.version,t.created_at,t.updated_at,t.completed_at,t.deadline_at,t.orchestrator_id
 FROM tasks t JOIN page p ON p.id=t.agent_id WHERE t.owner_id=${ownerId}::uuid
), execution_facts AS MATERIALIZED (
 SELECT e.id,e.agent_id,e.task_id,e.status,e.version,e.attempt_number,e.authority,
   e.created_at,e.updated_at,e.started_at,e.finished_at,e.deadline_at,e.lease_expires_at,e.last_heartbeat_at,e.reconciliation_state
 FROM executions e JOIN task_facts t ON t.id=e.task_id AND t.agent_id=e.agent_id AND t.orchestrator_id=e.orchestrator_id
 WHERE e.owner_id=${ownerId}::uuid
), latest_attempt AS (
 SELECT DISTINCT ON(task_id) * FROM execution_facts ORDER BY task_id,attempt_number DESC,id
), active_counts AS (
 SELECT task_id,count(*) FILTER(WHERE status IN ('PENDING','RUNNING'))::int AS active_count
 FROM execution_facts GROUP BY task_id
), work AS MATERIALIZED (
 SELECT t.id,t.agent_id,t.status,t.version,t.created_at,t.updated_at,t.completed_at,t.deadline_at,
   to_jsonb(e) AS execution,coalesce(c.active_count,0) AS active_count
 FROM task_facts t LEFT JOIN latest_attempt e ON e.task_id=t.id LEFT JOIN active_counts c ON c.task_id=t.id
), current_work AS (
 SELECT DISTINCT ON(agent_id) * FROM work WHERE status IN ('CREATED','QUEUED','RUNNING') OR active_count>0
 ORDER BY agent_id,CASE WHEN execution->>'status'='RUNNING' THEN 0 WHEN status='RUNNING' THEN 1
   WHEN execution->>'status'='PENDING' OR status='QUEUED' THEN 2 ELSE 3 END,created_at,id
), outcomes AS (
 SELECT e.agent_id,e.task_id,e.id AS execution_id,e.status,e.finished_at,t.status AS task_status
 FROM execution_facts e JOIN task_facts t ON t.id=e.task_id
 WHERE e.status IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')
 UNION ALL
 SELECT t.agent_id,t.id,NULL::uuid,t.status,t.completed_at,t.status FROM task_facts t
 WHERE t.status IN ('COMPLETED','FAILED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM execution_facts e WHERE e.task_id=t.id)
), recent AS (
 SELECT DISTINCT ON(agent_id) * FROM outcomes ORDER BY agent_id,finished_at DESC NULLS LAST,coalesce(execution_id,task_id)
), last_execution AS (
 SELECT DISTINCT ON(agent_id) * FROM execution_facts ORDER BY agent_id,created_at DESC,id
), task_stats AS (
 SELECT agent_id,count(*) FILTER(WHERE status='QUEUED')::int AS queued_count,
   count(*) FILTER(WHERE status='CREATED')::int AS created_count,max(updated_at) AS updated_at FROM task_facts GROUP BY agent_id
), execution_stats AS (
 SELECT agent_id,count(*) FILTER(WHERE status IN ('PENDING','RUNNING'))::int AS active_count,
   max(updated_at) AS updated_at FROM execution_facts GROUP BY agent_id
)
SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at,
 CASE WHEN ${ids.length>0} THEN (SELECT count(*)::int FROM authorized) ELSE 0 END AS matched_count,
 coalesce((SELECT jsonb_agg(jsonb_build_object(
   'agent',jsonb_build_object('id',p.id,'name',p.name,'type',p.type,'availability',p.lifecycle_status,'version',p.version),
   'binding',CASE WHEN p.binding_id IS NULL THEN NULL ELSE jsonb_build_object('id',p.binding_id,'npcId',p.npc_id) END,
   'current',to_jsonb(w),'outcome',to_jsonb(r),'lastExecution',to_jsonb(e),
   'activeCount',coalesce(es.active_count,0),'queuedCount',coalesce(ts.queued_count,0),'createdCount',coalesce(ts.created_count,0),
   'lastActivityAt',greatest(p.updated_at,ts.updated_at,es.updated_at)
 ) ORDER BY p.id) FROM page p LEFT JOIN current_work w ON w.agent_id=p.id LEFT JOIN recent r ON r.agent_id=p.id
 LEFT JOIN last_execution e ON e.agent_id=p.id LEFT JOIN task_stats ts ON ts.agent_id=p.id LEFT JOIN execution_stats es ON es.agent_id=p.id),'[]'::jsonb) AS items`;
}
@Injectable()
export class AgentActivityRepository {
  constructor(private readonly database:DatabaseService) {}
  async page(ownerId:string,q:ActivityQuery,boundOnly:boolean):Promise<unknown> {
    const result=await this.database.db.execute(activitySql(ownerId,q,boundOnly));return result.rows[0];
  }
}
