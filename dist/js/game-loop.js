// Split long frames into bounded updates. Animation and physics share simulation time.
export class GameLoop{
 constructor(update,render){this.update=update;this.render=render;this.previous=performance.now();this.running=false;this.frame=null;this.onVisibility=()=>{this.previous=performance.now();};document.addEventListener('visibilitychange',this.onVisibility);}
 start(){if(this.running)return;this.running=true;this.previous=performance.now();const tick=now=>{if(!this.running)return;let delta=Math.min((now-this.previous)/1000,1);this.previous=now;while(delta>0){const step=Math.min(delta,1/60);this.update(step);delta-=step;}this.render(now);this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);}
 stop(){this.running=false;cancelAnimationFrame(this.frame);document.removeEventListener('visibilitychange',this.onVisibility);}
}
