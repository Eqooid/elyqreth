import { createHash } from 'node:crypto';
import { AdapterContext, Capability, Connection, OrchestratorAdapter, PageInput } from './adapter.contract';
import { AdapterError } from './adapter.error';
import { text } from './adapter.validation';

/** Source-reviewed baseline, not a claim about all Hermes releases or installations. */
export const HERMES_VERSION = '0.21.2';
export const HERMES_CAPABILITIES: readonly Capability[] = Object.freeze(['health', 'agents', 'status', 'events.poll']);
export const HERMES_DOMAIN = 'hermes-run-phase-updated-v1';
const provenance = (ctx: AdapterContext) => ({ connectionId: ctx.connectionId, namespace: ctx.namespace, generation: ctx.generation });
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return value as Record<string, unknown>;
}
function versionedHealth(value: unknown) {
  const info = row(value);
  if (info.status !== 'ok' || info.platform !== 'hermes-agent' || info.version !== HERMES_VERSION)
    throw new AdapterError('INVALID_PROVIDER_RESPONSE');
}

/** Explicit operator registration supplies identity/association; Hermes supplies run facts.
 * No work is submitted, no stream consumed, no native runtime dependency. */
export class HermesAdapter implements OrchestratorAdapter {
  readonly type = 'hermes.v1';
  readonly capabilities = HERMES_CAPABILITIES;
  validateConfiguration(connection: Connection) {
    if (connection.adapterType !== this.type || connection.mode !== 'OBSERVATION_ONLY' || !connection.credentialRef ||
      connection.capabilities.some(value => !this.capabilities.includes(value)))
      throw new AdapterError('INVALID_CONFIGURATION');
  }
  async describe(ctx: AdapterContext) {
    versionedHealth(await ctx.http.get('/health'));
    const info = row(await ctx.http.get('/v1/capabilities')), auth = row(info.auth);
    if (info.object !== 'hermes.api_server.capabilities' || info.platform !== 'hermes-agent' ||
      auth.type !== 'bearer' || auth.required !== true)
      throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    const configured = !!ctx.registeredAgents?.length, features = row(info.features ?? {});
    const capabilities: readonly Capability[] = !configured ? ['health'] : features.run_status === true ? this.capabilities : ['health', 'agents'];
    return { ...provenance(ctx), capabilities, revision: 'hermes-0.21.2-observation-v1',
      expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
  async health(ctx: AdapterContext) {
    versionedHealth(await ctx.http.get('/health'));
    return { ...provenance(ctx), state: 'HEALTHY' as const, checkedAt: new Date().toISOString() };
  }
  async discoverAgents(ctx: AdapterContext, page: PageInput) {
    const offset = page.cursor === undefined ? 0 : Number(page.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20 || page.cursor !== undefined && String(offset) !== page.cursor)
      throw new AdapterError('INVALID_INPUT');
    const agents = ctx.registeredAgents ?? [];
    return { items: agents.slice(offset, offset + page.limit).map(agent => ({ ...provenance(ctx), externalId: agent.externalId,
      name: agent.name, description: 'Operator-registered Hermes Agent; run association is configured, not discovered' })),
      nextCursor: offset + page.limit < agents.length ? String(offset + page.limit) : null };
  }
  private async read(ctx: AdapterContext, id: string) {
    const agent = ctx.registeredAgents?.find(agent => agent.executionIds.includes(id));
    if (!agent || !/^run_[a-f0-9]{32}$/.test(id)) throw new AdapterError('INVALID_INPUT');
    const run = row(await ctx.http.get('/v1/runs/' + id));
    if (run.object !== 'hermes.run' || run.run_id !== id) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    const raw = text(run.status, 128), updated = run.updated_at;
    if (typeof updated !== 'number' || !Number.isFinite(updated) || updated < 0 || updated > 8640000000000)
      throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    const milliseconds = Math.floor(updated * 1000);
    if (!Number.isSafeInteger(milliseconds)) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
    return { agent, raw, milliseconds };
  }
  async getExecution(ctx: AdapterContext, id: string) {
    const run = await this.read(ctx, id), state = hermesState(run.raw);
    return { ...provenance(ctx), externalId: id, externalAgentId: run.agent.externalId,
      sourceStatus: run.raw, presentationStatus: state.status };
  }
  async pollEvents(ctx: AdapterContext, page: PageInput) {
    if (!page.cursor) throw new AdapterError('INVALID_INPUT');
    const run = await this.read(ctx, page.cursor), state = hermesState(run.raw);
    // A conservative snapshot partial order, not a provider event stream revision.
    // Lifecycle phase dominates source modification time; equal/conflicting or backwards
    // evidence is deferred/stale by the existing inbox. Receipt time never orders executions.
    const value = (BigInt(state.phase) * 10000000000000000n + BigInt(run.milliseconds)).toString();
    const eventId = createHash('sha256').update(JSON.stringify([page.cursor, run.agent.externalId, run.raw, value])).digest('hex');
    return { items: [{ ...provenance(ctx), eventId, kind: 'execution.observed' as const, externalAgentId: run.agent.externalId,
      externalExecutionId: page.cursor, sourceStatus: run.raw, normalizedStatus: state.status,
      occurredAt: new Date(run.milliseconds).toISOString(), receivedAt: new Date().toISOString(),
      sequence: { domain: HERMES_DOMAIN, value } }], nextCursor: null };
  }
}
export function hermesState(raw: string): { status: 'UNKNOWN' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'; phase: number } {
  switch (raw) {
    case 'queued': return { status: 'QUEUED', phase: 1 };
    case 'running': case 'waiting_for_approval': case 'stopping': return { status: 'RUNNING', phase: 2 };
    case 'completed': return { status: 'COMPLETED', phase: 3 };
    case 'failed': return { status: 'FAILED', phase: 3 };
    case 'cancelled': return { status: 'CANCELLED', phase: 3 };
    default: return { status: 'UNKNOWN', phase: 0 }; // interrupted/unknown never mean completed.
  }
}
