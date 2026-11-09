/** @import {AgentActivity, ActivityPage, ErrorCode} from './contracts' */
const messages=Object.freeze({STALE_SNAPSHOT:'Runtime reconciliation requires a consistent, current snapshot.',CONFIGURATION:'Runtime connection configuration is invalid.',AUTH_REQUIRED:'Runtime authentication is required.',
 FORBIDDEN:'Runtime access is denied.',NOT_FOUND:'Runtime scope is unavailable.',VALIDATION:'Runtime request is invalid.',
 SCHEMA:'Runtime response is unsupported or invalid.',NETWORK:'Runtime connection is unavailable.',SERVER:'Runtime service is unavailable.',
 TIMEOUT:'Runtime request timed out.',CANCELLED:'Runtime request was cancelled.',RATE_LIMITED:'Runtime request was rate limited.',LIMIT_EXCEEDED:'Runtime synchronization limit was reached.'});
export class RuntimeApiError extends Error {
 /** @param {ErrorCode} code @param {number|undefined} [retryAfterMs] */
 constructor(code,retryAfterMs){super(messages[code]);this.name='RuntimeApiError';this.code=code;this.retryAfterMs=retryAfterMs;}
 toJSON(){return Object.freeze({code:this.code,message:messages[this.code]});}
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  ['__proto__','constructor','prototype'].some(k=>Object.hasOwn(value,k)))throw new RuntimeApiError('SCHEMA');
 return /** @type {Record<string,unknown>} */(value);
}
/** @param {unknown} value */
export function identifier(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new RuntimeApiError('SCHEMA');return value.toLowerCase();}
/** @param {unknown} value */
function date(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new RuntimeApiError('SCHEMA');return value;}
/** @param {unknown} value @param {number} [min] */
function integer(value,min=0){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw new RuntimeApiError('SCHEMA');return value;}
/** @template {string} T @param {unknown} value @param {readonly T[]} choices @returns {T} */
function choice(value,choices){if(typeof value!=='string'||!choices.includes(/** @type {T} */(value)))throw new RuntimeApiError('SCHEMA');return /** @type {T} */(value);}
const taskStatuses=/** @type {const} */(['CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED']);
const executionStatuses=/** @type {const} */(['PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT']);
/** @param {unknown} value @returns {NonNullable<AgentActivity['externalObservation']>} */
function normalizeExternalObservation(value){
 const v=record(value);
 if(v.source!=='Hermes'||typeof v.connectionName!=='string'||v.connectionName.length>160||typeof v.externalAgentId!=='string'||v.externalAgentId.length>256||
  v.externalExecutionId!==null&&(typeof v.externalExecutionId!=='string'||!/^run_[a-f0-9]{32}$/.test(v.externalExecutionId))||
  v.sourceStatus!==null&&(typeof v.sourceStatus!=='string'||v.sourceStatus.length>128))throw new RuntimeApiError('SCHEMA');
 return Object.freeze({source:'Hermes',connectionId:identifier(v.connectionId),connectionName:v.connectionName,externalAgentId:v.externalAgentId,
  externalExecutionId:/** @type {string|null} */(v.externalExecutionId),mappingId:v.mappingId===null?null:identifier(v.mappingId),version:integer(v.version),
  status:choice(v.status,/** @type {const} */(['UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'])),sourceStatus:/** @type {string|null} */(v.sourceStatus),
  observedAt:v.observedAt===null?null:date(v.observedAt),lastSynchronizedAt:v.lastSynchronizedAt===null?null:date(v.lastSynchronizedAt),
  freshness:choice(v.freshness,/** @type {const} */(['UNKNOWN','RECENT_OBSERVATION','STALE','RETIRED'])),connectionHealth:choice(v.connectionHealth,/** @type {const} */(['UNKNOWN','DISABLED']))});
}
/** @param {unknown} value @returns {AgentActivity} */
export function normalizeActivity(value){
 const v=record(value);if(v.schemaVersion!==1||typeof v.name!=='string'||v.name.length>160||typeof v.requiresAttention!=='boolean')throw new RuntimeApiError('SCHEMA');
 const t=v.currentTask==null?null:record(v.currentTask),e=v.currentExecution==null?null:record(v.currentExecution);
 const outcome=v.recentOutcome==null?null:record(v.recentOutcome),last=v.lastExecution==null?null:record(v.lastExecution);
 const currentTask=t?Object.freeze({id:identifier(t.id),status:choice(t.status,taskStatuses),version:integer(t.version,1)}):null;
 const currentExecution=e?Object.freeze({id:identifier(e.id),status:choice(e.status,executionStatuses),version:integer(e.version,1),attemptNumber:integer(e.attemptNumber,1)}):null;
 const activityStatus=choice(v.activityStatus,/** @type {const} */(['IDLE','QUEUED','RUNNING','UNKNOWN']));
 const externalObservation=v.externalObservation===undefined?undefined:normalizeExternalObservation(v.externalObservation);
 if(externalObservation&&(v.agentType!=='EXTERNAL'||activityStatus!=='UNKNOWN'||currentTask||currentExecution))throw new RuntimeApiError('SCHEMA');
 const npcId=v.npcId??null,bindingId=v.bindingId==null?null:identifier(v.bindingId);
 if(npcId!==null&&(typeof npcId!=='string'||!/^resident-slot-(00[1-9]|01\d|020)$/.test(npcId))||
  (npcId===null)!==(bindingId===null)||currentExecution&&!currentTask||
  activityStatus==='QUEUED'&&!currentTask||activityStatus==='IDLE'&&v.activeExecutionCount!==0||
  activityStatus==='RUNNING'&&(currentTask?.status!=='RUNNING'||currentExecution?.status!=='RUNNING'))throw new RuntimeApiError('SCHEMA');
 return Object.freeze({schemaVersion:1,agentId:identifier(v.agentId),name:v.name,agentType:choice(v.agentType,/** @type {const} */(['RULE_BASED','LLM','EXTERNAL'])),
  ...(externalObservation?{externalObservation}:{}),
  availability:choice(v.availability,/** @type {const} */(['ACTIVE','DISABLED','ARCHIVED'])),agentVersion:integer(v.agentVersion,1),npcId:/** @type {string|null} */(npcId),bindingId,
  activityStatus,currentTask,currentExecution,activeExecutionCount:integer(v.activeExecutionCount),queuedTaskCount:integer(v.queuedTaskCount),createdTaskCount:integer(v.createdTaskCount),
  recentOutcome:outcome?Object.freeze({taskId:identifier(outcome.taskId),executionId:outcome.executionId==null?null:identifier(outcome.executionId),
   status:choice(outcome.status,/** @type {const} */(['COMPLETED','FAILED','CANCELLED','UNKNOWN'])),executionStatus:outcome.executionStatus==null?null:choice(outcome.executionStatus,executionStatuses),finishedAt:date(outcome.finishedAt)}):null,
  lastExecution:last?Object.freeze({id:identifier(last.id),taskId:identifier(last.taskId),status:choice(last.status,executionStatuses)}):null,
  lastActivityAt:date(v.lastActivityAt),observedAt:date(v.observedAt),requiresAttention:v.requiresAttention,
  statusReason:choice(v.statusReason,/** @type {const} */(['NO_ACTIVE_WORK','AWAITING_QUEUE','PERSISTED_QUEUED','CURRENT_LEASE','INCONSISTENT_STATE','DEADLINE_EXPIRED','LEASE_UNVERIFIED','EXTERNAL_LIVENESS_UNVERIFIED']))});
}
/** @param {unknown} value @param {number} [limit] @param {string} [after] @returns {ActivityPage} */
export function normalizePage(value,limit=20,after){
 const v=record(value);if(v.schemaVersion!==1||!Array.isArray(v.items)||v.items.length>limit)throw new RuntimeApiError('SCHEMA');
 const observedAt=date(v.observedAt),items=v.items.map(normalizeActivity),nextCursor=v.nextCursor===null?null:identifier(v.nextCursor);
 for(let i=0;i<items.length;i++){const a=items[i];if(!a||a.observedAt!==observedAt||(i?items[i-1].agentId>=a.agentId:after&&after>=a.agentId))throw new RuntimeApiError('SCHEMA');}
 if(nextCursor!==null&&(!items.length||nextCursor!==items.at(-1)?.agentId))throw new RuntimeApiError('SCHEMA');
 return Object.freeze({schemaVersion:1,observedAt,items:Object.freeze(items),nextCursor});
}
/** @param {readonly string[]|undefined} values @returns {readonly string[]|undefined} */
export function agentScope(values){
 if(values===undefined)return undefined;
 if(!Array.isArray(values)||values.length>20)throw new RuntimeApiError('CONFIGURATION');
 let ids;try{ids=values.map(identifier);}catch{throw new RuntimeApiError('CONFIGURATION');}
 if(new Set(ids).size!==ids.length)throw new RuntimeApiError('CONFIGURATION');return Object.freeze(ids.sort());
}
