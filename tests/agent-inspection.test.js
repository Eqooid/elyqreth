import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../dist/js/simulation.js';
import {createNpcRuntimeBindings} from '../dist/js/runtime/npc-runtime-binding.js';
import {RuntimeActivityStore} from '../dist/js/runtime/runtime-store.js';
import {normalizeActivity} from '../dist/js/runtime/validation.js';
import {visualForBinding} from '../dist/js/runtime/npc-status.js';
import {runtimeInspectorHtml} from '../dist/js/runtime/npc-runtime-inspector.js';
import {NpcInspectionSelection,inspectionExecutions,inspectionTimeline,inspectionConnection,recordedTimestamp} from '../dist/js/runtime/inspection-model.js';
import {activity,id,stamp} from './runtime-fixtures.js';
const outcome={taskId:id(20),executionId:id(30),status:'COMPLETED',executionStatus:'SUCCEEDED',finishedAt:stamp};
const running={activityStatus:'RUNNING',activeExecutionCount:1,currentTask:{id:id(21),status:'RUNNING',version:1},currentExecution:{id:id(31),status:'RUNNING',version:1,attemptNumber:2},
 recentOutcome:outcome,lastExecution:{id:id(31),taskId:id(21),status:'RUNNING'}};
function fixture(){const sim=new Simulation(),store=new RuntimeActivityStore(),owner=createNpcRuntimeBindings(store,sim),selection=new NpcInspectionSelection();
 const put=(patch={},n=1)=>store.commit([normalizeActivity(activity(n,{npcId:`resident-slot-00${n}`,bindingId:id(100+n),...patch}))],stamp,stamp);
 const binding=()=>owner.view.getForEntity(sim.agents[0]);
 return {sim,store,owner,selection,put,binding,html:()=>runtimeInspectorHtml(binding(),visualForBinding(binding()),selection,store.getSnapshot()),close:()=>owner.dispose()};
}
test('Agent details use T05 object identity and T04 authoritative projection; unbound inspection has no empty runtime section',()=>{
 const f=fixture();try{assert.equal(f.html(),'');f.put({name:'Registered Ada'});const html=f.html();assert.match(html,/Agent Details/);assert.match(html,/Registered Ada/);assert.match(html,/resident-slot-001/);
  assert.match(html,/RULE_BASED/);assert.equal(f.owner.view.getForEntity({...f.sim.agents[0]}),undefined);assert.equal(f.sim.agents.length,4);
 }finally{f.close();}
});
test('current execution exposes task versus execution state, attempt number and accurate missing timestamp/duration disclosure',()=>{
 const f=fixture();try{f.put(running);const model=f.selection.read(f.binding()),html=f.html();assert.equal(model.selected.id,id(31));assert.equal(model.selected.attemptNumber,2);
  assert.match(html,/Execution status/);assert.match(html,/Task status/);assert.match(html,/Attempt number/);assert.match(html,/elapsed time, completed duration/);
  assert.equal(model.selected.finishedAt,null);assert.equal(recordedTimestamp(undefined),null);assert.equal(recordedTimestamp('bad'),null);assert.equal(recordedTimestamp(stamp),stamp);
 }finally{f.close();}
});
test('reference list is deduplicated and bounded to three, ordered current/latest/outcome without invented chronological ordering',()=>{
 const f=fixture();try{f.put({...running,lastExecution:{id:id(32),taskId:id(22),status:'PENDING'}});const rows=inspectionExecutions(f.binding());
  assert.deepEqual(rows.map(e=>e.id),[id(31),id(32),id(30)]);assert.ok(Object.isFrozen(rows));
  f.put({...running,lastExecution:{id:id(30),taskId:id(20),status:'SUCCEEDED'}});assert.equal(inspectionExecutions(f.binding()).length,2);
  assert.match(f.html(),/not full execution history/);
 }finally{f.close();}
});
test('historical selection persists across authoritative refresh, updates status, and never retains vanished references',()=>{
 const f=fixture();try{f.put(running);assert.equal(f.selection.select(f.binding(),id(30)),true);assert.equal(f.selection.read(f.binding()).selected.id,id(30));
  f.put({...running,observedAt:'2026-10-24T12:00:02.000Z'});assert.equal(f.selection.read(f.binding()).selected.id,id(30));
  assert.match(f.html(),/Recorded execution succeeded/);assert.match(f.html(),/Result content is not disclosed/);
  assert.equal(f.selection.select(f.binding(),id(999)),false);f.put({...running,recentOutcome:null});assert.equal(f.selection.read(f.binding()).selected.id,id(31));
 }finally{f.close();}
});
test('scope switch, unbinding and authorization expiry erase prior inspection selection without cross-Agent data',()=>{
 const f=fixture();try{f.put(running);f.selection.select(f.binding(),id(30));f.put({},2);
  const second=f.owner.view.getForEntity(f.sim.agents[1]);assert.equal(f.selection.read(second).selected,null);
  assert.equal(f.html().includes(id(30)),false);f.store.clear('AUTH_REQUIRED');assert.equal(f.html(),'');
  assert.equal(f.selection.read(f.binding()).selected,null);
  const staleBinding={state:'RESOLVED',activity:activity(),freshness:'fresh'};
  assert.equal(runtimeInspectorHtml(staleBinding,{label:'Idle'},f.selection,{phase:'AUTH_REQUIRED'}),'');
 }finally{f.close();}
});
test('latest recorded outcome timeline uses exactly one backend fact; repeat polls never duplicate or fabricate audit events',()=>{
 const f=fixture();try{f.put({recentOutcome:outcome,lastExecution:{id:id(30),taskId:id(20),status:'SUCCEEDED'}});
  const first=inspectionTimeline(f.binding());for(let i=0;i<10;i++){f.put({recentOutcome:outcome});assert.equal(inspectionTimeline(f.binding()).length,1);assert.equal(inspectionTimeline(f.binding())[0].key,first[0].key);}
  assert.equal(first[0].label,'Task completed');assert.equal(first[0].time,stamp);assert.match(f.html(),/full audit history and tool events are not available/);
  const b=f.binding();assert.equal(inspectionTimeline({...b,activity:{...b.activity,recentOutcome:{...outcome,status:'FUTURE'}}})[0].label,'Task outcome unknown');
  assert.equal(inspectionTimeline({...b,activity:{...b.activity,recentOutcome:{...outcome,finishedAt:'invalid'}}}).length,0);
 }finally{f.close();}
});
test('failures/timed out/cancelled are safe status summaries, missing records and unknown states remain explicit',()=>{
 const f=fixture();try{for(const status of ['FAILED','TIMED_OUT','CANCELLED']){f.put({recentOutcome:{...outcome,status:status==='TIMED_OUT'?'FAILED':status,executionStatus:status}});assert.match(f.html(),/Recorded execution (failed|timed out|was cancelled)/);}
  f.put();assert.match(f.html(),/No execution reference is available/);assert.match(f.html(),/No timestamped outcome is available/);
  f.put(running);const b=f.binding(),unknown={...b,activity:{...b.activity,currentExecution:{...b.activity.currentExecution,status:'FUTURE'}}};
  assert.equal(inspectionExecutions(unknown)[0].status,'UNKNOWN');
 }finally{f.close();}
});
test('connection states remain distinct from execution failures, recover through T04 updates, and retain no subscriptions',()=>{
 const f=fixture();try{f.put(running);f.store.update({phase:'ERROR',freshness:'stale',error:{code:'NETWORK',message:'internal secret'}});
  assert.match(f.html(),/Runtime synchronization unavailable/);assert.doesNotMatch(f.html(),/internal secret|Recorded execution failed/);
  f.put(running);assert.match(f.html(),/Freshly synchronized/);
  assert.match(inspectionConnection({loading:true},f.binding()),/Loading/);assert.match(inspectionConnection({phase:'PAUSED'},f.binding()),/paused/);
  assert.match(inspectionConnection({error:{code:'FORBIDDEN'}},f.binding()),/Authorization/);f.selection.clear();
 }finally{f.close();}
});
test('all remote text is escaped, unexpected sensitive fields ignored, and no execution controls are rendered',()=>{
 const f=fixture();try{f.put({...running,name:'<script>SECRET()</script>'});const b=f.binding();
  const html=runtimeInspectorHtml({...b,activity:{...b.activity,result:'PRIVATE_RESULT',apiKey:'PRIVATE_KEY',stack:'PRIVATE_STACK',prompt:'PRIVATE_PROMPT'}},visualForBinding(b),f.selection,f.store.getSnapshot());
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|PRIVATE_|data-runtime-(execute|cancel)|Start execution|Cancel execution/);
 }finally{f.close();}
});
test('a previously inspected association shows only a generic authorization notice after revocation',()=>{
 const f=fixture();try{f.put(running);f.html();f.store.clear('AUTH_REQUIRED');const html=f.html();
  assert.match(html,/Runtime authorization unavailable/);assert.doesNotMatch(html,/00000000|Agent 1|RUNNING|runtime-inspection/);
  f.selection.clear();assert.equal(f.html(),'');
 }finally{f.close();}
});
