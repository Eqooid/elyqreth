import { sql } from 'drizzle-orm';
import { AnyPgColumn, bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const owner = () => uuid('owner_id').notNull().references(() => owners.id, { onDelete: 'restrict', onUpdate: 'restrict' });
const object = (name: string) => jsonb(name).$type<Record<string, unknown>>().notNull().default({});
const objectCheck = (name: string, column: AnyPgColumn) => check(name,
  sql`jsonb_typeof(${column}) = 'object' AND octet_length(${column}::text) <= 65536`);
const nameCheck = (name: string, column: AnyPgColumn) => check(name,
  sql`length(btrim(${column})) BETWEEN 1 AND 160 AND ${column} = btrim(${column})`);

// Owner is a durable scope, not an authentication/user implementation. No seed rows.
export const owners = pgTable('owners', { id: id(), name: text('name').notNull(), createdAt: created() }, t => [
  nameCheck('owners_name_check', t.name),
]);

export const orchestrators = pgTable('orchestrators', {
  id: id(), ownerId: owner(), name: text('name').notNull(), type: text('type').notNull(),
  registrationStatus: text('registration_status', { enum: ['ENABLED', 'DISABLED'] }).notNull().default('DISABLED'),
  connectivityStatus: text('connectivity_status', { enum: ['UNKNOWN', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'UNAVAILABLE'] }).notNull().default('UNKNOWN'),
  capabilities: object('capabilities'), configurationReference: text('configuration_reference'),
  version: integer('version').notNull().default(1), createdAt: created(), updatedAt: updated(),
}, t => [
  unique('orchestrators_id_owner_unique').on(t.id, t.ownerId),
  unique('orchestrators_owner_name_unique').on(t.ownerId, t.name),
  nameCheck('orchestrators_name_check', t.name),
  check('orchestrators_type_check', sql`${t.type} ~ '^[a-z][a-z0-9_.-]{0,63}$'`),
  check('orchestrators_registration_check', sql`${t.registrationStatus} IN ('ENABLED','DISABLED')`),
  check('orchestrators_connectivity_check', sql`${t.connectivityStatus} IN ('UNKNOWN','CONNECTED','DEGRADED','DISCONNECTED','UNAVAILABLE')`),
  check('orchestrators_reference_check', sql`${t.configurationReference} IS NULL OR ${t.configurationReference} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'`),
  objectCheck('orchestrators_capabilities_check', t.capabilities),
  check('orchestrators_version_check', sql`${t.version} > 0`),
  check('orchestrators_timestamps_check', sql`${t.updatedAt} >= ${t.createdAt}`),
]);

export const agents = pgTable('agents', {
  id: id(), ownerId: owner(), orchestratorId: uuid('orchestrator_id').notNull(), name: text('name').notNull(),
  description: text('description'), type: text('type', { enum: ['RULE_BASED', 'LLM', 'EXTERNAL'] }).notNull(),
  lifecycleStatus: text('lifecycle_status', { enum: ['ACTIVE', 'DISABLED', 'ARCHIVED'] }).notNull().default('DISABLED'),
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]), configuration: object('configuration'),
  version: integer('version').notNull().default(1), createdAt: created(), updatedAt: updated(),
}, t => [
  unique('agents_id_owner_unique').on(t.id, t.ownerId),
  foreignKey({ name: 'agents_orchestrator_scope_fk', columns: [t.orchestratorId, t.ownerId], foreignColumns: [orchestrators.id, orchestrators.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  index('agents_owner_orchestrator_idx').on(t.ownerId, t.orchestratorId),
  index('agents_owner_lifecycle_idx').on(t.ownerId, t.lifecycleStatus),
  nameCheck('agents_name_check', t.name),
  check('agents_description_check', sql`${t.description} IS NULL OR length(${t.description}) <= 4000`),
  check('agents_type_check', sql`${t.type} IN ('RULE_BASED','LLM','EXTERNAL')`),
  check('agents_lifecycle_check', sql`${t.lifecycleStatus} IN ('ACTIVE','DISABLED','ARCHIVED')`),
  check('agents_capabilities_check', sql`jsonb_typeof(${t.capabilities}) = 'array' AND octet_length(${t.capabilities}::text) <= 16384`),
  objectCheck('agents_configuration_check', t.configuration),
  check('agents_configuration_secrets_check', sql`NOT (${t.configuration} ?| ARRAY['apiKey','api_key','password','secret','token','credentials'])`),
  check('agents_version_check', sql`${t.version} > 0`),
  check('agents_timestamps_check', sql`${t.updatedAt} >= ${t.createdAt}`),
]);

export const tasks = pgTable('tasks', {
  id: id(), ownerId: owner(), agentId: uuid('agent_id').notNull(), orchestratorId: uuid('orchestrator_id').notNull(),
  status: text('status', { enum: ['CREATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] }).notNull().default('CREATED'),
  input: jsonb('input').notNull(), statusReason: text('status_reason'),
  idempotencyKey: text('idempotency_key'), requestHash: text('request_hash'),
  retryPolicy: object('retry_policy'), deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1), createdAt: created(), updatedAt: updated(),
}, t => [
  unique('tasks_id_owner_unique').on(t.id, t.ownerId),
  unique('tasks_route_scope_unique').on(t.id, t.agentId, t.orchestratorId, t.ownerId),
  unique('tasks_owner_idempotency_unique').on(t.ownerId, t.idempotencyKey),
  foreignKey({ name: 'tasks_agent_scope_fk', columns: [t.agentId, t.ownerId], foreignColumns: [agents.id, agents.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'tasks_orchestrator_scope_fk', columns: [t.orchestratorId, t.ownerId], foreignColumns: [orchestrators.id, orchestrators.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  index('tasks_owner_status_created_idx').on(t.ownerId, t.status, t.createdAt, t.id),
  index('tasks_owner_created_idx').on(t.ownerId, t.createdAt, t.id),
  index('tasks_owner_agent_idx').on(t.ownerId, t.agentId),
  index('tasks_owner_orchestrator_idx').on(t.ownerId, t.orchestratorId),
  check('tasks_status_check', sql`${t.status} IN ('CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')`),
  check('tasks_input_check', sql`octet_length(${t.input}::text) <= 65536`),
  objectCheck('tasks_retry_policy_check', t.retryPolicy),
  check('tasks_idempotency_check', sql`(${t.idempotencyKey} IS NULL AND ${t.requestHash} IS NULL) OR (length(btrim(${t.idempotencyKey})) BETWEEN 1 AND 128 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ${t.idempotencyKey} IS NOT NULL AND ${t.requestHash} IS NOT NULL)`),
  check('tasks_terminal_timestamp_check', sql`(${t.status} IN ('COMPLETED','FAILED','CANCELLED')) = (${t.completedAt} IS NOT NULL)`),
  check('tasks_timestamps_check', sql`${t.updatedAt} >= ${t.createdAt} AND (${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.createdAt}) AND (${t.deadlineAt} IS NULL OR ${t.deadlineAt} >= ${t.createdAt}) AND (${t.cancelRequestedAt} IS NULL OR ${t.cancelRequestedAt} >= ${t.createdAt})`),
  check('tasks_version_check', sql`${t.version} > 0`),
]);

export const executions = pgTable('executions', {
  id: id(), ownerId: owner(), taskId: uuid('task_id').notNull(), agentId: uuid('agent_id').notNull(), orchestratorId: uuid('orchestrator_id').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status', { enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] }).notNull().default('PENDING'),
  authority: text('authority', { enum: ['NATIVE', 'EXTERNAL'] }).notNull().default('NATIVE'),
  submissionKey: uuid('submission_key').notNull().defaultRandom(), externalExecutionId: text('external_execution_id'),
  adapterKey: text('adapter_key'), configVersion: integer('config_version'), agentConfigSnapshot: object('agent_config_snapshot'),
  startedAt: timestamp('started_at', { withTimezone: true }), finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorCode: text('error_code'), errorMessage: text('error_message'), resultReference: text('result_reference'),
  resultAvailability: text('result_availability', { enum: ['NONE', 'PENDING', 'AVAILABLE', 'UNAVAILABLE'] }).notNull().default('NONE'),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }), nextEligibleAt: timestamp('next_eligible_at', { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text('lease_owner'), leaseToken: uuid('lease_token'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }), reconciliationState: text('reconciliation_state').notNull().default('NONE'),
  version: integer('version').notNull().default(1), createdAt: created(), updatedAt: updated(),
}, t => [
  unique('executions_id_owner_unique').on(t.id, t.ownerId),
  unique('executions_event_scope_unique').on(t.id, t.taskId, t.agentId, t.orchestratorId, t.ownerId),
  unique('executions_task_attempt_unique').on(t.taskId, t.attemptNumber),
  unique('executions_submission_unique').on(t.submissionKey),
  foreignKey({ name: 'executions_task_route_scope_fk', columns: [t.taskId, t.agentId, t.orchestratorId, t.ownerId], foreignColumns: [tasks.id, tasks.agentId, tasks.orchestratorId, tasks.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  uniqueIndex('executions_one_active_per_task_idx').on(t.taskId).where(sql`${t.status} IN ('PENDING','RUNNING')`),
  uniqueIndex('executions_one_success_per_task_idx').on(t.taskId).where(sql`${t.status} = 'SUCCEEDED'`),
  uniqueIndex('executions_one_native_running_per_agent_idx').on(t.ownerId, t.agentId).where(sql`${t.authority} = 'NATIVE' AND ${t.status} = 'RUNNING'`),
  uniqueIndex('executions_external_identity_idx').on(t.orchestratorId, t.externalExecutionId).where(sql`${t.externalExecutionId} IS NOT NULL`),
  index('executions_status_eligible_idx').on(t.status, t.nextEligibleAt),
  index('executions_lease_expiry_idx').on(t.leaseExpiresAt).where(sql`${t.status} = 'RUNNING'`),
  index('executions_owner_agent_history_idx').on(t.ownerId,t.agentId,t.createdAt.desc(),t.id.desc()),
  check('executions_attempt_check', sql`${t.attemptNumber} > 0`),
  check('executions_status_check', sql`${t.status} IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')`),
  check('executions_authority_check', sql`${t.authority} IN ('NATIVE','EXTERNAL')`),
  check('executions_result_availability_check', sql`${t.resultAvailability} IN ('NONE','PENDING','AVAILABLE','UNAVAILABLE')`),
  check('executions_terminal_timestamp_check', sql`(${t.status} IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')) = (${t.finishedAt} IS NOT NULL)`),
  check('executions_start_check', sql`(${t.status} NOT IN ('RUNNING','SUCCEEDED') OR ${t.startedAt} IS NOT NULL) AND (${t.status} <> 'PENDING' OR ${t.startedAt} IS NULL)`),
  check('executions_timestamps_check', sql`${t.updatedAt} >= ${t.createdAt} AND (${t.startedAt} IS NULL OR ${t.startedAt} >= ${t.createdAt}) AND (${t.finishedAt} IS NULL OR ${t.finishedAt} >= coalesce(${t.startedAt},${t.createdAt})) AND (${t.deadlineAt} IS NULL OR ${t.deadlineAt} >= ${t.createdAt})`),
  check('executions_lease_check', sql`(${t.leaseOwner} IS NULL AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.leaseOwner} IS NOT NULL AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`),
  check('executions_error_check', sql`(${t.errorCode} IS NULL OR length(${t.errorCode}) <= 128) AND (${t.errorMessage} IS NULL OR length(${t.errorMessage}) <= 2000) AND (${t.resultReference} IS NULL OR length(${t.resultReference}) BETWEEN 1 AND 512)`),
  objectCheck('executions_config_snapshot_check', t.agentConfigSnapshot),
  check('executions_version_check', sql`${t.version} > 0`),
]);

export const executionResults = pgTable('execution_results', {
  id: id(), ownerId: owner(), executionId: uuid('execution_id').notNull(), body: jsonb('body').notNull(), createdAt: created(),
}, t => [
  unique('execution_results_execution_unique').on(t.executionId),
  foreignKey({ name: 'execution_results_scope_fk', columns: [t.executionId, t.ownerId], foreignColumns: [executions.id, executions.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  check('execution_results_size_check', sql`octet_length(${t.body}::text) <= 65536`),
]);

export const ownerStreams = pgTable('owner_streams', {
  ownerId: owner().primaryKey(), lastPosition: bigint('last_position', { mode: 'bigint' }).notNull().default(sql`0`),
}, t => [check('owner_streams_position_check', sql`${t.lastPosition} >= 0`)]);

export const agentEvents = pgTable('agent_events', {
  id: id(), ownerId: owner(), eventType: text('event_type').notNull(), schemaVersion: integer('schema_version').notNull().default(1),
  agentId: uuid('agent_id'), taskId: uuid('task_id'), executionId: uuid('execution_id'), orchestratorId: uuid('orchestrator_id'),
  correlationId: uuid('correlation_id').notNull(), causationId: uuid('causation_id'),
  collaborationId: uuid('collaboration_id'), delegationId: uuid('delegation_id'),
  aggregateType: text('aggregate_type').notNull(), aggregateId: uuid('aggregate_id').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(), aggregateSequence: bigint('aggregate_sequence', { mode: 'bigint' }).notNull(),
  // Assigned by the owner-stream BEFORE INSERT trigger, not an unsafe serial cursor.
  streamPosition: bigint('stream_position', { mode: 'bigint' }).notNull().default(sql`0`),
  source: text('source').notNull().default('elyqreth'), sourceEventId: text('source_event_id'), payload: object('payload'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(), createdAt: created(),
}, t => [
  unique('agent_events_id_owner_unique').on(t.id, t.ownerId),
  unique('agent_events_owner_position_unique').on(t.ownerId, t.streamPosition),
  unique('agent_events_aggregate_sequence_unique').on(t.ownerId, t.aggregateType, t.aggregateId, t.aggregateSequence),
  uniqueIndex('agent_events_source_identity_idx').on(t.ownerId, t.source, t.sourceEventId).where(sql`${t.sourceEventId} IS NOT NULL`),
  uniqueIndex('agent_events_contract_version_idx').on(t.ownerId,t.aggregateType,t.aggregateId,t.aggregateVersion)
    .where(sql`${t.source} = 'elyqreth.contracts.v1'`),
  foreignKey({ name: 'agent_events_agent_scope_fk', columns: [t.agentId, t.ownerId], foreignColumns: [agents.id, agents.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'agent_events_orchestrator_scope_fk', columns: [t.orchestratorId, t.ownerId], foreignColumns: [orchestrators.id, orchestrators.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'agent_events_task_scope_fk', columns: [t.taskId, t.agentId, t.orchestratorId, t.ownerId], foreignColumns: [tasks.id, tasks.agentId, tasks.orchestratorId, tasks.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'agent_events_execution_scope_fk', columns: [t.executionId, t.taskId, t.agentId, t.orchestratorId, t.ownerId], foreignColumns: [executions.id, executions.taskId, executions.agentId, executions.orchestratorId, executions.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  foreignKey({name:'agent_events_collaboration_fk',columns:[t.collaborationId,t.ownerId],foreignColumns:[collaborationSessions.id,collaborationSessions.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  foreignKey({name:'agent_events_delegation_fk',columns:[t.delegationId,t.collaborationId,t.ownerId],foreignColumns:[collaborationDelegations.id,collaborationDelegations.sessionId,collaborationDelegations.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  index('agent_events_collaboration_history_idx').on(t.ownerId,t.collaborationId,t.createdAt,t.id),
  index('agent_events_collaboration_order_idx').on(t.ownerId,t.collaborationId,t.streamPosition),
  index('agent_events_task_order_idx').on(t.ownerId, t.taskId, t.streamPosition),
  index('agent_events_correlation_order_idx').on(t.ownerId, t.correlationId, t.streamPosition),
  index('agent_events_execution_idx').on(t.ownerId, t.executionId),
  index('agent_events_agent_order_idx').on(t.ownerId,t.agentId,t.streamPosition),
  index('agent_events_execution_order_idx').on(t.ownerId,t.executionId,t.streamPosition),
  check('agent_events_schema_check', sql`${t.schemaVersion} > 0 AND ${t.aggregateVersion} > 0 AND ${t.aggregateSequence} > 0 AND ${t.streamPosition} > 0`),
  check('agent_events_type_check', sql`${t.eventType} ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_.]*$' AND length(${t.eventType}) <= 128`),
  check('agent_events_aggregate_type_check', sql`${t.aggregateType} IN ('agent','orchestrator','task','execution','collaboration','delegation')`),
  check('agent_events_aggregate_identity_check', sql`(${t.aggregateType} = 'agent' AND ${t.aggregateId} = ${t.agentId} AND ${t.agentId} IS NOT NULL) OR (${t.aggregateType} = 'orchestrator' AND ${t.aggregateId} = ${t.orchestratorId} AND ${t.orchestratorId} IS NOT NULL) OR (${t.aggregateType} = 'task' AND ${t.aggregateId} = ${t.taskId} AND ${t.taskId} IS NOT NULL) OR (${t.aggregateType} = 'execution' AND ${t.aggregateId} = ${t.executionId} AND ${t.executionId} IS NOT NULL) OR (${t.aggregateType} = 'collaboration' AND ${t.aggregateId} = ${t.collaborationId} AND ${t.collaborationId} IS NOT NULL AND ${t.delegationId} IS NULL) OR (${t.aggregateType} = 'delegation' AND ${t.aggregateId} = ${t.delegationId} AND ${t.delegationId} IS NOT NULL AND ${t.collaborationId} IS NOT NULL)`),
  check('agent_events_reference_presence_check', sql`(${t.taskId} IS NULL OR (${t.agentId} IS NOT NULL AND ${t.orchestratorId} IS NOT NULL)) AND (${t.executionId} IS NULL OR ${t.taskId} IS NOT NULL)`),
  objectCheck('agent_events_payload_check', t.payload),
]);

export const eventOutbox = pgTable('event_outbox', {
  id: id(), ownerId: owner(), eventId: uuid('event_id').notNull(),
  attempts: integer('attempts').notNull().default(0), nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }), createdAt: created(),
}, t => [
  unique('event_outbox_event_unique').on(t.eventId),
  foreignKey({ name: 'event_outbox_event_scope_fk', columns: [t.eventId, t.ownerId], foreignColumns: [agentEvents.id, agentEvents.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  index('event_outbox_pending_idx').on(t.nextAttemptAt).where(sql`${t.publishedAt} IS NULL`),
  check('event_outbox_attempts_check', sql`${t.attempts} >= 0 AND (${t.publishedAt} IS NULL OR ${t.publishedAt} >= ${t.createdAt})`),
]);

export const commandAudit = pgTable('command_audit', {
  id: id(), ownerId: owner(), actorReference: text('actor_reference').notNull(), commandType: text('command_type').notNull(),
  resourceType: text('resource_type').notNull(), resourceId: uuid('resource_id'), correlationId: uuid('correlation_id').notNull(),
  outcome: text('outcome', { enum: ['ACCEPTED', 'REJECTED', 'FAILED'] }).notNull(), details: object('details'), createdAt: created(),
}, t => [
  index('command_audit_owner_created_idx').on(t.ownerId, t.createdAt),
  index('command_audit_resource_command_idx').on(t.ownerId, t.resourceType, t.resourceId, t.commandType),
  check('command_audit_outcome_check', sql`${t.outcome} IN ('ACCEPTED','REJECTED','FAILED')`),
  check('command_audit_names_check', sql`length(${t.actorReference}) BETWEEN 1 AND 160 AND length(${t.commandType}) BETWEEN 1 AND 128 AND length(${t.resourceType}) BETWEEN 1 AND 64`),
  objectCheck('command_audit_details_check', t.details),
]);

export const cityAgentBindings = pgTable('city_agent_bindings', {
  id: id(), ownerId: owner(), agentId: uuid('agent_id').notNull(), cityId: text('city_id').notNull().default('elyqreth'), npcId: text('npc_id').notNull(),
  visualizationMode: text('visualization_mode', { enum: ['PASSIVE', 'WORK_ACTIVITY'] }).notNull().default('PASSIVE'),
  enabled: boolean('enabled').notNull().default(true), createdAt: created(), updatedAt: updated(),
}, t => [
  foreignKey({ name: 'city_agent_bindings_agent_scope_fk', columns: [t.agentId, t.ownerId], foreignColumns: [agents.id, agents.ownerId] }).onDelete('restrict').onUpdate('restrict'),
  uniqueIndex('city_agent_bindings_agent_active_idx').on(t.ownerId, t.cityId, t.agentId).where(sql`${t.enabled}`),
  uniqueIndex('city_agent_bindings_npc_active_idx').on(t.ownerId, t.cityId, t.npcId).where(sql`${t.enabled}`),
  index('city_agent_bindings_npc_idx').on(t.ownerId, t.cityId, t.npcId),
  check('city_agent_bindings_external_ids_check', sql`length(btrim(${t.cityId})) BETWEEN 1 AND 128 AND length(btrim(${t.npcId})) BETWEEN 1 AND 255`),
  check('city_agent_bindings_mode_check', sql`${t.visualizationMode} IN ('PASSIVE','WORK_ACTIVITY')`),
  check('city_agent_bindings_timestamps_check', sql`${t.updatedAt} >= ${t.createdAt}`),
]);


// Collaboration relations only: no runtime, API or external ingestion authority.
export const collaborationSessions = pgTable('collaboration_sessions', {
  id: id(), ownerId: owner(), authority: text('authority', { enum: ['NATIVE','EXTERNAL'] }).notNull().default('NATIVE'),
  rootTaskId: uuid('root_task_id'), status: text('status', { enum: ['CREATED','ACTIVE','WAITING','COMPLETED','FAILED','CANCELLED'] }).notNull().default('CREATED'),
  actorReference: text('actor_reference').notNull(), idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
  version: integer('version').notNull().default(1), createdAt: created(), updatedAt: updated(), finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [
  unique('collaboration_sessions_scope_unique').on(t.id,t.ownerId),
  unique('collaboration_sessions_command_unique').on(t.ownerId,t.actorReference,t.idempotencyKey),
  foreignKey({name:'collaboration_sessions_root_fk',columns:[t.rootTaskId,t.ownerId],foreignColumns:[tasks.id,tasks.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  index('collaboration_sessions_owner_status_idx').on(t.ownerId,t.status,t.id),
  index('collaboration_sessions_incomplete_idx').on(t.ownerId,t.id).where(sql`${t.authority} = 'NATIVE' AND ${t.status} IN ('CREATED','ACTIVE','WAITING')`),
  index('collaboration_sessions_root_idx').on(t.ownerId,t.rootTaskId),
  check('collaboration_sessions_status_check',sql`${t.status} IN ('CREATED','ACTIVE','WAITING','COMPLETED','FAILED','CANCELLED')`),
  check('collaboration_sessions_authority_check',sql`${t.authority} IN ('NATIVE','EXTERNAL')`),
  check('collaboration_sessions_command_check',sql`${t.actorReference} ~ '^[A-Za-z0-9._:@/-]{1,160}$' AND ${t.idempotencyKey} ~ '^[A-Za-z0-9._:-]{1,128}$' AND ${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  check('collaboration_sessions_time_check',sql`${t.version} > 0 AND ${t.updatedAt} >= ${t.createdAt} AND (${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.createdAt}) AND ((${t.status} IN ('COMPLETED','FAILED','CANCELLED')) = (${t.finishedAt} IS NOT NULL))`),
]);

export const collaborationParticipants = pgTable('collaboration_participants', {
  id: id(), ownerId: owner(), sessionId: uuid('session_id').notNull(), agentId: uuid('agent_id').notNull(),
  role: text('role', {enum:['COORDINATOR','DELEGATE']}).notNull().default('DELEGATE'),
  joinedAt: timestamp('joined_at', {withTimezone:true}).notNull().defaultNow(), leftAt: timestamp('left_at', {withTimezone:true}),
}, t => [
  unique('collaboration_participants_membership_unique').on(t.sessionId,t.agentId,t.ownerId),
  foreignKey({name:'collaboration_participants_session_fk',columns:[t.sessionId,t.ownerId],foreignColumns:[collaborationSessions.id,collaborationSessions.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  foreignKey({name:'collaboration_participants_agent_fk',columns:[t.agentId,t.ownerId],foreignColumns:[agents.id,agents.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  index('collaboration_participants_agent_idx').on(t.ownerId,t.agentId,t.sessionId),
  check('collaboration_participants_role_check',sql`${t.role} IN ('COORDINATOR','DELEGATE')`),
  check('collaboration_participants_time_check',sql`${t.leftAt} IS NULL OR ${t.leftAt} >= ${t.joinedAt}`),
]);

export const collaborationDelegations = pgTable('collaboration_delegations', {
  id: id(), ownerId: owner(), sessionId: uuid('session_id').notNull(),
  sourceAgentId: uuid('source_agent_id').notNull(), targetAgentId: uuid('target_agent_id').notNull(),
  parentTaskId: uuid('parent_task_id').notNull(), childTaskId: uuid('child_task_id'), continuationTaskId: uuid('continuation_task_id'),
  sourceExecutionId: uuid('source_execution_id'), childExecutionId: uuid('child_execution_id'), continuationExecutionId: uuid('continuation_execution_id'),
  status: text('status', {enum:['REQUESTED','ACCEPTED','EXECUTING','AWAITING_RETURN','COMPLETED','FAILED','CANCELLED','REJECTED','EXPIRED']}).notNull().default('REQUESTED'),
  actorReference: text('actor_reference').notNull(), idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
  version: integer('version').notNull().default(1), createdAt: created(), updatedAt: updated(), finishedAt: timestamp('finished_at', {withTimezone:true}),
}, t => [
  unique('collaboration_delegations_scope_unique').on(t.id,t.sessionId,t.ownerId),
  unique('collaboration_delegations_command_unique').on(t.ownerId,t.actorReference,t.idempotencyKey),
  uniqueIndex('collaboration_delegations_child_unique').on(t.ownerId,t.childTaskId).where(sql`${t.childTaskId} IS NOT NULL`),
  uniqueIndex('collaboration_delegations_continuation_unique').on(t.ownerId,t.continuationTaskId).where(sql`${t.continuationTaskId} IS NOT NULL`),
  foreignKey({name:'collaboration_delegations_session_fk',columns:[t.sessionId,t.ownerId],foreignColumns:[collaborationSessions.id,collaborationSessions.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  foreignKey({name:'collaboration_delegations_source_fk',columns:[t.sessionId,t.sourceAgentId,t.ownerId],foreignColumns:[collaborationParticipants.sessionId,collaborationParticipants.agentId,collaborationParticipants.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  foreignKey({name:'collaboration_delegations_target_fk',columns:[t.sessionId,t.targetAgentId,t.ownerId],foreignColumns:[collaborationParticipants.sessionId,collaborationParticipants.agentId,collaborationParticipants.ownerId]}).onDelete('restrict').onUpdate('restrict'),
  ...(['parentTaskId','childTaskId','continuationTaskId'] as const).map(key=>foreignKey({name:`collaboration_delegations_${key}_fk`,columns:[t[key],t.ownerId],foreignColumns:[tasks.id,tasks.ownerId]}).onDelete('restrict').onUpdate('restrict')),
  ...(['sourceExecutionId','childExecutionId','continuationExecutionId'] as const).map(key=>foreignKey({name:`collaboration_delegations_${key}_fk`,columns:[t[key],t.ownerId],foreignColumns:[executions.id,executions.ownerId]}).onDelete('restrict').onUpdate('restrict')),
  index('collaboration_delegations_history_idx').on(t.ownerId,t.sessionId,t.id),
  index('collaboration_delegations_source_idx').on(t.ownerId,t.sourceAgentId,t.id),
  index('collaboration_delegations_target_idx').on(t.ownerId,t.targetAgentId,t.id),
  index('collaboration_delegations_parent_idx').on(t.ownerId,t.parentTaskId),
  index('collaboration_delegations_source_execution_idx').on(t.ownerId,t.sourceExecutionId),
  index('collaboration_delegations_child_execution_idx').on(t.ownerId,t.childExecutionId),
  index('collaboration_delegations_continuation_execution_idx').on(t.ownerId,t.continuationExecutionId),
  check('collaboration_delegations_status_check',sql`${t.status} IN ('REQUESTED','ACCEPTED','EXECUTING','AWAITING_RETURN','COMPLETED','FAILED','CANCELLED','REJECTED','EXPIRED')`),
  check('collaboration_delegations_identity_check',sql`${t.sourceAgentId} <> ${t.targetAgentId} AND (${t.childTaskId} IS NULL OR ${t.childTaskId} <> ${t.parentTaskId}) AND (${t.continuationTaskId} IS NULL OR (${t.continuationTaskId} <> ${t.parentTaskId} AND ${t.continuationTaskId} <> ${t.childTaskId}))`),
  check('collaboration_delegations_reference_check',sql`(${t.childExecutionId} IS NULL OR ${t.childTaskId} IS NOT NULL) AND (${t.continuationExecutionId} IS NULL OR ${t.continuationTaskId} IS NOT NULL) AND (${t.continuationTaskId} IS NULL OR ${t.childTaskId} IS NOT NULL) AND (${t.status} NOT IN ('ACCEPTED','EXECUTING','AWAITING_RETURN','COMPLETED') OR ${t.childTaskId} IS NOT NULL)`),
  check('collaboration_delegations_command_check',sql`${t.actorReference} ~ '^[A-Za-z0-9._:@/-]{1,160}$' AND ${t.idempotencyKey} ~ '^[A-Za-z0-9._:-]{1,128}$' AND ${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  check('collaboration_delegations_time_check',sql`${t.version} > 0 AND ${t.updatedAt} >= ${t.createdAt} AND (${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.createdAt}) AND ((${t.status} IN ('COMPLETED','FAILED','CANCELLED','REJECTED','EXPIRED')) = (${t.finishedAt} IS NOT NULL))`),
]);

// External observations are never native dispatchable Executions.
export const externalSources = pgTable('external_sources', {
 id:id(),ownerId:owner(),connectionId:uuid('connection_id').notNull(),namespace:text('namespace').notNull(),generation:integer('generation').notNull(),adapterType:text('adapter_type').notNull(),orderingDomain:text('ordering_domain'),createdAt:created(),
},t=>[
 unique('external_sources_scope_unique').on(t.id,t.ownerId),unique('external_sources_identity_unique').on(t.ownerId,t.connectionId,t.namespace,t.generation),
 foreignKey({name:'external_sources_connection_fk',columns:[t.connectionId,t.ownerId],foreignColumns:[orchestrators.id,orchestrators.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 check('external_sources_values_check',sql`${t.generation} BETWEEN 1 AND 1000000 AND ${t.namespace} ~ '^[a-z][a-z0-9_.-]{0,63}$' AND ${t.adapterType} ~ '^[a-z][a-z0-9_.-]{0,63}$' AND (${t.orderingDomain} IS NULL OR ${t.orderingDomain} ~ '^[a-z][a-z0-9_.-]{0,63}$')`),
]);
export const externalAgentMappings = pgTable('external_agent_mappings', {
 id:id(),ownerId:owner(),sourceId:uuid('source_id').notNull(),externalId:text('external_id').notNull(),internalAgentId:uuid('internal_agent_id'),status:text('status',{enum:['ACTIVE','TOMBSTONED']}).notNull().default('ACTIVE'),version:integer('version').notNull().default(1),createdAt:created(),updatedAt:updated(),
},t=>[
 unique('external_agent_mappings_scope_unique').on(t.id,t.sourceId,t.ownerId),unique('external_agent_mappings_identity_unique').on(t.ownerId,t.sourceId,t.externalId),
 uniqueIndex('external_agent_mappings_active_agent_unique').on(t.ownerId,t.internalAgentId).where(sql`${t.status} = 'ACTIVE' AND ${t.internalAgentId} IS NOT NULL`),
 foreignKey({name:'external_agent_mappings_source_fk',columns:[t.sourceId,t.ownerId],foreignColumns:[externalSources.id,externalSources.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 foreignKey({name:'external_agent_mappings_agent_fk',columns:[t.internalAgentId,t.ownerId],foreignColumns:[agents.id,agents.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 check('external_agent_mappings_values_check',sql`length(${t.externalId}) BETWEEN 1 AND 256 AND ${t.status} IN ('ACTIVE','TOMBSTONED') AND ${t.version} > 0`),
]);
export const externalInbox = pgTable('external_event_inbox', {
 id:id(),ownerId:owner(),sourceId:uuid('source_id').notNull(),eventId:text('event_id').notNull(),contentHash:text('content_hash').notNull(),event:object('event'),status:text('status',{enum:['PENDING','APPLIED','STALE','OBSERVED','DEFERRED_MAPPING','DEFERRED_ORDERING','DEFERRED_CONFLICT']}).notNull().default('PENDING'),receivedAt:created(),processedAt:timestamp('processed_at',{withTimezone:true}),correlationId:uuid('correlation_id').notNull(),
},t=>[
 unique('external_event_inbox_identity_unique').on(t.sourceId,t.eventId,t.ownerId),unique('external_event_inbox_scope_unique').on(t.id,t.sourceId,t.ownerId),
 foreignKey({name:'external_event_inbox_source_fk',columns:[t.sourceId,t.ownerId],foreignColumns:[externalSources.id,externalSources.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 index('external_event_inbox_execution_history_idx').on(t.ownerId,t.sourceId,sql`(${t.event}->>'externalExecutionId')`,t.receivedAt,t.id).where(sql`${t.event}->>'kind' = 'execution.observed'`),
 index('external_event_inbox_history_idx').on(t.ownerId,t.sourceId,t.id),index('external_event_inbox_pending_idx').on(t.ownerId,t.sourceId,t.id).where(sql`${t.status} IN ('PENDING','DEFERRED_MAPPING','DEFERRED_ORDERING','DEFERRED_CONFLICT')`),
 check('external_event_inbox_values_check',sql`length(${t.eventId}) BETWEEN 1 AND 256 AND ${t.contentHash} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${t.event}) = 'object' AND octet_length(${t.event}::text) <= 16384 AND ${t.status} IN ('PENDING','APPLIED','STALE','OBSERVED','DEFERRED_MAPPING','DEFERRED_ORDERING','DEFERRED_CONFLICT')`),
]);
export const externalExecutionMappings = pgTable('external_execution_mappings', {
 id:id(),ownerId:owner(),sourceId:uuid('source_id').notNull(),externalId:text('external_id').notNull(),agentMappingId:uuid('agent_mapping_id').notNull(),collaborationId:uuid('collaboration_id'),delegationId:uuid('delegation_id'),sourceStatus:text('source_status'),status:text('status',{enum:['UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED']}).notNull().default('UNKNOWN'),sequenceDomain:text('sequence_domain'),sequence:text('sequence'),lastEventId:text('last_event_id'),occurredAt:timestamp('occurred_at',{withTimezone:true}),observedAt:timestamp('observed_at',{withTimezone:true}),version:integer('version').notNull().default(1),createdAt:created(),updatedAt:updated(),
},t=>[
 unique('external_execution_mappings_identity_unique').on(t.ownerId,t.sourceId,t.externalId),
 foreignKey({name:'external_execution_mappings_agent_fk',columns:[t.agentMappingId,t.sourceId,t.ownerId],foreignColumns:[externalAgentMappings.id,externalAgentMappings.sourceId,externalAgentMappings.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 foreignKey({name:'external_execution_mappings_collaboration_fk',columns:[t.collaborationId,t.ownerId],foreignColumns:[collaborationSessions.id,collaborationSessions.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 foreignKey({name:'external_execution_mappings_delegation_fk',columns:[t.delegationId,t.collaborationId,t.ownerId],foreignColumns:[collaborationDelegations.id,collaborationDelegations.sessionId,collaborationDelegations.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 foreignKey({name:'external_execution_mappings_event_fk',columns:[t.sourceId,t.lastEventId,t.ownerId],foreignColumns:[externalInbox.sourceId,externalInbox.eventId,externalInbox.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 index('external_execution_mappings_agent_idx').on(t.ownerId,t.agentMappingId,t.id),index('external_execution_mappings_collaboration_idx').on(t.ownerId,t.collaborationId,t.id),
 check('external_execution_mappings_values_check',sql`length(${t.externalId}) BETWEEN 1 AND 256 AND ${t.version} > 0 AND ${t.status} IN ('UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED') AND (${t.sourceStatus} IS NULL OR length(${t.sourceStatus}) BETWEEN 1 AND 256) AND (${t.sequence} IS NULL OR ${t.sequence} ~ '^(0|[1-9][0-9]{0,39})$') AND ((${t.sequence} IS NULL) = (${t.sequenceDomain} IS NULL)) AND (${t.delegationId} IS NULL OR ${t.collaborationId} IS NOT NULL)`),
]);

// Named local operators are distinct from resource owners and external identities.
export const localAccounts = pgTable('local_accounts', {
 id:id(),ownerId:owner(),username:text('username').notNull(),passwordHash:text('password_hash').notNull(),
 role:text('role',{enum:['viewer','operator']}).notNull(),enabled:boolean('enabled').notNull().default(true),
 credentialVersion:integer('credential_version').notNull().default(1),createdAt:created(),updatedAt:updated(),
},t=>[
 unique('local_accounts_id_owner_unique').on(t.id,t.ownerId),unique('local_accounts_owner_username_unique').on(t.ownerId,t.username),
 check('local_accounts_username_check',sql`${t.username} ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'`),
 check('local_accounts_hash_check',sql`${t.passwordHash} ~ '^scrypt-v1[$][a-f0-9]{32}[$][a-f0-9]{128}$'`),
 check('local_accounts_role_check',sql`${t.role} IN ('viewer','operator')`),
 check('local_accounts_version_check',sql`${t.credentialVersion} > 0`),
]);
export const authSessions=pgTable('auth_sessions',{
 id:id(),ownerId:owner(),accountId:uuid('account_id').notNull(),tokenHash:text('token_hash').notNull(),
 credentialVersion:integer('credential_version').notNull(),createdAt:created(),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),revokedAt:timestamp('revoked_at',{withTimezone:true}),
},t=>[
 foreignKey({name:'auth_sessions_account_fk',columns:[t.accountId,t.ownerId],foreignColumns:[localAccounts.id,localAccounts.ownerId]}).onDelete('restrict').onUpdate('restrict'),
 unique('auth_sessions_token_unique').on(t.tokenHash),index('auth_sessions_owner_expiry_idx').on(t.ownerId,t.expiresAt),
 check('auth_sessions_hash_check',sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
 check('auth_sessions_lifetime_check',sql`${t.expiresAt} > ${t.createdAt} AND ${t.credentialVersion}>0`),
]);
export const authLoginLimits=pgTable('auth_login_limits',{
 ownerId:owner().primaryKey(),windowStartedAt:timestamp('window_started_at',{withTimezone:true}).notNull().defaultNow(),
 attempts:integer('attempts').notNull().default(0),
},t=>[check('auth_login_limits_attempt_check',sql`${t.attempts} BETWEEN 0 AND 20`)]);
