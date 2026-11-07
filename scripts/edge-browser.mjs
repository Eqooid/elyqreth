import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';

export async function verifyEdgeBrowser({origin,password,folder,ca,edge,docker,restart,expireSessions}){
 const executable=process.env.BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
 assert.ok(executable,'Install Chromium or set BROWSER_PATH for T06 browser acceptance');
 const profile=join(folder,'edge-browser-profile');mkdirSync(profile);
 const pin=createHash('sha256').update(new X509Certificate(ca).publicKey.export({type:'spki',format:'der'})).digest('base64');
 const browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-dev-shm-usage','--no-proxy-server','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--host-resolver-rules=MAP city.example.invalid 127.0.0.1','--ignore-certificate-errors-spki-list='+pin,'--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const until=async(fn,message)=>{for(let i=0;i<160;i++){try{const result=await fn();if(result)return result;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(message);};
 let ws,next=0;const pending=new Map(),exceptions=[],csp=[],responses=[];
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('T06 browser command deadline'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!value.exceptionDetails,'Browser evaluation failed');return value.result.value;};
 try{
  const port=await until(()=>{const p=join(profile,'DevToolsActivePort');return existsSync(p)&&Number(readFileSync(p,'utf8').split('\n')[0]);},'Chromium did not start');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error('T06 CDP error')):p.resolve(v.result);}else if(v.method==='Runtime.exceptionThrown')exceptions.push(v.params.exceptionDetails.text);else if(v.method==='Log.entryAdded'&&v.params.entry.source==='security')csp.push(v.params.entry.text);else if(v.method==='Network.responseReceived')responses.push({path:new URL(v.params.response.url).pathname,status:v.params.response.status});});
  await command('Runtime.enable');await command('Page.enable');await command('Log.enable');await command('Network.enable');await command('Page.navigate',{url:origin});
  await until(()=>evaluate("document.getElementById('access-toggle')?.textContent==='Sign in'&&JSON.parse(document.getElementById('city-state').textContent||'null')"),'HTTPS city/access bootstrap failed');
  assert.ok(await evaluate("document.getElementById('scene').toDataURL().length>1000"));
  assert.equal(responses.filter(r=>r.path.startsWith('/api/v1/')).length,0,'Anonymous page requested protected data');
  await evaluate("document.getElementById('access-toggle').click()");
  await evaluate(`(()=>{const f=document.querySelector('#access-dialog form');f.elements.username.value='operator';f.elements.password.value=${JSON.stringify(password)};f.requestSubmit();})()`);
  await until(()=>evaluate("document.getElementById('access-toggle').textContent==='Access: operator'"),'Browser login through edge failed');
  await until(()=>responses.some(r=>r.path==='/api/v1/cities/elyqreth/agents'&&r.status===200),'Protected runtime polling did not start');
  await evaluate("document.querySelector('#access-dialog [data-access-close]').click();document.getElementById('residents-toggle').click();document.getElementById('zoom-in').click();document.getElementById('zoom-out').click()");
  const before=responses.filter(r=>r.path==='/api/v1/auth/me').length;
  await restart();
  await evaluate("globalThis.dispatchEvent(new Event('online'))");
  await until(()=>responses.filter(r=>r.path==='/api/v1/auth/me'&&r.status===200).length>before,'Session did not revalidate after edge restart');
  await expireSessions();
  await evaluate("globalThis.dispatchEvent(new Event('online'))");
  await until(()=>evaluate("document.getElementById('access-toggle').textContent==='Sign in again'"),'Expired session remained authenticated through edge');
  await evaluate("document.getElementById('access-toggle').click()");
  await evaluate(`(()=>{const f=document.querySelector('#access-dialog form');f.elements.username.value='operator';f.elements.password.value=${JSON.stringify(password)};f.requestSubmit();})()`);
  await until(()=>evaluate("document.getElementById('access-toggle').textContent==='Access: operator'"),'Browser reauthentication failed');
  await evaluate("document.querySelector('#access-dialog [data-access-logout]').click()");
  await until(()=>evaluate("document.getElementById('access-toggle').textContent==='Sign in'"),'Browser logout failed');
  assert.equal(await evaluate("document.querySelector('#access-dialog [name=password]').value"),'');
  assert.equal(await evaluate('localStorage.length+sessionStorage.length'),0,'Credential/account state persisted in browser storage');
  assert.equal(exceptions.length,0,'City/browser exception during TLS edge verification');assert.equal(csp.length,0,'Security policy blocked required city functionality');
 }finally{
  try{if(ws?.readyState===WebSocket.OPEN)await command('Browser.close');}catch{}ws?.close();for(const p of pending.values())clearTimeout(p.timer);
  if(browser.exitCode===null){await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(browser.exitCode===null)browser.kill();}
 }
}
