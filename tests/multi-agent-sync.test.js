import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeIntegration} from '../dist/js/runtime/index.js';
import {RuntimeActivityStore} from '../dist/js/runtime/runtime-store.js';
import {createNpcRuntimeBindings} from '../dist/js/runtime/npc-runtime-binding.js';
import {createNpcStatusPresentation,NPC_VISUALS} from '../dist/js/runtime/npc-status.js';
import {NpcInspectionSelection,inspectionTimeline} from '../dist/js/runtime/inspection-model.js';
import {Simulation} from '../dist/js/simulation.js';
import {normalizeActivity} from '../dist/js/runtime/validation.js';
import {id,token,otherToken,stamp,activity,page,response,deferred,flush,FakeClock,browserEvents} from './runtime-fixtures.js';
const connection={baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',token};
const linked=(n,patch={})=>activity(n,{npcId:`resident-slot-${String(n).padStart(3,'0')}`,bindingId:id(100+n),...patch});
const running=(n,version=1)=>({activityStatus:'RUNNING',activeExecutionCount:1,currentTask:{id:id(200+n),status:'RUNNING',version},currentExecution:{id:id(300+n),status:'RUNNING',version,attemptNumber:1}});
const outcome=(n,status='COMPLETED')=>({taskId:id(200+n),executionId:id(300+n),status,executionStatus:status==='COMPLETED'?'SUCCEEDED':status,finishedAt:stamp});
function setup(fetchImpl,options={}){const clock=new FakeClock(),events=browserEvents(),runtime=createRuntimeIntegration({clock,timers:clock,fetchImpl,random:()=>.5,...events,...options});
 return {clock,events,runtime,connect:()=>runtime.connect(connection)};}

test('reentrant refresh subscribers see the in-flight lock before LOADING/REFRESHING publication',async()=>{
 let calls=0,reentrant=0;const s=setup(async()=>{calls++;return response(page([linked(1)]));});
 s.runtime.subscribe(v=>{if(v.loading||v.refreshing){reentrant++;if(reentrant<4)void s.runtime.refresh();}});
 s.connect();await s.runtime.refresh();assert.equal(calls,1);assert.equal(reentrant,1);
 await s.runtime.refresh();assert.equal(calls,2);assert.equal(reentrant,2);s.runtime.dispose();assert.equal(s.clock.timers.size,0);
});
test('same-entity version regressions reject the whole sweep atomically and recover through bounded reconciliation',async()=>{
 for(const field of ['agent','task','execution']){
  let items=[linked(1,{...running(1,4),agentVersion:4}),linked(2)];const s=setup(async()=>response(page(items)));
  s.connect();await s.runtime.refresh();const prior=s.runtime.getAgent(id(1));
  const patch=field==='agent'?{agentVersion:3}:field==='task'?{currentTask:{...running(1,4).currentTask,version:3}}:{currentExecution:{...running(1,4).currentExecution,version:3}};
  items=[{...items[0],...patch}];await s.runtime.refresh();assert.equal(s.runtime.getSnapshot().error.code,'STALE_SNAPSHOT');
  assert.equal(s.runtime.getAgent(id(1)),prior);assert.ok(s.runtime.getAgent(id(2)));assert.deepEqual(s.runtime.getSnapshot().missingAgentIds,[]);
  assert.equal(s.runtime.getSnapshot().freshness,'stale');items=[linked(1,{...running(1,5),agentVersion:5}),linked(2)];
  await s.clock.advance(2000);assert.equal(s.runtime.getAgent(id(1)).currentExecution.version,5);assert.equal(s.runtime.getSnapshot().phase,'READY');
  s.runtime.dispose();assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);
 }
});
test('versions are scoped to Agent/Task/Execution IDs, not unrelated agents, new executions or wall timestamps',()=>{
 const store=new RuntimeActivityStore();store.commit([normalizeActivity(linked(1,{...running(1,10),agentVersion:10}))],stamp,stamp);
 const before='2026-10-24T11:00:00.000Z';
 const changed=linked(1,{...running(1),agentVersion:10,observedAt:before,currentTask:{id:id(999),status:'RUNNING',version:1},currentExecution:{id:id(998),status:'RUNNING',version:1,attemptNumber:1}});
 store.commit([normalizeActivity(changed),normalizeActivity(linked(2))],before,stamp);
 assert.equal(store.getAgent(id(1)).currentExecution.id,id(998));assert.equal(store.getAgent(id(2)).agentVersion,1);store.dispose();
});
test('20 independently changing Agents reconcile in one batch without per-NPC polling or entity reconstruction',async()=>{
 let calls=0,items=Array.from({length:20},(_,i)=>linked(i+1));const s=setup(async()=>{calls++;return response(page(items));}),sim=new Simulation();
 for(let n=5;n<=20;n++)sim.addAgent('Test '+n,'Researcher','research',false,undefined,'Researcher',`resident-slot-${String(n).padStart(3,'0')}`);
 const owner=createNpcRuntimeBindings(s.runtime.view,sim),visuals=createNpcStatusPresentation(owner.view,()=>s.clock.now()),selection=new NpcInspectionSelection();
 const before=sim.agents.map(a=>[a,a.x,a.y,a.animator,a.state]);
 try{s.connect();await s.runtime.refresh();assert.equal(calls,1);assert.equal(owner.view.listLinked().length,20);
  items=items.map((a,i)=>i===0?linked(1,running(1)):i===1?linked(2,{recentOutcome:outcome(2,'FAILED')}):a);await s.runtime.refresh();
  assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.RUNNING);assert.equal(visuals.getForEntity(sim.agents[1]),NPC_VISUALS.FAILED);
  assert.equal(visuals.getForEntity(sim.agents[2]),NPC_VISUALS.IDLE);assert.equal(selection.read(owner.view.getForEntity(sim.agents[0])).selected.id,id(301));
  items=items.map((a,i)=>i===0?linked(1,{recentOutcome:outcome(1)}):i===2?linked(3,running(3)):a);await s.runtime.refresh();
  assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.COMPLETED);assert.equal(visuals.getForEntity(sim.agents[2]),NPC_VISUALS.RUNNING);
  assert.equal(selection.read(owner.view.getForEntity(sim.agents[0])).selected.id,id(301));
  assert.deepEqual(sim.agents.map(a=>[a,a.x,a.y,a.animator,a.state]),before);assert.equal(calls,3);
 }finally{visuals.dispose();owner.dispose();s.runtime.dispose();}
 assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);
});
test('backend outage then authoritative reconciliation recovers missed outcomes, removal and reassignment together',async()=>{
 let mode='ok',items=[linked(1,running(1)),linked(2),linked(3)];const s=setup(async()=>{if(mode==='offline')throw Error('private transport failure');return response(page(items));});
 const sim=new Simulation(),owner=createNpcRuntimeBindings(s.runtime.view,sim),visuals=createNpcStatusPresentation(owner.view,()=>s.clock.now());
 try{s.connect();await s.runtime.refresh();mode='offline';await s.runtime.refresh();assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.STALE);
  items=[linked(1,{npcId:'resident-slot-002',bindingId:id(901),recentOutcome:outcome(1)}),linked(2,{npcId:'resident-slot-001',bindingId:id(902),...running(2)})];
  mode='ok';await s.clock.advance(2000);
  assert.equal(owner.view.getForEntity(sim.agents[0]).agentId,id(2));assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.RUNNING);
  assert.equal(owner.view.getForEntity(sim.agents[1]).agentId,id(1));assert.equal(visuals.getForEntity(sim.agents[1]),NPC_VISUALS.COMPLETED);
  assert.equal(owner.view.getForEntity(sim.agents[2]).state,'UNAVAILABLE_AGENT');await s.runtime.refresh();assert.equal(owner.view.getForEntity(sim.agents[2]).state,'UNBOUND');
  assert.equal(s.runtime.getSnapshot().phase,'READY');assert.equal(sim.agents.length,4);
 }finally{visuals.dispose();owner.dispose();s.runtime.dispose();}
});
test('one uncertain missing sweep cannot reset completion suppression, and snapshots never accumulate timeline events',async()=>{
 let items=[linked(1,{recentOutcome:outcome(1)})];const s=setup(async()=>response(page(items))),sim=new Simulation(),owner=createNpcRuntimeBindings(s.runtime.view,sim),visuals=createNpcStatusPresentation(owner.view,()=>s.clock.now());
 try{s.connect();await s.runtime.refresh();assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.COMPLETED);
  await s.clock.advance(6000);assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.IDLE);
  items=[];await s.runtime.refresh();items=[linked(1,{recentOutcome:outcome(1)})];await s.runtime.refresh();assert.equal(visuals.getForEntity(sim.agents[0]),NPC_VISUALS.IDLE);
  for(let i=0;i<5;i++){await s.runtime.refresh();assert.equal(inspectionTimeline(owner.view.getForEntity(sim.agents[0])).length,1);}
 }finally{visuals.dispose();owner.dispose();s.runtime.dispose();}
});
test('a READY observer may replace authorization scope without old reconciliation mutating the new connection',async()=>{
 let calls=0,replaced=false;const s=setup(async()=>response(page([linked(++calls===1?1:2)])));
 s.runtime.subscribe(snapshot=>{if(snapshot.phase==='READY'&&!replaced){replaced=true;s.runtime.connect({...connection,token:otherToken,agentIds:[id(2)]});}});
 s.connect();await flush();await s.runtime.refresh();assert.equal(s.runtime.getAgent(id(1)),undefined);assert.ok(s.runtime.getAgent(id(2)));
 s.runtime.disconnect();assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);s.runtime.dispose();
});
test('late multi-agent responses from expired generations never restore data after scope/auth changes',async()=>{
 const old=deferred();let count=0;const s=setup(async()=>++count===1?old.promise:response(page([linked(2)])));
 s.connect();s.runtime.connect({...connection,agentIds:[id(2)]});await flush();await s.runtime.refresh();
 old.resolve(response(page([linked(1,running(1)),linked(2,{recentOutcome:outcome(2,'FAILED')})])));await flush();
 assert.equal(s.runtime.getAgent(id(1)),undefined);assert.equal(s.runtime.getAgent(id(2)).activityStatus,'IDLE');s.runtime.dispose();
});
test('failed reconciliation stays unhealthy, retry ceiling is bounded, and online hints cannot create request storms',async()=>{
 let calls=0;const s=setup(async()=>{calls++;return response({},503);});s.connect();await s.runtime.refresh();
 for(let i=0;i<15;i++){s.events.networkOnline();await s.clock.advance(30000);assert.notEqual(s.runtime.getSnapshot().phase,'READY');assert.ok(s.clock.timers.size<=1);}
 assert.ok(calls<=20);s.runtime.dispose();assert.equal(s.clock.timers.size,0);assert.equal(s.events.listeners(),0);
});
test('a cross-page binding reassignment conflict retries a fresh sweep instead of permanently suspending',async()=>{
 let coherent=false,calls=0;const s=setup(async url=>{calls++;const after=new URL(url).searchParams.has('after');
  return response(after?page([linked(2,{npcId:coherent?'resident-slot-002':'resident-slot-001'})]):page([linked(1)],id(1)));
 },{pageSize:1});
 s.connect();await s.runtime.refresh();assert.equal(s.runtime.getSnapshot().error.code,'STALE_SNAPSHOT');assert.equal(s.runtime.getSnapshot().phase,'ERROR');
 assert.deepEqual(Object.keys(s.runtime.getSnapshot().activitiesByAgentId),[]);coherent=true;await s.clock.advance(2000);
 assert.equal(s.runtime.getSnapshot().phase,'READY');assert.equal(s.runtime.getByNpc('resident-slot-001').agentId,id(1));assert.equal(s.runtime.getByNpc('resident-slot-002').agentId,id(2));
 assert.equal(calls,4);s.runtime.dispose();assert.equal(s.clock.timers.size,0);
});
