import {TILE,BUILDINGS,WORLD} from './world.js';
import {NPC_SERVICE_ZONES} from './citizens.js';
import {SCENERY} from './scenery.js';
import {CAFE_OBJECTS,PARK_OBJECTS} from './locations.js';
export class DeveloperOverlays{
 constructor(){this.enabled=new Set();this.layers=new Map();}
 draw(c,map,traffic,train){if(!this.enabled.size)return;const key=[...this.enabled].sort().join(',');if(!this.layers.has(key)){if(this.layers.size>=3)this.layers.clear();const layer=document.createElement('canvas');layer.width=WORLD.width;layer.height=WORLD.height;this.drawGeometry(layer.getContext('2d'),map,traffic,train);this.layers.set(key,layer);}c.drawImage(this.layers.get(key),0,0);if(this.enabled.has('interactions'))for(const p of map.activities.reservations.snapshot()){c.strokeStyle=p.occupant!==null?'#6fedd7':p.reservedBy!==null?'#ed97cb':'#ffbe6c';c.lineWidth=2;c.strokeRect(p.position.x-7,p.position.y-7,14,14);c.beginPath();c.moveTo(p.position.x,p.position.y);const d={left:[-15,0],right:[15,0],up:[0,-15],down:[0,15]}[p.direction];c.lineTo(p.position.x+d[0],p.position.y+d[1]);c.stroke();}}
 drawGeometry(c,map,traffic,train){c.save();c.lineWidth=1;
 if(this.enabled.has('navigation'))for(let r=0;r<map.rows;r++)for(let col=0;col<map.columns;col++)if(map.isWalkable(col,r)&&map.isPedestrianCell(col,r)){
 c.strokeStyle=map.isCrossing(col,r)?'#ffe79888':map.roads.at(col,r)===1?'#9b718455':'#69d7ac55';c.strokeRect(col*TILE+.5,r*TILE+.5,TILE-1,TILE-1);}
 if(this.enabled.has('collisions')){c.strokeStyle='#ff7299';c.fillStyle='#ff729922';for(const b of [...BUILDINGS,...SCENERY,...CAFE_OBJECTS,...PARK_OBJECTS])for(const p of [b.collision,...(b.collisionParts||[])].filter(Boolean)){c.fillRect(p.col*TILE,p.row*TILE,p.columns*TILE,p.rows*TILE);c.strokeRect(p.col*TILE,p.row*TILE,p.columns*TILE,p.rows*TILE);}}
 if(this.enabled.has('roads')){c.strokeStyle='#ffb963';c.lineWidth=2;for(const s of map.roads.segments){const a=map.roads.nodeById.get(s.from),b=map.roads.nodeById.get(s.to);c.beginPath();c.moveTo(a.col*TILE,a.row*TILE);c.lineTo(b.col*TILE,b.row*TILE);c.stroke();}for(const n of map.roads.nodes){c.fillStyle='#ffb963';c.fillRect(n.col*TILE-3,n.row*TILE-3,6,6);}}
 if(this.enabled.has('lanes')){const colors=['#72d9ce','#b9b0ff','#f3a976'];traffic.routes.forEach((r,i)=>{c.strokeStyle=colors[i];c.setLineDash([4,5]);c.beginPath();r.points.forEach((p,j)=>j?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();});c.setLineDash([]);}
 if(this.enabled.has('services')){c.strokeStyle='#86f0d3';c.setLineDash([4,4]);for(const zone of NPC_SERVICE_ZONES){c.strokeRect(...zone.bounds);c.font='9px monospace';c.fillStyle='#86f0d3';c.fillText(zone.id,zone.bounds[0]+3,zone.bounds[1]-3);}c.setLineDash([]);}
 if(this.enabled.has('train')){c.strokeStyle='#8accef';c.lineWidth=2;c.beginPath();c.moveTo(train.route.start,train.y);c.lineTo(train.route.end,train.y);c.stroke();c.strokeRect(train.route.stop-4,train.y-7,8,14);}
 c.restore();}
}
