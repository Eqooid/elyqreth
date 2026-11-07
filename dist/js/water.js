import {THEME} from './theme.js';
import {TILE,WATER_AREAS} from './world.js';
import {TERRAIN} from './tile-map.js';

const SIZE=64,FRAMES=24,PERIOD=3.2;
export const WATER_FLOWS=WATER_AREAS.map((tiles,i)=>({id:`water-${i}`,tiles,direction:i===2?'left':'down',phase:i*.71}));

// A generated pixel tile sheet, not a translated background. Each frame repeats
// spatially and the final frame joins the first at the same surface phase.
export class WaterSystem{
 constructor(){this.time=0;this.frame=0;this.flows=WATER_FLOWS;this.sheet=null;}
 update(dt){this.time+=dt;this.frame=Math.floor((this.time%PERIOD)/PERIOD*FRAMES+1e-9)%FRAMES;}
 initialize(map){
 this.mask=new Path2D();
 for(let row=0;row<map.rows;row++)for(let col=0;col<map.columns;col++)if(map.tiles[map.index(col,row)]===TERRAIN.WATER)this.mask.rect(col*TILE,row*TILE,TILE,TILE);
 this.sheet=document.createElement('canvas');this.sheet.width=SIZE*FRAMES;this.sheet.height=SIZE;
 const c=this.sheet.getContext('2d');c.imageSmoothingEnabled=false;
 for(let f=0;f<FRAMES;f++){
 const ox=f*SIZE;c.save();c.beginPath();c.rect(ox,0,SIZE,SIZE);c.clip();
 c.fillStyle=THEME.water.base;c.fillRect(ox,0,SIZE,SIZE);
 for(let i=0;i<30;i++){
 const x=(i*23+i%3*7)%SIZE,y=((i*17+f*SIZE/FRAMES)%SIZE),w=4+i%5*2;
 c.fillStyle=THEME.water.bands[i%4];
 for(const wrap of [-SIZE,0,SIZE])c.fillRect(ox+x,Math.floor(y)+wrap,w,2);
 // Tiny broken wavelets change shape as they advance, rather than sliding a photograph.
 c.fillStyle=THEME.water.crest;c.globalAlpha=.22+.2*Math.sin(f/FRAMES*Math.PI*2+i)**2;
 c.fillRect(ox+x+2,Math.floor(y)-2,Math.max(2,w-4),1);c.globalAlpha=1;
 }c.restore();
 }
 }
 draw(c){if(!this.sheet)return;c.save();c.clip(this.mask);
 for(const flow of this.flows){const [col,row,w,h]=flow.tiles,x=col*TILE,y=row*TILE;
 c.save();c.beginPath();c.rect(x,y,w*TILE,h*TILE);c.clip();
 const frame=(this.frame+Math.floor(flow.phase*FRAMES))%FRAMES;
 // The entire visible water surface is animated; no static painted grain leaks through.
 c.globalAlpha=1;
 for(let yy=y;yy<y+h*TILE;yy+=SIZE)for(let xx=x;xx<x+w*TILE;xx+=SIZE){
 if(flow.direction==='left'){c.save();c.translate(xx,yy+SIZE);c.rotate(-Math.PI/2);c.drawImage(this.sheet,frame*SIZE,0,SIZE,SIZE,0,0,SIZE,SIZE);c.restore();}
 else c.drawImage(this.sheet,frame*SIZE,0,SIZE,SIZE,xx,yy,SIZE,SIZE);
 }c.globalAlpha=1;
 // Separate reflected lights break into moving white-lit strips. Brightness and width
 // breathe at different rates, all clipped to the actual water cells.
 for(let n=0;n<3;n++){const rx=x+(n+1)*w*TILE/4;
 for(let j=0;j<Math.ceil(h*TILE/9);j++){
 const py=y+(j*9+this.time*11)%(h*TILE),s=Math.sin(j*1.8+this.time*2.4+flow.phase+n);
 const width=5+(1+s)*11; c.globalAlpha=.45+.3*(1+Math.sin(j+this.time*1.6+n))/2;
 const px=Math.round(rx-width/2+Math.sin(this.time+j)*4);
 c.fillStyle=THEME.water.reflections[(j+n*2)%THEME.water.reflections.length];c.fillRect(px,Math.round(py),Math.round(width),2);
 if(j%3===0){c.globalAlpha=.85;c.fillStyle=THEME.secondary;c.fillRect(px+Math.floor(width/3),Math.round(py),Math.max(2,Math.floor(width/3)),1);}
 }}c.globalAlpha=1;
 // Short edge wavelets travel downstream alongside the basin walls and piers.
 c.fillStyle=THEME.water.crest+'70';for(let j=0;j<8;j++){const py=y+(j*31+this.time*17)%(h*TILE);c.fillRect(x+4,Math.floor(py),7,1);c.fillRect(x+w*TILE-11,Math.floor(py+9),6,1);}
 // Expanding broken rings at bridge piers are clipped to the real canal mask.
 for(const px of [x+16,x+w*TILE-24]){const u=(this.time*.35+flow.phase)%1,r=3+u*13;c.globalAlpha=(1-u)*.34;c.strokeStyle=THEME.water.ripple;c.lineWidth=1;c.beginPath();c.ellipse(Math.round(px),y+8,Math.round(r),Math.max(1,Math.round(r*.35)),0,.2,2.8);c.stroke();}c.globalAlpha=1;
 c.restore();}c.restore();
 }
}
