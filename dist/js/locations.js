// All positions are world coordinates. Service, furniture and task workplaces
// have separate identities; transient occupancy is owned by ActivityController.
import {containedArtwork} from './world.js';
export const CAFE_LOCATION={id:'east-terrace',name:'Ember Café',bounds:[1536,64,320,288],exit:{col:96,row:21},entry:{col:96,row:21}};
const prop=(id,type,sprite,x,y,width,height,extra={})=>({id,type,atlas:'cafe',sprite,x,y,width,height,layer:'world',...extra});
// Compact frontage terrace north of the boulevard: three tables, six seats.
export const CAFE_TABLES=[[1576,312],[1688,312],[1800,312]].map(([x,y],i)=>prop(`cafe-table-${i+1}`,'table',1,x,y+16,58,48,{locationId:CAFE_LOCATION.id,collision:{col:Math.floor(x/16)-1,row:Math.floor(y/16)-1,columns:3,rows:3},center:{x,y}}));
const directions=[['north',0,-32,'down',2],['south',0,32,'up',5]];
export const CAFE_SEATS=CAFE_TABLES.flatMap(t=>directions.map(([side,dx,dy,direction,sprite])=>{
 const x=t.center.x+dx,y=t.center.y+dy;
 return prop(`${t.id}-chair-${side}`,'chair',sprite,x,y+7,27,34,{locationId:CAFE_LOCATION.id,tableId:t.id,direction,position:{x,y},interactionPosition:{x,y},interactionCell:{col:Math.floor(x/16),row:Math.floor(y/16)},depth:y-1,capacity:1});
}));
export const CAFE_OBJECTS=[
 prop('cafe-counter','counter',0,1696,248,202,174,{collision:{col:100,row:10,columns:12,rows:5}}),
 ...CAFE_TABLES,...CAFE_SEATS,
 ...CAFE_TABLES.map(t=>prop(`${t.id}-cup`,'cup',8,t.x+11,t.y-32,10,10,{depth:t.y+1,tableId:t.id})),
 prop('cafe-umbrella','umbrella',6,1560,248,58,80,{collision:{col:97,row:15,columns:1,rows:1}}),
 ...[[1544,264],[1832,264]].map(([x,y],i)=>prop(`cafe-planter-${i}`,'planter',7,x,y,34,32,{collision:{col:Math.floor(x/16),row:Math.floor(y/16)-1,columns:1,rows:2}}))
];
const servicePoint=(id,type,locationId,col,row,direction='up')=>({id,type,locationId,position:{x:col*16+8,y:row*16+8},interactionPosition:{x:col*16+8,y:row*16+8},interactionCell:{col,row},direction,capacity:1});
export const CAFE_ORDER_POINT=servicePoint('cafe-order','counter',CAFE_LOCATION.id,109,17);
export const CAFE_STAFF_POINT=servicePoint('cafe-staff','staff',CAFE_LOCATION.id,109,15,'down');
export const CAFE_QUEUE_POINTS=[104,106,108].map((col,i)=>servicePoint(`cafe-queue-${i+1}`,'queue',CAFE_LOCATION.id,col,16));
export const CAFE_STAFF={id:'cafe-barista',name:'Ember',role:'Designer',visitorRole:'Barista',position:{x:1752,y:248},servicePointId:CAFE_ORDER_POINT.id};
export const COFFEE_ACTIVITY={id:'coffee',locationId:CAFE_LOCATION.id,label:'Coffee break',chance:.62,maxAgents:3,maxVisitors:1,admissionGap:8,decisionDelay:[12,23],seatDuration:[38,64],cooldown:[45,95],afterWorkCooldown:20,routeTimeout:95,waitTimeout:5,sipPeriod:5.2};

// Existing globe-plaza gardens become the shared park; no landmark moves.
export const PARK_LOCATION={id:'globe-park',name:'Circuit Park',bounds:[256,544,448,256],entry:{col:23,row:39},exit:{col:29,row:46}};
export const PARK_BENCHES=[
 {id:'plaza-bench',atlas:'terrain',sprite:11,x:286,y:742,width:77,height:42,depth:728,capacity:2},
 {id:'garden-bench',atlas:'terrain',sprite:11,x:589,y:574,width:75,height:42,depth:570,capacity:2},
 {id:'park-reading-bench',atlas:'street',sprite:7,x:680,y:584,width:62,height:36,depth:568,capacity:2,collision:{col:42,row:35,columns:1,rows:1}}
].map(b=>({...b,type:'bench',layer:'world',locationId:PARK_LOCATION.id}));
export const PARK_SEATS=[[[16,46],[18,46]],[[36,36],[38,36]],[[41,36],[43,36]]].flatMap((cells,i)=>cells.map(([col,row],n)=>({id:`${PARK_BENCHES[i].id}-seat-${n+1}`,type:'benchSeat',locationId:PARK_LOCATION.id,benchId:PARK_BENCHES[i].id,tableId:PARK_BENCHES[i].id,direction:'down',position:{x:col*16+8,y:row*16+8},interactionPosition:{x:col*16+8,y:row*16+8},interactionCell:{col,row},capacity:1})));
export const PARK_OBJECTS=[PARK_BENCHES[2],
 {id:'park-reading-planter',type:'planter',atlas:'street',sprite:6,x:344,y:648,width:37,height:36,collision:{col:21,row:40,columns:1,rows:1},layer:'world'},
 {id:'park-reading-lamp',type:'lamp',atlas:'terrain',sprite:10,x:376,y:710,width:28,height:94,light:true,collision:{col:23,row:44,columns:1,rows:1},layer:'world'}];
export const MARKET_LOCATION={id:'market-visit',name:'Maker Market',buildingId:'develop',bounds:[656,0,304,350],entry:{col:50,row:21},exit:{col:52,row:21}};
export const HOME_LOCATIONS=[
 {id:'west-residence',name:'West Apartments',buildingId:'foreground-west-residences',bounds:containedArtwork([0,748,288,368]),entry:{col:17,row:51},exit:{col:17,row:50}},
 {id:'central-residence',name:'Central Apartments',buildingId:'foreground-central-residences',bounds:containedArtwork([416,820,300,300]),entry:{col:28,row:51},exit:{col:29,row:50}}
];
const entrance=(id,locationId,col,row,approach={col,row})=>({id,type:'entrance',locationId,position:{x:col*16+8,y:row*16+8},interactionPosition:{x:col*16+8,y:row*16+8},interactionCell:{col,row},approachCell:approach,direction:'up',capacity:1});
export const ENTRANCE_POINTS=[entrance('market-entry',MARKET_LOCATION.id,50,20,MARKET_LOCATION.entry),...HOME_LOCATIONS.map(h=>entrance(`${h.id}-entry`,h.id,h.entry.col,h.entry.row))];
export const LOCATIONS=[CAFE_LOCATION,PARK_LOCATION,MARKET_LOCATION,...HOME_LOCATIONS,{id:'station-platform',name:'Central Station platform',bounds:[864,904,192,64],entry:{col:59,row:58},exit:{col:65,row:59}},{id:'canal-promenade',name:'Canal promenade',bounds:[1536,416,320,320],entry:{col:98,row:29},exit:{col:98,row:44}},{id:'lab-delivery',name:'R&D delivery door',bounds:[1088,656,96,48],entry:{col:72,row:42},exit:{col:72,row:43}},{id:'central-plaza',name:'Central Plaza',bounds:[256,576,448,208],entry:{col:29,row:46},exit:{col:29,row:46}}];
export const SERVICE_POINTS=[
 servicePoint('market-window','browse',MARKET_LOCATION.id,48,21),
 servicePoint('courier-pickup','service',MARKET_LOCATION.id,52,21),
 servicePoint('courier-delivery','service','lab-delivery',72,42),
 ...[[98,29],[114,32],[98,42]].map(([col,row],i)=>servicePoint(`cleaning-zone-${i+1}`,'cleaning','canal-promenade',col,row,'down')),
 ...[57,61,64].map((col,i)=>servicePoint(`station-wait-${i+1}`,'platform','station-platform',col,58,'up')),
 servicePoint('station-gate','boarding','station-platform',59,57,'up'),
 ...[[29,38],[30,39],[32,38]].map(([col,row],i)=>servicePoint(`plaza-watch-${i+1}`,'gathering','central-plaza',col,row,'left'))
];
export const INTERACTION_POINTS=[...CAFE_SEATS,...PARK_SEATS,...ENTRANCE_POINTS,CAFE_STAFF_POINT,CAFE_ORDER_POINT,...CAFE_QUEUE_POINTS,...SERVICE_POINTS];
export const READING_ACTIVITY={...COFFEE_ACTIVITY,id:'reading',locationId:PARK_LOCATION.id,label:'Park reading',mode:'seated',chance:.72,maxAgents:2,maxVisitors:1,seatDuration:[42,72],cooldown:[65,115],admissionGap:7};
export const SHOPPING_ACTIVITY={...COFFEE_ACTIVITY,id:'shopping',locationId:MARKET_LOCATION.id,label:'Shopping',mode:'indoor',chance:.8,maxAgents:2,maxVisitors:1,seatDuration:[16,30],cooldown:[90,150],admissionGap:6};
export const REST_ACTIVITY={...COFFEE_ACTIVITY,id:'rest',locationId:'home',label:'Rest at home',mode:'home',chance:1,maxAgents:100,maxVisitors:0,seatDuration:[36,64],cooldown:[100,160],admissionGap:5};
export const JOB_ACTIVITIES=['courier','cleaning','passenger','alighting','plaza-event'].map(id=>({...COFFEE_ACTIVITY,id,label:id,locationId:{courier:MARKET_LOCATION.id,cleaning:'canal-promenade',passenger:'station-platform',alighting:'station-platform','plaza-event':'central-plaza'}[id],chance:0,maxAgents:0,maxVisitors:3,routeTimeout:120,cooldown:[35,65]}));
export const ACTIVITY_DEFINITIONS=[COFFEE_ACTIVITY,READING_ACTIVITY,SHOPPING_ACTIVITY,REST_ACTIVITY,...JOB_ACTIVITIES];
