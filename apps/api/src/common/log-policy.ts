import { isUUID } from 'class-validator';

/** Closed event vocabulary keeps telemetry dimensions bounded; payloads are never recursively serialized. */
export const logEvents=Object.freeze([
 'api_started','api_draining','startup_failed','request_failed','http_request','database_connection_lost','readiness.changed',
 'shutdown_failed','shutdown_deadline_exceeded','telemetry.rejected',
 'projection.started','projection.completed','projection.failed','collaboration.authorized','collaboration.denied','collaboration.failed',
 'collaboration.projection','collaboration.projection.failed','interaction.authorized','interaction.denied',
 'external.operation','external.ingestion','external.ingestion.authorization_denied',
 'runtime.diagnostic','runtime.budget','runtime.started','runtime.completed','runtime.failed','runtime.failure','runtime.cancelled','runtime.timeout',
 'runtime.conflict','runtime.requested','runtime.cancellation.requested','runtime.cancellation.recorded',
 'runtime.drain.started','runtime.drain.completed','runtime.drain.deadline','runtime.stopping','runtime.stopped',
 'provider.started','provider.completed','provider.transport.completed','provider.failed','tool.started','tool.completed','tool.failed',
] as const);
const ids=['requestId','correlationId','ownerId','taskId','executionId','agentId','orchestratorId','connectionId'];
const tokens=['method','operation','audience','outcome','code','errorCode','providerId','toolId','adapterType','mode','state','dependency'];
const numbers=['durationMs','serverDurationMs','statusCode','responseBytes','requestedAgentCount','returnedAgentCount','inconsistentAgentCount',
 'activeExecutions','pendingQueueOperations','remainingDrainMs','toolInvocationCount','providerRequestCount'];
const booleans=['admitting','drainTimedOut'];
const allowed=[...ids,...tokens,...numbers,...booleans,'route','drainStartedAt','message'];
function startupMessage(value:string){const prefix='Invalid API configuration: ';
 if(value.startsWith(prefix))return value.slice(prefix.length).split(/[, /]+/).every(field=>/^[A-Z][A-Z0-9_]*$/.test(field)||['budgets','.env'].includes(field));
 return /^(?:Database [A-Za-z .;/-]+|API startup failed\.)$/.test(value);
}
const unsafe=/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|\b(?:password|api[_ -]?key|secret|cookie|access[_ -]?token)\s*[:=]\s*\S+|[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i;
export function safeLogString(value:unknown,secrets:readonly string[],limit=256):value is string {
 return typeof value==='string'&&value.length<=limit&&!/[\u0000-\u001f\u007f]/u.test(value)&&!unsafe.test(value)&&
  !secrets.some(secret=>secret.length>0&&(value.includes(secret)||value.includes(JSON.stringify(secret).slice(1,-1))));
}
export function logFields(event:string,input:unknown,secrets:readonly string[]):Record<string,unknown>{
 const result:Record<string,unknown>={};
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return result;
 for(const key of allowed){const descriptor=Object.getOwnPropertyDescriptor(input,key);if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))continue;
  const value=descriptor.value;
  if(key==='remainingDrainMs'&&value===null||key==='drainStartedAt'&&value===null){result[key]=null;continue;}
  if(numbers.includes(key)){if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)result[key]=value;continue;}
  if(booleans.includes(key)){if(typeof value==='boolean')result[key]=value;continue;}
  if(!safeLogString(value,secrets,key==='message'?512:256))continue;
  if(ids.includes(key)){if(key==='requestId'?/^[a-zA-Z0-9._-]{1,64}$/.test(value):isUUID(value))result[key]=value;}
  else if(tokens.includes(key)){if(/^[a-zA-Z0-9_.-]{1,64}$/.test(value))result[key]=value;}
  else if(key==='route'){if(/^\/[a-zA-Z0-9_:/.*()-]{0,199}$/.test(value)||value==='unmatched')result[key]=value;}
  else if(key==='drainStartedAt'){if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value)))result[key]=value;}
  else if(key==='message'&&event==='startup_failed'&&startupMessage(value))result[key]=value;
 }
 return result;
}
