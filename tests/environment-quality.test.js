import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TileMap,TERRAIN} from '../dist/js/tile-map.js';
import {RoadNetwork} from '../dist/js/road-network.js';
import {RoadRenderer} from '../dist/js/roads.js';
import {THEME} from '../dist/js/theme.js';
import {tileVariation,objectDepth} from '../dist/js/environment-quality.js';
import {validateCity,CITY_OBJECTS} from '../dist/js/city-validation.js';
import {URBAN_DETAILS} from '../dist/js/scenery.js';
import {TownScene} from '../dist/js/scene.js';

test('complete city validation preserves terrain, collision and road data',()=>{
 const map=new TileMap(),tiles=map.tiles.slice(),walkable=map.walkable.slice(),roads=map.roads.cells.slice();
 const result=validateCity(map);assert.deepEqual(result.errors,[]);assert.equal(result.valid,true);assert.equal(result.objects,96);assert.ok(result.destinations>=81);
 assert.deepEqual(map.tiles,tiles);assert.deepEqual(map.walkable,walkable);assert.deepEqual(map.roads.cells,roads);
});

test('all cardinal road masks and concave corner orientations match logical neighbors',()=>{
 const roads=new RoadNetwork();roads.cells.fill(0);
 const directions=[[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]],index=(x,y)=>y*116+x;
 for(let mask=0;mask<16;mask++){
  roads.cells.fill(0);roads.cells[index(50,30)]=1;
  for(const [dx,dy,bit]of directions)if(mask&bit)roads.cells[index(50+dx,30+dy)]=1;
  assert.equal(roads.descriptor(50,30).mask,mask);
 }
 roads.cells.fill(1);
 for(const [i,dx,dy]of [[0,-1,-1],[1,1,-1],[2,1,1],[3,-1,1]]){
  roads.cells[index(50+dx,30+dy)]=0;const tile=roads.descriptor(50,30);
  assert.equal(tile.mask,15);assert.equal(tile.cornerMask,1<<i);
  const calls=[],ctx={fillRect(...args){if(this.fillStyle===THEME.road.curb)calls.push(args);}};
  new RoadRenderer().drawTile(ctx,50,30,tile);
  assert.deepEqual(calls,[[800+(dx>0?15:0),480+(dy>0?15:0),1,1]]);
  roads.cells[index(50+dx,30+dy)]=1;
 }
 assert.equal(roads.descriptor(50,30).cornerMask,0);
 for(const pair of [[-.5,0],[116,0],[0,64],[NaN,0],[1.5,2]])assert.equal(roads.at(...pair),0);
});

test('visual road variants are stable, subtle and independent of random state',()=>{
 const renderer=new RoadRenderer(),draw=(col,row)=>{
  const calls=[],c={fillRect(...args){calls.push([this.fillStyle,...args]);}};
  renderer.drawTile(c,col,row,{surface:1,mask:15,cornerMask:0});return calls.map(([color,x,y,w,h])=>[color,x-col*16,y-row*16,w,h]);
 };
 const original=Math.random;Math.random=()=>{throw Error('Rendering requested randomness');};
 try{
  assert.deepEqual(draw(20,20),draw(20,20));assert.notDeepEqual(draw(20,20),draw(36,36));
  const values=[];
  for(let row=0;row<64;row++)for(let col=0;col<116;col++){
   const value=tileVariation(col,row,1);assert.equal(value,tileVariation(col,row,1));assert.ok(Number.isInteger(value)&&value>=0&&value<=0xffffffff);values.push(value);
  }
  assert.ok(new Set(values).size>7000);assert.notEqual(tileVariation(1,1,1),tileVariation(1,1,2));
 }finally{Math.random=original;}
});

test('roof attachments track their host anchor while ordinary objects retain Y depth',()=>{
 const scene=new TownScene({map:new TileMap(),agents:[]});
 const objects=scene.worldObjects.map(e=>e.object);
 for(const roof of objects.filter(o=>o.roofHostId))assert.equal(roof.depth,objectDepth(roof,objects));
 const host={id:'host',y:800,depth:700},roof={id:'roof',y:500,roofHostId:'host',depth:123};
 assert.equal(objectDepth(roof,[host,roof]),701);host.depth=710;assert.equal(objectDepth(roof,[host,roof]),711);
 assert.equal(objectDepth({y:400},[]),400);assert.equal(objectDepth({y:400,depth:350},[]),350);
});

test('validation reports coordinates for broken road visuals, footprints, entrances and isolated destinations',()=>{
 const map=new TileMap();map.tiles[map.index(40,23)]=TERRAIN.GRASS;
 const object={id:'outside',x:0,y:0,width:32,height:32,collision:{col:-1,row:1,columns:1,rows:1}};
 map.rectangle(100,33,3,3,undefined,false);map.rectangle(101,34,1,1,undefined,true);
 const result=validateCity(map,{objects:[object],buildings:[],details:[],destinations:[{id:'blocked-door',col:0,row:0},{id:'island',col:101,row:34}]});
 for(const [category,id]of [['artwork','outside'],['footprint','outside'],['road','tile'],['entrance','blocked-door'],['navigation','island']])assert.ok(result.errors.some(e=>e.category===category&&e.id===id),category);
 const road=result.errors.find(e=>e.category==='road');assert.equal(road.col,40);assert.equal(road.row,23);assert.ok(road.expected);assert.ok(road.actual);
});

test('validation detects overlaps, roof host drift and unsuitable or crowded infill',()=>{
 const map=new TileMap(),detail={...URBAN_DETAILS[0],type:'tree'},duplicate={...detail,id:'duplicate'};
 const result=validateCity(map,{objects:[...CITY_OBJECTS,duplicate,{id:'roof',x:100,y:100,width:10,height:10,roofHostId:'missing'}],buildings:[{id:'a',collision:{col:1,row:1,columns:2,rows:2}},{id:'b',collision:{col:2,row:2,columns:2,rows:2}}],details:[detail,duplicate],destinations:[{id:'entrance',col:detail.collision.col,row:detail.collision.row}]});
 for(const category of ['building-overlap','depth','decoration-context','decoration-access','decoration-overlap','decoration-spacing'])assert.ok(result.errors.some(e=>e.category===category),category);
 const descriptor=map.roads.descriptor.bind(map.roads);map.roads.descriptor=(col,row)=>({...descriptor(col,row),mask:0});
 assert.ok(validateCity(map,{objects:[],buildings:[],details:[],destinations:[]}).errors.some(e=>e.category==='road'));
});
