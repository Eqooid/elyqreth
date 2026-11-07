const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, basename, resolve } = require('node:path');
const { Pool } = require('pg');
const { migrateDatabase, migrationFolder } = require('../dist/database/migrate');
const { validateEnvironment } = require('../dist/config/configuration');
const { provisionDatabase } = require('../dist/database/provision');
const { verifyAccess, runtimeTables } = require('../dist/database/access-policy');
const run = promisify(execFile);
const migrationCount = JSON.parse(readFileSync(join(migrationFolder, 'meta/_journal.json'), 'utf8')).entries.length;
const runId = randomBytes(12).toString('hex');
const container = `elyqreth_t07_test_${runId}`;
const volume = `${container}_data`;
const database = `elyqreth_test_${runId}`;
const password = randomBytes(24).toString('hex');
const label = 'elyqreth.roles.run';
const runtimeRole = 'app_'+runId, migrationRole = 'migration_'+runId;
const runtimePassword=randomBytes(32).toString('base64url'),migrationPassword=randomBytes(32).toString('base64url');
let temp, admin, pool, config, url, containerCreated = false, volumeCreated = false;
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
  temp = mkdtempSync(join(tmpdir(), 'elyqreth-t07-'));
  writeFileSync(join(temp, 'postgres.env'), `POSTGRES_USER=elyqreth_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=postgres\n`, { mode: 0o600 });
  const compose = readFileSync(join(__dirname, '../../../docker-compose.yml'), 'utf8');
  const image = compose.match(/^\s+image:\s+(postgres:\S+@sha256:[a-f0-9]{64})\s*$/m)?.[1];
  assert.ok(image, 'Tests require the pinned official PostgreSQL image from Compose');
  await docker('volume', 'create', '--label', `${label}=${runId}`, volume); volumeCreated = true;
  await docker('run', '--detach', '--name', container, '--label', `${label}=${runId}`,
    '--env-file', join(temp, 'postgres.env'), '-p', '127.0.0.1::5432',
    '--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`,
    '--health-cmd', 'pg_isready -U elyqreth_test -d postgres', '--health-interval', '1s', '--health-timeout', '2s', '--health-retries', '60', image);
  containerCreated = true;
  await waitReady();
  const state = JSON.parse(await docker('inspect', container))[0];
  const mapping = state.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(mapping.HostIp, '127.0.0.1');
  url = `postgresql://elyqreth_test:${password}@127.0.0.1:${mapping.HostPort}/${database}`;
  config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, DATABASE_SSL_MODE: 'disable' });
  const connection = { host: '127.0.0.1', port: Number(mapping.HostPort), user: 'elyqreth_test', password,
    connectionTimeoutMillis: 5000, statement_timeout: 10000 };
  admin = new Pool({ ...connection, database: 'postgres', max: 1 });
  admin.on('error', () => {});
  assert.match(database, /^elyqreth_test_[a-f0-9]{24}$/);
  await admin.query(`CREATE DATABASE "${database}"`);

  pool = new Pool({ ...connection, database, max: 5 });
  pool.on('error', () => {}); // A test intentionally restarts this isolated server.
}, { timeout: 120_000 });

function roleConfig(user, password) {
  return { ...config.database, user, password };
}
function request(passwords=false) {
  return { expectedDatabase:database,runtimeRole,migrationRole,
    ...(passwords?{runtimePassword,migrationPassword}:{}) };
}
test('bootstrap provisions two restricted SCRAM logins atomically and never overwrites credentials', async()=>{
  await assert.rejects(verifyAccess(pool,'runtime',true),/access contract/);
  await provisionDatabase(config.database,request(true));
  await provisionDatabase(config.database,request());
  await assert.rejects(provisionDatabase(config.database,request(true)),/never overwritten/);
  await assert.rejects(provisionDatabase(config.database,{...request(),expectedDatabase:'wrong_target'}));
  const roles=await pool.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1)',[[runtimeRole,migrationRole]]);
  assert.equal(roles.rowCount,2);
  for(const r of roles.rows)assert.ok(!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls);
});
test('read-only preflight reports pending migrations; runtime and admin credentials cannot migrate',async()=>{
  const migration=roleConfig(migrationRole,migrationPassword);
  const wrong=new Pool({...migration,ssl:false,max:1});
  try{await assert.rejects(verifyAccess(wrong,'runtime',true),/access contract/);}finally{await wrong.end();}
  assert.deepEqual(await migrateDatabase(migration,true),{applied:0,pending:migrationCount});
  assert.equal((await pool.query("SELECT to_regclass('public.agents') AS name")).rows[0].name,null);
  await assert.rejects(migrateDatabase(roleConfig(runtimeRole,runtimePassword)),/access contract/);
  await assert.rejects(migrateDatabase(config.database),/access contract/);
  await migrateDatabase(migration);
  assert.deepEqual(await migrateDatabase(migration,true),{applied:migrationCount,pending:0});
  await migrateDatabase(migration);
});
test('runtime role has exact reviewed table grants and no DDL, journal writes or administrative access',async()=>{
  const runtime=new Pool({...roleConfig(runtimeRole,runtimePassword),ssl:false,max:1});
  try{
    await verifyAccess(runtime,'runtime',true);
    for(const name of Object.keys(runtimeTables))await runtime.query(`SELECT * FROM public.${name} LIMIT 0`);
    for(const text of ['CREATE SCHEMA forbidden','CREATE TABLE public.forbidden(id int)',
      'ALTER TABLE public.agents ADD COLUMN forbidden int','DROP TABLE public.agents',
      'CREATE ROLE forbidden SUPERUSER',`ALTER DATABASE "${database}" OWNER TO "${runtimeRole}"`,
      'CREATE TEMP TABLE forbidden(id int)',"SELECT pg_read_file('/etc/passwd')",
      "INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('bad',1)",
      "UPDATE elyqreth_ops.access_contract SET policy_version=2",
      "SELECT nextval('drizzle.__drizzle_migrations_id_seq')"]){
      await assert.rejects(runtime.query(text),e=>['42501','2BP01'].includes(e.code));
    }
    const owner=(await pool.query("INSERT INTO owners(name) VALUES ('role-fixture') RETURNING id")).rows[0].id;
    await runtime.query('BEGIN');
    const orchestrator=(await runtime.query("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'native','test') RETURNING id",[owner])).rows[0].id;
    const agent=(await runtime.query("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'Agent','RULE_BASED') RETURNING id",[owner,orchestrator])).rows[0].id;
    const task=(await runtime.query("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,'{}') RETURNING id",[owner,agent,orchestrator])).rows[0].id;
    await runtime.query("UPDATE tasks SET status='RUNNING' WHERE id=$1",[task]);
    await runtime.query(`INSERT INTO agent_events(owner_id,agent_id,task_id,orchestrator_id,correlation_id,aggregate_type,aggregate_id,aggregate_version,aggregate_sequence,event_type,occurred_at)
      VALUES ($1,$2,$3,$4,$5,'task',$3,1,1,'task.created',now())`,[owner,agent,task,orchestrator,randomUUID()]);
    assert.equal((await runtime.query('SELECT count(*) FROM event_outbox WHERE owner_id=$1',[owner])).rows[0].count,'1');
    await runtime.query('COMMIT');
  }finally{await runtime.end();}
});
test('migration lock fails promptly and releases after disconnection; failed SQL preserves journal and rolls back DDL',async()=>{
  const lock=await pool.connect();
  await lock.query('SELECT pg_advisory_lock(195023,3)');
  const started=Date.now();
  await assert.rejects(migrateDatabase(roleConfig(migrationRole,migrationPassword)),/lock busy/);
  assert.ok(Date.now()-started<5000);
  lock.release(true);
  await migrateDatabase(roleConfig(migrationRole,migrationPassword));
  const migrator=new Pool({...roleConfig(migrationRole,migrationPassword),ssl:false,max:1});
  try{
    const before=(await migrator.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count;
    await migrator.query('BEGIN');await migrator.query('CREATE TABLE public.failure_probe(id int)');
    await assert.rejects(migrator.query('SELECT definitely_missing_function()'));
    await migrator.query('ROLLBACK');
    assert.equal((await migrator.query("SELECT to_regclass('public.failure_probe') AS name")).rows[0].name,null);
    assert.equal((await migrator.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,before);
    await migrator.query('CREATE TABLE public.future_probe(id int)');
    await migrator.query("CREATE FUNCTION public.future_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    const grants=await pool.query("SELECT has_table_privilege($1,'public.future_probe','SELECT') AS t,has_function_privilege($1,'public.future_probe()','EXECUTE') AS f",[runtimeRole]);
    assert.equal(grants.rows[0].t,false);assert.equal(grants.rows[0].f,false);
    await migrator.query('DROP TABLE public.future_probe');await migrator.query('DROP FUNCTION public.future_probe()');
  }finally{await migrator.end();}
});
test('production requires access policy and explicit migration target; drift and role elevation fail closed',async()=>{
  await assert.rejects(migrateDatabase({...roleConfig(migrationRole,migrationPassword),production:true}),/DATABASE_MIGRATION_TARGET/);
  await pool.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)',['drift']);
  await assert.rejects(migrateDatabase(roleConfig(migrationRole,migrationPassword)),/Migration history differs/);
  const {readMigrationFiles}=require('drizzle-orm/migrator');
  await pool.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)',[readMigrationFiles({migrationsFolder:migrationFolder})[0].hash]);
  await pool.query(`GRANT UPDATE(name) ON owners TO "${runtimeRole}"`);
  const columns=new Pool({...roleConfig(runtimeRole,runtimePassword),ssl:false,max:1});
  try{await assert.rejects(verifyAccess(columns,'runtime',true),/access contract/);}
  finally{await columns.end();await pool.query(`REVOKE UPDATE(name) ON owners FROM "${runtimeRole}"`);}
  await pool.query(`ALTER ROLE "${runtimeRole}" CREATEDB`);
  const runtime=new Pool({...roleConfig(runtimeRole,runtimePassword),ssl:false,max:1});
  try{await assert.rejects(verifyAccess(runtime,'runtime',true),/access contract/);}
  finally{await runtime.end();await pool.query(`ALTER ROLE "${runtimeRole}" NOCREATEDB`);}
});

test('real migration runner rolls back a failed pending batch and releases its lock',async()=>{
  const directory=join(temp,'failed-migrations');cpSync(migrationFolder,directory,{recursive:true});
  const file=join(directory,'meta/_journal.json'),journal=JSON.parse(readFileSync(file,'utf8'));
  const last=journal.entries.at(-1);
  journal.entries.push({idx:last.idx+1,version:last.version,when:last.when+1,tag:'9999_failure_probe',breakpoints:true});
  writeFileSync(file,JSON.stringify(journal));
  writeFileSync(join(directory,'9999_failure_probe.sql'),'CREATE TABLE public.failed_batch(id int);\n--> statement-breakpoint\nSELECT definitely_missing_function();');
  await assert.rejects(migrateDatabase(roleConfig(migrationRole,migrationPassword),false,directory));
  assert.equal((await pool.query("SELECT to_regclass('public.failed_batch') AS name")).rows[0].name,null);
  assert.equal((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,String(migrationCount));
  await migrateDatabase(roleConfig(migrationRole,migrationPassword));
});

test('populated schema requires explicit reviewed adoption and preserves data, history and owners',async()=>{
  const name='adopt_'+runId;
  await admin.query(`CREATE DATABASE "${name}"`);
  const databaseConfig={...config.database,database:name};
  await migrateDatabase(databaseConfig);
  const db=new Pool({...databaseConfig,ssl:false,max:1});
  try{
    const owner=(await db.query("INSERT INTO owners(name) VALUES ('preserved') RETURNING id")).rows[0].id;
    const input={expectedDatabase:name,runtimeRole:'r_'+runId,migrationRole:'m_'+runId,runtimePassword,migrationPassword};
    await assert.rejects(provisionDatabase(databaseConfig,input),/ownership transfer/);
    await provisionDatabase(databaseConfig,{...input,adoptExistingSchema:true});
    await migrateDatabase({...databaseConfig,user:input.migrationRole,password:migrationPassword});
    const runtime=new Pool({...databaseConfig,user:input.runtimeRole,password:runtimePassword,ssl:false,max:1});
    try{
      await verifyAccess(runtime,'runtime',true);
      assert.equal((await runtime.query('SELECT name FROM owners WHERE id=$1',[owner])).rows[0].name,'preserved');
    }finally{await runtime.end();}
  }finally{await db.end();}
});

test('post-SQL grant failure stops migration, preserves truthful metadata and recovers through a forward fix',async()=>{
  const name='acl_'+runId;await admin.query(`CREATE DATABASE "${name}"`);
  const bootstrap={...config.database,database:name},request={expectedDatabase:name,runtimeRole:'ar_'+runId,
    migrationRole:'am_'+runId,runtimePassword,migrationPassword};
  await provisionDatabase(bootstrap,request);
  const migration={...bootstrap,user:request.migrationRole,password:migrationPassword};
  await migrateDatabase(migration);
  const directory=join(temp,'acl-migrations');cpSync(migrationFolder,directory,{recursive:true});
  const file=join(directory,'meta/_journal.json'),journal=JSON.parse(readFileSync(file,'utf8')),last=journal.entries.at(-1);
  journal.entries.push({idx:last.idx+1,version:last.version,when:last.when+1,tag:'9997_bad_acl_contract',breakpoints:true});
  writeFileSync(file,JSON.stringify(journal));
  writeFileSync(join(directory,'9997_bad_acl_contract.sql'),'ALTER TABLE public.agents RENAME TO grant_failure_probe;');
  await assert.rejects(migrateDatabase(migration,false,directory));
  const inspect=new Pool({...bootstrap,ssl:false,max:1});
  try{
    assert.equal((await inspect.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,String(migrationCount+1));
    const runtime=new Pool({...bootstrap,user:request.runtimeRole,password:runtimePassword,ssl:false,max:1});
    try{await assert.rejects(verifyAccess(runtime,'runtime',true),/access contract/);}finally{await runtime.end();}
    journal.entries.push({idx:last.idx+2,version:last.version,when:last.when+2,tag:'9998_forward_acl_fix',breakpoints:true});
    writeFileSync(file,JSON.stringify(journal));
    writeFileSync(join(directory,'9998_forward_acl_fix.sql'),'ALTER TABLE public.grant_failure_probe RENAME TO agents;');
    await migrateDatabase(migration,false,directory);
    assert.equal((await inspect.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,String(migrationCount+2));
  }finally{await inspect.end();}
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
  if (temp) {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
    assert.ok(basename(temp).startsWith('elyqreth-t07-'));
    rmSync(temp, { recursive: true });
  }
}, { timeout: 120_000 });

const row=async(text,params=[]) => (await pool.query(text,params)).rows[0];
const getUrl=()=>{const target=new URL(url);target.username=runtimeRole;target.password=runtimePassword;return target.href;};
test('restricted runtime supports real local login, bounded session cleanup, principal and logout',async()=>{
  const owner=await row("INSERT INTO owners(name) VALUES ('role-auth') RETURNING id");
  const {createApplication}=require('../dist/application');
  const {AuthenticationService}=require('../dist/auth/auth.service');
  const app=await createApplication(validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',
    AUTH_MODE:'local',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id}));
  try{
    await app.listen(0,'127.0.0.1');
    const password=randomBytes(32).toString('base64url');
    await app.get(AuthenticationService).provision({username:'operator',password,role:'operator'},'create');
    const request=async(path,body,token)=>fetch((await app.getUrl())+'/api/v1/auth/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=await request('login',{username:'operator',password});assert.equal(login.status,200);
    const token=(await login.json()).accessToken;
    assert.equal((await request('me',null,token)).status,200);
    assert.equal((await request('logout',{},token)).status,200);
    assert.equal((await request('me',null,token)).status,401);
  }finally{await app.close();}
});
require('./native-coordination.integration.cjs')({row,getUrl,getPool:()=>pool});
require('./collaboration-activity.integration.cjs')({row,getUrl,getPool:()=>pool});
require('./runtime-drain.integration.cjs')({row,getUrl,getPool:()=>pool});
require('./external-ingestion.integration.cjs')({row,getUrl,getPool:()=>pool,securityOnly:true});
