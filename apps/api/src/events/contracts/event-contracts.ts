import { isISO8601, isUUID } from 'class-validator';

// Preserve the event names already emitted by T04–T06; names are not status enums.
export const eventDefinitions = {
  'agent.registered': ['agent','DISABLED'], 'agent.updated': ['agent','ANY'],
  'agent.active': ['agent','ACTIVE'], 'agent.disabled': ['agent','DISABLED'], 'agent.archived': ['agent','ARCHIVED'],
  'task.created': ['task','CREATED'], 'task.queued': ['task','QUEUED'], 'task.started': ['task','RUNNING'],
  'task.completed': ['task','COMPLETED'], 'task.failed': ['task','FAILED'], 'task.cancelled': ['task','CANCELLED'],
  'execution.created': ['execution','PENDING'], 'execution.started': ['execution','RUNNING'],
  'execution.completed': ['execution','SUCCEEDED'], 'execution.failed': ['execution','FAILED'],
  'execution.cancelled': ['execution','CANCELLED'], 'execution.timed_out': ['execution','TIMED_OUT'],
} as const;
export type EventType = keyof typeof eventDefinitions;
export const eventTypes = Object.freeze(Object.keys(eventDefinitions) as EventType[]);
type Status<T extends EventType> = typeof eventDefinitions[T][1] extends 'ANY' ? 'ACTIVE' | 'DISABLED' | 'ARCHIVED' : typeof eventDefinitions[T][1];
export type EventPayload<T extends EventType> = typeof eventDefinitions[T][0] extends 'agent' ?
  { lifecycleStatus: Status<T>; version: number } :
  { status: Status<T>; version: number } & (typeof eventDefinitions[T][0] extends 'execution' ? { attemptNumber?: number } : {});
export type EventPayloads = { [T in EventType]: EventPayload<T> };

export type EventEnvelope<T extends EventType = EventType> = T extends EventType ? {
  eventId: string; eventType: T; schemaVersion: 1; aggregateType: typeof eventDefinitions[T][0];
  aggregateId: string; aggregateVersion: number; aggregateSequence: string; streamPosition: string;
  agentId: string; taskId: string | null; executionId: string | null; orchestratorId: string;
  correlationId: string; causationId: string | null; occurredAt: string; recordedAt: string;
  payload: EventPayload<T>; contractStatus: 'VALID';
} : never;
export class EventContractError extends Error {
  constructor() { super('EVENT_CONTRACT_INVALID'); this.name = 'EventContractError'; }
}
export const knownEvent = (value: unknown): value is EventType => typeof value === 'string' && Object.hasOwn(eventDefinitions,value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value) as object | null);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
export const validPosition = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const utc = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && isISO8601(value,{strict:true,strictSeparator:true});

export function validPayload(type: EventType, payload: unknown): boolean {
  if (!object(payload)) return false;
  const [aggregate,status] = eventDefinitions[type];
  const field = aggregate === 'agent' ? 'lifecycleStatus' : 'status';
  const allowed = aggregate === 'execution' ? [field,'version','attemptNumber'] : [field,'version'];
  const valid = Object.keys(payload).every(key => allowed.includes(key)) && positive(payload.version) &&
    (status === 'ANY' ? ['ACTIVE','DISABLED','ARCHIVED'].includes(payload[field] as string) : payload[field] === status) &&
    (payload.attemptNumber === undefined || positive(payload.attemptNumber));
  return valid && Buffer.byteLength(JSON.stringify(payload),'utf8') <= 1024;
}

export function assertEnvelope(value: unknown): asserts value is EventEnvelope {
  if (!object(value) || !knownEvent(value.eventType) || value.schemaVersion !== 1 || value.contractStatus !== 'VALID') throw new EventContractError();
  const fields = ['eventId','eventType','schemaVersion','aggregateType','aggregateId','aggregateVersion','aggregateSequence',
    'streamPosition','agentId','taskId','executionId','orchestratorId','correlationId','causationId','occurredAt','recordedAt','payload','contractStatus'];
  if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value,key)) ||
    ['eventId','aggregateId','agentId','orchestratorId','correlationId'].some(key => !isUUID(value[key])) ||
    ['taskId','executionId','causationId'].some(key => value[key] !== null && !isUUID(value[key])) ||
    !positive(value.aggregateVersion) || !validPosition(value.aggregateSequence) || value.aggregateSequence === '0' ||
    !validPosition(value.streamPosition) || value.streamPosition === '0' || !utc(value.occurredAt) || !utc(value.recordedAt) ||
    !validPayload(value.eventType,value.payload) || (value.payload as Record<string,unknown>).version !== value.aggregateVersion) throw new EventContractError();
  const type = eventDefinitions[value.eventType][0];
  if (value.aggregateType !== type || value.aggregateId !== value[type === 'agent' ? 'agentId' : type === 'task' ? 'taskId' : 'executionId'] ||
    (type !== 'agent' && value.taskId === null) || (type === 'execution' && value.executionId === null) ||
    (value.executionId !== null && value.taskId === null)) throw new EventContractError();
}
