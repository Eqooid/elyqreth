import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeActivity} from '../dist/js/runtime/validation.js';
import {RuntimeActivityStore} from '../dist/js/runtime/runtime-store.js';
import {createNpcRuntimeBindings} from '../dist/js/runtime/npc-runtime-binding.js';
import {visualForBinding} from '../dist/js/runtime/npc-status.js';
import {runtimeInspectorHtml} from '../dist/js/runtime/npc-runtime-inspector.js';
import {Simulation} from '../dist/js/simulation.js';
import {activity,id,stamp} from './runtime-fixtures.js';
const external={source:'Hermes',connectionId:id(10),connectionName:'Configured Hermes connection',externalAgentId:'configured-researcher',
 externalExecutionId:'run_'+'a'.repeat(32),mappingId:id(11),version:2,status:'RUNNING',sourceStatus:'running',observedAt:stamp,lastSynchronizedAt:stamp,
 freshness:'RECENT_OBSERVATION',connectionHealth:'UNKNOWN'};
function value(patch={}){return normalizeActivity(activity(1,{agentType:'EXTERNAL',activityStatus:'UNKNOWN',statusReason:'EXTERNAL_LIVENESS_UNVERIFIED',
 npcId:'resident-slot-001',bindingId:id(12),externalObservation:{...external,...patch}}));}
test('configured Hermes observation uses existing NPC identity and renders state without native executions',()=>{
 const sim=new Simulation(),store=new RuntimeActivityStore(),bindings=createNpcRuntimeBindings(store,sim),before=sim.agents.map(a=>[a,a.x,a.y,a.state]);
 try{for(const [patch,expected] of [[{},'RUNNING'],[{sourceStatus:'waiting_for_approval'},'WAITING'],[{status:'QUEUED',sourceStatus:'queued'},'WAITING'],
 [{status:'FAILED',sourceStatus:'failed'},'FAILED'],[{status:'COMPLETED',sourceStatus:'completed'},'COMPLETED'],[{status:'UNKNOWN',sourceStatus:'interrupted'},'UNKNOWN'],
 [{sourceStatus:'stopping'},'UNKNOWN'],[{freshness:'STALE'},'STALE'],[{freshness:'RETIRED'},'UNKNOWN']]){
 store.commit([value(patch)],stamp,stamp);const binding=bindings.view.getForEntity(sim.agents[0]);assert.equal(visualForBinding(binding).status,expected);
 assert.equal(binding.activity.currentTask,null);assert.equal(binding.activity.currentExecution,null);assert.equal(bindings.view.listLinked().length,1);}
 assert.deepEqual(sim.agents.map(a=>[a,a.x,a.y,a.state]),before);
 }finally{bindings.dispose();}
});
test('Hermes inspector discloses configured identity provenance freshness and safe run status with escaped names',()=>{
 const sim=new Simulation(),store=new RuntimeActivityStore(),bindings=createNpcRuntimeBindings(store,sim);
 try{store.commit([value({connectionName:'<script>connection</script>',privatePayload:'sensitive-marker'})],stamp,stamp);
 const binding=bindings.view.getForEntity(sim.agents[0]),html=runtimeInspectorHtml(binding,visualForBinding(binding));
 for(const text of ['Hermes','configured-researcher','External Agent ID (configured)','Last external synchronization','UNKNOWN','&lt;script&gt;'])assert.ok(html.includes(text));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('sensitive-marker'));store.clear('AUTH_REQUIRED');assert.equal(bindings.view.listLinked().length,0);
 }finally{bindings.dispose();}
});
test('Hermes reconnect preserves one association while stale versions and native identity injection fail',()=>{
 const store=new RuntimeActivityStore(),sim=new Simulation(),bindings=createNpcRuntimeBindings(store,sim);
 try{store.commit([value()],stamp,stamp);const first=bindings.view.getForEntity(sim.agents[0]).bindingId;
 store.update({freshness:'stale'});assert.equal(visualForBinding(bindings.view.getForEntity(sim.agents[0])).status,'STALE');
 store.commit([value({version:3})],stamp,stamp);assert.equal(bindings.view.getForEntity(sim.agents[0]).bindingId,first);assert.equal(bindings.view.listLinked().length,1);
 assert.throws(()=>store.commit([value({version:2})],stamp,stamp),e=>e.code==='STALE_SNAPSHOT');
 assert.throws(()=>normalizeActivity({...value(),agentType:'LLM'}),e=>e.code==='SCHEMA');
 }finally{bindings.dispose();}
});
