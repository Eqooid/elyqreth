import { ExternalAgentRegistration } from './adapter.contract';
import { list, object, text, uuid, key } from './adapter.validation';
import { NPC_IDS } from '../city/binding.contract';
import { AdapterError } from './adapter.error';

export function agentRegistrations(value: unknown): readonly ExternalAgentRegistration[] {
  const seen = new Set<string>(), internal = new Set<string>(), npcs = new Set<string>(), runs = new Set<string>();
  const parsed = list(value, 20, item => {
    const row = object(item, ['externalId', 'name', 'internalAgentId', 'npcId', 'executionIds']);
    const externalId = key(row.externalId), internalAgentId = uuid(row.internalAgentId), npcId = text(row.npcId, 32);
    if (!NPC_IDS.includes(npcId) || seen.has(externalId) || internal.has(internalAgentId) || npcs.has(npcId))
      throw new AdapterError('INVALID_CONFIGURATION');
    seen.add(externalId); internal.add(internalAgentId); npcs.add(npcId);
    const executionIds = list(row.executionIds, 20, id => {
      if (typeof id !== 'string' || !/^run_[a-f0-9]{32}$/.test(id) || runs.has(id)) throw new AdapterError('INVALID_CONFIGURATION');
      runs.add(id); return id;
    });
    return Object.freeze({ externalId, name: text(row.name, 160), internalAgentId, npcId, executionIds });
  });
  if (runs.size > 20) throw new AdapterError('INVALID_CONFIGURATION');
  return parsed;
}
