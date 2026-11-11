import {WORLD,TILE,BUILDINGS,DECORATIONS,POINTS_OF_INTEREST,center} from './world.js';
import {SCENERY,DECORATIVE_BUILDINGS,URBAN_DETAILS} from './scenery.js';
import {CAFE_OBJECTS,PARK_OBJECTS,INTERACTION_POINTS,LOCATIONS} from './locations.js';
import {TERRAIN} from './tile-map.js';
import {findPath} from './pathfinding.js';
import {DECORATION_CONTEXTS,objectDepth} from './environment-quality.js';

const overlaps=(a,b)=>a.col<b.col+b.columns&&a.col+a.columns>b.col&&a.row<b.row+b.rows&&a.row+a.rows>b.row;
const TERRAIN_IDS=new Set(Object.values(TERRAIN));
const parts=(object,map)=>[object.collision??(object.solid?{...map.cellAt(object),columns:1,rows:1}:null),...(object.collisionParts??[])].filter(Boolean);
export const CITY_OBJECTS=[...BUILDINGS,...DECORATIONS,...SCENERY,...CAFE_OBJECTS,...PARK_OBJECTS];
export const CITY_DESTINATIONS=[...BUILDINGS.flatMap(b=>[{id:b.id+'-door',...b.doorCell},{id:b.id+'-work',...b.workCell}]),...INTERACTION_POINTS,...POINTS_OF_INTEREST,...LOCATIONS.flatMap(l=>[{id:l.id+'-entry',...l.entry},{id:l.id+'-exit',...l.exit}])];

// Offline/development check only: no renderer calls, logging or map mutations.
// Navigation intentionally delegates to the production cardinal A* implementation.
export function validateCity(map,{objects=CITY_OBJECTS,buildings=[...BUILDINGS,...DECORATIVE_BUILDINGS],details=URBAN_DETAILS,destinations=CITY_DESTINATIONS,start=center(BUILDINGS[0].doorCell)}={}){
 const errors=[],ids=new Set();
 const fail=(category,id,col,row,expected,actual)=>errors.push({category,id,col,row,expected,actual});
 const fits=p=>[p.col,p.row,p.columns,p.rows].every(Number.isInteger)&&p.columns>0&&p.rows>0&&map.inBounds(p.col,p.row)&&map.inBounds(p.col+p.columns-1,p.row+p.rows-1);
 for(const o of objects){
  if(ids.has(o.id))fail('identity',o.id,null,null,'unique object ID','duplicate');ids.add(o.id);
  const w=o.artWidth??o.width??o.w,h=o.artHeight??o.height??o.h;
  if(![o.x,o.y,w,h].every(Number.isFinite)||w<=0||h<=0||o.x-w/2<0||o.x+w/2>WORLD.width||o.y-h<0||o.y>WORLD.height)fail('artwork',o.id,o.x/TILE,o.y/TILE,'complete artwork inside city',{x:o.x,y:o.y,w,h});
  for(const p of parts(o,map)){
   if(!fits(p)){fail('footprint',o.id,p.col,p.row,'positive integral footprint inside city',p);continue;}
   // Workplaces deliberately have walkable entrance alcoves within their footprint.
   if(BUILDINGS.some(b=>b.id===o.id))continue;
   for(let row=p.row;row<p.row+p.rows;row++)for(let col=p.col;col<p.col+p.columns;col++)if(map.isWalkable(col,row))fail('collision',o.id,col,row,'solid footprint blocks feet','walkable');
  }
  if(o.roofHostId){
   const host=objects.find(h=>h.id===o.roofHostId);
   if(!host)fail('depth',o.id,o.x/TILE,o.y/TILE,'existing rooftop host',o.roofHostId);
   else if(o.collision||o.collisionParts?.length||o.x-w/2<host.x-(host.artWidth??host.width)/2||o.x+w/2>host.x+(host.artWidth??host.width)/2||o.y-h<host.y-(host.artHeight??host.height)||o.y>host.y||(o.depth!==undefined&&o.depth!==objectDepth(o,objects)))fail('depth',o.id,o.x/TILE,o.y/TILE,'nonblocking roof attachment contained by host at host depth + 1',{host:host.id,depth:o.depth});
  }
 }
 for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++)for(const a of parts(buildings[i],map))for(const b of parts(buildings[j],map))if(overlaps(a,b))fail('building-overlap',buildings[i].id,a.col,a.row,'separate building footprints',buildings[j].id);
 for(let row=0;row<map.rows;row++)for(let col=0;col<map.columns;col++){
  const surface=map.roads.at(col,row),tile=map.tiles[map.index(col,row)];
  if(!TERRAIN_IDS.has(tile))fail('terrain','tile',col,row,'known terrain ID',tile);
  if(!surface){if(tile===TERRAIN.ASPHALT||tile===TERRAIN.ALLEY)fail('road','tile',col,row,'road surface backed by logical road',tile);continue;}
  const descriptor=map.roads.descriptor(col,row);
  const expected=[[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]].reduce((mask,[dx,dy,bit])=>mask|(map.roads.at(col+dx,row+dy)?bit:0),0);
  const corners=[[-1,-1,9],[1,-1,3],[1,1,6],[-1,1,12]].reduce((mask,[dx,dy,bits],i)=>mask|((expected&bits)===bits&&!map.roads.at(col+dx,row+dy)?1<<i:0),0);
  if(descriptor.mask!==expected||descriptor.cornerMask!==corners||descriptor.surface!==surface||tile!==(surface===1?TERRAIN.ASPHALT:TERRAIN.ALLEY))fail('road','tile',col,row,'visual surface, cardinal edges and corner joins match logical road',{tile,descriptor,expected,corners});
 }
 for(const p of destinations){
  const cell=p.interactionCell??p,id=p.id??p.name??'destination';
  if(!map.isWalkable(cell.col,cell.row)){fail('entrance',id,cell.col,cell.row,'walkable destination','blocked or outside city');continue;}
  const origin=map.cellAt(start);
  if(!(origin.col===cell.col&&origin.row===cell.row)&&!findPath(map,start,cell).length)fail('navigation',id,cell.col,cell.row,'reachable by existing pedestrian navigation','no path');
 }
 if(details.length>8)fail('decoration-density','urban-infill',null,null,'Balanced infill: at most 8 objects',details.length);
 for(let i=0;i<details.length;i++){
  const d=details[i],f=d.collision;
  if(!DECORATION_CONTEXTS[d.context]?.includes(d.type))fail('decoration-context',d.id,null,null,'type suitable for named context',{context:d.context,type:d.type});
  if(!f||!fits(f)){fail('decoration',d.id,f?.col,f?.row,'valid solid infill footprint',f);continue;}
  for(let row=f.row;row<f.row+f.rows;row++)for(let col=f.col;col<f.col+f.columns;col++)if(map.roads.at(col,row)||map.isWalkable(col,row))fail('decoration-route',d.id,col,row,'solid infill off road and blocked in collision map','road or walkable');
  for(const p of destinations){const cell=p.interactionCell??p,dx=Math.max(f.col-cell.col,0,cell.col-(f.col+f.columns-1)),dy=Math.max(f.row-cell.row,0,cell.row-(f.row+f.rows-1));if(dx+dy<2)fail('decoration-access',d.id,cell.col,cell.row,'two-cell clearance from destinations',p.id??p.name);}
  for(const o of objects)if(o.id!==d.id)for(const p of parts(o,map))if(overlaps(f,p))fail('decoration-overlap',d.id,f.col,f.row,'clear of existing solids',o.id);
  for(const other of details.slice(i+1))if(d.type===other.type&&Math.hypot(d.x-other.x,d.y-other.y)<TILE*3)fail('decoration-spacing',d.id,f.col,f.row,'matching ornaments at least three tiles apart',other.id);
 }
 return {valid:errors.length===0,errors,objects:objects.length,destinations:destinations.length};
}
