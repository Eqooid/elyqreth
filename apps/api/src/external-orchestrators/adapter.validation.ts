import { capabilities, Capability, Connection, ExternalAgentDescriptor, ExternalExecutionDescriptor, ExternalEventEnvelope, ExternalResultDescriptor, CapabilitySnapshot, ConnectionHealth } from './adapter.contract';
import { AdapterError } from './adapter.error';
import { record, identifier, integer, safeText, token } from '../runtime/contracts/validation';

export function object(value: unknown, keys: readonly string[]) {
  try { return record(value, keys, 'provider'); } catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE'); }
}
export function text(value: unknown, max = 256): string {
  try { if (typeof value !== 'string' || value.length > max) throw Error(); return safeText(value, 'provider'); }
  catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE'); }
}
export function uuid(value: unknown): string { try { return identifier(value, 'provider'); } catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE'); } }
export function number(value: unknown, max: number): number { try { return integer(value, 1, max, 'provider'); } catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE'); } }
export function key(value: unknown): string { try { return token(value, 'provider'); } catch { throw new AdapterError('INVALID_PROVIDER_RESPONSE'); } }
export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return value;
}
export function list<T>(value: unknown, max: number, parse: (v: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return Object.freeze(Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) throw new AdapterError('INVALID_PROVIDER_RESPONSE'); return parse(d.value);
  }));
}
export function capabilityList(value: unknown): readonly Capability[] {
  const values = list(value, capabilities.length, v => { if (!capabilities.includes(v as Capability)) throw new AdapterError('INVALID_PROVIDER_RESPONSE'); return v as Capability; });
  if (new Set(values).size !== values.length) throw new AdapterError('INVALID_PROVIDER_RESPONSE'); return values;
}
const provenanceKeys = ['connectionId','namespace','generation'];
export function provenance(value: Record<string, unknown>, connection: Connection) {
  if (uuid(value.connectionId) !== connection.id || key(value.namespace) !== connection.namespace || number(value.generation, 1000000) !== connection.generation) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return { connectionId: connection.id, namespace: connection.namespace, generation: connection.generation };
}
export function agentDescriptor(value: unknown, c: Connection): ExternalAgentDescriptor {
  const v = object(value, [...provenanceKeys,'externalId','name','description']);
  return Object.freeze({ ...provenance(v,c), externalId: text(v.externalId), name: text(v.name,160), ...(v.description === undefined ? {} : { description: text(v.description,1024) }) });
}
export function executionDescriptor(value: unknown, c: Connection): ExternalExecutionDescriptor {
  const v = object(value, [...provenanceKeys,'externalId','externalAgentId','sourceStatus','presentationStatus','startedAt','finishedAt','resultReference']);
  if (!['UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'].includes(v.presentationStatus as string)) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  const startedAt = v.startedAt === undefined ? undefined : timestamp(v.startedAt), finishedAt = v.finishedAt === undefined ? undefined : timestamp(v.finishedAt);
  if (startedAt && finishedAt && finishedAt < startedAt) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return Object.freeze({ ...provenance(v,c), externalId:text(v.externalId), externalAgentId:text(v.externalAgentId), sourceStatus:text(v.sourceStatus,128),
    presentationStatus:v.presentationStatus as ExternalExecutionDescriptor['presentationStatus'], ...(startedAt ? {startedAt} : {}), ...(finishedAt ? {finishedAt} : {}),
    ...(v.resultReference === undefined ? {} : {resultReference:text(v.resultReference)}) });
}
export function resultDescriptor(value: unknown,c: Connection): ExternalResultDescriptor {
  const v = object(value,[...provenanceKeys,'executionId','availability','reference']);
  if (!['AVAILABLE','PENDING','UNAVAILABLE'].includes(v.availability as string) || (v.availability === 'AVAILABLE') !== (v.reference !== undefined)) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return Object.freeze({...provenance(v,c),executionId:text(v.executionId),availability:v.availability as ExternalResultDescriptor['availability'],...(v.reference === undefined ? {} : {reference:text(v.reference)})});
}
export function eventEnvelope(value: unknown,c: Connection): ExternalEventEnvelope {
  const v = object(value,[...provenanceKeys,'eventId','kind','externalAgentId','externalExecutionId','sourceStatus','normalizedStatus','occurredAt','receivedAt','correlationId','sequence','payloadReference']);
  if (!['agent.observed','execution.observed','connection.observed'].includes(v.kind as string) || v.kind === 'agent.observed' && v.externalAgentId === undefined || v.kind === 'execution.observed' && (v.externalExecutionId === undefined || v.externalAgentId === undefined)) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  if(v.normalizedStatus!==undefined&&!['UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'].includes(v.normalizedStatus as string))throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  const parsed: Record<string,string> = {};
  for (const k of ['externalAgentId','externalExecutionId','sourceStatus','payloadReference'] as const) if (v[k] !== undefined) parsed[k]=text(v[k]);
  const sequence = v.sequence === undefined ? undefined : object(v.sequence,['domain','value']);
  if (sequence && (typeof sequence.value !== 'string' || !/^(0|[1-9]\d{0,39})$/.test(sequence.value))) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return Object.freeze({...provenance(v,c),eventId:text(v.eventId),kind:v.kind as ExternalEventEnvelope['kind'],...parsed,...(v.normalizedStatus===undefined?{}:{normalizedStatus:v.normalizedStatus as ExternalExecutionDescriptor['presentationStatus']}),receivedAt:timestamp(v.receivedAt),
    ...(v.occurredAt === undefined ? {} : {occurredAt:timestamp(v.occurredAt)}),...(v.correlationId === undefined ? {} : {correlationId:uuid(v.correlationId)}),
    ...(sequence ? {sequence:Object.freeze({domain:key(sequence.domain),value:sequence.value as string})} : {})});
}
export function snapshot(value: unknown,c: Connection): CapabilitySnapshot {
  const v=object(value,[...provenanceKeys,'capabilities','revision','expiresAt']);
  const expiresAt=timestamp(v.expiresAt); if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt)>Date.now()+300000) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return Object.freeze({...provenance(v,c),capabilities:capabilityList(v.capabilities),revision:key(v.revision),expiresAt});
}
export function health(value: unknown,c: Connection): ConnectionHealth {
  const v=object(value,[...provenanceKeys,'state','checkedAt']);
  if (!['UNKNOWN','HEALTHY','DEGRADED','UNAVAILABLE'].includes(v.state as string)) throw new AdapterError('INVALID_PROVIDER_RESPONSE');
  return Object.freeze({...provenance(v,c),state:v.state as ConnectionHealth['state'],checkedAt:timestamp(v.checkedAt)});
}
