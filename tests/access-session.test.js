import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccessSession,accessConfiguration} from '../dist/js/runtime/access/session.js';
import {accountOrigin} from '../dist/js/runtime/http-transport.js';
import {RuntimeApiClient} from '../dist/js/runtime/api-client.js';
import {InteractionApiClient} from '../dist/js/runtime/interaction/api-client.js';
import {CollaborationApiClient} from '../dist/js/runtime/collaboration/api-client.js';
const origin='https://city.example',token='a'.repeat(43),p={kind:'LOCAL_ACCOUNT',role:'operator',ownerId:'11111111-1111-4111-8111-111111111111',actorReference:'local-user:fixture'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture(handler){const calls=[];const session=new AccessSession({origin,mode:'local',fetchImpl:async(url,init)=>{calls.push({url,init});return handler?.(url,init)??json(url.endsWith('/login')?{accessToken:token,tokenType:'Bearer',expiresAt:new Date(Date.now()+3600000).toISOString()}:p);}});return {session,calls};}
test('account configuration rejects unknown fields, insecure remote origins and cross-origin credential destinations',()=>{
 assert.deepEqual(accessConfiguration({mode:'disabled'},'http://public.example'),{mode:'disabled'});
 for(const [value,url]of [[{mode:'local'},'http://public.example'],[{mode:'local',token},origin],[{mode:'password'},origin]])assert.throws(()=>accessConfiguration(value,url));
 assert.equal(accountOrigin(origin,origin),origin);assert.equal(accountOrigin('http://127.0.0.1:5173','http://127.0.0.1:5173'),'http://127.0.0.1:5173');
 for(const url of ['https://other.example','https://city.example/path','https://u:p@city.example','https://city.example/?token=x'])assert.throws(()=>accountOrigin(url,origin));
});
test('bootstrap without persisted credentials makes no protected request; login verifies /me before admitting clients',async()=>{
 const {session,calls}=fixture();session.bootstrap();assert.equal(session.getSnapshot().phase,'UNAUTHENTICATED');assert.equal(calls.length,0);assert.throws(()=>session.connect(()=>{}));
 await session.login({username:'operator',password:'synthetic password 1234'});assert.equal(session.getSnapshot().phase,'AUTHENTICATED');assert.equal(calls.length,2);assert.equal(calls[1].init.headers.Authorization,'Bearer '+token);
 assert.ok(!JSON.stringify(session.getSnapshot()).includes(token));assert.ok(!JSON.stringify(session).includes(token));
 session.connect((value)=>assert.equal(value,token));session.dispose();
});
test('protected transport strips caller credentials, forbids external destinations and expires globally only on 401',async()=>{
 let status=200;const {session,calls}=fixture(url=>url.includes('/agents')?json({},status):undefined);session.bootstrap();await session.login({username:'operator',password:'synthetic password 1234'});
 await session.fetch(origin+'/api/v1/agents',{headers:{Authorization:'Bearer attacker'},credentials:'include'});const options=calls.at(-1).init;assert.equal(options.headers.get('Authorization'),'Bearer '+token);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
 await assert.rejects(session.fetch('https://other.example/api/v1/agents'));await assert.rejects(session.fetch(origin+'/health'));
 status=403;assert.equal((await session.fetch(origin+'/api/v1/agents')).status,403);assert.equal(session.getSnapshot().phase,'AUTHENTICATED');
 status=401;await session.fetch(origin+'/api/v1/agents');assert.equal(session.getSnapshot().phase,'EXPIRED');await assert.rejects(session.fetch(origin+'/api/v1/agents'));session.dispose();
});
test('late authentication and protected responses cannot repopulate a logged-out session',async()=>{
 let resolve;const {session}=fixture(url=>url.endsWith('/me')?new Promise(r=>resolve=r):undefined);const login=session.login({username:'operator',password:'synthetic password 1234'});await new Promise(r=>setTimeout(r,0));session.remoteLogout();resolve(json(p));await login;assert.equal(session.getSnapshot().phase,'UNAUTHENTICATED');
 const f=fixture();await f.session.login({username:'operator',password:'synthetic password 1234'});f.session.remoteLogout();assert.equal(f.session.getSnapshot().principal,null);f.session.dispose();session.dispose();
});
test('logout failure explicitly reports unconfirmed revocation and clears access before request completes',async()=>{
 const {session}=fixture(url=>url.endsWith('/logout')?json({},503):undefined);await session.login({username:'operator',password:'synthetic password 1234'});const done=session.logout();assert.equal(session.getSnapshot().principal,null);await done;assert.match(session.getSnapshot().message,/not confirmed/);assert.throws(()=>session.connect(()=>{}));session.dispose();
});
test('network failure differs from invalid credentials and reauthentication resolves a fresh backend principal',async()=>{
 let fail=true;const {session}=fixture(url=>url.endsWith('/login')&&fail?Promise.reject(Error('sensitive-provider-error')):undefined);await session.login({username:'operator',password:'synthetic password 1234'});assert.equal(session.getSnapshot().phase,'ERROR');assert.ok(!session.getSnapshot().message.includes('sensitive'));fail=false;await session.login({username:'operator',password:'synthetic password 1234'});assert.equal(session.getSnapshot().phase,'AUTHENTICATED');session.dispose();
});
test('OIDC transport accepts only backend-confirmed mode; no password login or refresh request',async()=>{
 const calls=[];const session=new AccessSession({origin,mode:'oidc',fetchImpl:async(url)=>{calls.push(url);return json({...p,kind:'OIDC',role:'viewer'});}});await session.login({accessToken:'a'.repeat(40)+'.'+ 'b'.repeat(40)+'.'+'c'.repeat(40)});assert.equal(session.getSnapshot().principal.role,'viewer');await session.logout();assert.deepEqual(calls,[origin+'/api/v1/auth/me']);assert.match(session.getSnapshot().message,/Issuer token remains valid/);session.dispose();
});
test('all existing clients opt into same-origin account transport; old development restrictions stay intact',()=>{
 for(const Client of [RuntimeApiClient,InteractionApiClient,CollaborationApiClient]){
  assert.throws(()=>new Client({baseUrl:origin,pageOrigin:origin}));
  const client=new Client({baseUrl:origin,pageOrigin:origin,access:'account'});client.authorize('a'.repeat(40)+'.'+'b'.repeat(40)+'.'+'c'.repeat(40));client.clearCredential();
  assert.throws(()=>new Client({baseUrl:'https://other.example',pageOrigin:origin,access:'account'}));
 }
});

test('foreground revalidation clears protected access on denial and distinguishes network failure from expiry',async()=>{
 let unavailable=false,revoked=false;const {session}=fixture(url=>url.endsWith('/me')&&unavailable?Promise.reject(Error('offline')):url.endsWith('/me')&&revoked?json({},401):undefined);
 await session.login({username:'operator',password:'synthetic password 1234'});unavailable=true;await session.revalidate();assert.equal(session.getSnapshot().phase,'ERROR');assert.equal(session.getSnapshot().principal,null);
 unavailable=false;await session.login({username:'operator',password:'synthetic password 1234'});revoked=true;await session.revalidate();assert.equal(session.getSnapshot().phase,'EXPIRED');session.dispose();
});
test('backend mode mismatch cannot establish frontend access or disclose an unexpected principal',async()=>{
 const {session}=fixture(url=>url.endsWith('/me')?json({...p,kind:'OIDC'}):undefined);await session.login({username:'operator',password:'synthetic password 1234'});assert.equal(session.getSnapshot().principal,null);assert.equal(session.getSnapshot().phase,'ERROR');session.dispose();
});
