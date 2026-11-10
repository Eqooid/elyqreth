import {THEME} from './theme.js';
import {TILE,containedArtwork,building} from './world.js';

// Decorative objects never participate in workplace assignment or task processing.
// Art extends above a ground footprint, like a tree canopy; navigation uses only
// the footprint. Positions and sizes are world pixels, so camera transforms apply.
export const SCENERY_TYPES={
 wayfinding:{atlas:'blueprintProps',sprite:0,width:172,height:162},
 storyMonument:{atlas:'blueprintProps',sprite:1,width:108,height:179,animation:{kind:'neon',color:THEME.lighting.primary,period:7}},
 basin:{atlas:'blueprintProps',sprite:2,width:270,height:240},
 hoverTruck:{atlas:'blueprintProps',sprite:3,width:172,height:129,animation:{kind:'beacon',color:THEME.neon,period:5}},
 railPlatform:{atlas:'blueprintProps',sprite:4,width:752,height:67},
 gardenPlanter:{atlas:'blueprintProps',sprite:5,width:140,height:65},
 catTower:{atlas:'blueprintScenery',sprite:0,width:194,height:332,animation:{kind:'neon',color:THEME.lighting.primary,period:7}},
 barTower:{atlas:'blueprintScenery',sprite:1,width:260,height:424,animation:{kind:'neon',color:THEME.accents.pink,period:5}},
 storyTower:{atlas:'blueprintScenery',sprite:2,width:216,height:372,animation:{kind:'neon',color:THEME.accents.lavender,period:8}},
 humanityTower:{atlas:'blueprintScenery',sprite:3,width:240,height:404,animation:{kind:'neon',color:THEME.accents.cyan,period:8}},
 foregroundBlock:{atlas:'blueprintScenery',sprite:4,width:288,height:368,animation:{kind:'windows',color:THEME.accents.amber,period:7}},
 northUtility:{atlas:'blueprintScenery',sprite:5,width:96,height:368},
 dockUtility:{atlas:'blueprintScenery',sprite:6,width:194,height:192,animation:{kind:'beacon',color:THEME.lighting.window,period:5}},
 canalBridge:{atlas:'blueprintScenery',sprite:7,width:286,height:93},
 apartment:{atlas:'scenery',sprite:0,width:256,height:352,animation:{kind:'windows',color:THEME.accents.amber,period:7}},
 office:{atlas:'scenery',sprite:1,width:224,height:416,animation:{kind:'windows',color:THEME.lighting.window,period:5}},
 store:{atlas:'scenery',sprite:2,width:256,height:288,animation:{kind:'neon',color:THEME.accents.pink,period:3.7}},
 cafe:{atlas:'scenery',sprite:3,width:256,height:304,animation:{kind:'neon',color:THEME.accents.amber,period:4.3}},
 house:{atlas:'scenery',sprite:4,width:224,height:320,animation:{kind:'windows',color:THEME.accents.amber,period:9}},
 warehouse:{atlas:'scenery',sprite:5,width:288,height:288},
 utility:{atlas:'scenery',sprite:6,width:224,height:304,animation:{kind:'beacon',color:THEME.lighting.primary,period:2.8}},
 shop:{atlas:'scenery',sprite:7,width:256,height:320,animation:{kind:'neon',color:THEME.neon,period:5.3}},
 arcade:{atlas:'architecture',sprite:0,width:224,height:416,animation:{kind:'neon',color:THEME.neon,period:4}},
 billboard:{atlas:'architecture',sprite:1,width:256,height:448,animation:{kind:'neon',color:THEME.neon,period:7}},
 apartments:{atlas:'architecture',sprite:2,width:256,height:384,animation:{kind:'windows',color:THEME.accents.amber,period:8}},
 workshop:{atlas:'architecture',sprite:3,width:288,height:320,animation:{kind:'beacon',color:THEME.neon,period:5}},
 mixedUse:{atlas:'architecture',sprite:4,width:288,height:352,animation:{kind:'windows',color:THEME.accents.amber,period:6}},
 hotel:{atlas:'architecture',sprite:5,width:256,height:416,animation:{kind:'neon',color:THEME.accents.pink,period:5}},
 vending:{atlas:'street',sprite:0,width:32,height:58,animation:{kind:'neon',color:THEME.lighting.window,period:4.6}},
 bin:{atlas:'street',sprite:1,width:25,height:32},
 sign:{atlas:'street',sprite:2,width:30,height:68},
 neon:{atlas:'street',sprite:3,width:36,height:66,animation:{kind:'neon',color:THEME.accents.pink,period:3.3}},
 vent:{atlas:'street',sprite:4,width:34,height:23},
 tank:{atlas:'street',sprite:5,width:38,height:46},
 planter:{atlas:'street',sprite:6,width:45,height:42},
 bench:{atlas:'street',sprite:7,width:62,height:36},
 tree:{atlas:'terrain',sprite:8,width:96,height:124},
 pinkTree:{atlas:'terrain',sprite:9,width:86,height:108},
 lamp:{atlas:'terrain',sprite:10,width:32,height:100,light:true}
};
export function createScenery(id,type,footprint,options={}){
 const definition=SCENERY_TYPES[type];
 if(!definition)throw new Error(`Unknown scenery type: ${type}`);
 const [col,row,columns,rows]=footprint;
 return {id,type,...definition,x:(col+columns/2)*TILE,y:(row+rows)*TILE,
 collision:{col,row,columns,rows},layer:'world',...options};
}
// Actual image-relative render rectangles; solid footprints can be narrower than roofs.
function traced(id,type,referenceBounds,footprint,options={}){
 const [x,y,width,height]=containedArtwork(referenceBounds),[col,row,columns,rows]=footprint;
 // A fitted facade cannot retain whole blocked tiles outside its rendered bounds.
 const left=Math.max(col,Math.floor(x/TILE)),top=Math.max(row,Math.floor(y/TILE));
 const right=Math.min(col+columns,Math.ceil((x+width)/TILE)),bottom=Math.min(row+rows,Math.ceil((y+height)/TILE));
 return createScenery(id,type,[left,top,right-left,bottom-top],{referenceBounds:[x,y,width,height],x:x+width/2,y:y+height,width,height,...options});
}
export const DECORATIVE_BUILDINGS=[
 traced('cat-billboard','catTower',[0,-28,194,332],[0,0,12,19]),
 traced('hall-west-utility','northUtility',[192,-128,96,368],[12,0,5,15]),
 traced('market-west-utility','northUtility',[596,-136,64,432],[38,0,3,18]),
 traced('bar-arcade','barTower',[0,286,260,424],[0,26,16,18]),
 traced('east-stories-billboard','storyTower',[1320,-28,216,372],[83,0,13,21]),
 traced('east-humanity-billboard','humanityTower',[1296,320,240,404],[83,26,13,19]),
 traced('foreground-west-residences','foregroundBlock',[0,748,288,368],[0,49,18,15]),
 traced('foreground-central-residences','foregroundBlock',[416,820,300,300],[27,52,17,12]),
 traced('foreground-dock-utility','dockUtility',[1140,928,194,192],[71,60,12,4]),
];
const prop=(id,type,x,y,options={})=>createScenery(id,type,[Math.floor(x/TILE),Math.floor(y/TILE),1,1],{x,y,...options});
// Deliberate infill: commercial bins, residential furniture and a few garden
// accents. Existing entrances, crossroads and activity anchors remain clear.
export const URBAN_DETAILS=[
 prop('terrace-cafe-bin','bin',1842,296),
 prop('residence-east-planter','planter',696,904),
 prop('terrace-square-tree-west','tree',1624,616,{width:56,height:74}),
 prop('terrace-square-tree-east','tree',1784,504,{width:56,height:74}),
 prop('terrace-square-planter','planter',1608,472),
 prop('dock-promenade-bin','bin',1352,952),
 prop('residence-garden-lamp','lamp',440,984)
];
export const STREET_OBJECTS=[
 ...URBAN_DETAILS,
 prop('canal-terrace-bench','bench',1704,696,{collision:{col:106,row:42,columns:1,rows:1}}),
 prop('canal-terrace-planter','planter',1608,680),
 traced('station-wayfinding','wayfinding',[1110,758,172,162],[70,49,10,8]),
 traced('plaza-story-monument','storyMonument',[604,607,108,179],[38,41,6,7]),
 traced('dock-hover-truck','hoverTruck',[1320,723,172,129],[83,47,10,6]),
 traced('canal-basin-rim','basin',[792,463,270,240],[50,29,16,15],{
 collision:null,collisionParts:[{col:50,row:30,columns:1,rows:13},{col:65,row:30,columns:1,rows:13},{col:51,row:42,columns:14,rows:1}],depth:676}),
 traced('station-front-platform','railPlatform',[784,893,752,67],[49,57,47,3],{collision:null,depth:936}),
 traced('clinic-west-planter','gardenPlanter',[252,493,56,45],[16,32,3,2]),
 traced('clinic-east-planter','gardenPlanter',[535,502,119,62],[34,33,7,2]),
 traced('plaza-east-planter','gardenPlanter',[525,712,146,71],[33,47,9,2]),
 traced('plaza-front-planter','gardenPlanter',[346,764,220,38],[22,48,14,1]),
 prop('market-vending','vending',854,430),prop('cafe-bin','bin',1232,256),
 prop('plaza-direction','sign',662,762),prop('clinic-vending','vending',519,558),
 prop('canal-bench','bench',1000,680),prop('station-sign','sign',1172,882),
 prop('residential-planter','planter',399,930),
 // The bridge deck is independent art. Its walkable cells are defined in world.js;
 // two piers are collision parts, leaving both crossing routes clear.
 traced('upper-canal-footbridge','canalBridge',[784,410,286,93],[50,27,16,3],{
 collision:null,collisionParts:[{col:50,row:30,columns:1,rows:3},{col:65,row:30,columns:1,rows:3}],depth:438}),
 traced('lower-canal-footbridge','canalBridge',[784,682,286,64],[50,43,16,3],{
 collision:null,depth:686}),
 prop('station-vent','vent',813,757,{collision:null,depth:building('station').depth+1}),
 prop('apartment-tank','tank',98,804,{collision:null,depth:1024})
];
export const SCENERY=[...DECORATIVE_BUILDINGS,...STREET_OBJECTS];
