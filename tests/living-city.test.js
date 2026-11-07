import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../dist/js/simulation.js';
import {INTERACTION_POINTS,PARK_SEATS,PARK_BENCHES,READING_ACTIVITY,SHOPPING_ACTIVITY,REST_ACTIVITY,HOME_LOCATIONS,CAFE_SEATS,COFFEE_ACTIVITY} from '../dist/js/locations.js';
import {findPath} from '../dist/js/pathfinding.js';
import {CityClock,utility,bedtime} from '../dist/js/life.js';
import {Citizens} from '../dist/js/citizens.js';
import {TrafficSystem} from '../dist/js/traffic.js';
import {Camera} from '../dist/js/camera.js';
import {center} from '../dist/js/world.js';
import {STATE,setState} from '../dist/js/agent-state.js';
const advance=(s,predicate,seconds=200)=>{for(let i=0;i<seconds*30&&!predicate();i++)s.update(1/30);assert.ok(predicate(),JSON.stringify({phase:s.phase,states:s.agents.map(a=>a.state)}));};
function seeded(seed,run){const original=Math.random;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);try{run();}finally{Math.random=original;}}

test('all three benches, market and shared residences have accessible distinct interaction anchors',()=>{
 const s=new Simulation();assert.equal(PARK_BENCHES.length,3);assert.equal(PARK_SEATS.length,6);assert.equal(new Set(INTERACTION_POINTS.map(p=>p.id)).size,INTERACTION_POINTS.length);
 for(const point of INTERACTION_POINTS){assert.ok(s.map.canStand(point.position.x,point.position.y),point.id);const path=findPath(s.map,s.agents[0],point.approachCell||point.interactionCell);assert.ok(path.length,point.id);assert.ok(path.every(p=>s.map.canStand(p.x,p.y)));}
 for(const home of HOME_LOCATIONS)assert.ok(s.map.isWalkable(home.exit.col,home.exit.row));
});

test('two full days produce varied routines, visible reading poses, stable indoor identities and released reservations',()=>seeded(5,()=>{
 const s=new Simulation(),seen=new Set(),ids=s.agents.map(a=>a.id),poses=new Set();
 for(let i=0;i<1600*30;i++){
  const before=s.agents.map(a=>({x:a.x,y:a.y}));s.update(1/30);const leases=[...s.activities.reservations.reservations.values()];assert.equal(new Set(leases.map(r=>r.ownerId)).size,leases.length);
  s.agents.forEach((a,n)=>{seen.add(a.state);assert.equal(a.workStatus,'Idle');assert.ok(s.map.canStand(a.x,a.y));assert.ok(Math.hypot(a.x-before[n].x,a.y-before[n].y)<=a.speed/30+.01);if(a.hidden){assert.ok([STATE.SHOPPING,STATE.RESTING,STATE.PUTTING_AWAY_PURCHASES].includes(a.state));assert.equal(a.path.length,0);}if(a.activity?.definitionId==='reading'&&a.state===STATE.READING){const p=PARK_SEATS.find(p=>p.id===a.activity.pointId);assert.deepEqual({x:a.x,y:a.y},p.position);poses.add(s.activities.pose(a).frame);}for(const value of Object.values(a.needs))assert.ok(value>=0&&value<=100);});
 }
 for(const state of ['DRINKING_COFFEE','READING','RELAXING','SHOPPING','RESTING','GREETING','WAVING'])assert.ok(seen.has(state),state);assert.ok(poses.size>=2);
 assert.ok(s.clock.day>=3);for(const id of ['coffee','reading','shopping','rest'])assert.ok(s.activities.stats.byActivity[id].completed>=3,id);assert.ok(s.activities.stats.encounters>=1);assert.equal(s.activities.stats.routeFailures,0);assert.deepEqual(s.agents.map(a=>a.id),ids);
 s.reset();assert.equal(s.activities.reservations.reservations.size,0);assert.equal(s.activities.sessions.size,0);assert.ok(s.agents.every(a=>!a.hidden&&!a.activity));
}));

test('work interrupts park navigation/reading, market entry/shopping and home navigation/rest without teleporting',()=>{
 for(const [def,targets] of [[READING_ACTIVITY,['WALKING_TO_PARK','READING','RELAXING']],[SHOPPING_ACTIVITY,['WALKING_TO_MARKET','ENTERING_MARKET','SHOPPING']],[REST_ACTIVITY,['WALKING_HOME','RESTING']]])for(const target of targets){
  const s=new Simulation(),a=s.agents[0];s.activities.definitions=[{...def,chance:0}];s.activities.actors=s.agents;assert.ok(s.activities.tryStart(a,s.activities.definitions[0],true,{outcome:'household'}));advance(s,()=>a.state===target);const position={x:a.x,y:a.y},id=a.id;
  s.start('Interrupt daily life');s.assignNext();assert.equal(a.id,id);assert.equal(a.activity,null);assert.equal(a.hidden,false);assert.equal(a.shoppingBagRemaining,0);assert.deepEqual({x:a.x,y:a.y},position);assert.equal(a.workStatus,'Assigned');assert.ok([...s.activities.reservations.reservations.values()].every(r=>r.ownerId!==id));
  advance(s,()=>s.phase==='complete',600);assert.equal(s.progress,1);assert.equal(a.workStatus,'Idle');assert.ok([...s.activities.reservations.reservations.values()].every(r=>s.agents.some(a=>a.id===r.ownerId)));s.reset();assert.equal(s.activities.reservations.reservations.size,0);
 }
});

test('mutually agreed encounters avoid conflicts, repeat pairs and road choke points; work releases both partners',()=>{
 const s=new Simulation(),[a,b]=s.agents;s.activities.actors=s.agents;for(const actor of [a,b]){s.activities.cancel(actor,'reset');actor.path=[];actor.activityCooldown=20;setState(actor,STATE.IDLE);}
 Object.assign(a,center({col:29,row:38}));Object.assign(b,center({col:32,row:38}));assert.ok(s.activities.tryEncounter());const session=a.activity.sessionId;assert.equal(b.activity.sessionId,session);assert.equal(s.activities.sessions.size,1);assert.equal(s.activities.tryStart(a,COFFEE_ACTIVITY,true),false);
 s.start('Social work priority');s.assignNext();assert.equal(s.activities.sessions.size,0);assert.equal(a.activity,null);assert.equal(b.activity,null);assert.equal(a.workStatus,'Assigned');assert.equal(b.state,STATE.IDLE);
 s.reset();assert.equal(s.activities.tryEncounter(),false,'Pair cooldown was ignored');
 Object.assign(a,center({col:38,row:24}));Object.assign(b,center({col:41,row:24}));s.activities.pairCooldowns.clear();assert.equal(s.activities.tryEncounter(),false,'An encounter blocked the road');
});

test('needs, traits, distance, cooldown and daily clock influence activity choices independently of work',()=>{
 const s=new Simulation(),a=s.agents[0],clock=s.clock,coffee=s.activities.definitions[0],location=s.activities.locationFor(a,coffee);a.personality='Sociable';const social=utility(a,coffee,location,clock,0);a.personality='Focused';assert.ok(social>utility(a,coffee,location,clock,0));
 const market=s.activities.locationFor(a,SHOPPING_ACTIVITY);a.needs.hunger=10;const satiated=utility(a,SHOPPING_ACTIVITY,market,clock,0);a.needs.hunger=90;assert.ok(utility(a,SHOPPING_ACTIVITY,market,clock,0)>satiated+40);a.activityCooldowns.shopping=200;assert.equal(utility(a,SHOPPING_ACTIVITY,market,clock,100),0);
 clock.totalMinutes=23*60;assert.ok(bedtime(a,clock));const home=s.activities.locationFor(a,REST_ACTIVITY);assert.ok(utility(a,REST_ACTIVITY,home,clock,0)>100);clock.totalMinutes=9*60;assert.ok(!bedtime(a,clock));
 const c=new CityClock({startMinute:1439,minutesPerSecond:2});c.update(1);assert.equal(c.day,2);assert.equal(c.label,'00:01');assert.equal(c.period,'Night');assert.equal(c.darkness,1);
});

test('dynamic registry residents share activities and homes; pause, removal, expiry and reset clean up all phases',()=>{
 const s=new Simulation(),a=s.addAgent('Nova','Researcher','research',false,'Relaxed');assert.equal(a.personality,'Relaxed');assert.ok(HOME_LOCATIONS.some(h=>h.id===a.homeId));s.activities.actors=s.agents;s.activities.definitions=[{...READING_ACTIVITY,chance:0}];assert.ok(s.activities.tryStart(a,s.activities.definitions[0],true));advance(s,()=>a.state===STATE.READING);assert.ok(a.animator);const point=a.activity.pointId,time=s.clock.totalMinutes,remaining=a.activity.seatRemaining;
 s.paused=true;for(let i=0;i<60;i++)s.update(1/30);assert.equal(s.clock.totalMinutes,time);assert.equal(a.activity.seatRemaining,remaining);s.paused=false;s.removeAgent(a.id);assert.equal(s.activities.reservations.reservations.has(point),false);
 const b=s.agents[0];s.activities.actors=s.agents;assert.ok(s.activities.tryStart(b,s.activities.definitions[0],true));s.activities.reservations.reservations.get(b.activity.pointId).expiresAt=-1;s.update(1/30);assert.equal(b.activity,null);assert.equal(b.hidden,false);
 s.reset();assert.equal(s.activities.reservations.reservations.size,0);
});

test('capacity and entrance waiting remain bounded and an indoor Market slot releases for the next visitor',()=>{
 const s=new Simulation(),[a,b]=s.agents;s.activities.actors=s.agents;s.activities.definitions=[{...SHOPPING_ACTIVITY,chance:0}];assert.ok(s.activities.tryStart(a,s.activities.definitions[0],true,{outcome:'food'}));b.path=[];b.activity=null;setState(b,STATE.IDLE);assert.equal(s.activities.tryStart(b,s.activities.definitions[0],true,{outcome:'food'}),true);assert.equal(b.state,STATE.WAITING_FOR_ENTRANCE);advance(s,()=>a.state===STATE.SHOPPING);assert.equal(s.activities.reservations.reservations.has('market-entry'),false);advance(s,()=>!b.activity);assert.ok(s.activities.tryStart(b,s.activities.definitions[0],true,{outcome:'food'}));s.reset();assert.equal(a.hidden,false);assert.equal(s.activities.reservations.reservations.size,0);
});

test('decorative population respects bounds, offscreen spawn/exit, reduced update frequency and registry isolation',()=>seeded(22,()=>{
 const s=new Simulation(),c=new Citizens(s.map,s.agents),camera=new Camera(600,500);camera.x=500;camera.y=650;camera.zoom=1.5;c.setTarget(6);let max=0;
 for(let i=0;i<420*30;i++){s.update(1/30);c.update(1/30,s.agents,camera);max=Math.max(max,c.people.length);assert.ok(c.people.length<=6);assert.ok(c.people.every(a=>a.decorative&&!s.agents.includes(a)&&s.map.canStand(a.x,a.y)));}
 assert.equal(max,6);assert.ok(c.offscreenTicks>0);assert.equal(s.agents.length,4);c.enabled=false;
 for(let i=0;i<300*30;i++){s.update(1/30);c.update(1/30,s.agents,camera);}assert.ok(c.despawned>=3);assert.ok([...s.activities.reservations.reservations.values()].every(r=>[...s.agents,...c.people].some(a=>a.id===r.ownerId)));
}));

test('full living city retains safe lanes, four-stage handoffs, sparse traffic and varied vehicle types',()=>seeded(47,()=>{
 const s=new Simulation(),traffic=new TrafficSystem(s.map),c=new Citizens(s.map,s.agents);const styles=new Set();s.speed=4;s.start('Living city compatibility');
 for(let i=0;i<360*60;i++){s.update(1/60);c.update(4/60,s.agents);traffic.update(1/60,[...s.agents,...c.people]);for(const v of traffic.vehicles){styles.add(v.style);for(const a of [...s.agents,...c.people].filter(a=>!a.hidden))assert.ok(Math.hypot(a.x-v.x,a.y-v.y)>=18);for(const o of traffic.vehicles)if(o!==v&&o.route===v.route)assert.ok(Math.abs(o.distance-v.distance)>45);}}
 assert.equal(s.phase,'complete');assert.ok(styles.size>=2);for(const [roll,expected] of [[.2,0],[.8,1],[.99,2]])assert.equal(new TrafficSystem(s.map,()=>roll).spawn().style,expected);assert.ok(traffic.exited>8);assert.equal(s.map.roads.report.graphComponents,1);assert.deepEqual(traffic.report.errors,[]);assert.equal(s.activities.stats.routeFailures,0);
}));

test('work roles stay independent of visual appearance and meeting navigation releases temporary anchors',()=>{
 const s=new Simulation(),a=s.addAgent('Violet engineer','Developer','develop',false,'Focused','Tester');assert.equal(a.role,'Developer');assert.equal(a.appearance,'Tester');assert.ok(a.homeId);
 const b=s.agents[0];s.activities.actors=s.agents;for(const actor of [a,b]){s.activities.cancel(actor,'reset');actor.path=[];actor.activityCooldown=50;setState(actor,STATE.IDLE);}Object.assign(a,center({col:22,row:39}));Object.assign(b,center({col:31,row:39}));assert.ok(s.activities.tryEncounter());const session=[...s.activities.sessions.values()][0];assert.equal(session.phase,'NAVIGATING');assert.ok(s.activities.points.some(p=>p.sessionId===session.id));const point=s.activities.points.find(p=>p.sessionId===session.id);assert.ok(findPath(s.map,a,point.interactionCell).length);
 s.activities.cancel(a,'task');assert.equal(s.activities.sessions.size,0);assert.ok(s.activities.points.every(p=>!p.sessionId));assert.ok(!s.activities.reservations.reservations.has(point.id));assert.equal(b.activity,null);
});
