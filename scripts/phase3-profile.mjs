import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {cpus,totalmem,platform,release,arch} from 'node:os';
import {writeFileSync} from 'node:fs';
import {Simulation} from '../dist/js/simulation.js';
import {createRuntimeIntegration} from '../dist/js/runtime/index.js';
import {createNpcRuntimeBindings} from '../dist/js/runtime/npc-runtime-binding.js';
import {createNpcStatusPresentation} from '../dist/js/runtime/npc-status.js';
import {NpcInspectionSelection} from '../dist/js/runtime/inspection-model.js';
import {runtimeInspectorHtml} from '../dist/js/runtime/npc-runtime-inspector.js';
import {FakeClock,browserEvents,activity,id,page,response,stamp} from '../tests/runtime-fixtures.js';
assert.equal(typeof global.gc,'function','Run with node --expose-gc');
const connection={baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',token:'V'.repeat(40)};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
function fixture(count){
 const clock=new FakeClock(),events=browserEvents(),sim=new Simulation();
 for(let n=5;n<=Math.min(count,20);n++)sim.addAgent('Profile '+n,'Researcher',sim.agents[0].workplace,false,undefined,'Researcher',`resident-slot-${String(n).padStart(3,'0')}`);
 let requests=0;
 const runtime=createRuntimeIntegration({clock,timers:clock,...events,fetchImpl:async url=>{
  requests++;const q=new URL(url).searchParams,after=Number(q.get('after')?.slice(-12)??0),limit=Number(q.get('limit'));
  const observedAt=new Date(clock.wallNow()).toISOString(),end=Math.min(count,after+limit);
  const items=Array.from({length:end-after},(_,i)=>{const n=after+i+1;return activity(n,{observedAt,activityStatus:'RUNNING',statusReason:'CURRENT_LEASE',activeExecutionCount:1,
   currentTask:{id:id(200+n),status:'RUNNING',version:1},currentExecution:{id:id(400+n),status:'RUNNING',version:1,attemptNumber:1},
   ...(n<=20?{npcId:`resident-slot-${String(n).padStart(3,'0')}`,bindingId:id(100+n)}:{})});});
  return response({...page(items,end<count?id(end):null),observedAt});
 }});
 const owner=createNpcRuntimeBindings(runtime.view,sim),visuals=createNpcStatusPresentation(owner.view,()=>clock.now()),selection=new NpcInspectionSelection();
 return {clock,events,sim,runtime,owner,visuals,selection,requests:()=>requests,
  async refresh(){await runtime.refresh();const npc=sim.agents[0];runtimeInspectorHtml(owner.view.getForEntity(npc),visuals.getForEntity(npc),selection,runtime.getSnapshot());},
  dispose(){selection.clear();visuals.dispose();owner.dispose();runtime.dispose();assert.equal(clock.timers.size,0);assert.equal(events.listeners(),0);}
 };
}
const measurements=[];
for(const count of [1,10,20,25,50,100]){
 const f=fixture(count),iterations=100;
 try{f.runtime.connect(connection);await f.refresh();const samples=[],requestsBefore=f.requests(),cpu=process.cpuUsage();global.gc();const heapBefore=process.memoryUsage().heapUsed;
  for(let i=0;i<iterations;i++){f.clock.time+=2000;const start=performance.now();await f.refresh();samples.push(performance.now()-start);}
  const used=process.cpuUsage(cpu);global.gc();
  assert.equal(f.requests()-requestsBefore,iterations*Math.ceil(count/20));
  measurements.push({agents:count,linked:Math.min(count,20),iterations,pagesPerSweep:Math.ceil(count/20),requests:f.requests()-requestsBefore,
   medianMs:percentile(samples,.5),p95Ms:percentile(samples,.95),cpuMs:(used.user+used.system)/1000,heapBefore,heapAfter:process.memoryUsage().heapUsed,
   inspectorReferences:f.selection.read(f.owner.view.getForEntity(f.sim.agents[0])).executions.length});
 }finally{f.dispose();}
}
// Repeated integration lifecycle investigation, with comparable forced-GC checkpoints.
const heapCheckpoints=[];global.gc();heapCheckpoints.push({cycles:0,heapUsed:process.memoryUsage().heapUsed});
for(let i=1;i<=300;i++){
 const f=fixture(20);f.runtime.connect(connection);await f.refresh();f.dispose();
 if(i%100===0){global.gc();heapCheckpoints.push({cycles:i,heapUsed:process.memoryUsage().heapUsed});}
}
const report={kind:'synthetic RUNNING projections + synchronization/binding/selected-inspector processing; not actual executions or render throughput',
 environment:{node:process.version,platform:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},
 assumptions:{visibleSlotLimit:20,largerCases:'unbound projection rows beyond 20; not linked NPC capacity',gc:'forced at memory checkpoints',network:'mocked Responses',timing:'performance.now; no pass/fail latency threshold'},measurements,heapCheckpoints,
 limits:'Short synthetic investigation; heap/RSS variability and native/browser memory are not leak-freedom or production capacity guarantees.'};
if(process.argv[2]==='--out'){assert.ok(process.argv[3]);writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
