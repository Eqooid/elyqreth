import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {cpus,totalmem,platform,arch} from 'node:os';
import {writeFileSync} from 'node:fs';
import {InteractionSession} from '../dist/js/runtime/interaction/session.js';
import {InteractionRecoveryJournal} from '../dist/js/runtime/interaction/recovery-journal.js';
import {InteractionApiClient} from '../dist/js/runtime/interaction/api-client.js';
import {agent,taskDetail,execution,id,stamp} from '../tests/interaction-fixtures.js';
import {FakeClock,response,flush,activity} from '../tests/runtime-fixtures.js';
assert.equal(typeof global.gc,'function','Run with node --expose-gc');
function fixture(){
 const clock=new FakeClock(),requests=new Map();const origin='http://127.0.0.1:3001';
 const eligibility={canCreateTask:true,canRequestStart:false,canRequestCancel:true,reason:null};
 const detail=n=>execution({id:id(500+n),agentId:id(n),taskId:id(200+n),status:'RUNNING',version:2,finishedAt:null,durationMs:null,resultAvailability:'PENDING',actionEligibility:eligibility});
 const client=new InteractionApiClient({baseUrl:origin,pageOrigin:origin,clock,timers:clock,fetchImpl:async(url)=>{
  const u=new URL(url),p=u.pathname.split('/');const kind=p[3]==='agents'?(p[5]==='executions'?'history':'agent'):p.at(-1)==='result'?'result':p[5]==='executions'?'execution':'task';requests.set(kind,(requests.get(kind)??0)+1);
  const n=Number(p[4].slice(-12))-(p[3]==='agents'?0:200);
  if(kind==='agent')return response(agent({id:id(n)}));
  if(kind==='history')return response({items:[detail(n)],pagination:{limit:10,nextCursor:null}});
  if(kind==='execution')return response(detail(n));
  if(kind==='result')return response({execution:detail(n),availability:'PENDING',result:null});
  return response(taskDetail({id:id(200+n),agentId:id(n),status:'RUNNING',version:3,completedAt:null,latestExecutionId:id(500+n),actionEligibility:eligibility}));
 }});client.authorize('L'.repeat(40));
 const session=new InteractionSession(client,{baseUrl:origin,journal:new InteractionRecoveryJournal(origin,{storage:null,now:clock.wallNow})});
 const select=async n=>{session.select({state:'RESOLVED',agentId:id(n),bindingId:id(100+n),npcId:`resident-slot-${String(n).padStart(3,'0')}`,freshness:'fresh',lastSuccessfulSyncAt:stamp,activity:activity(n,{currentTask:{id:id(200+n),status:'RUNNING',version:3},currentExecution:{id:id(500+n),status:'RUNNING',version:2,attemptNumber:1}})});await flush();};
 return {session,requests,select,async dispose(){session.dispose();client.dispose();await flush();assert.equal(clock.timers.size,0);}};
}
const measurements=[];
for(const count of [1,5,20]){
 const f=fixture(),samples=[];try{
  f.session.results.openHistory(true);f.session.results.openResult(true);const cpu=process.cpuUsage();
  for(let i=0;i<200;i++){const start=performance.now();await f.select(i%count+1);samples.push(performance.now()-start);assert.equal(f.session.results.getSnapshot().agentId,id(i%count+1));assert.equal(f.session.lifecycle.getSnapshot().execution?.status,'RUNNING');assert.equal(f.session.results.getSnapshot().result?.availability,'PENDING');assert.ok(f.session.results.getSnapshot().items.length<=10);}
  const ordered=[...samples].sort((a,b)=>a-b),used=process.cpuUsage(cpu);
  const total=[...f.requests.values()].reduce((sum,n)=>sum+n,0);assert.ok(total<=(count===1?8:1200),'Repeated selection caused request amplification');
  measurements.push({agents:count,selections:200,requests:Object.fromEntries(f.requests),medianMs:ordered[100],p95Ms:ordered[190],cpuMs:(used.user+used.system)/1000,retainedHistoryRows:f.session.results.getSnapshot().items.length});
 }finally{await f.dispose();}
}
const heapCheckpoints=[];global.gc();heapCheckpoints.push({cycles:0,heapUsed:process.memoryUsage().heapUsed});
for(let n=1;n<=100;n++){const f=fixture();await f.select(n%20+1);f.session.results.openHistory(true);await flush();await f.dispose();if(n%25===0){global.gc();heapCheckpoints.push({cycles:n,heapUsed:process.memoryUsage().heapUsed});}}
const report={kind:'Synthetic concurrent RUNNING read contracts; actual interaction owners and controlled fetch, not provider executions or Canvas throughput',environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},measurements,heapCheckpoints,cleanup:'100 create/select/open-history/dispose cycles: zero outstanding client timers after each',limits:'Short forced-GC investigation, no production capacity or leak-freedom claim; existing native T07 fixture covers real two-Agent execution observation.'};
if(process.argv[2]==='--out')writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
