import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../dist/js/simulation.js';
import {createNpcRuntimeBindings} from '../dist/js/runtime/npc-runtime-binding.js';
import {RuntimeActivityStore} from '../dist/js/runtime/runtime-store.js';
import {normalizeActivity} from '../dist/js/runtime/validation.js';
import {createNpcStatusPresentation,visualForBinding,NPC_VISUALS} from '../dist/js/runtime/npc-status.js';
import {drawNpcStatus} from '../dist/js/runtime/npc-status-drawing.js';
import {runtimeInspectorHtml} from '../dist/js/runtime/npc-runtime-inspector.js';
import {TownRenderer} from '../dist/js/renderer.js';
import {activity,id,stamp} from './runtime-fixtures.js';
const running={activityStatus:'RUNNING',activeExecutionCount:1,currentTask:{id:id(20),status:'RUNNING',version:1},currentExecution:{id:id(30),status:'RUNNING',version:1,attemptNumber:1}};
function fixture(){
 const sim=new Simulation(),store=new RuntimeActivityStore();let time=0;
 const owner=createNpcRuntimeBindings(store,sim),presentation=createNpcStatusPresentation(owner.view,()=>time);
 const put=(patch={},n=1,slot=1)=>{const a=normalizeActivity(activity(n,{npcId:`resident-slot-${String(slot).padStart(3,'0')}`,bindingId:id(100+n),...patch}));store.commit([a],a.observedAt,stamp);};
 return {sim,store,owner,presentation,put,advance:ms=>time+=ms,visual:()=>presentation.getForEntity(sim.agents[0]),close(){presentation.dispose();owner.dispose();}};
}
const outcome=status=>({recentOutcome:{taskId:id(20),executionId:id(30),status,executionStatus:status==='COMPLETED'?'SUCCEEDED':status,finishedAt:stamp}});

test('central mapping handles current activity, availability, unknown and historical outcomes independently',()=>{
 const f=fixture();try{
  assert.equal(f.visual(),null);f.put();assert.equal(f.visual(),NPC_VISUALS.IDLE);
  f.put(running);assert.equal(f.visual(),NPC_VISUALS.RUNNING);
  f.put({activityStatus:'QUEUED',currentTask:{id:id(20),status:'QUEUED',version:1}});assert.equal(f.visual(),NPC_VISUALS.WAITING);
  f.put({activityStatus:'UNKNOWN'});assert.equal(f.visual(),NPC_VISUALS.UNKNOWN);
  f.put(outcome('FAILED'));assert.equal(f.visual(),NPC_VISUALS.FAILED);
  f.put(outcome('CANCELLED'));assert.equal(f.visual(),NPC_VISUALS.CANCELLED);
  f.put({availability:'DISABLED'});assert.equal(f.visual(),NPC_VISUALS.UNAVAILABLE);
  assert.equal(visualForBinding({...f.owner.view.getForEntity(f.sim.agents[0]),activity:{availability:'ACTIVE',activityStatus:'FUTURE'},state:'RESOLVED'}),NPC_VISUALS.UNKNOWN);
 }finally{f.close();}
});
test('completion expires monotonically without polling replay and old/future outcomes never flash',()=>{
 const f=fixture();try{
  f.put(outcome('COMPLETED'));assert.equal(f.visual(),NPC_VISUALS.COMPLETED);
  f.advance(4999);f.put(outcome('COMPLETED'));assert.equal(f.visual(),NPC_VISUALS.COMPLETED);
  f.advance(2);assert.equal(f.visual(),NPC_VISUALS.IDLE);f.put(outcome('COMPLETED'));assert.equal(f.visual(),NPC_VISUALS.IDLE);
  f.store.clear();f.put({...outcome('COMPLETED'),observedAt:'2026-10-24T12:01:00.000Z'});assert.equal(f.visual(),NPC_VISUALS.IDLE);
  f.store.clear();f.put({...outcome('COMPLETED'),observedAt:'2026-10-24T11:59:00.000Z'});assert.equal(f.visual(),NPC_VISUALS.IDLE);
 }finally{f.close();}
});
test('stale/unknown connection never claims runtime failure; recovery restores current state',()=>{
 const f=fixture();try{f.put(running);f.store.update({freshness:'stale',phase:'ERROR'});assert.equal(f.visual(),NPC_VISUALS.STALE);
  f.store.update({freshness:'unknown'});assert.equal(f.visual(),NPC_VISUALS.UNKNOWN);
  f.put(running);assert.equal(f.visual(),NPC_VISUALS.RUNNING);
  f.store.clear('AUTH_REQUIRED');assert.equal(f.visual(),null);
 }finally{f.close();}
});
test('reassignment/removal affects only matching existing entity, no new NPC and no movement mutation',()=>{
 const f=fixture();try{const before=f.sim.agents.map(a=>[a,a.x,a.y,a.state,a.animator]);
  f.put(running);assert.equal(f.presentation.getForEntity(f.sim.agents[1]),null);
  f.put(running,1,2);assert.equal(f.visual(),null);assert.equal(f.presentation.getForEntity(f.sim.agents[1]),NPC_VISUALS.RUNNING);
  f.store.commit([],stamp,stamp);assert.equal(f.presentation.getForEntity(f.sim.agents[1]),NPC_VISUALS.UNAVAILABLE);
  f.store.commit([],stamp,stamp);assert.equal(f.presentation.getForEntity(f.sim.agents[1]),null);
  f.put(running,1,20);assert.equal(f.visual(),null);assert.equal(f.sim.agents.length,4);
  assert.deepEqual(f.sim.agents.map(a=>[a,a.x,a.y,a.state,a.animator]),before);
 }finally{f.close();}
});
test('inspector escapes names and emits only contract fields, no raw failure objects or credentials',()=>{
 const f=fixture();try{f.put({...outcome('FAILED'),name:'<img src=x onerror=alert(1)>'});
  const b={...f.owner.view.getForEntity(f.sim.agents[0]),activity:{...f.owner.view.getForEntity(f.sim.agents[0]).activity,stack:'SECRET',apiKey:'SECRET',toolArguments:'SECRET'}};
  const html=runtimeInspectorHtml(b,f.visual());assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|SECRET/);assert.match(html,/Last outcome failed/);
  assert.match(html,/Last synchronized/);assert.equal(runtimeInspectorHtml(undefined,null),'');
  assert.doesNotThrow(()=>runtimeInspectorHtml({...b,activity:null},NPC_VISUALS.UNKNOWN));
 }finally{f.close();}
});
test('drawing is shape/text plus color, uses constant screen size, reduced motion, no listeners/timers',()=>{
 const calls=[];const c=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:(_,key,value)=>{calls.push([key,value]);return true;}});
 for(const v of Object.values(NPC_VISUALS)){calls.length=0;drawNpcStatus(c,v,100,80,1,true);
  if(v.status==='IDLE'){assert.equal(calls.length,0);continue;}
  assert.ok(calls.some(x=>x[0]==='rect'&&x[3]===16&&x[4]===16));assert.ok(calls.some(x=>x[0]==='fillText'&&x[1]===v.glyph));
  assert.equal(calls.at(-1)[0],'restore');if(v.status==='RUNNING')assert.ok(calls.some(x=>x[0]==='globalAlpha'&&x[1]===1));
 }
});
test('cached definitions remain stable over 10000 frame lookups; disposal removes associations',()=>{
 const f=fixture();try{f.put(running);for(let i=0;i<10000;i++)assert.equal(f.visual(),NPC_VISUALS.RUNNING);
  f.presentation.dispose();assert.equal(f.visual(),null);f.put();assert.equal(f.visual(),null);
 }finally{f.close();}
});
test('renderer skips hidden/offscreen NPCs before reading presentation and leaves selection untouched',()=>{
 let reads=0;const selected={type:'agent',id:1};
 const renderer={selected,width:500,height:500,camera:{zoom:1},screenAt:()=>({x:100,y:100}),runtimePresentation:{getForEntity(){reads++;return null;}},reducedMotion:()=>true};
 TownRenderer.prototype.drawRuntimeStatus.call(renderer,{hidden:true});assert.equal(reads,0);
 renderer.screenAt=()=>({x:-100,y:100});TownRenderer.prototype.drawRuntimeStatus.call(renderer,{hidden:false});assert.equal(reads,0);
 renderer.screenAt=()=>({x:100,y:100});TownRenderer.prototype.drawRuntimeStatus.call(renderer,{hidden:false});assert.equal(reads,1);
 assert.equal(renderer.selected,selected);
});
