import assert from 'node:assert/strict';
// Test-only private IPC: the browser receives a city-read credential only.
// Operator commands remain in the PostgreSQL test parent, never in city code.
export async function acceptBackendCity({command,evaluate,state,until,origin,permitApi}){
 assert.ok(process.send,'Acceptance requires the owned PostgreSQL test parent');
 const pending=new Map();let sequence=0;
 const receive=message=>{if(message?.kind!=='city-acceptance-result')return;const entry=pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.id);message.error?entry.reject(Error('Owned acceptance command failed: '+entry.name)):entry.resolve(message.result);};
 process.on('message',receive);
 const control=(name,payload={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Acceptance command timed out: '+name));},25000);pending.set(id,{resolve,reject,timer,name});process.send({kind:'city-acceptance-command',id,name,payload});});
 let config;
 const reconnect=async()=>{
  config=await control('configuration');const url=new URL(config.apiOrigin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');permitApi(url.origin);
  await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.connect(${JSON.stringify({baseUrl:config.apiOrigin,pageOrigin:origin,token:config.cityToken})});await r.refresh();})()`);
 };
 const refresh=()=>evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');await r.refresh();})()");
 const read=()=>evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');return r.getSnapshot();})()");
 const select=n=>evaluate(`document.querySelectorAll('[data-agent]')[${n}].click()`);
 const status=()=>evaluate("document.querySelector('.runtime-inspection')?.querySelector('dt')?.nextElementSibling?.textContent");
 const waitStatus=label=>until(async()=>await status()===label,'Recorded visual state missing: '+label,12000);
 const checkpoints=[];
 try{
  await reconnect();const initial=await read();assert.equal(Object.keys(initial.activitiesByAgentId).length,3);
  assert.equal((await state()).agents.length,4);await select(3);assert.equal(await evaluate("!!document.querySelector('.runtime-inspection')"),false);
  await select(0);await waitStatus('Idle');assert.equal(await evaluate('globalThis.__acceptanceXss'),undefined);
  assert.equal(await evaluate("document.querySelector('.runtime-inspection img')===null"),true);
  // Actual native cross-origin requests enforce guards: city-read never grants operator access.
  const denial=await evaluate(`(async()=>{const a=await fetch(${JSON.stringify(config.apiOrigin+'/api/v1/cities/elyqreth/agents')});const b=await fetch(${JSON.stringify(config.apiOrigin+'/api/v1/agents')},{headers:{Authorization:${JSON.stringify('Bearer '+config.cityToken)}}});return [a.status,b.status];})()`);
  assert.deepEqual(denial,[401,401]);checkpoints.push('Actual Chrome CORS/preflight, separate read credential and denied operator access');
  const queued=await control('queueA');await refresh();await waitStatus('Waiting');
  assert.equal((await read()).activitiesByAgentId[config.agents[0]].currentExecution.id,queued.executionId);
  await control('startA');await refresh();await waitStatus('Running (persisted state)');
  await control('startB');await refresh();const simultaneous=await read();
  for(const id of config.agents.slice(0,2))assert.equal(simultaneous.activitiesByAgentId[id].activityStatus,'RUNNING');
  await control('cancelB');await refresh();await select(1);await waitStatus('Last outcome cancelled');
  await select(0);await waitStatus('Running (persisted state)');checkpoints.push('Queued and simultaneous genuine coordinator work; B cancellation leaves A running');
  await control('completeA');await refresh();await waitStatus('Recently completed');
  assert.match(await evaluate("document.querySelector('[data-runtime-details=execution]').textContent"),/SUCCEEDED/);
  await refresh();await until(async()=>await status()==='Idle','Completion marker did not expire without replay',10000);
  checkpoints.push('Genuine rule-based result persisted; actual completion displayed, then expired to idle');
  await control('startFailureA');await refresh();await waitStatus('Running (persisted state)');
  await control('failA');await refresh();await waitStatus('Last outcome failed');
  await control('timeoutC');await refresh();await select(2);await waitStatus('Last outcome failed');
  assert.match(await evaluate("document.querySelector('.runtime-inspection').textContent"),/TIMED_OUT/);
  checkpoints.push('Controlled strategy failure and real execution deadline produce persisted FAILED/TIMED_OUT outcomes');
  await control('startRecoveryA');await refresh();await select(0);await waitStatus('Running (persisted state)');
  await command('Network.setBlockedURLs',{urls:[config.apiOrigin+'/*']});await refresh();await waitStatus('Stale connection data');
  await control('completeRecoveryA');await select(1);await waitStatus('Stale connection data');
  await command('Network.setBlockedURLs',{urls:[]});
  await until(async()=>(await read()).phase==='READY','Automatic authoritative recovery failed',12000);
  assert.equal((await read()).activitiesByAgentId[config.agents[0]].recentOutcome.status,'COMPLETED');
  await select(0);assert.match(await evaluate("document.querySelector('.runtime-inspection').textContent"),/SUCCEEDED/);
  checkpoints.push('Only API transport blocked; real backend finishes A while disconnected; shared polling recovers missed state');
  await control('restart');await refresh();
  await command('Page.reload');await until(async()=>{try{return (await state())?.agents.length===4;}catch{return false;}},'Reloaded city failed');
  await reconnect();await select(0);
  const bound=await evaluate("(async()=>{const {npcRuntimeBindingView:v}=await import('/js/app.js');return v.getByNpc('resident-slot-001').bindingId;})()");
  assert.equal(bound,config.bindings[0]);assert.equal((await state()).agents.length,4);
  checkpoints.push('Actual API restart and frontend reload retain persisted identities; explicit trusted reauthorization restores data');
  await control('rotateCredential');await refresh();
  await until(async()=>(await read()).phase==='AUTH_REQUIRED','Old credential was not revoked');
  assert.deepEqual(Object.keys((await read()).activitiesByAgentId),[]);
  await until(()=>evaluate("!document.querySelector('.runtime-inspection')"),'Revocation retained protected inspection data');
  await reconnect();await select(0);await control('removeA');await refresh();await refresh();
  await until(()=>evaluate("!document.querySelector('.runtime-inspection')"),'Confirmed binding removal retained protected inspection data');assert.equal((await state()).agents.length,4);
  const final=await control('verify');assert.equal(final.ruleResultPersisted,true);assert.equal(final.terminalEventsUnique,true);
  assert.equal(final.agentsPreserved,true);assert.equal(final.bindingRemoved,true);
  const privacy=await evaluate(`(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');const text=document.body.textContent+JSON.stringify(r.getSnapshot());return !text.includes(${JSON.stringify(config.cityToken)})&&!text.includes('acceptance-private-instruction')&&!text.includes('acceptance-private-context');})()`);
  assert.equal(privacy,true);await evaluate("(async()=>{const {runtimeIntegration:r}=await import('/js/runtime/index.js');r.disconnect();})()");
  checkpoints.push('Real credential rotation clears protected state; binding removal preserves Agent/history/NPC; no prompt or token in DOM/store');
  return {status:'PASS',checkpoints,persisted:final};
 }finally{
  await command('Network.setBlockedURLs',{urls:[]});process.removeListener('message',receive);
  for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Acceptance closed'));}pending.clear();
 }
}
