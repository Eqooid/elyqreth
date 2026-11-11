import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

// Verification fixtures only. Use production navigation, activity lifecycles,
// animation and renderer; never add hooks to the application or alter its map.
async function setupInBrowser(kind){
 const {Simulation}=await import('/js/simulation.js');
 const {TownRenderer}=await import('/js/renderer.js');
 const {navigate}=await import('/js/movement.js');
 const {center}=await import('/js/world.js');
 const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:640px;height:480px';document.body.append(canvas);
 let seed=29,renderer;
 const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const seeded=fn=>{const prior=Math.random;Math.random=random;try{return fn();}finally{Math.random=prior;}};
 const sim=seeded(()=>new Simulation());
 renderer=seeded(()=>new TownRenderer(canvas,sim,()=>{}));
 const deadline=performance.now()+8000;
 while(!renderer.ready){if(performance.now()>deadline)throw Error('Dynamic renderer asset load timed out');await new Promise(r=>setTimeout(r,20));}
 renderer.observer.disconnect();renderer.dpr=1;canvas.width=640;canvas.height=480;
 // Keep unrelated population out of the controlled route. The functional NPCs
 // remain the existing residents; no collider, tile or movement rule is replaced.
 renderer.citizens.people=[];renderer.citizens.setTarget(0);
 sim.activities.definitions=sim.activities.definitions.map(d=>({...d,chance:0}));
 sim.activities.nextEncounter=Infinity;
 for(const a of sim.agents){a.activityCooldown=1e6;a.idleRemaining=1e6;}
 const actor=sim.agents[0],samples=[],trace=[],states=new Set(),stepsSeen=new Set(),errors=[],readbackDifferences=[];
 let goals=[],leg=0,done=false,lastSample=null,workingAt=null,frameNumber=0,ticks=0;
 const cameras={workplace:[1128,632,2],cafe:[1688,288,1.7],trees:[1624,600,2.5],bridges:[928,580,1.35]};
 const [x,y,zoom]=cameras[kind];Object.assign(renderer.camera,{x,y,zoom});
 if(kind==='workplace')sim.start('Environment acceptance movement');
 else if(kind==='cafe'){
  Object.assign(actor,center({col:96,row:21}));
  sim.activities.actors=sim.agents;
  if(!seeded(()=>sim.activities.tryStart(actor,sim.activities.definitions.find(d=>d.id==='coffee'),true)))throw Error('Coffee fixture did not start');
 }else{
  const origin=kind==='trees'?{col:99,row:36}:{col:49,row:44};
  Object.assign(actor,center(origin));
  goals=kind==='trees'?[{col:103,row:36},{col:103,row:40},{col:99,row:40},origin]:[{col:67,row:44},origin,{col:49,row:28},{col:65,row:28},{col:49,row:28}];
  if(!navigate(sim.map,actor,goals[0],'acceptance-route'))throw Error('No production path for '+kind);
 }
 const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
 const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
 if(!mimeType)throw Error('No supported browser video recorder');
 const chunks=[],recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:750000});
 recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.start();
 function visible(){const p=renderer.camera.screenAt(actor.x,actor.y);return p.x>15&&p.x<625&&p.y>45&&p.y<440;}
 function snapshot(){return {time:+sim.elapsed.toFixed(3),x:+actor.x.toFixed(3),y:+actor.y.toFixed(3),state:actor.state,purpose:actor.walkPurpose,activityStep:actor.activity?.stepId??null,phase:actor.activity?.stepPhase??null,animation:actor.animator.frame,hidden:actor.hidden,leg,walkable:sim.map.canStand(actor.x,actor.y)};}
 function draw(){renderer.draw();const c=renderer.ctx;c.save();c.fillStyle='#101722';c.fillRect(0,452,640,28);c.fillStyle='#ddf3f6';c.font='12px monospace';c.textAlign='left';c.fillText(kind+' | t='+sim.elapsed.toFixed(2)+' | '+actor.state+' | '+(actor.activity?.stepId??actor.walkPurpose??'idle')+' | leg '+leg,8,470);c.restore();}
 function sample(force=false){
  if(!visible())return;
  const s=snapshot(),phase=[s.state,s.activityStep,s.phase,leg].join(':');
  const distance=lastSample?Math.hypot(s.x-lastSample.x,s.y-lastSample.y):Infinity;
  if(!force&&lastSample&&phase===lastSample.phase&&distance<24)return;
  if(samples.length>=64)return;
  draw();draw();const first=renderer.ctx.getImageData(0,0,640,480).data;draw();
  const second=renderer.ctx.getImageData(0,0,640,480).data,p=renderer.camera.screenAt(actor.x,actor.y);
  let changed=0,npcChanged=0,left=640,top=480,right=-1,bottom=-1;
  for(let i=0;i<first.length;i+=4)if(first[i]!==second[i]||first[i+1]!==second[i+1]||first[i+2]!==second[i+2]||first[i+3]!==second[i+3]){
   const px=i/4%640,py=Math.floor(i/4/640);changed++;left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py);
   // Compare the moving sprite, shadow and immediate occlusion boundary exactly.
   // Separately report differences elsewhere, including animated-water readback.
   if(px>=p.x-20*zoom&&px<=p.x+20*zoom&&py>=p.y-44*zoom&&py<=p.y+5*zoom)npcChanged++;
  }
  if(changed)readbackDifferences.push({time:s.time,changed,npcChanged,bounds:[left,top,right,bottom]});
  if(npcChanged)errors.push('Unstable unchanged NPC region at '+s.time+' ('+npcChanged+' pixels)');
  const copy=document.createElement('canvas');copy.width=640;copy.height=480;copy.getContext('2d').drawImage(canvas,0,0);
  samples.push({canvas:copy,...s});lastSample={...s,phase};
 }
 sample(true);draw();track.requestFrame();
 globalThis.__environmentDynamic={
  async advance(){
   // Each rendered video frame covers five production 1/30-second updates.
   // The recorder is accelerated; simulation timestamps are burned into frames.
   for(let frame=0;frame<20&&!done;frame++){
    for(let i=0;i<5&&!done;i++){
     const before={x:actor.x,y:actor.y};
     seeded(()=>sim.update(1/30));ticks++;
     renderer.environment.clock=sim.clock;renderer.environment.update(1/30);renderer.water.update(1/30);renderer.train.update(1/30);renderer.citizens.service(1/30);
     if(Math.hypot(actor.x-before.x,actor.y-before.y)>actor.speed/30+.001)errors.push('Discontinuous movement at '+sim.elapsed);
     if(!actor.hidden&&!sim.map.canStand(actor.x,actor.y))errors.push('Feet outside walkability at '+sim.elapsed);
     if(actor.state==='ERROR')errors.push('NPC entered ERROR');
     states.add(actor.state);if(actor.activity?.stepId)stepsSeen.add(actor.activity.stepId);
     if(kind==='workplace'){
      if(sim.phase==='working'&&sim.currentAgent===actor&&workingAt===null)workingAt=sim.elapsed;
      done=sim.stage>0;
     }else if(kind==='cafe')done=!actor.activity;
     else if(!actor.path.length){leg++;if(leg===goals.length)done=true;else if(!navigate(sim.map,actor,goals[leg],'acceptance-route')){errors.push('Unreachable route leg '+leg);done=true;}}
     if(sim.elapsed>250){errors.push('Scenario timed out');done=true;}
    }
    frameNumber++;
    if(visible()){
     sample(done);draw();track.requestFrame();
     // Yield to Chromium video encoding and the running development page.
     await new Promise(r=>setTimeout(r,25));
    }
    trace.push(snapshot());
   }
   return {done,time:sim.elapsed,frames:frameNumber,samples:samples.length};
  },
  async finish(){
   sample(true);draw();track.requestFrame();await new Promise(r=>setTimeout(r,80));
   await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream.getTracks().forEach(t=>t.stop());
   const toBase64=blob=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
   const sheets=[];
   for(let offset=0;offset<samples.length;offset+=12){
    const part=samples.slice(offset,offset+12),sheet=document.createElement('canvas');sheet.width=1280;sheet.height=Math.ceil(part.length/4)*240;
    const c=sheet.getContext('2d');c.imageSmoothingEnabled=false;
    part.forEach((s,i)=>c.drawImage(s.canvas,i%4*320,Math.floor(i/4)*240,320,240));sheets.push(sheet.toDataURL().split(',')[1]);
   }
   const result={kind,done,camera:{x,y,zoom},viewport:{width:640,height:480,dpr:1},seed:29,ticks,videoFrames:frameNumber,seconds:sim.elapsed,states:[...states],activitySteps:[...stepsSeen],workingAt,completedLegs:leg,goals,stats:sim.activities.stats,reservations:[...sim.activities.reservations.reservations.values()].filter(r=>r.ownerId===actor.id),errors,readbackDifferences,samples:samples.map(({canvas,...s})=>s),trace,mimeType,video:await toBase64(new Blob(chunks,{type:mimeType})),sheets};
   renderer.observer.disconnect();canvas.remove();delete globalThis.__environmentDynamic;return result;
  }
 };
 return {kind,camera:{x,y,zoom},mimeType};
}

export async function verifyDynamicEnvironment({evaluate}){
 const directory=resolve(process.env.ENVIRONMENT_DYNAMIC_DIR);
 // Evidence is append-only by run directory, keeping accepted baselines intact.
 assert.equal(existsSync(directory),false,'Choose a new ENVIRONMENT_DYNAMIC_DIR; evidence is never overwritten');
 mkdirSync(directory,{recursive:true});
 const reports=[];
 for(const kind of ['workplace','cafe','trees','bridges']){
  await evaluate('('+setupInBrowser.toString()+')('+JSON.stringify(kind)+')');
  let progress;
  do{progress=await evaluate('globalThis.__environmentDynamic.advance()');}while(!progress.done);
  const {video,sheets,...report}=await evaluate('globalThis.__environmentDynamic.finish()');
  writeFileSync(join(directory,kind+'.webm'),Buffer.from(video,'base64'));
  sheets.forEach((png,i)=>writeFileSync(join(directory,kind+'-'+String(i+1).padStart(2,'0')+'.png'),Buffer.from(png,'base64')));
  reports.push(report);writeFileSync(join(directory,kind+'.json'),JSON.stringify(report,null,2)+'\n');
  assert.deepEqual(report.errors,[],kind+' movement/frame errors');assert.equal(report.done,true);assert.ok(report.samples.length>=3,kind+' needs a movement sequence');
  assert.ok(new Set(report.trace.map(p=>p.x+','+p.y)).size>20,kind+' did not move');
  if(kind==='workplace'){assert.ok(report.workingAt!==null);for(const state of ['WALKING_TO_WORK','WORKING'])assert.ok(report.states.includes(state));}
  if(kind==='cafe'){for(const step of ['queue','order','prepare','receive','drink','leave-coffee'])assert.ok(report.activitySteps.includes(step));assert.equal(report.stats.byActivity.coffee.completed,1);assert.equal(report.reservations.length,0);}
  if(kind==='trees'||kind==='bridges')assert.equal(report.completedLegs,report.goals.length);
 }
 writeFileSync(join(directory,'summary.json'),JSON.stringify({browserChecks:'PASS',visualReview:'PENDING',reports:reports.map(({trace,samples,...r})=>({...r,samples:samples.length}))},null,2)+'\n');
 return 'Four dynamic environment sequences recorded using production movement; path continuity, walkability, activities and exact unchanged-NPC-region checks passed; manual visual review required';
}
