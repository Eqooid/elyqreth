import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {Simulation} from '../dist/js/simulation.js';
import {Citizens} from '../dist/js/citizens.js';
import {NPC_IDS} from '../dist/js/npc-identity.js';
import {NpcIdentityRegistry} from '../dist/js/runtime/npc-registry.js';
import {createNpcRuntimeBindings} from '../dist/js/runtime/npc-runtime-binding.js';
import {RuntimeActivityStore} from '../dist/js/runtime/runtime-store.js';
import {createRuntimeIntegration} from '../dist/js/runtime/index.js';
import {normalizeActivity} from '../dist/js/runtime/validation.js';
import {id,token,otherToken,stamp,activity,page,response,deferred,flush,FakeClock,browserEvents} from './runtime-fixtures.js';
const linked=(n=1,slot=NPC_IDS[n-1],patch={})=>normalizeActivity(activity(n,{npcId:slot,bindingId:id(n+100),...patch}));
function runtime(){const store=new RuntimeActivityStore();const view=Object.freeze({getSnapshot:()=>store.getSnapshot(),getAgent:id=>store.getAgent(id),getByNpc:id=>store.getByNpc(id),subscribe:fn=>store.subscribe(fn)});return {store,view,hydrate:items=>store.commit(items,stamp,stamp)};}
function entity(number,slot=null,patch={}){const e={id:number,...patch};Object.defineProperty(e,'npcId',{value:slot,enumerable:true,writable:false,configurable:false});return e;}
function source(rows=[]){const listeners=new Set();let reads=0;return {rows,listeners,getResidents(){reads++;return this.rows;},subscribeResidents(fn){listeners.add(fn);fn();return ()=>listeners.delete(fn);},
 replace(next){this.rows=next;for(const fn of [...listeners])fn();},get reads(){return reads;}};}
function fixture(){const sim=new Simulation(),state=runtime(),owner=createNpcRuntimeBindings(state.view,sim);return {sim,...state,owner,view:owner.view};}

test('NPC bindings resolve both directions from stable slot IDs, never names, positions, appearance or local Agent metadata',()=>{
 const f=fixture();try{
  const a=linked(1,NPC_IDS[0],{name:'Mika'});f.hydrate([a]);const npc=f.sim.agents[0],resolved=f.view.getByAgent(id(1));
  assert.equal(npc.name,'Ada');assert.equal(resolved.state,'RESOLVED');assert.equal(resolved.npc.entityId,npc.id);
  assert.equal(f.view.getForEntity(npc),resolved);assert.equal(f.view.getByNpc(NPC_IDS[0]),resolved);assert.equal(f.view.getActivityForNpc(NPC_IDS[0]),a);
  assert.equal(f.view.isLinked(NPC_IDS[0]),true);assert.equal(f.view.listLinked().length,1);assert.ok(Object.isFrozen(resolved));
  npc.name='Different';npc.agentId=id(99);npc.bindingId=id(999);assert.equal(f.view.getForEntity(npc).agentId,id(1));
  assert.equal(f.view.getForEntity({...npc}),undefined);assert.equal(f.view.getByAgent(id(88)),undefined);assert.equal(f.view.getByAgent('__proto__'),undefined);
 }finally{f.owner.dispose();}
});
test('ordinary and decorative residents remain unbound and binding operations never mutate movement or create entities',()=>{
 const f=fixture();try{
  const citizens=new Citizens(f.sim.map,f.sim.agents),before=citizens.allPeople.map(p=>({p,x:p.x,y:p.y,state:p.state}));
  const positions=f.sim.agents.map(a=>({a,x:a.x,y:a.y,state:a.state}));f.hydrate([linked()]);
  assert.equal(f.view.getForEntity(f.sim.agents[1]).state,'UNBOUND');assert.equal(f.view.isLinked(NPC_IDS[1]),false);
  for(const {p,x,y,state} of before){assert.equal(f.view.getForEntity(p),undefined);assert.equal(p.x,x);assert.equal(p.y,y);assert.equal(p.state,state);}
  for(const {a,x,y,state} of positions){assert.equal(a.x,x);assert.equal(a.y,y);assert.equal(a.state,state);}
  assert.equal(f.sim.agents.length,4);assert.equal(f.sim.nextId,5);assert.equal(citizens.allPeople.length,before.length);
 }finally{f.owner.dispose();}
});
test('Agent without binding is UNBOUND; bound Agent without an existing NPC stays unresolved without spawning',()=>{
 const f=fixture();try{
  const unbound=normalizeActivity(activity(2));f.hydrate([linked(1,NPC_IDS[4]),unbound]);
  assert.equal(f.view.getByAgent(id(1)).state,'UNRESOLVED_NPC');assert.equal(f.view.getByAgent(id(1)).npc,null);
  assert.equal(f.view.getByAgent(id(1)).activity.agentId,id(1));assert.equal(f.view.getByAgent(id(2)).state,'UNBOUND');
  assert.equal(f.view.getByNpc(NPC_IDS[4]).reason,'NPC_NOT_PRESENT');assert.equal(f.view.getByNpc('resident-slot-020'),undefined);
  assert.equal(f.sim.agents.length,4);assert.equal(f.view.listLinked().length,0);
 }finally{f.owner.dispose();}
});
test('repeated hydration and unchanged NPC refresh preserve record references and never reconstruct residents',()=>{
 const f=fixture();try{
  f.hydrate([linked()]);const one=f.view.getByAgent(id(1)),residents=[...f.sim.agents];
  for(let i=0;i<10;i++){f.hydrate([linked()]);f.owner.reconcileNpcs();assert.equal(f.view.getByAgent(id(1)),one);}
  assert.deepEqual(f.sim.agents,residents);assert.equal(f.sim.nextId,5);
 }finally{f.owner.dispose();}
});
test('NPC removal immediately unresolves the binding, and explicit existing-lifecycle recreation reattaches the same stable identity',()=>{
 const f=fixture();try{
  const a=linked();f.hydrate([a]);const original=f.sim.agents[0];f.sim.removeAgent(original.id);
  assert.equal(f.sim.agents.length,3);assert.equal(f.view.getByAgent(id(1)).state,'UNRESOLVED_NPC');assert.equal(f.view.getForEntity(original),undefined);
  f.hydrate([a]);assert.equal(f.sim.agents.length,3);
  const replacement=f.sim.addAgent('Explicit replacement',original.role,original.workplace,false,undefined,original.appearance,NPC_IDS[0]);
  assert.ok(replacement);assert.notEqual(replacement.id,original.id);assert.equal(f.view.getByAgent(id(1)).npc.entityId,replacement.id);
  assert.equal(f.view.getForEntity(replacement).bindingId,a.bindingId);assert.equal(f.sim.agents.length,4);
 }finally{f.owner.dispose();}
});
test('pending and confirmed Agent removal revoke lookup without confusing temporary failure with deletion',()=>{
 const f=fixture();try{
  f.hydrate([linked()]);f.store.update({phase:'ERROR',error:{code:'NETWORK',message:'Runtime connection is unavailable.'},stale:true,freshness:'stale'});
  assert.equal(f.view.getByAgent(id(1)).state,'RESOLVED');assert.equal(f.view.getByAgent(id(1)).freshness,'stale');
  f.hydrate([]);assert.equal(f.view.getByAgent(id(1)),undefined);const pending=f.view.getByNpc(NPC_IDS[0]);
  assert.equal(pending.state,'UNAVAILABLE_AGENT');assert.equal(pending.agentId,null);assert.equal(pending.activity,null);
  f.hydrate([]);assert.equal(f.view.getByNpc(NPC_IDS[0]).state,'UNBOUND');assert.equal(f.view.isLinked(NPC_IDS[0]),false);
 }finally{f.owner.dispose();}
});
test('binding removal/reassignment replaces only the association, even while T04 retains a pending old record',()=>{
 const f=fixture();try{
  f.hydrate([linked()]);const npc=f.sim.agents[0];f.hydrate([linked(2,NPC_IDS[0])]);
  assert.equal(f.view.getByAgent(id(1)),undefined);assert.equal(f.view.getForEntity(npc).agentId,id(2));assert.equal(f.view.listLinked().length,1);
  assert.equal(f.sim.agents[0],npc);f.hydrate([normalizeActivity(activity(2))]);assert.equal(f.view.getForEntity(npc).state,'UNBOUND');
  assert.equal(f.view.getByAgent(id(2)).state,'UNBOUND');assert.equal(f.sim.agents.length,4);
 }finally{f.owner.dispose();}
});
test('backend UNKNOWN activity and client stale/unknown freshness remain separate from resolved identity',()=>{
 const f=fixture();try{
  const a=linked(1,NPC_IDS[0],{activityStatus:'UNKNOWN',requiresAttention:true,statusReason:'LEASE_UNVERIFIED'});f.hydrate([a]);
  assert.equal(f.view.getByAgent(id(1)).state,'RESOLVED');assert.equal(f.view.getActivityForNpc(NPC_IDS[0]).activityStatus,'UNKNOWN');
  f.store.update({freshness:'unknown',stale:true});const binding=f.view.getByAgent(id(1));
  assert.equal(binding.state,'RESOLVED');assert.equal(binding.freshness,'unknown');assert.equal(binding.observedAt,a.observedAt);
  assert.equal(f.view.getSnapshot().runtime,f.store.getSnapshot());assert.equal(binding.activity,a);
 }finally{f.owner.dispose();}
});
test('auth/identity scope clear drops all former associations immediately; fresh hydration restores only the new authorized tuple',()=>{
 const f=fixture();try{
  f.hydrate([linked()]);f.store.clear('AUTH_REQUIRED',{code:'AUTH_REQUIRED',message:'Authentication required.'});
  assert.equal(f.view.getByAgent(id(1)),undefined);assert.equal(f.view.getForEntity(f.sim.agents[0]).agentId,null);
  assert.ok(!JSON.stringify(f.view.getSnapshot()).includes(id(1)));f.hydrate([linked(2,NPC_IDS[0])]);assert.equal(f.view.getByNpc(NPC_IDS[0]).agentId,id(2));
 }finally{f.owner.dispose();}
});
test('duplicate Agent binding IDs and duplicate NPC slot assignments fail closed for every contender independent of input order',()=>{
 for(const duplicates of [[linked(1,NPC_IDS[0]),linked(2,NPC_IDS[0])],[linked(1,NPC_IDS[0]),linked(2,NPC_IDS[1],{bindingId:id(101)})]]){
  for(const input of [duplicates,[...duplicates].reverse()]){
   const f=fixture();try{f.hydrate(input);assert.equal(f.view.listLinked().length,0);
    for(const a of input){assert.equal(f.view.getByAgent(a.agentId).state,'UNKNOWN');assert.equal(f.view.getByAgent(a.agentId).activity,null);assert.equal(f.view.getByNpc(a.npcId).agentId,null);}
   }finally{f.owner.dispose();}
  }
 }
});
test('duplicate stable NPC IDs or numeric entity IDs cannot arbitrarily resolve to one resident',()=>{
 for(const rows of [[entity(1,NPC_IDS[0]),entity(2,NPC_IDS[0])],[entity(1,NPC_IDS[0]),entity(1,NPC_IDS[1])]]){
  const s=source(rows),r=runtime(),owner=createNpcRuntimeBindings(r.view,s);try{
   r.hydrate([linked(1,NPC_IDS[0]),linked(2,NPC_IDS[1])]);assert.equal(owner.view.getByAgent(id(1)).state,'UNKNOWN');
   assert.equal(owner.view.isLinked(NPC_IDS[0]),false);assert.equal(owner.view.getActivityForNpc(NPC_IDS[0]),undefined);
  }finally{owner.dispose();assert.equal(s.listeners.size,0);}
 }
});
test('malformed binding tuples and mismatched Agent keys cannot override an authorized slot or restore an old association',()=>{
 const f=fixture();try{
  f.hydrate([linked()]);const bad={...linked(),bindingId:'invalid'};
  f.hydrate([bad,linked(2,NPC_IDS[0])]);assert.equal(f.view.listLinked().length,0);assert.equal(f.view.getByNpc(NPC_IDS[0]).state,'UNKNOWN');
  assert.equal(f.view.getByAgent(id(1)).reason,'INVALID_BINDING');assert.equal(f.view.getByAgent(id(2)).state,'UNKNOWN');
  f.store.update({activitiesByAgentId:Object.freeze({[id(99)]:linked()})});
  assert.equal(f.view.getByAgent(id(99)),undefined);assert.equal(f.view.getByAgent(id(1)),undefined);assert.equal(f.view.getByNpc(NPC_IDS[0]).state,'UNBOUND');
 }finally{f.owner.dispose();}
});
test('mutable/spoofed NPC metadata and decorative impostors cannot grant Agent associations',()=>{
 const mutable={id:1,npcId:NPC_IDS[0],agentId:id(1)},decorative=entity(9999,NPC_IDS[0],{decorative:true}),s=source([mutable,decorative]);
 const r=runtime(),owner=createNpcRuntimeBindings(r.view,s);try{
  r.hydrate([linked()]);assert.equal(owner.view.getByAgent(id(1)).state,'UNRESOLVED_NPC');assert.equal(owner.view.getForEntity(mutable).state,'UNBOUND');
  assert.equal(owner.view.getForEntity(decorative),undefined);assert.equal(owner.view.getForEntity(entity(1,NPC_IDS[0])),undefined);
 }finally{owner.dispose();}
});
test('reload reconstructs numeric residents while stable Agent/NPC/binding identity remains the same',()=>{
 const r=runtime(),first=new Simulation();r.hydrate([linked()]);const one=createNpcRuntimeBindings(r.view,first);
 const original=first.agents[0];first.removeAgent(original.id);const recreated=first.addAgent('Reload fixture',original.role,original.workplace,false,undefined,original.appearance,NPC_IDS[0]);
 const before=one.view.getByAgent(id(1));assert.equal(before.npc.entityId,recreated.id);one.dispose();
 const second=new Simulation(),two=createNpcRuntimeBindings(r.view,second);try{
  const after=two.view.getByAgent(id(1));assert.notEqual(after.npc.entityId,before.npc.entityId);
  for(const key of ['agentId','npcId','bindingId'])assert.equal(after[key],before[key]);assert.equal(second.agents.length,4);
 }finally{two.dispose();}
});
test('movement/mission updates never reindex NPCs or reconstruct binding state; explicit identity events do',()=>{
 const sim=new Simulation(),original=sim.getResidents.bind(sim);let reads=0;sim.getResidents=()=>{reads++;return original();};
 const r=runtime(),owner=createNpcRuntimeBindings(r.view,sim);try{
  r.hydrate([linked()]);const snapshot=owner.view.getSnapshot(),initial=reads;
  for(let i=0;i<300;i++)sim.update(1/30);for(let i=0;i<10000;i++)owner.view.getForEntity(sim.agents[0]);
  assert.equal(reads,initial);assert.equal(owner.view.getSnapshot(),snapshot);
  const ref=sim.agents[1];sim.removeAgent(ref.id);assert.ok(reads>initial);assert.equal(owner.view.getByAgent(id(1)).state,'RESOLVED');
 }finally{owner.dispose();}
});
test('T04 controller feeds bindings without another poller and old transport generations cannot restore revoked associations',async()=>{
 const clock=new FakeClock(),events=browserEvents(),late=deferred();let requests=0;
 const integration=createRuntimeIntegration({timers:clock,clock,...events,random:()=>.5,fetchImpl:async()=>{
  requests++;if(requests===2)return late.promise;return response(page([requests===1?linked():linked(2,NPC_IDS[0])]));
 }}),sim=new Simulation(),owner=createNpcRuntimeBindings(integration.view,sim);
 try{
  assert.equal(requests,0);integration.connect({baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',token});await integration.refresh();
  assert.equal(requests,1);assert.equal(owner.view.getByNpc(NPC_IDS[0]).agentId,id(1));
  const extra=owner.view.subscribe(()=>{});await clock.advance(1999);assert.equal(requests,1);extra();
  const pending=integration.refresh();await flush();assert.equal(requests,2);
  integration.connect({baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',token:otherToken,agentIds:[id(2)]});
  assert.equal(owner.view.getByAgent(id(1)),undefined);await pending;await flush();
  assert.equal(owner.view.getForEntity(sim.agents[0]).agentId,id(2));late.resolve(response(page([linked()])));await flush();
  assert.equal(owner.view.getByNpc(NPC_IDS[0]).agentId,id(2));assert.equal(sim.agents.length,4);
 }finally{owner.dispose();integration.dispose();late.resolve(response(page()));await flush();assert.equal(clock.timers.size,0);assert.equal(events.listeners(),0);}
});
test('temporary backend outage and reconnect preserve a stale association without changing runtime identity',async()=>{
 const clock=new FakeClock(),events=browserEvents();let outage=false,calls=0;
 const integration=createRuntimeIntegration({timers:clock,clock,...events,random:()=>.5,fetchImpl:async()=>{calls++;if(outage)return response({},503);return response(page([linked()]));}});
 const sim=new Simulation(),owner=createNpcRuntimeBindings(integration.view,sim);try{
  integration.connect({baseUrl:'http://127.0.0.1:3001',pageOrigin:'http://127.0.0.1:5173',token});await integration.refresh();outage=true;
  await integration.refresh();const stale=owner.view.getByAgent(id(1));assert.equal(stale.state,'RESOLVED');assert.equal(stale.freshness,'stale');
  outage=false;await clock.advance(2000);assert.equal(owner.view.getByAgent(id(1)).freshness,'fresh');assert.equal(owner.view.getByAgent(id(1)).bindingId,stale.bindingId);assert.equal(calls,3);
 }finally{owner.dispose();integration.dispose();}
});
test('dispose releases subscriptions and redacts retained facades; observer exceptions do not break existing lifecycle behavior',()=>{
 const s=source([entity(1,NPC_IDS[0])]),r=runtime(),owner=createNpcRuntimeBindings(r.view,s);r.hydrate([linked()]);let updates=0;
 owner.view.subscribe(()=>{throw Error('observer');});owner.view.subscribe(()=>updates++);r.hydrate([linked(1,NPC_IDS[0],{agentVersion:2})]);assert.equal(updates,2);
 owner.dispose();assert.equal(s.listeners.size,0);assert.equal(owner.view.getSnapshot().disposed,true);assert.equal(owner.view.listLinked().length,0);
 assert.ok(!JSON.stringify(owner.view.getSnapshot()).includes(id(1)));r.hydrate([linked(1,NPC_IDS[0],{agentVersion:3})]);s.replace([]);assert.equal(updates,2);
 const sim=new Simulation();sim.subscribeResidents(()=>{throw Error('observer');});const before=sim.agents.length;
 const a=sim.addAgent('Still works',sim.agents[0].role,sim.agents[0].workplace,false);assert.equal(sim.agents.length,before+1);sim.removeAgent(a.id);assert.equal(sim.agents.length,before);
});
test('indexed local reconciliation/lookup observations for 1/5/20 linked and 100 total residents stay bounded without per-NPC requests',()=>{
 const measurements=[];
 for(const [count,total] of [[1,1],[5,5],[20,20],[20,100]]){
  const s=source(Array.from({length:total},(_,i)=>entity(i+1,i<count?NPC_IDS[i]:null))),r=runtime(),owner=createNpcRuntimeBindings(r.view,s);
  try{
   const start=performance.now();r.hydrate(Array.from({length:count},(_,i)=>linked(i+1)));const reconcileMs=performance.now()-start;
   const reads=s.reads,lookupStart=performance.now();for(let i=0;i<10000;i++)assert.equal(owner.view.getForEntity(s.rows[i%total]).state,i%total<count?'RESOLVED':'UNBOUND');
   const lookupMs=performance.now()-lookupStart;assert.equal(s.reads,reads);assert.equal(owner.view.listLinked().length,count);
   measurements.push({linked:count,residents:total,reconcileMs:Number(reconcileMs.toFixed(3)),lookups:10000,lookupMs:Number(lookupMs.toFixed(3)),sourceReadsDuringLookups:s.reads-reads});
  }finally{owner.dispose();}
 }
 console.log(JSON.stringify({npcBindingObservations:measurements,limit:'20 catalog slots; 100 linked is not supported or claimed',kind:'local indexing only, not rendering benchmark'}));
});
