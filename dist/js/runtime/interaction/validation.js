import {identifier} from '../validation.js';
import {InteractionApiError} from './errors.js';
/** @import {Agent,Task,TaskDetail,TaskRuntimeStatus,Execution,ExecutionDetail,RuntimeResult,Eligibility,SubmissionIntent,TaskInput,ValidationIssue,TaskReference,ExecutionReference} from './contracts' */
const encoder=new TextEncoder();
/** @param {unknown} value @param {readonly string[]} [keys] @param {boolean} [input] @returns {Record<string,unknown>} */
export function record(value,keys,input=false){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||keys&&!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))
  throw new InteractionApiError(input?'VALIDATION':'SCHEMA',input?{issues:[{field:'request',code:'UNSUPPORTED_FIELD'}]}:{});
 return /** @type {Record<string,unknown>} */(value);
}
/** @param {ValidationIssue['field']} field @param {ValidationIssue['code']} [code] @returns {never} */
function invalid(field,code='INVALID_VALUE'){throw new InteractionApiError('VALIDATION',{issues:[{field,code}]});}
/** @param {unknown} value @param {boolean} [input] */
export function id(value,input=false){try{return identifier(value);}catch{if(input)return invalid('agentId');throw new InteractionApiError('SCHEMA');}}
/** @param {unknown} value @param {number} [min] @param {number} [max] */
function integer(value,min=0,max=2147483647){if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new InteractionApiError('SCHEMA');return value;}
/** @param {unknown} value */
export function version(value){try{return integer(value,1);}catch{return invalid('version');}}
/** @param {unknown} value @param {boolean} [nullable] @returns {string|null} */
function timestamp(value,nullable=false){if(nullable&&value===null)return null;if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new InteractionApiError('SCHEMA');return value;}
/** @template {string} T @param {unknown} value @param {readonly T[]} values @returns {T} */
function choice(value,values){if(typeof value!=='string'||!values.includes(/** @type {T} */(value)))throw new InteractionApiError('SCHEMA');return /** @type {T} */(value);}
/** @param {unknown} value @param {number} max @returns {string} */
function text(value,max){if(typeof value!=='string'||value.length>max)throw new InteractionApiError('SCHEMA');return value;}
/** @param {unknown} value @returns {Eligibility} */
export function eligibility(value){const v=record(value);if(['canCreateTask','canRequestStart','canRequestCancel'].some(k=>typeof v[k]!=='boolean'))throw new InteractionApiError('SCHEMA');
 return Object.freeze({canCreateTask:/** @type {boolean} */(v.canCreateTask),canRequestStart:/** @type {boolean} */(v.canRequestStart),canRequestCancel:/** @type {boolean} */(v.canRequestCancel),reason:v.reason===null?null:choice(v.reason,/** @type {const} */(['INVALID_STATE','NOT_SUPPORTED','UNAVAILABLE']))});}
/** @param {unknown} value @returns {Agent} */
export function agent(value){const v=record(value);if(!Array.isArray(v.capabilities)||v.capabilities.length>32||v.capabilities.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9_.-]{0,63}$/.test(x))||new Set(v.capabilities).size!==v.capabilities.length)throw new InteractionApiError('SCHEMA');
 return Object.freeze({id:id(v.id),name:text(v.name,160),description:v.description===null?null:text(v.description,4000),type:choice(v.type,/** @type {const} */(['RULE_BASED','LLM','EXTERNAL'])),
  orchestratorId:id(v.orchestratorId),lifecycleStatus:choice(v.lifecycleStatus,/** @type {const} */(['ACTIVE','DISABLED','ARCHIVED'])),capabilities:Object.freeze([...v.capabilities]),version:integer(v.version,1),
  createdAt:/** @type {string} */(timestamp(v.createdAt)),updatedAt:/** @type {string} */(timestamp(v.updatedAt)),actionEligibility:eligibility(v.actionEligibility)});}
/** @param {unknown} value @returns {Task} */
export function task(value){const v=record(value),status=choice(v.status,/** @type {const} */(['CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED']));
 const createdAt=/** @type {string} */(timestamp(v.createdAt)),updatedAt=/** @type {string} */(timestamp(v.updatedAt)),completedAt=timestamp(v.completedAt,true);
 if(Date.parse(updatedAt)<Date.parse(createdAt)||['COMPLETED','FAILED','CANCELLED'].includes(status)!==(completedAt!==null)||completedAt&&Date.parse(completedAt)<Date.parse(createdAt))throw new InteractionApiError('SCHEMA');
 return Object.freeze({id:id(v.id),agentId:id(v.agentId),orchestratorId:id(v.orchestratorId),status,version:integer(v.version,1),createdAt,updatedAt,completedAt});}
/** @param {unknown} value @returns {TaskDetail} */
export function taskDetail(value){const v=record(value);return Object.freeze({...task(v),actionEligibility:eligibility(v.actionEligibility)});}
/** @param {unknown} value @returns {TaskRuntimeStatus} */
export function taskStatus(value){const v=record(value);return Object.freeze({...taskDetail(v),latestExecutionId:v.latestExecutionId===null?null:id(v.latestExecutionId)});}
/** @param {unknown} value @returns {Execution} */
export function execution(value){const v=record(value),status=choice(v.status,/** @type {const} */(['PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT']));
 const createdAt=/** @type {string} */(timestamp(v.createdAt)),updatedAt=/** @type {string} */(timestamp(v.updatedAt)),startedAt=timestamp(v.startedAt,true),finishedAt=timestamp(v.finishedAt,true);
 const errorCode=v.errorCode===null?null:choice(v.errorCode,/** @type {const} */(['EXECUTION_ERROR','EXECUTION_TIMED_OUT']));
 const durationMs=v.durationMs===null?null:integer(v.durationMs,0,Number.MAX_SAFE_INTEGER);
 if(['SUCCEEDED','FAILED','CANCELLED','TIMED_OUT'].includes(status)!==(finishedAt!==null)||['RUNNING','SUCCEEDED'].includes(status)&&!startedAt||status==='PENDING'&&startedAt||
  Date.parse(updatedAt)<Date.parse(createdAt)||startedAt&&Date.parse(startedAt)<Date.parse(createdAt)||finishedAt&&Date.parse(finishedAt)<Date.parse(startedAt??createdAt)||
  durationMs!==(startedAt&&finishedAt?Math.max(0,Date.parse(finishedAt)-Date.parse(startedAt)):null))throw new InteractionApiError('SCHEMA');
 return Object.freeze({id:id(v.id),taskId:id(v.taskId),agentId:id(v.agentId),orchestratorId:id(v.orchestratorId),attemptNumber:integer(v.attemptNumber,1),status,version:integer(v.version,1),createdAt,updatedAt,startedAt,finishedAt,durationMs,errorCode,
  errorMessage:errorCode===null?null:errorCode==='EXECUTION_TIMED_OUT'?'Execution timed out.':'Execution reported an error.',resultAvailability:choice(v.resultAvailability,/** @type {const} */(['NONE','PENDING','AVAILABLE','UNAVAILABLE'])),
  strategyId:v.strategyId===null?null:choice(v.strategyId,/** @type {const} */(['text.stats.v1','llm.text.v1'])),correlationId:v.correlationId===null?null:id(v.correlationId)});}
/** @param {unknown} value @returns {ExecutionDetail} */
export function executionDetail(value){const v=record(value);return Object.freeze({...execution(v),actionEligibility:eligibility(v.actionEligibility)});}
/** @param {unknown} value @param {string} executionId @returns {RuntimeResult} */
export function result(value,executionId){const v=record(value),out=record(v.output);if(v.schemaVersion!==1||id(v.executionId)!==executionId)throw new InteractionApiError('SCHEMA');
 /** @type {RuntimeResult['output']} */let output;
 if(out.type==='text.statistics.v1'){const d=record(out.data),count=integer(d.codePointCount,0,16000);output=Object.freeze({type:'text.statistics.v1',data:Object.freeze({codePointCount:count,wordCount:integer(d.wordCount,0,count),nonemptyLineCount:integer(d.nonemptyLineCount,0,count)})});}
 else if(out.type==='text'){const answer=text(out.text,65536);if(!answer.trim()||encoder.encode(answer).byteLength>65536)throw new InteractionApiError('SCHEMA');output=Object.freeze({type:'text',text:answer});}
 else throw new InteractionApiError('SCHEMA');
 /** @type {RuntimeResult['usage']} */let usage;
 if(v.usage!==undefined){const u=record(v.usage),n=/** @param {unknown} x */x=>x===null?null:integer(x,0,1000000000);
  usage=Object.freeze({inputTokens:n(u.inputTokens),outputTokens:n(u.outputTokens),totalTokens:n(u.totalTokens)});
  if(usage.inputTokens!==null&&usage.outputTokens!==null&&usage.totalTokens!==null&&usage.inputTokens+usage.outputTokens!==usage.totalTokens)throw new InteractionApiError('SCHEMA');}
 const toolSummary=v.toolSummary===undefined?undefined:Object.freeze({invocationCount:integer(record(v.toolSummary).invocationCount,0,1000000000)});
 return Object.freeze({schemaVersion:1,executionId,output,...(usage?{usage}:{}),...(toolSummary?{toolSummary}:{})});}
/** @param {unknown} value @returns {TaskInput} */
export function taskInput(value){const v=record(value,['instruction','context'],true);
 if(typeof v.instruction!=='string'||!v.instruction.trim())return invalid('input.instruction');
 if(v.instruction.length>16000)return invalid('input.instruction','TOO_LARGE');
 if(v.context!==undefined&&typeof v.context!=='string')return invalid('input.context');
 if(typeof v.context==='string'&&v.context.length>16000)return invalid('input.context','TOO_LARGE');
 const content=`${v.instruction}\n${v.context??''}`;
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)||/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\b(?:api[_ -]?key|password|access[_ -]?token|secret)\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:]+:[^\s/@]+@/i.test(content))return invalid('input.instruction');
 const input=Object.freeze({instruction:v.instruction,...(v.context===undefined?{}:{context:/** @type {string} */(v.context)})});if(encoder.encode(JSON.stringify(input)).byteLength>32768)return invalid('input.instruction','TOO_LARGE');return input;}
/** @param {unknown} value */
export function key(value){if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value))return invalid('idempotencyKey');return value;}
/** @param {unknown} value @returns {SubmissionIntent} */
export function submission(value){const v=record(value,['agentId','input','idempotencyKey'],true);return Object.freeze({agentId:id(v.agentId,true),input:taskInput(v.input),idempotencyKey:key(v.idempotencyKey)});}
/** @param {string} agentId @param {TaskInput} input @returns {SubmissionIntent} */
export function createSubmissionIntent(agentId,input){
 if(typeof globalThis.crypto?.randomUUID!=='function')throw new InteractionApiError('CONFIGURATION');
 return submission({agentId,input,idempotencyKey:'city.'+globalThis.crypto.randomUUID()});}
/** @param {unknown} value @param {boolean} [withExecution] @returns {ExecutionReference} */
export function reference(value,withExecution=false){const v=record(value,withExecution?['agentId','taskId','executionId']:['agentId','taskId'],true);
 return {agentId:id(v.agentId,true),taskId:id(v.taskId,true),executionId:withExecution?id(v.executionId,true):''};}
/** @param {Task} value @param {TaskReference} ref */
export function matchTask(value,ref){if(value.agentId!==ref.agentId||value.id!==ref.taskId)throw new InteractionApiError('SCHEMA');}
/** @param {Execution} value @param {ExecutionReference} ref */
export function matchExecution(value,ref){if(value.agentId!==ref.agentId||value.taskId!==ref.taskId||ref.executionId&&value.id!==ref.executionId)throw new InteractionApiError('SCHEMA');}
/** @param {unknown} value @param {boolean} [input] */
export function cursor(value,input=false){if(typeof value!=='string'||value.length>256||!/^v1\.[A-Za-z0-9_-]+$/.test(value)){if(input)return invalid('query');throw new InteractionApiError('SCHEMA');}return value;}
