import 'reflect-metadata';
import { createHmac, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { loadConfiguration } from '../config/configuration';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { resolve } from 'node:path';
import { DatabaseConfiguration } from './database-configuration';
import { createPool } from './pool';
import { accessContract, DatabaseAccessError, identifier, runtimeTables, runtimeFunctions } from './access-policy';

export interface ProvisionRequest {
  expectedDatabase: string; runtimeRole: string; migrationRole: string;
  runtimePassword?: string; migrationPassword?: string;
  adoptExistingSchema?: boolean;
}
// PostgreSQL SCRAM verifier generation avoids sending plaintext passwords in SQL/logs.
export function passwordVerifier(password: string): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(password)) throw new DatabaseAccessError('New database passwords require 32-128 ASCII letters, digits, underscores or hyphens.');
  const salt = randomBytes(16), salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const client = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(client).digest('base64');
  const server = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
}

/** Explicit bootstrap-only operation. Never invoked by API startup or ordinary migrations. */
export async function provisionDatabase(config: DatabaseConfiguration, request: ProvisionRequest): Promise<void> {
  const runtime = identifier(request.runtimeRole), migration = identifier(request.migrationRole);
  const database = identifier(request.expectedDatabase);
  if (runtime === migration || config.database !== request.expectedDatabase ||
    [request.runtimeRole, request.migrationRole].includes(config.user)) throw new DatabaseAccessError();
  const pool = createPool(config), client = await pool.connect().catch(async () => { await pool.end(); throw new DatabaseAccessError(); });
  let locked = false;
  try {
    const identity = await client.query('SELECT current_database() AS name,current_user AS actor');
    if (identity.rows[0].name !== request.expectedDatabase) throw new DatabaseAccessError();
    locked = (await client.query('SELECT pg_try_advisory_lock(195023,3) AS locked')).rows[0].locked;
    if (!locked) throw new DatabaseAccessError('Migration lock busy. Stop deployment and retry after the active operation finishes.');
    await client.query('BEGIN');
    const existing = await accessContract(client, false);
    if (existing && (existing.runtime_role !== request.runtimeRole || existing.migration_role !== request.migrationRole || existing.database_name !== request.expectedDatabase)) throw new DatabaseAccessError();
    // Never adopt a populated legacy schema implicitly, or alter someone else's cluster roles.
    if (!existing) {
      const populated = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`);
      if (populated.rowCount && request.adoptExistingSchema !== true) throw new DatabaseAccessError('Existing schema requires an explicitly reviewed ownership transfer; bootstrap stopped without changes.');
      const tables = await client.query(`SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','S','f')`);
      if (tables.rows.some(r => r.owner !== identity.rows[0].actor || (r.nspname === 'public' ? !runtimeTables[r.relname] || r.relkind !== 'r' :
        !['__drizzle_migrations','__drizzle_migrations_id_seq'].includes(r.relname)))) throw new DatabaseAccessError('Unreviewed schema objects or ownership; provisioning stopped.');
      const functions = await client.query(`SELECT p.proname,p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.pronargs
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle')`);
      if (functions.rows.some(r => !runtimeFunctions.includes(r.proname) || r.owner !== identity.rows[0].actor || r.prosecdef || r.pronargs !== 0)) throw new DatabaseAccessError('Unreviewed schema functions; provisioning stopped.');
      if (populated.rowCount) {
        const applied = await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at');
        const expected = readMigrationFiles({migrationsFolder:resolve(__dirname,'../../migrations')});
        if (applied.rows.some((r,i)=>r.hash!==expected[i]?.hash || String(r.created_at)!==String(expected[i]?.folderMillis))) throw new DatabaseAccessError('Migration history differs; provisioning stopped.');
      }
    }
    for (const [name, password] of [[request.runtimeRole, request.runtimePassword], [request.migrationRole, request.migrationPassword]]) {
      const role = await client.query('SELECT * FROM pg_roles WHERE rolname=$1', [name]);
      if (role.rowCount) {
        if (!existing || password !== undefined) throw new DatabaseAccessError('Existing roles require the matching access contract and omitted password inputs. Credentials are never overwritten.');
        const r = role.rows[0];
        if (r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolreplication || r.rolbypassrls || !r.rolcanlogin) throw new DatabaseAccessError();
        if ((await client.query('SELECT 1 FROM pg_auth_members WHERE member=$1 OR roleid=$1 LIMIT 1', [r.oid])).rowCount) throw new DatabaseAccessError();
      } else {
        if (!password || existing) throw new DatabaseAccessError('New roles require explicit password inputs.');
        await client.query(`CREATE ROLE ${identifier(name!)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${name === request.runtimeRole ? 20 : 2} PASSWORD '${passwordVerifier(password)}'`);
      }
    }
    if (!existing && request.adoptExistingSchema) {
      const objects = await client.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','S') ORDER BY c.relkind='S'`);
      for (const r of objects.rows) await client.query(`ALTER ${r.relkind==='S'?'SEQUENCE':'TABLE'} ${identifier(r.nspname)}.${identifier(r.relname)} OWNER TO ${migration}`);
      for (const name of runtimeFunctions) {
        const found=await client.query('SELECT to_regprocedure($1) AS name',['public.'+name+'()']);
        if (found.rows[0].name) await client.query(`ALTER FUNCTION public.${identifier(name)}() OWNER TO ${migration}`);
      }
    }
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${runtime},${migration}`);
    // Drizzle checks database CREATE even for its existing journal schema. Runtime never receives it.
    await client.query(`GRANT CREATE ON DATABASE ${database} TO ${migration}`);
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`ALTER SCHEMA public OWNER TO ${migration}`);
    await client.query(`ALTER SCHEMA drizzle OWNER TO ${migration}`);
    await client.query('REVOKE ALL ON SCHEMA public,drizzle FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public,drizzle TO ${runtime}`);
    await client.query('CREATE SCHEMA IF NOT EXISTS elyqreth_ops');
    await client.query('REVOKE ALL ON SCHEMA elyqreth_ops FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS elyqreth_ops.access_contract (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), database_name text NOT NULL,
      runtime_role text NOT NULL,migration_role text NOT NULL,policy_version integer NOT NULL)`);
    if (!existing) await client.query(`INSERT INTO elyqreth_ops.access_contract(database_name,runtime_role,migration_role,policy_version)
      VALUES ($1,$2,$3,1)`, [request.expectedDatabase, request.runtimeRole, request.migrationRole]);
    await client.query(`GRANT USAGE ON SCHEMA elyqreth_ops TO ${runtime},${migration}`);
    await client.query(`GRANT SELECT ON elyqreth_ops.access_contract TO ${runtime},${migration}`);
    // Default privileges belong to the actual object creator. Global revocation matters for functions/types.
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE USAGE ON TYPES FROM PUBLIC`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(195023,3)').catch(() => {});
    client.release(); await pool.end();
  }
}

if (require.main === module) {
  void (async () => {
    const config = loadConfiguration().database;
    if (!config) throw new DatabaseAccessError();
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 8192) throw new DatabaseAccessError();
    }
    const request = JSON.parse(input);
    const keys = ['expectedDatabase','runtimeRole','migrationRole','runtimePassword','migrationPassword','adoptExistingSchema'];
    if (!request || Array.isArray(request) || Object.keys(request).some(k => !keys.includes(k)) ||
      ['expectedDatabase','runtimeRole','migrationRole'].some(k => typeof request[k] !== 'string') ||
      (request.adoptExistingSchema !== undefined && typeof request.adoptExistingSchema !== 'boolean') ||
      ['runtimePassword','migrationPassword'].some(k=>request[k]!==undefined && typeof request[k]!=='string')) throw new DatabaseAccessError();
    await provisionDatabase(config, request);
    process.stdout.write('Database access roles provisioned.\n');
  })().catch(() => { process.stderr.write('Database provisioning failed. Review target, bootstrap permissions and existing roles; no credentials are printed.\n'); process.exitCode = 1; });
}
