import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{logEvents}=require('../apps/api/dist/common/log-policy');
const known=new Set(logEvents),buckets=[100,500,1000,5000,30000,Infinity];
/** Local log-derived counters only. No identifiers, dynamic labels, storage or network destination. */
export function signalSummary(){
 const counts=Object.fromEntries(logEvents.map(event=>[event,0])),http={success:0,clientError:0,serverError:0,aborted:0},latency=buckets.map(()=>0);
 let invalid=0,unknown=0,dependency='UNKNOWN',externalAuth=0,externalTransient=0,deferred=0;
 const inc=(object,key)=>{object[key]=Math.min(Number.MAX_SAFE_INTEGER,object[key]+1);};
 function accept(line){
  if(Buffer.byteLength(line)>8192){invalid++;return;}
  let row;try{row=JSON.parse(line);}catch{invalid++;return;}
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.event!=='string'){invalid++;return;}
  if(!known.has(row.event)){unknown++;return;}
  inc(counts,row.event);
  if(row.event==='http_request'){
   if(row.statusCode===499)inc(http,'aborted');else if(row.statusCode>=500&&row.statusCode<=599)inc(http,'serverError');
   else if(row.statusCode>=400&&row.statusCode<=499)inc(http,'clientError');else if(row.statusCode>=200&&row.statusCode<=399)inc(http,'success');
   if(typeof row.durationMs==='number'&&Number.isFinite(row.durationMs)&&row.durationMs>=0){const index=buckets.findIndex(v=>row.durationMs<=v);latency[index]=Math.min(Number.MAX_SAFE_INTEGER,latency[index]+1);}
  }
  if(row.event==='readiness.changed'&&['READY','NOT_CONFIGURED','DATABASE_ACCESS','DATABASE_PERMISSION','DATABASE_CAPACITY','DATABASE_TIMEOUT','DATABASE_UNAVAILABLE','SCHEMA_INCOMPATIBLE','CHECK_TIMEOUT','UNKNOWN'].includes(row.dependency))dependency=row.dependency;
  if(row.event==='external.operation'&&row.outcome==='FAILED'){
   if(['AUTHENTICATION_FAILED','AUTHORIZATION_FAILED'].includes(row.code))externalAuth++;
   if(['TIMEOUT','RATE_LIMITED','CONNECTION_UNAVAILABLE','TRANSIENT_FAILURE'].includes(row.code))externalTransient++;
  }
  if(row.event==='external.ingestion'&&typeof row.outcome==='string'&&['PROJECTION_DEFERRED_MAPPING','PROJECTION_DEFERRED_ORDERING','PROJECTION_DEFERRED_CONFLICT','PROJECTION_FAILED'].includes(row.outcome))deferred++;
 }
 function snapshot(){
  const alerts=[];const alert=(condition,severity)=>alerts.push({condition,severity,runbook:'observability.md#incident-runbooks'});
  if(!['READY','NOT_CONFIGURED','UNKNOWN'].includes(dependency))alert('database_readiness_unavailable','critical');
  if(http.serverError>=5)alert('http_server_errors','warning');
  if(counts['runtime.drain.deadline']>0)alert('runtime_drain_deadline','warning');
  if(counts['runtime.failure']>0)alert('runtime_finalization_or_context_failure','critical');
  if(counts['shutdown_failed']+counts['shutdown_deadline_exceeded']>0)alert('shutdown_failure','critical');
  if(externalAuth>=3)alert('external_authentication_failures','warning');
  if(externalTransient>=3)alert('external_provider_unavailable','warning');
  if(counts['external.ingestion.authorization_denied']>0)alert('ingestion_authorization_denied','warning');
  if(deferred>=3)alert('ingestion_requires_reconciliation','warning');
  return {schemaVersion:1,scope:'operator_supplied_log_slice',thresholds:'PROPOSED_NOT_PRODUCTION_BASELINED',counts,http,
   httpLatency:{unit:'milliseconds',semantics:'disjoint_upper_bounds',buckets:buckets.map((upper,i)=>({upperBound:Number.isFinite(upper)?upper:'infinity',count:latency[i]}))},
   lastDependency:dependency,invalidLines:invalid,unknownEvents:unknown,alerts};
 }
 return {accept,snapshot};
}
async function main(){
 if(process.argv.length!==2)throw Error('No arguments accepted; provide a bounded reviewed JSONL log slice on stdin.');
 const summary=signalSummary();let pending='',discarding=false;
 for await(const chunk of process.stdin){
  const text=chunk.toString('utf8');for(const part of text.split(/(?<=\n)/)){
   const ends=part.endsWith('\n');if(!discarding)pending+=part;
   if(Buffer.byteLength(pending)>8192){summary.accept('x'.repeat(8193));pending='';discarding=true;}
   if(ends){if(!discarding&&pending.trim())summary.accept(pending.trim());pending='';discarding=false;}
  }
 }
 if(!discarding&&pending.trim())summary.accept(pending.trim());
 const output=summary.snapshot();process.stdout.write(JSON.stringify(output)+'\n');process.exitCode=output.alerts.length?2:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('Operational log analysis failed. Build the API and provide bounded JSONL on stdin.\n');process.exitCode=1;});
