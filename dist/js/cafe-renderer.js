import {THEME} from './theme.js';
import {CAFE_LOCATION,CAFE_TABLES,CAFE_SEATS,PARK_LOCATION} from './locations.js';
const roleIndex={Researcher:0,Designer:1,Developer:2,Tester:3};
const directions=['down','left','right','up'];
export class CafeRenderer{
 constructor(activities){this.activities=activities;}
 drawObject(c,d,assets,time){
 assets.draw(c,d.atlas,d.sprite,d.x,d.y,d.width,d.height);
 if(d.type==='counter'){c.save();c.globalAlpha=.09+.025*Math.sin(time*2.1);c.drawImage(this.glow||(this.glow=this.makeGlow()),d.x-104,d.y-138,208,160);c.restore();}
 if(d.type==='cup'&&this.activities.actors.some(a=>a.activity?.tableId===d.tableId&&this.activities.pose(a)))this.steam(c,d.x,d.y-9,time,d.x*.07);
 }
 makeGlow(){const canvas=document.createElement('canvas');canvas.width=112;canvas.height=112;const c=canvas.getContext('2d'),g=c.createRadialGradient(56,56,0,56,56,56);g.addColorStop(0,THEME.accents.amber);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,112,112);return canvas;}
 steam(c,x,y,time,phase){c.save();for(let i=0;i<3;i++){const t=(time*.43+i/3+phase)%1;c.globalAlpha=(1-t)*.34;c.fillStyle=THEME.primary;c.fillRect(Math.round(x+Math.sin(t*6.28+phase)*2),Math.round(y-t*17),1,2);}c.restore();}
 drawResident(c,a,assets,time){const pose=this.activities.pose(a);if(!pose)return false;if(['eating','cleaning','preparing'].includes(pose.kind)){const index=roleIndex[a.appearance||a.role]*6+pose.frame;assets.draw(c,'purposeResidents',index,a.x+(pose.kind==='cleaning'?Math.sin(a.activity?.phaseTime*4||0)*.8:0),a.y,pose.kind==='eating'?32:34,pose.kind==='eating'?35:42);return true;}if(pose.kind==='reading'||pose.kind==='wave'){assets.draw(c,'lifeResidents',roleIndex[a.appearance||a.role]*4+pose.frame,a.x,a.y,pose.kind==='wave'?30:34,pose.kind==='wave'?42:36);return true;}const index=roleIndex[a.appearance||a.role]*12+directions.indexOf(pose.direction)*3+pose.frame;
 assets.draw(c,'cafeResidents',index,a.x,a.y,30,35);if(pose.frame===1)this.steam(c,a.x+(a.direction==='left'?-7:7),a.y-22,time,a.id*.2);return true;}
 drawFront(c,seat,assets){
 // The chair legs sit in front of bent knees, while its backrest is behind.
 c.save();c.beginPath();c.rect(seat.x-17,seat.y-9,34,10);c.clip();assets.draw(c,seat.atlas,seat.sprite,seat.x,seat.y,seat.width,seat.height);c.restore();
 }
 drawBubbles(ctx,camera){const c=ctx;for(const a of this.activities.actors.filter(a=>a.activity?.bubble).slice(0,2)){
 const p=camera.screenAt(a.x,a.y-49),text=a.activity.bubble;c.save();c.font='12px ui-monospace,monospace';const w=c.measureText(text).width+18;
 c.fillStyle=THEME.panel;c.strokeStyle=a.decorative?THEME.secondary:THEME.lighting.primary;c.lineWidth=1;c.beginPath();c.roundRect(Math.round(p.x-w/2),Math.round(p.y-25),w,25,4);c.fill();c.stroke();c.fillStyle=THEME.text;c.textAlign='center';c.fillText(text,Math.round(p.x),Math.round(p.y-8));c.restore();
 }}
 select(world){if(world.x>=PARK_LOCATION.bounds[0]&&world.x<=PARK_LOCATION.bounds[0]+PARK_LOCATION.bounds[2]&&world.y>=PARK_LOCATION.bounds[1]&&world.y<=PARK_LOCATION.bounds[1]+PARK_LOCATION.bounds[3])return {type:'location',id:PARK_LOCATION.id};if(world.x>=CAFE_LOCATION.bounds[0]&&world.x<=CAFE_LOCATION.bounds[0]+CAFE_LOCATION.bounds[2]&&world.y>=CAFE_LOCATION.bounds[1]&&world.y<=CAFE_LOCATION.bounds[1]+CAFE_LOCATION.bounds[3])return {type:'location',id:CAFE_LOCATION.id};return null;}
 get chairs(){return CAFE_SEATS;}
 get tables(){return CAFE_TABLES;}
}
