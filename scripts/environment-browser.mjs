import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Isolated real renderer, fixed simulation seed, camera and animation time.
// No application exports, production debug hooks or backend fixtures required.
export async function verifyEnvironment({evaluate}){
 const frames=await evaluate(`(async()=>{
  const {TownRenderer}=await import('/js/renderer.js'),{Simulation}=await import('/js/simulation.js');
  const canvas=document.createElement('canvas');canvas.style.cssText='width:960px;height:640px;position:fixed;left:0;top:0';document.body.append(canvas);
  const random=Math.random;let seed=141,renderer;
  try{
   Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
   const sim=new Simulation();renderer=new TownRenderer(canvas,sim,()=>{});
   while(!renderer.ready)await new Promise(r=>setTimeout(r,20));
   renderer.observer.disconnect();renderer.dpr=1;canvas.width=960;canvas.height=640;
   const scenarios=[['intersection',768,384,2],['building-block',400,210,1.2],['cafe',1696,280,1.5],['park',480,670,1.5],['transitions',928,460,1.5],['boundary',1760,900,1.2],['npc-entrance',440,568,2],['sidewalk',1664,568,2]];
   const frames=[];
   for(const [id,x,y,zoom]of scenarios){
    if(id==='npc-entrance'){const a=sim.agents[0];a.x=440;a.y=568;a.hidden=false;}
    Object.assign(renderer.camera,{x,y,zoom});
    // Warm browser sprite raster caches at this scale before exact comparison.
    renderer.draw();renderer.draw();
    const first=canvas.toDataURL();renderer.draw();
    frames.push({id,x,y,zoom,stable:first===canvas.toDataURL(),png:first.split(',')[1]});
   }
   return frames;
  }finally{Math.random=random;renderer?.observer.disconnect();canvas.remove();}
 })()`);
 if(process.env.ENVIRONMENT_SCREENSHOTS){
  const directory=resolve(process.env.ENVIRONMENT_SCREENSHOTS);mkdirSync(directory,{recursive:true});
  for(const frame of frames)writeFileSync(join(directory,frame.id+'.png'),Buffer.from(frame.png,'base64'));
  writeFileSync(join(directory,'scenarios.json'),JSON.stringify(frames.map(({png,...frame})=>frame),null,2)+'\n');
 }
 for(const frame of frames)assert.equal(frame.stable,true,frame.id+' changed without a simulation update');
 return 'Eight fixed-seed environment cameras render identical consecutive frames (960x640, DPR 1, time 0)';
}
