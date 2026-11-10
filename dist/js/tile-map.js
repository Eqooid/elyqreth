import {WORLD,TILE,BUILDINGS,DECORATIONS,center,PUBLIC_SPACES,WATER_AREAS,BRIDGES,SIDEWALKS,RAILWAYS} from './world.js';
import {SCENERY} from './scenery.js';
import {CAFE_OBJECTS,INTERACTION_POINTS,PARK_OBJECTS} from './locations.js';
import {RoadNetwork} from './road-network.js';
export const TERRAIN={ASPHALT:0,SIDEWALK:1,PLAZA:2,CONCRETE:3,WATER:4,CANAL:4,GRASS:5,LEAVES:6,FLOOR:7,ALLEY:8,RAILWAY:9,BUILDING:10};
export const GROUND_TEXTURE=[0,1,2,3,4,5,6,7,3,3,3];
export class TileMap{
 constructor(){this.columns=WORLD.columns;this.rows=WORLD.rows;this.tileSize=TILE;this.terrain=TERRAIN;this.roads=new RoadNetwork();this.tiles=new Uint8Array(this.columns*this.rows).fill(TERRAIN.CONCRETE);this.walkable=new Uint8Array(this.tiles.length);this.interactionCells=new Set(INTERACTION_POINTS.map(p=>`${p.interactionCell.col},${p.interactionCell.row}`));this.construct();}
 index(col,row){return row*this.columns+col;}
 inBounds(col,row){return Number.isInteger(col)&&Number.isInteger(row)&&col>=0&&row>=0&&col<this.columns&&row<this.rows;}
 isWalkable(col,row){return this.inBounds(col,row)&&!!this.walkable[this.index(col,row)];}
 cellAt(p){return {col:Math.floor(p.x/TILE),row:Math.floor(p.y/TILE)};}
 canStand(x,y){return this.isWalkable(Math.floor(x/TILE),Math.floor(y/TILE));}
 rectangle(x,y,w,h,tile,walk=true){
 if(![x,y,w,h].every(Number.isInteger)||w<=0||h<=0||x<0||y<0||x+w>this.columns||y+h>this.rows)throw new RangeError('Tile rectangle must fit completely inside the city');
 for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++){const i=this.index(c,r);if(tile!==undefined)this.tiles[i]=tile;this.walkable[i]=Number(walk);}}
 construct(){
 const T=TERRAIN;
 // Compact parcels share a connected sidewalk / alley network.
 this.rectangle(0,0,this.columns,this.rows,T.SIDEWALK);
 for(const space of PUBLIC_SPACES)this.rectangle(...space.tiles,T[space.terrain]);
 for(const path of SIDEWALKS)this.rectangle(...path.tiles,T.SIDEWALK);
 for(const area of WATER_AREAS)this.rectangle(...area,T.WATER,false);
 // The existing front-platform artwork is a physical deck above the canal.
 this.rectangle(50,57,21,3,T.SIDEWALK);
 for(const bridge of BRIDGES)this.rectangle(...bridge,T.SIDEWALK);
 for(const rail of RAILWAYS)this.rectangle(...rail.tiles,T.RAILWAY,false);
 for(const b of BUILDINGS){const [x,y,w,h]=b.tiles;this.rectangle(x,y,w,h,T.BUILDING,false);
 for(const p of b.collisionParts||[])this.rectangle(p.col,p.row,p.columns,p.rows,T.BUILDING,false);
 // A recessed entrance / working alcove. The rest of the building stays solid.
 this.rectangle(b.workCell.col-1,b.workCell.row,3,1,T.FLOOR,true);
 this.rectangle(b.doorCell.col-1,b.doorCell.row,3,1,T.SIDEWALK,true);}
 for(const d of DECORATIONS.filter(d=>d.solid)){const c=this.cellAt(d),p=d.collision??{col:c.col,row:c.row,columns:1,rows:1};
 this.rectangle(p.col,p.row,p.columns,p.rows,undefined,false);}
 for(const d of SCENERY)for(const part of [...(d.collision?[d.collision]:[]),...(d.collisionParts||[])]){const {col,row,columns,rows}=part;
 this.rectangle(col,row,columns,rows,['scenery','architecture','blueprintScenery'].includes(d.atlas)?T.BUILDING:undefined,false);}
 // Furniture blocks feet, not the material underneath it. Keep plaza, grass
 // and sidewalk patterns continuous instead of painting concrete collision boxes.
 for(const d of [...CAFE_OBJECTS,...PARK_OBJECTS])if(d.collision){const p=d.collision;this.rectangle(p.col,p.row,p.columns,p.rows,undefined,false);}
 // Protected street surface: terrain paint order can never trim a corridor.
 // Collision is retained and validation rejects any solid main-street overlap.
 for(let row=0;row<this.rows;row++)for(let col=0;col<this.columns;col++){const type=this.roads.at(col,row);if(type)this.tiles[this.index(col,row)]=type===1?T.ASPHALT:T.ALLEY;}
 // Workplaces and spawn areas must remain accessible even when decorating.
 for(const b of BUILDINGS)for(const p of [b.doorCell,b.workCell])this.walkable[this.index(p.col,p.row)]=1;
 this.roads.validate(this);
 }
 neighbors(cell){return [[0,-1],[1,0],[0,1],[-1,0]].map(([x,y])=>({col:cell.col+x,row:cell.row+y})).filter(p=>this.isWalkable(p.col,p.row)&&this.isPedestrianCell(p.col,p.row));}
 isPedestrianCell(col,row){return this.roads.at(col,row)!==1||this.isCrossing(col,row);}
 isCrossing(col,row){return this.roads.crossings.some(({tiles:[x,y,w,h]})=>col>=x&&col<x+w&&row>=y&&row<y+h);}
 pedestrianCost(cell){return this.roads.at(cell.col,cell.row)===1&&!this.isCrossing(cell.col,cell.row)?9:1;}
 navigationView(actor){
 const blocked=new Set();
 for(const r of this.activities?.reservations.reservations.values()||[])if(r.occupied&&r.ownerId!==actor.id){const point=this.activities.points.find(p=>p.id===r.pointId);if(point)blocked.add(`${point.interactionCell.col},${point.interactionCell.row}`);}
 if(!blocked.size)return this;
 const view=Object.create(this);view.isWalkable=(col,row)=>this.isWalkable(col,row)&&!blocked.has(`${col},${row}`);return view;
 }
 nearestWalkable(p){const origin=this.cellAt(p);if(this.isWalkable(origin.col,origin.row))return origin;let best=null,dist=Infinity;for(let row=0;row<this.rows;row++)for(let col=0;col<this.columns;col++){if(!this.isWalkable(col,row))continue;const d=Math.abs(col-origin.col)+Math.abs(row-origin.row);if(d<dist){dist=d;best={col,row};}}return best;}
 availableCells(){const result=[];for(let row=0;row<this.rows;row++)for(let col=0;col<this.columns;col++)if(this.isWalkable(col,row))result.push({col,row});return result;}
 spawnNear(b,agents){const origin=center(b.doorCell);const free=this.availableCells().filter(c=>{const p=center(c);return agents.every(a=>Math.hypot(a.x-p.x,a.y-p.y)>25);});free.sort((a,b)=>Math.hypot(center(a).x-origin.x,center(a).y-origin.y)-Math.hypot(center(b).x-origin.x,center(b).y-origin.y));return center(free[0]||b.doorCell);}
}
