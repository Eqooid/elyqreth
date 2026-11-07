const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,generateKeyPairSync}=require('node:crypto');const {spawnSync}=require('node:child_process');const {join}=require('node:path');
const {SignJWT}=require('jose');
const {createApplication}=require('../dist/application');const {validateEnvironment}=require('../dist/config/configuration');
const {AuthenticationService}=require('../dist/auth/auth.service');const {ApiLogger}=require('../dist/common/api-logger');const {definition}=require('./runtime-fixtures.cjs');
const password='Synthetic-private-test-password-123';
module.exports=({row,getUrl,getPool})=>{
 async function fixture(mode='local',extra={}){
  const owner=await row("INSERT INTO owners(name) VALUES ('authentication-test') RETURNING id");
  const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'auth-native','native','ENABLED') RETURNING id",[owner.id]);
  const agents=[];for(let i=0;i<2;i++)agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,$3,'RULE_BASED','ACTIVE') RETURNING id",[owner.id,route.id,'Auth Agent '+i]));
  const env={NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AUTH_MODE:mode,
   AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,RUNTIME_ENABLED:'true',
   RUNTIME_BINDINGS:JSON.stringify(agents.map(a=>({agentId:a.id,orchestratorId:route.id,definition:definition()}))),
   CITY_READ_ENABLED:'true',COLLABORATION_READ_ENABLED:'true',...extra};
  const config=validateEnvironment(env),logs=[];let app;
  async function open(){app=await createApplication(config);app.get(ApiLogger).info=(...args)=>logs.push(args);app.get(ApiLogger).error=(...args)=>logs.push(args);await app.listen(0,'127.0.0.1');}
  await open();
  const http=async(path,method='GET',body,token,headers={})=>{
   const res=await fetch((await app.getUrl())+'/api/v1/'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:res.status,data:await res.json()};
  };
  const login=async(username='operator',secret=password)=>http('auth/login','POST',{username,password:secret});
  return {owner,agents,env,config,logs,http,login,url:()=>app.getUrl(),service:()=>app.get(AuthenticationService),close:()=>app.close(),restart:async()=>{await app.close();await open();}};
 }
 test('authentication additive upgrade preserves populated v9 data and missing auth schema prevents local startup',async()=>{
  const {Pool}=require('pg'),{drizzle}=require('drizzle-orm/node-postgres'),{migrate}=require('drizzle-orm/node-postgres/migrator');
  const {migrationFolder,migrateDatabase}=require('../dist/database/migrate');
  const {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync}=require('node:fs');
  const {tmpdir}=require('node:os'),{dirname,basename,resolve}=require('node:path');
  const target=new URL(getUrl()),database=target.pathname.slice(1)+'_auth_upgrade';assert.match(database,/^elyqreth_test_[a-f0-9]{24}_auth_upgrade$/);
  await getPool().query(`CREATE DATABASE "${database}"`);target.pathname='/'+database;
  const pool=new Pool({connectionString:target.href,max:1}),temp=mkdtempSync(join(tmpdir(),'elyqreth-auth-upgrade-'));
  try{
   mkdirSync(join(temp,'meta'));const journal=JSON.parse(readFileSync(join(migrationFolder,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.slice(0,10);
   writeFileSync(join(temp,'meta/_journal.json'),JSON.stringify(journal));for(const entry of journal.entries)copyFileSync(join(migrationFolder,entry.tag+'.sql'),join(temp,entry.tag+'.sql'));
   await migrate(drizzle(pool),{migrationsFolder:temp});
   const owner=(await pool.query("INSERT INTO owners(name) VALUES ('auth-upgrade-owner') RETURNING id")).rows[0];
   const route=(await pool.query("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'existing','native') RETURNING id",[owner.id])).rows[0];
   const agent=(await pool.query("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'existing','RULE_BASED') RETURNING id",[owner.id,route.id])).rows[0];
   const task=(await pool.query('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,$4) RETURNING *',[owner.id,agent.id,route.id,{instruction:'Preserve existing work'}])).rows[0];
   const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:target.href,DATABASE_SSL_MODE:'disable',AUTH_MODE:'local',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id});
   const old=await createApplication(config);try{await assert.rejects(old.init());}finally{await old.close();}
   await migrateDatabase(config.database);assert.deepEqual((await pool.query('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0],task);
   assert.equal((await pool.query('SELECT count(*)::int n FROM local_accounts')).rows[0].n,0);
   const upgraded=await createApplication(config);try{await upgraded.init();}finally{await upgraded.close();}
  }finally{await pool.end();assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('elyqreth-auth-upgrade-'));rmSync(temp,{recursive:true});}
 });
 test('authentication local API stores hashed passwords and sessions, revokes logout and survives backend restart',async()=>{
  const f=await fixture();try{
   const account=await f.service().provision({username:'operator',password,role:'operator'},'create');
   const stored=await row('SELECT * FROM local_accounts WHERE id=$1',[account.id]);assert.notEqual(stored.password_hash,password);assert.match(stored.password_hash,/^scrypt-v1/);
   assert.equal((await f.login('operator','Wrong-synthetic-password-123')).status,401);
   assert.equal((await f.login('missing_user')).status,401);
   const signed=await f.login();assert.equal(signed.status,200);const token=signed.data.accessToken;
   assert.equal((await f.http('auth/me','GET',undefined,token)).data.kind,'LOCAL_ACCOUNT');
   const saved=await row('SELECT token_hash FROM auth_sessions WHERE account_id=$1',[account.id]);assert.equal(saved.token_hash.length,64);assert.ok(!saved.token_hash.includes(token));
   await f.restart();assert.equal((await f.http('auth/me','GET',undefined,token)).status,200);
   assert.equal((await f.http('auth/logout','POST',{},token)).status,200);
   assert.equal((await f.http('auth/me','GET',undefined,token)).status,401);
   assert.equal((await f.http('agents','GET',undefined,'old-development-token')).status,401);
   assert.ok(!JSON.stringify(f.logs).includes(password));assert.ok(!JSON.stringify(f.logs).includes(token));
  }finally{await f.close();}
 });
 test('authentication operator runs native collaboration with human audit while viewer cannot mutate or adopt foreign scope',async()=>{
  const f=await fixture(),foreign=await fixture();try{
   const user=await f.service().provision({username:'operator',password,role:'operator'},'create');
   await f.service().provision({username:'viewer',password,role:'viewer'},'create');await foreign.service().provision({username:'operator',password,role:'operator'},'create');
   const op=(await f.login()).data.accessToken,viewer=(await f.login('viewer')).data.accessToken,other=(await foreign.login()).data.accessToken;
   assert.equal((await f.http('agents','GET',undefined,viewer)).status,200);
   assert.equal((await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Denied'}},viewer)).status,403);
   const task=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Owned parent'},idempotencyKey:randomUUID()},op);assert.equal(task.status,201);
   const execution=await f.http(`tasks/${task.data.id}/execute`,'POST',{},op,{'if-match':'"1"'});assert.equal(execution.status,200);
   const session=await f.http('collaborations','POST',{rootTaskId:task.data.id,participantAgentIds:f.agents.map(a=>a.id),idempotencyKey:randomUUID()},op);assert.equal(session.status,201);
   const d=await f.http(`collaborations/${session.data.id}/delegations`,'POST',{sourceAgentId:f.agents[0].id,targetAgentId:f.agents[1].id,parentTaskId:task.data.id,sourceExecutionId:execution.data.execution.id,idempotencyKey:randomUUID()},op);assert.equal(d.status,201);
   const completed=await f.http(`collaborations/${session.data.id}/delegations/${d.data.id}/activate`,'POST',{instruction:'Owned child',idempotencyKey:randomUUID()},op);assert.equal(completed.status,200);
   assert.equal((await f.http(`collaboration-activity/${session.data.id}/snapshot`,'GET',undefined,viewer)).status,200);
   assert.equal((await f.http(`agents/${foreign.agents[0].id}`,'GET',undefined,op,{'x-owner-id':foreign.owner.id})).status,404);
   assert.equal((await f.http('agents','GET',undefined,other)).status,401);
   const audit=await row("SELECT actor_reference FROM command_audit WHERE owner_id=$1 AND resource_id=$2 AND command_type='task.created'",[f.owner.id,task.data.id]);assert.equal(audit.actor_reference,'local-user:'+user.id);
  }finally{await f.close();await foreign.close();}
 });
 test('frontend account clients consume real local Agent Task Execution and collaboration contracts',async()=>{
  const {pathToFileURL}=require('node:url');const {resolve}=require('node:path');
  const moduleAt=async path=>import(pathToFileURL(resolve(__dirname,'../../../dist/js/runtime',path)).href);
  const {AccessSession}=await moduleAt('access/session.js');const {InteractionApiClient}=await moduleAt('interaction/api-client.js');
  const {CollaborationApiClient}=await moduleAt('collaboration/api-client.js');
  const f=await fixture();let session;
  try{
   await f.service().provision({username:'operator',password,role:'operator'},'create');await f.service().provision({username:'viewer',password,role:'viewer'},'create');
   // The fixture binds an ephemeral loopback port; requests still pass the real global auth/object guards.
   const origin=await f.url();session=new AccessSession({origin,mode:'local'});session.bootstrap();await session.login({username:'operator',password});assert.equal(session.getSnapshot().phase,'AUTHENTICATED');
   let client,collaboration;session.connect((token,fetchImpl)=>{client=new InteractionApiClient({baseUrl:origin,pageOrigin:origin,access:'account',fetchImpl});client.authorize(token);collaboration=new CollaborationApiClient({baseUrl:origin,pageOrigin:origin,access:'account',fetchImpl});collaboration.authorize(token);});
   const agent=await client.getAgent(f.agents[0].id);assert.equal(agent.actionEligibility.canCreateTask,true);
   const task=await client.createTask({agentId:agent.id,input:{instruction:'Frontend account execution'},idempotencyKey:randomUUID()});assert.equal(task.actionEligibility.canRequestStart,true);
   const started=await client.executeTask({agentId:agent.id,taskId:task.id},task.version);assert.equal(started.execution.status,'SUCCEEDED');
   const reference={agentId:agent.id,taskId:task.id,executionId:started.execution.id};assert.equal((await client.getExecution(reference)).actionEligibility.canRequestCancel,false);assert.equal((await client.getResult(reference)).availability,'AVAILABLE');
   assert.ok((await collaboration.list()).items);await session.logout();await assert.rejects(client.getAgent(agent.id));assert.equal(session.getSnapshot().principal,null);
   await session.login({username:'viewer',password});session.connect((token,fetchImpl)=>{client=new InteractionApiClient({baseUrl:origin,pageOrigin:origin,access:'account',fetchImpl});client.authorize(token);});
   assert.equal((await client.getAgent(agent.id)).actionEligibility.canCreateTask,false);await assert.rejects(client.createTask({agentId:agent.id,input:{instruction:'Denied viewer'},idempotencyKey:randomUUID()}),e=>e.code==='FORBIDDEN');assert.equal(session.getSnapshot().phase,'AUTHENTICATED');
   await f.service().provision({username:'viewer'},'disable');await assert.rejects(client.getAgent(agent.id));assert.equal(session.getSnapshot().phase,'EXPIRED');
  }finally{session?.dispose();await f.close();}
 });
 test('authentication frontend real browser logs in executes inspects collaboration logs out and expires revoked viewer',async()=>{
  const {createServer}=await import('vite');const {promisify}=require('node:util');const {execFile}=require('node:child_process');const {resolve}=require('node:path');const {mkdtempSync,readFileSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {X509Certificate,createHash}=require('node:crypto');let f,vite,target='';const tlsDir=mkdtempSync(join(tmpdir(),'elyqreth-access-tls-'));
  try{
   const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';await promisify(execFile)(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(tlsDir,'key.pem'),'-out',join(tlsDir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{timeout:30000});const key=readFileSync(join(tlsDir,'key.pem')),cert=readFileSync(join(tlsDir,'cert.pem')),pin=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
   vite=await createServer({configFile:resolve(__dirname,'../../../vite.config.js'),server:{host:'127.0.0.1',port:0,open:false,https:{key,cert}},plugins:[{name:'disposable-auth-test-proxy',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if(req.url==='/access-config.json'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({mode:'local'}));return;}
    if(req.url==='/__test_revoke'&&req.method==='POST'){await f.service().provision({username:'viewer'},'disable');res.end('{}');return;}
    if(!req.url.startsWith('/api/v1/'))return next();
    try{const chunks=[];for await(const part of req)chunks.push(part);const body=Buffer.concat(chunks),headers={};for(const k of ['authorization','content-type','if-match','origin'])if(typeof req.headers[k]==='string')headers[k]=req.headers[k];const response=await fetch(target+req.url,{method:req.method,headers,...(body.length?{body}:{}),redirect:'error'});res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(Buffer.from(await response.arrayBuffer()));}catch{res.statusCode=503;res.end('{}');}
   });}}]});await vite.listen();const origin='https://127.0.0.1:'+vite.httpServer.address().port;
   f=await fixture('local',{CORS_ORIGINS:origin});target=await f.url();await f.service().provision({username:'operator',password,role:'operator'},'create');await f.service().provision({username:'viewer',password,role:'viewer'},'create');
   for(let i=0;i<f.agents.length;i++)await row('INSERT INTO city_agent_bindings(owner_id,agent_id,npc_id) VALUES ($1,$2,$3) RETURNING id',[f.owner.id,f.agents[i].id,'resident-slot-'+String(i+1).padStart(3,'0')]);
   const token=(await f.login()).data.accessToken;const task=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Browser collaboration root'},idempotencyKey:randomUUID()},token);const collaboration=await f.http('collaborations','POST',{rootTaskId:task.data.id,participantAgentIds:f.agents.map(a=>a.id),idempotencyKey:randomUUID()},token);assert.equal(collaboration.status,201);
   const result=await promisify(execFile)(process.execPath,[resolve(__dirname,'../../../scripts/authentication-browser.mjs')],{cwd:resolve(__dirname,'../../..'),env:{...process.env,ACCESS_TEST_ORIGIN:origin,ACCESS_TEST_PASSWORD:password,ACCESS_TEST_SPKI:pin},timeout:120000,maxBuffer:1024*1024});assert.match(result.stdout,/"status":"PASS"/);console.log(result.stdout.trim());
  }finally{await vite?.close();await f?.close();assert.equal(require('node:path').dirname(tlsDir),tmpdir());rmSync(tlsDir,{recursive:true,force:true});}
 });
 test('authentication password change disable role change and expiration invalidate active local credentials',async()=>{
  const f=await fixture();try{
   const a=await f.service().provision({username:'operator',password,role:'operator'},'create');let token=(await f.login()).data.accessToken;
   await f.service().provision({username:'operator',password:password+'changed'},'password');assert.equal((await f.http('auth/me','GET',undefined,token)).status,401);assert.equal((await f.login()).status,401);
   token=(await f.login('operator',password+'changed')).data.accessToken;await f.service().provision({username:'operator',role:'viewer'},'role');assert.equal((await f.http('auth/me','GET',undefined,token)).status,401);
   token=(await f.login('operator',password+'changed')).data.accessToken;await getPool().query("UPDATE auth_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE account_id=$1 AND revoked_at is null",[a.id]);assert.equal((await f.http('auth/me','GET',undefined,token)).status,401);
   token=(await f.login('operator',password+'changed')).data.accessToken;await f.service().provision({username:'operator'},'disable');assert.equal((await f.http('auth/me','GET',undefined,token)).status,401);assert.equal((await f.login('operator',password+'changed')).status,401);
  }finally{await f.close();}
 });
 test('authentication local provisioning is stdin-only internal command and login rate limit is durable',async()=>{
  const f=await fixture();try{
   const child=spawnSync(process.execPath,['dist/auth/local-account-command.js','create'],{cwd:join(__dirname,'..'),env:{...process.env,...f.env},input:JSON.stringify({username:'cli_operator',password,role:'operator'}),encoding:'utf8',timeout:20000});
   assert.ifError(child.error);assert.equal(child.status,0,child.stderr);assert.ok(!child.stdout.includes(password));assert.ok(JSON.parse(child.stdout).id);
   assert.equal((await f.login('cli_operator')).status,200);
   assert.equal((await f.http('auth/accounts','POST',{},(await f.login('cli_operator')).data.accessToken)).status,404);
   await getPool().query('UPDATE auth_login_limits SET attempts=20,window_started_at=now() WHERE owner_id=$1',[f.owner.id]);
   await f.restart();assert.equal((await f.login('cli_operator')).status,429);
  }finally{await f.close();}
 });
 test('authentication OIDC signed token authenticates approved subject without local password fallback',async()=>{
  const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'fixture',use:'sig',alg:'RS256'};
  const env={AUTH_OIDC_ISSUER:'https://identity.example/realm',AUTH_OIDC_AUDIENCE:'elyqreth-api',AUTH_OIDC_JWKS:JSON.stringify({keys:[jwk]}),AUTH_OIDC_SUBJECTS:JSON.stringify([{subject:'approved',role:'viewer'}])};
  const f=await fixture('oidc',env);try{
   const token=await new SignJWT({sub:'approved'}).setProtectedHeader({alg:'RS256',kid:'fixture',typ:'at+jwt'}).setIssuedAt().setExpirationTime('5m').setIssuer(env.AUTH_OIDC_ISSUER).setAudience(env.AUTH_OIDC_AUDIENCE).sign(pair.privateKey);
   assert.equal((await f.http('auth/me','GET',undefined,token)).data.kind,'OIDC');assert.equal((await f.http('agents','GET',undefined,token)).status,200);
   assert.equal((await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Not granted'}},token)).status,403);
   assert.equal((await f.login()).status,404);assert.equal((await f.http('auth/logout','POST',{},token)).status,404);
   assert.equal((await f.http('agents','GET',undefined,'old-development-token')).status,401);
  }finally{await f.close();}
 });
 test('authentication database enforces account uniqueness and cross-owner session correlation',async()=>{
  const a=await fixture(),b=await fixture();try{
   const account=await b.service().provision({username:'operator',password,role:'operator'},'create');
   await assert.rejects(b.service().provision({username:'operator',password,role:'viewer'},'create'),e=>(e.cause?.code??e.code)==='23505');
   await assert.rejects(getPool().query("INSERT INTO auth_sessions(owner_id,account_id,token_hash,credential_version,expires_at) VALUES ($1,$2,$3,1,now()+interval '1 hour')",[a.owner.id,account.id,'0'.repeat(64)]),e=>e.code==='23503');
   assert.equal((await row('SELECT count(*)::int n FROM auth_sessions WHERE owner_id=$1',[a.owner.id])).n,0);
  }finally{await a.close();await b.close();}
 });
 test('authentication login rolls back issued session if durable audit persistence fails',async()=>{
  const f=await fixture();try{
   await f.service().provision({username:'operator',password,role:'operator'},'create');
   await getPool().query(`CREATE FUNCTION auth_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.command_type='auth.login' THEN RAISE EXCEPTION 'test-only-auth-audit-failure'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER auth_test_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW EXECUTE FUNCTION auth_test_audit_failure()');
   try{const response=await f.login();assert.equal(response.status,500);assert.ok(!JSON.stringify(response.data).includes(password));
    assert.equal((await row('SELECT count(*)::int n FROM auth_sessions WHERE owner_id=$1',[f.owner.id])).n,0);
   }finally{await getPool().query('DROP TRIGGER auth_test_audit_failure ON command_audit');await getPool().query('DROP FUNCTION auth_test_audit_failure()');}
  }finally{await f.close();}
 });
 if(process.env.ELYQRETH_KEYCLOAK_LIVE==='true')test('authentication live Keycloak issuer returns real access token accepted only in OIDC installation',async()=>{
  const kc=await require('./keycloak-fixture.cjs').start();let f,local;
  try{
   const token=await kc.token(),jwks=await kc.keys();
   f=await fixture('oidc',{AUTH_OIDC_ISSUER:kc.issuer,AUTH_OIDC_AUDIENCE:'elyqreth-api',AUTH_OIDC_JWKS:JSON.stringify(jwks),AUTH_OIDC_SUBJECTS:JSON.stringify([{subject:kc.subject,role:'operator'}])});
   assert.equal((await f.http('auth/me','GET',undefined,await kc.idToken())).status,401);
   const me=await f.http('auth/me','GET',undefined,token);assert.equal(me.status,200);assert.equal(me.data.kind,'OIDC');
   const task=await f.http('tasks','POST',{agentId:f.agents[0].id,input:{instruction:'Real Keycloak authorization'},idempotencyKey:randomUUID()},token);assert.equal(task.status,201);
   const execution=await f.http(`tasks/${task.data.id}/execute`,'POST',{},token,{'if-match':'"1"'});assert.equal(execution.status,200);assert.equal(execution.data.execution.status,'SUCCEEDED');
   assert.equal((await f.login()).status,404);local=await fixture();assert.equal((await local.http('agents','GET',undefined,token)).status,401);
   const wrong=await fixture('oidc',{AUTH_OIDC_ISSUER:kc.issuer,AUTH_OIDC_AUDIENCE:'wrong-api',AUTH_OIDC_JWKS:JSON.stringify(jwks),AUTH_OIDC_SUBJECTS:JSON.stringify([{subject:kc.subject,role:'operator'}])});
   try{assert.equal((await wrong.http('agents','GET',undefined,token)).status,401);}finally{await wrong.close();}
   console.log(JSON.stringify({event:'keycloak_live_verification',status:'PASS',image:kc.image,mode:'oidc',nativeExecution:'SUCCEEDED',localFallback:false}));
  }finally{await local?.close();await f?.close();await kc.close();}
 });
};
