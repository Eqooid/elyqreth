import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {createServer} from 'node:net';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

// Extends the owned T05 production TLS/PG harness; never targets a supplied deployment.
export async function verifyEdge(c){
 const {docker,input,run,api,pg,apiImage,webImage,folder,env,label,id,settings,apiArgs,restrictions,password,agent,evidence,waitFor}=c;
 const prefix='elyqreth_t06_'+id,edgeImage=c.edgeImage??'elyqreth-t06-edge:verification',edge=prefix+'_edge',web=prefix+'_web';
 const nets=[],containers=[],volumes=[];let apiNet;
 const ownLabel='elyqreth.t05.run';
 const availablePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const tlsPort=await availablePort(),host='city.example.invalid',authority=host+':'+tlsPort,origin='https://'+authority;
 const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
 assert.ok(existsSync(openssl)||process.platform!=='win32','Install local OpenSSL for disposable TLS fixtures');
 await run(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host,'-keyout',join(folder,'edge.key'),'-out',join(folder,'edge.crt')],{env,windowsHide:true,timeout:30000});
 let ca=readFileSync(join(folder,'edge.crt'));
 const request=(path,{method='GET',headers={},body,plain=false,minVersion,maxVersion}={})=>new Promise((resolve,reject)=>{
  const req=(plain?http:https).request({hostname:'127.0.0.1',port:plain?httpPort:tlsPort,path,method,agent:false,headers:{Host:authority,...headers},...(plain?{}:{servername:host,ca,minVersion,maxVersion}),timeout:15000},res=>{let data='';res.on('data',b=>{data+=b;if(data.length>2*1024*1024)res.destroy(Error('Oversized test response'));});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));res.on('error',reject);});
  req.on('timeout',()=>req.destroy(Error('Edge request deadline')));req.on('error',reject);req.end(body);
 });
 let httpPort;
 async function restartEdge(){await docker('restart',edge);await waitFor(async()=>(await request('/health')).status===200,'Edge restart failed');}
 async function session(role='operator'){
  const r=await request('/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:role,password})});assert.equal(r.status,200);return JSON.parse(r.body).accessToken;
 }
 try{
  for(const suffix of ['api','web','ingress']){const name=prefix+'_'+suffix;await docker('network','create','--label',label,...(suffix==='ingress'?[]:['--internal']),name);nets.push(name);}
  apiNet=nets[0];
  await docker('stop','--time','40',api);await docker('rm',api);
  // Same single API, now using the actual test HTTPS origin; no overlapping native writer.
  await docker('run','-d',...apiArgs(api,{CORS_ORIGINS:origin}),apiImage);
  await waitFor(async()=>await docker('exec',api,'node','docker/api-health.cjs').then(()=>true),'API restart for edge origin failed');
  await docker('network','connect','--alias','api',apiNet,api);
  writeFileSync(join(folder,'edge-access.json'),JSON.stringify({mode:'local'}));containers.push(web);
  await docker('run','-d','--name',web,'--label',label,'--network',nets[1],'--network-alias','web',...restrictions,'--memory','128m','--cpus','0.5','--mount',`type=bind,src=${join(folder,'edge-access.json')},dst=/run/config/access-config.json,readonly`,webImage);
  const tls=prefix+'_tls';await docker('volume','create','--label',label,tls);volumes.push(tls);
  await docker('run','--rm','--label',label,'--network','none','--user','0','--mount',`type=bind,src=${folder},dst=/input,readonly`,'-v',tls+':/output','--entrypoint','sh',edgeImage,'-c','cp /input/edge.crt /output/tls_certificate; cp /input/edge.key /output/tls_private_key; chown 0:101 /output/*; chmod 0440 /output/*');
  containers.push(edge);
  await docker('create','--name',edge,'--label',label,'--network',nets[2],...restrictions,'--memory','128m','--cpus','0.5','-e','EDGE_HOST='+host,'-e','EDGE_HTTPS_PORT='+tlsPort,'-e','EDGE_HSTS=off','-p',`127.0.0.1:${tlsPort}:8443`,'-p','127.0.0.1::8080','-v',tls+':/run/secrets:ro',edgeImage);
  await docker('network','connect',apiNet,edge);await docker('network','connect',nets[1],edge);await docker('start',edge);
  const inspect=()=>docker('inspect',edge).then(x=>JSON.parse(x)[0]);
  await waitFor(async()=>{const info=await inspect();return info.State.Running&&info.NetworkSettings.Ports['8080/tcp']?.length;},'Edge listener missing: '+await docker('logs',edge));
  httpPort=Number((await inspect()).NetworkSettings.Ports['8080/tcp'][0].HostPort);
  await waitFor(async()=>(await request('/health')).status===200,'TLS edge did not become available');
  assert.equal(await docker('exec',edge,'id','-u'),'101');await docker('exec',edge,'nginx','-t','-c','/tmp/edge-nginx.conf');
  const redirect=await request('/js/app.js?version=2',{plain:true});assert.equal(redirect.status,308);assert.equal(redirect.headers.location,origin+'/js/app.js?version=2');
  assert.equal((await request('/',{plain:true,headers:{Host:'attacker.invalid','X-Forwarded-Host':host}})).status,404);
  await assert.rejects(request('/health',{minVersion:'TLSv1.1',maxVersion:'TLSv1.1'}));
  for(const version of ['TLSv1.2','TLSv1.3'])assert.equal((await request('/health',{minVersion:version,maxVersion:version})).status,200);
  assert.equal((await request('/',{headers:{Host:'attacker.invalid'}})).status,421);
  const page=await request('/');assert.equal(page.status,200);assert.ok(page.body.includes('id="scene"'));assert.equal(page.headers['strict-transport-security'],undefined);assert.equal(page.headers['x-frame-options'],'DENY');assert.ok(page.headers['content-security-policy'].includes("connect-src 'self'"));assert.equal(page.headers['x-content-type-options'],'nosniff');
  for(const path of ['/js/app.js?token=synthetic-request-marker','/js/runtime/access/session.js','/assets/characters.png','/access-config.json'])assert.equal((await request(path)).status,200);
  const directory=await request('/assets');assert.equal(directory.status,301);assert.equal(directory.headers.location,'/assets/');
  for(const path of ['/ready','/ready/','/api/v1/ready','/metrics','/admin','/webhooks','/api/v1/external-events','/.env','/api/v1/auth/internal'])assert.equal((await request(path)).status,404,path);
  assert.equal((await request('/api/v1/agents',{headers:{Upgrade:'websocket',Connection:'Upgrade'}})).status,400);
  assert.equal((await request('/api/v1/agents')).status,401);
  assert.equal((await request('/api/v1/agents',{headers:{Authorization:'Bearer '+'a'.repeat(16384)}})).status,401);
  assert.ok([400,431].includes((await request('/api/v1/agents',{headers:{Authorization:'Bearer '+'a'.repeat(21000)}})).status));
  const rejectedPreflight=await request('/api/v1/agents',{method:'OPTIONS',headers:{Origin:'https://unapproved.invalid','Access-Control-Request-Method':'GET'}});assert.ok(rejectedPreflight.status>=400);assert.equal(rejectedPreflight.headers['access-control-allow-origin'],undefined);
  const token=await session(),auth={Authorization:'Bearer '+token,Origin:origin};
  assert.equal((await request('/api/v1/auth/me',{headers:auth})).status,200);
  assert.equal((await request('/api/v1/auth/me?token=forbidden',{headers:auth})).status,400);
  const badOrigin=await request('/api/v1/auth/me',{headers:{...auth,Origin:'https://unapproved.invalid'}});assert.equal(badOrigin.status,403);assert.equal(badOrigin.headers['access-control-allow-origin'],undefined);
  const preflight=await request('/api/v1/agents',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});assert.equal(preflight.status,204);assert.equal(preflight.headers['access-control-allow-origin'],origin);assert.equal(preflight.headers['access-control-allow-credentials'],undefined);
  for(const path of ['/api/v1/agents?limit=1','/api/v1/collaboration-activity?limit=1'])assert.equal((await request(path,{headers:auth})).status,200);
  assert.equal((await request('/api/v1/agents?limit=100000',{headers:auth})).status,400);
  assert.equal((await request('/api/v1/tasks',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'x'.repeat(65537)})).status,413);
  const taskResponse=await request('/api/v1/tasks',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({agentId:agent,input:{instruction:'Edge native test'},idempotencyKey:randomUUID()})});assert.equal(taskResponse.status,201);const task=JSON.parse(taskResponse.body);
  const executed=await request('/api/v1/tasks/'+task.id+'/execute',{method:'POST',headers:{...auth,'Content-Type':'application/json','If-Match':'"'+task.version+'"'},body:'{}'});assert.equal(executed.status,200);assert.equal(JSON.parse(executed.body).execution.status,'SUCCEEDED');
  const viewer=await input(['exec','-i',api,'node','apps/api/dist/auth/local-account-command.js','create'],JSON.stringify({username:'viewer',password,role:'viewer'}));assert.ok(viewer);
  const viewerToken=await session('viewer');assert.equal((await request('/api/v1/tasks',{method:'POST',headers:{Authorization:'Bearer '+viewerToken,'Content-Type':'application/json',Origin:origin},body:'{}'})).status,403);
  await request('/api/v1/auth/logout',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{}'});assert.equal((await request('/api/v1/auth/me',{headers:auth})).status,401);
  const fresh=await session();assert.equal((await request('/api/v1/auth/me',{headers:{Authorization:'Bearer '+fresh}})).status,200);
  await restartEdge();assert.equal((await request('/api/v1/agents?limit=1',{headers:{Authorization:'Bearer '+fresh}})).status,200);
  evidence.checks.push('T06 verified TLS1.2/1.3, HTTP redirect/canonical host, static assets/CSP, actual bearer login/me/401/403/logout/reauth, native execution, polling after edge restart, CORS, body/page bounds and internal route rejection');
  for(const name of [api,web,pg]){const info=JSON.parse(await docker('inspect',name))[0];assert.ok(!Object.values(info.NetworkSettings.Ports??{}).some(Boolean),'Internal container published a port');}
  const dbIP=Object.values(JSON.parse(await docker('inspect',pg))[0].NetworkSettings.Networks)[0].IPAddress;
  await assert.rejects(docker('exec',edge,'nc','-z','-w','2',dbIP,'5432'));
  await assert.rejects(docker('exec',web,'nc','-z','-w','2',dbIP,'5432'));
  await assert.rejects(docker('exec',web,'wget','-T','2','-q','-O','-',`http://${api}:3001/health`));
  assert.equal(await docker('exec',edge,'wget','-q','-O','-',`http://api:3001/ready`).then(()=>true,()=>false),false);
  evidence.checks.push('T06 only edge publishes loopback test ports; edge/web cannot reach DB; web cannot directly reach API; readiness remains namespace-only');
  // Observe exactly what the edge forwards, using a test-only echo peer on its API network.
  await docker('network','disconnect',apiNet,api);const echo=prefix+'_echo';containers.push(echo);
  await docker('run','-d','--name',echo,'--label',label,'--network',apiNet,'--network-alias','api',...restrictions,apiImage,'node','-e',"require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');if(q.url==='/api/v1/tasks/authoritative'){s.statusCode=503;s.end(JSON.stringify({code:'UNAVAILABLE',message:'safe-authoritative-error'}));return;}s.end(JSON.stringify({url:q.url,method:q.method,headers:q.headers}));}).listen(3001,'0.0.0.0')");
  await restartEdge();
  const forwarded=JSON.parse((await request('/api/v1/agents?limit=1',{headers:{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'http','X-Forwarded-Host':'attacker.invalid',Forwarded:'for=127.0.0.1;proto=http','X-Request-Id':'spoofed','X-Owner-Id':'spoofed'}})).body);
  assert.equal(forwarded.url,'/api/v1/agents?limit=1');assert.equal(forwarded.headers['x-forwarded-proto'],'https');assert.equal(forwarded.headers['x-forwarded-host'],authority);assert.notEqual(forwarded.headers['x-forwarded-for'],'127.0.0.1');assert.equal(forwarded.headers.forwarded,undefined);assert.equal(forwarded.headers['x-owner-id'],undefined);assert.notEqual(forwarded.headers['x-request-id'],'spoofed');
  const authoritative=await request('/api/v1/tasks/authoritative');assert.equal(authoritative.status,503);assert.deepEqual(JSON.parse(authoritative.body),{code:'UNAVAILABLE',message:'safe-authoritative-error'});
  await docker('stop','--time','10',echo);assert.equal((await request('/api/v1/agents')).status,503);
  await docker('network','disconnect',apiNet,echo);await docker('network','connect','--alias','api',apiNet,api);await restartEdge();
  if(process.env.ELYQRETH_EDGE_BROWSER!=='false'){const {verifyEdgeBrowser}=await import('./edge-browser.mjs');await verifyEdgeBrowser({origin,password,folder,ca,run,edge,docker,restart:restartEdge,expireSessions:()=>input(['exec','-i',pg,'psql','-v','ON_ERROR_STOP=1','-U','elyqreth_bootstrap','-d','elyqreth'],"UPDATE auth_sessions SET expires_at=now()-interval '1 second';")});evidence.checks.push('T06 real Chromium HTTPS CSP/city/login/session/polling/reconnect/logout regression');}
  // Certificate renewal/recreation uses only protected owned test material.
  await run(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host,'-keyout',join(folder,'renewed.key'),'-out',join(folder,'renewed.crt')],{env,windowsHide:true,timeout:30000});
  const prepare=script=>docker('run','--rm','--label',label,'--network','none','--user','0','--mount',`type=bind,src=${folder},dst=/input,readonly`,'-v',tls+':/output','--entrypoint','sh',edgeImage,'-c',script);
  await prepare('cp /input/renewed.crt /output/tls_certificate; chmod 0440 /output/tls_certificate');
  await assert.rejects(docker('exec',edge,'nginx','-t','-c','/tmp/edge-nginx.conf'));
  assert.equal((await request('/health')).status,200,'Invalid proposed pair must not replace live TLS');
  await prepare('cp /input/renewed.key /output/tls_private_key; chown 0:101 /output/*; chmod 0440 /output/*');
  await docker('exec',edge,'nginx','-t','-c','/tmp/edge-nginx.conf');await docker('exec',edge,'nginx','-s','reload','-c','/tmp/edge-nginx.conf');
  ca=readFileSync(join(folder,'renewed.crt'));await waitFor(async()=>(await request('/health')).status===200,'TLS renewal failed');
  for(const [suffix,hostValue] of [['invalid_host','city.example.invalid;injected'],['missing_host','']]){
   const name=prefix+'_'+suffix;containers.push(name);await docker('run','-d','--name',name,'--label',label,'--network','none',...restrictions,'-e','EDGE_HOST='+hostValue,'-v',tls+':/run/secrets:ro',edgeImage);assert.equal(await docker('wait',name),'1');
  }
  await prepare('chmod 0444 /output/tls_private_key');
  const unsafe=prefix+'_unsafe_key';containers.push(unsafe);await docker('run','-d','--name',unsafe,'--label',label,'--network','none',...restrictions,'-e','EDGE_HOST='+host,'-v',tls+':/run/secrets:ro',edgeImage);assert.equal(await docker('wait',unsafe),'1');
  await prepare('chmod 0440 /output/tls_private_key');
  // Exercise the production-default HSTS path rather than only the test-only off setting.
  const hsts=prefix+'_hsts';containers.push(hsts);await docker('run','-d','--name',hsts,'--label',label,'--network',nets[2],...restrictions,'-e','EDGE_HOST='+host,'-p','127.0.0.1::8443','-v',tls+':/run/secrets:ro',edgeImage);
  await waitFor(async()=>JSON.parse(await docker('inspect',hsts))[0].State.Health?.Status==='healthy','Default HSTS edge not healthy');
  const hstsPort=JSON.parse(await docker('inspect',hsts))[0].NetworkSettings.Ports['8443/tcp'][0].HostPort;
  const hstsHeader=await new Promise((resolve,reject)=>{https.get({hostname:'127.0.0.1',port:hstsPort,servername:host,path:'/health',headers:{Host:host},ca,agent:false,timeout:5000},r=>{r.resume();resolve(r.headers['strict-transport-security']);}).on('error',reject);});assert.equal(hstsHeader,'max-age=31536000');
  evidence.checks.push('T06 protected TLS rotation, invalid pair leaves existing TLS intact, invalid host/unsafe key fail startup, production HSTS and maximum bearer/header bounds verified');
  // Login limiter is distinct from API polling. No sensitive body/URI/header is logged.
  const statuses=[];for(let i=0;i<8;i++)statuses.push((await request('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status);assert.ok(statuses.includes(429));
  const logs=await docker('logs',edge);assert.ok(!logs.includes('synthetic-request-marker'));assert.ok(!(await docker('logs',web)).includes('synthetic-request-marker')); for(const forbidden of [password,token,fresh,viewerToken,'token=forbidden','attacker.invalid','limit=1'])assert.ok(!logs.includes(forbidden));
  writeFileSync(join(folder,'compose.env'),'# Owned disposable Compose inputs\n');
  const composeEnv={...env,API_IMAGE:apiImage,WEB_IMAGE:webImage,EDGE_IMAGE:edgeImage,API_CONFIGURATION_FILE:resolve('docker/production-api.env.example'),DATABASE_URL_SECRET_FILE:join(folder,'database_url'),MIGRATION_DATABASE_URL_SECRET_FILE:join(folder,'migration_database_url'),DATABASE_CA_FILE:join(folder,'server.crt'),DATABASE_MIGRATION_TARGET:'elyqreth',PUBLIC_ORIGIN:origin,EDGE_HOST:host,EDGE_TLS_CERTIFICATE_FILE:join(folder,'edge.crt'),EDGE_TLS_PRIVATE_KEY_FILE:join(folder,'edge.key')};
  const composed=JSON.parse((await run('docker',['compose','--env-file',join(folder,'compose.env'),'-f',resolve('docker-compose.production.yml'),'-f',resolve('docker-compose.edge.yml'),'config','--format','json'],{env:composeEnv,windowsHide:true,timeout:30000})).stdout);
  assert.deepEqual(Object.keys(composed.services).sort(),['api','edge','web']);assert.equal(composed.services.edge.ports.length,2);for(const name of ['api','web'])assert.ok(!composed.services[name].ports);assert.equal(composed.networks.edge_api.internal,true);assert.equal(composed.networks.presentation.internal,true);assert.ok(!Object.keys(composed.services.edge.networks).includes('application'));
  evidence.checks.push('T06 spoofed forwarding headers overwritten, canonical upstream Host, no implicit proxy trust, 429 login budget, safe outage/logging and merged Compose network/port checks');
 }catch(error){try{const logs=await run('docker',['logs',edge],{env,windowsHide:true,timeout:10000});console.error(logs.stderr.slice(-3000));}catch{}throw error;}finally{
  for(const name of containers.reverse()){try{const info=JSON.parse(await docker('inspect',name))[0];assert.equal(info.Config.Labels[ownLabel],id);await docker('rm','-f',name);}catch(error){if(!String(error).includes('No such'))throw error;}}
  if(apiNet)try{await docker('network','disconnect',apiNet,api);}catch{/* The parent harness still owns and removes API. */}
  for(const name of volumes){const info=JSON.parse(await docker('volume','inspect',name))[0];assert.equal(info.Labels[ownLabel],id);await docker('volume','rm',name);}
  for(const name of nets){const info=JSON.parse(await docker('network','inspect',name))[0];assert.equal(info.Labels[ownLabel],id);await docker('network','rm',name);}
 }
}
