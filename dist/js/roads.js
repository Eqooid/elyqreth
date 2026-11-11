import {THEME} from './theme.js';
import {TILE,WORLD} from './world.js';
import {TERRAIN} from './tile-map.js';
import {tileVariation} from './environment-quality.js';
const PAVING=new Set([TERRAIN.SIDEWALK,TERRAIN.PLAZA,TERRAIN.CONCRETE,TERRAIN.FLOOR]);
const GROUND_EDGES=[[-1,0,0,0,1,TILE],[1,0,TILE-1,0,1,TILE],[0,-1,0,0,TILE,1],[0,1,0,TILE-1,TILE,1]];

// Reusable adjacency tiles. Pixel aggregate varies deterministically; topology,
// edges, corners, crossings and lane placement always follow the street graph.
export class RoadRenderer{
 drawSurfaceEdges(c,map){
 // Quiet borders sit on the paving side. Shared paving edges and bridge
 // entrances stay open; this pass changes no terrain or navigation cells.
 for(let row=0;row<map.rows;row++)for(let col=0;col<map.columns;col++){
  if(!PAVING.has(map.tiles[map.index(col,row)]))continue;
  for(const [dc,dr,x,y,w,h]of GROUND_EDGES){const nx=col+dc,ny=row+dr;if(!map.inBounds(nx,ny))continue;
   const next=map.tiles[map.index(nx,ny)];
   if(next!==TERRAIN.GRASS&&next!==TERRAIN.LEAVES&&next!==TERRAIN.WATER)continue;
   c.fillStyle=next===TERRAIN.WATER?THEME.road.curb:THEME.materials.navy;c.fillRect(col*TILE+x,row*TILE+y,w,h);
  }
 }
 }
 draw(c,map){
 const network=map.roads;network.validate(map);
 for(let row=0;row<map.rows;row++)for(let col=0;col<map.columns;col++)if(network.at(col,row))this.drawTile(c,col,row,network.descriptor(col,row));
 const junctionAt=(x,y)=>network.junctions.some(n=>!n.endpoint&&Math.abs(x-n.col*TILE)<TILE*2+8&&Math.abs(y-n.row*TILE)<TILE*2+8);
 c.fillStyle=THEME.road.marking;
 for(const segment of network.segments.filter(s=>s.roadType==='asphalt')){
 const a=network.nodeById.get(segment.from),b=network.nodeById.get(segment.to);
 if(segment.axis==='horizontal'){
 const y=a.row*TILE;for(let x=Math.ceil(Math.min(a.col,b.col)*TILE/48)*48+10;x<Math.max(a.col,b.col)*TILE;x+=48)if(!junctionAt(x,y)&&!this.inCrossing(network,x,y))c.fillRect(x,y-1,18,2);
 }else{
 const x=a.col*TILE;for(let y=Math.ceil(Math.min(a.row,b.row)*TILE/48)*48+10;y<Math.max(a.row,b.row)*TILE-24;y+=48)if(!junctionAt(x,y)&&!this.inCrossing(network,x,y))c.fillRect(x-1,y,2,18);
 }
 }
 // Pedestrian crossings belong to named corridors, never random ground cells.
 c.fillStyle=THEME.road.crossing;for(const crossing of network.crossings){const [col,row,w,h]=crossing.tiles,x=col*TILE,y=row*TILE;
 // Equal stripe widths and six-pixel curb margins on every named crossing.
 if(crossing.axis==='horizontal')for(let py=y+7;py<y+h*TILE-7;py+=9)c.fillRect(x+5,py,w*TILE-10,4);
 else for(let px=x+7;px<x+w*TILE-7;px+=9)c.fillRect(px,y+5,4,h*TILE-10);
 }
 // Named terminal bays have visible end curbs and parking/delivery markings.
 for(const n of network.junctions.filter(n=>n.endpoint==='destination')){
 const width=Math.max(...network.segments.filter(s=>s.to===n.id||s.from===n.id).map(s=>s.width))*TILE;
 const x=n.col*TILE,y=n.row*TILE;c.fillStyle=THEME.road.marking;c.fillRect(x-width/2+7,y+width/2-6,width-14,2);
 if(n.id==='station-dropoff'){
 c.strokeStyle='#777f87';c.lineWidth=1;c.beginPath();c.arc(x,y-20,19,0,Math.PI);c.stroke();
 c.fillStyle='#879198';c.fillRect(x-width/2+7,y-55,13,2);c.fillRect(x+width/2-20,y-55,13,2);
 }else{c.fillStyle='#4b505a';c.fillRect(x-7,y+3,14,2);}
 }
 }
 inCrossing(network,x,y){return network.crossings.some(({tiles:[col,row,w,h]})=>x>=col*TILE-8&&x<(col+w)*TILE+8&&y>=row*TILE-8&&y<(row+h)*TILE+8);}
 drawTile(c,col,row,tile){
 const x=col*TILE,y=row*TILE,alley=tile.surface===2;
 c.fillStyle=alley?THEME.road.alley:THEME.road.asphalt;c.fillRect(x,y,TILE,TILE);
 const variation=tileVariation(col,row,tile.surface);
 for(let i=0;i<10;i++){c.fillStyle=THEME.road.grain[i%2];c.fillRect(x+((variation&15)+i*5)%TILE,y+(((variation>>>8)&15)+i*7)%TILE,1,1);}
 if(alley){c.fillStyle='#181e28';if(col%2===0)c.fillRect(x+TILE-1,y,1,TILE);}
 else if((col+row*7)%9===0){c.fillStyle='#131d2b';c.fillRect(x+3,y+7,5,1);c.fillRect(x+7,y+8,3,1);}
 // Shared edges are omitted. This is the same rule for straight, corner, T and
 // four-way tiles, so a junction never gets a curb drawn across its connections.
 // A quiet gutter sits inside a continuous one-pixel curb. Shared tile edges
 // have neither line nor texture seam; decorative grain uses world coordinates.
 c.fillStyle='#131c28';if(!(tile.mask&1))c.fillRect(x,y,TILE,4);if(!(tile.mask&4))c.fillRect(x,y+TILE-4,TILE,4);
 if(!(tile.mask&8))c.fillRect(x,y,4,TILE);if(!(tile.mask&2))c.fillRect(x+TILE-4,y,4,TILE);
 c.fillStyle=THEME.road.curb;if(!(tile.mask&1))c.fillRect(x,y,TILE,1);if(!(tile.mask&4))c.fillRect(x,y+TILE-1,TILE,1);
 if(!(tile.mask&8))c.fillRect(x,y,1,TILE);if(!(tile.mask&2))c.fillRect(x+TILE-1,y,1,TILE);
 for(const [i,dx,dy]of [[0,0,0],[1,TILE-1,0],[2,TILE-1,TILE-1],[3,0,TILE-1]])if(tile.cornerMask&(1<<i))c.fillRect(x+dx,y+dy,1,1);
 // Sparse drains are aligned to curb runs, not scattered across the asphalt.
 if(!alley&&col%12===6&&!(tile.mask&4)){c.fillStyle='#101925';c.fillRect(x+4,y+TILE-5,8,3);c.fillStyle='#394551';for(let k=0;k<4;k++)c.fillRect(x+4+k*2,y+TILE-5,1,2);}
 }
 drawDebug(c,map){
 const n=map.roads;c.fillStyle='#111822';c.fillRect(0,0,WORLD.width,WORLD.height);
 const colors={1:'#27333e',2:'#294938',4:'#103c50',8:'#826146',9:'#626875',10:'#303845'};
 for(let row=0;row<map.rows;row++)for(let col=0;col<map.columns;col++){const tile=map.tiles[map.index(col,row)];c.fillStyle=colors[tile]||'#171e29';c.fillRect(col*TILE,row*TILE,TILE-1,TILE-1);}
 const palette=['#51b9d1','#66c7b3','#63adcf','#cfb561','#ad8158'];
 for(let i=0;i<n.segments.length;i++){const s=n.segments[i],[x,y,w,h]=s.tiles;
 c.globalAlpha=.65;c.fillStyle=palette[i];c.fillRect(x*TILE,y*TILE,w*TILE,h*TILE);c.globalAlpha=1;
 const a=n.nodeById.get(s.from),b=n.nodeById.get(s.to),px=(a.col+b.col)*TILE/2,py=(a.row+b.row)*TILE/2;
 c.fillStyle='#f4eedb';c.font='14px ui-monospace,monospace';c.textAlign='center';c.fillText(`${s.id} · ${s.width*TILE}px`,px,py-11);
 }
 for(const node of n.junctions){const x=node.col*TILE,y=node.row*TILE;c.fillStyle=node.endpoint?'#ffe09b':'#f288bf';c.fillRect(Math.max(4,Math.min(x-5,WORLD.width-14)),y-5,10,10);
 c.textAlign=node.col>82?'right':node.col===0?'left':'center';c.fillStyle='#f9e8e0';c.font='14px ui-monospace,monospace';c.fillText(`${node.name} · ${node.kind}`,Math.max(8,Math.min(x,WORLD.width-8)),y+49);
 }
 c.textAlign='left';c.fillStyle='#e4ded0';c.font='18px ui-monospace,monospace';c.fillText('ROAD NETWORK CHECK',28,96);
 c.font='15px ui-monospace,monospace';c.fillText(`${n.report.surfaceComponents} connected surface · ${n.report.overwritten} overwritten tiles · ${n.report.blockedAsphalt} blocked asphalt cells`,28,124);
 c.fillText('Cyan: asphalt   Amber: alley   Pink: junction   Gray: buildings / rail   Blue: canal',28,151);
 }
}
