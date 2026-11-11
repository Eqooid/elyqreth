import assert from 'node:assert/strict';
import {verifyAccessPanel} from './access-panel-browser.mjs';
import {verifyTerrain} from './terrain-browser.mjs';
import {verifyEnvironment} from './environment-browser.mjs';
import {verifyDynamicEnvironment} from './environment-dynamic-browser.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createServer } from 'vite';
import { profileCity } from './phase3-browser-profile.mjs';
import { acceptBackendCity } from './phase3-acceptance-browser.mjs';
import {verifyTaskPanel,verifyLiveTaskPanel} from './task-panel-browser.mjs';
import {verifyCollaborationPanel,verifyLiveCollaborationPanel} from './collaboration-browser.mjs';
import {verifyInteractionHardening} from './interaction-hardening-browser.mjs';

// No application hooks or backend required. Use the city's existing diagnostic DOM.
const executable = process.env.BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
assert.ok(executable && existsSync(executable), 'Set BROWSER_PATH to an installed Chromium browser.');
const profile = mkdtempSync(join(tmpdir(), 'elyqreth-browser-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, socket, nextId = 0;
const pending = new Map(), errors = [], requests = [], checkpoints = [];
const acceptanceMode=process.env.ELYQRETH_CITY_E2E_BROWSER==='true',requestUrls=new Map();
const apiMethodCounts={};
const collaborationMode=process.env.ELYQRETH_COLLABORATION_E2E==='true';let collaborationAcceptance;
const interactionMode=process.env.ELYQRETH_TASK_PANEL_E2E==='true';let taskPanelAcceptance;
const reliabilityMode=process.env.ELYQRETH_INTERACTION_E2E==='true',eventWaiters=new Set();
function waitEvent(method,predicate=()=>true){const promise=new Promise((resolve,reject)=>{const entry={method,predicate,resolve,reject,timer:setTimeout(()=>{eventWaiters.delete(entry);reject(Error('CDP event deadline: '+method));},15000)};eventWaiters.add(entry);});void promise.catch(()=>{});return promise;}
let allowedApiOrigin,cityAcceptance;
const apiRequest=url=>allowedApiOrigin&&url?.startsWith(allowedApiOrigin+'/');
async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(100); }
  throw new Error(message);
}
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const state = () => evaluate("JSON.parse(document.getElementById('city-state').textContent || 'null')");
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
async function reloadPage() {
  const previousDocument = await evaluate('performance.timeOrigin');
  // Register before reloading: the old city DOM can still satisfy readiness
  // predicates until navigation commits. Wait for the new document to load.
  const loaded = waitEvent('Page.loadEventFired');
  await command('Page.reload');
  await loaded;
  assert.notEqual(await evaluate('performance.timeOrigin'), previousDocument, 'Reload retained the previous document');
}
try {
  let origin;
  if(process.env.BROWSER_BASE_URL){
    const url=new URL(process.env.BROWSER_BASE_URL);
    assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','Browser target must be a loopback HTTP origin');
    origin=url.origin;
  }else{
    server = await createServer({ configFile: resolve('vite.config.js'),
      server: { host: '127.0.0.1', port: 0, open: false } });
    await server.listen();
    origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-dev-shm-usage', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  const port = await until(() => {
    if (launchError) throw launchError;
    const file = join(profile, 'DevToolsActivePort');
    return existsSync(file) && Number(readFileSync(file, 'utf8').split('\n')[0]);
  }, 'Browser debugging endpoint did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    for(const entry of eventWaiters)if(value.method===entry.method&&entry.predicate(value.params)){clearTimeout(entry.timer);eventWaiters.delete(entry);entry.resolve(value.params);}
    if(reliabilityMode&&value.method==='Fetch.requestPaused'&&value.params.request.method==='OPTIONS')void command('Fetch.continueRequest',{requestId:value.params.requestId}).catch(()=>errors.push('Test preflight continuation failed'));
    if (value.id) {
      const item = pending.get(value.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(value.id);
      if (value.error) item.reject(new Error(value.error.message)); else item.resolve(value.result);
    } else if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
    else if (value.method === 'Network.loadingFailed' && !value.params.canceled) {if(!apiRequest(requestUrls.get(value.params.requestId)))errors.push(value.params.errorText);}
    else if (value.method === 'Network.responseReceived' && value.params.response.status >= 400) {if(!apiRequest(value.params.response.url)||!(reliabilityMode?[400,401,403,404,409,422,500,504]:interactionMode?[400,401,403,404,409,422]:[400,401,403,404]).includes(value.params.response.status))errors.push(value.params.response.url);}
    else if (value.method === 'Network.requestWillBeSent') {requests.push(value.params.request.url);requestUrls.set(value.params.requestId,value.params.request.url);if(reliabilityMode&&apiRequest(value.params.request.url)){const path=new URL(value.params.request.url).pathname.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,':id'),key=value.params.request.method+' '+path;apiMethodCounts[key]=(apiMethodCounts[key]??0)+1;}}
  });
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin });
  const first = await until(async () => { try { return await state(); } catch { return false; } }, 'City did not initialize');
  assert.equal(first.agents.length, 4); assert.equal(first.roads.surfaceComponents, 1);
  const animated = await until(async () => { const s = await state(); return s.time > first.time + 1 && s; }, 'Animation loop did not advance');
  assert.notEqual(animated.train.x, first.train.x); assert.ok(animated.citizens.length > 0);
  await until(async () => (await state()).waterFrame !== first.waterFrame, 'River animation did not advance');
  await until(async () => (await state()).agents.some((a, i) => a.x !== first.agents[i].x || a.y !== first.agents[i].y), 'NPC movement did not advance');
  assert.equal(await evaluate("document.querySelector('canvas').getContext('2d').getImageData(0,0,1440,1000).data.some(v=>v!==0)"), true);
  if (process.env.BROWSER_SCREENSHOT) {
    const capture = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.BROWSER_SCREENSHOT, Buffer.from(capture.data, 'base64'));
  }
  checkpoints.push('Canvas draws; city clock/environment, four agents and decorative citizens run without API');
  const interactionBoundary=await evaluate(`(async()=>{
   const {InteractionApiClient,createSubmissionIntent}=await import('/js/runtime/interaction/index.js');let calls=0;
   const client=new InteractionApiClient({baseUrl:location.origin,pageOrigin:location.origin,fetchImpl:async()=>{calls++;throw Error('Unexpected startup request');}});
   let code;try{await client.getAgent('00000000-0000-4000-8000-000000000001');}catch(error){code=error.code;}
   const intent=createSubmissionIntent('00000000-0000-4000-8000-000000000001',{instruction:'Browser contract fixture'});
   const result={calls,code,credential:client.hasCredential,serialized:JSON.stringify(client),frozen:Object.isFrozen(intent)&&Object.isFrozen(intent.input)};
   client.dispose();return result;
  })()`);
  assert.deepEqual(interactionBoundary,{calls:0,code:'AUTH_REQUIRED',credential:false,serialized:'{}',frozen:true});
  checkpoints.push('T03 interaction data client imports in the real browser without credentials, timers or startup API requests');
  if(collaborationMode){collaborationAcceptance=await verifyLiveCollaborationPanel({evaluate,until,command,permitApi:value=>{allowedApiOrigin=value;}});checkpoints.push('P5 T10 real browser / Nest / PostgreSQL collaboration inspection and recovery');}
  else if(interactionMode){
  taskPanelAcceptance=await verifyLiveTaskPanel({evaluate,until,command,waitEvent,permitApi:value=>{allowedApiOrigin=value;}});
    checkpoints.push('P4 T04 native browser and authorized Nest/PostgreSQL Task creation');
  }else if(acceptanceMode){
    cityAcceptance=await acceptBackendCity({command,evaluate,state,until,origin,permitApi:value=>{allowedApiOrigin=value;}});
    checkpoints.push('T10 real PostgreSQL / authorized HTTP / native browser fetch / genuine runtime / NPC inspection acceptance');
  }else{
  checkpoints.push(await verifyTerrain({evaluate}));
  checkpoints.push(await verifyEnvironment({evaluate}));
  if(process.env.ENVIRONMENT_DYNAMIC_DIR)checkpoints.push(await verifyDynamicEnvironment({evaluate}));
  const runtimeBoundary=await evaluate("(async()=>{const a=await import('/js/runtime/index.js'),b=await import('/js/runtime/index.js');return {shared:a.runtimeIntegration===b.runtimeIntegration,phase:a.runtimeIntegration.getSnapshot().phase,agents:Object.keys(a.runtimeIntegration.view.getSnapshot().activitiesByAgentId).length};})()");
  assert.equal(runtimeBoundary.shared,true);assert.equal(runtimeBoundary.phase,'DISCONNECTED');assert.equal(runtimeBoundary.agents,0);
  checkpoints.push('Shared runtime integration loads disabled and credential-free without city API requests');
  const npcBoundary=await evaluate("(async()=>{const a=await import('/js/app.js'),b=await import('/js/app.js');const v=a.npcRuntimeBindingView,s=v.getSnapshot();return {shared:v===b.npcRuntimeBindingView,disposed:s.disposed,linked:v.listLinked().length,slot:v.getByNpc('resident-slot-001').state,slots:Object.keys(s.byNpc).length};})()");
  assert.equal(npcBoundary.shared,true);assert.equal(npcBoundary.disposed,false);assert.equal(npcBoundary.linked,0);assert.equal(npcBoundary.slot,'UNBOUND');assert.equal(npcBoundary.slots,4);
  // Browser-only deterministic transport fixture. No backend writes or production fake events.
  await evaluate(`(async()=>{
   const {runtimeIntegration:r}=await import('/js/runtime/index.js');
   const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
   const observedAt=new Date().toISOString();
   let item={schemaVersion:1,agentId:uid(1),name:'Browser test Agent <safe>',agentType:'RULE_BASED',availability:'ACTIVE',agentVersion:1,
    npcId:'resident-slot-001',bindingId:uid(101),activityStatus:'IDLE',currentTask:null,currentExecution:null,activeExecutionCount:0,queuedTaskCount:0,createdTaskCount:0,
    recentOutcome:null,lastExecution:null,lastActivityAt:observedAt,observedAt,requiresAttention:false,statusReason:'NO_ACTIVE_WORK'};
   let mode='ok',population=null;const original=globalThis.fetch,ctx=document.querySelector('canvas').getContext('2d'),fill=ctx.fillText;
   const glyphs=new Set();ctx.fillText=function(text,...args){if(['>','=','+','!','~','?'].includes(text))glyphs.add(text);return fill.call(this,text,...args);};
   globalThis.fetch=async()=>{if(mode==='fail')throw new TypeError('Controlled offline test');if(mode==='unauthorized')return new Response('{}',{status:401});return new Response(JSON.stringify({schemaVersion:1,observedAt,items:mode==='empty'?[]:population??[item],nextCursor:null}),{headers:{'content-type':'application/json'}});};
   r.connect({baseUrl:location.origin,pageOrigin:location.origin,token:'T'.repeat(40)});globalThis.fetch=original;
   globalThis.__t06={glyphs,async set(status,refresh=true){population=null;mode=status==='stale'||status==='multi-offline'?'fail':status==='empty'?'empty':status==='unauthorized'?'unauthorized':'ok';
    item={...item,activityStatus:status==='running'?'RUNNING':status==='waiting'?'QUEUED':'IDLE',currentTask:status==='running'||status==='waiting'?{id:uid(20),status:status==='running'?'RUNNING':'QUEUED',version:1}:null,
     currentExecution:status==='running'?{id:uid(30),status:'RUNNING',version:1,attemptNumber:1}:null,activeExecutionCount:status==='running'?1:0,
     recentOutcome:['completed','failed'].includes(status)?{taskId:uid(20),executionId:uid(30),status:status.toUpperCase(),executionStatus:status==='completed'?'SUCCEEDED':'FAILED',finishedAt:observedAt}:null};
    if(status==='history')item={...item,activityStatus:'RUNNING',currentTask:{id:uid(20),status:'RUNNING',version:1},currentExecution:{id:uid(30),status:'RUNNING',version:1,attemptNumber:2},activeExecutionCount:1,
     lastExecution:{id:uid(30),taskId:uid(20),status:'RUNNING'},recentOutcome:{taskId:uid(41),executionId:uid(40),status:'COMPLETED',executionStatus:'SUCCEEDED',finishedAt:observedAt}};
    if(status.startsWith('multi')){
     const recovered=status==='multi-recovered';
     item={...item,activityStatus:recovered?'IDLE':'RUNNING',currentTask:recovered?null:{id:uid(20),status:'RUNNING',version:2},
      currentExecution:recovered?null:{id:uid(30),status:'RUNNING',version:2,attemptNumber:2},activeExecutionCount:recovered?0:1,
      recentOutcome:recovered?{taskId:uid(20),executionId:uid(30),status:'COMPLETED',executionStatus:'SUCCEEDED',finishedAt:observedAt}:null};
     const second={...item,agentId:uid(2),name:'Browser second Agent',npcId:'resident-slot-002',bindingId:uid(102),activityStatus:recovered?'RUNNING':'IDLE',
      currentTask:recovered?{id:uid(22),status:'RUNNING',version:1}:null,currentExecution:recovered?{id:uid(32),status:'RUNNING',version:1,attemptNumber:1}:null,activeExecutionCount:recovered?1:0,lastExecution:null,
      recentOutcome:status==='multi-failed'?{taskId:uid(22),executionId:uid(32),status:'FAILED',executionStatus:'FAILED',finishedAt:observedAt}:null};
     population=[item,second];
    }
    glyphs.clear();if(refresh)await r.refresh();},stop(){r.disconnect();ctx.fillText=fill;delete globalThis.__t06;}};
  })()`);
  await click('residents-toggle');
  await evaluate("document.querySelector('[data-agent]').click()");
  await until(()=>evaluate("document.getElementById('inspect-content').textContent.includes('Browser test Agent <safe>')"),'Bound NPC inspector did not show registered Agent');
  for(const [status,label,glyph] of [['running','Running (persisted state)','>'],['waiting','Waiting','='],['completed','Recently completed','+'],['failed','Last outcome failed','!'],['stale','Stale connection data','~'],['running','Running (persisted state)','>']]){
   await evaluate(`globalThis.__t06.set('${status}')`);
   await until(()=>evaluate(`document.getElementById('inspect-content').textContent.includes('${label}')`),'Inspector transition missing: '+status);
   await until(()=>evaluate(`globalThis.__t06.glyphs.has('${glyph}')`),'Canvas marker missing: '+status);
   if(status==='running'&&process.env.BROWSER_RUNTIME_SCREENSHOT){
    const capture=await command('Page.captureScreenshot',{format:'png'});
    writeFileSync(process.env.BROWSER_RUNTIME_SCREENSHOT,Buffer.from(capture.data,'base64'));
   }
  }
  assert.equal(await evaluate("document.getElementById('inspect-content').querySelector('safe')===null"),true);
  assert.equal(await evaluate("document.querySelector('.runtime-inspection').scrollWidth<=document.querySelector('.runtime-inspection').clientWidth"),true,'Runtime IDs must wrap inside the existing inspector');
  await evaluate("globalThis.__t06.set('history')");
  await until(()=>evaluate("document.querySelectorAll('[data-runtime-execution]').length===2"),'T07 reference list missing');
  await evaluate("document.querySelector('[data-runtime-details=references] summary').click();document.querySelector('[data-runtime-details=timeline] summary').click();document.querySelectorAll('[data-runtime-execution]')[1].focus();document.querySelectorAll('[data-runtime-execution]')[1].click()");
  await until(()=>evaluate("document.querySelector('[data-runtime-details=execution]').textContent.includes('Recorded execution succeeded')"),'T07 historical detail selection failed');
  assert.equal(await evaluate("document.querySelectorAll('[data-runtime-details=timeline] li').length"),1);
  await evaluate("globalThis.__t06.set('history')");await sleep(400);
  assert.equal(await evaluate("document.querySelector('[data-runtime-details=references]').open"),true);
  assert.equal(await evaluate("document.activeElement?.dataset.runtimeExecution?.endsWith('040')"),true);
  assert.equal(await evaluate("document.querySelectorAll('[data-runtime-details=timeline] li').length"),1);
  await evaluate("document.querySelectorAll('[data-agent]')[1].click()");
  assert.equal(await evaluate("!!document.querySelector('.runtime-inspection')"),false,'Unbound NPC retained Agent details');
  await evaluate("document.querySelectorAll('[data-agent]')[0].click()");
  await until(()=>evaluate("document.querySelector('[data-runtime-details=execution]').textContent.includes('Current execution reference')"),'T07 selection scope did not reset');
  await click('inspect-close');
  assert.equal(await evaluate("document.getElementById('inspect-content').textContent"),'','Clearing selection must erase hidden Agent details');
  await evaluate("document.querySelectorAll('[data-agent]')[0].click()");
  await until(()=>evaluate("!!document.querySelector('.runtime-inspection')"),'T07 reselect failed');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.querySelector('.runtime-inspection').scrollWidth<=document.querySelector('.runtime-inspection').clientWidth"),true,'T07 references overflow mobile inspector');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("globalThis.__t06.set('multi-running')");
  await until(()=>evaluate("document.querySelector('.runtime-inspection').textContent.includes('Running (persisted state)')"),'T08 Agent A did not start');
  await evaluate("globalThis.__t06.set('multi-failed')");
  assert.equal(await evaluate("document.querySelector('.runtime-inspection').textContent.includes('Browser second Agent')"),false,'Agent B contaminated selected Agent A');
  await evaluate("document.querySelectorAll('[data-agent]')[1].click()");
  await until(()=>evaluate("document.querySelector('.runtime-inspection').textContent.includes('Last outcome failed')"),'T08 Agent B failure missing');
  await evaluate("globalThis.__t06.set('multi-offline')");
  await until(()=>evaluate("document.querySelector('.runtime-inspection').textContent.includes('Stale connection data')"),'T08 outage was not stale');
  await evaluate("document.querySelectorAll('[data-agent]')[0].click();globalThis.__t06.set('multi-recovered',false)");
  await until(()=>evaluate("document.querySelector('.runtime-inspection')?.textContent.includes('Freshly synchronized')"),'T08 automatic reconciliation failed');
  await until(()=>evaluate("document.querySelector('.runtime-inspection')?.textContent.includes('COMPLETED')"),'T08 missed completion not reconciled');
  await evaluate("document.querySelectorAll('[data-agent]')[1].click()");
  await until(()=>evaluate("document.querySelector('.runtime-inspection')?.textContent.includes('Running (persisted state)')"),'T08 Agent B recovery missing');
  await evaluate("document.querySelectorAll('[data-agent]')[0].click()");
  await evaluate("globalThis.__t06.set('empty')");await evaluate("globalThis.__t06.set('empty')");
  await until(()=>evaluate("!document.querySelector('.runtime-inspection')"),'Removed binding retained inspector runtime data');
  await evaluate("globalThis.__t06.set('history')");
  await until(()=>evaluate("!!document.querySelector('.runtime-inspection')"),'T07 restore failed');
  checkpoints.push(await verifyTaskPanel({evaluate,until,command}));
  checkpoints.push(await verifyCollaborationPanel({evaluate,until,command}));
  if(process.env.BROWSER_HARDENING_PHASE4==='true'){
   const report=await verifyInteractionHardening({evaluate,until,command});
   if(process.env.BROWSER_HARDENING_REPORT)writeFileSync(process.env.BROWSER_HARDENING_REPORT,JSON.stringify(report,null,2)+'\n');
   checkpoints.push('Phase 4 T08 keyboard/AX and repeated-selection hardening checks');
  }
  await evaluate("globalThis.__t06.set('unauthorized')");
  await until(()=>evaluate("!document.querySelector('.runtime-inspection')"),'T07 authorization failure retained protected data');
  assert.equal(await evaluate("document.querySelector('.runtime-access-status')?.textContent.includes('Runtime authorization unavailable')"),true);
  assert.equal(await evaluate("document.querySelector('.agent-task-section').hidden&&document.querySelector('.agent-task-section [data-summary]').textContent===''"),true);
  await evaluate("globalThis.__t06.stop()");
  checkpoints.push('T06 mocked transport: real T04/T05 pipeline, selected NPC inspector, Canvas running/waiting/completed/failed/stale/recovery and binding removal');
  checkpoints.push('T07 projection-only inspection: current/historical selection, single outcome timeline, expansion/focus preservation, NPC switch isolation and authorization cleanup');
  checkpoints.push('T08 mocked multi-Agent outage: independent A/B states, selection during disconnection and automatic authoritative poll reconciliation');
  checkpoints.push('NPC runtime binding sidecar indexes four stable slots without creating NPCs or backend requests');
  }
  await click('zoom-in');
  const zoomed = await until(async () => { const s = await state(); return s.camera.zoom > first.camera.zoom && s; }, 'Zoom control failed');
  await click('cafe-focus');
  await until(async () => { const s = await state(); return s.camera.x !== zoomed.camera.x; }, 'Camera focus failed');
  await click('recenter');
  await click('help-toggle'); assert.equal(await evaluate("document.getElementById('help-dialog').open"), true); await click('help-close');
  await click('debug-toggle'); assert.equal(await evaluate("document.getElementById('developer').hidden"), false); await click('debug-close');
  checkpoints.push('Camera zoom/focus/recenter and help/developer panels');
  await evaluate("document.getElementById('task-form').requestSubmit()");
  await until(async () => (await state()).mission.phase !== 'idle', 'Local demo mission did not start');
  await click('pause');
  await sleep(350); const paused = await state(); await sleep(450); assert.equal((await state()).time, paused.time);
  await click('pause');
  await until(async () => (await state()).time > paused.time, 'Resume failed');
  await click('reset'); await until(async () => (await state()).mission.phase === 'idle', 'Reset failed');
  checkpoints.push('Existing simulated mission start, pause, resume and reset');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await reloadPage();
  await until(async () => { try { return (await state())?.agents.length === 4; } catch { return false; } }, 'Mobile city did not initialize');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  checkpoints.push('Mobile reload and viewport');
  let phase3Profile;
  if(process.env.BROWSER_PROFILE_PHASE3==='true'){
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await reloadPage();
    await until(async()=>{try{return (await state())?.agents.length===4;}catch{return false;}},'Profiling city did not initialize');
    phase3Profile=await profileCity({command,evaluate,state});
    checkpoints.push('T09 measured frame/heap/DOM samples and 300 integration mount/dispose cycles');
  }
  checkpoints.push(await verifyAccessPanel({evaluate,until,command}));
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(origin) || apiRequest(url) || url.startsWith('data:')), 'City requested an unexpected external resource');
  if(!acceptanceMode&&!interactionMode&&!collaborationMode)assert.ok(!requests.some(url => /\/api\/|\/health(?:$|\?)/.test(url)), 'Decorative city must not need the backend');
  console.log(JSON.stringify({ status: 'PASS', browser: (await command('Browser.getVersion')).product,
    checkpoints, resourceRequests: requests.length, exceptions: errors.length,phase3Profile,cityAcceptance,taskPanelAcceptance,collaborationAcceptance,apiRequests:reliabilityMode?apiMethodCounts:undefined,
    limitations: 'Smoke checks only; no visual-diff baseline, FPS threshold, complete gesture or long-duration browser test.' }, null, 2));
} catch(error){
  if((acceptanceMode||interactionMode)&&process.env.CITY_ACCEPTANCE_SCREENSHOT&&socket?.readyState===WebSocket.OPEN){try{const capture=await command('Page.captureScreenshot',{format:'png'});writeFileSync(process.env.CITY_ACCEPTANCE_SCREENSHOT,Buffer.from(capture.data,'base64'));}catch{/* Preserve original failure. */}}
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command('Browser.close'); } catch { /* Process cleanup below. */ } }
  socket?.close();
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser smoke closed')); }
  for(const entry of eventWaiters){clearTimeout(entry.timer);entry.reject(Error('Browser smoke closed'));}eventWaiters.clear();
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(3000)]);
    if (browser.exitCode === null) browser.kill();
  }
  await server?.close();
  assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith('elyqreth-browser-'));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
