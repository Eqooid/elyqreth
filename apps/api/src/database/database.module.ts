import { Module, Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import { createPool, DatabaseConnectionError } from './pool';
import * as schema from './schema';
import { getTableName, is, Table } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { resolve } from 'node:path';
import { verifyAccess, DatabaseAccessError } from './access-policy';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly pool: Pool | undefined;
  private readonly orm: NodePgDatabase<typeof schema> | undefined;
  private readonly production: boolean;

  constructor(config: ApiConfig, logger: ApiLogger) {
    this.production = config.value.nodeEnv === 'production';
    if (config.value.database) {
      this.pool = createPool(config.value.database, () => logger.error('database_connection_lost'));
      this.orm = drizzle(this.pool, { schema });
    }
  }

  get db(): NodePgDatabase<typeof schema> {
    if (!this.orm) throw new Error('Database is not configured. Set DATABASE_URL to use persistence.');
    return this.orm;
  }

  /** Namespace-only diagnostics; no connection identity, SQL, parameters or credentials. No query. */
  diagnostics(){return {configured:!!this.pool,total:this.pool?.totalCount??0,idle:this.pool?.idleCount??0,waiting:this.pool?.waitingCount??0,ended:this.pool?.ended??false};}

  async onModuleInit(): Promise<void> {
    if (!this.orm) return;
    try { await this.orm.execute(sql`select 1`); await verifyAccess(this.pool!, 'runtime', this.production); }
    catch (error) { await this.pool?.end(); throw error instanceof DatabaseAccessError ? error : new DatabaseConnectionError(); }
  }

  /** Read-only compatibility check, shared by the bounded/coalesced readiness owner. Never migrate at startup. */
  async checkReadiness():Promise<boolean>{
    if(!this.pool)return true;
    await verifyAccess(this.pool, 'runtime', this.production);
    const expected=readMigrationFiles({migrationsFolder:resolve(__dirname,'../../migrations')});
    const journalQuery={text:'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',query_timeout:1000};
    const journal=await this.pool.query(journalQuery);
    if(journal.rows.length!==expected.length||journal.rows.some((r,i)=>r.hash!==expected[i]?.hash||String(r.created_at)!==String(expected[i]?.folderMillis)))return false;
    const tables=Object.values(schema).filter(value=>is(value,Table)).map(value=>'public.'+getTableName(value));
    const tablesQuery={text:'SELECT bool_and(to_regclass(name) IS NOT NULL) AS ok FROM unnest($1::text[]) AS name',values:[tables],query_timeout:1000};
    const found=await this.pool.query(tablesQuery);
    return found.rows[0]?.ok===true;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.pool && !this.pool.ended) await this.pool.end();
  }
}

@Module({ providers: [DatabaseService, ApiLogger], exports: [DatabaseService, ApiLogger] })
export class DatabaseModule {}
