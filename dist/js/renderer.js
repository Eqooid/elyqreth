import {drawNpcStatus} from './runtime/npc-status-drawing.js';
import {THEME,visualAccent,visualRoleColor} from './theme.js';
import {WORLD,BUILDINGS,DECORATIONS,TILE,center,AGENT_SIZE,ROADS,BRIDGES} from './world.js';
import {AssetManager} from './assets.js';
import {Camera} from './camera.js';
import {Environment} from './environment.js';
import {TownScene} from './scene.js';
import {WaterSystem} from './water.js';
import {RoadRenderer} from './roads.js';
import {TrainSystem} from './train.js';
import {GROUND_TEXTURE} from './tile-map.js';
import {TrafficSystem} from './traffic.js';
import {Citizens} from './citizens.js';
import {DeveloperOverlays} from './debug.js';
import {CafeRenderer} from './cafe-renderer.js';
export class TownRenderer{
 constructor(canvas,simulation,onSelect,runtimePresentation=null,reducedMotion=()=>true){
 this.runtimePresentation=runtimePresentation;this.reducedMotion=reducedMotion;
 this.canvas=canvas;this.ctx=canvas.getContext('2d');this.sim=simulation;this.scene=new TownScene(simulation);this.onSelect=onSelect;this.selected=null;this.labels=false;this.pointers=new Map();this.ready=false;this.environment=new Environment();this.water=new WaterSystem();this.train=new TrainSystem();simulation.map.train=this.train;this.roads=new RoadRenderer();this.scene.effects={water:this.water,train:this.train,ambient:this.environment};
 this.resize();this.camera=new Camera(this.width,this.height);this.events();
 this.traffic=new TrafficSystem(simulation.map);this.citizens=new Citizens(simulation.map,simulation.agents);this.debug=new DeveloperOverlays();this.cafe=new CafeRenderer(simulation.activities);this.renderMs=0;this.frames=0;
 this.scene.effects.traffic=this.traffic;this.scene.citizens=this.citizens;
 this.roadDebug=new URLSearchParams(location.search).get('view')==='roads';document.body.classList.toggle('road-debug',this.roadDebug);
 this.assets=new AssetManager();this.assets.load().then(()=>{this.buildTerrainLayer();this.ready=true;document.getElementById('loading').hidden=true;}).catch(error=>{document.getElementById('loading').textContent=error.message;console.error(error);});
 this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
 }
 resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(r.width*this.dpr);this.canvas.height=Math.round(r.height*this.dpr);this.camera?.resize(r.width,r.height);}
 fit(){this.camera.fit();}worldAt(x,y){return this.camera.worldAt(x,y);}screenAt(x,y){return this.camera.screenAt(x,y);}zoom(factor,x,y){this.camera.zoomAt(factor,x,y);}
 update(dt){if(!this.ready)return;this.environment.clock=this.sim.clock;this.environment.update(dt);this.water.update(dt);this.train.update(dt);this.citizens.update(dt*this.sim.speed,this.sim.agents,this.camera);this.traffic.update(dt,[...this.sim.agents,...this.citizens.allPeople].filter(a=>!a.hidden));}
 events(){const c=this.canvas,local=e=>{const r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 c.addEventListener('pointerdown',e=>{c.focus({preventScroll:true});c.setPointerCapture(e.pointerId);const p=local(e);this.pointers.set(e.pointerId,p);this.dragged=false;this.down=p;});
 c.addEventListener('pointermove',e=>{if(!this.pointers.has(e.pointerId))return;const p=local(e),old=this.pointers.get(e.pointerId);if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)[1];const oldDistance=Math.hypot(old.x-other.x,old.y-other.y);if(oldDistance>5)this.camera.zoomAt(Math.hypot(p.x-other.x,p.y-other.y)/oldDistance,(p.x+other.x)/2,(p.y+other.y)/2);this.dragged=true;}else{if(Math.hypot(p.x-this.down.x,p.y-this.down.y)>4)this.dragged=true;this.camera.pan(old.x-p.x,old.y-p.y);}this.pointers.set(e.pointerId,p);});
 c.addEventListener('pointerup',e=>{if(this.pointers.size===1&&!this.dragged)this.selectAt(local(e));this.pointers.delete(e.pointerId);});c.addEventListener('pointercancel',e=>this.pointers.delete(e.pointerId));
 c.addEventListener('wheel',e=>{e.preventDefault();const p=local(e);this.camera.zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y);},{passive:false});
 c.addEventListener('keydown',e=>{const moves={ArrowLeft:[-65,0],ArrowRight:[65,0],ArrowUp:[0,-65],ArrowDown:[0,65]};if(moves[e.key]){e.preventDefault();this.camera.pan(...moves[e.key]);}if(['+','=','-'].includes(e.key)){e.preventDefault();this.zoom(e.key==='-'?.85:1.18);}if(e.key.toLowerCase()==='f')this.fit();});
 }
 selectAt(p){const world=this.worldAt(p.x,p.y);const a=[...this.sim.agents,...this.citizens.allPeople].sort((a,b)=>b.y-a.y).find(a=>!a.hidden&&Math.abs(a.x-world.x)<24&&world.y<a.y+8&&world.y>a.y-42);if(a){this.onSelect({type:a.decorative?'citizen':'agent',id:a.id});return;}
 const placard=this.labels&&BUILDINGS.find(b=>{const s=this.labelPosition(b);return Math.abs(p.x-s.x)<this.labelWidth(b)/2&&p.y>s.y-28&&p.y<s.y+3;});
 const b=placard||[...BUILDINGS].reverse().find(b=>world.x>=b.bounds[0]&&world.x<=b.bounds[0]+b.bounds[2]&&world.y>=b.bounds[1]&&world.y<=b.bounds[1]+b.bounds[3]);this.onSelect(b?{type:'building',id:b.id}:this.cafe.select(world));
 }
 labelWidth(b){return b.id==='hall'?154:120;}
 labelPosition(b){return this.screenAt(b.x,Math.max(105,b.referenceBounds[1]+55));}
 buildTerrainLayer(){
 // Cache terrain only. Buildings, props, characters, and effects stay independent.
 const layer=document.createElement('canvas');layer.width=WORLD.width;layer.height=WORLD.height;const c=layer.getContext('2d');c.imageSmoothingEnabled=false;c.fillStyle=THEME.slate;c.fillRect(0,0,layer.width,layer.height);
 for(let row=0;row<this.sim.map.rows;row++)for(let col=0;col<this.sim.map.columns;col++)this.assets.tile(c,GROUND_TEXTURE[this.sim.map.tiles[this.sim.map.index(col,row)]],col*TILE,row*TILE,TILE);
 // Road geometry and canal railings belong to the ground/detail layer.
 // Tone the swatches toward the reference's dark slate paving, leaving neon luminous.
 c.fillStyle='#0b101e28';c.fillRect(0,0,WORLD.width,WORLD.height);
 this.roads.drawSurfaceEdges(c,this.sim.map);
 this.roads.draw(c,this.sim.map);
 for(const [x,y,w,h] of BRIDGES){c.fillStyle='#152532';c.fillRect(x*TILE-3,y*TILE,3,h*TILE);c.fillRect((x+w)*TILE,y*TILE,3,h*TILE);}
 this.terrainLayer=layer;this.water.initialize(this.sim.map);
 const debug=document.createElement('canvas');debug.width=WORLD.width;debug.height=WORLD.height;this.roads.drawDebug(debug.getContext('2d'),this.sim.map);this.roadDebugLayer=debug;
 }
 draw(){const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle=THEME.midnight;c.fillRect(0,0,this.width,this.height);if(!this.ready)return;
 c.save();this.camera.apply(c);c.imageSmoothingEnabled=false;
 if(this.roadDebug){c.drawImage(this.roadDebugLayer,0,0);c.restore();return;}
 c.drawImage(this.terrainLayer,0,0);this.water.draw(c);this.train.drawTracks(c);
 const active=this.sim.currentAgent;if(active?.path.length){c.beginPath();c.moveTo(active.x,active.y);for(const p of active.path)c.lineTo(p.x,p.y);c.strokeStyle=THEME.neon+'65';c.lineWidth=2;c.setLineDash([3,9]);c.stroke();c.setLineDash([]);}
 const objects=[...this.scene.worldObjects.map(({kind,object:d})=>({depth:d.depth??d.y,draw:()=>{
 if(kind==='workplace')this.drawBuilding(c,d);
 else if(kind==='cafe')this.cafe.drawObject(c,d,this.assets,this.environment.time);
 else if(kind==='decoration')this.environment.drawDecoration(c,d,this.assets);
 else{const bounds=this.assets.draw(c,d.atlas,d.sprite,d.x,d.y,d.width,d.height,'bottom',d.referenceBounds?'stretch':'contain');this.environment.drawScenery(c,d,bounds);}
 }})),
 ...this.cafe.chairs.map(seat=>({depth:seat.position.y+3,draw:()=>this.cafe.drawFront(c,seat,this.assets)})),
 ...this.scene.agents.map(a=>({depth:a.y,draw:()=>this.drawAgent(c,a)})),
 ...this.citizens.allPeople.map(a=>({depth:a.y,draw:()=>this.drawAgent(c,a)})),
 ...this.traffic.vehicles.map(v=>({depth:v.y+5,draw:()=>this.traffic.draw(c,v,this.assets)})),
 {depth:this.train.route.depth,draw:()=>this.train.draw(c,this.assets)}];
 objects.sort((a,b)=>a.depth-b.depth);for(const object of objects)object.draw();
 this.citizens.drawEvent?.(c,this.environment.time);this.train.drawIndicator(c);this.environment.drawLights(c,this.sim);this.environment.drawParticles(c);
 for(const p of this.sim.packets){c.globalAlpha=p.life/2;c.fillStyle=visualAccent(p.color);for(let i=0;i<4;i++)c.fillRect(p.x+(i-1.5)*9,p.y-20-(2-p.life)*18-i%2*5,3,3);c.globalAlpha=1;}
 this.debug.draw(c,this.sim.map,this.traffic,this.train);
 c.restore();if(this.labels)for(const b of BUILDINGS)this.drawBuildingLabel(b);
 const citizen=this.citizens.allPeople.find(a=>this.selected?.type==='citizen'&&this.selected.id===a.id);if(citizen){const p=this.screenAt(citizen.x,citizen.y);c.font='12px ui-monospace,monospace';c.textAlign='center';c.fillStyle=THEME.secondary;c.fillText(`${citizen.name} · Visitor`,p.x,p.y+20);}
 for(const a of this.sim.agents){this.drawAgentLabel(a);this.drawRuntimeStatus(a);}this.cafe.drawBubbles(c,this.camera);
 }
 drawBuilding(c,b){const bounds=this.assets.draw(c,b.id==='station'?'rail':b.atlas,b.id==='station'?0:b.sprite,b.x,b.y,b.artWidth,b.artHeight,'bottom','stretch');this.environment.drawBuilding(c,b,bounds);
 if(this.selected?.type==='building'&&this.selected.id===b.id){const p=center(b.doorCell);c.fillStyle=visualAccent(b.color);c.fillRect(p.x-22,p.y+10,44,2);}
 }
 drawAgent(c,a){if(a.hidden)return;if(a.serviceResident){c.save();c.beginPath();c.rect(a.x-20,a.y-44,40,30);c.clip();if(!this.cafe.drawResident(c,a,this.assets,this.environment.time)){const f=a.animator.cell(a.role);this.assets.draw(c,'characters',f.row*8+f.col,a.x,a.y,30,42);}c.restore();return;}
 // A shadow is only a grounding cue; the resident itself is a real sprite frame.
 c.fillStyle='#060a1170';c.beginPath();c.ellipse(a.x,a.y,12,4,0,0,Math.PI*2);c.fill();
 if(!this.cafe.drawResident(c,a,this.assets,this.environment.time)){const frame=a.animator.cell(a.appearance||a.role);this.assets.draw(c,'characters',frame.row*8+frame.col,a.x,a.y,AGENT_SIZE.width,AGENT_SIZE.height);}
 if(['agent','citizen'].includes(this.selected?.type)&&this.selected.id===a.id){c.strokeStyle=a.decorative?THEME.secondary:THEME.lighting.selection;c.lineWidth=2;c.beginPath();c.moveTo(a.x-19,a.y+4);c.lineTo(a.x-19,a.y+9);c.lineTo(a.x-10,a.y+9);c.moveTo(a.x+19,a.y+4);c.lineTo(a.x+19,a.y+9);c.lineTo(a.x+10,a.y+9);c.stroke();}
 if(a.prop?.kind==='shoppingBag'){const bx=Math.round(a.x+(a.direction==='left'?-12:8)),by=Math.round(a.y-18);c.fillStyle='#c47736';c.fillRect(bx,by,8,10);c.fillStyle='#ffe0a1';c.fillRect(bx+2,by-2,4,2);c.fillStyle='#314758';c.fillRect(bx+2,by+3,4,2);}if(a.prop&&a.prop.kind!=='shoppingBag'&&!['EATING','DRINKING_COFFEE','SITTING','SOCIALIZING'].includes(a.state)){const x=Math.round(a.x+(a.direction==='left'?-12:9)),y=Math.round(a.y-21);if(a.prop.kind==='coffee'){c.fillStyle='#ffe6b6';c.fillRect(x,y,5,5);c.fillRect(x+5,y+1,2,3);c.fillStyle='#7b421e';c.fillRect(x,y,5,1);}else if(a.prop.kind==='food'){c.fillStyle='#f3af5b';c.fillRect(x,y,7,4);c.fillStyle='#fff1c7';c.fillRect(x+1,y+4,5,3);}else if(a.prop.kind==='package'){c.fillStyle='#b57945';c.fillRect(x-3,y,11,9);c.fillStyle='#efd09b';c.fillRect(x+1,y,2,9);}}if(a.walkPurpose==='deliver'){c.fillStyle=THEME.secondary;c.fillRect(a.x+12,a.y-20,5,6);c.fillStyle=THEME.primary;c.fillRect(a.x+13,a.y-19,3,1);}
 }
 drawBuildingLabel(b){const c=this.ctx,p=this.labelPosition(b),width=this.labelWidth(b);c.fillStyle='#131924df';c.strokeStyle=visualAccent(b.color)+'80';c.lineWidth=1;c.beginPath();c.roundRect(p.x-width/2,p.y-27,width,29,4);c.fill();c.stroke();c.textAlign='center';c.fillStyle=visualAccent(b.color);c.font='600 12px ui-monospace,monospace';c.fillText(b.id==='hall'?'✦ ORCHESTRATOR':b.title.toUpperCase(),p.x,p.y-8);}
 drawRuntimeStatus(a){
 if(a.hidden||!this.runtimePresentation)return;const p=this.screenAt(a.x,a.y),y=p.y-AGENT_SIZE.height*this.camera.zoom-24;
 if(p.x< -12||p.x>this.width+12||y< -12||y>this.height+12)return;
 drawNpcStatus(this.ctx,this.runtimePresentation.getForEntity(a),p.x,y,performance.now()/1000,this.reducedMotion());
 }
 drawAgentLabel(a){if(a.hidden)return;const c=this.ctx,p=this.screenAt(a.x,a.y),selected=this.selected?.type==='agent'&&this.selected.id===a.id;const text=selected||a.status==='Working'||a.status==='Error'?`${a.name} · ${a.status}`:a.name;c.font='600 12px ui-monospace,monospace';const width=c.measureText(text).width+14;c.fillStyle='#101722d9';c.beginPath();c.roundRect(p.x-width/2,p.y+7,width,21,3);c.fill();c.fillStyle=a.status==='Error'?THEME.error:visualRoleColor(a.appearance||a.role);c.textAlign='center';c.fillText(text,p.x,p.y+22);
 if(a.status==='Working'){c.fillStyle='#151824';c.fillRect(p.x-18,p.y-(AGENT_SIZE.height+8)*this.camera.zoom,36,4);c.fillStyle=THEME.neon;c.fillRect(p.x-18,p.y-(AGENT_SIZE.height+8)*this.camera.zoom,36*a.progress,4);}else if(a.status==='Error'){c.font='bold 17px monospace';c.fillText('!',p.x,p.y-(AGENT_SIZE.height+6)*this.camera.zoom);}
 }
}
