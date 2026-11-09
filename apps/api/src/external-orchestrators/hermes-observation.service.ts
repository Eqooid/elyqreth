import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { AgentNpcBindingService } from '../city/binding.service';
import { IngestionAuthority, SourceSession } from './ingestion-authority';
import { ExternalIngestionService } from './external-ingestion.service';
import { ExternalAdapterService } from './external-adapter.service';
import { HERMES_CAPABILITIES, HERMES_DOMAIN } from './hermes.adapter';
import { AdapterError } from './adapter.error';

@Injectable()
export class HermesObservationService {
  constructor(private readonly authority: IngestionAuthority, private readonly adapters: ExternalAdapterService,
    private readonly ingestion: ExternalIngestionService, private readonly agents: AgentsService,
    private readonly bindings: AgentNpcBindingService) {}
  private access(session: SourceSession) {
    const grant = this.authority.check(session, true);
    if (grant.connection.adapterType !== 'hermes.v1' || grant.domain !== HERMES_DOMAIN) throw new AdapterError('ACCESS_DENIED');
    return { grant, access: { ownerId: grant.connection.ownerId, correlationId: grant.correlationId, operations: HERMES_CAPABILITIES } };
  }
  async apply(operator: SourceSession) {
    const { grant, access } = this.access(operator), configured = grant.connection.registeredAgents ?? [];
    // Validate the entire plan before any writes. Registry/native ownership is never inferred from a name.
    for (const registration of configured) {
      const agent = await this.agents.get(registration.internalAgentId).catch(error => { if (error instanceof NotFoundException) return null; throw error; });
      if (agent && (agent.type !== 'EXTERNAL' || agent.orchestratorId !== grant.connection.id || agent.lifecycleStatus === 'ARCHIVED'))
        throw new AdapterError('ACCESS_DENIED');
      const byAgent = agent ? await this.bindings.byAgent(registration.internalAgentId) : null, byNpc = await this.bindings.byNpc(registration.npcId);
      if (byAgent && byAgent.npcId !== registration.npcId || byNpc && byNpc.agentId !== registration.internalAgentId)
        throw new AdapterError('INVALID_CONFIGURATION');
      for (const run of registration.executionIds) {
        await this.adapters.execution(access, grant.connection.id, run);
        this.access(operator);
      }
    }
    const result = [];
    this.access(operator);
    await this.agents.registerConfiguredHermesConnection(grant.connection.id, grant.connection.name, () => { this.access(operator); });
    for (const registration of configured) {
      this.access(operator);
      await this.agents.registerConfiguredHermes(registration.internalAgentId, registration.name, grant.connection.id, () => { this.access(operator); });
      this.access(operator);
      const mapping = await this.ingestion.mapAgent(operator, { externalId: registration.externalId, internalAgentId: registration.internalAgentId });
      for (const run of registration.executionIds)
        await this.ingestion.mapExecution(operator, { externalId: run, externalAgentId: registration.externalId });
      const binding = await this.bindings.create({ agentId: registration.internalAgentId, npcId: registration.npcId }, () => { this.access(operator); });
      result.push({ mappingId: mapping.id, agentId: registration.internalAgentId, npcId: binding.npcId });
    }
    return result;
  }
  async sync(operator: SourceSession, source: SourceSession, signal = new AbortController().signal) {
    const { grant, access } = this.access(operator), delivery = this.authority.check(source);
    if (delivery.kind !== 'ingestion' || delivery.connection.id !== grant.connection.id || delivery.connection.ownerId !== grant.connection.ownerId ||
      delivery.connection.namespace !== grant.connection.namespace || delivery.connection.generation !== grant.connection.generation || delivery.domain !== HERMES_DOMAIN)
      throw new AdapterError('ACCESS_DENIED');
    const outcomes = [];
    for (const agent of grant.connection.registeredAgents ?? []) for (const run of agent.executionIds) {
      this.access(operator); this.authority.check(source);
      const mapping = await this.ingestion.resolveExecution(operator, run);
      if (!mapping) throw new AdapterError('NOT_FOUND');
      const page = await this.adapters.events(access, grant.connection.id, { limit: 1, cursor: run }, signal);
      this.access(operator); this.authority.check(source);
      const event = page.items[0];
      if (!event || event.externalAgentId !== agent.externalId || event.externalExecutionId !== run) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
      const outcome = await this.ingestion.ingest(source, event);
      // Reconfirmation freshness is separate from execution order. An unchanged accepted snapshot
      // can be freshly observed without fabricating a newer provider status/version.
      if (outcome.receipt.status === 'APPLIED') await this.ingestion.ingest(source, { ...event, eventId: randomUUID(), kind: 'agent.observed' });
      outcomes.push({ executionId: run, status: outcome.receipt.status, duplicate: outcome.duplicate });
    }
    return outcomes;
  }
}
