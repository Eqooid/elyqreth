import { Pool } from 'pg';
import { DatabaseConfiguration } from './database-configuration';

export function createPool(config: DatabaseConfiguration, onIdleError: () => void = () => {}): Pool {
  const pool = new Pool({
    host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
    ssl: config.sslMode === 'verify-full' ? { rejectUnauthorized: true,...(config.ca?{ca:config.ca}:{}) } : false,
    max: config.poolMax, connectionTimeoutMillis: config.connectionTimeoutMs, idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.statementTimeoutMs, query_timeout: config.statementTimeoutMs + 2000,
    idle_in_transaction_session_timeout: 15000, application_name: 'elyqreth-api',
    options: '-c search_path=public',
  });
  // Do not let an idle socket error crash the process or log a connection string.
  pool.on('error', onIdleError);
  return pool;
}

export class DatabaseConnectionError extends Error {
  constructor() { super('Database unavailable. Check PostgreSQL connectivity and configuration.'); this.name = 'DatabaseConnectionError'; }
}
