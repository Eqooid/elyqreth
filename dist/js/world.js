// Reference coordinates are world pixels: the original 1536×1024 composition.
export const TILE=16;
export const ORIGINAL_WORLD={width:1536,height:1024,columns:96,rows:64};
export const WORLD={width:1856,height:1024,columns:116,rows:64};
export const AGENT_SIZE={width:30,height:42};
export const ROLES=['Researcher','Designer','Developer','Tester'];
export const COLORS={Researcher:'#ffc45b',Designer:'#ff85ca',Developer:'#69e2f2',Tester:'#b9b0ff'};
// A render rectangle is independent of the solid ground footprint and entrance.
const site=(id,name,title,tiles,referenceBounds,entranceCol,sprite,color,description)=>{
 const [tx,ty,tw,th]=tiles,[rx,ry,rw,rh]=referenceBounds;
 const doorCell={col:entranceCol,row:ty+th},workCell={col:entranceCol,row:ty+th-1};
 return {id,name,title,tiles,referenceBounds,sprite,atlas:'buildings',color,description,
 door:id,doorCell,workCell,bounds:[tx*TILE,ty*TILE,tw*TILE,th*TILE],
 x:rx+rw/2,y:ry+rh,width:rw,height:rh,artWidth:rw,artHeight:rh,
 collision:{col:tx,row:ty,columns:tw,rows:th},layer:'world',depth:workCell.row*TILE-12};
};
export const BUILDINGS=[
 site('hall','City Hall','Orchestrator',[20,0,13,18],[274,-48,330,342],26,0,'#ff9a36','Plans the mission, assigns roles, and receives each handoff. City Hall is the orchestrator; the residents are its agents.'),
 site('develop','Maker Market','Development',[41,0,19,21],[653,0,306,350],50,1,COLORS.Developer,'Developers implement the page at the market workshop.'),
 site('design','Café Studio','Design',[62,0,15,21],[976,0,270,351],66,2,COLORS.Designer,'Designers prepare the layout and visual direction in the café studio.'),
 site('test','Quality Clinic','Testing',[21,26,12,9],[333,353,196,220],27,3,COLORS.Tester,'Testers validate the result against the requirements brief.'),
 site('research','R&D Lab','Research',[66,26,13,16],[1034,337,225,350],70,4,COLORS.Researcher,'Researchers investigate requirements and prepare the brief.'),
 site('station','Central Station','Town station',[50,46,19,11],[775,708,342,246],59,5,'#ff9a36','Residents visit the station and canal promenades between assignments.')
];
// Integral banner supports have small extra ground colliders, independent of the facade.
BUILDINGS[0].collisionParts=[{col:18,row:14,columns:2,rows:4},{col:33,row:14,columns:3,rows:4}];
export const DEFAULT_WORKPLACES={Researcher:'research',Designer:'design',Developer:'develop',Tester:'test'};
export const building=id=>BUILDINGS.find(b=>b.id===id);
export const center=cell=>({x:cell.col*TILE+TILE/2,y:cell.row*TILE+TILE/2});
export const point=id=>center(building(id).doorCell);
// Grid-boundary centerlines trace the reference's boulevard, station approach
// and narrow eastern service lane. Only named nodes can connect streets.
export const STREET_NODES=[
 {id:'west-gate',col:0,row:24,endpoint:'boundary',name:'West continuation'},
 {id:'market-junction',col:47,row:24,name:'Market junction'},
 {id:'east-junction',col:80,row:24,name:'East junction'},
 {id:'east-gate',col:116,row:24,endpoint:'boundary',name:'East continuation'},
 {id:'station-dropoff',col:47,row:41,endpoint:'destination',name:'Station drop-off'},
 {id:'service-court',col:80,row:44,endpoint:'destination',name:'R&D service court'}
];
const corridor=(id,from,to,width,roadType='asphalt')=>{
 const a=STREET_NODES.find(n=>n.id===from),b=STREET_NODES.find(n=>n.id===to),half=width/2;
 const axis=a.row===b.row?'horizontal':'vertical';
 const x=Math.max(0,Math.min(a.col,b.col)-half),y=Math.max(0,Math.min(a.row,b.row)-half);
 const right=Math.min(WORLD.columns,Math.max(a.col,b.col)+half),bottom=Math.min(WORLD.rows,Math.max(a.row,b.row)+half);
 return {id,from,to,width,axis,orientation:axis,roadType,connections:[from,to],tiles:[x,y,right-x,bottom-y]};
};
export const ROADS=[
 corridor('civic-boulevard','west-gate','market-junction',4),
 corridor('market-boulevard','market-junction','east-junction',4),
 corridor('east-boulevard','east-junction','east-gate',4),
 corridor('station-approach','market-junction','station-dropoff',4),
 corridor('east-service-alley','east-junction','service-court',2,'alley')
];
export const CROSSINGS=[
 {id:'hall-crossing',tiles:[38,22,2,4],axis:'horizontal'},
 {id:'cafe-crossing',tiles:[63,22,2,4],axis:'horizontal'},
 {id:'market-crossing',tiles:[45,27,4,2],axis:'vertical'},
 {id:'station-crossing',tiles:[45,37,4,2],axis:'vertical'},
 {id:'terrace-crossing',tiles:[106,22,2,4],axis:'horizontal'}
];
export const RAILWAYS=[{id:'station-track-deck',tiles:[50,55,66,2]}];
export const SIDEWALKS=[
 {id:'hall-promenade',tiles:[15,18,27,4]},
 {id:'market-frontage',tiles:[41,21,38,1]},
 {id:'clinic-west-access',tiles:[19,31,2,5]},
 {id:'clinic-garden-path',tiles:[16,25,27,12]},
 {id:'canal-west-bank',tiles:[48,27,2,20]},
 {id:'canal-east-bank',tiles:[65,27,1,19]},
 {id:'station-rear-walk',tiles:[48,43,48,3]},
 {id:'plaza-front',tiles:[15,49,30,3]},
 {id:'station-stairs',tiles:[45,47,5,17]},
 {id:'dock-front',tiles:[69,57,27,3]},
 {id:'terrace-frontage',tiles:[96,19,20,3]},
 {id:'terrace-counter-court',tiles:[99,9,14,10]},
 {id:'cafe-frontage-terrace',tiles:[96,15,20,7]},
 {id:'terrace-promenade',tiles:[96,26,20,19]}
];
export const PUBLIC_SPACES=[
 {id:'globe-plaza',tiles:[16,36,28,13],terrain:'PLAZA'},
 {id:'clinic-garden',tiles:[16,25,6,11],terrain:'GRASS'},
 {id:'clinic-east-garden',tiles:[32,25,10,10],terrain:'GRASS'},
 {id:'plaza-west-garden',tiles:[16,41,5,7],terrain:'GRASS'},
 {id:'plaza-east-garden',tiles:[34,37,8,12],terrain:'GRASS'},
 {id:'foreground-garden',tiles:[18,53,8,11],terrain:'GRASS'},
 {id:'terrace-garden',tiles:[96,45,20,2],terrain:'GRASS'},
 {id:'terrace-north-garden',tiles:[96,0,20,19],terrain:'GRASS'},
 {id:'terrace-square',tiles:[99,28,14,12],terrain:'GRASS'}
];
export const WATER_AREAS=[[50,29,16,17],[50,58,21,6],[84,47,12,10],[96,47,20,17]];
export const BRIDGES=[[50,27,16,3],[50,43,16,3]];
export const URBAN_BLOCKS=[
 {id:'civic-market',name:'Civic / market frontage',tiles:[0,0,82,22],publicSpaces:[]},
 {id:'bar-quarter',name:'Bar / arcade quarter',tiles:[0,19,18,27],publicSpaces:[]},
 {id:'east-signage',name:'East billboard blocks',tiles:[82,0,14,46],publicSpaces:[]},
 {id:'foreground',name:'Foreground residential blocks',tiles:[0,47,45,17],publicSpaces:[]}
];
export const POINTS_OF_INTEREST=[
 {name:'City Hall stairs',col:26,row:18},{name:'Market frontage',col:50,row:21},
 {name:'Café terrace',col:66,row:21},{name:'Central crossing sidewalk',col:39,row:21},
 {name:'Clinic forecourt',col:27,row:35},{name:'Globe plaza',col:27,row:46},
 {name:'Garden walk',col:35,row:36},{name:'Canal west bank',col:49,row:37},
 {name:'Upper canal bridge',col:57,row:28},{name:'Lower canal bridge',col:58,row:44},
 {name:'R&D doorway',col:70,row:42},{name:'East pedestrian lane',col:80,row:38},
 {name:'Station forecourt',col:59,row:57},{name:'Dock promenade',col:81,row:59},
 {name:'Canal terrace promenade',col:98,row:44},{name:'Ember Café frontage',col:96,row:21},
 {name:'Residential stairs',col:46,row:59},{name:'South garden',col:23,row:60}
];
// Locations traced from the reference; every decoration is drawn separately.
const decor=(id,sprite,x,y,w,h,extra={})=>({id,sprite,x,y,w,h,solid:true,layer:'world',...extra});
export const DECORATIONS=[
 decor('hall-orange-tree-left',8,235,161,100,136),decor('hall-orange-tree-right',8,568,166,102,138),
 decor('cafe-pink-tree',9,1256,192,91,124),
 decor('clinic-orange-tree',8,290,493,109,142),decor('clinic-pink-tree',9,530,535,92,118),
 decor('clinic-garden-tree',8,591,517,116,146),
 decor('plaza-west-tree',8,185,721,106,142),decor('plaza-east-tree',8,560,718,105,139),
 decor('foreground-tree',8,354,984,99,139),
 decor('globe',12,421,740,128,166),
 decor('plaza-bench',11,286,742,77,42),decor('garden-bench',11,589,574,75,42),
 decor('hall-planter',14,277,271,55,55),decor('market-planter',14,938,329,52,50),
 decor('canal-planter',14,1010,656,52,52),decor('dock-kiosk',15,1430,961,63,85),
 decor('terrace-orange-tree',8,1568,120,80,111),decor('terrace-pink-tree',9,1824,135,76,105),
 decor('terrace-garden-tree',8,1800,742,76,98),
 decor('terrace-lamp-north',10,1544,320,28,96,{light:true}),decor('terrace-lamp-south',10,1840,705,28,96,{light:true}),
 ...[[314,350],[550,350],[654,308],[1020,423],[1278,479],[301,632],[576,592],[672,553],[300,818],[749,990],[1157,966],[1505,970]].map(([x,y],i)=>decor(`lamp-${i}`,10,x,y,28,96,{light:true}))
];
export function makePlan(task){return [
 {role:'Researcher',title:'Research',deliverable:`Requirements brief for “${task}”`,seconds:5},
 {role:'Designer',title:'Design',deliverable:'Layout and visual design, based on the requirements brief',seconds:6},
 {role:'Developer',title:'Build',deliverable:'Page implementation, based on the approved layout',seconds:8},
 {role:'Tester',title:'Test',deliverable:'Validation report against the requirements brief',seconds:5}
].map(s=>({...s,status:'pending',progress:0,agentId:null}));}
