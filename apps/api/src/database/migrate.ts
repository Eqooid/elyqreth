import 'reflect-metadata';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { loadConfiguration, ConfigurationError } from '../config/configuration';
import { createPool, DatabaseConnectionError } from './pool';
import { DatabaseAccessError, verifyAccess, grantRuntimeAccess } from './access-policy';

export const migrationFolder = resolve(__dirname, '../../migrations');

export async function migrateDatabase(config = loadConfiguration().database, preflight = false, directory = migrationFolder): Promise<{applied:number; pending:number}> {
  if (!config) throw new ConfigurationError(['DATABASE_URL']);
  if (config.production && config.migrationTarget !== config.database) throw new ConfigurationError(['DATABASE_MIGRATION_TARGET']);
  const pool = createPool(config);
  const client = await pool.connect().catch(async () => { await pool.end(); throw new DatabaseConnectionError(); });
  let locked = false;
  try {
    // One migrator at a time. The lock is session-local and released in finally.
    locked = (await client.query('SELECT pg_try_advisory_lock(195023, 3) AS locked')).rows[0].locked;
    if (!locked) throw new DatabaseAccessError('Migration lock busy. Stop deployment and retry after the active operation finishes.');
    const contract = await verifyAccess(client, 'migration', !!config.production);
    const identity = await client.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version");
    if (identity.rows[0].name !== config.database || (contract && Math.floor(identity.rows[0].version / 10000) !== 17)) throw new DatabaseAccessError();
    const expected = readMigrationFiles({ migrationsFolder: directory });
    let appliedCount = 0;
    const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS journal");
    if (exists.rows[0]?.journal) {
      const applied = await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at');
      appliedCount = applied.rows.length;
      if (applied.rows.some((row, i) => row.hash !== expected[i]?.hash || String(row.created_at) !== String(expected[i]?.folderMillis))) {
        throw new Error('Migration history differs from the versioned files. Restore history or use a reviewed forward fix.');
      }
    }
    const result = { applied: appliedCount, pending: expected.length - appliedCount };
    if (preflight) return result;
    await migrate(drizzle(client), { migrationsFolder: directory });
    if (contract) await grantRuntimeAccess(client, contract);
    return result;
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(195023, 3)'); }
    finally { client.release(); await pool.end(); }
  }
}

if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== '--preflight') || process.argv.length > 3) {
    process.stderr.write('Supported migration argument: --preflight.\n'); process.exitCode = 1;
  } else void migrateDatabase(undefined, process.argv.includes('--preflight')).then(result => process.stdout.write(process.argv.includes('--preflight') ? JSON.stringify(result)+'\n' : 'Database migrations applied.\n')).catch((error: unknown) => {
    // Never print driver errors: they may include SQL values and credentials.
    process.stderr.write(error instanceof ConfigurationError || error instanceof DatabaseConnectionError || error instanceof DatabaseAccessError
      ? error.message + '\n' : 'Database migration failed. Check connectivity, migration history and database permissions.\n');
    process.exitCode = 1;
  });
}
