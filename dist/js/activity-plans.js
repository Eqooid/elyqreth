import {STATE} from './agent-state.js';
import {CAFE_QUEUE_POINTS,CAFE_SEATS,CAFE_ORDER_POINT,PARK_SEATS,PARK_LOCATION,MARKET_LOCATION,HOME_LOCATIONS,SERVICE_POINTS} from './locations.js';
const ids=points=>points.map(p=>p.id);
const walk=(id,cell,state=STATE.LEAVING_ACTIVITY,extra={})=>({id,cell,kind:'walk',travelState:state,...extra});
const interact=(id,points,state,duration,extra={})=>({id,points,kind:'interact',state,duration,travelState:STATE.WALKING,...extra});
export function shoppingOutcome(a,random){
 if(a.needs.hunger>55)return random()<.2?'window':'food';
 const r=random();return r<.4?'window':r<.68||a.decorative?'food':'household';
}
// Nested steps belong to the existing activity object/controller. Point selection,
// leases, movement, phase timing, props and interruption use one common lifecycle.
export function buildActivityPlan(a,definition,random,outcome=shoppingOutcome(a,random)){
 if(definition.id==='coffee')return [
  interact('queue',ids(CAFE_QUEUE_POINTS),STATE.QUEUING,0,{kind:'queue',nextPoint:CAFE_ORDER_POINT.id}),
  interact('order',[CAFE_ORDER_POINT.id],STATE.ORDERING_COFFEE,1.2),
  interact('prepare',[CAFE_ORDER_POINT.id],STATE.WAITING_FOR_COFFEE,2.6),
  interact('receive',[CAFE_ORDER_POINT.id],STATE.RECEIVING_DRINK,.8,{prop:'coffee',event:'drinksServed'}),
  interact('drink',ids(CAFE_SEATS),STATE.SITTING,definition.seatDuration,{kind:'coffee',travelState:STATE.WALKING_TO_CAFE}),
  walk('leave-coffee',{col:96,row:21},STATE.LEAVING_CAFE,{clearProp:true})
 ];
 if(definition.id==='shopping'){
  const browse=interact('browse',['market-window'],STATE.WINDOW_SHOPPING,3,{travelState:STATE.WALKING_TO_MARKET});
  const enter=interact('enter-market',['market-entry'],STATE.ENTERING_MARKET,.8,{travelState:STATE.ENTERING_MARKET});
  const shop=interact('inside-market',[],STATE.SHOPPING,[12,20],{kind:'indoor',event:'marketEntries'});
  if(outcome==='window')return random()<.45?[browse,enter,{...shop,duration:[5,9]},walk('leave-market',MARKET_LOCATION.exit,STATE.LEAVING_ACTIVITY,{show:true})]:[browse,walk('leave-market',MARKET_LOCATION.exit,STATE.LEAVING_ACTIVITY,{show:true})];
  const purchase={...shop,propAfter:outcome==='food'?'food':'shoppingBag'};
  const exit=walk('exit-market',MARKET_LOCATION.entry,STATE.LEAVING_ACTIVITY,{show:true});
  if(outcome==='food')return [browse,enter,purchase,exit,
   interact('eat',ids(PARK_SEATS),STATE.EATING,[12,18],{kind:'eating',travelState:STATE.WALKING_TO_PARK}),
   walk('leave-park',PARK_LOCATION.exit,STATE.LEAVING_ACTIVITY,{clearProp:true,event:'foodConsumed'})];
  const home=HOME_LOCATIONS.find(h=>h.id===a.homeId);
  if(!home)return [browse,walk('leave-market',MARKET_LOCATION.exit,STATE.LEAVING_ACTIVITY,{show:true})];
  return [browse,enter,purchase,exit,
   interact('deliver-purchase',[`${home.id}-entry`],STATE.DELIVERING_PURCHASES,1.2,{travelState:STATE.WALKING_HOME,locationId:home.id}),
   interact('put-away',[],STATE.PUTTING_AWAY_PURCHASES,3,{kind:'indoor',locationId:home.id}),
   walk('leave-home',home.exit,STATE.LEAVING_ACTIVITY,{show:true,clearProp:true,event:'householdDeliveries'})];
 }
 if(definition.id==='courier')return [
  interact('pickup',['courier-pickup'],STATE.PICKING_UP_PACKAGE,2,{propAfter:'package'}),
  interact('deliver',['courier-delivery'],STATE.DELIVERING_PACKAGE,2,{locationId:'lab-delivery'}),
  walk('return-to-market',{col:52,row:21},STATE.LEAVING_ACTIVITY,{clearProp:true,event:'courierDeliveries'})
 ];
 if(definition.id==='cleaning'){
  const points=SERVICE_POINTS.filter(p=>p.type==='cleaning');const offset=a.id%points.length;
  return points.map((_,i)=>interact(`sweep-${i}`, [points[(i+offset)%points.length].id],STATE.CLEANING,[4,6],{kind:'cleaning',event:'cleaningStops'}));
 }
 if(definition.id==='passenger')return [
  interact('wait-platform',ids(SERVICE_POINTS.filter(p=>p.type==='platform')),STATE.WAITING_FOR_TRAIN,0,{kind:'train-wait',travelState:STATE.WALKING_TO_STATION}),
  interact('board',['station-gate'],STATE.BOARDING_TRAIN,.7,{kind:'boarding',gate:'train-stopped',travelState:STATE.WALKING_TO_STATION}),
  interact('aboard',[],STATE.RIDING_TRAIN,0,{kind:'aboard',event:'passengersBoarded'})
 ];
 if(definition.id==='alighting')return [
  interact('alight',['station-gate'],STATE.ALIGHTING_TRAIN,.6,{kind:'alighting',travelState:STATE.WALKING_TO_STATION}),
  walk('leave-platform',{col:65,row:59},STATE.LEAVING_ACTIVITY,{show:true,event:'passengersAlighted'})
 ];
 if(definition.id==='plaza-event')return [
  interact('watch',ids(SERVICE_POINTS.filter(p=>p.type==='gathering')),STATE.WATCHING_HOLOGRAM,[8,12],{kind:'watching',travelState:STATE.WALKING_TO_SOCIAL}),
  walk('disperse',PARK_LOCATION.exit,STATE.LEAVING_ACTIVITY)
 ];
 return null;
}
