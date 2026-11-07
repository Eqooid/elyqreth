import { Pool, PoolClient } from 'pg';

export class DatabaseAccessError extends Error {
  constructor(message = 'Database access contract invalid. Review role provisioning and migration readiness.') { super(message); }
}

// Explicitly reviewed application operations. New tables are denied until reviewed here.
export const runtimeTables: Readonly<Record<string, string>> = Object.freeze({
  owners: 'SELECT', orchestrators: 'SELECT,INSERT,UPDATE', agents: 'SELECT,INSERT,UPDATE',
  tasks: 'SELECT,INSERT,UPDATE', executions: 'SELECT,INSERT,UPDATE',
  execution_results: 'SELECT,INSERT', owner_streams: 'SELECT,INSERT,UPDATE',
  agent_events: 'SELECT,INSERT', event_outbox: 'SELECT,INSERT', command_audit: 'SELECT,INSERT',
  city_agent_bindings: 'SELECT,INSERT,UPDATE', collaboration_sessions: 'SELECT,INSERT,UPDATE',
  collaboration_participants: 'SELECT,INSERT,UPDATE', collaboration_delegations: 'SELECT,INSERT,UPDATE',
  external_sources: 'SELECT,INSERT,UPDATE', external_agent_mappings: 'SELECT,INSERT,UPDATE',
  external_event_inbox: 'SELECT,INSERT,UPDATE', external_execution_mappings: 'SELECT,INSERT,UPDATE',
  local_accounts: 'SELECT,INSERT,UPDATE', auth_sessions: 'SELECT,INSERT,UPDATE,DELETE', auth_login_limits: 'SELECT,INSERT,UPDATE',
});
export const identifier = (value: string): string => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new DatabaseAccessError();
  return '"' + value + '"';
};
export const runtimeFunctions = Object.freeze(['elyqreth_touch_record','elyqreth_immutable_columns',
  'elyqreth_reject_history_mutation','elyqreth_terminal_record','elyqreth_assign_event_position',
  'elyqreth_enqueue_event','elyqreth_collaboration_guard','elyqreth_external_mapping_guard','elyqreth_external_inbox_guard']);
export interface AccessContract { runtime_role: string; migration_role: string; database_name: string; policy_version: number }
type Queryable = Pool | PoolClient;

export async function accessContract(db: Queryable, required: boolean): Promise<AccessContract | undefined> {
  const exists = await db.query("SELECT to_regclass('elyqreth_ops.access_contract') AS name");
  if (!exists.rows[0]?.name) {
    if (required) throw new DatabaseAccessError();
    return undefined;
  }
  const { rows } = await db.query('SELECT runtime_role,migration_role,database_name,policy_version FROM elyqreth_ops.access_contract');
  if (rows.length !== 1 || rows[0].policy_version !== 1) throw new DatabaseAccessError();
  return rows[0];
}

export async function verifyAccess(db: Queryable, kind: 'runtime' | 'migration', required: boolean): Promise<AccessContract | undefined> {
  const contract = await accessContract(db, required);
  if (!contract) return;
  const { rows: [role] } = await db.query(`SELECT current_user AS name,current_database() AS database,
    r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS member,
    (SELECT datdba=r.oid FROM pg_database WHERE datname=current_database()) AS dbowner
    FROM pg_roles r WHERE rolname=current_user`);
  if (role.name !== contract[kind === 'runtime' ? 'runtime_role' : 'migration_role'] ||
    role.database !== contract.database_name || role.rolsuper || role.rolcreatedb || role.rolcreaterole ||
    role.rolreplication || role.rolbypassrls || role.member || role.dbowner) throw new DatabaseAccessError();
  const { rows: [schema] } = await db.query(`SELECT
    has_database_privilege(current_database(),'CREATE') AS dbcreate,
    has_database_privilege(current_database(),'TEMP') AS temporary,
    has_schema_privilege('public','CREATE') AS publiccreate,
    has_schema_privilege('drizzle','CREATE') AS journalcreate,
    has_schema_privilege('elyqreth_ops','CREATE') AS controlcreate,
    (SELECT bool_and(pg_get_userbyid(nspowner)=$1) FROM pg_namespace WHERE nspname IN ('public','drizzle')) AS owned`, [contract.migration_role]);
  if ((kind === 'runtime' && schema.dbcreate) || schema.temporary || schema.controlcreate || !schema.owned ||
    (kind === 'runtime' && (schema.publiccreate || schema.journalcreate))) throw new DatabaseAccessError();
  const control = await db.query(`SELECT has_table_privilege('elyqreth_ops.access_contract','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable`);
  if (control.rows[0].writable) throw new DatabaseAccessError();
  const controlColumns = await db.query(`SELECT 1 FROM pg_attribute WHERE attrelid='elyqreth_ops.access_contract'::regclass
    AND attnum>0 AND NOT attisdropped AND has_column_privilege(attrelid,attnum,'INSERT,UPDATE,REFERENCES') LIMIT 1`);
  if (controlColumns.rowCount) throw new DatabaseAccessError();
  const boundaries = await db.query(`SELECT
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='elyqreth_ops' AND pg_get_userbyid(c.relowner) IN ($1,$2)) AS controlowner,
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','drizzle','elyqreth_ops','information_schema')
      AND nspname NOT LIKE 'pg_%' AND has_schema_privilege(oid,'USAGE')) AS unrelated`, [contract.runtime_role,contract.migration_role]);
  if (boundaries.rows[0].controlowner || boundaries.rows[0].unrelated) throw new DatabaseAccessError();
  if (kind === 'migration') {
    const owners = await db.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','S','f')
      AND pg_get_userbyid(c.relowner)<>$1 LIMIT 1`, [contract.migration_role]);
    if (owners.rowCount || !schema.dbcreate || !schema.publiccreate || !schema.journalcreate) throw new DatabaseAccessError();
  }
  if (kind === 'runtime') {
    const { rows } = await db.query(`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,
      has_table_privilege(c.oid,'SELECT') AS s,has_table_privilege(c.oid,'INSERT') AS i,
      has_table_privilege(c.oid,'UPDATE') AS u,
      has_table_privilege(c.oid,'DELETE') AS d,
      has_table_privilege(c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS forbidden
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')`);
    for (const [name, grants] of Object.entries(runtimeTables)) {
      const row = rows.find(r => r.relname === name);
      if (!row || row.owner !== contract.migration_role || row.forbidden ||
        row.s !== grants.includes('SELECT') || row.i !== grants.includes('INSERT') || row.u !== grants.includes('UPDATE') || row.d !== grants.includes('DELETE')) throw new DatabaseAccessError();
    }
    if (rows.some(row => !runtimeTables[row.relname] && (row.s || row.i || row.u || row.d || row.forbidden))) throw new DatabaseAccessError();
    const columns = await db.query(`SELECT c.relname,n.nspname,
      bool_or(has_column_privilege(c.oid,a.attnum,'INSERT')) AS i,
      bool_or(has_column_privilege(c.oid,a.attnum,'UPDATE')) AS u,
      bool_or(has_column_privilege(c.oid,a.attnum,'REFERENCES')) AS ref
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
      GROUP BY c.oid,n.nspname`);
    if (columns.rows.some(r => r.ref || (r.i && !runtimeTables[r.nspname==='public'?r.relname:'']?.includes('INSERT')) ||
      (r.u && !runtimeTables[r.nspname==='public'?r.relname:'']?.includes('UPDATE')))) throw new DatabaseAccessError();
    const journal = await db.query(`SELECT has_table_privilege('drizzle.__drizzle_migrations','SELECT') AS readable,
      has_table_privilege('drizzle.__drizzle_migrations','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable`);
    if (!journal.rows[0].readable || journal.rows[0].writable) throw new DatabaseAccessError();
    const unsafe = await db.query(`SELECT
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND has_function_privilege(p.oid,'EXECUTE') AND (p.prosecdef OR NOT p.proname=ANY($1::text[]))) AS functions,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle')
        AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS sequences`, [runtimeFunctions]);
    if (unsafe.rows[0].functions || unsafe.rows[0].sequences) throw new DatabaseAccessError();
  }
  return contract;
}

/** Runs after Drizzle's transactional SQL batch under the same session lock. */
export async function grantRuntimeAccess(db: PoolClient, contract: AccessContract): Promise<void> {
  const runtime = identifier(contract.runtime_role);
  await db.query('BEGIN');
  try {
    await db.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public,drizzle FROM PUBLIC,${runtime}`);
    await db.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public,drizzle FROM PUBLIC,${runtime}`);
    await db.query('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
    await db.query(`GRANT USAGE ON SCHEMA public,drizzle TO ${runtime}`);
    for (const [table, grants] of Object.entries(runtimeTables)) {
      await db.query(`GRANT ${grants} ON TABLE public.${identifier(table)} TO ${runtime}`);
    }
    await db.query(`GRANT SELECT ON drizzle.__drizzle_migrations TO ${runtime}`);
    for (const name of runtimeFunctions) {
      await db.query(`GRANT EXECUTE ON FUNCTION public.${identifier(name)}() TO ${runtime}`);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
