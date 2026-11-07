import {STATE,setState} from './agent-state.js';
import {navigate} from './movement.js';
import {ACTIVITY_DEFINITIONS,LOCATIONS,INTERACTION_POINTS,HOME_LOCATIONS,COFFEE_ACTIVITY} from './locations.js';
import {CityClock,initializeLife,updateNeeds,satisfy,utility,bedtime} from './life.js';
import {findPath} from './pathfinding.js';
import {buildActivityPlan,shoppingOutcome} from './activity-plans.js';
const between=(random,[min,max])=>min+(max-min)*random();
export const SEATED_STATES=new Set([STATE.SITTING,STATE.DRINKING_COFFEE,STATE.SOCIALIZING,STATE.READING,STATE.RELAXING,STATE.EATING]);
const TRAVELLING=new Set([STATE.WALKING_TO_CAFE,STATE.WALKING_TO_PARK,STATE.WALKING_TO_MARKET,STATE.ENTERING_MARKET,STATE.WALKING_HOME,STATE.LEAVING_CAFE,STATE.LEAVING_ACTIVITY]);
const LEAVING=new Set([STATE.LEAVING_CAFE,STATE.LEAVING_ACTIVITY]);
export class ReservationManager{
 constructor(points){this.points=points;this.reservations=new Map();}
 reserve(pointId,ownerId,now,lease=12){if(this.reservations.has(pointId)||!this.points.some(p=>p.id===pointId)||[...this.reservations.values()].some(r=>r.ownerId===ownerId))return false;this.reservations.set(pointId,{pointId,ownerId,occupied:false,expiresAt:now+lease});return true;}
 renew(pointId,ownerId,now){const r=this.reservations.get(pointId);if(r?.ownerId===ownerId)r.expiresAt=now+12;}
 occupy(pointId,ownerId){const r=this.reservations.get(pointId);if(r?.ownerId!==ownerId)return false;r.occupied=true;return true;}
 releaseOwner(ownerId){for(const [id,r] of this.reservations)if(r.ownerId===ownerId)this.reservations.delete(id);}
 sweep(now,actors){const ids=new Set(actors.map(a=>a.id));for(const [id,r] of this.reservations)if(r.expiresAt<=now||!ids.has(r.ownerId))this.reservations.delete(id);}
 snapshot(){return this.points.map(p=>({...p,occupant:this.reservations.get(p.id)?.occupied?this.reservations.get(p.id).ownerId:null,reservedBy:this.reservations.get(p.id)?.ownerId??null}));}
}
// Shared lifecycle: SELECTED → RESERVED → NAVIGATING → PERFORMING → COMPLETED.
// Every exit, including real work, passes through the same lease/session cleanup.
export class ActivityController{
 constructor(map,{random=Math.random,definitions=ACTIVITY_DEFINITIONS,locations=LOCATIONS,points=INTERACTION_POINTS,clock=new CityClock()}={}){
  Object.assign(this,{map,random,definitions,locations,clock});this.points=points.slice();this.reservations=new ReservationManager(this.points);this.time=0;this.nextAdmission=0;this.actors=[];this.sessions=new Map();this.pairCooldowns=new Map();this.nextSession=1;this.nextEncounter=10;
  this.stats={started:0,seated:0,sips:0,conversations:0,completed:0,interrupted:0,routeFailures:0,routeDiagnostics:[],waits:0,byActivity:{},encounters:0,marketEntries:0,homeReturns:0,readingFrames:0,orders:0,drinksServed:0,foodConsumed:0,householdDeliveries:0,courierDeliveries:0,cleaningStops:0,passengersBoarded:0,passengersAlighted:0,shoppingOutcomes:{window:0,food:0,household:0}};map.activities=this;
 }
 initialize(a,personality){a.activity=null;a.activityCooldown=6+(a.decorative?18:(a.id-1)%4*9);initializeLife(a,HOME_LOCATIONS,personality);}
 beginFrame(dt,actors){
  this.time+=dt;this.actors=actors;this.reservations.sweep(this.time,actors);
  for(const a of actors)updateNeeds(a,dt);
  this.updateEncounters(dt);
  for(const [key,until] of this.pairCooldowns)if(until<this.time)this.pairCooldowns.delete(key);
  if(this.time>=this.nextEncounter){this.nextEncounter=this.time+1.5;this.tryEncounter();}
 }
 eligible(a){return !a.serviceResident&&!a.activity&&!a.hidden&&![STATE.WORKING,STATE.WAITING,STATE.ERROR,STATE.COMPLETED].includes(a.state)&&!['collect','work','deliver'].includes(a.walkPurpose)&&a.workStatus!=='Assigned';}
 definition(a){return this.definitions.find(d=>d.id===a.activity?.definitionId);}
 locationFor(a,d){return this.locations.find(l=>l.id===(d.id==='rest'?a.homeId:d.locationId));}
 count(d,a){return this.actors.filter(o=>o.activity?.definitionId===d.id&&!!o.decorative===!!a.decorative).length;}
 capacity(d,a){return this.count(d,a)<(a.decorative?d.maxVisitors:d.maxAgents);}
 available(a,d){const location=this.locationFor(a,d);if(!location||!this.capacity(d,a))return false;return this.points.some(p=>p.locationId===location.id&&(!['coffee','reading'].includes(d.id)||p.type===(d.id==='coffee'?'chair':'benchSeat'))&&!this.reservations.reservations.has(p.id));}
 choose(a){
  const candidates=this.definitions.filter(d=>d.chance>0&&this.available(a,d)).map(d=>{const l=this.locationFor(a,d);return {definition:d,score:utility(a,d,l,this.clock,this.time,this.count(d,a))*(.92+this.random()*.16)};}).filter(d=>d.score>0).sort((a,b)=>b.score-a.score);
  // A small choice among close utilities adds variety without overriding needs.
  if(!candidates.length)return null;const best=candidates[0].score,near=candidates.filter(d=>d.score>=best*.83);return near[Math.floor(this.random()*near.length)].definition;
 }
 tryStart(a,definition=this.definitions[0],force=false,options={}){
  if(!this.eligible(a)||!definition)return false;const location=this.locationFor(a,definition);if(!location)return false;
  if(!force&&(this.time<this.nextAdmission||!this.capacity(definition,a)))return false;
  if(['coffee','shopping','courier','cleaning','passenger','alighting','plaza-event'].includes(definition.id))return this.startChain(a,definition,options);
  const free=this.points.filter(p=>p.locationId===location.id&&(definition.id!=='reading'||p.type==='benchSeat')&&!this.reservations.reservations.has(p.id));
  const peers=new Set(this.actors.filter(o=>o!==a&&o.activity?.definitionId===definition.id&&!LEAVING.has(o.state)).map(o=>o.activity?.tableId));
  free.sort((p,q)=>(peers.has(q.tableId)?1:0)-(peers.has(p.tableId)?1:0)||Math.hypot(p.position.x-a.x,p.position.y-a.y)-Math.hypot(q.position.x-a.x,q.position.y-a.y));
  for(const point of free){
   const target=point.approachCell||point.interactionCell,path=findPath(this.map.navigationView(a),a,target);
   if(!path.length&&Math.hypot(a.x-(target.col*16+8),a.y-(target.row*16+8))>.1)continue;
   if(!this.reservations.reserve(point.id,a.id,this.time))continue;
   a.activity={definitionId:definition.id,locationId:location.id,pointId:point.id,tableId:point.tableId,lifecycle:'RESERVED',routeRemaining:definition.routeTimeout,seatRemaining:between(this.random,definition.seatDuration)*(a.personality==='Focused'?.72:1),phaseTime:0,sipClock:0,speechCooldown:5+this.random()*6,bubble:null,bubbleRemaining:0,socialRemaining:0,sipCounted:false};
   a.lastDestination=location.name;navigate(this.map,a,target,'activity');this.setTravelState(a,definition);a.activity.lifecycle='NAVIGATING';this.nextAdmission=this.time+definition.admissionGap;this.stats.started++;
   this.stats.byActivity[definition.id]??={started:0,completed:0,interrupted:0};this.stats.byActivity[definition.id].started++;
   if(!a.path.length)this.arrived(a);return true;
  }
  if(!free.length&&a.state===STATE.IDLE){a.path=[];a.walkPurpose='activity';a.activity={definitionId:definition.id,locationId:location.id,pointId:null,lifecycle:'SELECTED',waitRemaining:definition.waitTimeout};setState(a,definition.id==='coffee'||definition.id==='reading'?STATE.WAITING_FOR_SEAT:STATE.WAITING_FOR_ENTRANCE);this.stats.waits++;}
  return false;
 }
 setTravelState(a,d){setState(a,{coffee:STATE.WALKING_TO_CAFE,reading:STATE.WALKING_TO_PARK,shopping:STATE.WALKING_TO_MARKET,rest:STATE.WALKING_HOME}[d.id]||STATE.WALKING);}
 update(a,dt){
  if(!a.activity){
   a.activityCooldown=Math.max(0,(a.activityCooldown??6)-dt);if(a.jobManaged)return;
   if(this.eligible(a)&&a.activityCooldown<=0&&[STATE.IDLE,STATE.WANDERING].includes(a.state)&&this.map.roads.at(this.map.cellAt(a).col,this.map.cellAt(a).row)===0){
    const def=this.choose(a);a.activityCooldown=between(this.random,this.definitions[0]?.decisionDelay||[12,23]);if(def)this.tryStart(a,def);
   }return;
  }
  const r=a.activity;if(r.definitionId==='encounter'){a.animator.update(dt,{direction:a.direction});return;}
  const def=this.definition(a);if(!def){this.cancel(a,'invalid');return;}
  if(!r.chain&&[STATE.WAITING_FOR_SEAT,STATE.WAITING_FOR_ENTRANCE].includes(a.state)){r.waitRemaining-=dt;if(r.waitRemaining<=0)this.cancel(a,'timeout');return;}
  if(r.pointId&&this.reservations.reservations.get(r.pointId)?.ownerId!==a.id){this.cancel(a,'expired');return;}
  if(r.pointId)this.reservations.renew(r.pointId,a.id,this.time);
  if(r.chain){this.updateChain(a,dt,def);return;}
  if(TRAVELLING.has(a.state)){r.routeRemaining-=dt;if(r.routeRemaining<=0||!a.path.length){if(!a.path.length)this.arrived(a);else{this.failedRoute(a,'navigation-timeout');this.cancel(a,'timeout');}}return;}
  a.moving=false;r.phaseTime+=dt;r.seatRemaining-=dt;r.speechCooldown-=dt;r.bubbleRemaining=Math.max(0,r.bubbleRemaining-dt);if(!r.bubbleRemaining)r.bubble=null;satisfy(a,def.id,dt);
  if(a.state===STATE.RESTING){if(!bedtime(a,this.clock)&&r.seatRemaining<=0)this.leave(a);return;}
  if(a.state===STATE.SHOPPING){if(r.seatRemaining<=0)this.leave(a);return;}
  if(!SEATED_STATES.has(a.state)){this.cancel(a,'invalid');return;}
  if(r.seatRemaining<=0){this.leave(a);return;}
  if(def.id==='reading'){setState(a,r.phaseTime%11>8.5?STATE.RELAXING:STATE.READING);this.stats.readingFrames++;if(r.speechCooldown<=0&&this.actors.filter(o=>o.activity?.bubble).length<2){r.speechCooldown=12+this.random()*9;const peer=this.actors.find(o=>o!==a&&o.activity?.definitionId==='reading'&&o.activity.tableId===r.tableId&&[STATE.READING,STATE.RELAXING].includes(o.state));if(peer&&(this.pairCooldowns.get(this.pairKey(a,peer))||0)<=this.time){this.pairCooldowns.set(this.pairKey(a,peer),this.time+45);r.bubble='Anything interesting?';r.bubbleRemaining=3;peer.activity.bubble='A new perspective.';peer.activity.bubbleRemaining=3;peer.activity.speechCooldown=12;satisfy(a,'encounter',4);satisfy(peer,'encounter',4);this.stats.conversations++;}}}
  else{
   r.sipClock=(r.sipClock+dt)%def.sipPeriod;const sipping=r.sipClock>1.3&&r.sipClock<2.2;
   if(sipping&&!r.sipCounted){this.stats.sips++;r.sipCounted=true;}if(!sipping)r.sipCounted=false;
   if(a.state===STATE.SITTING&&r.phaseTime>1.2)setState(a,STATE.DRINKING_COFFEE);
   if(a.state===STATE.SOCIALIZING){r.socialRemaining-=dt;if(r.socialRemaining<=0)setState(a,STATE.DRINKING_COFFEE);}
   else if(r.speechCooldown<=0&&this.actors.filter(o=>o.activity?.bubble).length<2){
    const peer=this.actors.find(o=>o!==a&&o.activity?.definitionId==='coffee'&&o.activity.tableId===r.tableId&&SEATED_STATES.has(o.state));r.speechCooldown=8+this.random()*10;
    if(peer&&this.agreeTableConversation(a,peer)){r.bubble=this.dialogue(a);r.bubbleRemaining=3.8;this.stats.conversations++;}
   }
  }a.animator.update(dt,{direction:a.direction});
 }
 failedRoute(a,reason){this.stats.routeFailures++;this.stats.routeDiagnostics.push({id:a.id,name:a.name,reason,time:this.time,x:a.x,y:a.y,state:a.state,definition:a.activity?.definitionId,step:a.activity?.stepId,point:a.activity?.pointId,remaining:a.activity?.routeRemaining,path:a.path.slice(0,3),goal:a.path.at(-1)});this.stats.routeDiagnostics=this.stats.routeDiagnostics.slice(-16);}
 // A chain reuses this controller's actor, lease and navigation ownership.
 startChain(a,def,options={}){
  const outcome=def.id==='shopping'?(options.outcome||shoppingOutcome(a,this.random)):null;
  const chain=buildActivityPlan(a,def,this.random,outcome);if(!chain)return false;
  if(def.id==='coffee'&&!this.points.some(p=>p.type==='chair'&&!this.reservations.reservations.has(p.id))){
   if(a.state===STATE.IDLE){a.path=[];a.walkPurpose='activity';a.activity={definitionId:def.id,locationId:def.locationId,lifecycle:'SELECTED',waitRemaining:def.waitTimeout};setState(a,STATE.WAITING_FOR_SEAT);this.stats.waits++;}return false;
  }
  a.activity={definitionId:def.id,locationId:def.locationId,chain,stepIndex:0,stepPhase:'PLANNED',lifecycle:'PLANNED',routeRemaining:def.routeTimeout,seatRemaining:0,phaseTime:0,sipClock:0,speechCooldown:5+this.random()*6,bubble:null,bubbleRemaining:0,socialRemaining:0,sipCounted:false,outcome,history:[]};
  a.prop=null;a.path=[];a.walkPurpose='activity';
  if(!this.startStep(a)){this.cancel(a,'unavailable');return false;}
  this.nextAdmission=this.time+def.admissionGap;this.stats.started++;this.stats.byActivity[def.id]??={started:0,completed:0,interrupted:0};this.stats.byActivity[def.id].started++;
  if(outcome)this.stats.shoppingOutcomes[outcome]++;return true;
 }
 selectPoint(a,step){
  const peers=new Set(this.actors.filter(o=>o!==a&&o.activity?.definitionId===a.activity.definitionId).map(o=>o.activity?.tableId));
  const candidates=this.points.filter(p=>step.points?.includes(p.id)&&this.actors.every(o=>o===a||o.hidden||Math.hypot(o.x-p.position.x,o.y-p.position.y)>=18)&&(!this.reservations.reservations.has(p.id)||this.reservations.reservations.get(p.id).ownerId===a.id));
  candidates.sort((p,q)=>(peers.has(q.tableId)?1:0)-(peers.has(p.tableId)?1:0)||Math.hypot(a.x-p.position.x,a.y-p.position.y)-Math.hypot(a.x-q.position.x,a.y-q.position.y));
  return candidates.find(p=>{const path=findPath(this.map.navigationView(a),a,p.interactionCell);return path.length||Math.hypot(a.x-p.position.x,a.y-p.position.y)<.1;});
 }
 startStep(a){
  const r=a.activity,step=r.chain[r.stepIndex],def=this.definition(a);const waitingForSameStep=r.stepId===step?.id&&r.stepPhase==='WAITING',waitRemaining=waitingForSameStep?r.waitRemaining:10;if(!step){this.finish(a,def);return true;}
  this.reservations.releaseOwner(a.id);r.pointId=null;r.tableId=null;r.bubble=null;r.phaseTime=0;r.routeRemaining=def.routeTimeout;r.stepId=step.id;r.stepPhase='PLANNED';r.lifecycle='PLANNED';
  if(step.clearProp)a.prop=null;if(step.show)a.hidden=false;if(step.locationId)r.locationId=step.locationId;
  r.stepRemaining=Array.isArray(step.duration)?between(this.random,step.duration)*(a.personality==='Focused'?.72:1):(step.duration||0);r.seatRemaining=r.stepRemaining;
  const point=step.points?.length?this.selectPoint(a,step):null;if(step.points?.length&&!point){r.stepPhase='WAITING';r.waitRemaining=waitRemaining;r.retryRemaining=.5;a.path=[];a.moving=false;setState(a,STATE.WAITING_FOR_ENTRANCE);return true;}
  if(point){if(!this.reservations.reserve(point.id,a.id,this.time))return false;r.pointId=point.id;r.tableId=point.tableId;r.locationId=point.locationId;}
  const cell=point?.interactionCell||step.cell;
  if(cell){navigate(this.map,a,cell,'activity');setState(a,step.travelState||STATE.WALKING);r.lifecycle='NAVIGATING';r.stepPhase='NAVIGATING';if(!a.path.length){if(Math.hypot(a.x-(cell.col*16+8),a.y-(cell.row*16+8))<.1)return this.chainArrived(a);r.stepPhase='WAITING';r.lifecycle='RESERVED';r.waitRemaining=waitRemaining;r.retryRemaining=.5;a.moving=false;setState(a,STATE.WAITING_FOR_ENTRANCE);}return true;}
  return this.performStep(a);
 }
 chainArrived(a){
  const r=a.activity,step=r?.chain?.[r.stepIndex];if(!step)return false;
  const point=this.points.find(p=>p.id===r.pointId),cell=point?.interactionCell||step.cell;
  if(cell&&Math.hypot(a.x-(cell.col*16+8),a.y-(cell.row*16+8))>.1){this.failedRoute(a,'arrival-position');this.cancel(a,'invalid');return false;}
  if(point&&!this.reservations.occupy(point.id,a.id)){this.cancel(a,'expired');return false;}
  a.path=[];a.moving=false;return this.performStep(a);
 }
 performStep(a){
  const r=a.activity,step=r.chain[r.stepIndex];r.stepPhase='INTERACTING';r.lifecycle='INTERACTING';r.phaseTime=0;
  r.history.push({step:step.id,time:this.time,x:a.x,y:a.y});r.history=r.history.slice(-16);
  if(step.kind==='walk'){if(step.event)this.stats[step.event]=(this.stats[step.event]||0)+1;this.advanceStep(a);return true;}
  a.direction=this.points.find(p=>p.id===r.pointId)?.direction||a.direction;setState(a,step.state);
  if(step.kind==='indoor'||step.kind==='aboard'){a.hidden=true;this.reservations.releaseOwner(a.id);r.pointId=null;}
  if(step.kind==='coffee'||step.kind==='eating'){r.lifecycle='PERFORMING';this.stats.seated++;}
  if(step.prop)a.prop={kind:step.prop,receivedAt:this.time};
  if(step.event)this.stats[step.event]=(this.stats[step.event]||0)+1;
  if(step.id==='order')this.stats.orders++;return true;
 }
 advanceStep(a){
  const r=a.activity,step=r.chain[r.stepIndex];if(step.propAfter)a.prop={kind:step.propAfter,receivedAt:this.time};
  if(step.kind==='eating')a.prop=null;if(step.kind==='coffee')a.prop=null;
  r.stepIndex++;if(!this.startStep(a))this.cancel(a,'unavailable');
 }
 updateChain(a,dt,def){
  const r=a.activity,step=r.chain[r.stepIndex];if(!step){this.finish(a,def);return;}
  if(r.stepPhase==='WAITING'){r.waitRemaining-=dt;if(r.waitRemaining<=0){this.cancel(a,'timeout');return;}r.retryRemaining-=dt;if(r.retryRemaining<=0){r.retryRemaining=.5;if(!step.points?.length||this.selectPoint(a,step))this.startStep(a);}return;}
  if(r.stepPhase==='NAVIGATING'){r.routeRemaining-=dt;if(step.gate==='train-stopped'&&this.map.train?.state!=='stopped'){this.cancel(a,'missed-train');return;}if(!a.path.length)this.chainArrived(a);else if(r.routeRemaining<=0){this.failedRoute(a,'chain-timeout');this.cancel(a,'timeout');}return;}
  a.moving=false;r.phaseTime+=dt;r.routeRemaining-=dt;r.stepRemaining-=dt;r.seatRemaining=r.stepRemaining;
  r.bubbleRemaining=Math.max(0,r.bubbleRemaining-dt);if(!r.bubbleRemaining)r.bubble=null;
  if(step.kind==='queue'){const counter=this.reservations.reservations.get(step.nextPoint);if(!counter){this.advanceStep(a);return;}if(r.routeRemaining<=0)this.cancel(a,'timeout');return;}
  if(step.kind==='train-wait'){if(this.map.train?.state==='stopped')this.advanceStep(a);else if(r.routeRemaining<=0)this.cancel(a,'timeout');return;}
  if(step.kind==='aboard'){if(this.map.train?.state==='departing'||this.map.train?.state==='waiting'){a.boardedExit=true;this.finish(a,def);a.hidden=true;}return;}
  if(step.kind==='watching'&&!this.map.citizens?.plaza.active){this.advanceStep(a);return;}
  if(step.kind==='boarding'&&this.map.train?.state!=='stopped'){this.cancel(a,'missed-train');return;}
  if(step.kind==='coffee'){
   satisfy(a,'coffee',dt);r.speechCooldown-=dt;r.sipClock=(r.sipClock+dt)%def.sipPeriod;const sipping=r.sipClock>1.3&&r.sipClock<2.2;
   if(sipping&&!r.sipCounted){this.stats.sips++;r.sipCounted=true;}if(!sipping)r.sipCounted=false;
   if(a.state===STATE.SITTING&&r.phaseTime>1.2)setState(a,STATE.DRINKING_COFFEE);
   if(a.state===STATE.SOCIALIZING){r.socialRemaining-=dt;if(r.socialRemaining<=0)setState(a,STATE.DRINKING_COFFEE);}
   else if(r.speechCooldown<=0&&this.actors.filter(o=>o.activity?.bubble).length<2){const peer=this.actors.find(o=>o!==a&&o.activity?.definitionId==='coffee'&&o.activity.tableId===r.tableId&&SEATED_STATES.has(o.state));r.speechCooldown=8+this.random()*10;if(peer&&this.agreeTableConversation(a,peer)){r.bubble=this.dialogue(a);r.bubbleRemaining=3.8;this.stats.conversations++;}}
  }
  if(step.kind==='eating')satisfy(a,'eating',dt);
  a.animator.update(dt,{direction:a.direction});if(r.stepRemaining<=0)this.advanceStep(a);
 }
 pairKey(a,b){return [a.id,b.id].sort((a,b)=>a-b).join(':');}
 agreeTableConversation(a,b){const key=this.pairKey(a,b);if((this.pairCooldowns.get(key)||0)>this.time)return false;
  if(!a.activity||!b.activity||a.workStatus==='Assigned'||b.workStatus==='Assigned')return false;
  for(const actor of [a,b]){setState(actor,STATE.SOCIALIZING);actor.activity.socialRemaining=4;actor.activity.speechCooldown=8;}
  this.pairCooldowns.set(key,this.time+18);return true;
 }
 dialogue(a){const options={Developer:['Coffee break?','A fresh start.'],Researcher:['I found a new idea.','Good coffee, good ideas.'],Designer:["Let’s discuss it later.",'Love this terrace.'],Tester:['One more sip.','Looks good to me.']}[a.role]||['Nice to see you.','Taking a break?'];return options[Math.floor(this.random()*options.length)];}
 arrived(a){
  const r=a.activity;if(!r)return false;if(r.chain)return this.chainArrived(a);if(r.definitionId==='encounter'){const session=this.sessions.get(r.sessionId);if(session?.phase==='NAVIGATING'){const point=this.points.find(p=>p.id===r.pointId);if(!point||Math.hypot(a.x-point.position.x,a.y-point.position.y)>.1){this.endEncounter(session.id,'timeout');return false;}a.path=[];a.moving=false;session.phase='PERFORMING';session.time=0;if(r.pointId)this.reservations.occupy(r.pointId,a.id);for(const id of session.participants){const peer=this.actors.find(o=>o.id===id);if(peer?.activity?.sessionId===session.id){peer.activity.lifecycle='PERFORMING';setState(peer,STATE.GREETING);}}}return true;}const def=this.definition(a);if(!def){this.cancel(a,'invalid');return false;}
  if(LEAVING.has(a.state)){this.finish(a,def);return true;}
  const point=this.points.find(p=>p.id===r.pointId);if(!point){this.cancel(a,'invalid');return false;}
  if(def.id==='shopping'&&a.state===STATE.WALKING_TO_MARKET){
   const approach=point.approachCell;if(Math.hypot(a.x-(approach.col*16+8),a.y-(approach.row*16+8))>.1){this.cancel(a,'invalid');return false;}
   navigate(this.map,a,point.interactionCell,'activity');setState(a,STATE.ENTERING_MARKET);return true;
  }
  if(Math.hypot(a.x-point.position.x,a.y-point.position.y)>.1||!this.reservations.occupy(point.id,a.id)){this.cancel(a,'invalid');return false;}
  a.path=[];a.walkPurpose='activity';a.direction=point.direction;a.moving=false;r.lifecycle='PERFORMING';
  if(['shopping','rest'].includes(def.id)){this.reservations.releaseOwner(a.id);r.pointId=null;a.hidden=true;setState(a,def.id==='shopping'?STATE.SHOPPING:STATE.RESTING);if(def.id==='shopping')this.stats.marketEntries++;else this.stats.homeReturns++;}
  else{setState(a,def.id==='reading'?STATE.READING:STATE.SITTING);this.stats.seated++;}return true;
 }
 leave(a){
  const r=a.activity,def=this.definition(a);if(r.chain){this.advanceStep(a);return;}this.reservations.releaseOwner(a.id);r.pointId=null;r.bubble=null;r.routeRemaining=45;r.lifecycle='COMPLETED';a.hidden=false;if(def.id==='shopping')a.shoppingBagRemaining=40;
  navigate(this.map,a,this.locations.find(l=>l.id===r.locationId).exit,'activity');setState(a,def.id==='coffee'?STATE.LEAVING_CAFE:STATE.LEAVING_ACTIVITY);if(!a.path.length)this.arrived(a);
 }
 finish(a,def){this.reservations.releaseOwner(a.id);a.path=[];a.walkPurpose=null;a.activity=null;a.hidden=false;a.prop=null;a.shoppingBagRemaining=0;a.activityCooldown=this.definitions.length>1?between(this.random,def.decisionDelay):between(this.random,def.cooldown);a.activityCooldowns[def.id]=this.time+between(this.random,def.cooldown);a.lastActivities.push(def.id);a.lastActivities=a.lastActivities.slice(-4);setState(a,STATE.IDLE);a.idleRemaining=2+this.random()*3;this.stats.completed++;if(this.stats.byActivity[def.id])this.stats.byActivity[def.id].completed++;}
 cancel(a,reason='task'){
  const r=a.activity;if(r?.sessionId)this.endEncounter(r.sessionId,reason);
  this.reservations.releaseOwner(a.id);a.hidden=false;a.prop=null;a.shoppingBagRemaining=0;
  if(!r){if(reason==='task')a.activityCooldown=Math.max(a.activityCooldown||0,this.definitions[0]?.afterWorkCooldown??20);return;}
  a.activity=null;a.path=[];a.walkPurpose=null;a.moving=false;a.activityCooldown=between(this.random,this.definitions[0]?.cooldown||[45,95]);setState(a,STATE.IDLE);a.idleRemaining=1.2;
  if(reason==='task'){this.stats.interrupted++;if(this.stats.byActivity[r.definitionId])this.stats.byActivity[r.definitionId].interrupted++;}
 }
 clearForEncounter(a){
  if(!this.eligible(a)||a.decorative||a.trafficWaiting)return false;
  const p=this.map.cellAt(a);let clear=0;const protectedCell=(col,row)=>this.points.some(p=>p.interactionCell.col===col&&p.interactionCell.row===row&&p.type!=='gathering');
  for(let row=p.row-2;row<=p.row+2;row++)for(let col=p.col-2;col<=p.col+2;col++)if(this.map.isWalkable(col,row)&&!this.map.roads.at(col,row)&&!protectedCell(col,row))clear++;
  return clear>=20&&!protectedCell(p.col,p.row);
 }
 tryEncounter(){
  if(this.sessions.size>=2||this.clock.period==='Night')return false;
  const free=this.actors.filter(a=>this.clearForEncounter(a));
  for(const a of free)for(const b of free){const distance=Math.hypot(a.x-b.x,a.y-b.y),key=this.pairKey(a,b);if(a.id>=b.id||distance<28||distance>200||(this.pairCooldowns.get(key)||0)>this.time)continue;
   const id=this.nextSession++,location=this.locations.find(l=>['central-plaza','globe-park','east-terrace'].includes(l.id)&&a.x>=l.bounds[0]&&a.x<=l.bounds[0]+l.bounds[2]&&a.y>=l.bounds[1]&&a.y<=l.bounds[1]+l.bounds[3]);
   let goal=null;if(distance>96){const origin=this.map.cellAt(b);const choices=[{col:origin.col+(a.x<b.x?-2:2),row:origin.row},{col:origin.col,row:origin.row+(a.y<b.y?-2:2)}];goal=choices.find(p=>this.map.isWalkable(p.col,p.row)&&!this.map.roads.at(p.col,p.row)&&!this.map.interactionCells.has(`${p.col},${p.row}`)&&findPath(this.map.navigationView(a),a,p).length&&this.actors.every(o=>o===a||o===b||Math.hypot(o.x-(p.col*16+8),o.y-(p.row*16+8))>24));if(!goal)continue;}
   this.sessions.set(id,{id,participants:[a.id,b.id],time:0,phase:goal?'NAVIGATING':'PERFORMING',routeRemaining:35,duration:8+this.random()*3});this.pairCooldowns.set(key,this.time+140);
   for(const [actor,peer] of [[a,b],[b,a]]){actor.path=[];actor.walkPurpose='activity';actor.moving=false;actor.direction=Math.abs(peer.x-actor.x)>Math.abs(peer.y-actor.y)?peer.x>actor.x?'right':'left':peer.y>actor.y?'down':'up';actor.activity={definitionId:'encounter',sessionId:id,locationId:location?.id||'walkway',lifecycle:'PERFORMING',phaseTime:0,bubble:null};setState(actor,STATE.GREETING);}
   if(goal){const point={id:`encounter-${id}-approach`,type:'meeting',locationId:location?.id||'walkway',position:{x:goal.col*16+8,y:goal.row*16+8},interactionCell:goal,direction:a.direction,sessionId:id};this.points.push(point);this.reservations.reserve(point.id,a.id,this.time);a.activity.pointId=point.id;a.activity.lifecycle='NAVIGATING';navigate(this.map,a,goal,'activity');setState(a,STATE.WALKING_TO_SOCIAL);b.activity.lifecycle='WAITING';setState(b,STATE.WAITING_FOR_FRIEND);}
   this.stats.encounters++;return true;
  }return false;
 }
 updateEncounters(dt){
  for(const s of [...this.sessions.values()]){
   const participants=s.participants.map(id=>this.actors.find(a=>a.id===id));if(participants.some(a=>!a||a.activity?.sessionId!==s.id||a.workStatus==='Assigned'||a.activity.pointId&&this.reservations.reservations.get(a.activity.pointId)?.ownerId!==a.id)){this.endEncounter(s.id,'invalid');continue;}
   for(const a of participants)if(a.activity.pointId)this.reservations.renew(a.activity.pointId,a.id,this.time);
   if(s.phase==='NAVIGATING'){s.routeRemaining-=dt;if(s.routeRemaining<=0||!participants[0].path.length){if(s.routeRemaining<=0)this.endEncounter(s.id,'timeout');else this.arrived(participants[0]);}continue;}
   s.time+=dt;if(s.time>=s.duration){this.endEncounter(s.id,'completed');continue;}
   for(let i=0;i<participants.length;i++){const a=participants[i],r=a.activity,peer=participants[1-i];a.direction=Math.abs(peer.x-a.x)>Math.abs(peer.y-a.y)?peer.x>a.x?'right':'left':peer.y>a.y?'down':'up';r.phaseTime=s.time;satisfy(a,'encounter',dt);setState(a,s.time<1.3?STATE.GREETING:s.time>s.duration-1.4?STATE.WAVING:STATE.SOCIALIZING);r.bubble=s.time>1.5+i*2&&s.time<3.5+i*2?['Good to see you.','See you around.'][i]:null;}
  }
 }
 endEncounter(id,reason){const s=this.sessions.get(id);if(!s)return;this.sessions.delete(id);for(const point of this.points.filter(p=>p.sessionId===id))this.reservations.reservations.delete(point.id);this.points=this.points.filter(p=>p.sessionId!==id);this.reservations.points=this.points;for(const actorId of s.participants){const a=this.actors.find(a=>a.id===actorId);if(a?.activity?.sessionId!==id)continue;a.activity=null;a.path=[];a.walkPurpose=null;a.moving=false;a.activityCooldown=Math.max(a.activityCooldown||0,12);a.idleRemaining=1+this.random()*3;setState(a,STATE.IDLE);if(reason==='completed')this.stats.completed++;}}
 pose(a){
  if(a.serviceResident&&!a.hidden)return a.serving?{kind:'preparing',frame:a.serviceTime%2<1?2:3,direction:'down'}:a.serviceTime%13>11.8?{kind:'wave',frame:3,direction:'down'}:null;
  const r=a.activity;if(!r||a.hidden)return null;
  if(r.definitionId==='encounter')return [STATE.GREETING,STATE.WAVING].includes(a.state)?{kind:'wave',frame:3,direction:a.direction}:null;
  if(r.chain&&r.stepPhase==='INTERACTING'){const step=r.chain[r.stepIndex];if(step.kind==='eating')return {kind:'eating',frame:r.phaseTime%3<1.3?0:1,direction:a.direction};if(step.kind==='cleaning')return {kind:'cleaning',frame:r.phaseTime%1.4<.7?4:5,direction:a.direction};}
  if(r.definitionId==='reading'&&SEATED_STATES.has(a.state))return {kind:'reading',frame:a.state===STATE.RELAXING?2:r.phaseTime%6<1?1:0,direction:a.direction};
  if(r.definitionId!=='coffee'||!a.prop||!SEATED_STATES.has(a.state))return null;
  return {kind:'coffee',frame:a.state===STATE.SOCIALIZING?0:r.sipClock>1.3&&r.sipClock<2.2?2:r.sipClock<2.8?1:0,direction:a.direction};
 }
}
