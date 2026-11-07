import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream, statSync, mkdtempSync, rmSync, unlinkSync, closeSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { DatabaseConfiguration } from './database-configuration';
import { createPool } from './pool';
import { accessContract, identifier, runtimeTables, verifyAccess, grantRuntimeAccess } from './access-policy';
import { passwordVerifier } from './provision';
import { migrationFolder } from './migrate';
import { BackupError, BackupMetadata, backupId, checksum, decryptArchive, directoryLock, encryptArchive,
  newBackupId, protectedFile, readAuthenticated, writeAuthenticated, recordAttempt } from './backup-files';

export interface PgProcess { input:Writable; output:Readable; done:Promise<void> }
export type PgRunner=(tool:'pg_dump'|'pg_restore',args:string[],env:NodeJS.ProcessEnv)=>PgProcess;
export const pgRunner:PgRunner=(tool,args,env)=>{
  const child=spawn(tool,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:300000,killSignal:'SIGKILL'});
  child.stderr.resume(); // Raw client errors may contain credentials or sensitive SQL. Never serialize them.
  const done=new Promise<void>((resolve,reject)=>{
    child.once('error',()=>reject(new BackupError('PostgreSQL 17 client tooling unavailable.')));
    child.once('close',code=>code===0?resolve():reject(new BackupError('PostgreSQL recovery tool failed; operation stopped.')));
  });
  return {input:child.stdin,output:child.stdout,done};
};
export interface RecoveryRequest { directory:string; expectedDatabase:string; expectedHost:string; }
export interface RestoreRequest extends RecoveryRequest { id:string; environment:'isolated'; confirmation:string; }
function cleanupTemporary(folder:string):void {
  if(dirname(resolve(folder))!==resolve(tmpdir())||!/^elyqreth-(backup|verify|restore)-/.test(basename(folder)))throw new BackupError('Refusing unsafe recovery scratch cleanup.');
  rmSync(folder,{recursive:true,force:true});
}
function target(config:DatabaseConfiguration,request:RecoveryRequest):void {
  identifier(request.expectedDatabase);
  if(config.database!==request.expectedDatabase||config.host!==request.expectedHost)throw new BackupError('Explicit database and host must match validated connection configuration.');
}
export function restoreTarget(config:DatabaseConfiguration,request:RestoreRequest):void {
  target(config,request);backupId(request.id);
  if(config.production||request.environment!=='isolated'||!['127.0.0.1','::1'].includes(config.host)||
    !/^elyqreth_restore_[a-f0-9]{24}$/.test(config.database)||request.confirmation!=='RESTORE ISOLATED '+config.database)
    throw new BackupError('Restore is restricted to explicitly confirmed, empty isolated loopback targets. Production restoration requires a separate operator procedure.');
}
function environment(config:DatabaseConfiguration,folder:string):NodeJS.ProcessEnv {
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('PG')||key.startsWith('DATABASE_'))delete env[key];
  Object.assign(env,{PGHOST:config.host,PGPORT:String(config.port),PGDATABASE:config.database,PGUSER:config.user,
    PGPASSWORD:config.password,PGSSLMODE:config.sslMode==='verify-full'?'verify-full':'disable',PGCONNECT_TIMEOUT:'10',
    PGAPPNAME:'elyqreth-recovery',PGOPTIONS:'-c statement_timeout=300000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=300000'});
  if(config.sslMode==='verify-full'){
    if(config.ca){const path=join(folder,'database-ca.pem');writeFileSync(path,config.ca,{mode:0o600,flag:'wx'});env.PGSSLROOTCERT=path;}
    else env.PGSSLROOTCERT='system';
  }
  return env;
}
async function textTool(runner:PgRunner,tool:'pg_dump'|'pg_restore',args:string[],env:NodeJS.ProcessEnv,input?:Readable):Promise<string>{
  const process=runner(tool,args,env),chunks:Buffer[]=[];let bytes=0;
  const output=(async()=>{for await(const chunk of process.output){bytes+=chunk.length;if(bytes>2*1024**2)throw new BackupError('Recovery tool output exceeded its bound.');chunks.push(Buffer.from(chunk));}})();
  const feed=input?pipeline(input,process.input):Promise.resolve(process.input.end());
  await Promise.all([output,feed,process.done]);return Buffer.concat(chunks).toString();
}
async function version(runner:PgRunner,env:NodeJS.ProcessEnv):Promise<string>{
  const value=await textTool(runner,'pg_dump',['--version'],env);
  const found=/PostgreSQL\) (17\.\d+)/.exec(value);
  if(!found||!/PostgreSQL\) 17\.\d+/.test(await textTool(runner,'pg_restore',['--version'],env)))throw new BackupError('PostgreSQL major 17 client tools are required.');return found[1]!;
}
export async function provisionBackupRole(config:DatabaseConfiguration,request:{expectedDatabase:string;expectedHost:string;role:string;password?:string}):Promise<void>{
  target(config,{...request,directory:''});const role=identifier(request.role),pool=createPool(config);
  const client=await pool.connect().catch(async()=>{await pool.end();throw new BackupError();});let locked=false;
  try{
    locked=(await client.query('SELECT pg_try_advisory_lock(195023,3) AS locked')).rows[0].locked;if(!locked)throw new BackupError('Database maintenance lock busy.');
    await client.query('BEGIN');
    const contract=await accessContract(client,true);
    const owner=await client.query("SELECT pg_get_userbyid(relowner)=current_user AS owned FROM pg_class WHERE oid='elyqreth_ops.access_contract'::regclass");
    if(!owner.rows[0]?.owned||[contract!.migration_role,contract!.runtime_role,config.user].includes(request.role))throw new BackupError('Backup role provisioning requires the original bootstrap owner and a separate login.');
    await client.query('ALTER TABLE elyqreth_ops.access_contract ADD COLUMN IF NOT EXISTS backup_role text');
    const existing=(await client.query('SELECT backup_role FROM elyqreth_ops.access_contract')).rows[0].backup_role;
    const found=(await client.query('SELECT * FROM pg_roles WHERE rolname=$1',[request.role])).rows[0];
    if(found){if(existing!==request.role||request.password!==undefined||!found.rolcanlogin||found.rolsuper||found.rolcreatedb||found.rolcreaterole||found.rolreplication||found.rolbypassrls||
      (await client.query('SELECT 1 FROM pg_auth_members WHERE member=$1 OR roleid=$1',[found.oid])).rowCount)throw new BackupError('Existing backup role is not safely bound; credentials are never overwritten.');}
    else{
      if(existing||!request.password)throw new BackupError('A new dedicated backup role requires an explicit password.');
      await client.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '${passwordVerifier(request.password)}'`);
    }
    await client.query('UPDATE elyqreth_ops.access_contract SET backup_role=$1',[request.role]);
    await client.query(`ALTER ROLE ${role} SET default_transaction_read_only=on`);
    await client.query(`GRANT CONNECT ON DATABASE ${identifier(config.database)} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public,drizzle,elyqreth_ops TO ${role}`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public,drizzle TO ${role}`);
    await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public,drizzle TO ${role}`);
    await client.query(`GRANT SELECT ON elyqreth_ops.access_contract TO ${role}`);
    const migration=identifier(contract!.migration_role);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public,drizzle GRANT SELECT ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public,drizzle GRANT SELECT ON SEQUENCES TO ${role}`);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{if(locked)await client.query('SELECT pg_advisory_unlock(195023,3)').catch(()=>{});client.release();await pool.end();}
}

export async function integrity(client:import('pg').PoolClient,expected?:BackupMetadata):Promise<{schema:BackupMetadata['schema'];counts:Record<string,string>;structureHash:string}> {
  const schema=(await client.query('SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
  const release=readMigrationFiles({migrationsFolder:migrationFolder});
  if(schema.length!==release.length||schema.some((r,i)=>r.hash!==release[i]?.hash||r.created_at!==String(release[i]?.folderMillis)))throw new BackupError('Database migration history does not match this release.');
  const counts:Record<string,string>={};
  for(const table of Object.keys(runtimeTables))counts[table]=(await client.query(`SELECT count(*)::text AS count FROM public.${identifier(table)}`)).rows[0].count;
  const definitions=await client.query(`SELECT c.conrelid::regclass::text AS table_name,c.conname,c.contype,c.conkey,CASE WHEN c.contype='c' THEN 'CHECK VALIDATED' ELSE pg_get_constraintdef(c.oid) END AS definition
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','drizzle') ORDER BY table_name,c.conname`);
  const structureHash=createHash('sha256').update(JSON.stringify(definitions.rows)).digest('hex');
  if(expected&&(structureHash!==expected.structureHash||JSON.stringify(schema)!==JSON.stringify(expected.schema)||JSON.stringify(counts)!==JSON.stringify(expected.counts)))throw new BackupError('Restored constraints, record counts or migration history differ from the backup snapshot.');
  const constraints=await client.query(`SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname IN ('public','drizzle') AND NOT c.convalidated LIMIT 1`);
  if(constraints.rowCount)throw new BackupError('Unvalidated database constraints require operator review.');
  // Native ownership/correlation and inbox history are also protected by the restored composite foreign keys.
  const orphan=await client.query(`SELECT 1 FROM executions e LEFT JOIN tasks t ON t.id=e.task_id AND t.owner_id=e.owner_id
    WHERE t.id IS NULL OR t.agent_id<>e.agent_id OR t.orchestrator_id<>e.orchestrator_id LIMIT 1`);
  if(orphan.rowCount)throw new BackupError('Restored execution routing is inconsistent.');
  const delegation=await client.query(`SELECT 1 FROM collaboration_delegations d
    JOIN tasks p ON p.id=d.parent_task_id LEFT JOIN tasks c ON c.id=d.child_task_id LEFT JOIN executions e ON e.id=d.child_execution_id
    WHERE p.owner_id<>d.owner_id OR p.agent_id<>d.source_agent_id OR
      (d.child_task_id IS NOT NULL AND (c.id IS NULL OR c.owner_id<>d.owner_id OR c.agent_id<>d.target_agent_id)) OR
      (d.child_execution_id IS NOT NULL AND (e.id IS NULL OR e.task_id<>d.child_task_id OR e.agent_id<>d.target_agent_id OR e.owner_id<>d.owner_id)) LIMIT 1`);
  if(delegation.rowCount)throw new BackupError('Restored delegation routing is inconsistent.');
  return {schema,counts,structureHash};
}

export async function createBackup(config:DatabaseConfiguration,request:RecoveryRequest,key:Buffer,runner:PgRunner=pgRunner):Promise<BackupMetadata>{
  target(config,request);
  return directoryLock(request.directory,async()=>{
    const id=newBackupId(),path=join(request.directory,id+'.backup');
    recordAttempt(request.directory,key,id,'STARTED');
    const folder=mkdtempSync(join(tmpdir(),'elyqreth-backup-'));
    const pool=createPool(config);let client:import('pg').PoolClient|undefined,created=false,metadataCreated=false,locked=false;
    try{
      client=await pool.connect();
      const contract=await accessContract(client,true);
      const binding=(await client.query('SELECT backup_role FROM elyqreth_ops.access_contract')).rows[0].backup_role;
      const role=(await client.query(`SELECT current_user AS name,current_database() AS database,current_setting('server_version_num')::int AS version,
        rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS elevated,
        (SELECT datdba=pg_roles.oid FROM pg_database WHERE datname=current_database()) AS database_owner,
        has_database_privilege(current_database(),'CREATE,TEMP') AS dbwrite,
        has_schema_privilege('public','CREATE') OR has_schema_privilege('drizzle','CREATE') OR has_schema_privilege('elyqreth_ops','CREATE') AS schemawrite,
        EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid OR roleid=pg_roles.oid) AS member FROM pg_roles WHERE rolname=current_user`)).rows[0];
      if(!contract||binding!==role.name||role.database!==config.database||role.database!==contract.database_name||role.database_owner||role.dbwrite||role.schemawrite||role.elevated||role.member||Math.floor(role.version/10000)!==17)throw new BackupError('Backup requires its dedicated restricted PostgreSQL 17 login.');
      const writable=await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle','elyqreth_ops')
        AND c.relkind='r' AND has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') LIMIT 1`);
      if(writable.rowCount)throw new BackupError('Backup credentials must be read-only.');
      const columns=await client.query(`SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','drizzle','elyqreth_ops') AND a.attnum>0 AND NOT a.attisdropped
        AND CASE WHEN c.relkind='r' THEN has_column_privilege(c.oid,a.attnum,'INSERT,UPDATE,REFERENCES') ELSE false END LIMIT 1`);
      if(columns.rowCount)throw new BackupError('Backup credentials must not have column-level write grants.');
      locked=(await client.query('SELECT pg_try_advisory_lock(195023,3) AS locked')).rows[0].locked;
      if(!locked)throw new BackupError('Source database maintenance lock busy.');
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL idle_in_transaction_session_timeout='300000'");
      const snapshotAt=(await client.query('SELECT transaction_timestamp() AS time')).rows[0].time.toISOString();
      const summary=await integrity(client);
      const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
      const env=environment(config,folder),toolVersion=await version(runner,env);
      const process=runner('pg_dump',['--no-password','--format=custom','--schema=public','--schema=drizzle','--strict-names',
        '--no-owner','--no-acl','--no-tablespaces','--no-security-labels','--no-publications','--no-subscriptions','--snapshot='+snapshot],env);
      process.input.end();
      const results=await Promise.allSettled([encryptArchive(process.output,path,key).then(()=>{created=true;}),process.done]);
      if(results.some(r=>r.status==='rejected'))throw new BackupError('PostgreSQL dump or encryption failed; no recovery point was published.');
      await client.query('COMMIT');
      const metadata:BackupMetadata={version:1,id,createdAt:new Date().toISOString(),database:config.database,serverVersion:role.version,
        toolVersion,applicationVersion:(require('../../package.json') as {version:string}).version,snapshotAt,
        format:'pg-custom-aes256gcm-v1',size:statSync(path).size,sha256:await checksum(path),...summary};
      writeAuthenticated(join(request.directory,id+'.json'),metadata,key);
      metadataCreated=true;
      const archive=join(folder,'verification.dump');await decryptArchive(request.directory,id,key,archive);
      await textTool(runner,'pg_restore',['--list'],env,createReadStream(archive));
      recordAttempt(request.directory,key,id,'COMPLETE');
      return metadata;
    }catch(error){await client?.query('ROLLBACK').catch(()=>{});if(created)unlinkSync(path);if(metadataCreated)unlinkSync(join(request.directory,id+'.json'));recordAttempt(request.directory,key,id,'FAILED');throw error;}
    finally{if(locked)await client?.query('SELECT pg_advisory_unlock(195023,3)').catch(()=>{});client?.release();await pool.end();cleanupTemporary(folder);}
  });
}

export async function verifyBackup(directory:string,id:string,key:Buffer,runner:PgRunner=pgRunner):Promise<BackupMetadata>{
  return directoryLock(directory,async()=>{
    const folder=mkdtempSync(join(tmpdir(),'elyqreth-verify-')),archive=join(folder,'archive.dump');
    try{const metadata=await decryptArchive(directory,id,key,archive);
      await version(runner,process.env);await textTool(runner,'pg_restore',['--list'],process.env,createReadStream(archive));return metadata;
    }finally{cleanupTemporary(folder);}
  });
}

export async function restoreBackup(config:DatabaseConfiguration,request:RestoreRequest,key:Buffer,runner:PgRunner=pgRunner):Promise<BackupMetadata>{
  restoreTarget(config,request);
  return directoryLock(request.directory,async()=>{
    const folder=mkdtempSync(join(tmpdir(),'elyqreth-restore-')),archive=join(folder,'archive.dump');
    const pool=createPool(config);let client:import('pg').PoolClient|undefined,locked=false;
    try{
      const metadata=await decryptArchive(request.directory,request.id,key,archive),env=environment(config,folder);
      await version(runner,env);await textTool(runner,'pg_restore',['--list'],env,createReadStream(archive));
      client=await pool.connect();const contract=await verifyAccess(client,'migration',true);
      locked=(await client.query('SELECT pg_try_advisory_lock(195023,3) AS locked')).rows[0].locked;
      if(!locked)throw new BackupError('Restore target maintenance lock busy.');
      const occupied=await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S','v','m','f')
        UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle') LIMIT 1`);
      if(occupied.rowCount)throw new BackupError('Restore target is not empty. Existing data will never be overwritten.');
      // Only empty, owned schemas may be removed, without CASCADE. A concurrent object makes this fail safely.
      await client.query('BEGIN');await client.query('DROP SCHEMA public');await client.query('DROP SCHEMA drizzle');await client.query('COMMIT');
      await textTool(runner,'pg_restore',['--no-password','--exit-on-error','--single-transaction','--no-owner','--no-acl',
        '--no-tablespaces','--no-security-labels','--no-publications','--no-subscriptions','--dbname='+config.database],env,createReadStream(archive));
      await grantRuntimeAccess(client,contract!);
      await integrity(client,metadata);
      const receipt=join(request.directory,request.id+'.restored.json');
      try{const existing=readAuthenticated<{id:string}>(receipt,key);if(existing.id!==request.id)throw new BackupError();}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
        writeAuthenticated(receipt,{id:request.id,restoredAt:new Date().toISOString(),target:config.database,counts:metadata.counts,quarantined:true},key);}
      return metadata;
    }catch(error){await client?.query('ROLLBACK').catch(()=>{});throw error;}
    finally{if(locked)await client?.query('SELECT pg_advisory_unlock(195023,3)').catch(()=>{});client?.release();await pool.end();cleanupTemporary(folder);}
  });
}
