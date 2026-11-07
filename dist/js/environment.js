import {THEME,visualAccent,BUILDING_PALETTES} from './theme.js';
import {PARK_OBJECTS} from './locations.js';
import {BUILDINGS,DECORATIONS,TILE,WORLD} from './world.js';
import {SCENERY} from './scenery.js';
const phaseOf=id=>[...id].reduce((n,c)=>((n*31+c.charCodeAt(0))>>>0),7)%997/97;
export class Environment{
 constructor(){this.time=0;this.clock=null;this.glows=new Map();this.lamps=[...DECORATIONS,...SCENERY,...PARK_OBJECTS].filter(d=>d.light);this.particles=Array.from({length:22},(_,i)=>({x:(i*223)%WORLD.width,y:(i*137)%WORLD.height,speed:6+i%8}));}
 glow(color){if(!this.glows.has(color)){const layer=document.createElement('canvas');layer.width=112;layer.height=112;const c=layer.getContext('2d');const gradient=c.createRadialGradient(56,56,0,56,56,56);gradient.addColorStop(0,color);gradient.addColorStop(1,'transparent');c.fillStyle=gradient;c.fillRect(0,0,112,112);this.glows.set(color,layer);}return this.glows.get(color);}
 update(dt){this.time+=dt;for(const p of this.particles){p.y-=p.speed*dt;p.x+=Math.sin(this.time*.4+p.speed)*dt*3;if(p.y<0)p.y=WORLD.height;if(p.x<0)p.x=WORLD.width;if(p.x>WORLD.width)p.x=0;}}
 drawDecoration(c,d,assets){
 c.save();
 if(d.sprite===8||d.sprite===9){
 // Bend one or two canopy pixels about a fixed trunk, not the ground footprint.
 const phase=phaseOf(d.id),sway=Math.round(Math.sin(this.time*(.75+phase*.03)+phase)*1.4);
 c.translate(d.x,d.y);c.transform(1,0,-sway/d.h,1,0,0);assets.draw(c,'terrain',d.sprite,0,0,d.w,d.h);
 }else assets.draw(c,'terrain',d.sprite,d.x,d.y,d.w,d.h);
 c.restore();
 }
 drawBuilding(c,b,bounds){
 const phase=phaseOf(b.id),t=this.time,period=3.5+phase*.35;
 const sign={hall:[.2,.29,.59,.11],develop:[.19,.43,.66,.11],design:[.17,.47,.42,.13],test:[.22,.43,.57,.14],research:[.21,.24,.62,.3],station:[.17,.34,.67,.12]}[b.id];
 c.save();c.fillStyle=BUILDING_PALETTES[b.id].sign;
 c.globalAlpha=.025+.025*(1+Math.sin(t/period*6.28+phase))/2;
 c.fillRect(Math.round(bounds.x+sign[0]*bounds.width),Math.round(bounds.y+sign[1]*bounds.height),Math.round(sign[2]*bounds.width),Math.round(sign[3]*bounds.height));
 // A few small roof windows independently cycle through their evening activity.
 for(let i=0;i<3;i++){const lit=Math.sin(t/(5+i+phase)+phase+i*2)>(this.clock?.period==='Night'?.1:.45);c.globalAlpha=lit?.6:.2;c.fillStyle=lit?BUILDING_PALETTES[b.id].window:THEME.slate;c.fillRect(Math.round(bounds.x+bounds.width*(.35+i*.13)),Math.round(bounds.y+bounds.height*.2),3,2);}
 c.restore();
 }
 drawScenery(ctx,object,bounds){
 const a=object.animation;if(!a)return;
 // Deterministic lighting only: it never changes agent time, states, or navigation.
 const phase=phaseOf(object.id),cycle=this.time/a.period+phase;
 ctx.save();ctx.fillStyle=visualAccent(a.color);
 if(a.kind==='windows'){
 ctx.globalAlpha=.12+.08*Math.sin(cycle*Math.PI*2);
 for(let i=0;i<3;i++)if((Math.floor(cycle)+i)%3!==0)ctx.fillRect(Math.round(bounds.x+bounds.width*(.26+i*.19)),Math.round(bounds.y+bounds.height*.58),3,3);
 }else if(a.kind==='beacon'){
 ctx.globalAlpha=.3+.2*Math.sin(cycle*Math.PI*2);ctx.fillRect(Math.round(bounds.x+bounds.width*.72),Math.round(bounds.y+bounds.height*.09),3,3);
 }else{
 const flicker=Math.sin(this.time*16+phase)>.97?.08:.17;
 ctx.globalAlpha=flicker+.035*Math.sin(cycle*Math.PI*2);
 const x=bounds.x+bounds.width*.5,y=bounds.y+bounds.height*.76;
 const radius=Math.round(bounds.width*.28);ctx.drawImage(this.glow(visualAccent(a.color)),Math.round(x-radius),Math.round(y-radius),radius*2,radius*2);
 }
 if(object.type==='storyTower'||object.type==='humanityTower'){
 // A dim electronic scan travels through each display on its own clock.
 const [x,y,w,h]=[bounds.x+bounds.width*.12,bounds.y+bounds.height*.22,bounds.width*.76,bounds.height*.39];
 ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=THEME.secondary;ctx.globalAlpha=.13;
 ctx.fillRect(Math.round(x),Math.round(y+(cycle%1+1)%1*h),Math.round(w),2);
 }ctx.restore();
 }
 drawLights(ctx,sim){
 // One cached full-scene tint keeps night subtle; it never covers UI.
 const dark=this.clock?.darkness||0;if(dark){ctx.fillStyle=THEME.midnight;ctx.globalAlpha=dark*.12;ctx.fillRect(0,0,WORLD.width,WORLD.height);ctx.globalAlpha=1;}
 for(const d of this.lamps){ctx.globalAlpha=.08+.08*(this.clock?.darkness||0)+Math.sin(this.time*(1.4+phaseOf(d.id)*.06)+d.x)*.018;ctx.drawImage(this.glow(THEME.lighting.primary),Math.round(d.x-55),Math.round(d.y-111),110,110);}ctx.globalAlpha=1;
 for(const b of BUILDINGS){const working=sim.agents.some(a=>a.workplace===b.id&&a.state==='WORKING'),orchestrating=b.id==='hall'&&sim.running;const x=b.bounds[0]+b.bounds[2]*.5,y=b.bounds[1]+b.bounds[3]*.66;
 if(working||orchestrating){ctx.fillStyle=visualAccent(b.color);ctx.globalAlpha=.35+Math.sin(this.time*4)*.15;ctx.fillRect(x-12,y-3,24,3);ctx.globalAlpha=1;}
 // An independent little monitor display in the working alcove.
 const wx=b.workCell.col*TILE+16,wy=b.workCell.row*TILE+16;
 if(working){ctx.fillStyle=THEME.lighting.primary;const n=Math.floor(this.time*7)%4;for(let r=0;r<3;r++)ctx.fillRect(wx-9,wy-20+r*3,5+(n+r)%4*3,1);}
 }
 }
 drawParticles(ctx){for(let i=0;i<this.particles.length;i++){const p=this.particles[i];ctx.globalAlpha=.18+.12*Math.sin(this.time+i);ctx.fillStyle=i%5===0?THEME.pink:THEME.secondary;ctx.fillRect(Math.round(p.x),Math.round(p.y),2,2);}ctx.globalAlpha=1;}
}
