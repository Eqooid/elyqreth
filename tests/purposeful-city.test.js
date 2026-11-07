import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../dist/js/simulation.js';
import {Camera} from '../dist/js/camera.js';
import {Citizens,NPC_SERVICE_ZONES} from '../dist/js/citizens.js';
import {TrainSystem} from '../dist/js/train.js';
import {TrafficSystem} from '../dist/js/traffic.js';
import {findPath} from '../dist/js/pathfinding.js';
import {STATE,setState} from '../dist/js/agent-state.js';
import {CAFE_SEATS,CAFE_TABLES,CAFE_OBJECTS,CAFE_ORDER_POINT,CAFE_QUEUE_POINTS,COFFEE_ACTIVITY,SHOPPING_ACTIVITY,JOB_ACTIVITIES,HOME_LOCATIONS,INTERACTION_POINTS} from '../dist/js/locations.js';
import {center} from '../dist/js/world.js';
const until=(s,predicate,seconds=220,inspect=()=>{})=>{for(let i=0;i<seconds*30&&!predicate();i++){const before=s.agents.map(a=>({x:a.x,y:a.y}));s.update(1/30);s.agents.forEach((a,j)=>assert.ok(Math.hypot(a.x-before[j].x,a.y-before[j].y)<=a.speed/30+.001,'Teleported'));inspect();}assert.ok(predicate(),JSON.stringify(s.agents.map(a=>({state:a.state,step:a.activity?.stepId,phase:a.activity?.stepPhase}))));};
function fixture(def){const s=new Simulation();s.activities.definitions=s.activities.definitions.map(d=>({...d,chance:0}));s.activities.actors=s.agents;s.activities.nextEncounter=Infinity;for(const a of s.agents)a.activityCooldown=1e6;return {s,a:s.agents[0],def:s.activities.definitions.find(d=>d.id===def.id)};}
function seeded(seed,run){const original=Math.random;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);try{return run();}finally{Math.random=original;}}

test('café counter, queues and six seats form one reachable frontage north of the road',()=>{
 const s=new Simulation();assert.equal(CAFE_TABLES.length,3);assert.equal(CAFE_SEATS.length,6);assert.equal(new Set(INTERACTION_POINTS.map(p=>p.id)).size,INTERACTION_POINTS.length);
 for(const p of [...CAFE_SEATS,...CAFE_QUEUE_POINTS]){assert.ok(p.position.y<352);const path=findPath(s.map,CAFE_ORDER_POINT.position,p.interactionCell);assert.ok(path.length);assert.ok(path.every(p=>!s.map.roads.at(...[s.map.cellAt(p).col,s.map.cellAt(p).row])),'Ordering requires a road crossing');}
 for(const object of CAFE_OBJECTS.filter(p=>p.collision)){const c=object.collision;for(let row=c.row;row<c.row+c.rows;row++)for(let col=c.col;col<c.col+c.columns;col++)assert.ok(!s.map.roads.at(col,row));}
 assert.ok(s.map.isWalkable(19,33),'Clinic planter still closes its garden');assert.ok(s.map.isWalkable(75,21),'Bin still blocks Café Studio frontage');
});

test('four café visitors order serially, receive real cups, seat without road crossings, sip and clean up',()=>seeded(29,()=>{
 const {s,def}=fixture(COFFEE_ACTIVITY),seen=new Set(),received=new Set(),drinkFrames=new Set();
 for(const a of s.agents)assert.ok(s.activities.tryStart(a,def,true));
 until(s,()=>s.activities.stats.byActivity.coffee.completed===4,220,()=>{
  const owners=s.activities.reservations.snapshot().filter(p=>p.type==='counter'&&p.reservedBy!==null);assert.ok(owners.length<=1);
  for(const a of s.agents){const r=a.activity;if(!r)continue;seen.add(r.stepId);if(['queue','order','prepare'].includes(r.stepId))assert.equal(a.prop,null);if(r.stepId==='receive'){assert.equal(a.prop?.kind,'coffee');assert.deepEqual({x:a.x,y:a.y},CAFE_ORDER_POINT.position);received.add(a.id);}if(r.stepId==='drink'){assert.ok(received.has(a.id));assert.ok(a.y<352);if(r.stepPhase==='INTERACTING')drinkFrames.add(s.activities.pose(a).frame);}assert.equal(a.workStatus,'Idle');}
 });
 for(const id of ['queue','order','prepare','receive','drink','leave-coffee'])assert.ok(seen.has(id),id);assert.equal(received.size,4);assert.ok(drinkFrames.has(2));assert.equal(s.activities.stats.orders,4);assert.equal(s.activities.stats.drinksServed,4);assert.ok(s.agents.every(a=>!a.prop));assert.equal(s.activities.reservations.reservations.size,0);
}));

test('window shopping can remain outdoors or enter without ever acquiring purchases',()=>{
 for(const random of [.8,.1]){const {s,a,def}=fixture(SHOPPING_ACTIVITY);s.activities.random=()=>random;assert.ok(s.activities.tryStart(a,def,true,{outcome:'window'}));let indoor=false;
  until(s,()=>!a.activity,100,()=>{assert.equal(a.prop,null);indoor||=a.hidden;});assert.equal(indoor,random<.45);assert.equal(a.hidden,false);assert.equal(a.prop,null);assert.equal(s.activities.stats.householdDeliveries,0);
 }
});

test('food purchases reach a reserved bench, animate actual bites and remove the snack after consumption',()=>{
 const {s,a,def}=fixture(SHOPPING_ACTIVITY);a.needs.hunger=85;const identity=a;assert.ok(s.activities.tryStart(a,def,true,{outcome:'food'}));const frames=new Set();let bought=false,eaten=false;
 until(s,()=>!a.activity,200,()=>{const r=a.activity;if(!r)return;if(['browse','enter-market','inside-market'].includes(r.stepId))assert.equal(a.prop,null);if(a.prop){assert.equal(a.prop.kind,'food');bought=true;}if(a.state===STATE.EATING){eaten=true;assert.equal(a.prop.kind,'food');assert.equal(s.activities.reservations.reservations.get(r.pointId).ownerId,a.id);frames.add(s.activities.pose(a).frame);}});
 assert.ok(bought&&eaten);assert.deepEqual([...frames].sort(),[0,1]);assert.equal(a.prop,null);assert.ok(a.needs.hunger<55);assert.equal(s.agents[0],identity);assert.equal(s.activities.stats.foodConsumed,1);assert.equal(s.activities.reservations.reservations.size,0);
});

test('household bags exist only between purchase and delivery to the same resident home',()=>{
 const {s,a,def}=fixture(SHOPPING_ACTIVITY),identity=a,home=HOME_LOCATIONS.find(h=>h.id===a.homeId);assert.ok(s.activities.tryStart(a,def,true,{outcome:'household'}));let bag=false,delivered=false,putAway=false;
 until(s,()=>!a.activity,200,()=>{const r=a.activity;if(!r)return;if(a.prop){bag=true;assert.equal(a.prop.kind,'shoppingBag');assert.ok(['exit-market','deliver-purchase','put-away'].includes(r.stepId));assert.notEqual(a.state,STATE.WANDERING);}if(a.state===STATE.DELIVERING_PURCHASES){delivered=true;assert.deepEqual({x:a.x,y:a.y},center(home.entry));}if(a.state===STATE.PUTTING_AWAY_PURCHASES){putAway=true;assert.equal(a.hidden,true);assert.equal(r.locationId,home.id);}});
 assert.ok(bag&&delivered&&putAway);assert.equal(a.prop,null);assert.equal(a.hidden,false);assert.equal(s.agents[0],identity);assert.equal(s.activities.stats.householdDeliveries,1);assert.equal(s.activities.reservations.reservations.size,0);
});

test('work interrupts every service, purchase, eating and delivery step without identity or lease leaks',()=>{
 const cases=[...['queue','order','prepare','receive','drink','leave-coffee'].map(step=>[COFFEE_ACTIVITY,null,step]),...['browse','enter-market','inside-market','exit-market','eat','leave-park'].map(step=>[SHOPPING_ACTIVITY,'food',step]),...['deliver-purchase','put-away','leave-home'].map(step=>[SHOPPING_ACTIVITY,'household',step])];
 for(const [definition,outcome,step] of cases){const {s,a,def}=fixture(definition);assert.ok(s.activities.tryStart(a,def,true,{outcome}));until(s,()=>a.activity?.stepId===step,200);const before={x:a.x,y:a.y},id=a.id;s.start('Purposeful interruption');s.assignNext();assert.equal(a.id,id);assert.deepEqual({x:a.x,y:a.y},before);assert.equal(a.prop,null);assert.equal(a.hidden,false);assert.equal(a.activity,null);assert.equal(a.workStatus,'Assigned');assert.equal(s.activities.pose(a),null);assert.ok([...s.activities.reservations.reservations.values()].every(r=>r.ownerId!==id));}
 const {s,a,def}=fixture(SHOPPING_ACTIVITY);s.activities.tryStart(a,def,true,{outcome:'household'});until(s,()=>a.state===STATE.PUTTING_AWAY_PURCHASES);s.start('Delivery interruption handoffs');until(s,()=>s.phase==='complete',600);assert.equal(s.progress,1);assert.equal(a.workStatus,'Idle');
});

test('queue transfer, expired service lease, removal and reset cannot strand temporary props',()=>{
 const {s,a,def}=fixture(COFFEE_ACTIVITY);s.activities.tryStart(a,def,true);until(s,()=>a.state===STATE.RECEIVING_DRINK);assert.equal(a.prop.kind,'coffee');s.activities.reservations.reservations.get(a.activity.pointId).expiresAt=-1;s.update(1/30);assert.equal(a.activity,null);assert.equal(a.prop,null);
 s.activities.tryStart(a,def,true);until(s,()=>a.state===STATE.DRINKING_COFFEE);const id=a.id;s.removeAgent(id);assert.ok([...s.activities.reservations.reservations.values()].every(r=>r.ownerId!==id));
 const b=s.agents[0];s.activities.actors=s.agents;s.activities.tryStart(b,def,true);until(s,()=>b.state===STATE.RECEIVING_DRINK);s.reset();assert.equal(b.prop,null);assert.equal(s.activities.reservations.reservations.size,0);
});

test('barista, courier and cleaner are visible purposeful NPCs with bounded roles and shared cleanup',()=>seeded(19,()=>{
 const s=new Simulation(),c=new Citizens(s.map,s.agents),registry=s.agents.map(a=>a.id),prepFrames=new Set(),cleanFrames=new Set();let packageSeen=false;
 for(let i=0;i<300*30;i++){s.update(1/30);c.update(1/30,s.agents);assert.deepEqual({x:c.staff.x,y:c.staff.y},{x:1752,y:248});if(c.staff.serving)prepFrames.add(s.activities.pose(c.staff).frame);
  for(const a of c.people){assert.equal(a.decorative,true);assert.ok(!s.agents.includes(a));if(a.prop?.kind==='package'){packageSeen=true;assert.equal(a.visitorRole,'Courier');assert.equal(a.activity.stepId,'deliver');}if(a.state===STATE.CLEANING){const [x,y,w,h]=NPC_SERVICE_ZONES.find(z=>z.id==='cleaner-promenade').bounds;assert.ok(a.x>=x&&a.x<=x+w&&a.y>=y&&a.y<=y+h);cleanFrames.add(s.activities.pose(a).frame);}}
 }
 assert.ok(prepFrames.size===2);assert.ok(cleanFrames.size===2);assert.ok(packageSeen);assert.ok(s.activities.stats.courierDeliveries>=2);assert.ok(s.activities.stats.cleaningStops>=6);assert.deepEqual(s.agents.map(a=>a.id),registry);assert.equal(c.staff.workStatus,'Idle');assert.ok(!s.agents.includes(c.staff));
}));

test('passengers walk through the reserved platform gate only at train stops and never remove functional agents',()=>seeded(27,()=>{
 const s=new Simulation(),c=new Citizens(s.map,s.agents),train=new TrainSystem(()=>.5);s.map.train=train;const registry=s.agents.map(a=>a.id),states=new Set(),positions=new Map();s.speed=2;
 for(let i=0;i<200*60;i++){s.update(1/60);train.update(1/60);c.update(2/60,s.agents);assert.ok(c.people.length<=c.config.max);
  for(const a of c.people){states.add(a.state);const before=positions.get(a.id);if(before)assert.ok(Math.hypot(before.x-a.x,before.y-a.y)<=a.speed*2/60+.01);positions.set(a.id,{x:a.x,y:a.y});if(a.state===STATE.BOARDING_TRAIN)assert.equal(train.state,'stopped');if(a.state===STATE.RIDING_TRAIN)assert.equal(a.hidden,true);}
 }
 for(const state of ['WAITING_FOR_TRAIN','BOARDING_TRAIN','RIDING_TRAIN','ALIGHTING_TRAIN'])assert.ok(states.has(state),state);assert.ok(s.activities.stats.passengersBoarded>=2);assert.ok(s.activities.stats.passengersAlighted>=2);assert.deepEqual(s.agents.map(a=>a.id),registry);
}));

test('plaza holograms admit at most two decorative watchers, clear naturally, and leave work unforced',()=>{
 const s=new Simulation(),c=new Citizens(s.map,s.agents,{target:0});s.activities.definitions=s.activities.definitions.map(d=>({...d,chance:0}));c.enabled=true;c.setTarget(3);for(const cell of [{col:29,row:40},{col:31,row:40},{col:32,row:39}])c.create(center(cell),{profile:5});c.plaza.nextAt=0;
 s.update(1/30);c.update(1/30,s.agents);assert.equal(c.plaza.active,true);assert.equal(c.plaza.events,1);assert.ok(c.people.filter(a=>a.activity?.definitionId==='plaza-event').length<=2);assert.ok(s.agents.every(a=>a.activity?.definitionId!=='plaza-event'));
 for(let i=0;i<60*30;i++){s.update(1/30);c.update(1/30,s.agents);}assert.equal(c.plaza.active,false);assert.ok(c.people.every(a=>a.activity?.definitionId!=='plaza-event'));assert.equal(c.plaza.events,1);
});

test('marked crossing coordination prevents contact, stranded crossings and traffic stalls through repeated work cycles',()=>seeded(61,()=>{
 const s=new Simulation(),c=new Citizens(s.map,s.agents),traffic=new TrafficSystem(s.map),train=new TrainSystem(()=>.5);s.map.train=train;s.speed=4;s.start('Road and platform coexistence');let longestWait=0;
 for(let i=0;i<320*60;i++){s.update(1/60);train.update(1/60);c.update(4/60,s.agents);traffic.update(1/60,[...s.agents,...c.allPeople]);for(const a of [...s.agents,...c.allPeople])if(!a.hidden){const cell=s.map.cellAt(a);assert.ok(s.map.isPedestrianCell(cell.col,cell.row),`${a.id} walked outside a crossing`);longestWait=Math.max(longestWait,a.crossingWait||0);for(const v of traffic.vehicles)assert.ok(Math.hypot(a.x-v.x,a.y-v.y)>=18);}if(s.phase==='complete'&&i<9000)s.start('Second safe handoff');}
 assert.equal(s.phase,'complete');assert.ok(traffic.exited>8);assert.ok(longestWait<70);assert.equal(s.activities.stats.routeFailures,0);assert.ok(train.arrivals>3);assert.ok(s.activities.stats.orders>3);assert.ok(s.activities.stats.passengersAlighted>1);assert.deepEqual(traffic.report.errors,[]);
}));


test('camera-batched NPCs clear narrow entrances over multiple days without floating-point courtesy stalls',()=>{
 for(const seed of [3,527])seeded(seed,()=>{
  const s=new Simulation(),c=new Citizens(s.map,s.agents),train=new TrainSystem(()=>.5),traffic=new TrafficSystem(s.map),camera=new Camera(1363,936);
  camera.zoom=1.5;camera.x=1402;camera.y=300;s.map.train=train;s.speed=4;s.addAgent('Nova','Researcher','research',false,'Sociable','Tester');
  for(let i=0;i<420*60;i++){s.update(1/60);train.update(1/60);c.update(4/60,s.agents,camera);traffic.update(1/60,[...s.agents,...c.allPeople]);}
  assert.equal(s.activities.stats.routeFailures,0,JSON.stringify(s.activities.stats.routeDiagnostics));assert.ok(s.activities.stats.passengersAlighted>=3);assert.ok(s.activities.stats.courierDeliveries>=3);assert.ok(c.offscreenTicks>0);assert.ok(traffic.exited>10);assert.equal(s.agents.length,5);
 });
});


test('whole-city camera stages departures at distinct boundary endpoints without visible piling',()=>seeded(97,()=>{
 const s=new Simulation(),c=new Citizens(s.map,s.agents),camera=new Camera(1363,936);camera.fit();c.setTarget(0);
 for(let i=0;i<120*30;i++){s.update(1/30);c.update(1/30,s.agents,camera);}
 const exits=c.people.filter(a=>a.exiting).map(a=>`${a.exitCell.col},${a.exitCell.row}`);assert.equal(new Set(exits).size,exits.length);assert.ok(exits.length<=3);assert.equal(s.agents.length,4);
}));
