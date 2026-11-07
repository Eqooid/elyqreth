import assert from 'node:assert/strict';
/** Real native browser HTTP. CDP discards acknowledged responses after genuine backend commits. */
export async function verifyInteractionReliability({config,taskId,evaluate,until,command,waitEvent}){
 const pending=new Map();let sequence=0;
 const receive=message=>{if(message?.kind!=='interaction-reliability-result')return;const entry=pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.id);message.error?entry.reject(Error('Owned reliability control failed: '+entry.name)):entry.resolve(message.result);};process.on('message',receive);
 const control=(name,payload={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Reliability control deadline: '+name));},30000);pending.set(id,{resolve,reject,timer,name});process.send({kind:'interaction-reliability-command',id,name,payload});});
 const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent??''`);
 const status=()=>text('[data-execution-status]');
 const refresh=()=>evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');await r.refresh();})()");
 const readAgent=index=>evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');return r.getAgent(${JSON.stringify(config.agents[index])});})()`);
 const select=index=>evaluate(`document.querySelectorAll('[data-agent]')[${index}].click()`);
 const clickReady=(selector,label)=>until(()=>evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled||!button.getClientRects().length)return false;button.click();return true;})()`),label);
 const authorize=async()=>{await evaluate(`(()=>{document.querySelector('[data-connect]').click();const d=document.querySelector('dialog[open]');d.querySelector('[name=origin]').value=${JSON.stringify(config.apiOrigin)};d.querySelector('[name=credential]').value=${JSON.stringify(config.interactionToken)};d.querySelector('form').requestSubmit();})()`);};
 const save=async(instruction,fresh=true)=>{if(fresh)await clickReady('[data-new]','New Task was not available');await until(()=>evaluate("!document.querySelector('[data-submit]').disabled"),'Task form unavailable');await evaluate(`(()=>{const t=document.getElementById('agent-task-instruction');t.value=${JSON.stringify(instruction)};t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit();})()`);};
 const start=async(mode)=>{await control('mode',{mode});await clickReady('[data-start]','Start was not eligible');let entered;try{entered=await control('entered');}catch(error){throw Error(error.message+': '+await status()+' / '+await text('[data-execution-feedback]')+' / '+await text('[data-reference]')+' / '+await text('#agent-task-feedback'));}await evaluate("document.querySelector('[data-refresh-execution]').click()");return entered;};
 const checkpoints=[];
 try{
  // This exact response-stage pause happens only after the real Task creation transaction returned.
  await command('Fetch.enable',{patterns:[{urlPattern:config.apiOrigin+'/api/v1/tasks',requestStage:'Response'}]});
  const pausedCreate=waitEvent('Fetch.requestPaused',p=>p.request.method==='POST');
  await save('T09 recovery canonical result');const paused=await pausedCreate;assert.equal(paused.responseStatusCode,201);
  const intent=JSON.parse(paused.request.postData),committed=await control('created',{key:intent.idempotencyKey});
  await command('Fetch.failRequest',{requestId:paused.requestId,errorReason:'ConnectionReset'});await command('Fetch.disable');
  await until(async()=>/unresolved/.test(await text('#agent-task-feedback')),'Lost Create was falsely confirmed or rejected');
  await command('Page.reload');await until(()=>evaluate("document.getElementById('city-state').textContent.includes('agents')"),'Reload did not initialize city');
  await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.connect({baseUrl:${JSON.stringify(config.apiOrigin)},pageOrigin:location.origin,token:${JSON.stringify(config.cityToken)}});await r.refresh();document.querySelector('[data-agent]').click();})()`);await authorize();
  await until(async()=>(await text('[data-reference]')).includes(committed.taskId),'Lost Create reload did not recover exact Task');
  await control('verifyCreate',{taskId:committed.taskId});checkpoints.push('CDP lost Create response after real commit; reload, explicit reauthorization and exact-key GET restore one Task');
  await command('Fetch.enable',{patterns:[{urlPattern:config.apiOrigin+'/api/v1/tasks/*/execute',requestStage:'Response'}]});const pausedStart=waitEvent('Fetch.requestPaused',p=>p.request.method==='POST');
  const success=await start('success');await until(async()=>(await status()).includes('Execution status: RUNNING'),'Running lifecycle not visible');await refresh();assert.equal((await readAgent(0)).currentExecution.id,success.executionId);
  await control('release');const completed=await pausedStart;assert.equal(completed.responseStatusCode,200);await command('Fetch.failRequest',{requestId:completed.requestId,errorReason:'ConnectionReset'});await command('Fetch.disable');
  await until(async()=>(await status()).includes('Execution status: SUCCEEDED'),'Lost Start response failed authoritative reconciliation');
  await evaluate("document.querySelector('[data-result-section]').open=true;document.querySelector('[data-history-section]').open=true");
  await until(async()=>{try{return JSON.parse(await text('[data-result-content]')).wordCount===4;}catch{return false;}},'Persisted canonical result missing');
  await until(()=>evaluate("document.querySelectorAll('[data-history-list] button').length===1"),'History did not contain exactly one successful attempt');
  await control('verifyTerminal',{executionId:success.executionId,status:'SUCCEEDED'});checkpoints.push('Real rule-based Start/RUNNING, discarded committed success acknowledgement, canonical result/history and no redispatch');
  const beforeOffline=await text('[data-execution-reference]');await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await refresh();await until(()=>evaluate("document.querySelector('[data-freshness]').textContent.includes('stale')"),'Browser offline was not marked stale');assert.equal(await text('[data-execution-reference]'),beforeOffline);
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await refresh();await until(()=>evaluate("document.querySelector('[data-freshness]').textContent.includes('fresh')"),'Browser reconnection did not restore synchronized observation');checkpoints.push('Actual Chrome offline/online transport failure preserves references and reconciles through shared synchronization');
  await save('T09 controlled failure');const failed=await start('failure');await control('release');
  try{await until(async()=>(await status()).includes('Execution status: FAILED'),'Actual coordinator failure not displayed');}catch(error){throw Error(error.message+': '+await status()+' / '+await text('[data-execution-feedback]')+' / '+await text('[data-reference]'));}await control('verifyTerminal',{executionId:failed.executionId,status:'FAILED'});
  await evaluate("document.querySelector('[data-result-refresh]').click()");await until(async()=>/Execution failed/.test(await text('[data-result-outcome]')),'Failure summary missing');assert.equal(await text('[data-result-content]'),'');
  await select(2);await save('T09 controlled deadline',false);const timed=await start('hold');await until(async()=>(await status()).includes('Execution status: TIMED_OUT'),'Native execution deadline not displayed');await control('verifyTerminal',{executionId:timed.executionId,status:'TIMED_OUT'});
  checkpoints.push('Genuine coordinator failure and native configured deadline; safe unavailable outputs, one terminal event per attempt');
  await select(1);await save('T09 hard crash continuity',false);const crashed=await start('hold');await until(async()=>(await status()).includes('Execution status: RUNNING'),'Crash target was not RUNNING');await refresh();assert.equal((await readAgent(1)).currentExecution.id,crashed.executionId);
  await control('crash');await refresh();await until(()=>evaluate("document.querySelector('[data-freshness]').textContent.includes('stale')"),'Hard crash did not mark synchronization stale');
  assert.ok((await text('[data-execution-reference]')).includes(crashed.executionId));await control('restart');await refresh();
  await until(async()=>(await readAgent(1))?.activityStatus==='UNKNOWN','Expired crash lease was falsely treated as live',30000);
  assert.equal((await readAgent(1)).statusReason,'LEASE_UNVERIFIED');assert.ok((await text('[data-execution-reference]')).includes(crashed.executionId));assert.equal(await evaluate("document.querySelector('[data-start]').disabled"),true);
  await control('verifyCrash',{executionId:crashed.executionId});checkpoints.push('Actual runtime-process hard kill; same-port restart, persisted identity, expired-lease UNKNOWN, no fabricated success or retry');
  await control('rotate');await evaluate("document.querySelector('[data-check]').click()");await until(()=>evaluate("!document.querySelector('[data-connect]').hidden"),'Revoked credential did not disconnect interaction state');
  assert.equal(await text('[data-reference]'),'');assert.equal(await text('[data-result-content]'),'');assert.equal(await evaluate("sessionStorage.getItem('elyqreth.interaction.locators.v1')"),null);
  config={...config,...await control('configuration')};await authorize();await until(()=>evaluate("document.querySelector('[data-connect]').hidden"),'Reauthorization with rotated credential failed');
  await control('unbind');await refresh();await until(()=>evaluate("document.querySelector('.agent-task-section').hidden"),'Binding removal retained mutation UI');await select(3);assert.equal(await evaluate("document.querySelector('.agent-task-section').hidden"),true);
  const verified=await control('verifyAll');assert.equal(verified.tasks,5);assert.equal(verified.executions,4);assert.equal(await evaluate("JSON.parse(document.getElementById('city-state').textContent).agents.length"),4);checkpoints.push('Real capability revocation/401 cleanup, explicit reauthorization, removed binding and unbound NPC preservation');
  return {status:'PASS',initialTaskId:taskId,recoveredTaskId:committed.taskId,successExecutionId:success.executionId,failedExecutionId:failed.executionId,timedOutExecutionId:timed.executionId,crashedExecutionId:crashed.executionId,crashOutcome:'RUNNING persisted / UNKNOWN lease observation; no automatic recovery worker',verified,checkpoints};
 }finally{await command('Fetch.disable').catch(()=>{});await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}).catch(()=>{});process.off('message',receive);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Reliability fixture closed'));}pending.clear();}
}
