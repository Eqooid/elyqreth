import assert from 'node:assert/strict';
// CDP profiling only. No production application hooks or persistent animation loop.
export async function profileCity({command,evaluate,state}){
 await command('Performance.enable');
 const samples=[];
 async function sample(agents){
  const before=await command('Performance.getMetrics');
  const frames=await evaluate(`new Promise(resolve=>{const times=[];let previous;const tick=now=>{if(previous!==undefined)times.push(now-previous);previous=now;if(times.length===120)resolve(times);else requestAnimationFrame(tick);};requestAnimationFrame(tick);})`);
  const after=await command('Performance.getMetrics'),city=await state();
  const metric=(v,name)=>v.metrics.find(m=>m.name===name)?.value??0;
  const sorted=[...frames].sort((a,b)=>a-b),mean=frames.reduce((a,b)=>a+b,0)/frames.length;
  samples.push({projectionAgents:agents,boundExistingNpcs:Math.min(agents,4),sampledFrames:frames.length,meanFrameMs:mean,p95FrameMs:sorted[Math.floor(sorted.length*.95)],sampledFps:1000/mean,
   simulationTime:city.time,decorativeNpcCount:city.citizens.length,camera:city.camera,
   sceneRenderMsEwma:city.renderMs,taskDurationSeconds:metric(after,'TaskDuration')-metric(before,'TaskDuration'),scriptDurationSeconds:metric(after,'ScriptDuration')-metric(before,'ScriptDuration'),
   heapUsedBytes:metric(after,'JSHeapUsedSize'),dom:await command('Memory.getDOMCounters'),applicationFpsReadout:city.fps});
 }
 await evaluate("document.querySelector('[data-agent]').click()");
 await sample(0);
 await evaluate(`(async()=>{
  const {runtimeIntegration:r,createRuntimeIntegration}=await import('/js/runtime/index.js');
  const {createNpcRuntimeBindings}=await import('/js/runtime/npc-runtime-binding.js');
  const {createNpcStatusPresentation}=await import('/js/runtime/npc-status.js');
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');let count=1,requests=0;
  const fetchImpl=async()=>{requests++;const time=new Date().toISOString();return new Response(JSON.stringify({schemaVersion:1,observedAt:time,nextCursor:null,
   items:Array.from({length:count},(_,i)=>({schemaVersion:1,agentId:uid(i+1),name:'Profile Agent '+(i+1),agentType:'RULE_BASED',availability:'ACTIVE',agentVersion:1,
    npcId:'resident-slot-'+String(i+1).padStart(3,'0'),bindingId:uid(100+i),activityStatus:'RUNNING',currentTask:{id:uid(200+i),status:'RUNNING',version:1},
    currentExecution:{id:uid(300+i),status:'RUNNING',version:1,attemptNumber:1},activeExecutionCount:1,queuedTaskCount:0,createdTaskCount:0,
    recentOutcome:null,lastExecution:null,lastActivityAt:time,observedAt:time,requiresAttention:false,statusReason:'CURRENT_LEASE'}))}),{headers:{'content-type':'application/json'}});};
  const original=globalThis.fetch;globalThis.fetch=fetchImpl;r.connect({baseUrl:location.origin,pageOrigin:location.origin,token:'P'.repeat(40)});globalThis.fetch=original;await r.refresh();
  globalThis.__phase3Profile={async set(n){count=n;await r.refresh();},requests:()=>requests,stop:()=>r.disconnect(),
   async cycles(n){const results=[];for(let i=0;i<n;i++){
    const listeners=new Set(),source={getResidents:()=>Array.from({length:20},(_,i)=>Object.freeze({id:i+1,npcId:'resident-slot-'+String(i+1).padStart(3,'0')})),subscribeResidents(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
    const runtime=createRuntimeIntegration({fetchImpl}),owner=createNpcRuntimeBindings(runtime.view,source),visuals=createNpcStatusPresentation(owner.view);
    runtime.connect({baseUrl:location.origin,pageOrigin:location.origin,token:'P'.repeat(40)});await runtime.refresh();visuals.dispose();owner.dispose();runtime.dispose();
    if(listeners.size||Object.keys(runtime.getSnapshot().activitiesByAgentId).length)throw Error('Lifecycle resource residue');
   }return {cycles:n,residentListeners:0,retainedAgentRows:0};}};
 })()`);
 for(const agents of [1,10,20]){await evaluate(`globalThis.__phase3Profile.set(${agents})`);await sample(agents);}
 const requests=await evaluate('globalThis.__phase3Profile.requests()');
 await evaluate('globalThis.__phase3Profile.stop()');
 const heap=[];
 await evaluate('globalThis.__phase3Profile.cycles(20)'); // JIT/import warmup excluded.
 for(const cycles of [0,100,200,300]){
  if(cycles)await evaluate('globalThis.__phase3Profile.cycles(100)');
  await command('HeapProfiler.collectGarbage');
  heap.push({cycles,...await command('Runtime.getHeapUsage'),dom:await command('Memory.getDOMCounters')});
 }
 await evaluate('delete globalThis.__phase3Profile');
 assert.equal(await evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');return r.getSnapshot().phase;})()"),'DISCONNECTED');
 return {kind:'Headless Chromium; sampled rAF intervals, CDP task/heap/DOM counters; mocked provider-neutral activity transport',samples,requestsDuringForegroundSamples:requests,heap,
  limitations:'Four existing visible residents; up to 20 projections. No 25/50/100 linked NPC capacity, long soak, native/GPU memory, or strict comparable-world FPS guarantee.'};
}
