import {createAccessPanel} from './access-panel.js';
import {applyUiTheme,visualRoleColor,visualAccent} from './theme.js';
applyUiTheme();
import {Simulation} from './simulation.js';
import {TownRenderer} from './renderer.js';
import {GameLoop} from './game-loop.js';
import {runtimeIntegration} from './runtime/index.js';
import {createNpcRuntimeBindings} from './runtime/npc-runtime-binding.js';
import {createNpcStatusPresentation} from './runtime/npc-status.js';
import {runtimeInspectorHtml,replaceInspectorContent} from './runtime/npc-runtime-inspector.js';
import {NpcInspectionSelection} from './runtime/inspection-model.js';
import {createCollaborationPanel} from './collaboration-panel.js';
import {createAgentTaskPanel} from './agent-task-panel.js';
import {CAFE_LOCATION,CAFE_TABLES,PARK_LOCATION,LOCATIONS,HOME_LOCATIONS,PARK_BENCHES} from './locations.js';
import {BUILDINGS,ROLES,DEFAULT_WORKPLACES,building,COLORS,WORLD} from './world.js';
const $=id=>document.getElementById(id);
const sim=new Simulation();let selection=null,lastUi=0;
const npcRuntimeBindingOwner=createNpcRuntimeBindings(runtimeIntegration.view,sim);
export const npcRuntimeBindingView=npcRuntimeBindingOwner.view;
const npcStatusPresentation=createNpcStatusPresentation(npcRuntimeBindingView);
const runtimeInspectionSelection=new NpcInspectionSelection();
const agentTaskPanel=createAgentTaskPanel({host:$('inspector'),refresh:()=>runtimeIntegration.refresh()});
const collaborationPanel=createCollaborationPanel({host:$('inspector'),readReference:(ref,signal)=>agentTaskPanel.readReference(ref,signal)});
const syncTaskSelection=()=>{const binding=selection?.type==='agent'?npcRuntimeBindingView.getForEntity(sim.agents.find(a=>a.id===selection.id)??{}):undefined,runtime=npcRuntimeBindingView.getSnapshot().runtime;agentTaskPanel.select(binding,runtime);collaborationPanel.select(binding,runtime);};
const offTaskBinding=npcRuntimeBindingView.subscribe(syncTaskSelection);
const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
// Nonvisual lifecycle boundary only; trusted callers must explicitly connect.
const disconnectRuntime=()=>{agentTaskPanel.suspend();collaborationPanel.disconnect();runtimeIntegration.disconnect();runtimeInspectionSelection.clear();renderInspector();};
globalThis.addEventListener('pagehide',disconnectRuntime);
if(import.meta.hot)import.meta.hot.dispose(()=>{globalThis.removeEventListener('pagehide',disconnectRuntime);offTaskBinding();agentTaskPanel.dispose();collaborationPanel.dispose();runtimeInspectionSelection.clear();npcStatusPresentation.dispose();npcRuntimeBindingOwner.dispose();runtimeIntegration.disconnect();});
const renderer=new TownRenderer($('scene'),sim,select,npcStatusPresentation,()=>reducedMotion?.matches??false);
const accessPanel=createAccessPanel({runtime:runtimeIntegration,taskPanel:agentTaskPanel,collaborationPanel,clearSelection:()=>{runtimeInspectionSelection.clear();renderInspector();}});
if(import.meta.hot)import.meta.hot.dispose(()=>{void accessPanel.then(panel=>panel.dispose());});
// Escaping is kept in one place; user-entered task and agent names are plain text.
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function select(s){runtimeInspectionSelection.clear();selection=s;syncTaskSelection();renderer.selected=s;if(s?.type==='agent'){const a=sim.agents.find(a=>a.id===s.id);if(a){renderer.camera.x=a.x;renderer.camera.y=a.y;}}updateUi();}
function updateUi(){
 $('agent-count').textContent=sim.agents.length;$('clock').textContent=`${sim.clock.label} · ${sim.clock.period}`;$('train-status').textContent=renderer.train.label;
 $('debug-readout').textContent=`${renderer.fps||0} fps · render ${renderer.renderMs.toFixed(1)} ms · ${renderer.traffic.vehicles.length} vehicles · roads: ${sim.map.roads.report.surfaceComponents} component`;
 $('city-state').textContent=JSON.stringify({time:renderer.environment.time,clock:{label:sim.clock.label,day:sim.clock.day,hour:sim.clock.hour,period:sim.clock.period},population:{enabled:renderer.citizens.enabled,target:renderer.citizens.config.target,spawned:renderer.citizens.spawned,despawned:renderer.citizens.despawned,offscreenTicks:renderer.citizens.offscreenTicks,staff:1,plaza:renderer.citizens.plaza},sessions:[...sim.activities.sessions.values()],activityStats:sim.activities.stats,reservations:sim.activities.reservations.snapshot().map(p=>({id:p.id,type:p.type,locationId:p.locationId,x:p.position.x,y:p.position.y,reservedBy:p.reservedBy,occupant:p.occupant})),waterFrame:renderer.water.frame,train:{state:renderer.train.state,x:renderer.train.x,speed:renderer.train.speed,arrivals:renderer.train.arrivals,departures:renderer.train.departures},traffic:{spawned:renderer.traffic.spawned,exited:renderer.traffic.exited,yields:renderer.traffic.yields,vehicles:renderer.traffic.vehicles.map(v=>({id:v.id,route:v.route.id,x:v.x,y:v.y,angle:v.angle,speed:v.speed,stopped:v.stopped,yielding:v.yielding}))},agents:sim.agents.map(a=>({id:a.id,name:a.name,role:a.role,appearance:a.appearance,homeId:a.homeId,hidden:a.hidden,personality:a.personality,needs:a.needs,workStatus:a.workStatus,x:a.x,y:a.y,state:a.state,direction:a.direction,frame:a.animator.frame,prop:a.prop,crossingWait:a.crossingWait||0,destination:a.lastDestination,activity:a.activity?{definitionId:a.activity.definitionId,locationId:a.activity.locationId,lifecycle:a.activity.lifecycle,pointId:a.activity.pointId,tableId:a.activity.tableId,seatRemaining:a.activity.seatRemaining,stepId:a.activity.stepId,stepPhase:a.activity.stepPhase,outcome:a.activity.outcome,history:a.activity.history,pose:sim.activities.pose(a),bubble:a.activity.bubble}:null})),cafe:{name:CAFE_LOCATION.name,stats:sim.activities.stats,seats:sim.activities.reservations.snapshot().filter(p=>p.locationId===CAFE_LOCATION.id&&p.type==='chair').map(p=>({id:p.id,tableId:p.tableId,x:p.position.x,y:p.position.y,direction:p.direction,reservedBy:p.reservedBy,occupant:p.occupant}))},camera:{x:renderer.camera.x,y:renderer.camera.y,zoom:renderer.camera.zoom},citizens:renderer.citizens.allPeople.map(a=>({id:a.id,visitorRole:a.visitorRole,hidden:a.hidden,prop:a.prop,serving:!!a.serving,exiting:!!a.exiting,x:a.x,y:a.y,state:a.state,activity:a.activity?{definitionId:a.activity.definitionId,locationId:a.activity.locationId,pointId:a.activity.pointId,tableId:a.activity.tableId,stepId:a.activity.stepId,stepPhase:a.activity.stepPhase,outcome:a.activity.outcome,pose:sim.activities.pose(a)}:null})),mission:{phase:sim.phase,done:sim.steps.filter(s=>s.status==='done').length},roads:sim.map.roads.report,lanes:renderer.traffic.report,fps:renderer.fps||0,renderMs:renderer.renderMs});
 const rows=sim.agents.map(a=>`<button class="agent-row ${selection?.type==='agent'&&selection.id===a.id?'selected':''}" data-agent="${a.id}" aria-label="Inspect ${escape(a.name)}, ${a.role}, ${a.status}"><span class="avatar" style="--agent-color:${visualRoleColor(a.appearance||a.role)}">${escape(a.name.slice(0,1).toUpperCase())}</span><span class="agent-meta"><strong>${escape(a.name)}</strong><small>${a.role}</small></span><span class="state" data-state="${a.status}">${a.status}</span></button>`).join('');
 // Avoid replacing focused buttons while the scene animates.
 if($('agent-list').innerHTML!==rows){const focused=document.activeElement?.dataset.agent;$('agent-list').innerHTML=rows;if(focused)$('agent-list').querySelector(`[data-agent="${focused}"]`)?.focus({preventScroll:true});}
 $('workflow').innerHTML=sim.steps.map((s,i)=>`<div class="step ${s.status==='done'?'done':['active','waiting'].includes(s.status)?'active':s.status==='error'?'error':''}"><strong>${s.status==='done'?'✓':String(i+1).padStart(2,'0')} ${s.title}</strong><small>${s.status==='done'?'Delivered':s.status==='waiting'?'Needs '+s.role:s.agentId?escape(sim.agents.find(a=>a.id===s.agentId)?.name||'Reassigning'):s.role}</small></div>`).join('');
 const active=sim.steps[sim.stage];const message={idle:'Give the town something to build.',planning:'Planning four dependent stages…',collecting:`${sim.currentAgent?.name} is collecting the brief.`,travelling:`${sim.currentAgent?.name} is heading to work.`,working:`${sim.currentAgent?.name} is ${active?.title.toLowerCase()}ing… ${Math.round((active?.progress||0)*100)}%`,delivering:`${sim.currentAgent?.name} is delivering the handoff.`,blocked:`Waiting for a ${active?.role}. Add one to continue.`,error:'A resident hit an error. Retry the current step.',complete:'Mission complete. All four stages delivered.'};
 const status=(sim.paused?'Paused · ':'')+message[sim.phase];if($('mission-status').textContent!==status)$('mission-status').textContent=status;
 $('start').disabled=sim.running;$('start').textContent=sim.phase==='complete'?'▶ Run again':'▶ Start task';$('task-input').disabled=sim.running;$('pause').disabled=false;$('pause').textContent=sim.paused?'▶ Resume':'Ⅱ Pause';$('retry').hidden=sim.phase!=='error';$('progress').textContent=`${sim.steps.filter(s=>s.status==='done').length} / 4`;$('progress-bar').style.width=`${sim.progress*100}%`;
 $('log-count').textContent=sim.logs.length;const log=sim.logs.map(l=>`<li><time>${time(l.time)}</time>${escape(l.message)}</li>`).join('');if($('log-list').innerHTML!==log)$('log-list').innerHTML=log;
 renderInspector();
}
function renderInspector(){
 if(selection?.type!=='agent')replaceInspectorContent($('inspect-content'),'');
 if(!selection){$('inspector').hidden=true;return;}$('inspector').hidden=false;
 if(selection.type==='agent'){const a=sim.agents.find(a=>a.id===selection.id);if(!a){selection=null;syncTaskSelection();renderer.selected=null;runtimeInspectionSelection.clear();replaceInspectorContent($('inspect-content'),'');$('inspector').hidden=true;return;}
 $('inspect-title').textContent=a.name;const active=sim.currentAgent?.id===a.id;
 const location=LOCATIONS.find(l=>l.id===a.activity?.locationId)?.name||(active?building(a.workplace).name:a.lastDestination||'Town sidewalk');
 const content=`<dl><dt>Role</dt><dd style="color:${visualRoleColor(a.appearance||a.role)}">${a.role}</dd><dt>Work status</dt><dd>${escape(a.workStatus)}</dd><dt>Activity</dt><dd>${escape(a.status)}</dd><dt>Location</dt><dd>${escape(location)}</dd><dt>Workplace</dt><dd>${building(a.workplace).name}</dd><dt>Home</dt><dd>${HOME_LOCATIONS.find(h=>h.id===a.homeId)?.name||'Shared residence'}</dd><dt>Energy</dt><dd>${Math.round(a.needs.energy)} / 100</dd><dt>Social</dt><dd>${Math.round(a.needs.social)} / 100</dd><dt>Hunger</dt><dd>${Math.round(a.needs.hunger)} / 100</dd><dt>Personality</dt><dd>${escape(a.personality)}</dd><dt>Stage</dt><dd>${active?escape(sim.steps[sim.stage]?.title||'Handoff'):'No active assignment'}</dd></dl>${runtimeInspectorHtml(npcRuntimeBindingView.getForEntity(a),npcStatusPresentation.getForEntity(a),runtimeInspectionSelection,npcRuntimeBindingView.getSnapshot().runtime)}<div class="inspect-actions"><button class="danger" id="remove-agent" data-id="${a.id}">Remove agent</button>${active&&sim.phase!=='error'?'<button id="fail-agent">Simulate error</button>':''}</div>`;
 replaceInspectorContent($('inspect-content'),content);
 }else if(selection.type==='citizen'){const a=renderer.citizens.allPeople.find(a=>a.id===selection.id);if(!a){select(null);return;}$('inspect-title').textContent=`${a.name} · Visitor`;$('inspect-content').innerHTML=`<p>Decorative ${escape(a.visitorRole||'pedestrian')}</p><p>This visitor explores the town and takes no AI assignments.</p><dl><dt>Activity</dt><dd>${escape(a.activity?a.status:a.moving?'Walking':'Looking around')}</dd><dt>Visiting</dt><dd>${escape(a.lastDestination||'Market frontage')}</dd></dl>`;
  }else if(selection.type==='location'){const location=LOCATIONS.find(l=>l.id===selection.id);if(!location){select(null);return;}const seats=sim.activities.reservations.snapshot().filter(p=>p.locationId===location.id&&['chair','benchSeat'].includes(p.type)),occupied=seats.filter(p=>p.occupant!==null).length;$('inspect-title').textContent=location.name;$('inspect-content').innerHTML=`<p>${location.id===PARK_LOCATION.id?'Shared gardens, quiet benches and reading breaks.':'Outdoor coffee terrace. Residents take coffee breaks and chat between assignments.'}</p><dl><dt>${location.id===PARK_LOCATION.id?'Benches':'Tables'}</dt><dd>${location.id===PARK_LOCATION.id?PARK_BENCHES.length:CAFE_TABLES.length}</dd><dt>Seated</dt><dd>${occupied} / ${seats.length}</dd><dt>Available</dt><dd>${seats.filter(p=>p.reservedBy===null).length}</dd></dl><p>City Hall assignments take priority.</p>`;}else{const b=building(selection.id);$('inspect-title').textContent=b.name;const names=sim.agents.filter(a=>a.workplace===b.id).map(a=>escape(a.name)).join(', ');const content=`<p style="color:${visualAccent(b.color)}">${b.title}</p><p>${b.description}</p>${b.id==='hall'?`<p>Mission: ${sim.task?escape(sim.task):'Awaiting a task'}</p>`:`<p>Residents: ${names||'No residents assigned'}</p>`}`;if($('inspect-content').innerHTML!==content)$('inspect-content').innerHTML=content;}
}
$('inspect-title').tabIndex=-1;
$('agent-list').addEventListener('click',e=>{const row=e.target.closest('[data-agent]');if(row){select({type:'agent',id:Number(row.dataset.agent)});if(e.detail===0)$('inspect-title').focus({preventScroll:true});}});
$('inspect-content').addEventListener('click',e=>{
 const reference=e.target.closest('[data-runtime-execution]');
 if(reference&&selection?.type==='agent'){
  const npc=sim.agents.find(a=>a.id===selection.id);
  if(npc&&runtimeInspectionSelection.select(npcRuntimeBindingView.getForEntity(npc),reference.dataset.runtimeExecution))renderInspector();
  return;
 }
 if(e.target.id==='remove-agent'){sim.removeAgent(Number(e.target.dataset.id));select(null);}if(e.target.id==='fail-agent'){sim.fail(selection.id);updateUi();}
});
$('inspect-close').onclick=()=>{const id=selection?.type==='agent'?selection.id:null;select(null);const row=id===null?null:$('agent-list').querySelector(`[data-agent="${id}"]`);(row&&!$('residents').hidden?row:$('residents-toggle')).focus({preventScroll:true});};
$('inspector').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]')){e.preventDefault();$('inspect-close').click();}});
$('task-form').onsubmit=e=>{e.preventDefault();if(sim.start($('task-input').value))updateUi();};
$('reset').onclick=()=>{sim.reset();updateUi();};$('pause').onclick=()=>{sim.paused=!sim.paused;updateUi();};$('retry').onclick=()=>{sim.retry();updateUi();};$('speed').onchange=e=>{sim.speed=Number(e.target.value);sim.log(`Simulation speed set to ${sim.speed}×.`);};
$('cafe-focus').onclick=()=>{renderer.camera.zoom=Math.min(1.5,renderer.width/700,renderer.height/600);renderer.camera.x=Math.min(1696,WORLD.width-renderer.width/(2*renderer.camera.zoom));renderer.camera.y=300;renderer.camera.clamp();};
$('park-focus').onclick=()=>{renderer.camera.zoom=Math.min(1.5,renderer.width/760,renderer.height/760);renderer.camera.x=Math.max(430,renderer.width/(2*renderer.camera.zoom));renderer.camera.y=Math.min(640,WORLD.height-renderer.height/(2*renderer.camera.zoom));renderer.camera.clamp();};
$('ambient-toggle').onchange=e=>{renderer.citizens.enabled=e.target.checked;};$('population-density').onchange=e=>renderer.citizens.setTarget(Number(e.target.value));$('population-density').value=String(renderer.citizens.config.target);$('day-speed').onchange=e=>{sim.clock.minutesPerSecond=Number(e.target.value);};
$('zoom-in').onclick=()=>renderer.zoom(1.2);$('zoom-out').onclick=()=>renderer.zoom(1/1.2);$('recenter').onclick=()=>renderer.fit();$('labels-toggle').onclick=()=>{renderer.labels=!renderer.labels;$('labels-toggle').setAttribute('aria-pressed',renderer.labels);};
 $('debug-toggle').onclick=()=>{$('developer').hidden=!$('developer').hidden;$('debug-toggle').setAttribute('aria-expanded',!$('developer').hidden);};
 $('debug-close').onclick=()=>{$('developer').hidden=true;$('debug-toggle').setAttribute('aria-expanded','false');};
 for(const input of document.querySelectorAll('[data-overlay]'))input.onchange=()=>{if(input.checked)renderer.debug.enabled.add(input.dataset.overlay);else renderer.debug.enabled.delete(input.dataset.overlay);};
$('residents-toggle').onclick=()=>{const hidden=!$('residents').hidden;$('residents').hidden=hidden;$('residents-toggle').setAttribute('aria-expanded',!hidden);};
const toggleLog=value=>{$('activity').hidden=!value;$('log-toggle').setAttribute('aria-expanded',value);};$('log-toggle').onclick=()=>toggleLog($('activity').hidden);$('log-close').onclick=()=>toggleLog(false);
for(const b of BUILDINGS.filter(b=>b.id!=='hall')){const o=document.createElement('option');o.value=b.id;o.textContent=b.name;$('agent-workplace').append(o);}
$('agent-role').onchange=()=>{$('agent-workplace').value=DEFAULT_WORKPLACES[$('agent-role').value];};$('agent-workplace').value=DEFAULT_WORKPLACES.Developer;
$('add-open').onclick=()=>{$('add-dialog').showModal();$('agent-name').focus();};$('add-close').onclick=()=>$('add-dialog').close();
$('agent-form').onsubmit=e=>{e.preventDefault();const input=$('agent-name');input.setCustomValidity('');if(!input.value.trim()){input.setCustomValidity('Please enter a name.');input.reportValidity();return;}const a=sim.addAgent(input.value,$('agent-role').value,$('agent-workplace').value,true,$('agent-personality').value,$('agent-appearance').value||$('agent-role').value);if(a){$('add-dialog').close();input.value='';select({type:'agent',id:a.id});}};$('agent-name').oninput=e=>e.target.setCustomValidity('');
$('help-toggle').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
if(innerWidth<650){$('residents').hidden=true;$('residents-toggle').setAttribute('aria-expanded','false');}
sim.onChange=()=>updateUi();updateUi();
// Mission speed affects residents; ambient rail/water timers keep their natural pace.
let frameStart=performance.now(),frameCount=0;
const loop=new GameLoop(dt=>{sim.update(dt);if(!sim.paused)renderer.update(dt);},now=>{const started=performance.now();renderer.draw();renderer.renderMs=renderer.renderMs*.9+(performance.now()-started)*.1;frameCount++;if(now-frameStart>1000){renderer.fps=Math.round(frameCount*1000/(now-frameStart));frameStart=now;frameCount=0;}if(now-lastUi>200){updateUi();lastUi=now;}});loop.start();
