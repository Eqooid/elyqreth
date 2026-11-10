import {themeAtlas,THEME} from './theme.js';
import {LIFE_FRAMES} from './life-frames.js';
import {PURPOSE_FRAMES} from './purpose-frames.js';
import {CAFE_FRAMES} from './cafe-frames.js';
import {BLUEPRINT_FRAMES} from './blueprint-frames.js';
// Atlases are transparent sprites, never whole-scene illustrations.
export class AssetManager{
 constructor(){this.images={};this.frames={};this.terrainPatterns=new Map();}
 async load(){
 await Promise.all([['purposeResidents','assets/purpose-residents-v2.png',6,4],['lifeResidents','assets/life-residents.png',4,4],['cafe','assets/cafe-props.png',3,3],['cafeResidents','assets/cafe-residents.png',12,4],['vehicles','assets/vehicles.png',4,3],['buildings','assets/blueprint-landmarks.png',3,2],['rail','assets/central-station-train.png',2,1],['characters','assets/characters.png',8,8],['terrain','assets/terrain-props.png',4,4],['scenery','assets/decorative-buildings.png',4,2,[0,540,1024]],['street','assets/street-objects.png',4,2],['architecture','assets/urban-architecture.png',3,2],['blueprintScenery','assets/blueprint-scenery.png',4,2],['blueprintProps','assets/blueprint-props.png',3,2]].map(async([name,url,columns,rows,rowEdges])=>{
 const image=await this.loadImage(url);
 // Explicit inspected rectangles preserve complete silhouettes when generated gutters
 // cross a nominal cell boundary. Each building remains an individually drawn sprite.
 const regions=name==='architecture'?[[77,14,485,531],[590,15,948,531],[1078,26,1484,531],[51,555,537,997],[584,538,1020,995],[1080,538,1485,997]]:null;
 const vehicleRegions=[[68,138,309,171],[463,138,308,171],[873,73,196,251],[1172,81,178,242],[52,452,337,218],[449,452,337,218],[867,381,210,313],[1172,393,179,284],[47,800,341,185],[450,800,340,185],[872,747,201,266],[1172,751,180,253]];
 this.frames[name]=(name==='purposeResidents'?PURPOSE_FRAMES:null)||(name==='lifeResidents'?LIFE_FRAMES:null)||CAFE_FRAMES[name]||(name==='vehicles'?vehicleRegions.map(([sx,sy,sw,sh])=>({sx,sy,sw,sh})):name==='rail'?[{sx:21,sy:196,sw:893,sh:600},{sx:974,sy:511,sw:527,sh:172}]:BLUEPRINT_FRAMES[name]|| (regions?regions.map(([sx,sy,right,bottom])=>({sx,sy,sw:right-sx,sh:bottom-sy})):this.inspectCells(image,columns,rows,name==='terrain',rowEdges)));
 this.images[name]=themeAtlas(image,name,this.frames[name]);
 }));return this;
 }
 loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error(`Could not load ${url}`));image.src=url;});}
 inspectCells(image,columns,rows,terrain,rowEdges){
 const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;
 const cw=image.width/columns,ch=image.height/rows,frames=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
 const sx=Math.round(col*cw),sy=rowEdges?.[row]??Math.round(row*ch),ex=Math.round((col+1)*cw),ey=rowEdges?.[row+1]??Math.round((row+1)*ch);
 if(terrain&&row<2){frames.push({sx:sx+4,sy:sy+4,sw:ex-sx-8,sh:ey-sy-8});continue;}
 let left=ex,right=sx,top=ey,bottom=sy;
 for(let y=sy;y<ey;y++)for(let x=sx;x<ex;x++)if(pixels[(y*image.width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 frames.push(right>=left?{sx:left,sy:top,sw:right-left+1,sh:bottom-top+1}:{sx,sy,sw:cw,sh:ch});
 }
 // Character frames share a common crop box, preserving each pose's movement.
 if(columns===8){for(let role=0;role<4;role++){const group=frames.slice(role*16,role*16+16);const sw=Math.max(...group.map(f=>f.sw)),sh=Math.max(...group.map(f=>f.sh));for(let i=0;i<16;i++){const index=role*16+i,col=index%8,row=Math.floor(index/8),frame=frames[index];const base=frame.sy+frame.sh;frames[index]={sx:col*cw+(cw-sw)/2,sy:base-sh,sw,sh};}}}
 return frames;
 }
 frame(atlas,index){return this.frames[atlas][index];}
 draw(ctx,atlas,index,x,y,width,height,anchor='bottom',fit='contain'){
 const image=this.images[atlas],f=this.frame(atlas,index);const scale=Math.min(width/(f.baseWidth||f.sw),height/(f.baseHeight||f.sh)),w=Math.round(fit==='stretch'?width:f.sw*scale),h=Math.round(fit==='stretch'?height:f.sh*scale);
 if(f.flipX){ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(-1,1);ctx.drawImage(image,f.sx,f.sy,f.sw,f.sh,Math.round(-w/2),anchor==='bottom'?-h:0,w,h);ctx.restore();}
 else ctx.drawImage(image,f.sx,f.sy,f.sw,f.sh,Math.round(x-w/2),Math.round(anchor==='bottom'?y-h:y),w,h);
 return {x:Math.round(x-w/2),y:Math.round(anchor==='bottom'?y-h:y),width:w,height:h};
 }
 terrainPattern(index){
 if(this.terrainPatterns.has(index))return this.terrainPatterns.get(index);
 const f=this.frame('terrain',index),layer=document.createElement('canvas');layer.width=256;layer.height=256;
 const c=layer.getContext('2d');c.imageSmoothingEnabled=false;c.fillStyle=THEME.slate;c.fillRect(0,0,256,256);
 // The source swatches are illustrations, not seamless textures. Reflect their
 // edges in a cached 2x2 repeat instead of restarting unrelated edge pixels.
 c.drawImage(this.images.terrain,f.sx,f.sy,index===0?f.sw*.34:f.sw,f.sh,0,0,128,128);
 c.save();c.translate(256,0);c.scale(-1,1);c.drawImage(layer,0,0,128,128,0,0,128,128);c.restore();
 c.save();c.translate(0,256);c.scale(1,-1);c.drawImage(layer,0,0,256,128,0,0,256,128);c.restore();
 this.terrainPatterns.set(index,layer);return layer;
 }
 tile(ctx,index,x,y,size){
 // Integer, one-to-one samples keep adjacent grid cells continuous. Patterns
 // are prepared only while building the cached terrain, never per animation frame.
 const pattern=this.terrainPattern(index);
 ctx.drawImage(pattern,((x%256)+256)%256,((y%256)+256)%256,size,size,x,y,size,size);
 }

}
