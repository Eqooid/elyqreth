import { AgentActivityProjection, ExternalActivityObservation, safeDate } from './activity.contract';
import { ExternalConfiguration } from '../external-orchestrators/external-configuration';

/** Only a current configured Hermes mapping supplies this optional presentation extension.
 * Never populates native Task/Execution references or claims connection liveness. */
export function withExternalActivity(base: AgentActivityProjection, raw: unknown, config: ExternalConfiguration | undefined): AgentActivityProjection {
  if (base.agentType !== 'EXTERNAL') return base;
  const connection = config?.connections.find(c => c.adapterType === 'hermes.v1' && c.registeredAgents?.some(a => a.internalAgentId === base.agentId));
  const registration = connection?.registeredAgents?.find(a => a.internalAgentId === base.agentId);
  if (!connection || !registration) return Object.freeze({ ...base, activityStatus: 'UNKNOWN', statusReason: 'EXTERNAL_LIVENESS_UNVERIFIED', requiresAttention: true });
  const row = raw && typeof raw === 'object' ? (raw as { external?: Record<string, unknown> }).external : undefined;
  const matches = row && row.connectionId === connection.id && row.namespace === connection.namespace && row.generation === connection.generation &&
    row.externalAgentId === registration.externalId && row.mappingStatus === 'ACTIVE' && row.registrationStatus === 'ENABLED' &&
    typeof row.externalExecutionId === 'string' && registration.executionIds.includes(row.externalExecutionId);
  const timestamp = (value: unknown) => value == null ? null : safeDate(value);
  const observedAt = matches ? timestamp(row.observedAt) : null, synchronized = matches ? timestamp(row.lastSynchronizedAt) : null;
  const current = connection.enabled && !!matches, age = synchronized ? Date.parse(base.observedAt) - Date.parse(synchronized) : Infinity;
  const statuses = ['UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'];
  const unknownHint = matches && ['RUNNING','QUEUED'].includes(String(row.status)) && typeof row.unknownSourceStatus === 'string';
  const observation: ExternalActivityObservation = {
    source: 'Hermes', connectionId: connection.id, connectionName: connection.name, externalAgentId: registration.externalId,
    externalExecutionId: matches ? String(row.externalExecutionId) : null, mappingId: matches ? String(row.mappingId) : null,
    version: matches && Number.isSafeInteger(row.version) ? Number(row.version) : 0,
    status: !unknownHint && matches && statuses.includes(String(row.status)) ? row.status as ExternalActivityObservation['status'] : 'UNKNOWN',
    sourceStatus: unknownHint ? String(row.unknownSourceStatus) : matches && typeof row.sourceStatus === 'string' ? row.sourceStatus : null, observedAt, lastSynchronizedAt: synchronized,
    freshness: !connection.enabled ? 'RETIRED' : !current || !synchronized ? 'UNKNOWN' : age < 0 || age > 30000 ? 'STALE' : 'RECENT_OBSERVATION',
    connectionHealth: connection.enabled ? 'UNKNOWN' : 'DISABLED'
  };
  return Object.freeze({ ...base, name: registration.name, activityStatus: 'UNKNOWN', statusReason: 'EXTERNAL_LIVENESS_UNVERIFIED',
    currentTask: null, currentExecution: null, recentOutcome: null, lastExecution: null, activeExecutionCount: 0,
    queuedTaskCount: 0, createdTaskCount: 0, requiresAttention: observation.freshness !== 'RECENT_OBSERVATION' || observation.status === 'FAILED',
    externalObservation: Object.freeze(observation) });
}
