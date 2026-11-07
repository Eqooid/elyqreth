import {THEME} from './theme.js';
import {initializeMovement,updateAgent,finishWander,navigate} from './movement.js';
import {POINTS_OF_INTEREST,center} from './world.js';
import {CAFE_STAFF,JOB_ACTIVITIES} from './locations.js';
import {STATE,setState} from './agent-state.js';

export const POPULATION_CONFIG={target:5,max:8,spawnGap:18,offscreenInterval:.2};
const profiles=[['Jun','Designer','Café customer'],['Sol','Researcher','Station passenger'],['Ren','Tester','Market visitor'],['Ivo','Developer','Courier'],['Neri','Designer','Street cleaner'],['Lumi','Researcher','Pedestrian']];
const entries=[{col:0,row:21},{col:115,row:21},{col:46,row:63}];
export const NPC_SERVICE_ZONES=[{id:'cafe-service',bounds:[1632,232,160,64]},{id:'cleaner-promenade',bounds:[1536,416,320,304]},{id:'station-platform',bounds:[864,912,192,48]},{id:'plaza-event',bounds:[448,592,96,64]}];
// Decorative people have separate collection/identity; service and transit actors
// never join the functional registry. Their chains reuse the one activity controller.
export class Citizens{
 constructor(map,agents=[],config={}){
  this.map=map;map.citizens=this;this.config={...POPULATION_CONFIG,...config};this.enabled=true;this.people=[];this.nextId=10001;this.time=0;this.spawnRemaining=0;this.spawned=0;this.despawned=0;this.offscreenTicks=0;this.lastArrival=0;this.plaza={active:false,remaining:0,nextAt:125,events:0};
  [{col:96,row:21},{col:65,row:59},POINTS_OF_INTEREST[1],{col:52,row:21},{col:98,row:29}].slice(0,this.config.target).forEach(cell=>this.create(map.spawnNear({doorCell:cell},[...agents,...this.people])));
  this.staff={id:9999,name:CAFE_STAFF.name,role:CAFE_STAFF.role,visitorRole:'Barista',...CAFE_STAFF.position,decorative:true,serviceResident:true};initializeMovement(this.staff);map.activities?.initialize(this.staff);this.staff.activityCooldown=Infinity;this.staff.serviceTime=0;
 }
 get allPeople(){return [...this.people,this.staff];}
 create(position,{profile,transit=false,hidden=false}={}){const i=this.nextId-10001,[name,role,visitorRole]=profiles[profile??i%profiles.length],a={id:this.nextId++,name,role,visitorRole,...position,decorative:true,age:0,lifetime:480+(i%4)*85,offscreenAccumulator:0,transit};initializeMovement(a);this.map.activities?.initialize(a);a.hidden=hidden;a.jobManaged=['Courier','Street cleaner','Station passenger'].includes(visitorRole);a.speed=42+i%4*4;a.idleRemaining=2+i%3*2;this.people.push(a);this.spawned++;return a;}
 setTarget(target){this.config.target=Math.max(0,Math.min(this.config.max,Math.floor(target)));}
 visible(a,camera,margin=64){if(!camera)return false;const p=camera.screenAt(a.x,a.y);return p.x>-margin&&p.x<camera.width+margin&&p.y>-margin&&p.y<camera.height+margin;}
 startJob(a,id,options={}){const def=JOB_ACTIVITIES.find(d=>d.id===id);if(!def||!this.map.activities.eligible(a))return false;return this.map.activities.tryStart(a,def,true,options);}
 service(dt){const a=this.staff;a.serviceTime+=dt;a.hidden=!this.enabled;
  if(a.hidden){this.map.activities.reservations.releaseOwner(a.id);return;}
  const manager=this.map.activities.reservations;if(!manager.reservations.has('cafe-staff'))manager.reserve('cafe-staff',a.id,this.map.activities.time);manager.renew('cafe-staff',a.id,this.map.activities.time);manager.occupy('cafe-staff',a.id);
  a.serving=this.map.activities.actors.some(o=>o.activity?.definitionId==='coffee'&&o.activity.stepPhase==='INTERACTING'&&['order','prepare','receive'].includes(o.activity.stepId));
  setState(a,a.serving?STATE.PREPARING_COFFEE:STATE.IDLE);a.animator.update(dt,{direction:'down',working:a.serving});
 }
 trainEvents(target){const train=this.map.train;if(!train||train.arrivals===this.lastArrival)return;this.lastArrival=train.arrivals;
  // A new passenger originates hidden behind the station boarding doorway, then
  // walks out through that same gate. No visible cross-station spawn/teleport.
  if(train.state==='stopped'&&target>0&&this.people.length<this.config.max&&!this.people.some(a=>a.transit)){
   const gate=this.map.activities.points.find(p=>p.id==='station-gate');if(!gate||this.map.activities.reservations.reservations.has(gate.id))return;
   const a=this.create(gate.position,{profile:1,transit:true,hidden:true});a.hidden=false;
   if(this.startJob(a,'alighting')){a.hidden=true;a.leaveCityAfterActivity=true;}else{this.map.activities.cancel(a,'removed');this.people=this.people.filter(o=>o!==a);}
  }
 }
 plazaEvents(dt){const p=this.plaza;p.remaining=Math.max(0,p.remaining-dt);if(p.active&&p.remaining<=0)p.active=false;
  if(!this.enabled||this.map.activities.clock.period==='Night'){p.active=false;return;}
  if(this.time<p.nextAt)return;p.nextAt=this.time+180+Math.random()*80;
  const candidates=this.people.filter(a=>!a.exiting&&!a.jobManaged&&this.map.activities.eligible(a)&&Math.hypot(a.x-488,a.y-624)<700).slice(0,2);
  if(!candidates.length)return;p.active=true;p.remaining=22;p.events++;
  for(const a of candidates)this.startJob(a,'plaza-event');
 }
 roleRoutine(a){if(a.activity||a.exiting||a.activityCooldown>0)return;
  if(a.visitorRole==='Courier'&&(a.activityCooldowns.courier||0)<=this.map.activities.time)this.startJob(a,'courier');
  else if(a.visitorRole==='Street cleaner'&&(a.activityCooldowns.cleaning||0)<=this.map.activities.time)this.startJob(a,'cleaning');
  else if(a.visitorRole==='Station passenger'&&this.map.train?.state==='approaching')this.startJob(a,'passenger');
 }
 drawEvent(c,time){if(!this.plaza.active)return;c.save();const x=421,y=610;const frame=Math.floor(time*3)%4;c.fillStyle='#183b4890';c.fillRect(x-21,y-20,42,23);c.fillStyle=THEME.neon;c.fillRect(x-22,y-21,44,1);c.fillRect(x-22,y+3,44,1);c.fillRect(x-22,y-21,1,25);c.fillRect(x+21,y-21,1,25);for(let i=0;i<6;i++){const h=4+(i+frame)%4*3;c.fillRect(x-17+i*6,y-h,3,h);}c.fillStyle=THEME.primary;c.fillRect(x-3,y+5,6,2);c.restore();}
 remove(a){this.map.activities.cancel(a,'removed');this.people=this.people.filter(o=>o!==a);this.despawned++;}
 update(dt,agents,camera){
  this.time+=dt;this.spawnRemaining-=dt;const night=this.map.activities.clock.period==='Night',target=this.enabled?Math.min(this.config.target,night?2:this.config.max):0;
  this.service(dt);this.trainEvents(target);this.plazaEvents(dt);
  const regular=this.people.filter(a=>!a.transit&&!a.exiting).length;
  if(regular<target&&this.people.length<this.config.max&&this.spawnRemaining<=0){
   const entry=entries.find(p=>this.map.isWalkable(p.col,p.row)&&!this.visible(center(p),camera,96)&&[...agents,...this.allPeople].every(a=>Math.hypot(a.x-center(p).x,a.y-center(p).y)>40));
   if(entry)this.create(center(entry));this.spawnRemaining=this.config.spawnGap;
  }
  const residents=[...agents,...this.allPeople];let excess=Math.max(0,this.people.filter(a=>!a.exiting&&!a.transit).length-target);
  for(const a of [...this.people]){
   if(a.boardedExit){this.remove(a);continue;}a.age+=dt;const visible=this.visible(a,camera);
   if((a.age>a.lifetime||a.leaveCityAfterActivity||excess>0||!this.enabled)&&!a.exiting&&!a.activity){
    const exit=entries.filter(p=>this.map.isWalkable(p.col,p.row)&&!this.people.some(o=>o!==a&&o.exiting&&o.exitCell?.col===p.col&&o.exitCell?.row===p.row)).sort((p,q)=>Math.hypot(center(p).x-a.x,center(p).y-a.y)-Math.hypot(center(q).x-a.x,center(q).y-a.y))[0];
    if(exit){a.exitCell=exit;navigate(this.map,a,exit,'visitor-exit');a.exiting=true;if(!a.path.length&&Math.hypot(a.x-center(exit).x,a.y-center(exit).y)<.1)a.atExit=true;if(!a.transit)excess--;}
   }
   a.offscreenAccumulator+=dt;if(camera&&!visible&&a.offscreenAccumulator<this.config.offscreenInterval)continue;
   let remaining=a.offscreenAccumulator;a.offscreenAccumulator=0;if(!visible)this.offscreenTicks++;
   // Ignore floating-point remainders: a zero-distance update would reset the
   // courtesy timer while an offscreen resident is waiting behind another person.
   while(remaining>1e-8){const step=Math.min(remaining,1/30);if(!a.exiting){this.map.activities.update(a,step);this.roleRoutine(a);}updateAgent(this.map,a,residents,step,resident=>{
    if(resident.walkPurpose==='visitor-exit'){resident.path=[];resident.moving=false;resident.atExit=true;}
    else if(resident.walkPurpose==='activity')this.map.activities.arrived(resident);else finishWander(resident);
   });remaining-=step;}
   if(a.atExit&&!this.visible(a,camera,96))this.remove(a);
  }
 }
}
