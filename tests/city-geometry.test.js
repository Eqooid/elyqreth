import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WORLD,TILE,BUILDINGS,DECORATIONS,ROADS,POINTS_OF_INTEREST,center,containedArtwork} from '../dist/js/world.js';
import {SCENERY,DECORATIVE_BUILDINGS} from '../dist/js/scenery.js';
import {CAFE_OBJECTS,PARK_OBJECTS,INTERACTION_POINTS,LOCATIONS,HOME_LOCATIONS,PARK_LOCATION} from '../dist/js/locations.js';
import {TileMap} from '../dist/js/tile-map.js';
import {RoadNetwork} from '../dist/js/road-network.js';
import {findPath} from '../dist/js/pathfinding.js';
import {Simulation} from '../dist/js/simulation.js';
import {Citizens} from '../dist/js/citizens.js';

const objects=[...BUILDINGS,...DECORATIONS,...SCENERY,...CAFE_OBJECTS,...PARK_OBJECTS];
const inside=([x,y,w,h])=>x>=0&&y>=0&&w>0&&h>0&&x+w<=WORLD.width&&y+h<=WORLD.height;

test('complete static artwork fits all map edges without changing the city inventory',()=>{
 assert.deepEqual(WORLD,{width:1856,height:1024,columns:116,rows:64});
 assert.equal(BUILDINGS.length,6);assert.equal(DECORATIVE_BUILDINGS.length,9);assert.equal(SCENERY.length,31);assert.equal(DECORATIONS.length,33);assert.equal(ROADS.length,5);
 assert.equal(new Set(objects.map(o=>o.id)).size,objects.length);
 for(const o of objects){const w=o.artWidth??o.width??o.w,h=o.artHeight??o.height??o.h;assert.ok(inside([o.x-w/2,o.y-h,w,h]),o.id);}
 for(const home of HOME_LOCATIONS){const building=DECORATIVE_BUILDINGS.find(b=>b.id===home.buildingId);assert.deepEqual(home.bounds,building.referenceBounds);}
});

test('edge artwork fitting keeps valid positions and scales complete frames proportionally',()=>{
 const valid=[400,200,192,256];assert.deepEqual(containedArtwork(valid),valid);
 for(const box of [[-32,300,160,200],[1800,300,160,200],[400,-100,160,300],[400,900,160,300]]){
  const result=containedArtwork(box);assert.ok(inside(result));
  assert.ok(result[2]<=box[2]&&result[3]<=box[3]);
  assert.ok(Math.abs(result[2]/box[2]-result[3]/box[3])<=1/box[2]+1/box[3]);
 }
 for(const invalid of [[-100,0,20,20],[0,-100,20,20],[WORLD.width,0,20,20],[0,WORLD.height,20,20],[0,0,NaN,20]])assert.throws(()=>containedArtwork(invalid),RangeError);
});

test('tile painting rejects partial off-map footprints before writing or wrapping rows',()=>{
 const map=new TileMap(),tiles=map.tiles.slice(),walkable=map.walkable.slice();
 for(const rect of [[-1,3,2,2],[3,-1,2,2],[WORLD.columns-1,3,2,2],[3,WORLD.rows-1,2,2],[1.5,2,2,2]])assert.throws(()=>map.rectangle(...rect,0),RangeError);
 assert.deepEqual(map.tiles,tiles);assert.deepEqual(map.walkable,walkable);
 for(const [x,y] of [[-1,0],[0,-1],[WORLD.columns,0],[0,WORLD.rows],[.5,0],[NaN,0],[Infinity,0]])assert.equal(map.isWalkable(x,y),false);
 const paint=new TileMap();for(const [x,y] of [[0,0],[WORLD.columns-1,0],[0,WORLD.rows-1],[WORLD.columns-1,WORLD.rows-1]]){paint.rectangle(x,y,1,1,0);assert.equal(paint.isWalkable(x,y),true);}
});

test('roads remain tile-aligned, connected and clear; out-of-map surfaces are rejected',()=>{
 const map=new TileMap();assert.equal(map.roads.report.surfaceComponents,1);assert.equal(map.roads.report.blockedAsphalt,0);assert.equal(map.roads.report.overwritten,0);
 for(const road of ROADS)assert.ok(road.tiles.every(Number.isInteger));
 for(const rect of [[-1,22,2,4],[0,-1,2,4],[WORLD.columns-1,22,2,4],[0,WORLD.rows-1,2,4]]){
  const roads=ROADS.map((r,i)=>({...r,tiles:i===0?rect:[...r.tiles]}));assert.throws(()=>new RoadNetwork(roads),/footprint must fit/);
 }
});

test('solid furniture blocks its full ground rectangle while every entrance and activity point stays reachable',()=>{
 const map=new TileMap(),start=center(BUILDINGS[0].doorCell);
 for(const o of objects)for(const p of [o.collision,...(o.collisionParts??[])].filter(Boolean)){
  assert.ok([p.col,p.row,p.columns,p.rows].every(Number.isInteger),o.id);
  assert.ok(p.col>=0&&p.row>=0&&p.columns>0&&p.rows>0&&p.col+p.columns<=WORLD.columns&&p.row+p.rows<=WORLD.rows,o.id);
  if(BUILDINGS.includes(o))continue; // Existing workplace entrance alcoves are deliberately walkable.
  for(let row=p.row;row<p.row+p.rows;row++)for(let col=p.col;col<p.col+p.columns;col++)assert.equal(map.isWalkable(col,row),false,o.id);
 }
 for(const point of [...INTERACTION_POINTS,...POINTS_OF_INTEREST,...LOCATIONS.flatMap(l=>[l.entry,l.exit])]){
  const cell=point.interactionCell??point;assert.equal(map.isWalkable(cell.col,cell.row),true,point.id??point.name);
  assert.ok(findPath(map,start,cell).length||cell.col===BUILDINGS[0].doorCell.col&&cell.row===BUILDINGS[0].doorCell.row,point.id??point.name);
 }
 assert.equal(map.isWalkable(27,46),false,'The globe pedestal must not remain a pedestrian destination');
 assert.equal(map.isWalkable(PARK_LOCATION.exit.col,PARK_LOCATION.exit.row),true);
});

test('visible residents and transit visitors remain in-map and on walkable feet without changing identities',()=>{
 const original=Math.random;let seed=141;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 try{
  const sim=new Simulation(),people=new Citizens(sim.map,sim.agents),ids=sim.agents.map(a=>a.npcId),camera={width:1,height:1,screenAt:()=>({x:-1000,y:-1000})};
  people.setTarget(6);
  for(let i=0;i<120*30;i++){
   sim.update(1/30);people.update(1/30,sim.agents,camera);
   for(const actor of [...sim.agents,...people.allPeople].filter(a=>!a.hidden)){
    assert.ok(actor.x>=15&&actor.x<=WORLD.width-15&&actor.y>=42&&actor.y<=WORLD.height,actor.name);
    assert.ok(sim.map.canStand(actor.x,actor.y),actor.name);
   }
  }
  assert.deepEqual(sim.agents.map(a=>a.npcId),ids);assert.ok(people.spawned>5);
 }finally{Math.random=original;}
});
