import {browserClock,browserTimers,clientOrigin,validCredential,requestJson} from '../http-transport.js';
import {RuntimeApiError} from '../validation.js';
import {InteractionApiError,httpCategory,httpError} from './errors.js';
import * as v from './validation.js';
/** @import {InteractionClientOptions,RequestOptions,TaskReference,ExecutionReference,SubmissionIntent,CancellationVersions,HistoryQuery,Operation,ErrorContext,StartResponse,CancellationResponse,ResultResponse,HistoryResponse,RecoveryResponse} from './contracts' */
/** No cache, polling, UI or execution state. Only this audience's volatile credential. */
export class InteractionApiClient {
 #origin;#fetch;#timers;#clock;#timeout;#executeTimeout;#token='';#account=false;#generation=0;
 /** @type {Set<AbortController>} */#pending=new Set();
 /** @param {InteractionClientOptions} options */
 constructor(options){
  try{this.#origin=clientOrigin(options);this.#account=options.access==='account';}
  catch{throw new InteractionApiError('CONFIGURATION',{source:'configuration'});}
  if(typeof (options.fetchImpl??globalThis.fetch)!=='function')throw new InteractionApiError('CONFIGURATION',{source:'configuration'});
  this.#fetch=options.fetchImpl??globalThis.fetch.bind(globalThis);this.#timers=options.timers??browserTimers;this.#clock=options.clock??browserClock;
  this.#timeout=options.timeoutMs??5000;this.#executeTimeout=options.executeTimeoutMs??35000;
  if(!Number.isInteger(this.#timeout)||this.#timeout<100||this.#timeout>30000||!Number.isInteger(this.#executeTimeout)||this.#executeTimeout<31000||this.#executeTimeout>60000)
   throw new InteractionApiError('CONFIGURATION',{source:'configuration'});
 }
 get hasCredential(){return this.#token!=='';} // Configuration only, never an authorization claim.
 /** @param {string} token */
 authorize(token){if(!validCredential(token,this.#account))throw new InteractionApiError('CONFIGURATION',{source:'configuration'});
  this.clearCredential();this.#token=token;}
 clearCredential(){this.#token='';this.#generation++;for(const pending of this.#pending)pending.abort(new RuntimeApiError('CANCELLED'));}
 dispose(){this.clearCredential();}
 /** @param {string} agentId @param {RequestOptions} [options] */
 getAgent(agentId,options={}){return this.#run('getAgent',false,options,()=>{const id=v.id(agentId,true);return {path:`/api/v1/agents/${id}`,normalize:/** @param {unknown} data */data=>{const agent=v.agent(data);if(agent.id!==id)throw new InteractionApiError('SCHEMA');return agent;}};});}
 /** @param {SubmissionIntent} intent @param {RequestOptions} [options] */
 createTask(intent,options={}){return this.#run('createTask',true,options,()=>{const body=v.submission(intent);return {path:'/api/v1/tasks',body,statuses:[200,201],normalize:/** @param {unknown} data */data=>{const task=v.taskDetail(data);if(task.agentId!==body.agentId)throw new InteractionApiError('SCHEMA');return task;}};});}
 /** @param {TaskReference} reference @param {RequestOptions} [options] */
 getTask(reference,options={}){return this.#run('getTask',false,options,()=>{const ref=v.reference(reference);return {path:`/api/v1/tasks/${ref.taskId}`,normalize:/** @param {unknown} data */data=>{const task=v.taskDetail(data);v.matchTask(task,ref);return task;}};});}
 /** @param {TaskReference} reference @param {RequestOptions} [options] */
 getTaskStatus(reference,options={}){return this.#run('getTaskStatus',false,options,()=>{const ref=v.reference(reference);return {path:`/api/v1/tasks/${ref.taskId}/status`,normalize:/** @param {unknown} data */data=>{const task=v.taskStatus(data);v.matchTask(task,ref);return task;}};});}
 /** @param {TaskReference} reference @param {number} taskVersion @param {RequestOptions} [options] */
 executeTask(reference,taskVersion,options={}){return this.#run('executeTask',true,options,()=>{const ref=v.reference(reference),version=v.version(taskVersion);return {path:`/api/v1/tasks/${ref.taskId}/execute`,body:{},version,normalize:/** @param {unknown} data @returns {StartResponse} */data=>{
   const raw=v.record(data),task=v.task(raw.task),execution=v.execution(raw.execution);v.matchTask(task,ref);v.matchExecution(execution,ref);
   const correlationId=v.id(raw.correlationId);if(raw.kind!=='finished'||task.status!=='COMPLETED'||execution.status!=='SUCCEEDED'||task.orchestratorId!==execution.orchestratorId||execution.correlationId!==correlationId)throw new InteractionApiError('SCHEMA');
   const restricted=raw.displayReason==='DISCLOSURE_RESTRICTED';if(raw.displayReason!==undefined&&!restricted||restricted&&raw.result!==null||raw.result===null&&!restricted)throw new InteractionApiError('SCHEMA');
   return Object.freeze({kind:'finished',task,execution,correlationId,result:raw.result===null?null:v.result(raw.result,execution.id),...(restricted?{displayReason:/** @type {const} */('DISCLOSURE_RESTRICTED')}:{})});
  }};});}
 /** @param {ExecutionReference} reference @param {RequestOptions} [options] */
 getExecution(reference,options={}){return this.#run('getExecution',false,options,()=>{const ref=v.reference(reference,true);return {path:this.#executionPath(ref),normalize:/** @param {unknown} data */data=>{const execution=v.executionDetail(data);v.matchExecution(execution,ref);return execution;}};});}
 /** @param {ExecutionReference} reference @param {CancellationVersions} versions @param {RequestOptions} [options] */
 cancelExecution(reference,versions,options={}){return this.#run('cancelExecution',true,options,()=>{const ref=v.reference(reference,true),input=v.record(versions,['taskVersion','executionVersion'],true);
  const taskVersion=v.version(input.taskVersion),version=v.version(input.executionVersion);return {path:this.#executionPath(ref)+'/cancel',body:{taskVersion},version,normalize:/** @param {unknown} data @returns {CancellationResponse} */data=>{
   const raw=v.record(data),task=v.task(raw.task),execution=raw.execution===null?null:v.execution(raw.execution);v.matchTask(task,ref);if(execution){v.matchExecution(execution,ref);if(task.orchestratorId!==execution.orchestratorId)throw new InteractionApiError('SCHEMA');}
   return Object.freeze({task,execution});
  }};});}
 /** @param {ExecutionReference} reference @param {RequestOptions} [options] */
 getResult(reference,options={}){return this.#run('getResult',false,options,()=>{const ref=v.reference(reference,true);return {path:this.#executionPath(ref)+'/result',normalize:/** @param {unknown} data @returns {ResultResponse} */data=>{
   const raw=v.record(data),execution=v.execution(raw.execution);v.matchExecution(execution,ref);const available=raw.availability;
   if(!['PENDING','AVAILABLE','UNAVAILABLE'].includes(/** @type {string} */(available)))throw new InteractionApiError('SCHEMA');
   const restricted=raw.displayReason==='DISCLOSURE_RESTRICTED';if(raw.displayReason!==undefined&&!restricted||restricted&&(available!=='UNAVAILABLE'||raw.result!==null)||
    available==='PENDING'&&!['PENDING','RUNNING'].includes(execution.status)||available==='AVAILABLE'&&(execution.status!=='SUCCEEDED'||raw.result===null)||available!=='AVAILABLE'&&raw.result!==null)throw new InteractionApiError('SCHEMA');
   return Object.freeze({execution,availability:/** @type {ResultResponse['availability']} */(available),result:raw.result===null?null:v.result(raw.result,execution.id),...(restricted?{displayReason:/** @type {const} */('DISCLOSURE_RESTRICTED')}:{})});
  }};});}
 /** @param {string} agentId @param {HistoryQuery} [query] @param {RequestOptions} [options] */
 listAgentExecutions(agentId,query={},options={}){return this.#run('listAgentExecutions',false,options,()=>{const id=v.id(agentId,true),q=v.record(query,['limit','before'],true),limit=q.limit??10;
  if(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>20)throw new InteractionApiError('VALIDATION',{issues:[{field:'query',code:'INVALID_VALUE'}]});
  const before=q.before===undefined?undefined:v.cursor(q.before,true),params=new URLSearchParams({limit:String(limit)});if(before)params.set('before',before);
  return {path:`/api/v1/agents/${id}/executions?${params}`,normalize:/** @param {unknown} data @returns {HistoryResponse} */data=>{
   const raw=v.record(data),page=v.record(raw.pagination);if(!Array.isArray(raw.items)||raw.items.length>limit||page.limit!==limit)throw new InteractionApiError('SCHEMA');
   const items=raw.items.map(v.execution),nextCursor=page.nextCursor===null?null:v.cursor(page.nextCursor);
   if(new Set(items.map(e=>e.id)).size!==items.length||items.some((e,i)=>e.agentId!==id||i>0&&Date.parse(items[i-1].createdAt)<Date.parse(e.createdAt))||nextCursor&&(!items.length||nextCursor===before))throw new InteractionApiError('SCHEMA');
   // Wire dates lose PostgreSQL microseconds. Never sort/reject tied millisecond rows by UUID.
   return Object.freeze({items:Object.freeze(items),pagination:Object.freeze({limit,nextCursor})});
  }};});}
 /** @param {string} agentId @param {string} idempotencyKey @param {RequestOptions} [options] */
 findTaskByIntent(agentId,idempotencyKey,options={}){return this.#run('findTaskByIntent',false,options,()=>{const id=v.id(agentId,true),key=v.key(idempotencyKey),query=new URLSearchParams({agentId:id,idempotencyKey:key});return {path:'/api/v1/tasks/lookup?'+query,normalize:/** @param {unknown} data @returns {RecoveryResponse} */data=>{
   const raw=v.record(data),task=raw.task===null?null:v.task(raw.task);if(task&&task.agentId!==id)throw new InteractionApiError('SCHEMA');return Object.freeze({task});
  }};});}
 /** @param {ExecutionReference} ref */
 #executionPath(ref){return `/api/v1/tasks/${ref.taskId}/executions/${ref.executionId}`;}
 /** @template T @param {Operation} operation @param {boolean} mutation @param {RequestOptions} options
  * @param {()=>{path:string,body?:unknown,version?:number,statuses?:number[],normalize:(data:unknown)=>T}} prepare @returns {Promise<T>} */
 async #run(operation,mutation,options,prepare){
  const controller=new AbortController(),generation=this.#generation;let dispatched=false,credential='';
  /** @type {()=>void} */let removeCaller=()=>{};
  /** @type {number|undefined} */let observedStatus;
  try{
   const o=v.record(options,['signal','requestId'],true);
   if(o.requestId!==undefined&&(typeof o.requestId!=='string'||!/^[a-zA-Z0-9._-]{1,64}$/.test(o.requestId)))throw new InteractionApiError('VALIDATION',{issues:[{field:'options',code:'INVALID_VALUE'}]});
   if(o.signal!==undefined&&(!o.signal||typeof /** @type {AbortSignal} */(o.signal).aborted!=='boolean'||typeof /** @type {AbortSignal} */(o.signal).addEventListener!=='function'||typeof /** @type {AbortSignal} */(o.signal).removeEventListener!=='function'))throw new InteractionApiError('VALIDATION');
   const signal=options.signal,abort=()=>controller.abort(new RuntimeApiError('CANCELLED'));
   if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});removeCaller=()=>signal?.removeEventListener('abort',abort);
   const request=prepare();if(!this.#token)throw new RuntimeApiError('AUTH_REQUIRED');
   credential=this.#token;
   if(options.requestId?.includes(credential))throw new InteractionApiError('VALIDATION',{issues:[{field:'options',code:'INVALID_VALUE'}]});
   this.#pending.add(controller);
   const data=await requestJson(this.#origin+request.path,{fetchImpl:this.#fetch,timers:this.#timers,clock:this.#clock,signal:controller.signal,
    timeoutMs:operation==='executeTask'?this.#executeTimeout:this.#timeout,method:mutation?'POST':'GET',maxBytes:131072,statuses:request.statuses,
    headers:{Authorization:`Bearer ${credential}`,Accept:'application/json',...(mutation?{'Content-Type':'application/json'}:{}),...(request.version?{'If-Match':`"${request.version}"`}:{}),...(options.requestId?{'X-Request-Id':options.requestId}:{})},
    ...(mutation?{body:JSON.stringify(request.body)}:{}),onDispatch:()=>{dispatched=true;},
    // 403 can be TOOL_DENIED/ACCESS_DENIED for one operation, not global expiry.
    // Do not abort an unrelated synchronous execution merely for that denial.
    onStatus:status=>{observedStatus=status;if(status===401){this.#token='';this.#generation++;for(const pending of this.#pending)if(pending!==controller)pending.abort(new RuntimeApiError('AUTH_REQUIRED'));}},httpError});
   if(controller.signal.aborted)throw controller.signal.reason;if(generation!==this.#generation)throw new RuntimeApiError('CANCELLED');return request.normalize(data);
  }catch(error){
   if(controller.signal.aborted){const reason=controller.signal.reason;
    const code=reason instanceof RuntimeApiError?reason.code:'CANCELLED';
    throw new InteractionApiError(code,{operation,source:code==='AUTH_REQUIRED'?'authentication':'abort',outcome:mutation?dispatched?'UNKNOWN':'NOT_SENT':'NOT_APPLICABLE'});
   }
   const failure=error instanceof InteractionApiError?error:error instanceof RuntimeApiError?new InteractionApiError(error.code,{retryAfterMs:error.retryAfterMs}):new InteractionApiError('SCHEMA');
   const status=failure.status??(observedStatus&&observedStatus>=400?observedStatus:undefined);
   const code=status===401||status===403?httpCategory(status):failure.code;
   const source=status?'http':failure.source??(code==='TIMEOUT'?'timeout':code==='CANCELLED'?'abort':code==='NETWORK'?'network':code==='AUTH_REQUIRED'?'authentication':code==='VALIDATION'?'validation':'schema');
   const requestId=credential&&failure.requestId?.includes(credential)?undefined:failure.requestId;
   throw new InteractionApiError(code,{operation,status,backendCode:failure.backendCode,requestId,retryAfterMs:failure.retryAfterMs,issues:failure.issues,source,
    outcome:mutation?dispatched?'UNKNOWN':'NOT_SENT':'NOT_APPLICABLE'});
  }finally{removeCaller();this.#pending.delete(controller);}
 }
}
