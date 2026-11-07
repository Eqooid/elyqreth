import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,lstatSync,realpathSync,openSync,closeSync,writeFileSync,renameSync,unlinkSync,existsSync,fsyncSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {signalSummary} from './operational-signals.mjs';
import {loadConfig,privateFile,exact,integer,fail,monitorConditions} from './monitor/config.mjs';
import {sendEmail,DeliveryError,checkEmailConfiguration} from './monitor/smtp.mjs';

const execute=promisify(execFile);
const conditions=new Set(monitorConditions);
const sorted=values=>[...new Set(values)].sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validConditions(values){if(!Array.isArray(values)||values.length>conditions.size||values.some(v=>!conditions.has(v))||!same(values,sorted(values)))fail();}
export function emptyState(){return {version:1,active:[],healthy:0,notified:[],delivery:null};}
export function validateState(state){
 exact(state,['version','active','healthy','notified','delivery']);if(state.version!==1)fail();validConditions(state.active);validConditions(state.notified);integer(state.healthy,0,10);
 if(state.delivery!==null){const d=state.delivery;exact(d,['id','kind','conditions','attempts','status','nextAt','acceptedAt']);
  if(typeof d.id!=='string'||!/^[a-f0-9]{64}$/.test(d.id)||!['ALERT','CLEARED'].includes(d.kind)||!['pending','inflight','accepted','uncertain','exhausted'].includes(d.status))fail();
  validConditions(d.conditions);if(!d.conditions.length)fail();integer(d.attempts,0,3);integer(d.nextAt,0,Number.MAX_SAFE_INTEGER);if(d.acceptedAt!==null)integer(d.acceptedAt,0,Number.MAX_SAFE_INTEGER);
  if(d.status==='accepted'?(d.acceptedAt===null||d.attempts===0):d.acceptedAt!==null)fail();
  if(['inflight','uncertain','exhausted'].includes(d.status)&&d.attempts===0||d.status==='exhausted'&&d.attempts!==3||d.status==='pending'&&d.attempts===3)fail();
 }
 return state;
}
/** Read only through the existing private probe and Docker log access; no database credentials or mutations. */
export async function collect(config,run=execute){
 const prefix=['compose',...(config.composeEnvFile?['--env-file',config.composeEnvFile]:[]),...config.composeFiles.flatMap(p=>['-f',p])];
 const output=[];const summary=signalSummary();
 const probeCode="fetch('http://127.0.0.1:3001/ready?diagnostics=true',{signal:AbortSignal.timeout(2500)}).then(async r=>{const b=await r.json();console.log(JSON.stringify({status:r.status,dependency:b.readiness?.dependency}))}).catch(()=>process.exitCode=1)";
 const results=await Promise.allSettled([
  run('docker',[...prefix,'logs','--no-log-prefix','--no-color','--since',config.windowSeconds+'s','--tail','1000','api'],{timeout:10000,maxBuffer:2*1024*1024,windowsHide:true}),
  run('docker',[...prefix,'exec','-T','api','node','-e',probeCode],{timeout:10000,maxBuffer:65536,windowsHide:true})
 ]);
 if(results[0].status==='fulfilled'){
  const lines=results[0].value.stdout.split(/\r?\n/).filter(Boolean);if(lines.length>=1000)output.push('monitor_input_incomplete');
  for(const line of lines)summary.accept(line);
  const report=summary.snapshot();output.push(...report.alerts.map(a=>a.condition));if(report.invalidLines||report.unknownEvents)output.push('monitor_input_incomplete');
 }else output.push('monitor_source_unavailable');
 let ready=false;
 if(results[1].status==='fulfilled')try{
  const probe=JSON.parse(results[1].value.stdout);ready=probe.status===200&&probe.dependency==='READY';
  if(ready){const index=output.indexOf('database_readiness_unavailable');if(index>=0)output.splice(index,1);}
 }catch{}
 if(!ready)output.push('api_readiness_unavailable');
 return sorted(output);
}
function newDelivery(kind,values,now){return {id:createHash('sha256').update(randomUUID()).digest('hex'),kind,conditions:[...values],attempts:0,status:'pending',nextAt:now,acceptedAt:null};}
/** Persist intent before SMTP. A crash/unknown DATA result is quarantined instead of blindly resending. */
export async function processSample(previous,values,config,{save,deliver,now=Date.now()}){
 const state=structuredClone(validateState(previous));values=sorted(values);validConditions(values);
 state.active=values;state.healthy=values.length?0:Math.min(10,state.healthy+1);
 if(state.delivery?.status==='inflight')state.delivery.status='uncertain';
 const finish=async(status,errorCode)=>{await save(state);return {event:'monitor.check',conditions:values,delivery:status,...(errorCode?{errorCode}:{})};};
 if(state.delivery?.status==='uncertain')return finish('uncertain','DELIVERY_REQUIRES_REVIEW');
 if(values.length){
  const d=state.delivery;
  if(!d||d.kind!=='ALERT'||!same(d.conditions,values)||d.status==='accepted'&&now-d.acceptedAt>=config.repeatSeconds*1000)state.delivery=newDelivery('ALERT',values,now);
 }else{
  if(state.healthy<config.healthyChecks)return finish('waiting_for_clear');
  if(state.notified.length){if(state.delivery?.kind!=='CLEARED')state.delivery=newDelivery('CLEARED',state.notified,now);}
  else{state.delivery=null;return finish('quiet');}
 }
 const d=state.delivery;
 if(d.status==='accepted')return finish('suppressed');
 if(d.status==='exhausted')return finish('exhausted','DELIVERY_REQUIRES_REVIEW');
 if(now<d.nextAt)return finish('retry_wait');
 d.attempts++;d.status='inflight';await save(state);
 try{
  await deliver({schemaVersion:1,id:d.id,kind:d.kind,conditions:d.conditions,observedAt:new Date(now).toISOString(),
   meaning:d.kind==='ALERT'?'Condition detected; inspect authorized diagnostics.':'No longer observed for consecutive checks; this does not prove Execution success.',runbook:'docs/ai-agent-platform/phase-6/observability.md#incident-runbooks'});
 }catch(error){
  d.status=error instanceof DeliveryError&&error.uncertain?'uncertain':d.attempts>=3?'exhausted':'pending';
  d.nextAt=now+[60000,300000,900000][d.attempts-1];
  return finish(d.status,error instanceof DeliveryError?error.code:'SMTP_UNAVAILABLE');
 }
 // Keep this outside the transport catch: failed persistence after acceptance leaves durable inflight intent.
 d.status='accepted';d.acceptedAt=now;state.notified=d.kind==='ALERT'?[...values]:[];return finish('accepted');
}
export function openStore(directory){
 directory=resolve(directory);if(dirname(directory)===directory)fail();mkdirSync(directory,{recursive:true,mode:0o700});
 const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(directory)!==directory||process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid()))fail();
 const lock=join(directory,'monitor.lock'),stateFile=join(directory,'state.json');const fd=openSync(lock,'wx',0o600);closeSync(fd);
 return {
  load:()=>existsSync(stateFile)?validateState(JSON.parse(privateFile(stateFile))):emptyState(),
  save:async value=>{const temp=join(directory,'state-'+randomUUID()+'.tmp');try{const f=openSync(temp,'wx',0o600);try{writeFileSync(f,JSON.stringify(validateState(value))+'\n');fsyncSync(f);}finally{closeSync(f);}renameSync(temp,stateFile);if(process.platform!=='win32'){const d=openSync(directory,'r');try{fsyncSync(d);}finally{closeSync(d);}}}finally{if(existsSync(temp))unlinkSync(temp);}},
  close:()=>unlinkSync(lock)
 };
}
async function main(){
 const [mode,flag,file,...extra]=process.argv.slice(2);const dryRun=extra.length===1&&extra[0]==='--dry-run';
 if(!['check','once','watch'].includes(mode)||flag!=='--config'||!file||extra.length&&!dryRun||dryRun&&mode!=='once')fail();
 const config=loadConfig(file);
 if(mode==='check'){if(config.email.enabled)checkEmailConfiguration(config.email);console.log(JSON.stringify({event:'monitor.configuration',valid:true,enabled:config.enabled,emailEnabled:config.email.enabled}));return;}
 if(!config.enabled){console.log(JSON.stringify({event:'monitor.disabled'}));return;}
 const store=openStore(config.stateDirectory);let stopping=false;const abort=new AbortController();const stop=()=>{stopping=true;abort.abort();};
 if(mode==='watch'){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
 try{
  do{
   try{
    const values=await collect(config);
    const result=dryRun||!config.email.enabled?{event:'monitor.preview',conditions:values,emailSent:false}:await processSample(store.load(),values,config,{save:store.save,deliver:notice=>sendEmail(config.email,notice)});
    console.log(JSON.stringify(result));process.exitCode=['uncertain','exhausted','pending','retry_wait'].includes(result.delivery)?1:result.emailSent===false&&values.length?2:0;
   }catch{process.stderr.write('{"event":"monitor.failed","errorCode":"CHECK_OR_STATE_FAILURE"}\n');process.exitCode=1;}
   if(mode!=='watch'||stopping)break;
   try{await sleep(config.intervalSeconds*1000,undefined,{signal:abort.signal});}catch{}
  }while(!stopping);
 }finally{store.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('{"event":"monitor.failed","errorCode":"CONFIGURATION_OR_LOCK_FAILURE"}\n');process.exitCode=1;});
