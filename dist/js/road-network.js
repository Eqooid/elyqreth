import {WORLD,ROADS,STREET_NODES,CROSSINGS} from './world.js';
export const DIRECTIONS={north:1,east:2,south:4,west:8};
export function junctionKind(mask){
 if(mask===15)return 'four-way';
 if([7,11,13,14].includes(mask))return 't-junction';
 if(mask===5)return 'straight-vertical';if(mask===10)return 'straight-horizontal';
 if([3,6,9,12].includes(mask))return 'corner';
 return mask?'terminal':'isolated';
}
const contains=([x,y,w,h],col,row)=>col>=x&&col<x+w&&row>=y&&row<y+h;

export class RoadNetwork{
 constructor(segments=ROADS,nodes=STREET_NODES){
 this.segments=segments;this.nodes=nodes;this.crossings=CROSSINGS;
 this.nodeById=new Map(nodes.map(n=>[n.id,n]));this.cells=new Uint8Array(WORLD.columns*WORLD.rows);
 for(const s of segments){const [x,y,w,h]=s.tiles;
 if(s.tiles.length!==4||![x,y,w,h].every(Number.isInteger)||w<=0||h<=0||x<0||y<0||x+w>WORLD.columns||y+h>WORLD.rows)throw new RangeError(`${s.id}: road footprint must fit completely inside the city`);
 for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++)this.cells[r*WORLD.columns+c]=s.roadType==='alley'?this.cells[r*WORLD.columns+c]||2:1;}
 this.junctions=nodes.map(n=>({...n,mask:this.nodeMask(n),kind:junctionKind(this.nodeMask(n)),segments:segments.filter(s=>s.from===n.id||s.to===n.id).map(s=>s.id)}));
 this.validate();
 }
 at(col,row){return col>=0&&row>=0&&col<WORLD.columns&&row<WORLD.rows?this.cells[row*WORLD.columns+col]:0;}
 nodeMask(node){let mask=0;for(const s of this.segments.filter(s=>s.from===node.id||s.to===node.id)){
 const other=this.nodeById.get(s.from===node.id?s.to:s.from);if(!other)continue;
 mask|=other.col>node.col?2:other.col<node.col?8:other.row>node.row?4:1;
 }return mask;}
 adjacency(col,row){return (this.at(col,row-1)?1:0)|(this.at(col+1,row)?2:0)|(this.at(col,row+1)?4:0)|(this.at(col-1,row)?8:0);}
 descriptor(col,row){
 const junction=this.junctions.find(n=>!n.endpoint&&Math.abs(col+.5-n.col)<2&&Math.abs(row+.5-n.row)<2);
 const segment=this.segments.find(s=>contains(s.tiles,col,row));
 return {kind:junction?.kind||(`straight-${segment?.axis||'horizontal'}`),mask:this.adjacency(col,row),surface:this.at(col,row)};
 }
 components(predicate=()=>true){const visited=new Set(),components=[];
 for(let r=0;r<WORLD.rows;r++)for(let c=0;c<WORLD.columns;c++){const index=r*WORLD.columns+c;if(!this.at(c,r)||visited.has(index)||!predicate(c,r))continue;
 const q=[[c,r]];visited.add(index);for(let i=0;i<q.length;i++)for(const [dc,dr] of [[0,-1],[1,0],[0,1],[-1,0]]){const x=q[i][0]+dc,y=q[i][1]+dr,key=y*WORLD.columns+x;if(this.at(x,y)&&!visited.has(key)&&predicate(x,y)){visited.add(key);q.push([x,y]);}}
 components.push(q.length);
 }return components;}
 validate(map){
 const errors=[];
 for(const n of this.nodes)if(!Number.isInteger(n.col)||!Number.isInteger(n.row)||n.col<0||n.row<0||n.col>WORLD.columns||n.row>WORLD.rows)errors.push(`${n.id}: node outside city grid boundaries`);
 for(const s of this.segments){const a=this.nodeById.get(s.from),b=this.nodeById.get(s.to);
 if(!a||!b){errors.push(`${s.id}: missing connection`);continue;}
 if((a.col===b.col)===(a.row===b.row))errors.push(`${s.id}: non-cardinal or zero-length road`);
 if(s.width<2||s.width%2)errors.push(`${s.id}: width must be an even tile count`);
 }
 const seen=new Set(),q=this.nodes.length?[this.nodes[0].id]:[];for(let i=0;i<q.length;i++){const id=q[i];if(seen.has(id))continue;seen.add(id);for(const s of this.segments){if(s.from===id)q.push(s.to);if(s.to===id)q.push(s.from);}}
 if(seen.size!==this.nodes.length)errors.push('Street graph has disconnected nodes');
 for(const n of this.junctions)if(n.kind==='terminal'&&!n.endpoint)errors.push(`${n.id}: abrupt, unlabelled ending`);
 const components=this.components();if(components.length!==1)errors.push('Road surface has disconnected components');
 let overwritten=0,blockedAsphalt=0;
 if(map)for(let r=0;r<WORLD.rows;r++)for(let c=0;c<WORLD.columns;c++){const type=this.at(c,r);if(!type)continue;const tile=map.tiles[map.index(c,r)];if(tile!==(type===1?map.terrain.ASPHALT:map.terrain.ALLEY))overwritten++;if(type===1&&!map.isWalkable(c,r))blockedAsphalt++;}
 if(overwritten)errors.push(`${overwritten} road tiles overwritten by another terrain`);
 if(blockedAsphalt)errors.push(`${blockedAsphalt} asphalt cells blocked by solid objects`);
 const result={graphNodes:this.nodes.length,segments:this.segments.length,graphComponents:seen.size===this.nodes.length?1:2,surfaceComponents:components.length,componentSizes:components,asphaltComponents:this.components((c,r)=>this.at(c,r)===1).length,overwritten,blockedAsphalt,errors};
 if(errors.length)throw new Error(`Invalid road network: ${errors.join('; ')}`);this.report=result;return result;
 }
}
