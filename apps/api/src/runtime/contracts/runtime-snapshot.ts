import { createHash } from 'node:crypto';
import { createRuntimeDefinition, RuntimeDefinition } from './definition.contract';
import { freeze, identifier, invalid, record } from './validation';

export interface RuntimeSnapshot {
  readonly schemaVersion: 1;
  readonly definition: RuntimeDefinition;
  readonly digest: string;
  readonly correlationId: string;
}
export function definitionDigest(definition: RuntimeDefinition): string {
  return createHash('sha256').update(JSON.stringify(createRuntimeDefinition(definition))).digest('hex');
}
export function runtimeSnapshot(definition: RuntimeDefinition, correlationId: string): RuntimeSnapshot {
  const parsed = createRuntimeDefinition(definition);
  return freeze({ schemaVersion: 1, definition: parsed, digest: definitionDigest(parsed), correlationId: identifier(correlationId, 'definition') });
}
export function parseRuntimeSnapshot(value: unknown): RuntimeSnapshot {
  const r = record(value, ['schemaVersion','definition','digest','correlationId'], 'definition');
  const result = runtimeSnapshot(createRuntimeDefinition(r.definition), identifier(r.correlationId, 'definition'));
  if (r.schemaVersion !== 1 || r.digest !== result.digest) return invalid('definition');
  return result;
}
