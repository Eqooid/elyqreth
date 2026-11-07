import { isUUID } from 'class-validator';
import { createHash } from 'node:crypto';

export const sessionTransitions = {
  CREATED: ['ACTIVE', 'CANCELLED'], ACTIVE: ['WAITING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING: ['ACTIVE', 'FAILED', 'CANCELLED'], COMPLETED: [], FAILED: [], CANCELLED: [],
} as const;
export const delegationTransitions = {
  REQUESTED: ['ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'], ACCEPTED: ['EXECUTING', 'CANCELLED', 'FAILED'],
  EXECUTING: ['AWAITING_RETURN', 'FAILED', 'CANCELLED'], AWAITING_RETURN: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [], FAILED: [], CANCELLED: [], REJECTED: [], EXPIRED: [],
} as const;
export type SessionStatus = keyof typeof sessionTransitions;
export type DelegationStatus = keyof typeof delegationTransitions;
export type CollaborationErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_TRANSITION' | 'PERSISTENCE_UNAVAILABLE' | 'ACCESS_DENIED' | 'INELIGIBLE_AGENT' | 'INELIGIBLE_TASK' | 'INELIGIBLE_COLLABORATION' | 'INVALID_RELATION' | 'LIMIT_EXCEEDED';
export class CollaborationError extends Error {
  constructor(readonly code: CollaborationErrorCode) { super(code); this.name = 'CollaborationError'; }
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !isUUID(value)) throw new CollaborationError('INVALID_INPUT');
  return value.toLowerCase();
}
export function version(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2147483647) throw new CollaborationError('INVALID_INPUT');
  return value as number;
}
export function commandKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new CollaborationError('INVALID_INPUT');
  return value;
}
export function transition(kind: 'session' | 'delegation', from: string, to: string): void {
  const table: Readonly<Record<string, readonly string[]>> = kind === 'session' ? sessionTransitions : delegationTransitions;
  if (!Object.hasOwn(table, from) || !table[from]?.includes(to)) throw new CollaborationError('INVALID_TRANSITION');
}
export function commandHash(value: readonly (string | null)[]): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface CollaborationScope { readonly ownerId: string; readonly actorReference: string; readonly correlationId: string }
export function scope(value: CollaborationScope): CollaborationScope {
  if (!value || typeof value.actorReference !== 'string' || !/^[A-Za-z0-9._:@/-]{1,160}$/.test(value.actorReference)) throw new CollaborationError('INVALID_INPUT');
  return { ownerId: identifier(value.ownerId), actorReference: value.actorReference, correlationId: identifier(value.correlationId) };
}
export interface PageQuery { readonly limit?: number; readonly after?: string }
export function page(value: PageQuery = {}) {
  const limit = value.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new CollaborationError('INVALID_INPUT');
  return { limit, ...(value.after === undefined ? {} : { after: identifier(value.after) }) };
}
