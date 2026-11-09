import assert from 'node:assert/strict';
import {verifyInteractionReliability} from './interaction-reliability-browser.mjs';
import {reloadCity} from './browser-reload.mjs';
/** Real DOM interaction with isolated deterministic HTTP fixtures. Never production Agent events. */
export async function verifyTaskPanel({evaluate,until,command}){
 await evaluate(`(async()=>{
  const original=globalThis.fetch,uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),stamp=new Date().toISOString();
  const grant={canCreateTask:true,canRequestStart:false,canRequestCancel:false,reason:null};
  const state=globalThis.__taskPanelTest={posts:[],gets:[],mode:'ok',task:null};
  globalThis.fetch=async(url,options)=>{
   if(options.method==='POST'){
    state.posts.push(JSON.parse(options.body));state.task={id:uid(700+state.posts.length),agentId:uid(1),orchestratorId:uid(9),status:'CREATED',version:1,createdAt:stamp,updatedAt:stamp,completedAt:null};
    if(state.mode==='lost')throw TypeError('Controlled lost response');
    return new Promise(resolve=>{state.finish=()=>resolve(new Response(JSON.stringify({...state.task,actionEligibility:grant}),{status:201,headers:{'content-type':'application/json'}}));});
   }
   state.gets.push(String(url));return new Response(JSON.stringify(String(url).includes('/lookup')?{task:state.task}:{id:uid(1),name:'Agent <img src=x onerror=alert(1)>',description:null,type:'RULE_BASED',orchestratorId:uid(9),lifecycleStatus:'ACTIVE',capabilities:[],version:1,createdAt:stamp,updatedAt:stamp,actionEligibility:grant}),{headers:{'content-type':'application/json'}});
  };
  document.querySelector('.agent-task-section [data-connect]').click();
  const dialog=[...document.querySelectorAll('dialog')].find(d=>d.open);
  dialog.querySelector('[name=origin]').value=location.origin;dialog.querySelector('[name=credential]').value='I'.repeat(40);dialog.querySelector('form').requestSubmit();
  globalThis.fetch=original;
 })()`);
 const get=s=>evaluate(`document.querySelector('.agent-task-section ${s}')?.textContent`);
 await until(()=>evaluate("!document.querySelector('.agent-task-section [data-submit]').disabled"),'Task form eligibility did not load');
 assert.equal(await evaluate("document.querySelector('.agent-task-section img')===null"),true);
 await evaluate("document.querySelector('.agent-task-section form').requestSubmit()");
 assert.match(await get('#agent-task-feedback'),/Enter instructions/);
 await evaluate(`(()=>{const t=document.getElementById('agent-task-instruction');t.value='Browser Task <b>literal</b>';t.dispatchEvent(new Event('input',{bubbles:true}));const f=t.form;f.requestSubmit();f.requestSubmit();})()`);
 await until(()=>evaluate('globalThis.__taskPanelTest.posts.length===1&&!!globalThis.__taskPanelTest.finish'),'Task Create was not dispatched once');
 assert.equal(await evaluate("document.querySelector('.agent-task-section [data-submit]').disabled"),true);
 // Closing selection does not abort a dispatched mutation; its confirmed reference is recoverable on return.
 await evaluate("document.getElementById('inspect-close').click();globalThis.__taskPanelTest.finish()");
 await evaluate("document.querySelector('[data-agent]').click()");
 await until(async()=>/Saved Task/.test(await get('[data-reference]')),'Saved Task reference missing after reopen');
 assert.equal(await evaluate('globalThis.__taskPanelTest.posts[0].agentId'),'00000000-0000-4000-8000-000000000001');
 assert.match(await get('#agent-task-feedback'),/No Execution/);
 await evaluate(`(()=>{document.querySelector('.agent-task-section [data-new]').click();globalThis.__taskPanelTest.mode='lost';const t=document.getElementById('agent-task-instruction');t.value='Recover exact Task';t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit();})()`);
 await until(async()=>/unresolved/.test(await get('#agent-task-feedback')),'Ambiguous submission did not stay unresolved');
 await evaluate("document.querySelector('.agent-task-section [data-recover]').click()");
 await until(async()=>/Saved Task/.test(await get('[data-reference]')),'Exact-key recovery failed');
 assert.equal(await evaluate('globalThis.__taskPanelTest.posts.length'),2);
 assert.equal(await evaluate("globalThis.__taskPanelTest.gets.some(u=>u.includes('/lookup?')&&u.includes(encodeURIComponent(globalThis.__taskPanelTest.posts[1].idempotencyKey)))"),true);
 await evaluate("document.querySelector('.agent-task-section [data-new]').focus()");
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 assert.equal(await evaluate("document.getElementById('inspector').hidden"),true);
 await evaluate("document.querySelector('[data-agent]').click()");
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate("document.querySelector('.agent-task-section').scrollWidth<=document.querySelector('.agent-task-section').clientWidth"),true);
 assert.equal(await evaluate("document.querySelector('.agent-task-section label').htmlFor===document.querySelector('.agent-task-section textarea').id"),true);
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate("document.querySelectorAll('[data-agent]')[3].click()");
 assert.equal(await evaluate("document.querySelector('.agent-task-section').hidden"),true);
 assert.equal(await evaluate("document.querySelector('.agent-task-section [data-reference]').textContent"),'');
 await evaluate("document.querySelector('[data-agent]').click();document.querySelector('.agent-task-section [data-disconnect]').click()");
 assert.equal(await evaluate("document.querySelector('.agent-task-section [data-reference]').textContent"),'');
 assert.equal(await evaluate("document.querySelector('.agent-task-section [data-submit]').disabled"),true);
 await evaluate('delete globalThis.__taskPanelTest');
 return 'P4 T04 real browser fixture: existing inspector form, safe text, eligibility, validation, duplicate guard, close/reopen, saved-not-started reference, exact-key lost-response recovery and unbound preservation';
}

/** Native browser fetch against the owned PostgreSQL/Nest fixture; credentials travel only over private test IPC. */
export async function verifyLiveTaskPanel({evaluate,until,permitApi,command,waitEvent}){
 assert.ok(process.send,'Live Task panel verification requires its isolated test parent');
 const config=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off('message',receive);reject(Error('Task fixture configuration timed out'));},10000);const receive=message=>{if(message?.kind==='task-panel-configuration'){clearTimeout(timer);process.off('message',receive);resolve(message.config);}};process.on('message',receive);process.send({kind:'task-panel-configuration-request'});});
 permitApi(config.apiOrigin);
 await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.connect({baseUrl:${JSON.stringify(config.apiOrigin)},pageOrigin:location.origin,token:${JSON.stringify(config.cityToken)}});await r.refresh();document.querySelector('[data-agent]').click();})()`);
 await until(()=>evaluate("!document.querySelector('.agent-task-section').hidden"),'Authorized persisted binding did not expose Task panel');
 await evaluate(`(()=>{document.querySelector('.agent-task-section [data-connect]').click();const d=[...document.querySelectorAll('dialog')].find(d=>d.open);d.querySelector('[name=origin]').value=${JSON.stringify(config.apiOrigin)};d.querySelector('[name=credential]').value=${JSON.stringify(config.interactionToken)};d.querySelector('form').requestSubmit();})()`);
 await until(()=>evaluate("!document.querySelector('.agent-task-section [data-submit]').disabled"),'Native authorized eligibility request failed');
 await evaluate(`(()=>{const t=document.getElementById('agent-task-instruction');t.value='T04 browser authorized Task';t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit();t.form.requestSubmit();})()`);
 await until(()=>evaluate("document.querySelector('.agent-task-section [data-reference]').textContent.startsWith('Saved Task ')"),'Native Task submission confirmation missing');
 const reference=await evaluate("document.querySelector('.agent-task-section [data-reference]').textContent");
 assert.ok(reference.includes(config.agentId));assert.ok(reference.includes('CREATED'));
 const taskId=reference.match(/^Saved Task ([a-f0-9-]{36})/)[1];
 await evaluate("document.getElementById('inspect-close').click();document.querySelector('[data-agent]').click()");
 assert.equal(await evaluate("document.querySelector('.agent-task-section [data-reference]').textContent"),reference);
 let synchronization;
 if(config.synchronization){
  const journalSafe=await evaluate(`(()=>{const raw=sessionStorage.getItem('elyqreth.interaction.locators.v1');return !!raw&&!raw.includes('T04 browser authorized Task')&&!raw.includes(${JSON.stringify(config.interactionToken)})&&!raw.includes(${JSON.stringify(config.cityToken)});})()`);assert.equal(journalSafe,true);
  await reloadCity({command,waitEvent,evaluate,until});
  await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.connect({baseUrl:${JSON.stringify(config.apiOrigin)},pageOrigin:location.origin,token:${JSON.stringify(config.cityToken)}});await r.refresh();document.querySelector('[data-agent]').click();})()`);
  await evaluate(`(()=>{document.querySelector('.agent-task-section [data-connect]').click();const d=document.querySelector('dialog[open]');d.querySelector('[name=origin]').value=${JSON.stringify(config.apiOrigin)};d.querySelector('[name=credential]').value=${JSON.stringify(config.interactionToken)};d.querySelector('form').requestSubmit();})()`);
  await until(()=>evaluate(`document.querySelector('[data-reference]').textContent.includes(${JSON.stringify(taskId)})&&!document.querySelector('[data-start]').disabled`),'Saved unstarted Task locator was not reauthorized/restored');
  await evaluate("document.querySelector('[data-history-section]').open=true");await until(()=>evaluate("document.querySelector('[data-history-feedback]').textContent.includes('No Execution history')"),'Empty initial history snapshot missing');
  synchronization={status:'PASS',unstartedTaskReloadRecovered:true,identifiersOnly:true};
 }
 let lifecycle;
 if(config.reliability)return {status:'PASS',taskId,agentId:config.agentId,reliability:await verifyInteractionReliability({config,taskId,evaluate,until,command,waitEvent})};
 if(config.lifecycle){
  const control=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off('message',receive);reject(Error('Lifecycle test control timed out'));},10000);const receive=message=>{if(message?.kind==='task-lifecycle-result'&&message.name===name){clearTimeout(timer);process.off('message',receive);message.error?reject(Error('Lifecycle fixture command failed')):resolve(message.result);}};process.on('message',receive);process.send({kind:'task-lifecycle-command',name});});
  const status=()=>evaluate("document.querySelector('.agent-task-section [data-execution-status]').textContent");
  await until(()=>evaluate("!document.querySelector('.agent-task-section [data-start]').disabled"),'Saved Task did not become startable');
  await evaluate("document.querySelector('.agent-task-section [data-start]').click();document.querySelector('.agent-task-section [data-start]').click()");
  await until(async()=>/Execution status: SUCCEEDED/.test(await status()),'Genuine rule-based Start did not reach SUCCEEDED');
  if(config.synchronization)await until(()=>evaluate("document.querySelectorAll('[data-history-list] button').length===1&&document.querySelector('[data-history-list]').textContent.includes('SUCCEEDED')"),'History did not invalidate after confirmed terminal Execution');
  assert.equal(await evaluate("document.querySelector('.agent-task-section [data-start]').disabled&&document.querySelector('.agent-task-section [data-cancel-execution]').disabled"),true);
  await evaluate("document.querySelector('.agent-task-section [data-new]').click();const t=document.getElementById('agent-task-instruction');t.value='T05 cancellable browser Task';t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit()");
  await until(()=>evaluate("!document.querySelector('.agent-task-section [data-start]').disabled"),'Second Task did not become startable');
  await evaluate("document.querySelector('.agent-task-section [data-start]').click()");await control('entered');
  if(config.synchronization){
   await evaluate("document.querySelectorAll('[data-agent]')[1].click()");await until(()=>evaluate("!document.querySelector('[data-submit]').disabled"),'Agent B access unavailable');
   await evaluate("(()=>{const t=document.getElementById('agent-task-instruction');t.value='T07 independent Agent B';t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit()})()");
   await until(()=>evaluate("!document.querySelector('[data-start]').disabled"),'Agent B Task not startable');await evaluate("document.querySelector('[data-start]').click()");
   await until(()=>evaluate("document.querySelector('[data-execution-feedback]').textContent.includes('unresolved')"),'Primary coordinator capacity conflict was not safely reconciled');
   await control('runB');await evaluate("document.querySelector('[data-refresh-execution]').click()");
   await until(async()=>/Execution status: SUCCEEDED/.test(await status()),'Agent B completion missing');
   await evaluate("document.querySelector('[data-agent]').click();document.querySelector('[data-refresh-execution]').click()");await until(async()=>/Execution status: RUNNING/.test(await status()),'Agent A did not remain independently RUNNING');
   await command('Network.setBlockedURLs',{urls:[config.apiOrigin+'/*']});
   await evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');await r.refresh();})()");
   await until(()=>evaluate("document.querySelector('[data-freshness]').textContent.includes('stale')"),'Outage was not stale');assert.equal(await evaluate("document.querySelector('[data-cancel-execution]').disabled"),true);
   await command('Network.setBlockedURLs',{urls:[]});
   await until(()=>evaluate("!document.querySelector('[data-cancel-execution]').disabled"),'Shared synchronization did not reconcile after outage');
   synchronization.multiAgentIsolation=true;synchronization.networkReconciled=true;synchronization.historyInvalidated=true;
  }
  await evaluate("document.getElementById('inspect-close').click();document.querySelector('[data-agent]').click();document.querySelector('.agent-task-section [data-refresh-execution]').click()");
  await until(()=>evaluate("!document.querySelector('.agent-task-section [data-cancel-execution]').disabled"),'Active Execution did not become cancellable');
  const executionReference=await evaluate("document.querySelector('.agent-task-section [data-execution-reference]').textContent"),executionId=executionReference.match(/Execution ([a-f0-9-]{36})/)[1];
  await evaluate("document.querySelector('.agent-task-section [data-cancel-execution]').click()");
  assert.equal(await evaluate("[...document.querySelectorAll('dialog')].find(d=>d.open).querySelector('[data-target]').textContent.includes("+JSON.stringify(executionId)+")"),true);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.querySelector('dialog[open]').scrollWidth<=document.querySelector('dialog[open]').clientWidth"),true);
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelector('dialog[open] [data-back]').click()");
  await until(()=>evaluate("document.activeElement===document.querySelector('.agent-task-section [data-cancel-execution]')"),'Back did not restore cancellation focus');
  await evaluate("document.querySelector('.agent-task-section [data-cancel-execution]').click()");
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(()=>evaluate("!document.querySelector('dialog[open]')&&document.activeElement===document.querySelector('.agent-task-section [data-cancel-execution]')"),'Escape did not dismiss cancellation and restore focus');
  await evaluate("document.querySelector('.agent-task-section [data-cancel-execution]').click();const b=document.querySelector('dialog[open] [data-confirm]');b.click();b.click()");
  await until(async()=>/Execution status: CANCELLED/.test(await status()),'Cancellation did not show its genuine persisted outcome');
  assert.equal(await evaluate("document.querySelector('.agent-task-section').contains(document.activeElement)&&!document.activeElement.disabled"),true,'Confirmed cancellation must retain focus in the interaction section');await control('release');
  await until(async()=>!(/Start HTTP response pending/.test(await status())),'Cancelled Start HTTP request did not settle');
  await reloadCity({command,waitEvent,evaluate,until});
  await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.connect({baseUrl:${JSON.stringify(config.apiOrigin)},pageOrigin:location.origin,token:${JSON.stringify(config.cityToken)}});await r.refresh();document.querySelector('[data-agent]').click();})()`);
  await evaluate(`(()=>{document.querySelector('.agent-task-section [data-connect]').click();const d=document.querySelector('dialog[open]');d.querySelector('[name=origin]').value=${JSON.stringify(config.apiOrigin)};d.querySelector('[name=credential]').value=${JSON.stringify(config.interactionToken)};d.querySelector('form').requestSubmit();})()`);
  await until(async()=>/Execution status: CANCELLED/.test(await status()),'Reload did not recover the exact terminal Execution');
  assert.ok((await evaluate("document.querySelector('.agent-task-section [data-execution-reference]').textContent")).includes(executionId));
  lifecycle={status:'PASS',executionId,terminalStatuses:['SUCCEEDED','CANCELLED'],reloadRecovered:true,confirmationBackVerified:true,selectionClosePreserved:true};
  if(config.synchronization){
   // Agent A retains native cancellation quarantine. Use the independently successful Agent B; never clear runtime protection for a test.
   await evaluate("document.querySelectorAll('[data-agent]')[1].click()");
   await until(()=>evaluate("!document.querySelector('[data-new]').disabled"),'Recovery did not release form state');
   await evaluate("(()=>{document.querySelector('[data-new]').click();const t=document.getElementById('agent-task-instruction');t.value='T07 active reload observation';t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit()})()");
   try{await until(()=>evaluate("!document.querySelector('[data-start]').disabled"),'Active reload Task was not startable');}catch(error){throw new Error(`${error.message}: ${await status()} / ${await evaluate("document.getElementById('agent-task-feedback').textContent")}`);}await evaluate("document.querySelector('[data-start]').click()");await control('enteredThird');
   await evaluate("document.querySelector('[data-refresh-execution]').click()");
   await until(async()=>/Execution status: RUNNING/.test(await status()),'Active reload Execution was not persisted RUNNING');
   const activeId=(await evaluate("document.querySelector('[data-execution-reference]').textContent")).match(/Execution ([a-f0-9-]{36})/)[1];
   await reloadCity({command,waitEvent,evaluate,until});
   await until(()=>evaluate("document.querySelectorAll('[data-agent]').length>=2"),'Reloaded resident roster did not initialize');
   await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.connect({baseUrl:${JSON.stringify(config.apiOrigin)},pageOrigin:location.origin,token:${JSON.stringify(config.cityToken)}});await r.refresh();document.querySelectorAll('[data-agent]')[1].click();})()`);
   await evaluate(`(()=>{document.querySelector('[data-connect]').click();const d=document.querySelector('dialog[open]');d.querySelector('[name=origin]').value=${JSON.stringify(config.apiOrigin)};d.querySelector('[name=credential]').value=${JSON.stringify(config.interactionToken)};d.querySelector('form').requestSubmit();})()`);
   await until(()=>evaluate(`document.querySelector('[data-execution-reference]').textContent.includes(${JSON.stringify(activeId)})`),'Active reload lost its exact Execution identity');
   await control('releaseThird');const persisted=await control('verifyThird');assert.equal(persisted.executionId,activeId);
   await evaluate("document.querySelector('[data-refresh-execution]').click()");
   await until(async()=>(await status()).includes(`Execution status: ${persisted.status}`),'Reloaded UI did not match authoritative persisted outcome');
   synchronization.activeReloadRecovered=true;synchronization.activeReloadBackendStatus=persisted.status;
  }
 }
 let results;
 if(config.results){
  const read=selector=>evaluate(`document.querySelector('.execution-results ${selector}').textContent`);
  await until(()=>evaluate("!document.querySelector('.agent-task-section [data-start]').disabled"),'Task not ready for result workflow');
  await evaluate("document.querySelector('.agent-task-section [data-start]').click()");
  await until(()=>evaluate("document.querySelector('[data-execution-status]').textContent.includes('SUCCEEDED')"),'Rule-based Task did not complete');
  await evaluate("document.querySelector('[data-result-section]').open=true");
  await until(async()=>/Text statistics/.test(await read('[data-result-label]')),'Structured result missing');
  assert.equal(JSON.parse(await read('[data-result-content]')).wordCount,4);
  const currentReference=await read('[data-result-metadata]');
  const before=await evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/result')).length");
  await evaluate("document.querySelector('[data-history-section]').open=true");
  await until(()=>evaluate("document.querySelectorAll('[data-history-list] button').length===10"),'History did not load bounded first page');
  await evaluate("globalThis.__historyFocus=document.querySelector('[data-history-list] button').textContent;document.querySelector('[data-history-list] button').focus();document.querySelector('[data-history-refresh]').click()");
  await until(()=>evaluate("document.querySelector('[data-history-section]').getAttribute('aria-busy')==='false'"),'History refresh did not settle');
  assert.equal(await evaluate("document.activeElement.textContent===globalThis.__historyFocus"),true,'History refresh lost focused execution');await evaluate('delete globalThis.__historyFocus');
  assert.equal(await evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/result')).length"),before);
  const activityBefore=await evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');const a=r.getAgent("+JSON.stringify(config.agentId)+");return JSON.stringify([a.activityStatus,a.currentExecution?.id]);})()");
  await evaluate("document.querySelectorAll('[data-history-list] button')[1].click()");
  await until(async()=>{try{return JSON.parse(await read('[data-result-content]')).wordCount===3;}catch{return false;}},'Historical result not loaded');
  assert.notEqual(await read('[data-result-metadata]'),currentReference);
  assert.match(await read('[data-result-title]'),/historical/);
  assert.equal(await evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');const a=r.getAgent("+JSON.stringify(config.agentId)+");return JSON.stringify([a.activityStatus,a.currentExecution?.id]);})()"),activityBefore);
  await evaluate("document.querySelector('[data-history-next]').click()");
  await until(()=>evaluate("document.querySelector('[data-history-page]').textContent==='Page 2'&&document.querySelectorAll('[data-history-list] button').length===2"),'Cursor second page missing');
  assert.equal(await evaluate("document.querySelector('[data-history-next]').disabled"),true);
  await evaluate("document.querySelector('[data-history-previous]').click()");await until(()=>evaluate("document.querySelectorAll('[data-history-list] button').length===10"),'Previous history page failed');
  await evaluate("document.querySelector('[data-result-current]').click()");
  assert.equal(await evaluate("document.activeElement===document.querySelector('[data-result-title]')"),true,'Current result return lost focus');
  await until(async()=>{try{return JSON.parse(await read('[data-result-content]')).wordCount===4;}catch{return false;}},'Return to current result failed');
  await evaluate("document.querySelectorAll('[data-agent]')[1].click()");
  await until(async()=>/not disclosed/.test(await read('[data-result-label]')),'Restricted Agent result was not withheld');
  assert.equal(await read('[data-result-content]'),'');
  await until(()=>evaluate("document.querySelectorAll('[data-history-list] button').length===1"),'Agent-scoped history not reset');
  assert.equal(await read('[data-history-page]'),'Page 1');
  await evaluate("document.querySelectorAll('[data-agent]')[2].click()");
  await until(async()=>/Plain text/.test(await read('[data-result-label]')),'Permitted plain text not loaded');
  assert.match(await read('[data-result-content]'),/<img/);
  assert.equal(await evaluate("document.querySelector('[data-result-content]').clientHeight<=242&&document.querySelector('[data-result-content]').scrollHeight>document.querySelector('[data-result-content]').clientHeight"),true);
  assert.equal(await evaluate("document.querySelectorAll('.execution-results img,.execution-results a,.execution-results script').length"),0);
  assert.equal(await evaluate('globalThis.__resultXss'),undefined);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.querySelector('.execution-results').scrollWidth<=document.querySelector('.execution-results').clientWidth"),true);
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  results={status:'PASS',structured:true,plainTextEscaped:true,restrictedTextWithheld:true,pages:[10,2],historyDoesNotAlterActivity:true,noPerRowResults:true,agentScopeReset:true,largeOutputScrolled:true};
 }
 await evaluate("document.querySelectorAll('[data-agent]')[3].click()");assert.equal(await evaluate("document.querySelector('.agent-task-section').hidden"),true);
 assert.equal(await evaluate("document.querySelector('[data-result-content]').textContent"),'');
 await evaluate("document.querySelector('[data-agent]').click();document.querySelector('.agent-task-section [data-disconnect]').click()");
 assert.equal(await evaluate("document.querySelector('.agent-task-section [data-reference]').textContent"),'');
 if(config.synchronization)assert.equal(await evaluate("sessionStorage.getItem('elyqreth.interaction.locators.v1')"),null);
 await evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.disconnect();})()");
 return {status:'PASS',taskId,agentId:config.agentId,...(lifecycle?{lifecycle}:{}),...(results?{results}:{}),...(synchronization?{synchronization}:{}),checkpoints:['Actual Chrome CORS/native fetch and distinct interaction capability','Persisted binding to existing resident; backend eligibility verified','Double submit creates saved-not-started Task','Close/reopen preserves confirmed reference; unbound NPC has no Task section','Explicit disconnect clears protected form state']};
}
