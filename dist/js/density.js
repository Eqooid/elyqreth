import {BUILDINGS,URBAN_BLOCKS,WORLD} from './world.js';
import {DECORATIVE_BUILDINGS} from './scenery.js';
const contains=([x,y,w,h],col,row)=>col>=x&&col<x+w&&row>=y&&row<y+h;
export const buildingFootprints=()=>[...BUILDINGS.map(b=>b.tiles),...DECORATIVE_BUILDINGS.map(b=>{const f=b.collision;return [f.col,f.row,f.columns,f.rows];})];
// Count unique footprint cells, never sprite canopy area or overlapping rectangles.
export function measureBlock(block){
 const footprints=buildingFootprints(),[x,y,w,h]=block.tiles;let eligibleCells=0,buildingCells=0;
 for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){
 if(block.publicSpaces?.some(rect=>contains(rect,col,row)))continue;
 eligibleCells++;if(footprints.some(rect=>contains(rect,col,row)))buildingCells++;
 }
 return {id:block.id,name:block.name,tiles:block.tiles,publicSpaces:block.publicSpaces||[],eligibleCells,buildingCells,coverage:Math.round(buildingCells/eligibleCells*1000)/10};
}
export const densityReport=()=>({world:WORLD,buildingCount:buildingFootprints().length,
 method:'Union of collision footprints, clipped to street-bounded parcels. Reference-aligned district bounds include setbacks and alleys. Public spaces are excluded only where explicitly named. Entrance alcoves remain part of the gross architectural footprint.',
 blocks:URBAN_BLOCKS.map(measureBlock),map:measureBlock({id:'entire-map',tiles:[0,0,WORLD.columns,WORLD.rows]})});
