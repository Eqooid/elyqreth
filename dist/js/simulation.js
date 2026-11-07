import {ROLES,COLORS,DEFAULT_WORKPLACES,building,center,makePlan} from './world.js';
import {TileMap} from './tile-map.js';
import {ActivityController} from './activities.js';
import {STATE,setState} from './agent-state.js';
import {initializeMovement,navigate,updateAgent,finishWander} from './movement.js';
import {validNpcId} from './npc-identity.js';
export class Simulation {
 #residentListeners=new Set();
 // Collection changes only; movement, animation, needs and mission updates do not publish here.
 getResidents(){return this.agents;}
 subscribeResidents(listener){this.#residentListeners.add(listener);try{listener();}catch{/* Observer isolation. */}return ()=>this.#residentListeners.delete(listener);}
 #residentsChanged(){for(const listener of [...this.#residentListeners]){try{listener();}catch{/* Observer isolation. */}}}
 constructor(onChange=()=>{}){this.onChange=onChange;this.map=new TileMap();this.activities=new ActivityController(this.map);this.clock=this.activities.clock;this.agents=[];this.nextId=1;this.elapsed=0;this.speed=1;this.paused=false;this.logs=[];this.packets=[];this.task=null;this.stage=0;this.phase='idle';this.steps=makePlan('Build a landing page');
 for(const [name,role,npcId] of [['Ada','Researcher','resident-slot-001'],['Mika','Designer','resident-slot-002'],['Atlas','Developer','resident-slot-003'],['Finn','Tester','resident-slot-004']])this.addAgent(name,role,DEFAULT_WORKPLACES[role],false,undefined,role,npcId);
 this.log('City Hall is ready. Four residents are waiting for a mission.');}
 notify(){this.onChange(this);}
 log(message){this.logs.unshift({time:this.elapsed,message});this.logs=this.logs.slice(0,100);this.notify();}
 addAgent(name,role,workplace,announce=true,personality,appearance=role,npcId=null){
 if(npcId!==null&&(!validNpcId(npcId)||this.agents.some(a=>a.npcId===npcId)))return null;
 if(!name.trim()||!ROLES.includes(role)||!building(workplace)||workplace==='hall')return null;
 const p=this.map.spawnNear(building(workplace),this.agents);
 const a={id:this.nextId++,name:name.trim().slice(0,24),role,appearance:ROLES.includes(appearance)?appearance:role,workplace,color:COLORS[role],x:p.x,y:p.y,progress:0,workTime:0};
 Object.defineProperty(a,'npcId',{value:npcId,enumerable:true,writable:false,configurable:false});
 initializeMovement(a);this.activities.initialize(a,personality);this.agents.push(a);
 this.#residentsChanged();
 if(announce)this.log(`${a.name} joined the town as a ${role}.`);
 if(this.phase==='blocked')this.assignNext();this.notify();return a;
 }
 removeAgent(id){const a=this.agents.find(a=>a.id===id);if(!a)return;const active=this.currentAgent?.id===id;this.activities.cancel(a,'removed');this.agents=this.agents.filter(a=>a.id!==id);this.#residentsChanged();this.log(`${a.name} left the town.`);if(active){this.steps[this.stage].status='pending';this.steps[this.stage].progress=0;this.currentAgent=null;this.phase='blocked';this.assignNext();}this.notify();}
 start(task){
 if(!task.trim()||this.running)return false;
 this.task=task.trim().slice(0,140);this.steps=makePlan(this.task);this.stage=0;this.currentAgent=null;this.packets=[];this.paused=false;
 this.phase='planning';this.planningTime=.8;
 this.log(`City Hall received “${this.task}” and planned four dependent stages.`);this.notify();return true;
 }
 get running(){return this.task!==null&&this.phase!=='complete'&&this.phase!=='idle';}
 reset(announce=true){
 this.task=null;this.phase='idle';this.paused=false;this.steps=makePlan('Build a landing page');this.stage=0;this.currentAgent=null;this.packets=[];
 for(const a of [...this.agents,...(this.map.citizens?.allPeople||[])]){if(a.activity)this.activities.cancel(a,'reset');a.progress=0;a.workTime=0;a.workStatus='Idle';if(a.walkPurpose!=='wander'){a.path=[];a.walkPurpose=null;setState(a,STATE.IDLE);a.idleRemaining=.4+Math.random()*1.5;} }
 if(announce)this.log('Mission reset. Residents keep exploring the town.');this.notify();
 }
 walk(a,destination,purpose){
 const b=building(destination),target=purpose==='work'?b.workCell:b.doorCell;
 const moving=navigate(this.map,a,target,purpose);
 if(!moving){const p=center(target);if(Math.hypot(a.x-p.x,a.y-p.y)<1)this.arrived(a);
 else{a.workStatus='Error';setState(a,STATE.ERROR);this.phase='error';this.steps[this.stage].status='error';this.log(`City Hall could not find a safe route for ${a.name}. Retry this step.`);}}
 }
 assignNext(){if(this.stage>=this.steps.length){this.phase='complete';this.log(`City Hall marked “${this.task}” complete. All four handoffs delivered.`);return;}
 const step=this.steps[this.stage];const a=this.agents.find(a=>a.role===step.role&&a.status!=='Error');if(!a){const changed=this.phase!=='blocked';this.phase='blocked';step.status='waiting';if(changed)this.log(`City Hall is waiting for a ${step.role}. Add one to continue.`);this.notify();return;}
 this.activities.cancel(a);a.workStatus='Assigned';this.currentAgent=a;step.agentId=a.id;step.status='active';step.progress=0;a.progress=0;a.workTime=0;this.phase='collecting';this.walk(a,'hall','collect');this.log(`City Hall assigned ${step.title.toLowerCase()} to ${a.name}. ${this.stage?'Collecting the previous handoff.':'Collecting the task brief.'}`);}
 fail(id){if(!this.running||this.currentAgent?.id!==id||this.phase==='error')return;const a=this.currentAgent;a.workStatus='Error';setState(a,STATE.ERROR);a.path=[];a.walkPurpose=null;this.phase='error';this.steps[this.stage].status='error';this.log(`${a.name} hit a simulated error. City Hall kept completed stages; retry this step.`);}
 retry(){if(this.phase!=='error')return;const a=this.currentAgent;setState(a,STATE.WAITING);this.steps[this.stage].status='pending';this.log(`City Hall is retrying ${a.name}’s stage.`);this.assignNext();}
 update(realDelta){if(this.paused)return;const dt=Math.min(realDelta,0.1)*this.speed;this.elapsed+=dt;this.clock.update(dt);
 const residents=[...this.agents,...(this.map.citizens?.allPeople||[])];this.activities.beginFrame(dt,residents);
 for(const a of this.agents){if(a!==this.currentAgent)this.activities.update(a,dt);updateAgent(this.map,a,residents,dt,resident=>this.arrived(resident));}
 if(this.phase==='planning'){this.planningTime-=dt;if(this.planningTime<=0)this.assignNext();}
 if(this.phase==='working'&&this.currentAgent){const a=this.currentAgent,step=this.steps[this.stage];a.workTime+=dt;a.progress=Math.min(1,a.workTime/step.seconds);step.progress=a.progress;if(a.progress>=1){this.phase='delivering';this.walk(a,'hall','deliver');this.log(`${a.name} finished ${step.title.toLowerCase()}: ${step.deliverable}. Returning the handoff to City Hall.`);}}
 for(const p of this.packets)p.life-=dt;this.packets=this.packets.filter(p=>p.life>0);
 }
 arrived(a){if(a.walkPurpose==='activity'){this.activities.arrived(a);return;}if(a.walkPurpose==='wander'){finishWander(a);return;}if(a!==this.currentAgent)return;
 if(a.walkPurpose==='collect'){this.packets.push({x:a.x,y:a.y,color:a.color,life:2});this.phase='travelling';this.walk(a,a.workplace,'work');this.log(`${a.name} received the brief at City Hall and is heading to ${building(a.workplace).name}.`);}
 else if(a.walkPurpose==='work'){setState(a,STATE.WORKING);a.direction='up';a.walkPurpose=null;this.phase='working';this.log(`${a.name} started ${this.steps[this.stage].title.toLowerCase()} at ${building(a.workplace).name}.`);}
 else if(a.walkPurpose==='deliver'){a.workStatus='Idle';setState(a,STATE.COMPLETED);a.completedRemaining=1.1;a.walkPurpose=null;this.steps[this.stage].status='done';this.steps[this.stage].progress=1;this.packets.push({x:a.x,y:a.y,color:a.color,life:2});this.log(`${a.name} delivered the ${this.steps[this.stage].title.toLowerCase()} handoff to City Hall.`);this.stage++;this.currentAgent=null;this.assignNext();}this.notify();}
 get progress(){const completed=this.steps.filter(s=>s.status==='done').length;return (completed+(this.steps[this.stage]?.progress||0))/4;}
}
