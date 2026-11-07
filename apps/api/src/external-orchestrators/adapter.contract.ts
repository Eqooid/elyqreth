export const capabilities = ['health','agents','executions','status','result','events.poll','events.subscribe','events.webhook','dispatch','cancel','dispatch.idempotent','submission.lookup'] as const;
export type Capability = typeof capabilities[number];
export type IntegrationMode = 'OBSERVATION_ONLY' | 'CONTROLLED_DISPATCH';
export interface Connection {
  readonly id: string; readonly ownerId: string; readonly adapterType: string; readonly name: string;
  readonly namespace: string; readonly generation: number; readonly mode: IntegrationMode; readonly enabled: boolean;
  readonly endpoint: { readonly origin: string; readonly network: 'local' | 'public'; readonly allowedAddresses: readonly string[] };
  readonly credentialRef?: string; readonly capabilities: readonly Capability[];
}
export interface Provenance { readonly connectionId: string; readonly namespace: string; readonly generation: number }
export interface ExternalAgentDescriptor extends Provenance { readonly externalId: string; readonly name: string; readonly description?: string }
export interface ExternalExecutionDescriptor extends Provenance {
  readonly externalId: string; readonly externalAgentId: string; readonly sourceStatus: string;
  readonly presentationStatus: 'UNKNOWN' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly startedAt?: string; readonly finishedAt?: string; readonly resultReference?: string;
}
export interface ExternalResultDescriptor extends Provenance { readonly executionId: string; readonly availability: 'AVAILABLE' | 'PENDING' | 'UNAVAILABLE'; readonly reference?: string }
export interface ExternalEventEnvelope extends Provenance {
  readonly eventId: string; readonly kind: 'agent.observed' | 'execution.observed' | 'connection.observed';
  readonly externalAgentId?: string; readonly externalExecutionId?: string; readonly sourceStatus?: string;
  readonly normalizedStatus?: ExternalExecutionDescriptor['presentationStatus'];
  readonly occurredAt?: string; readonly receivedAt: string; readonly correlationId?: string;
  readonly sequence?: { readonly domain: string; readonly value: string }; readonly payloadReference?: string;
}
export interface ExternalPage<T> { readonly items: readonly T[]; readonly nextCursor: string | null }
export interface PageInput { readonly limit: number; readonly cursor?: string }
export interface CapabilitySnapshot extends Provenance { readonly capabilities: readonly Capability[]; readonly revision: string; readonly expiresAt: string }
export type HealthState = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DISABLED';
export interface ConnectionHealth extends Provenance { readonly state: HealthState; readonly checkedAt: string; readonly errorCode?: string }
export interface AdapterContext extends Provenance {
  readonly correlationId: string; readonly deadlineAt: string; readonly signal: AbortSignal;
  /** Read-only, exact approved origin; bearer value never appears in adapter context. */
  readonly http: { get(path: string): Promise<unknown>; search?(path: string, body: Readonly<Record<string, unknown>>): Promise<unknown> };
}
export interface DispatchInput { readonly externalAgentId: string; readonly instruction: string; readonly submissionKey: string }
/** Reviewed server code only. Optional operations are independently capability-gated. No native runtime dependency. */
export interface OrchestratorAdapter {
  readonly type: string; readonly capabilities: readonly Capability[];
  validateConfiguration(connection: Readonly<Connection>): void;
  describe(context: AdapterContext): Promise<CapabilitySnapshot>;
  health(context: AdapterContext): Promise<ConnectionHealth>;
  discoverAgents?(context: AdapterContext, page: PageInput): Promise<ExternalPage<ExternalAgentDescriptor>>;
  discoverExecutions?(context: AdapterContext, page: PageInput): Promise<ExternalPage<ExternalExecutionDescriptor>>;
  getExecution?(context: AdapterContext, id: string): Promise<ExternalExecutionDescriptor>;
  getResult?(context: AdapterContext, id: string): Promise<ExternalResultDescriptor>;
  pollEvents?(context: AdapterContext, page: PageInput): Promise<ExternalPage<ExternalEventEnvelope>>;
  // Foundation contracts only: T06 does not subscribe, receive webhooks or dispatch/cancel real work.
  subscribeEvents?(context: AdapterContext): AsyncIterable<ExternalEventEnvelope>;
  dispatch?(context: AdapterContext, input: DispatchInput): Promise<ExternalExecutionDescriptor>;
  cancel?(context: AdapterContext, id: string): Promise<ExternalExecutionDescriptor>;
  lookupSubmission?(context: AdapterContext, key: string): Promise<ExternalExecutionDescriptor | null>;
}
/** Future application services derive this from authenticated policy, never request body fields. */
export interface ExternalAccess { readonly ownerId: string; readonly correlationId: string; readonly operations: readonly Capability[] }
