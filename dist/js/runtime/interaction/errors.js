import {RuntimeApiError} from '../validation.js';
/** @import {InteractionErrorCode,ErrorContext} from './contracts' */
export const BACKEND_ERROR_CODES=Object.freeze(['INVALID_INPUT','CONFIGURATION_ERROR','STRATEGY_NOT_FOUND','DEFINITION_UNAVAILABLE','ACCESS_DENIED','UNSUPPORTED_CAPABILITY','CAPACITY_EXCEEDED','RUNTIME_DRAINING',
 'PROVIDER_UNAVAILABLE','PROVIDER_AUTH_FAILED','PROVIDER_QUOTA_EXCEEDED','PROVIDER_RATE_LIMITED','MODEL_UNAVAILABLE','INVALID_PROVIDER_OUTPUT','OUTPUT_LIMIT_EXCEEDED','TOOL_DENIED','TOOL_FAILED',
 'DEADLINE_EXCEEDED','CANCELLED','LEASE_LOST','OUTCOME_UNCERTAIN','PERSISTENCE_UNAVAILABLE','INTERNAL_RUNTIME_ERROR',
 'UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','PAYLOAD_TOO_LARGE','UNSUPPORTED_MEDIA','RATE_LIMITED','UNAVAILABLE','INTERNAL_ERROR']);
/** Fixed messages only. No response/request payload, arbitrary cause or server diagnostics. */
export class InteractionApiError extends Error {
 /** @param {InteractionErrorCode} code @param {ErrorContext} [context] */
 constructor(code,context={}){
  super(code==='CONFLICT'?'Interaction conflicts with current backend state.':code==='RUNTIME_FAILURE'?'Agent execution could not complete.':new RuntimeApiError(code).message);
  this.name='InteractionApiError';this.code=code;this.operation=context.operation;this.status=context.status;
  this.backendCode=context.backendCode;this.requestId=context.requestId;this.retryAfterMs=context.retryAfterMs;
  this.outcome=context.outcome??'NOT_APPLICABLE';this.source=context.source;
  this.issues=Object.freeze((context.issues??[]).map(issue=>Object.freeze({...issue})));
 }
 toJSON(){return Object.freeze({code:this.code,message:this.message,operation:this.operation,status:this.status,backendCode:this.backendCode,
  requestId:this.requestId,retryAfterMs:this.retryAfterMs,outcome:this.outcome,source:this.source,issues:this.issues});}
}
/** @param {number} status @returns {InteractionErrorCode} */
export function httpCategory(status){return status===401?'AUTH_REQUIRED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':status===409?'CONFLICT':
 status===429?'RATE_LIMITED':status===408||status===504?'TIMEOUT':status===422?'RUNTIME_FAILURE':status>=500?'SERVER':'VALIDATION';}
/** @param {Response} response @param {unknown} body @param {number|undefined} retryAfterMs */
export function httpError(response,body,retryAfterMs){
 const v=body&&typeof body==='object'&&!Array.isArray(body)?/** @type {Record<string,unknown>} */(body):{};
 const backendCode=typeof v.code==='string'&&BACKEND_ERROR_CODES.includes(v.code)?v.code:undefined;
 const rawId=response.headers.get('x-request-id')??v.requestId;
 const requestId=typeof rawId==='string'&&/^[a-zA-Z0-9._-]{1,64}$/.test(rawId)?rawId:undefined;
 return new InteractionApiError(response.status===500&&backendCode==='INTERNAL_RUNTIME_ERROR'?'RUNTIME_FAILURE':httpCategory(response.status),
  {status:response.status,backendCode,requestId,retryAfterMs,source:'http'});
}
