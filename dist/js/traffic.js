import {THEME} from './theme.js';
import {TILE,WORLD} from './world.js';

const point=(x,y)=>({x,y});
function arc(cx,cy,r,start,end,steps=16){return Array.from({length:steps+1},(_,i)=>{const a=start+(end-start)*i/steps;return point(cx+Math.cos(a)*r,cy+Math.sin(a)*r);});}
function route(id,points,stopIndex=-1){let length=0;const spans=[];
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],distance=Math.hypot(b.x-a.x,b.y-a.y);if(distance<.01)continue;spans.push({a,b,start:length,length:distance,angle:Math.atan2(b.y-a.y,b.x-a.x)});length+=distance;}
 return {id,points,spans,length,stopDistance:stopIndex<0?null:spans.slice(0,stopIndex).reduce((n,s)=>n+s.length,0)};
}

// Right-hand lanes are defined in world units on the existing boulevard.
// The service alley is pedestrian-only. A short station loop stays in its bay.
const stationPoints=[point(-64,392),point(712,392),...arc(712,424,32,-Math.PI/2,0).slice(1),point(744,636),
 ...arc(752,636,8,Math.PI,0).slice(1),point(760,424),...arc(792,424,32,Math.PI,Math.PI*1.5).slice(1),point(WORLD.width+64,392)];
export const TRAFFIC_ROUTES=[
 route('boulevard-east',[point(-64,392),point(WORLD.width+64,392)]),
 route('boulevard-west',[point(WORLD.width+64,368),point(-64,368)]),
 route('station-loop',stationPoints,18)
];
export function sampleRoute(route,distance){const s=route.spans.find(s=>distance<=s.start+s.length)||route.spans.at(-1),t=Math.max(0,Math.min(1,(distance-s.start)/s.length));return {x:s.a.x+(s.b.x-s.a.x)*t,y:s.a.y+(s.b.y-s.a.y)*t,angle:s.angle};}
export function validateLanes(map,routes=TRAFFIC_ROUTES){
 const errors=[];let samples=0;
 for(const r of routes)for(let d=0;d<=r.length;d+=3){const p=sampleRoute(r,d);if(p.x<0||p.x>=WORLD.width)continue;samples++;
 for(const [dx,dy] of [[0,0],[-7,0],[7,0],[0,-7],[0,7]]){const x=p.x+dx,y=p.y+dy;if(x<0||x>=WORLD.width)continue;const col=Math.floor(x/TILE),row=Math.floor(y/TILE);
 if(map.roads.at(col,row)!==1||!map.canStand(x,y))errors.push(`${r.id} leaves its lane near ${Math.round(x)},${Math.round(y)}`);}
 }
 if(errors.length)throw new Error(errors[0]);return {routes:routes.length,samples,errors};
}
const heading=angle=>Math.abs(Math.cos(angle))>Math.abs(Math.sin(angle))?(Math.cos(angle)>0?0:1):(Math.sin(angle)>0?2:3);
export class TrafficSystem{
 constructor(map,random=Math.random){this.map=map;map.traffic=this;this.random=random;this.routes=TRAFFIC_ROUTES;this.report=validateLanes(map);this.vehicles=[];this.time=0;this.nextSpawn=1.5;this.nextId=1;this.spawned=0;this.exited=0;this.yields=0;this.config={maxVehicles:4,spawnGap:[5.5,11]};}
 spawn(route=this.routes[Math.floor(this.random()*this.routes.length)]){
 if(route.id==='station-loop'&&this.vehicles.some(v=>v.route.id===route.id))return null;
 const p=sampleRoute(route,0);if(this.vehicles.some(v=>Math.hypot(v.x-p.x,v.y-p.y)<120)||this.vehicles.length>=this.config.maxVehicles)return null;
 const v={id:this.nextId++,route,distance:0,...p,speed:0,cruise:44+this.random()*15,style:this.pickStyle(),stopRemaining:0,stopped:false,yielding:false};this.vehicles.push(v);this.spawned++;return v;
 }
 pickStyle(){const r=this.random();return r<.65?0:r<.91?1:2;}
 canEnterCrossing(a,cell){
 const crossing=this.map.roads.crossings.find(({tiles:[x,y,w,h]})=>cell.col>=x&&cell.col<x+w&&cell.row>=y&&cell.row<y+h);if(!crossing)return false;
 const [x,y,w,h]=crossing.tiles;
 return this.vehicles.every(v=>{
  for(let look=0;look<=Math.max(38,v.speed*.8);look+=6){const p=sampleRoute(v.route,v.distance+look);if(p.x>=x*TILE-20&&p.x<=(x+w)*TILE+20&&p.y>=y*TILE-16&&p.y<=(y+h)*TILE+16){if(v.speed>.5||Math.hypot(v.x-a.x,v.y-a.y)<30)return false;}}
  return true;
 });
 }
 update(dt,pedestrians=[]){pedestrians=pedestrians.filter(a=>!a.hidden);this.time+=dt;this.nextSpawn-=dt;if(this.nextSpawn<=0){this.spawn();this.nextSpawn=this.config.spawnGap[0]+this.random()*(this.config.spawnGap[1]-this.config.spawnGap[0]);}
 const occupiedCrossings=this.map.roads.crossings.filter(({tiles:[col,row,w,h]})=>pedestrians.some(a=>{
 const inside=p=>p.x>=col*TILE&&p.x<(col+w)*TILE&&p.y>=row*TILE&&p.y<(row+h)*TILE;
 return inside(a)||(!a.trafficWaiting&&a.moving&&a.path?.length&&inside(a.path[0]));
 }));
 // Predict a braking corridor rather than moving a sprite through a resident.
 for(const v of this.vehicles){v.yielding=false;
 if(v.stopRemaining>0){v.stopRemaining=Math.max(0,v.stopRemaining-dt);v.speed=0;continue;}
 let limit=v.cruise;
 const ahead=sampleRoute(v.route,v.distance+22);if(Math.abs(ahead.angle-v.angle)>.05)limit=24;
 if(v.route.id==='station-loop'&&v.distance>v.route.stopDistance-40&&v.distance<v.route.stopDistance+75)limit=20;
 if(!v.stopped&&v.route.stopDistance!==null)limit=Math.min(limit,Math.sqrt(Math.max(0,2*34*(v.route.stopDistance-v.distance))));
 for(let offset=0;offset<=75;offset+=5){const p=sampleRoute(v.route,v.distance+offset);
 const crossingBlocked=occupiedCrossings.some(({tiles:[col,row,w,h]})=>p.x>col*TILE-10&&p.x<(col+w)*TILE+10&&p.y>row*TILE-10&&p.y<(row+h)*TILE+10);
 const blocked=crossingBlocked||pedestrians.some(a=>{const lateral=Math.abs(-(a.x-p.x)*Math.sin(p.angle)+(a.y-p.y)*Math.cos(p.angle));if(a.trafficWaiting&&lateral>=20)return false;if(lateral<20&&Math.hypot(a.x-p.x,a.y-p.y)<32)return true;const next=a.path?.[0];if(!next||!a.moving)return false;const length=Math.hypot(next.x-a.x,next.y-a.y),advance=Math.min(length,a.speed*.65);const px=a.x+(next.x-a.x)/length*advance,py=a.y+(next.y-a.y)/length*advance;return length>0&&Math.abs(-(px-p.x)*Math.sin(p.angle)+(py-p.y)*Math.cos(p.angle))<20&&Math.hypot(px-p.x,py-p.y)<32;})||this.vehicles.some(o=>{if(o===v)return false;const dx=o.x-p.x,dy=o.y-p.y;return Math.abs(dx*Math.cos(p.angle)+dy*Math.sin(p.angle))<35&&Math.abs(-dx*Math.sin(p.angle)+dy*Math.cos(p.angle))<14;});
 if(blocked){limit=Math.min(limit,Math.sqrt(Math.max(0,2*85*(offset-30))));v.yielding=true;break;}}
 if(v.yielding)this.yields++;
 v.speed=Math.max(0,Math.min(limit,v.speed+24*dt));const distance=Math.min(v.route.length,v.distance+v.speed*dt);
 // At a stop the vehicle decelerates to a precise position, then waits once.
 if(!v.stopped&&v.route.stopDistance!==null&&v.route.stopDistance-distance<.4){v.distance=v.route.stopDistance;v.stopped=true;v.stopRemaining=2.5+this.random()*2;v.speed=0;}
 else v.distance=distance;Object.assign(v,sampleRoute(v.route,v.distance));
 }
 this.vehicles=this.vehicles.filter(v=>{if(v.distance>=v.route.length-.1){this.exited++;return false;}return true;});
 }
 draw(c,v,assets){const frame=v.style*4+heading(v.angle),vertical=heading(v.angle)>1;
 c.fillStyle='#07101b80';c.fillRect(Math.round(v.x-12),Math.round(v.y-5),24,10);
 assets.draw(c,'vehicles',frame,v.x,v.y+5,vertical?21:44,vertical?35:25,'bottom','stretch');
 // Small headlights and brake lights share the entity's lane direction.
 const dx=Math.cos(v.angle),dy=Math.sin(v.angle);c.fillStyle=v.yielding||v.stopRemaining>0?THEME.error+'cc':THEME.primary+'70';
 c.fillRect(Math.round(v.x+dx*15-2),Math.round(v.y+dy*12-4),3,2);if((this.map.activities?.clock.darkness||0)>.4){c.fillStyle=THEME.neon+'75';c.fillRect(Math.round(v.x+dx*19-2),Math.round(v.y+dy*18-2),4,2);}if(v.style===2){c.fillStyle=Math.sin(this.time*3)>0?THEME.primary:THEME.neon;c.fillRect(Math.round(v.x-2),Math.round(v.y-8),4,2);}
 }
}
