const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApplication}=require('../dist/application');
const {ApiLogger}=require('../dist/common/api-logger');
const {AgentsService}=require('../dist/agents/agents.service');
const {TaskLifecycleService}=require('../dist/lifecycle/task-lifecycle.service');

// Registered by the existing PostgreSQL activity suite, using its isolated
// fixture and trusted persistence-only state builder. No provider execution claim.
module.exports=({fixture,state})=>{
 test('P3 T08 real HTTP server restart reconciles two Agents, persisted missed outcomes and stable NPC bindings', {timeout:30000},async()=>{
  const f=await fixture();let runtime,owner,visuals,restarted,closed=false;
  try{
   const {createRuntimeIntegration}=await import('../../../dist/js/runtime/index.js');
   const {createNpcRuntimeBindings}=await import('../../../dist/js/runtime/npc-runtime-binding.js');
   const {createNpcStatusPresentation,NPC_VISUALS}=await import('../../../dist/js/runtime/npc-status.js');
   const {NpcInspectionSelection}=await import('../../../dist/js/runtime/inspection-model.js');
   const {Simulation}=await import('../../../dist/js/simulation.js');
   const {FakeClock}=await import('../../../tests/runtime-fixtures.js');
   const a=await f.agent(),b=await f.agent();
   await f.app.get(AgentsService).lifecycle(a.id,'ACTIVE',a.version);await f.app.get(AgentsService).lifecycle(b.id,'ACTIVE',b.version);
   const bindingA=await f.bind(a.id),bindingB=await f.bind(b.id,'resident-slot-002');
   const clock=new FakeClock(),sim=new Simulation(),selection=new NpcInspectionSelection();
   const pageOrigin='http://127.0.0.1:5173',baseUrl=await f.app.getUrl(),port=Number(new URL(baseUrl).port);
   const fetchImpl=(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:pageOrigin}});
   runtime=createRuntimeIntegration({fetchImpl,clock,timers:clock,random:()=>.5});owner=createNpcRuntimeBindings(runtime.view,sim);visuals=createNpcStatusPresentation(owner.view,()=>clock.now());
   runtime.connect({baseUrl,pageOrigin,token:f.cityToken});await runtime.refresh();
   assert.equal(owner.view.getForEntity(sim.agents[0]).agentId,a.id);assert.equal(owner.view.getForEntity(sim.agents[1]).agentId,b.id);
   const active=await state(f,a,'RUNNING');await runtime.refresh();
   assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.RUNNING);assert.equal(selection.read(owner.view.getForEntity(sim.agents[0])).selected.id,active.id);
   await state(f,b,'FAILED');await runtime.refresh();assert.equal(visuals.getForEntity(sim.agents[1]),NPC_VISUALS.FAILED);
   await f.close();closed=true;
   await runtime.refresh();assert.equal(runtime.getSnapshot().phase,'ERROR');assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.STALE);
   // Persist a new outcome through the owned isolated test pool while HTTP is down.
   const missed=await state(f,b,'SUCCEEDED');
   restarted=await createApplication(f.config);restarted.get(ApiLogger).info=()=>{};restarted.get(ApiLogger).error=()=>{};
   await restarted.listen(port,'127.0.0.1');
   await restarted.get(TaskLifecycleService).cancelTask(active.task_id,{taskVersion:1,executionId:active.id,executionVersion:1});
   await clock.advance(2000);assert.equal(runtime.getSnapshot().phase,'REFRESHING');
   // Fake timers start the real HTTP request; join its in-flight Promise rather
   // than assuming a microtask flush has completed socket I/O.
   await runtime.refresh();assert.equal(runtime.getSnapshot().phase,'READY');assert.equal(runtime.getSnapshot().freshness,'fresh');
   assert.equal(runtime.getAgent(a.id).recentOutcome.status,'CANCELLED');assert.equal(runtime.getAgent(b.id).recentOutcome.executionId,missed.id);
   assert.equal(runtime.getAgent(b.id).recentOutcome.status,'COMPLETED');assert.equal(owner.view.getForEntity(sim.agents[0]).bindingId,bindingA.id);
   assert.equal(owner.view.getForEntity(sim.agents[1]).bindingId,bindingB.id);assert.equal(selection.read(owner.view.getForEntity(sim.agents[0])).selected.id,active.id);
   assert.equal(sim.agents.length,4);assert.equal(owner.view.listLinked().length,2);
   runtime.disconnect();assert.equal(clock.timers.size,0);assert.equal(owner.view.listLinked().length,0);
  }finally{visuals?.dispose();owner?.dispose();runtime?.dispose();await restarted?.close();if(!closed)await f.close();}
 });
};
