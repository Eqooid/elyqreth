const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {randomBytes,randomUUID,createHash}=require('node:crypto');const {execFile,spawn}=require('node:child_process');const {promisify}=require('node:util');
const {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,statSync,appendFileSync,existsSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,dirname,basename,resolve}=require('node:path');
const {Pool}=require('pg');const {migrateDatabase,migrationFolder}=require('../dist/database/migrate');const {validateEnvironment}=require('../dist/config/configuration');
const {provisionDatabase}=require('../dist/database/provision');const {verifyAccess}=require('../dist/database/access-policy');
const {createBackup,verifyBackup,restoreBackup,provisionBackupRole,integrity}=require('../dist/database/backup');
const {copyBackup,retainBackups,decryptArchive}=require('../dist/database/backup-files');
const {definition}=require('./runtime-fixtures.cjs');
const {PassThrough,Readable}=require('node:stream');
const {runtimeTables}=require('../dist/database/access-policy');
const {createApplication}=require('../dist/application'),{DatabaseService}=require('../dist/database/database.module');
const {CollaborationRepository}=require('../dist/collaboration/collaboration.repository');
const {IngestionAuthority}=require('../dist/external-orchestrators/ingestion-authority'),{ExternalIngestionService}=require('../dist/external-orchestrators/external-ingestion.service');
const run = promisify(execFile);
const migrationCount = JSON.parse(readFileSync(join(migrationFolder, 'meta/_journal.json'), 'utf8')).entries.length;
const runId = randomBytes(12).toString('hex');
const container = `elyqreth_t08_test_${runId}`;
const volume = `${container}_data`;
const tlsVolume=`${container}_tls`;
const database = `elyqreth_test_${runId}`;
const password = randomBytes(24).toString('hex');
const label = 'elyqreth.backup.run';
const runtimeRole='r_'+runId,migrationRole='m_'+runId,runtimePassword=randomBytes(32).toString('base64url'),migrationPassword=randomBytes(32).toString('base64url');
let temp, admin, pool, config, url, containerCreated = false, volumeCreated = false,tlsCreated=false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = async (...args) => (await run('docker', args, { timeout: 120_000, maxBuffer: 1024 * 1024 })).stdout.trim();

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const status = JSON.parse(await docker('inspect', container))[0];
      if (status.State.Health?.Status === 'healthy') return;
    } catch { /* Only the newly created test container is inspected. */ }
    await sleep(250);
  }
  throw new Error('Isolated PostgreSQL did not become healthy. Check Docker.');
}

before(async () => {
  // No DATABASE_URL/TEST_DATABASE_URL is consumed. Existing databases cannot be targeted.
  temp = mkdtempSync(join(tmpdir(), 'elyqreth-t08-'));
  writeFileSync(join(temp, 'postgres.env'), `POSTGRES_USER=elyqreth_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=postgres\n`, { mode: 0o600 });
  const compose = readFileSync(join(__dirname, '../../../docker-compose.yml'), 'utf8');
  const image = compose.match(/^\s+image:\s+(postgres:\S+@sha256:[a-f0-9]{64})\s*$/m)?.[1];
  assert.ok(image, 'Tests require the pinned official PostgreSQL image from Compose');
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  await run(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1',
    '-keyout',join(temp,'server.key'),'-out',join(temp,'server.crt')],{timeout:30000});
  await docker('volume','create','--label',`${label}=${runId}`,tlsVolume);tlsCreated=true;
  await docker('run','--rm','--network','none','--mount',`type=bind,src=${temp},dst=/input,readonly`,'-v',tlsVolume+':/tls','--entrypoint','sh',image,'-c',
    'cp /input/server.key /input/server.crt /tls/; chown 999:999 /tls/server.key; chmod 0600 /tls/server.key; chmod 0444 /tls/server.crt');
  await docker('volume', 'create', '--label', `${label}=${runId}`, volume); volumeCreated = true;
  await docker('run', '--detach', '--name', container, '--label', `${label}=${runId}`,
    '--env-file', join(temp, 'postgres.env'), '-p', '127.0.0.1::5432',
    '--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`,
    '-v',tlsVolume+':/tls:ro','--health-cmd', 'pg_isready -h 127.0.0.1 -U elyqreth_test -d postgres', '--health-interval', '1s', '--health-timeout', '2s', '--health-retries', '60', image,
    'postgres','-c','ssl=on','-c','ssl_cert_file=/tls/server.crt','-c','ssl_key_file=/tls/server.key');
  containerCreated = true;
  await waitReady();
  const state = JSON.parse(await docker('inspect', container))[0];
  const mapping = state.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(mapping.HostIp, '127.0.0.1');
  url = `postgresql://elyqreth_test:${password}@127.0.0.1:${mapping.HostPort}/${database}`;
  config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, DATABASE_SSL_MODE: 'verify-full',DATABASE_SSL_CA_FILE:join(temp,'server.crt') });
  const connection = { host: '127.0.0.1', port: Number(mapping.HostPort), user: 'elyqreth_test', password,
    connectionTimeoutMillis: 5000, statement_timeout: 10000 };
  admin = new Pool({ ...connection, database: 'postgres', max: 1 });
  admin.on('error', () => {});
  assert.match(database, /^elyqreth_test_[a-f0-9]{24}$/);
  await admin.query(`CREATE DATABASE "${database}"`);
  await provisionDatabase(config.database,{expectedDatabase:database,runtimeRole,migrationRole,runtimePassword,migrationPassword});
  await migrateDatabase({...config.database,user:migrationRole,password:migrationPassword});
  pool = new Pool({ ...connection, database, max: 5 });
  pool.on('error', () => {}); // A test intentionally restarts this isolated server.
}, { timeout: 120_000 });

const row=async(text,params=[],client=pool)=>(await client.query(text,params)).rows[0];
const key=randomBytes(32),backupRole='b_'+runId,backupPassword=randomBytes(32).toString('base64url');
let directory,mirror,metadata,fixture,restoreConfig,restoreUrl,metrics={};
const roleUrl=(user,password,databaseName=database)=>{const target=new URL(url);target.username=user;target.password=password;target.pathname='/'+databaseName;return target.href;};
// Test-only transport: same real PostgreSQL 17 binaries in the owned container. No production command override.
function runner(tool,args,env){
  const pgEnv={...env,PGHOST:'127.0.0.1',PGPORT:'5432'};
  if(pgEnv.PGSSLROOTCERT&&pgEnv.PGSSLROOTCERT!=='system'&&existsSync(pgEnv.PGSSLROOTCERT))pgEnv.PGSSLROOTCERT='/tls/server.crt';
  const names=Object.keys(pgEnv).filter(k=>k.startsWith('PG'));
  const child=spawn('docker',['exec','-i','--user','999:999',...names.flatMap(k=>['-e',k]),container,tool,...args],{env:pgEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let error='';child.stderr.on('data',b=>{if(error.length<2000)error+=b.toString();});
  return {input:child.stdin,output:child.stdout,done:new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Owned PostgreSQL client failed: '+error)));})};
}
async function openApplication(targetUrl,includeRuntime){
  const env={NODE_ENV:'test',DATABASE_URL:targetUrl,DATABASE_SSL_MODE:'verify-full',DATABASE_SSL_CA_FILE:join(temp,'server.crt'),AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:fixture.owner.id,
    AGENT_REGISTRY_TOKEN:fixture.token,COLLABORATION_READ_ENABLED:'true',COLLABORATION_READ_TOKEN:fixture.readToken,
    ...(includeRuntime?{RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:JSON.stringify(fixture.agents.map(a=>({agentId:a.id,orchestratorId:fixture.route.id,definition:definition()})))}:{}),
    EXTERNAL_ORCHESTRATORS_ENABLED:'true',EXTERNAL_ORCHESTRATORS:JSON.stringify([fixture.profile])};
  const app=await createApplication(validateEnvironment(env));await app.listen(0,'127.0.0.1');return app;
}
async function command(app,path,input){const res=await fetch((await app.getUrl())+'/api/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+fixture.token,'content-type':'application/json',...(path.endsWith('/execute')?{'if-match':'"1"'}:{})},body:JSON.stringify(input)});assert.ok(res.ok,JSON.stringify(await res.clone().json()));return res.json();}

test('synthetic native, external, pending and interrupted data are persisted using existing APIs and constraints',async()=>{
  const owner=await row("INSERT INTO owners(name) VALUES ('backup-owner') RETURNING id"),route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native','native','ENABLED') RETURNING id",[owner.id]);
  const agents=[];for(let n=0;n<2;n++)agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,$3,'RULE_BASED','ACTIVE') RETURNING id",[owner.id,route.id,'Agent '+n]));
  const externalRoute=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'external','langgraph.v1','ENABLED') RETURNING id",[owner.id]);
  const externalAgent=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'External','EXTERNAL') RETURNING id",[owner.id,externalRoute.id]);
  fixture={owner,route,agents,externalRoute,externalAgent,token:randomBytes(32).toString('hex'),readToken:randomBytes(32).toString('hex')};
  fixture.profile={id:externalRoute.id,ownerId:owner.id,adapterType:'langgraph.v1',name:'Reference',namespace:'backup-test',generation:1,mode:'OBSERVATION_ONLY',enabled:true,
    endpoint:{origin:'http://127.0.0.1:20240',network:'local',allowedAddresses:['127.0.0.1']},capabilities:['health','events.poll']};
  const app=await openApplication(roleUrl(runtimeRole,runtimePassword),true);
  try{
    const parent=await command(app,'tasks',{agentId:agents[0].id,input:{instruction:'Synthetic parent'},idempotencyKey:randomUUID()});
    const execution=await command(app,'tasks/'+parent.id+'/execute',{});
    const session=await command(app,'collaborations',{rootTaskId:parent.id,participantAgentIds:agents.map(a=>a.id),idempotencyKey:randomUUID()});
    const delegation=await command(app,`collaborations/${session.id}/delegations`,{sourceAgentId:agents[0].id,targetAgentId:agents[1].id,parentTaskId:parent.id,sourceExecutionId:execution.execution.id,idempotencyKey:randomUUID()});
    const activated=await command(app,`collaborations/${session.id}/delegations/${delegation.id}/activate`,{instruction:'Synthetic child',idempotencyKey:randomUUID()});
    fixture.session=session;fixture.delegation=delegation;fixture.parent=parent;
    const repo=new CollaborationRepository(app.get(DatabaseService)),scope={ownerId:owner.id,actorReference:'backup-test',correlationId:randomUUID()};
    const externalSession=await repo.run(scope,r=>r.createSession({authority:'EXTERNAL',participantAgentIds:[externalAgent.id],idempotencyKey:randomUUID()}));
    const authority=app.get(IngestionAuthority),operator=authority.authorize(fixture.token,externalRoute.id,randomUUID(),'operator','backup-domain'),source=authority.authorize(fixture.token,externalRoute.id,randomUUID(),'ingestion','backup-domain');
    const ingestion=app.get(ExternalIngestionService);await ingestion.mapAgent(operator,{externalId:'external-agent',internalAgentId:externalAgent.id});
    await ingestion.mapExecution(operator,{externalId:'external-run',externalAgentId:'external-agent',collaborationId:externalSession.id});
    fixture.event={connectionId:externalRoute.id,namespace:'backup-test',generation:1,eventId:randomUUID(),kind:'execution.observed',externalAgentId:'external-agent',externalExecutionId:'external-run',sourceStatus:'RUNNING',receivedAt:new Date().toISOString(),sequence:{domain:'backup-domain',value:'1'}};
    assert.equal((await ingestion.ingest(source,fixture.event)).receipt.status,'APPLIED');
    fixture.pending=await command(app,'tasks',{agentId:agents[0].id,input:{instruction:'Do not dispatch after restore'},idempotencyKey:randomUUID()});
  }finally{await app.close();}
  const pending=await row("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,status) VALUES ($1,$2,$3,'{}','RUNNING') RETURNING id",[owner.id,agents[0].id,route.id]);
  fixture.interrupted=await row("INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number,status,started_at) VALUES ($1,$2,$3,$4,1,'RUNNING',now()) RETURNING id",[owner.id,pending.id,agents[0].id,route.id]);
  const account=await row("INSERT INTO local_accounts(owner_id,username,password_hash,role) VALUES ($1,'synthetic',$2,'viewer') RETURNING id",[owner.id,'scrypt-v1$'+'0'.repeat(32)+'$'+'0'.repeat(128)]);
  await row("INSERT INTO auth_sessions(owner_id,account_id,token_hash,credential_version,expires_at) VALUES ($1,$2,$3,1,now()+interval '1 hour') RETURNING id",[owner.id,account.id,'a'.repeat(64)]);
});

test('backup login is separate and read-only; real custom dump is encrypted, snapshot-consistent and independently copied',async()=>{
  await provisionBackupRole(config.database,{expectedDatabase:database,expectedHost:config.database.host,role:backupRole,password:backupPassword});
  await provisionBackupRole(config.database,{expectedDatabase:database,expectedHost:config.database.host,role:backupRole});
  directory=join(temp,'backups');mirror=join(temp,'mirror');mkdirSync(directory,{mode:0o700});mkdirSync(mirror,{mode:0o700});
  const readOnly=new Pool({...config.database,user:backupRole,password:backupPassword,ssl:false,max:1});
  const reader=await readOnly.connect();try{await reader.query('SET default_transaction_read_only=off');
    await assert.rejects(reader.query("INSERT INTO owners(name) VALUES ('forbidden')"),e=>e.code==='42501');
    await assert.rejects(reader.query('CREATE TABLE public.forbidden(id int)'),e=>e.code==='42501');
  }finally{reader.release();await readOnly.end();}
  fixture.snapshotRows={};for(const name of Object.keys(runtimeTables))fixture.snapshotRows[name]=(await pool.query(`SELECT row_to_json(t)::text AS row FROM public.${name} t ORDER BY row_to_json(t)::text`)).rows;
  const concurrentRunner=(tool,args,env)=>{
    if(tool!=='pg_dump'||!args.some(a=>a.startsWith('--snapshot=')))return runner(tool,args,env);
    const input=new PassThrough(),output=new PassThrough();
    const done=(async()=>{
      await pool.query("INSERT INTO owners(name) VALUES ('committed after exported snapshot')");
      const actual=runner(tool,args,env);input.pipe(actual.input);actual.output.pipe(output);await actual.done;
    })();return {input,output,done};
  };
  const start=Date.now();metadata=await createBackup({...config.database,user:backupRole,password:backupPassword},
    {directory,expectedDatabase:database,expectedHost:config.database.host},key,concurrentRunner);metrics.backupMs=Date.now()-start;metrics.bytes=metadata.size;
  assert.equal(Number((await row('SELECT count(*) FROM owners')).count),Number(metadata.counts.owners)+1);
  assert.equal((await verifyBackup(directory,metadata.id,key,runner)).id,metadata.id);
  assert.ok(!readFileSync(join(directory,metadata.id+'.backup')).includes(Buffer.from('Synthetic parent')));
  await copyBackup(directory,mirror,metadata.id,key);
  await assert.rejects(createBackup(config.database,{directory,expectedDatabase:database,expectedHost:config.database.host},key,runner),/dedicated/);
  const brokenRunner=(tool,args,env)=>tool==='pg_dump'&&args.some(a=>a.startsWith('--snapshot='))?
    {input:new PassThrough(),output:Readable.from([Buffer.from('PGDMPincomplete')]),done:Promise.reject(Error('synthetic pg_dump failure'))}:runner(tool,args,env);
  await assert.rejects(createBackup({...config.database,user:backupRole,password:backupPassword},
    {directory,expectedDatabase:database,expectedHost:config.database.host},key,brokenRunner),/dump or encryption failed/);
  const badTLSRunner=(tool,args,env)=>runner(tool,args,{...env,PGSSLROOTCERT:'/tls/no-such-certificate'});
  await assert.rejects(createBackup({...config.database,user:backupRole,password:backupPassword},
    {directory,expectedDatabase:database,expectedHost:config.database.host},key,badTLSRunner),/dump or encryption failed/);
  metrics.backupRestoreTLS='verify-full with disposable CA; invalid client CA rejected';
  await assert.rejects(retainBackups(directory,key,metadata.id,2,false),/failed/);
});

test('isolated empty target restores all records, relationships, schema history and runtime grants',async()=>{
  const target='elyqreth_restore_'+runId;await admin.query(`CREATE DATABASE "${target}"`);
  const input={expectedDatabase:target,runtimeRole:'rr_'+runId,migrationRole:'rm_'+runId,runtimePassword,migrationPassword};
  const bootstrap={...config.database,database:target};await provisionDatabase(bootstrap,input);
  restoreConfig={...bootstrap,user:input.migrationRole,password:migrationPassword};restoreUrl=roleUrl(input.runtimeRole,runtimePassword,target);
  const request={directory:mirror,id:metadata.id,expectedDatabase:target,expectedHost:config.database.host,environment:'isolated',confirmation:'RESTORE ISOLATED '+target};
  const start=Date.now();await restoreBackup(restoreConfig,request,key,runner);metrics.restoreMs=Date.now()-start;
  const restored=new Pool({...bootstrap,ssl:false,max:1}),runtime=new Pool({connectionString:restoreUrl,max:1});
  try{
    await verifyAccess(runtime,'runtime',true);
    const names=Object.keys(metadata.counts);
    for(const name of names){
      const original=fixture.snapshotRows[name];
      const actual=(await restored.query(`SELECT row_to_json(t)::text AS row FROM public.${name} t ORDER BY row_to_json(t)::text`)).rows;
      assert.deepEqual(actual,original,'Restored data matches '+name);
    }
    assert.equal((await row('SELECT status FROM executions WHERE id=$1',[fixture.interrupted.id],restored)).status,'RUNNING');
    assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[fixture.pending.id],restored)).status,'CREATED');
    await assert.rejects(restoreBackup(restoreConfig,request,key,runner),/not empty/);
    metrics.rows=Object.values(metadata.counts).reduce((sum,value)=>sum+Number(value),0);
  }finally{await runtime.end();await restored.end();}
});

test('failed restore reports failure without a success receipt or partial business tables',async()=>{
  const suffix=randomBytes(12).toString('hex'),target='elyqreth_restore_'+suffix;await admin.query(`CREATE DATABASE "${target}"`);
  const bootstrap={...config.database,database:target},roles={expectedDatabase:target,runtimeRole:'fr_'+suffix,migrationRole:'fm_'+suffix,runtimePassword,migrationPassword};
  await provisionDatabase(bootstrap,roles);
  const failedConfig={...bootstrap,user:roles.migrationRole,password:migrationPassword};
  const inspect=new Pool({...bootstrap,ssl:false,max:1});
  try{
    // Owned bootstrap-only failure injection: fail post-data constraint DDL inside the real pg_restore transaction.
    await inspect.query(`CREATE FUNCTION elyqreth_ops.restore_fault() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN IF current_query() LIKE '%ADD CONSTRAINT%' THEN RAISE EXCEPTION 'synthetic SQL restore fault'; END IF; END $$`);
    await inspect.query("CREATE EVENT TRIGGER restore_fault ON ddl_command_end WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION elyqreth_ops.restore_fault()");
    await assert.rejects(restoreBackup(failedConfig,{directory:mirror,id:metadata.id,expectedDatabase:target,expectedHost:failedConfig.host,
      environment:'isolated',confirmation:'RESTORE ISOLATED '+target},key,runner));
    assert.equal((await inspect.query("SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','drizzle')")).rows[0].count,'0');
  }
  finally{await inspect.end();}
});

test('restored read APIs converge without executing work; external replay remains deduplicated and native ownership is untouched',async()=>{
  const app=await openApplication(restoreUrl,false),restored=new Pool({connectionString:restoreUrl,max:1});
  try{
    const executions=(await restored.query('SELECT id,status FROM executions ORDER BY id')).rows;
    const snapshot=await fetch((await app.getUrl())+'/api/v1/collaboration-activity/'+fixture.session.id+'/snapshot',{headers:{authorization:'Bearer '+fixture.readToken}});
    assert.equal(snapshot.status,200);
    const source=app.get(IngestionAuthority).authorize(fixture.token,fixture.externalRoute.id,randomUUID(),'ingestion','backup-domain');
    const result=await app.get(ExternalIngestionService).ingest(source,fixture.event);assert.ok(result.duplicate||result.receipt);
    assert.equal((await restored.query('SELECT count(*) FROM external_event_inbox WHERE event_id=$1',[fixture.event.eventId])).rows[0].count,'1');
    assert.deepEqual((await restored.query('SELECT id,status FROM executions ORDER BY id')).rows,executions);
  }finally{await app.close();await restored.end();}
  process.stdout.write('RECOVERY_EVIDENCE '+JSON.stringify({...metrics,format:'PG17 custom archive / AES-256-GCM',scope:'synthetic isolated local restore; not a production RPO/RTO guarantee'})+'\n');
});

if(process.env.ELYQRETH_DISASTER==='true')test('T14 actual disposable source database loss restores to a new runtime-readable target',{timeout:120000},async()=>{
  const owned=JSON.parse(await docker('inspect',container))[0];assert.equal(owned.Config.Labels[label],runId);
  assert.match(database,/^elyqreth_test_[a-f0-9]{24}$/);
  const recovery={startedAt:new Date().toISOString(),approvedRpo:null,approvedRto:null,snapshotAt:metadata.snapshotAt,sourceDatabaseDeleted:false};
  const started=Date.now();let app,restored;
  try{
    await pool.end();pool=undefined;
    await admin.query(`DROP DATABASE "${database}"`);recovery.sourceDatabaseDeleted=true;recovery.lossConfirmedAt=new Date().toISOString();recovery.snapshotAgeAtLossMs=Date.now()-Date.parse(metadata.snapshotAt);
    assert.equal((await admin.query('SELECT count(*) FROM pg_database WHERE datname=$1',[database])).rows[0].count,'0');
    const target='elyqreth_restore_'+randomBytes(12).toString('hex'),bootstrap={...config.database,database:target};await admin.query(`CREATE DATABASE "${target}"`);
    const roles={expectedDatabase:target,runtimeRole:'dr_'+runId,migrationRole:'dm_'+runId,runtimePassword,migrationPassword};await provisionDatabase(bootstrap,roles);
    await restoreBackup({...bootstrap,user:roles.migrationRole,password:migrationPassword},{directory:mirror,id:metadata.id,expectedDatabase:target,expectedHost:bootstrap.host,environment:'isolated',confirmation:'RESTORE ISOLATED '+target},key,runner);
    recovery.provisionAndRestoreMs=Date.now()-started;
    const targetUrl=roleUrl(roles.runtimeRole,runtimePassword,target);restored=new Pool({connectionString:targetUrl,max:1});
    for(const name of Object.keys(metadata.counts))assert.deepEqual((await restored.query(`SELECT row_to_json(t)::text AS row FROM public.${name} t ORDER BY row_to_json(t)::text`)).rows,fixture.snapshotRows[name]);
    assert.equal((await restored.query("SELECT count(*) FROM owners WHERE name='committed after exported snapshot'")).rows[0].count,'0');
    const before=(await restored.query('SELECT id,status FROM executions ORDER BY id')).rows;
    app=await openApplication(targetUrl,false);
    const response=await fetch((await app.getUrl())+'/api/v1/collaboration-activity/'+fixture.session.id+'/snapshot',{headers:{authorization:'Bearer '+fixture.readToken},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);
    assert.deepEqual((await restored.query('SELECT id,status FROM executions ORDER BY id')).rows,before);
    recovery.applicationReadReadyMs=Date.now()-started;recovery.finishedAt=new Date().toISOString();recovery.snapshotAgeAtReadReadyMs=Date.now()-Date.parse(metadata.snapshotAt);
    recovery.observedPostSnapshotMarkerRowsLost=1;recovery.backupBytes=metadata.size;recovery.restoredTables=Object.keys(metadata.counts).length;recovery.status='PASS';
    recovery.scope='Continuous host-clock interval: close source pool, delete only labelled synthetic source database, create target/roles, decrypt/restore, compare every runtime table and read API. Same PG server survives; not host/region loss, browser access, native resume or an approved production RPO/RTO. One known post-snapshot marker is absent; no zero-data-loss claim.';
  }finally{await app?.close();await restored?.end();console.log('DISASTER_EVIDENCE '+JSON.stringify(recovery));}
});

after(async () => {
  await pool?.end(); await admin?.end();
  // Verify exact identity/labels before removing this run's disposable resources.
  if (containerCreated) {
    const state = JSON.parse(await docker('inspect', container))[0];
    assert.equal(state.Config.Labels[label], runId);
    assert.equal(state.Name, '/' + container);
    await docker('rm', '--force', container);
  }
  if (volumeCreated) {
    const state = JSON.parse(await docker('volume', 'inspect', volume))[0];
    assert.equal(state.Labels[label], runId);
    assert.equal(state.Name, volume);
    await docker('volume', 'rm', volume);
  }
  if(tlsCreated){const state=JSON.parse(await docker('volume','inspect',tlsVolume))[0];assert.equal(state.Labels[label],runId);assert.equal(state.Name,tlsVolume);await docker('volume','rm',tlsVolume);}
  if (temp) {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
    assert.ok(basename(temp).startsWith('elyqreth-t08-'));
    rmSync(temp, { recursive: true });
  }
}, { timeout: 120_000 });

