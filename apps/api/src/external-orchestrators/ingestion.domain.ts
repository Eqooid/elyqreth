import { createHash } from 'node:crypto';
import type { ExternalEventEnvelope } from './adapter.contract';
export type ObservationStatus='UNKNOWN'|'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED';
export const terminalObservation=(status:string)=>['COMPLETED','FAILED','CANCELLED'].includes(status);
export function normalizeExternalStatus(value:string|undefined):ObservationStatus {
  return ['QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'].includes(value??'')?value as ObservationStatus:'UNKNOWN';
}
export type IngestionCode='ACCESS_DENIED'|'NOT_FOUND'|'INVALID_INPUT'|'MAPPING_CONFLICT'|'IDEMPOTENCY_CONFLICT'|'INVALID_CORRELATION'|'PERSISTENCE_UNAVAILABLE'|'CONFLICT';
export class IngestionError extends Error {constructor(readonly code:IngestionCode){super(code);this.name='IngestionError';}}
export function eventHash(event:ExternalEventEnvelope) {return createHash('sha256').update(JSON.stringify({...event,receivedAt:undefined})).digest('hex');}
export function ordering(current:{status:string;domain:string|null;sequence:string|null},event:ExternalEventEnvelope,approvedDomain:string|null):'APPLIED'|'STALE'|'DEFERRED_ORDERING'|'DEFERRED_CONFLICT' {
  if(!approvedDomain||event.sequence?.domain!==approvedDomain)return 'DEFERRED_ORDERING';
  if(current.domain&&current.domain!==approvedDomain)return 'DEFERRED_ORDERING';
  if(current.sequence!==null){const incoming=BigInt(event.sequence.value),previous=BigInt(current.sequence);if(incoming<previous)return 'STALE';if(incoming===previous)return 'DEFERRED_CONFLICT';}
  const next=event.normalizedStatus??normalizeExternalStatus(event.sourceStatus);
  if(next==='UNKNOWN'&&current.status!=='UNKNOWN')return 'DEFERRED_ORDERING';
  if(terminalObservation(current.status)&&next!==current.status)return 'DEFERRED_CONFLICT';
  if(current.status==='RUNNING'&&next==='QUEUED')return 'DEFERRED_CONFLICT';
  return 'APPLIED';
}
