import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssetManager} from '../dist/js/assets.js';
import {TileMap,TERRAIN} from '../dist/js/tile-map.js';
import {RoadRenderer} from '../dist/js/roads.js';
import {THEME} from '../dist/js/theme.js';
import {WORLD,TILE,BUILDINGS,DECORATIONS} from '../dist/js/world.js';
import {SCENERY,URBAN_DETAILS} from '../dist/js/scenery.js';
import {INTERACTION_POINTS,CAFE_OBJECTS,PARK_OBJECTS} from '../dist/js/locations.js';
import {TownScene} from '../dist/js/scene.js';
import {Simulation} from '../dist/js/simulation.js';

test('cached ground samples meet on integer world coordinates without resampling the atlas per cell',()=>{
 const assets=new AssetManager(),pattern={width:256,height:256},draws=[];
 assets.terrainPatterns.set(1,pattern);
 const c={drawImage(...args){draws.push(args);}};
 for(const x of [112,128,240,256])assets.tile(c,1,x,16,TILE);
 assert.deepEqual(draws.map(d=>d.slice(1)),[[112,16,16,16,112,16,16,16],[128,16,16,16,128,16,16,16],[240,16,16,16,240,16,16,16],[0,16,16,16,256,16,16,16]]);
 assert.ok(draws.every(d=>d[0]===pattern));assert.equal(assets.terrainPatterns.size,1);
});

test('furniture retains each underlying material instead of painting concrete collision boxes',()=>{
 const map=new TileMap();
 for(const [col,row,terrain]of [[21,40,TERRAIN.PLAZA],[97,18,TERRAIN.SIDEWALK],[33,47,TERRAIN.PLAZA],[34,47,TERRAIN.GRASS]]){
  assert.equal(map.tiles[map.index(col,row)],terrain);assert.equal(map.isWalkable(col,row),false);
 }
 for(let row=0;row<map.rows;row++)for(let col=0;col<map.columns;col++)if(map.tiles[map.index(col,row)]===TERRAIN.FLOOR){
  assert.ok(BUILDINGS.some(b=>col>=b.tiles[0]&&col<b.tiles[0]+b.tiles[2]&&row>=b.tiles[1]&&row<b.tiles[1]+b.tiles[3]),'Interior floor escaped a building');
 }
});

test('surface edges join corners on the paving side without drawing across connected paving',()=>{
 const T=TERRAIN,tiles=new Uint8Array([T.BUILDING,T.GRASS,T.BUILDING,T.GRASS,T.SIDEWALK,T.WATER,T.BUILDING,T.PLAZA,T.BUILDING]);
 const map={columns:3,rows:3,tiles,index:(x,y)=>y*3+x,inBounds:(x,y)=>x>=0&&y>=0&&x<3&&y<3};
 const before=tiles.slice(),calls=[],c={fillRect(x,y,w,h){calls.push({x,y,w,h,color:this.fillStyle});}};
 new RoadRenderer().drawSurfaceEdges(c,map);
 assert.deepEqual(calls.filter(r=>r.x>=16&&r.x<32&&r.y>=16&&r.y<32),[
  {x:16,y:16,w:1,h:16,color:THEME.materials.navy},
  {x:31,y:16,w:1,h:16,color:THEME.road.curb},
  {x:16,y:16,w:16,h:1,color:THEME.materials.navy}
 ]);
 assert.deepEqual(tiles,before);
});

test('the existing terrace garden retains grass with connected paving around all four sides',()=>{
 const map=new TileMap();
 for(let row=28;row<40;row++)for(let col=99;col<113;col++)assert.equal(map.tiles[map.index(col,row)],TERRAIN.GRASS);
 for(let col=96;col<116;col++)for(const row of [27,40])assert.equal(map.tiles[map.index(col,row)],TERRAIN.SIDEWALK);
 for(let row=28;row<40;row++)for(const col of [98,113]){assert.equal(map.tiles[map.index(col,row)],TERRAIN.SIDEWALK);assert.equal(map.isWalkable(col,row),true);}
});

test('the existing station vent draws on its host roof and remains nonblocking',()=>{
 const scene=new TownScene(new Simulation()),order=scene.worldObjects.slice().sort((a,b)=>(a.object.depth??a.object.y)-(b.object.depth??b.object.y));
 const index=id=>order.findIndex(o=>o.object.id===id),station=BUILDINGS.find(b=>b.id==='station'),vent=SCENERY.find(d=>d.id==='station-vent');
 assert.ok(index('station')<index('station-vent'));assert.ok(index('station-vent')<index('station-front-platform'));
 assert.equal(vent.collision,null);assert.ok(vent.x-vent.width/2>=station.x-station.width/2&&vent.x+vent.width/2<=station.x+station.width/2);
 assert.ok(vent.y-vent.height>=station.y-station.height&&vent.y<=station.y);
});

test('urban infill is sparse, clear of roads and existing solids, and away from activity anchors',()=>{
 const map=new TileMap(),prior=[...BUILDINGS,...DECORATIONS,...SCENERY.filter(d=>!URBAN_DETAILS.includes(d)),...CAFE_OBJECTS,...PARK_OBJECTS];
 assert.ok(URBAN_DETAILS.length>0&&URBAN_DETAILS.length<=8);assert.equal(new Set(URBAN_DETAILS.map(d=>d.id)).size,URBAN_DETAILS.length);
 for(const d of URBAN_DETAILS){
  const f=d.collision;assert.ok(d.x-d.width/2>=0&&d.x+d.width/2<=WORLD.width&&d.y-d.height>=0&&d.y<=WORLD.height,d.id);
  assert.equal(map.roads.at(f.col,f.row),0,d.id);assert.equal(map.isWalkable(f.col,f.row),false,d.id);
  for(const p of INTERACTION_POINTS)assert.ok(Math.abs(p.interactionCell.col-f.col)+Math.abs(p.interactionCell.row-f.row)>=2,d.id+' crowds '+p.id);
  for(const old of prior){
   const fallback=old.solid?{...map.cellAt(old),columns:1,rows:1}:null;
   for(const p of [old.collision??fallback,...(old.collisionParts??[])].filter(Boolean))assert.ok(!(f.col<p.col+p.columns&&f.col+f.columns>p.col&&f.row<p.row+p.rows&&f.row+f.rows>p.row),d.id+' overlaps '+old.id);
  }
 }
 assert.equal(URBAN_DETAILS.filter(d=>d.light).length,1,'Reuse existing lamps without multiplying light effects');
});
