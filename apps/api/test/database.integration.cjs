const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, basename, resolve } = require('node:path');
const { Pool } = require('pg');
const { sql } = require('drizzle-orm');
const { migrateDatabase, migrationFolder } = require('../dist/database/migrate');
const { validateEnvironment } = require('../dist/config/configuration');
const { createApplication } = require('../dist/application');
const { DatabaseService } = require('../dist/database/database.module');
const { postgresService, assertPostgresService, postgresPort, testDatabases } = require('./helpers/postgres-service.cjs');

const run = promisify(execFile);
const migrationCount = JSON.parse(readFileSync(join(migrationFolder, 'meta/_journal.json'), 'utf8')).entries.length;
const runId = randomBytes(12).toString('hex');
const service = postgresService();
const container = service?.container ?? `elyqreth_t03_test_${runId}`;
const volume = `${container}_data`;
const database = `elyqreth_test_${runId}`;
const password = service?.password ?? randomBytes(24).toString('hex');
const label = 'elyqreth.test.run';
let temp, admin, pool, config, url, image, databaseCreated = false, containerCreated = false, volumeCreated = false;
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
  const compose = readFileSync(join(__dirname, '../../../docker-compose.yml'), 'utf8');
  image = compose.match(/^\s+image:\s+(postgres:\S+@sha256:[a-f0-9]{64})\s*$/m)?.[1];
  assert.ok(image, 'Tests require the pinned official PostgreSQL image from Compose');
  if (service) {
    assertPostgresService(JSON.parse(await docker('inspect', container))[0], service, image);
  } else {
    temp = mkdtempSync(join(tmpdir(), 'elyqreth-t03-'));
    writeFileSync(join(temp, 'postgres.env'), `POSTGRES_USER=elyqreth_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=postgres\n`, { mode: 0o600 });
    await docker('volume', 'create', '--label', `${label}=${runId}`, volume); volumeCreated = true;
    await docker('run', '--detach', '--name', container, '--label', `${label}=${runId}`,
      '--env-file', join(temp, 'postgres.env'), '-p', '127.0.0.1::5432',
      '--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`,
      '--health-cmd', 'pg_isready -U elyqreth_test -d postgres', '--health-interval', '1s', '--health-timeout', '2s', '--health-retries', '60', image);
    containerCreated = true;
  }
  await waitReady();
  const state = JSON.parse(await docker('inspect', container))[0];
  const port = postgresPort(state, service);
  url = `postgresql://elyqreth_test:${password}@127.0.0.1:${port}/${database}`;
  config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, DATABASE_SSL_MODE: 'disable' });
  const connection = { host: '127.0.0.1', port, user: 'elyqreth_test', password,
    connectionTimeoutMillis: 5000, statement_timeout: 10000 };
  admin = new Pool({ ...connection, database: 'postgres', max: 1 });
  admin.on('error', () => {});
  assert.match(database, /^elyqreth_test_[a-f0-9]{24}$/);
  await admin.query(`CREATE DATABASE "${database}"`);
  databaseCreated = true;
  await migrateDatabase(config.database);
  pool = new Pool({ ...connection, database, max: 5 });
  pool.on('error', () => {}); // A test intentionally restarts this isolated server.
}, { timeout: 120_000 });

after(async () => {
  if (pool && !pool.ended) await pool.end();
  if (admin && !admin.ended) await admin.end();
  if (service && databaseCreated) {
    const state = JSON.parse(await docker('inspect', container))[0];
    assertPostgresService(state, service, image);
    const cleanup = new Pool({ host: '127.0.0.1', port: postgresPort(state, service), user: 'elyqreth_test', password,
      database: 'postgres', max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    try {
      for (const name of testDatabases(database)) {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally { await cleanup.end(); }
  }
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
    assert.ok(basename(temp).startsWith('elyqreth-t03-'));
    rmSync(temp, { recursive: true });
  }
}, { timeout: 120_000 });

const row = async (text, params = [], client = pool) => (await client.query(text, params)).rows[0];
const rejects = async (promise, code) => assert.rejects(promise, error => error.code === code);
async function fixture() {
  const owner = await row('INSERT INTO owners(name) VALUES ($1) RETURNING *', ['test-scope']);
  const orchestrator = await row('INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,$2,$3) RETURNING *', [owner.id, 'test-orchestrator', 'custom.test']);
  const agent = await row('INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,$3,$4) RETURNING *', [owner.id, orchestrator.id, 'test-agent', 'RULE_BASED']);
  const task = await row('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,$4) RETURNING *', [owner.id, agent.id, orchestrator.id, { text: 'persistence fixture only' }]);
  return { owner, orchestrator, agent, task };
}
async function execution(f, attempt, status = 'PENDING') {
  return row(`INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number,status,started_at,finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $6::text IN ('RUNNING','SUCCEEDED') THEN now() ELSE NULL END,
      CASE WHEN $6::text IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') THEN now() ELSE NULL END) RETURNING *`,
  [f.owner.id, f.task.id, f.agent.id, f.orchestrator.id, attempt, status]);
}
const eventParams = (f, sequence, occurredAt = new Date()) => [f.owner.id, f.agent.id, f.task.id, f.orchestrator.id, randomUUID(), sequence, occurredAt];
const eventSql = `INSERT INTO agent_events(owner_id,agent_id,task_id,orchestrator_id,correlation_id,aggregate_type,aggregate_id,aggregate_version,aggregate_sequence,event_type,occurred_at)
  VALUES ($1,$2,$3,$4,$5,'task',$3,1,$6,'task.created',$7) RETURNING *`;

test('fresh migration creates the complete schema, no business seed, and reapplication preserves data', async () => {
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(tables.rowCount, 21);
  for (const name of ['local_accounts','auth_sessions','auth_login_limits','owners', 'agents', 'orchestrators', 'tasks', 'executions', 'agent_events', 'city_agent_bindings', 'collaboration_sessions', 'collaboration_participants', 'collaboration_delegations', 'external_sources', 'external_agent_mappings', 'external_execution_mappings', 'external_event_inbox']) {
    assert.equal((await row(`SELECT count(*)::int AS count FROM "${name}"`)).count, 0);
  }
  const f = await fixture();
  await migrateDatabase(config.database);
  assert.equal((await row('SELECT id FROM tasks WHERE id=$1', [f.task.id])).id, f.task.id);
  assert.equal((await row('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).count, migrationCount);
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run db:migrate:compiled --workspace=@elyqreth/api'] : ['run', 'db:migrate:compiled', '--workspace=@elyqreth/api'];
  const cli = await run(command, args, { cwd: join(__dirname, '../../..'), timeout: 60_000,
    env: { ...process.env, NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: '3001',
      CORS_ORIGINS: 'http://localhost:5173', DATABASE_URL: url, DATABASE_SSL_MODE: 'disable',
      DATABASE_POOL_MAX: '2', DATABASE_CONNECTION_TIMEOUT_MS: '5000', DATABASE_IDLE_TIMEOUT_MS: '10000', DATABASE_STATEMENT_TIMEOUT_MS: '30000' } });
  assert.match(cli.stdout, /Database migrations applied/);
  assert.ok(!cli.stdout.includes(password)); assert.ok(!cli.stderr.includes(password));
});

test('required fields, UUID/defaults, status checks and optional fields are enforced', async () => {
  const f = await fixture();
  assert.match(f.agent.id, /^[0-9a-f-]{36}$/);
  assert.equal(f.agent.lifecycle_status, 'DISABLED');
  assert.deepEqual(f.agent.configuration, {});
  assert.equal(f.agent.description, null);
  assert.equal(f.orchestrator.connectivity_status, 'UNKNOWN');
  assert.equal(f.orchestrator.registration_status, 'DISABLED');
  assert.equal(f.task.status, 'CREATED'); assert.equal(f.task.completed_at, null);
  await rejects(pool.query('INSERT INTO agents(owner_id,orchestrator_id,name) VALUES ($1,$2,$3)', [f.owner.id, f.orchestrator.id, 'missing-type']), '23502');
  await rejects(pool.query('INSERT INTO agents(owner_id,name,type) VALUES ($1,$2,$3)', [f.owner.id, 'missing-route', 'LLM']), '23502');
  await rejects(pool.query("UPDATE agents SET lifecycle_status='RUNNING' WHERE id=$1", [f.agent.id]), '23514');
  const llm = await row("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'no-provider','LLM') RETURNING *", [f.owner.id, f.orchestrator.id]);
  assert.deepEqual(llm.configuration, {});
  await rejects(pool.query("UPDATE agents SET configuration='{}'::jsonb || jsonb_build_object('password','secret') WHERE id=$1", [f.agent.id]), '23514');
});

test('foreign keys enforce owner scope and immutable routing snapshots without cascade deletion', async () => {
  const a = await fixture(), b = await fixture();
  await rejects(pool.query("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'cross-owner','RULE_BASED')", [a.owner.id, b.orchestrator.id]), '23503');
  await rejects(pool.query('DELETE FROM agents WHERE id=$1', [a.agent.id]), '23503');
  await rejects(pool.query('DELETE FROM orchestrators WHERE id=$1', [a.orchestrator.id]), '23503');
  await rejects(pool.query('INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number) VALUES ($1,$2,$3,$4,1)', [a.owner.id, a.task.id, b.agent.id, a.orchestrator.id]), '23503');
  await rejects(pool.query('UPDATE tasks SET input=$1 WHERE id=$2', [{ changed: true }, a.task.id]), '23514');
});

test('orchestrator names and task idempotency keys have explicit owner-scoped uniqueness', async () => {
  const a = await fixture(), b = await fixture();
  await rejects(pool.query("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'test-orchestrator','other')", [a.owner.id]), '23505');
  const create = f => pool.query('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5,$6)', [f.owner.id, f.agent.id, f.orchestrator.id, {}, 'stable-key', 'a'.repeat(64)]);
  await create(a); await create(b);
  await rejects(create(a), '23505');
  await rejects(pool.query('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,idempotency_key) VALUES ($1,$2,$3,$4,$5)', [a.owner.id, a.agent.id, a.orchestrator.id, {}, 'missing-hash']), '23514');
});

test('attempt history, active-attempt uniqueness and timestamp relationships are protected', async () => {
  const f = await fixture();
  const first = await execution(f, 1, 'FAILED');
  await rejects(execution(f, 1, 'FAILED'), '23505');
  const second = await execution(f, 2);
  await rejects(execution(f, 3), '23505');
  await rejects(pool.query("UPDATE executions SET status='PENDING',finished_at=NULL WHERE id=$1", [first.id]), '23514');
  await rejects(pool.query('DELETE FROM executions WHERE id=$1', [first.id]), '23514');
  await rejects(pool.query('UPDATE executions SET finished_at=now() WHERE id=$1', [second.id]), '23514');
  await rejects(pool.query("UPDATE executions SET status='RUNNING',started_at=created_at-interval '1 second' WHERE id=$1", [second.id]), '23514');
  await rejects(pool.query("UPDATE tasks SET status='COMPLETED' WHERE id=$1", [f.task.id]), '23514');
  assert.equal((await row('SELECT count(*)::int AS count FROM executions WHERE task_id=$1', [f.task.id])).count, 2);
});

test('one native running execution per agent and one successful attempt per task', async () => {
  const f = await fixture();
  await execution(f, 1, 'RUNNING');
  const anotherTask = await row('INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,$4) RETURNING *', [f.owner.id, f.agent.id, f.orchestrator.id, {}]);
  await rejects(execution({ ...f, task: anotherTask }, 1, 'RUNNING'), '23505');
  const done = await fixture();
  await execution(done, 1, 'SUCCEEDED');
  await rejects(execution(done, 2, 'SUCCEEDED'), '23505');
});

test('updated timestamps and resource versions advance on direct SQL changes', async () => {
  const f = await fixture();
  const changed = await row("UPDATE agents SET description='changed' WHERE id=$1 RETURNING *", [f.agent.id]);
  assert.equal(changed.version, 2);
  assert.ok(changed.updated_at >= f.agent.updated_at);
  assert.equal(changed.created_at.toISOString(), f.agent.created_at.toISOString());
  await rejects(pool.query('UPDATE agents SET id=$1 WHERE id=$2', [randomUUID(), f.agent.id]), '23514');
});

test('events are append-only, owner-scoped, versioned and ordered independently of occurredAt', async () => {
  const f = await fixture();
  const first = await row(eventSql, eventParams(f, 1, new Date('2026-10-21T00:00:00Z')));
  const second = await row(eventSql, eventParams(f, 2, new Date('2020-01-01T00:00:00Z')));
  assert.equal(first.stream_position, '1'); assert.equal(second.stream_position, '2');
  assert.ok(second.occurred_at < first.occurred_at);
  assert.equal((await row('SELECT count(*)::int AS count FROM event_outbox WHERE owner_id=$1', [f.owner.id])).count, 2);
  await rejects(row(eventSql, eventParams(f, 1)), '23505');
  await rejects(pool.query('UPDATE agent_events SET payload=$1 WHERE id=$2', [{ rewritten: true }, first.id]), '23514');
  await rejects(pool.query('DELETE FROM agent_events WHERE id=$1', [first.id]), '23514');
  const other = await fixture();
  const wrong = eventParams(f, 3); wrong[1] = other.agent.id;
  await rejects(row(eventSql, wrong), '23503');
  const executionRow = await execution(f, 1);
  await rejects(pool.query("INSERT INTO agent_events(owner_id,execution_id,correlation_id,aggregate_type,aggregate_id,aggregate_version,aggregate_sequence,event_type) VALUES ($1,$2,$3,'execution',$2,1,1,'execution.started')", [f.owner.id, executionRow.id, randomUUID()]), '23514');
});

test('owner stream locks prevent commit-order gaps and rolled-back events/outbox do not survive', async () => {
  const f = await fixture();
  const one = await pool.connect(), two = await pool.connect();
  let secondWrite;
  try {
    await one.query('BEGIN'); await two.query('BEGIN');
    await one.query(eventSql, eventParams(f, 1));
    let completed = false;
    secondWrite = two.query(eventSql, eventParams(f, 2)).then(result => { completed = true; return result; });
    await sleep(100); assert.equal(completed, false);
    await one.query('COMMIT');
    const result = await secondWrite;
    assert.equal(result.rows[0].stream_position, '2');
    await two.query('ROLLBACK');
    const retry = await row(eventSql, eventParams(f, 3));
    assert.equal(retry.stream_position, '2');
    assert.equal((await row('SELECT count(*)::int AS count FROM event_outbox WHERE owner_id=$1', [f.owner.id])).count, 2);
  } finally {
    await one.query('ROLLBACK'); await two.query('ROLLBACK');
    await secondWrite?.catch(() => {}); one.release(); two.release();
  }
});

test('event UUID identity, nullable references and source deduplication are enforced', async () => {
  const f = await fixture();
  const id = randomUUID();
  const insert = (sequence, eventId = randomUUID()) => pool.query(`INSERT INTO agent_events(id,owner_id,orchestrator_id,correlation_id,aggregate_type,aggregate_id,aggregate_version,aggregate_sequence,event_type,source,source_event_id)
    VALUES ($1,$2,$3,$4,'orchestrator',$3,1,$5,'orchestrator.connected','external-test','remote-event')`, [eventId, f.owner.id, f.orchestrator.id, randomUUID(), sequence]);
  await insert(1, id);
  await rejects(insert(2, id), '23505');
  await rejects(insert(2), '23505');
  const event = await row('SELECT * FROM agent_events WHERE id=$1', [id]);
  assert.equal(event.agent_id, null); assert.equal(event.task_id, null); assert.equal(event.execution_id, null);
  assert.equal(event.schema_version, 1);
});

test('city bindings accept external NPC IDs without NPC rows and enforce active uniqueness', async () => {
  const f = await fixture();
  const insert = () => pool.query('INSERT INTO city_agent_bindings(owner_id,agent_id,npc_id) VALUES ($1,$2,$3)', [f.owner.id, f.agent.id, 'city:npc:not-in-postgres']);
  await insert(); await rejects(insert(), '23505');
  const other = await row("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'another','RULE_BASED') RETURNING *", [f.owner.id, f.orchestrator.id]);
  await rejects(pool.query('INSERT INTO city_agent_bindings(owner_id,agent_id,npc_id) VALUES ($1,$2,$3)', [f.owner.id, other.id, 'city:npc:not-in-postgres']), '23505');
  await pool.query('UPDATE city_agent_bindings SET enabled=false WHERE agent_id=$1', [f.agent.id]);
  await insert();
  assert.equal((await row('SELECT count(*)::int AS count FROM city_agent_bindings WHERE agent_id=$1', [f.agent.id])).count, 2);
});

test('Nest database module supports Drizzle transactions, connection shutdown and liveness', async () => {
  const app = await createApplication(config);
  try {
    await app.listen(0, '127.0.0.1');
    const service = app.get(DatabaseService);
    assert.equal((await service.db.execute(sql`select 1 as value`)).rows[0].value, 1);
    await assert.rejects(service.db.transaction(async tx => {
      await tx.execute(sql`insert into owners(name) values ('rolled-back-owner')`);
      throw new Error('rollback fixture');
    }));
    assert.equal((await row("SELECT count(*)::int AS count FROM owners WHERE name='rolled-back-owner'")).count, 0);
    const response = await fetch(`${await app.getUrl()}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'elyqreth-api' });
  } finally { await app.close(); }
});

test('migration hash drift fails closed before executing further schema changes', async () => {
  const original = await row('SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1');
  await pool.query("UPDATE drizzle.__drizzle_migrations SET hash='tampered' WHERE id=$1", [original.id]);
  try { await assert.rejects(migrateDatabase(config.database), /Migration history differs/); }
  finally { await pool.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2', [original.hash, original.id]); }
});

test('application startup checks connectivity but never creates or migrates schema', async () => {
  const blank = database + '_blank';
  assert.match(blank, /^elyqreth_test_[a-f0-9]{24}_blank$/);
  await admin.query(`CREATE DATABASE "${blank}"`);
  const app = await createApplication(validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url + '_blank', DATABASE_SSL_MODE: 'disable' }));
  try {
    await app.init();
    const result = await app.get(DatabaseService).db.execute(sql`select count(*)::int as count from pg_tables where schemaname='public'`);
    assert.equal(result.rows[0].count, 0);
  } finally { await app.close(); }
});

test('committed data and migration journal survive a real PostgreSQL container restart', async () => {
  const f = await fixture();
  await pool.end();
  await admin.end(); admin = undefined;
  await docker('restart', container);
  await waitReady();
  // Docker may reassign a random host port on restart; resolve it again.
  const state = JSON.parse(await docker('inspect', container))[0];
  const port = postgresPort(state, service);
  url = `postgresql://elyqreth_test:${password}@127.0.0.1:${port}/${database}`;
  config = validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: url, DATABASE_SSL_MODE: 'disable' });
  const db = config.database;
  pool = new Pool({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, max: 5, connectionTimeoutMillis: 5000 });
  pool.on('error', () => {});
  for (let i = 0; ; i++) {
    try { await pool.query('select 1'); break; }
    catch { if (i >= 30) throw new Error('Restarted test PostgreSQL is not reachable'); await sleep(100); }
  }
  assert.equal((await row('SELECT id FROM tasks WHERE id=$1', [f.task.id])).id, f.task.id);
  await migrateDatabase(config.database);
  assert.equal((await row('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).count, migrationCount);
});

require('./native-coordination.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./collaboration-recovery.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./collaboration-activity.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./langgraph.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./hermes.integration.cjs')({row,getUrl:()=>url});
require('./external-ingestion.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./collaboration-api.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./collaboration.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
require('./agents.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./tasks.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./lifecycle.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./events.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./acceptance.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./runtime.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./text-statistics.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./providers.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./llm.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./city-bindings.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./activity.integration.cjs')({ row, getUrl: () => url, getPool: () => pool });
require('./interaction.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});
if(process.env.ELYQRETH_CITY_E2E==='true')require('./city-browser.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});

require('./authentication.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});

require('./readiness.integration.cjs')({getUrl:()=>url,getPool:()=>pool});
require('./runtime-drain.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool});

if(process.env.ELYQRETH_CAPACITY==='true')require('./capacity.integration.cjs')({row,getUrl:()=>url,getPool:()=>pool,container,runId});
