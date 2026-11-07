import {THEME} from './theme.js';
import {WORLD} from './world.js';
// The station's rail deck is horizontal in the reference. The train always stays
// on that deck; building silhouettes and front railings provide sprite occlusion.
export const RAIL_ROUTE={id:'central-station-line',start:530,stop:958,end:WORLD.width+184,y:896,width:226,height:74,depth:879,speed:125};
export class TrainSystem{
 constructor(random=Math.random){this.random=random;this.route=RAIL_ROUTE;this.x=this.route.start;this.y=this.route.y;this.time=0;this.state='approaching';this.remaining=0;this.travelTime=0;this.speed=0;this.arrivals=0;this.departures=0;}
 update(dt){this.time+=dt;let remaining=dt;
 // Consume transitions within a large update without skipping the station stop.
 while(remaining>0){
 if(this.state==='waiting'||this.state==='stopped'){
 const step=Math.min(remaining,this.remaining);this.remaining-=step;remaining-=step;
 if(this.remaining>1e-8)break;
 this.travelTime=0;
 if(this.state==='stopped'){this.state='departing';this.departures++;}else{this.state='approaching';this.x=this.route.start;}
 }else{
 const approaching=this.state==='approaching',start=approaching?this.route.start:this.route.stop,target=approaching?this.route.stop:this.route.end;
 // Analytic easing keeps velocity continuous and large/split updates equivalent.
 const duration=(target-start)*1.5/this.route.speed,step=Math.min(remaining,duration-this.travelTime);
 this.travelTime+=step;remaining-=step;const u=Math.min(1,this.travelTime/duration);
 this.x=start+(target-start)*(u*u*(3-2*u));this.speed=(target-start)/duration*6*u*(1-u);
 if(u<1)break;
 if(this.state==='approaching'){this.state='stopped';this.remaining=5+this.random()*3;this.arrivals++;}
 else{this.state='waiting';this.remaining=12+this.random()*13;}
 }
 }
 }
 get visible(){return this.state!=='waiting';}
 get label(){return {approaching:'Train arriving',stopped:'Train at Central Station',departing:'Train departing',waiting:'Next train soon'}[this.state];}
 drawTracks(c){
 // An unlit bay behind the independently drawn station frame.
 c.fillStyle='#101b26';c.fillRect(793,834,304,65);
 c.fillStyle='#111821';c.fillRect(784,887,WORLD.width-784,30);
 for(let x=784;x<WORLD.width;x+=16){c.fillStyle='#55535a';c.fillRect(x,890,4,24);c.fillStyle='#242b35';c.fillRect(x+1,892,2,20);}
 for(const y of [892,912]){c.fillStyle='#7f858c';c.fillRect(784,y,WORLD.width-784,2);c.fillStyle=THEME.neon+'65';c.fillRect(784,y+2,WORLD.width-784,1);}
 }
 draw(c,assets){if(!this.visible)return;
 c.save();c.beginPath();c.rect(784,this.y-this.route.height,WORLD.width-784,this.route.height);c.clip();
 assets.draw(c,'rail',1,this.x,this.y,this.route.width,this.route.height,'bottom','stretch');
 c.globalAlpha=.55+.15*Math.sin(this.time*4);c.fillStyle=THEME.lighting.primary;c.fillRect(Math.round(this.x+this.route.width*.42),this.y-30,5,2);c.restore();
 }
 drawIndicator(c){c.fillStyle=this.state==='stopped'?THEME.success:THEME.neon;c.globalAlpha=.55+.3*Math.sin(this.time*3+.6);c.fillRect(1027,786,13,3);c.globalAlpha=1;}
}
