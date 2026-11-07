import {center,POINTS_OF_INTEREST} from './world.js';
import {findPath} from './pathfinding.js';
import {STATE,setState} from './agent-state.js';
import {SpriteAnimator} from './animator.js';
const random=(min,max)=>min+Math.random()*(max-min);
const clearOfCars=(a,b,cars)=>cars.every(v=>{const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;const t=length?Math.max(0,Math.min(1,((v.x-a.x)*dx+(v.y-a.y)*dy)/length)):0;return Math.hypot(v.x-a.x-dx*t,v.y-a.y-dy*t)>=23;});
export function initializeMovement(a){Object.assign(a,{path:[],walkPurpose:null,direction:'down',moving:false,speed:random(66,84),pauseRemaining:0,idleRemaining:random(.1,1.3),completedRemaining:0,congestion:0,avoidanceGrace:0,stepsSincePause:0,lastDestination:null,recentDestinations:[],lookRemaining:random(.8,1.8),animator:new SpriteAnimator(a.id)});setState(a,STATE.IDLE);}
export function navigate(map,a,destination,purpose){a.path=findPath(map.navigationView?.(a)||map,a,destination);a.walkPurpose=purpose;a.pauseRemaining=0;a.stepsSincePause=0;a.congestion=0;
 setState(a,purpose==='wander'?STATE.WANDERING:purpose==='work'?STATE.WALKING_TO_WORK:STATE.WALKING);return a.path.length>0;}
function wander(map,a,agents){
 const relevant=a.decorative&&a.visitorRole==='Station passenger'?POINTS_OF_INTEREST.filter(p=>['Station forecourt','Dock promenade','Lower canal bridge'].includes(p.name)):a.decorative&&a.visitorRole==='Street cleaner'?POINTS_OF_INTEREST.filter(p=>['Globe plaza','Garden walk','South garden'].includes(p.name)):POINTS_OF_INTEREST;
 const choices=Math.random()<.85?relevant:map.availableCells().filter(c=>map.roads.at(c.col,c.row)!==1&&!map.interactionCells?.has(`${c.col},${c.row}`));
 for(let i=0;i<20;i++){const goal=choices[Math.floor(Math.random()*choices.length)];if(!goal||map.interactionCells?.has(`${goal.col},${goal.row}`)||!map.isWalkable(goal.col,goal.row)||a.recentDestinations.includes(`${goal.col},${goal.row}`))continue;const p=center(goal);if(Math.hypot(a.x-p.x,a.y-p.y)<96||agents.some(o=>o!==a&&Math.hypot(o.x-p.x,o.y-p.y)<24))continue;const path=findPath(map.navigationView?.(a)||map,a,goal);if(path.length){a.lastDestination=goal.name||'Town sidewalk';a.recentDestinations.push(`${goal.col},${goal.row}`);a.recentDestinations=a.recentDestinations.slice(-4);navigate(map,a,goal,'wander');return;}}
 a.idleRemaining=random(.8,2.5);
}
export function updateAgent(map,a,agents,dt,onArrival){
 a.moving=false;a.trafficWaiting=false;if(a.hidden)return;a.avoidanceGrace=Math.max(0,a.avoidanceGrace-dt);a.trafficRepathRemaining=Math.max(0,(a.trafficRepathRemaining||0)-dt);
 if(a.pauseRemaining>0){a.pauseRemaining-=dt;}
 else if(a.path.length){let remaining=a.speed*dt;
 const pedestrianView=map.navigationView?.(a)||map;
 while(a.path.length&&remaining>0){const next=a.path[0],dx=next.x-a.x,dy=next.y-a.y,len=Math.hypot(dx,dy);const dir=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
 // Right-of-way: task traffic takes priority; otherwise the older resident goes first.
 const look=Math.min(remaining,len),nx=a.x+(len?dx/len*look:0),ny=a.y+(len?dy/len*look:0);
 const cars=map.traffic?.vehicles||[];
 const startCell=map.cellAt(a),nextCell=map.cellAt({x:nx,y:ny}),crossingTarget=map.cellAt(next);
 // Wait on the sidewalk while a moving car owns the crossing. Waiting
 // pedestrians do not make cars yield indefinitely; once the lane clears,
 // entering pedestrians own the crossing until their feet leave its asphalt.
 if(map.roads.at(startCell.col,startCell.row)!==1&&map.roads.at(crossingTarget.col,crossingTarget.row)===1&&map.isCrossing(crossingTarget.col,crossingTarget.row)&&map.traffic&&!map.traffic.canEnterCrossing(a,crossingTarget)){
  a.trafficWaiting=true;a.crossingWait=(a.crossingWait||0)+dt;break;
 }
 if(map.roads.at(nextCell.col,nextCell.row)!==1)a.crossingWait=0;

 if(cars.some(v=>Math.hypot(v.x-nx,v.y-ny)<23)){
 a.trafficWaiting=true;a.trafficDelay=(a.trafficDelay||0)+dt;
 if(a.trafficDelay>.8&&a.trafficRepathRemaining<=0){a.trafficRepathRemaining=.75;
 // If a vehicle is already in the crossing, pause outside its footprint. A
 // stalled head-on encounter gets a local A* detour without losing the task.
 const start=map.cellAt(a),goal=map.cellAt(a.path.at(-1));
 const free=cell=>map.isWalkable(cell.col,cell.row)&&cars.every(v=>Math.hypot(v.x-center(cell).x,v.y-center(cell).y)>=23);
 const view={startPoint:{x:a.x,y:a.y},nearestWalkable:()=>start,cellAt:p=>map.cellAt(p),isWalkable:(col,row)=>free({col,row}),neighbors:cell=>map.neighbors(cell).filter(free).filter(next=>clearOfCars(cell.col===start.col&&cell.row===start.row?a:center(cell),center(next),cars)),pedestrianCost:cell=>map.pedestrianCost(cell)};
 const path=findPath(view,a,goal);
 if(path.length){const p=path[0];if(Math.abs(p.x-a.x)>.1&&Math.abs(p.y-a.y)>.1){const elbow=[{x:a.x,y:p.y},{x:p.x,y:a.y}].find(elbow=>map.canStand(elbow.x,elbow.y)&&clearOfCars(a,elbow,cars)&&clearOfCars(elbow,p,cars));if(elbow)path.unshift(elbow);else break;}a.path=path;a.trafficDelay=0;}
 }
 break;
 }a.trafficDelay=0;
 if(!pedestrianView.canStand(nx,ny)&&map.canStand(nx,ny)){const detour=findPath(pedestrianView,a,map.cellAt(a.path.at(-1)));if(detour.length)a.path=detour;break;}
 const priority=actor=>['collect','work','deliver'].includes(actor.walkPurpose)?1:0;
 const blocker=agents.find(o=>o!==a&&!o.hidden&&Math.hypot(o.x-nx,o.y-ny)<17&&Math.hypot(o.x-nx,o.y-ny)<Math.hypot(o.x-a.x,o.y-a.y)&&((o.path.length&&(priority(o)>priority(a)||priority(o)===priority(a)&&o.id<a.id))||!o.path.length));
 if(blocker&&a.avoidanceGrace<=0){if(a.congestion<.65){a.congestion+=dt;break;}a.avoidanceGrace=.9;} // Brief courtesy pause; never permanent deadlock.
 if(!map.canStand(nx,ny)){a.path=[];setState(a,STATE.IDLE);a.idleRemaining=.3;break;}
 a.direction=dir;a.moving=true;a.congestion=0;
 if(len<=remaining){a.x=next.x;a.y=next.y;a.path.shift();remaining-=len;a.stepsSincePause++;
 if(a.path.length&&a.walkPurpose==='wander'&&a.stepsSincePause>4&&Math.random()<.16){a.pauseRemaining=random(.35,1.2);a.stepsSincePause=0;break;}}
 else{a.x=nx;a.y=ny;remaining=0;}
 }
 if(!a.path.length&&a.moving)onArrival(a);
 }else if(a.state===STATE.COMPLETED){a.completedRemaining-=dt;if(a.completedRemaining<=0){setState(a,STATE.IDLE);a.idleRemaining=random(.5,2);}}
 else if(a.state===STATE.IDLE||a.state===STATE.WAITING){a.idleRemaining-=dt;a.lookRemaining-=dt;if(a.lookRemaining<=0){a.direction=['up','right','down','left'][((a.id+Math.floor(a.idleRemaining*2))%4+4)%4];a.lookRemaining=random(.9,2.1);}if(a.idleRemaining<=0&&!a.jobManaged)wander(map,a,agents);}
 a.animator.update(dt,{moving:a.moving,direction:a.direction,working:a.state===STATE.WORKING});
}
export function finishWander(a){a.path=[];a.walkPurpose=null;setState(a,STATE.IDLE);a.idleRemaining=random(1.4,5);a.lookRemaining=random(.6,1.6);}
