import assert from 'node:assert/strict';
/** Real Chromium DOM/keyboard/AX checks, using the existing panel and deterministic HTTP boundary. */
export async function verifyInteractionHardening({evaluate,command,until}){
 await evaluate("(()=>{const r=document.getElementById('residents');if(r.hidden)document.getElementById('residents-toggle').click();document.querySelector('[data-agent]').focus();})()");
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
 await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await until(()=>evaluate("document.activeElement===document.getElementById('inspect-title')"),'Keyboard resident selection did not focus inspector heading');
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate("document.getElementById('inspector').hidden&&document.activeElement.matches('[data-agent]')"),true);
 await evaluate("document.querySelector('[data-agent]').click()");
 await evaluate(`(async()=>{
  const {createAgentTaskPanel}=await import('/js/agent-task-panel.js');
  const {InteractionApiClient}=await import('/js/runtime/interaction/index.js');
  // Mount a second panel only for this isolated component check; avoid duplicating the live form's label ID.
  const originalInput=document.getElementById('agent-task-instruction'),originalLabel=document.querySelector('label[for=agent-task-instruction]');originalInput.id='hardening-prior-instruction';originalLabel.htmlFor=originalInput.id;
  const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),stamp='2026-10-26T00:00:00.000Z';
  const host=document.createElement('div');host.id='hardening-fixture';host.style.cssText='position:fixed;inset:0;overflow:auto;background:#182534;z-index:100';document.body.append(host);
  let requests=0;const binding={state:'RESOLVED',agentId:id(1),bindingId:id(101),npcId:'resident-slot-001',freshness:'fresh',lastSuccessfulSyncAt:stamp,activity:null};
  const runtime={freshness:'fresh',activitiesByAgentId:{},missingAgentIds:[]};
  const panel=createAgentTaskPanel({host,refresh:()=>{},pageOrigin:location.origin,clientFactory:options=>new InteractionApiClient({...options,fetchImpl:async()=>{requests++;return new Response(JSON.stringify({id:id(1),name:'Agent <img src=x onerror=alert(1)>',description:null,type:'RULE_BASED',orchestratorId:id(9),lifecycleStatus:'ACTIVE',capabilities:[],version:1,createdAt:stamp,updatedAt:stamp,actionEligibility:{canCreateTask:true,canRequestStart:false,canRequestCancel:false,reason:null}}),{headers:{'content-type':'application/json'}});}})});
  panel.select(binding,runtime);globalThis.__hardening={panel,host,binding,runtime,originalInput,originalLabel,requests:()=>requests};
 })()`);
 try{
  await evaluate("document.querySelector('#hardening-fixture [data-connect]').focus()");
  assert.equal(await evaluate("document.activeElement===document.querySelector('#hardening-fixture [data-connect]')"),true,'Access button must receive focus');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'Keyboard Enter did not open access dialog');
  assert.equal(await evaluate("document.querySelector('dialog[open]')?.getAttribute('aria-labelledby')"),'interaction-access-title');
  for(let n=0;n<6;n++){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"),true,'Modal Tab navigation escaped dialog');}
  for(let n=0;n<6;n++){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"),true,'Modal Shift-Tab navigation escaped dialog');}
  await command('Accessibility.enable');const modalAx=await command('Accessibility.getFullAXTree');assert.ok(modalAx.nodes.some(n=>n.role?.value==='dialog'&&n.name?.value==='Local interaction access'));
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  const escapeRestored=await evaluate("document.activeElement===document.querySelector('#hardening-fixture [data-connect]')");
  await evaluate(`(()=>{document.querySelector('#hardening-fixture [data-connect]').click();const d=document.querySelector('dialog[open]');d.querySelector('[name=credential]').value='H'.repeat(40);d.querySelector('form').requestSubmit();})()`);
  await until(()=>evaluate("!document.querySelector('#hardening-fixture [data-submit]').disabled"),'Hardening fixture access did not resolve');
  assert.equal(await evaluate("document.activeElement===document.querySelector('#hardening-fixture [data-task-title]')"),true,'Access loading must not strand focus on a disabled input');
  assert.equal(await evaluate("document.querySelector('#hardening-fixture img')===null"),true);
  await evaluate("document.querySelector('#hardening-fixture form').requestSubmit()");
  assert.equal(await evaluate("document.querySelector('#hardening-fixture textarea').getAttribute('aria-invalid')"),'true');
  const validationFocused=await evaluate("document.activeElement===document.querySelector('#hardening-fixture textarea')");
  await command('Accessibility.enable');const ax=await command('Accessibility.getFullAXTree');
  assert.ok(ax.nodes.some(n=>n.role?.value==='textbox'&&n.name?.value==='Task instructions'));
  assert.ok(ax.nodes.some(n=>n.role?.value==='button'&&n.name?.value==='Save Task'));
  const stable=await evaluate(`(()=>{const f=globalThis.__hardening,observer=new MutationObserver(()=>{});observer.observe(f.host,{subtree:true,childList:true,characterData:true});const start=performance.now(),before=f.requests();for(let n=0;n<100;n++)f.panel.select(f.binding,f.runtime);const result={repeatedSelections:100,domTextMutations:observer.takeRecords().length,elapsedMs:performance.now()-start,additionalRequests:f.requests()-before};observer.disconnect();return result;})()`);
  assert.equal(stable.additionalRequests,0);
  assert.equal(stable.domTextMutations,0,'Identical selected state should not rebuild panel text');
  assert.equal(escapeRestored,true);assert.equal(validationFocused,true);
  const targets=await evaluate("[...document.querySelectorAll('#hardening-fixture button,#hardening-fixture summary')].filter(e=>e.getClientRects().length).map(e=>({label:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))");
  assert.ok(targets.every(t=>t.width>=24&&t.height>=24),'Visible interaction targets need a 24px minimum');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),true);
  await command('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.querySelector('#hardening-fixture .agent-task-section').scrollWidth<=document.querySelector('#hardening-fixture .agent-task-section').clientWidth"),true);
  return {status:'PASS',kind:'Real Chrome panel semantics, keyboard, untrusted name and deterministic repeated selections',escapeRestored,validationFocused,keyboardResidentSelection:true,modalTabContainment:true,stable,targets,axLabels:true,reducedMotion:true,reflow320:true};
 }finally{await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await command('Emulation.setEmulatedMedia',{features:[]});await evaluate("globalThis.__hardening.panel.dispose();globalThis.__hardening.host.remove();globalThis.__hardening.originalInput.id='agent-task-instruction';globalThis.__hardening.originalLabel.htmlFor='agent-task-instruction';delete globalThis.__hardening");}
}
