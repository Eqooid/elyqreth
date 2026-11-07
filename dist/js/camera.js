import {WORLD} from './world.js';
export class Camera{
 constructor(width,height){this.resize(width,height);this.x=WORLD.width/2;this.y=WORLD.height/2;
 // Open at street scale, like the reference. Fit remains a separate whole-city overview.
 this.zoom=width<650?.85:Math.min(width/WORLD.width,height/WORLD.height);}
 resize(width,height){this.width=width;this.height=height;this.minZoom=Math.min(width/WORLD.width,height/WORLD.height)*.75;}
 fit(){this.x=WORLD.width/2;this.y=WORLD.height/2;this.zoom=Math.min(this.width/WORLD.width,this.height/WORLD.height);}
 worldAt(x,y){return{x:(x-this.width/2)/this.zoom+this.x,y:(y-this.height/2)/this.zoom+this.y};}
 screenAt(x,y){return{x:(x-this.x)*this.zoom+this.width/2,y:(y-this.y)*this.zoom+this.height/2};}
 zoomAt(factor,x=this.width/2,y=this.height/2){const before=this.worldAt(x,y);this.zoom=Math.max(this.minZoom,Math.min(3,this.zoom*factor));const after=this.worldAt(x,y);this.x+=before.x-after.x;this.y+=before.y-after.y;this.clamp();}
 pan(dx,dy){this.x+=dx/this.zoom;this.y+=dy/this.zoom;this.clamp();}
 clamp(){this.x=Math.max(-64,Math.min(WORLD.width+64,this.x));this.y=Math.max(-64,Math.min(WORLD.height+64,this.y));}
 apply(ctx){const dpr=ctx.getTransform().a||1;ctx.translate(Math.round((this.width/2-this.x*this.zoom)*dpr)/dpr,Math.round((this.height/2-this.y*this.zoom)*dpr)/dpr);ctx.scale(this.zoom,this.zoom);}
}
