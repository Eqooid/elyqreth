import assert from 'node:assert/strict';
/** Real DOM session controls with deterministic HTTP fixtures; existing city/panels remain mounted. */
export async function verifyAccessPanel({evaluate,until,command}){
 // The real page resolves its disabled public configuration asynchronously. Await disposal before mounting this isolated fixture.
 await until(()=>evaluate("!document.getElementById('access-toggle')&&!document.getElementById('access-dialog')"),'Default-disabled page access bootstrap did not settle');
 await evaluate(`(async()=>{
  const {createAccessPanel}=await import('/js/access-panel.js');
  const host=document.createElement('div');host.id='auth-test-host';document.body.append(host);
  const state=globalThis.__accessTest={clears:0,connects:0,status:200,late:null,actor:'user-a',counts:[],protectedFetch:null};
  const token='S'.repeat(43),owner='11111111-1111-4111-8111-111111111111';
  const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
  const fetchImpl=async(url,options)=>{state.counts.push(String(url));if(String(url).endsWith('access-config.json'))return response({mode:'local'});if(String(url).endsWith('/login'))return response({accessToken:token,tokenType:'Bearer',expiresAt:new Date(Date.now()+3600000).toISOString()});if(String(url).endsWith('/me'))return response({kind:'LOCAL_ACCOUNT',role:'operator',ownerId:owner,actorReference:state.actor});if(String(url).endsWith('/logout'))return response({});if(String(url).includes('/agents')){if(state.late)return new Promise(resolve=>{state.finish=()=>resolve(response({secret:'old-user'}));});return response({},state.status);}throw Error('Unexpected test path');};
  const panel={setAccountMode(){},disconnect(){state.clears++;},connectAccount(){state.connects++;}};
  state.panel=await createAccessPanel({host,origin:location.origin,fetchImpl,runtime:{connect({fetchImpl}){state.protectedFetch=fetchImpl;},disconnect(){state.clears++;}},taskPanel:panel,collaborationPanel:panel,clearSelection(){state.clears++;}});
  document.getElementById('access-toggle').click();
 })()`);
 assert.equal(await evaluate("globalThis.__accessTest.counts.length"),1);
 await evaluate("document.querySelector('#access-dialog [name=username]').value='operator';document.querySelector('#access-dialog [name=password]').value='synthetic-password-12345';document.querySelector('#access-dialog form').requestSubmit()");
 await until(()=>evaluate("document.getElementById('access-toggle').textContent.includes('operator')"),'Local login did not resolve backend principal');
 assert.equal(await evaluate("document.querySelector('#access-dialog [name=password]').value"),'');
 assert.equal(await evaluate('globalThis.__accessTest.connects'),2);
 await evaluate("globalThis.__accessTest.status=403;globalThis.__accessTest.protectedFetch(location.origin+'/api/v1/agents')");
 assert.equal(await evaluate("document.getElementById('access-toggle').textContent"),'Access: operator');
 await evaluate("document.querySelector('#access-dialog [data-access-recheck]').click()");
 await until(()=>evaluate('globalThis.__accessTest.connects===4'),'Explicit access recheck did not refresh protected scopes');
 await evaluate("globalThis.__accessTest.status=401;globalThis.__accessTest.protectedFetch(location.origin+'/api/v1/agents')");
 assert.equal(await evaluate("document.getElementById('access-toggle').textContent"),'Sign in again');
 assert.match(await evaluate("document.querySelector('#access-dialog [data-access-status]').textContent"),/expired/);
 await evaluate("globalThis.__accessTest.status=200;document.querySelector('#access-dialog [name=password]').value='synthetic-password-12345';document.querySelector('#access-dialog form').requestSubmit()");
 await until(()=>evaluate('globalThis.__accessTest.connects===6'),'Reauthentication did not connect once');
 await evaluate("globalThis.__accessTest.late=true;globalThis.__accessTest.pending=globalThis.__accessTest.protectedFetch(location.origin+'/api/v1/agents').then(()=>false,()=>true);document.querySelector('#access-dialog [data-access-logout]').click()");
 await evaluate('globalThis.__accessTest.finish()');assert.equal(await evaluate('globalThis.__accessTest.pending'),true);
 assert.equal(await evaluate("document.getElementById('access-toggle').textContent"),'Sign in');
 await evaluate("globalThis.__accessTest.actor='user-b';document.querySelector('#access-dialog [name=password]').value='synthetic-password-12345';document.querySelector('#access-dialog form').requestSubmit()");
 await until(()=>evaluate('globalThis.__accessTest.connects===8'),'Second principal did not connect freshly');
 await evaluate("(()=>{const channel=new BroadcastChannel('elyqreth.access.logout.v1');channel.postMessage({type:'logout'});setTimeout(()=>channel.close(),100);})()");
 await until(()=>evaluate("document.getElementById('access-toggle').textContent==='Sign in'"),'Cross-tab logout retained authenticated UI');
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await until(()=>evaluate("!document.getElementById('access-dialog').open"),'Escape did not dismiss access dialog');
 assert.equal(await evaluate("document.getElementById('access-dialog').open"),false);
 assert.equal(await evaluate("document.activeElement.id"),'access-toggle');
 await evaluate('globalThis.__accessTest.panel.dispose();document.getElementById("auth-test-host").remove();delete globalThis.__accessTest');
 await evaluate(`(async()=>{
  const {createAccessPanel}=await import('/js/access-panel.js');const host=document.createElement('div');host.id='oidc-test-host';document.body.append(host);
  const state=globalThis.__oidcAccess={calls:[],connections:0};const panel={setAccountMode(){},disconnect(){},connectAccount(){state.connections++;}};
  state.panel=await createAccessPanel({host,origin:location.origin,runtime:{connect(){},disconnect(){}},taskPanel:panel,collaborationPanel:panel,clearSelection(){},fetchImpl:async url=>{state.calls.push(String(url));return new Response(JSON.stringify(String(url).endsWith('/access-config.json')?{mode:'oidc'}:{kind:'OIDC',role:'viewer',ownerId:'11111111-1111-4111-8111-111111111111',actorReference:'oidc:fixture'}),{headers:{'Content-Type':'application/json'}});}});
  document.getElementById('access-toggle').click();document.querySelector('#access-dialog [name=accessToken]').value='a'.repeat(40)+'.'+'b'.repeat(40)+'.'+'c'.repeat(40);document.querySelector('#access-dialog form').requestSubmit();
 })()`);
 await until(()=>evaluate('globalThis.__oidcAccess.connections===2'),'OIDC API-token entry did not resolve principal');
 assert.equal(await evaluate("document.querySelector('#access-dialog [data-local-fields]').hidden"),true);
 await evaluate("document.querySelector('#access-dialog [data-access-logout]').click()");
 assert.match(await evaluate("document.querySelector('#access-dialog [data-access-status]').textContent"),/Issuer token remains valid/);
 assert.equal(await evaluate("globalThis.__oidcAccess.calls.some(url=>url.endsWith('/login')||url.endsWith('/logout'))"),false);
 await evaluate('globalThis.__oidcAccess.panel.dispose();document.getElementById("oidc-test-host").remove();delete globalThis.__oidcAccess');
 return 'T04 local login, /me, 403 isolation, 401 expiry, cleanup, late-response rejection, reauthentication, cross-tab logout and OIDC token-only UI';
}
