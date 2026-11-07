/** @import {Execution,ResultResponse} from './contracts' */
/** All display labels/structured fields are allow-listed. Never serialize arbitrary backend objects. @param {ResultResponse|null} response */
export function presentResult(response){
 if(!response)return {label:'No result loaded',text:''};
 if(response.displayReason==='DISCLOSURE_RESTRICTED')return {label:'Result content is not disclosed for this Agent.',text:''};
 if(response.availability==='PENDING')return {label:'Result pending. Persisted execution has not produced a disclosed result.',text:''};
 if(response.availability!=='AVAILABLE'||!response.result)return {label:'Result unavailable. No output content is provided by the backend.',text:''};
 const out=response.result.output;
 if(out.type==='text')return {label:'Plain text result (untrusted text)',text:out.text};
 if(out.type==='text.statistics.v1')return {label:'Text statistics (structured output)',text:JSON.stringify({codePointCount:out.data.codePointCount,wordCount:out.data.wordCount,nonemptyLineCount:out.data.nonemptyLineCount},null,2)};
 return {label:'Unsupported result format. No output displayed.',text:''};
}
/** @param {Execution|null} execution */
export function outcomeSummary(execution){return execution?.status==='FAILED'?'Execution failed. No internal diagnostic payload is displayed.':execution?.status==='TIMED_OUT'?'Execution timed out.':execution?.status==='CANCELLED'?'Execution was cancelled.':execution?.status==='SUCCEEDED'?'Recorded terminal success; this is not active work.':execution?'Recorded nonterminal state; no live progress is inferred.':'No Execution reference is available.';}
/** @param {Execution|null} e @returns {readonly (readonly [string,string])[]} */
export function executionFields(e){return e?Object.freeze([['Agent ID',e.agentId],['Task ID',e.taskId],['Execution ID',e.id],['Execution status',e.status],['Attempt',String(e.attemptNumber)],['Created',e.createdAt],['Started',e.startedAt??'Not available'],['Finished',e.finishedAt??'Not available'],['Completed duration',e.durationMs===null?'Not finalized / unavailable':`${e.durationMs} ms`],['Stored result availability',e.resultAvailability]]):Object.freeze([]);}
