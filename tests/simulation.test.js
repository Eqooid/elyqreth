import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../dist/js/simulation.js';
import {findPath} from '../dist/js/pathfinding.js';
import {BUILDINGS,POINTS_OF_INTEREST,center,WORLD,WATER_AREAS,BRIDGES} from '../dist/js/world.js';
import {SpriteAnimator} from '../dist/js/animator.js';
import {TownScene} from '../dist/js/scene.js';
import {densityReport,buildingFootprints} from '../dist/js/density.js';
import {STATE} from '../dist/js/agent-state.js';
import {SCENERY,DECORATIVE_BUILDINGS,createScenery} from '../dist/js/scenery.js';
import {CAFE_SEATS,CAFE_TABLES,CAFE_OBJECTS,COFFEE_ACTIVITY} from '../dist/js/locations.js';
import {ReservationManager,SEATED_STATES} from '../dist/js/activities.js';
const advance=(s,until,seconds=500)=>{for(let i=0;i<seconds*30&&!until();i++)s.update(1/30);assert.ok(until(),`Stuck in ${s.phase}, ${s.currentAgent?.name}: ${s.currentAgent?.state}`);};
test('decorative footprints block A* while the entire compact street network stays connected',()=>{
 const s=new Simulation(),ids=new Set();
 for(const d of SCENERY){assert.ok(!ids.has(d.id));ids.add(d.id);assert.equal(d.layer,'world');
 for(const part of [...(d.collision?[d.collision]:[]),...(d.collisionParts||[])]){const {col,row,columns,rows}=part;
 for(let y=row;y<row+rows;y++)for(let x=col;x<col+columns;x++){
 assert.equal(s.map.isWalkable(x,y),false,`${d.id} has a walkable footprint`);
 assert.equal(findPath(s.map,center(BUILDINGS[0].doorCell),{col:x,row:y}).length,0);
 }}}
 const reached=new Set(),queue=[BUILDINGS[0].doorCell];
 for(let i=0;i<queue.length;i++){const p=queue[i],key=`${p.col},${p.row}`;if(reached.has(key))continue;reached.add(key);for(const n of s.map.neighbors(p))if(!reached.has(`${n.col},${n.row}`))queue.push(n);}
 assert.equal(reached.size,s.map.availableCells().filter(p=>s.map.isPedestrianCell(p.col,p.row)).length,'An obstacle isolated a walkable destination');
 for(const d of DECORATIVE_BUILDINGS){assert.ok(!BUILDINGS.some(b=>b.id===d.id));const f=d.collision;const adjacent=[];for(let y=f.row;y<f.row+f.rows;y++)adjacent.push({col:f.col-1,row:y},{col:f.col+f.columns,row:y});for(let x=f.col;x<f.col+f.columns;x++)adjacent.push({col:x,row:f.row-1},{col:x,row:f.row+f.rows});assert.ok(adjacent.some(c=>s.map.isWalkable(c.col,c.row)),`${d.id} has no accessible frontage`);}
 const a=createScenery('reuse-a','house',[1,2,3,3]),b=createScenery('reuse-b','house',[8,9,3,3]);assert.equal(a.sprite,b.sprite);assert.equal(a.atlas,b.atlas);assert.notEqual(a.x,b.x);
});
test('every workplace and park is connected by safe cardinal A* routes',()=>{
 const s=new Simulation();const origins=BUILDINGS.flatMap(b=>[b.doorCell,b.workCell]);
 for(const a of origins)for(const b of [...origins,...POINTS_OF_INTEREST]){
 const path=findPath(s.map,center(a),b);assert.ok(path.length||a.col===b.col&&a.row===b.row,`${JSON.stringify(a)} cannot reach ${JSON.stringify(b)}`);
 for(const p of path)assert.ok(s.map.canStand(p.x,p.y));
 const all=[center(a),...path];for(let i=1;i<all.length;i++)assert.ok(Math.abs(all[i].x-all[i-1].x)<.1||Math.abs(all[i].y-all[i-1].y)<.1,'A diagonal cut a corner');
 }
 assert.equal(findPath(s.map,center(BUILDINGS[0].doorCell),{col:BUILDINGS[0].tiles[0],row:BUILDINGS[0].tiles[1]}).length,0);
 assert.equal(findPath(s.map,center(BUILDINGS[0].doorCell),{col:WATER_AREAS[0][0]+2,row:WATER_AREAS[0][1]+2}).length,0);
});
test('idle agents roam, vary destinations, animate, and never enter blocked tiles',()=>{
 const s=new Simulation(),visited=s.agents.map(()=>new Set()),directions=new Set(),frames=new Set();let pauses=0;
 for(let i=0;i<30*120;i++){const before=s.agents.map(a=>({x:a.x,y:a.y}));s.update(1/30);s.agents.forEach((a,n)=>{
 assert.ok(s.map.canStand(a.x,a.y));assert.ok(Math.hypot(a.x-before[n].x,a.y-before[n].y)<=a.speed/30+.01,'An agent teleported');
 const cell=s.map.cellAt(a);visited[n].add(`${cell.col},${cell.row}`);directions.add(a.direction);frames.add(a.animator.frame);if(a.pauseRemaining>0)pauses++;
 });}
 for(const cells of visited)assert.ok(cells.size>15,'A resident stayed frozen');assert.equal(directions.size,4);assert.ok(frames.size>=3);assert.ok(pauses>0);
});
test('a task interrupts wandering without teleporting; handoffs finish and agents roam again',()=>{
 const s=new Simulation();for(let i=0;i<150;i++)s.update(1/30);const positions=s.agents.map(a=>[a.x,a.y]);s.start('Build a landing page');assert.deepEqual(s.agents.map(a=>[a.x,a.y]),positions);
 advance(s,()=>s.phase==='working');assert.equal(s.currentAgent.state,STATE.WORKING);assert.deepEqual(s.map.cellAt(s.currentAgent),BUILDINGS.find(b=>b.id===s.currentAgent.workplace).workCell);
 const work= s.currentAgent;assert.equal(work.path.length,0);s.paused=true;const previous=work.workTime;const frame=work.animator.frame;s.update(.1);assert.equal(work.workTime,previous);assert.equal(work.animator.frame,frame);s.paused=false;
 advance(s,()=>s.phase==='complete');assert.equal(s.progress,1);assert.ok(s.steps.every(x=>x.status==='done'));const tester=s.agents.find(a=>a.role==='Tester');advance(s,()=>tester.state==='WANDERING',10);
 const before=s.agents.map(a=>[a.x,a.y]);s.reset();assert.deepEqual(s.agents.map(a=>[a.x,a.y]),before);
});
test('error retries preserve earlier handoffs and removal recovers through a replacement',()=>{
 const s=new Simulation();s.start('Retry a task');advance(s,()=>s.stage===1);s.fail(s.currentAgent.id);assert.equal(s.phase,'error');s.retry();assert.equal(s.steps[0].status,'done');advance(s,()=>s.phase==='complete');
 s.reset();s.start('Missing researcher');advance(s,()=>s.currentAgent?.role==='Researcher');s.removeAgent(s.currentAgent.id);assert.equal(s.phase,'blocked');s.addAgent('Nova','Researcher','research');advance(s,()=>s.phase==='complete');
 s.reset();s.addAgent('Backup','Developer','develop');s.start('Automatic reassignment');advance(s,()=>s.currentAgent?.role==='Developer');s.removeAgent(s.currentAgent.id);assert.equal(s.currentAgent.name,'Backup');advance(s,()=>s.phase==='complete');
});
test('all four directions use distinct rows/columns and walking changes actual atlas frames',()=>{
 const animator=new SpriteAnimator();const positions=new Set();for(const direction of ['up','down','left','right']){const frames=new Set();for(let n=0;n<10;n++){animator.update(.15,{moving:true,direction});const c=animator.cell('Developer');frames.add(`${c.row},${c.col}`);positions.add(`${c.row},${Math.floor(c.col/4)}`);}assert.ok(frames.size>=3);}assert.equal(positions.size,4);
 const idleFrames=new Set();for(let i=0;i<20;i++){animator.update(.4,{moving:false,direction:'down'});idleFrames.add(animator.frame);}assert.ok(idleFrames.size>=2);
});

test('reference blueprint preserves landmark composition and independent scene objects',()=>{
 assert.equal(WORLD.width,1856);assert.equal(WORLD.height,1024);
 const report=densityReport();assert.equal(report.buildingCount,15);
 const byId=id=>BUILDINGS.find(b=>b.id===id);
 assert.ok(byId('hall').x<byId('develop').x&&byId('develop').x<byId('design').x);
 assert.ok(byId('test').x<800&&byId('research').x>1030);
 assert.ok(byId('station').y>byId('research').y);
 const scene=new TownScene(new Simulation());assert.equal(new Set(scene.worldObjects.map(n=>n.object.id)).size,scene.worldObjects.length);
 assert.equal(scene.agents.length,4);assert.ok(scene.worldObjects.every(n=>n.object.layer==='world'));
 for(const b of [...BUILDINGS,...DECORATIVE_BUILDINGS])assert.ok(b.referenceBounds?.length===4,'Missing image-relative rectangle');
 const occupied=new Set();for(const [x,y,w,h] of buildingFootprints()){
 assert.ok(x>=0&&y>=0&&x+w<=WORLD.columns&&y+h<=WORLD.rows,'A building extends beyond the map');
 for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++){const key=`${c},${r}`;assert.ok(!occupied.has(key),'Buildings overlap');occupied.add(key);}
 }
 const map=new Simulation().map;for(const [x,y,w,h] of BRIDGES)for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++)assert.ok(map.isWalkable(c,r));
});

// Ambient motion is independent of agent assignment and follows its own clock.
import {TrainSystem,RAIL_ROUTE} from '../dist/js/train.js';
import {WaterSystem,WATER_FLOWS} from '../dist/js/water.js';
import {TERRAIN} from '../dist/js/tile-map.js';
test('ambient rail motion stops at the station, exits, waits and returns without leaving the rails',()=>{
 const train=new TrainSystem(()=>.5),states=new Set();let prior=train.x;
 for(let i=0;i<60*70;i++){const oldState=train.state;train.update(1/60);states.add(train.state);
 assert.equal(train.y,RAIL_ROUTE.y);assert.ok(train.x>=RAIL_ROUTE.start&&train.x<=RAIL_ROUTE.end);
 if(train.state==='stopped')assert.equal(train.x,RAIL_ROUTE.stop);
 if(oldState===train.state&&train.visible)assert.ok(Math.abs(train.x-prior)<=RAIL_ROUTE.speed/60+.00001);
 if(train.state==='waiting')assert.equal(train.visible,false);prior=train.x;}
 assert.equal(states.size,4);assert.ok(train.arrivals>=2&&train.departures>=2);
 const whole=new TrainSystem(()=>.5),split=new TrainSystem(()=>.5);whole.update(31);for(let i=0;i<310;i++)split.update(.1);
 assert.equal(whole.state,split.state);assert.ok(Math.abs(whole.x-split.x)<.0001);
});
test('water frame clock loops and asphalt remains separate from pedestrian paving',()=>{
 const water=new WaterSystem();water.update(.4);const frame=water.frame;water.update(3.2);assert.equal(water.frame,frame);
 assert.ok(WATER_FLOWS.some(f=>f.direction==='down')&&WATER_FLOWS.some(f=>f.direction==='left'));
 const map=new Simulation().map;assert.equal(map.tiles[map.index(46,30)],TERRAIN.ASPHALT);
 assert.equal(map.tiles[map.index(26,20)],TERRAIN.SIDEWALK);assert.equal(map.tiles[map.index(27,44)],TERRAIN.PLAZA);
 assert.equal(map.tiles[map.index(46,59)],TERRAIN.SIDEWALK);
});

import {RoadNetwork,junctionKind} from '../dist/js/road-network.js';
import {TrafficSystem,TRAFFIC_ROUTES,sampleRoute,validateLanes} from '../dist/js/traffic.js';
import {Citizens} from '../dist/js/citizens.js';
test('traffic routes stay on clear asphalt, turn through the station and exit with sparse spawning',()=>{
 const map=new Simulation().map,traffic=new TrafficSystem(map,()=>.35);assert.equal(validateLanes(map).errors.length,0);
 const routesSeen=new Set();for(const r of TRAFFIC_ROUTES){const t=new TrafficSystem(map,()=>.5);t.nextSpawn=Infinity;const v=t.spawn(r);const angles=new Set();let waited=false;
 for(let i=0;i<150*60&&t.vehicles.length;i++){const x=v.x,y=v.y;t.update(1/60);routesSeen.add(r.id);angles.add(Math.round(v.angle*10));if(v.stopRemaining>0)waited=true;
 assert.ok(Math.hypot(v.x-x,v.y-y)<=v.cruise/60+.41,'Vehicle jumped');if(v.x>0&&v.x<WORLD.width){assert.equal(map.roads.at(Math.floor(v.x/16),Math.floor(v.y/16)),1);assert.ok(map.canStand(v.x,v.y));}}
 assert.equal(t.exited,1,`${r.id} never exited`);if(r.id==='station-loop'){assert.ok(waited);assert.ok(angles.size>8,'Turn was not curved');}}
 assert.equal(routesSeen.size,3);
 for(let i=0;i<240*60;i++){traffic.update(1/60);assert.ok(traffic.vehicles.length<=4);for(const v of traffic.vehicles)for(const o of traffic.vehicles)if(v!==o&&v.route===o.route)assert.ok(Math.abs(v.distance-o.distance)>45,'Same-lane spacing failed');}
 assert.ok(traffic.exited>8);
});
test('vehicles yield before pedestrians, wait safely, then continue when the lane clears',()=>{
 const t=new TrafficSystem(new Simulation().map,()=>.5);t.nextSpawn=Infinity;const v=t.spawn(TRAFFIC_ROUTES[0]),pedestrian={x:400,y:392};
 for(let i=0;i<15*60;i++)t.update(1/60,[pedestrian]);assert.ok(v.x<368);assert.equal(v.speed,0);assert.ok(v.yielding);
 const previous=v.x;for(let i=0;i<8*60;i++)t.update(1/60,[]);assert.ok(v.x>previous+150);
});
test('residents, visitors and cars coexist without contact or deadlocks at normal and 4x task speed',()=>{
 const previous=Math.random;let seed=141;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);Math.random=random;
 try{for(const speed of [1,4]){const s=new Simulation();s.speed=speed;const t=new TrafficSystem(s.map,random),c=new Citizens(s.map,s.agents);s.start('Crossing priority');
 for(let i=0;i<300*60;i++){s.update(1/60);c.update(1/60,s.agents);t.update(1/60,[...s.agents,...c.people]);for(const v of t.vehicles)for(const a of [...s.agents,...c.people])assert.ok(Math.hypot(v.x-a.x,v.y-a.y)>=18,'A car contacted a pedestrian');}
 assert.equal(s.phase,'complete');assert.ok(t.exited>=8,'Traffic became permanently blocked');}}
 finally{Math.random=previous;}
});
test('decorative citizens never join AI assignments and wander independently',()=>{
 const s=new Simulation(),citizens=new Citizens(s.map,s.agents),train=new TrainSystem(()=>.5),positions=citizens.people.map(a=>[a.x,a.y]),movement=citizens.people.map(()=>0);s.map.train=train;for(const a of citizens.people)assert.ok(s.agents.every(o=>Math.hypot(a.x-o.x,a.y-o.y)>25));s.start('Visitor isolation');
 for(let i=0;i<120*30;i++){s.update(1/30);train.update(1/30);citizens.update(1/30,s.agents);for(const a of citizens.people){assert.ok(s.map.canStand(a.x,a.y));assert.equal(a.decorative,true);assert.notEqual(a.walkPurpose,'work');assert.notEqual(s.currentAgent?.id,a.id);const i=a.id-10001;if(positions[i])movement[i]=Math.max(movement[i],Math.hypot(a.x-positions[i][0],a.y-positions[i][1]));}}
 assert.equal(s.agents.length,4);movement.forEach(distance=>assert.ok(distance>30));assert.ok(citizens.allPeople.every(a=>!s.agents.includes(a)));assert.ok(s.activities.stats.courierDeliveries>=1);assert.ok(s.activities.stats.cleaningStops>=1);
});
test('pedestrian routing favors marked crossings and train slows continuously into its stop',()=>{
 const s=new Simulation(),path=findPath(s.map,{x:600,y:344},{col:37,row:26});assert.ok(path.some(p=>s.map.isCrossing(Math.floor(p.x/16),Math.floor(p.y/16))),'Pedestrian crossed unmarked asphalt');
 const t=new TrainSystem(()=>.5),speeds=[];for(let i=0;i<600&&t.state==='approaching';i++){t.update(1/60);if(t.x>RAIL_ROUTE.stop-75)speeds.push(t.speed);}
 assert.ok(speeds.length>15);assert.equal(t.state,'stopped');assert.equal(speeds.at(-1),0);assert.ok(speeds.every((s,i)=>i===0||s<=speeds[i-1]+.01));
});
test('reference street graph has one protected surface, consistent boulevard width and intentional ends',()=>{
 const map=new Simulation().map,n=map.roads;assert.equal(n.report.graphComponents,1);assert.equal(n.report.surfaceComponents,1);assert.equal(n.report.asphaltComponents,1);
 assert.equal(n.report.overwritten,0);assert.equal(n.report.blockedAsphalt,0);
 // A full-width boulevard continues beyond both image boundaries, including
 // the areas under projected roofs. No sidewalk/plaza fill can cut it in half.
 for(let col=0;col<map.columns;col++)for(let row=22;row<26;row++)assert.equal(map.tiles[map.index(col,row)],TERRAIN.ASPHALT);
 for(let row=26;row<43;row++)for(let col=45;col<49;col++)assert.equal(map.tiles[map.index(col,row)],TERRAIN.ASPHALT);
 for(const crossing of n.crossings){const [x,y,w,h]=crossing.tiles;for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)assert.equal(map.tiles[map.index(col,row)],TERRAIN.ASPHALT);}
 assert.ok(n.junctions.filter(j=>j.kind==='terminal').every(j=>j.endpoint==='boundary'||j.endpoint==='destination'));
 assert.equal(n.junctions.find(j=>j.id==='market-junction').kind,'t-junction');
 assert.equal(map.tiles[map.index(80,35)],TERRAIN.ALLEY);assert.equal(map.tiles[map.index(81,55)],TERRAIN.RAILWAY);assert.equal(map.isWalkable(81,55),false);
 assert.equal(map.tiles[map.index(22,30)],TERRAIN.BUILDING);
 const saved=map.tiles[map.index(47,30)];map.tiles[map.index(47,30)]=TERRAIN.PLAZA;assert.throws(()=>n.validate(map),/overwritten/);map.tiles[map.index(47,30)]=saved;
});
test('road topology supports corners, T junctions and four-way tiles and rejects disconnected or abrupt streets',()=>{
 for(const mask of [3,6,9,12])assert.equal(junctionKind(mask),'corner');
 for(const mask of [7,11,13,14])assert.equal(junctionKind(mask),'t-junction');
 assert.equal(junctionKind(15),'four-way');assert.equal(junctionKind(5),'straight-vertical');assert.equal(junctionKind(10),'straight-horizontal');
 const network=new RoadNetwork();
 const orphan={id:'orphan',col:90,row:60,endpoint:'destination'};
 assert.throws(()=>new RoadNetwork(network.segments,[...network.nodes,orphan]),/disconnected/);
 assert.throws(()=>new RoadNetwork(network.segments,network.nodes.map(n=>n.id==='station-dropoff'?{...n,endpoint:undefined}:n)),/abrupt/);
 assert.equal(network.adjacency(47,24),15,'Junction must not contain internal curb boundaries');
});

test('the terrace extends the original district and all furniture interactions are connected without crossing solids',()=>{
 const s=new Simulation();assert.equal(CAFE_TABLES.length,3);assert.equal(CAFE_SEATS.length,6);
 assert.equal(new Set(CAFE_OBJECTS.map(p=>p.id)).size,CAFE_OBJECTS.length);
 for(const p of CAFE_OBJECTS.filter(p=>p.collision)){const b=p.collision;for(let row=b.row;row<b.row+b.rows;row++)for(let col=b.col;col<b.col+b.columns;col++)assert.ok(!s.map.isWalkable(col,row),p.id);}
 for(const chair of CAFE_SEATS){const path=findPath(s.map,center(BUILDINGS[2].doorCell),chair.interactionCell);assert.ok(path.length,chair.id);assert.deepEqual(path.at(-1),chair.position);assert.ok(path.every(p=>s.map.canStand(p.x,p.y)));}
 assert.equal(s.map.roads.report.surfaceComponents,1);assert.deepEqual(s.map.roads.report.errors,[]);
});

test('interaction leases enforce one chair per owner and release expired or removed owners',()=>{
 const m=new ReservationManager(CAFE_SEATS),[a,b]=CAFE_SEATS;
 assert.ok(m.reserve(a.id,1,0));assert.ok(!m.reserve(a.id,2,0));assert.ok(!m.reserve(b.id,1,0));assert.ok(m.occupy(a.id,1));assert.ok(!m.occupy(a.id,2));
 m.sweep(13,[{id:1}]);assert.equal(m.reservations.size,0);assert.ok(m.reserve(a.id,2,13));m.sweep(14,[{id:1}]);assert.equal(m.reservations.size,0);
});

test('residents complete repeated coffee/social cycles without teleporting, double occupancy or stalled reservations',()=>{
 const previous=Math.random;let seed=137;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 try{const s=new Simulation(),seen=new Set();s.activities.definitions=[COFFEE_ACTIVITY];
 for(let i=0;i<720*30;i++){const before=s.agents.map(a=>({x:a.x,y:a.y}));s.update(1/30);const leases=[...s.activities.reservations.reservations.values()];assert.ok(leases.length<=3);assert.equal(new Set(leases.map(r=>r.ownerId)).size,leases.length);
 s.agents.forEach((a,n)=>{seen.add(a.state);assert.ok(s.map.canStand(a.x,a.y));assert.ok(Math.hypot(a.x-before[n].x,a.y-before[n].y)<=a.speed/30+.01);if(a.activity?.definitionId==='coffee'&&SEATED_STATES.has(a.state)){const chair=CAFE_SEATS.find(c=>c.id===a.activity.pointId);assert.equal(a.x,chair.position.x);assert.equal(a.y,chair.position.y);assert.equal(s.activities.reservations.reservations.get(chair.id).ownerId,a.id);assert.ok(s.activities.pose(a));}});
 }
 for(const state of ['WALKING_TO_CAFE','SITTING','DRINKING_COFFEE','SOCIALIZING','LEAVING_CAFE'])assert.ok(seen.has(state),state);
 assert.ok(s.activities.stats.completed>=10);assert.ok(s.activities.stats.conversations>=3);assert.ok(s.activities.stats.sips>20);assert.equal(s.activities.stats.routeFailures,0);
 s.reset();assert.equal(s.activities.reservations.reservations.size,0);assert.ok(s.agents.every(a=>!a.activity));
 }finally{Math.random=previous;}
});

test('work interrupts café navigation, seating, drinking and conversation immediately and all handoffs still finish',()=>{
 const previous=Math.random;let seed=3;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 try{
 for(const target of ['WALKING_TO_CAFE','SITTING','DRINKING_COFFEE','SOCIALIZING']){
 const s=new Simulation();s.activities.definitions=[{...COFFEE_ACTIVITY,chance:0}];const a=s.agents[0];s.activities.actors=s.agents;assert.ok(s.activities.tryStart(a,s.activities.definitions[0],true));
 // Street encounters are independent of café admissions. Keep this cleanup fixture
 // isolated: an idle resident may legitimately reserve a new meeting after work.
 s.activities.nextEncounter=Infinity;
 if(target==='SOCIALIZING'){assert.ok(s.activities.tryStart(s.agents[1],s.activities.definitions[0],true));}
 advance(s,()=>a.state===target,200);const position={x:a.x,y:a.y},seat=a.activity.pointId;s.start('Interrupt a coffee break');s.assignNext();
 assert.equal(a.activity,null);assert.ok(!s.activities.reservations.reservations.has(seat));assert.deepEqual({x:a.x,y:a.y},position);assert.equal(a.walkPurpose,'collect');assert.equal(s.currentAgent,a);
 advance(s,()=>s.phase==='complete');assert.equal(s.progress,1);assert.equal(s.activities.reservations.reservations.size,0);
 }
 }finally{Math.random=previous;}
});

test('full café waiting times out, removal frees a chair, pause freezes routines and reset preserves positions',()=>{
 const s=new Simulation(),a=s.agents[0];s.activities.actors=s.agents;
 CAFE_SEATS.forEach((p,i)=>s.activities.reservations.reserve(p.id,100+i,0));s.activities.tryStart(a,COFFEE_ACTIVITY,true);assert.equal(a.state,'WAITING_FOR_SEAT');
 for(let i=0;i<180;i++)s.update(1/30);assert.notEqual(a.state,'WAITING_FOR_SEAT');s.activities.reservations.reservations.clear();
 assert.ok(s.activities.tryStart(a,COFFEE_ACTIVITY,true));advance(s,()=>SEATED_STATES.has(a.state),200);const pointId=a.activity.pointId,time=s.activities.time,remaining=a.activity.seatRemaining;
 const chair=CAFE_SEATS.find(p=>p.id===pointId),other=s.agents[1];assert.ok(s.map.navigationView(a).isWalkable(chair.interactionCell.col,chair.interactionCell.row));assert.equal(s.map.navigationView(other).isWalkable(chair.interactionCell.col,chair.interactionCell.row),false);assert.equal(findPath(s.map.navigationView(other),other,chair.interactionCell).length,0);
 s.paused=true;for(let i=0;i<60;i++)s.update(1/30);assert.equal(s.activities.time,time);assert.equal(a.activity.seatRemaining,remaining);s.paused=false;
 s.removeAgent(a.id);assert.ok(!s.activities.reservations.reservations.has(pointId));const positions=s.agents.map(a=>[a.x,a.y]);s.reset();assert.deepEqual(s.agents.map(a=>[a.x,a.y]),positions);assert.equal(s.activities.reservations.reservations.size,0);
});
