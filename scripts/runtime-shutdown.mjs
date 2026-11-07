import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Test-only mounted bootstrap: never copied into an application image. */
export async function verifyRuntimeShutdown({docker,input,api,apiImage,folder,apiArgs,names,password,agent,evidence,waitFor,sql}){
 const wrapper=join(folder,'runtime-bootstrap.cjs');
 writeFileSync(wrapper,`
 const base='/app/apps/api/dist/',fs=require('fs');
 (async()=>{const app=await require(base+'application').createApplication(require(base+'config/configuration').loadConfiguration());
 const {RuntimeCoordinator}=require(base+'runtime/runtime-coordinator'),{StrategyRegistry}=require(base+'runtime/strategy-registry');
 const real=app.get(require(base+'runtime/strategies/text-statistics.strategy').TextStatisticsStrategy);
 app.get(RuntimeCoordinator).strategies=new StrategyRegistry([{id:'text.stats.v1',strategy:{type:'RULE_BASED',async execute(r,c){
   console.log('T09 fixture entered');await new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync('/tmp/release')){clearInterval(timer);resolve();}},20);});return real.execute(r,c);
 }}}]);await app.listen(3001,'0.0.0.0');require(base+'runtime/runtime-signals').runtimeSignals(app);
 })().catch(()=>process.exit(1));`);
 const client=`let text='';process.stdin.on('data',b=>text+=b);process.stdin.on('end',async()=>{try{
 const v=JSON.parse(text),base='http://'+v.host+':3001/api/v1',call=async(path,body,token,version)=>{
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(version?{'If-Match':'"'+version+'"'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const login=await call('/auth/login',{username:'operator',password:v.password}),token=login.data.accessToken;
 const task=await call('/tasks',{agentId:v.agent,input:{instruction:v.key},idempotencyKey:v.key},token);
 const result=await call('/tasks/'+task.data.id+'/execute',{},token,task.data.version);
 console.log(JSON.stringify(result));}catch{console.error('T09 fixture HTTP request failed');process.exitCode=1;}});`;
 for(const mode of ['clean','timeout']){
  const name=api+'_'+mode,key=randomUUID();names.push(name);
  await docker('run','-d',...apiArgs(name,{RUNTIME_DRAIN_TIMEOUT_MS:mode==='clean'?'10000':'1000'}),
   '--mount',`type=bind,src=${wrapper},dst=/tmp/bootstrap.cjs,readonly`,apiImage,'node','/tmp/bootstrap.cjs');
  await waitFor(async()=>await docker('exec',name,'node','docker/api-health.cjs').then(()=>true),'T09 fixture not ready');
  const running=input(['exec','-i',api,'node','-e',client],JSON.stringify({host:name,password,agent,key}));
  // Attach rejection handling before any process can exit.
  const outcome=running.then(value=>({value}),error=>({error}));
  await waitFor(async()=>(await docker('logs',name)).includes('T09 fixture entered'),'T09 strategy did not start');
  const execution=await sql(`SELECT e.id FROM executions e JOIN tasks t ON t.id=e.task_id WHERE t.input->>'instruction'='${key}'`);
  assert.match(execution,/^[a-f0-9-]{36}$/);
  if(mode==='clean'){
   await docker('kill','--signal=SIGUSR2',name);
   const diagnostic=JSON.parse(await docker('exec',name,'node','-e',`fetch('http://127.0.0.1:3001/ready?runtime=true').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))`));
   assert.equal(diagnostic.status,503);assert.equal(diagnostic.body.runtime.state,'DRAINING');assert.equal(diagnostic.body.runtime.activeExecutions,1);
   assert.equal(await docker('exec',name,'node','-e',`fetch('http://127.0.0.1:3001/health').then(r=>console.log(r.status))`),'200');
   await docker('kill','--signal=SIGTERM',name);await docker('kill','--signal=SIGTERM',name);
   await docker('exec',name,'node','-e',`require('fs').writeFileSync('/tmp/release','release');`);
  }else await docker('kill','--signal=SIGTERM',name);
  const exit=await docker('wait',name);assert.equal(exit,'0');
  const result=await outcome;if(result.error)throw Error('T09 in-flight response failed');
  const receipt=JSON.parse(result.value);
  if(mode==='clean'){assert.equal(receipt.status,200);assert.equal(receipt.data.execution?.status,'SUCCEEDED',JSON.stringify(receipt));}
  else{assert.equal(receipt.status,409);assert.equal(receipt.data.code,'CANCELLED');}
  assert.equal(await sql(`SELECT status FROM executions WHERE id='${execution}'`),mode==='clean'?'SUCCEEDED':'CANCELLED');
  assert.equal(await sql(`SELECT count(*) FROM executions WHERE id='${execution}'`),'1');
  if(mode==='timeout')assert.equal(await sql(`SELECT reconciliation_state FROM executions WHERE id='${execution}'`),'CANCELLATION_UNCONFIRMED');
  const logs=await docker('logs',name);assert.match(logs,/runtime.stopped/);
  if(mode==='timeout')assert.match(logs,/runtime.drain.deadline/);
  evidence.checks.push('T09 '+mode+': real PID1 signals, in-flight HTTP outcome, non-root drain and durable state; no duplicate effective execution');
 }
}
