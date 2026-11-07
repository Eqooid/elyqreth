import { inspect } from 'node:util';
import { X509Certificate } from 'node:crypto';
import { readConfigurationFile } from '../config/file-inputs';

export interface DatabaseConfiguration {
  readonly host: string; readonly port: number; readonly database: string;
  readonly user: string; readonly password: string; readonly sslMode: 'disable' | 'verify-full';
  readonly poolMax: number; readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number; readonly statementTimeoutMs: number;
  readonly ca?:string;
  readonly production?: boolean;
  readonly migrationTarget?: string;
}

export class DatabaseConfigurationError extends Error {
  constructor(readonly fields: string[]) { super('Invalid database configuration'); }
}

export function validateDatabaseEnvironment(
  env: Readonly<Record<string, string | undefined>>, nodeEnv: string,
): DatabaseConfiguration | undefined {
  const fields: string[] = [];
  if (env.DATABASE_URL === undefined) {
    if (nodeEnv === 'production' || Object.keys(env).some(key => key.startsWith('DATABASE_') && env[key] !== undefined)) {
      throw new DatabaseConfigurationError(['DATABASE_URL']);
    }
    return undefined;
  }
  let host = '', port = 5432, database = '', user = '', password = '';
  try {
    const url = new URL(env.DATABASE_URL);
    host = url.hostname.replace(/^\[|\]$/g, ''); port = Number(url.port || '5432');
    database = decodeURIComponent(url.pathname.slice(1)); user = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host || !user || !password ||
      !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(database) || url.search || url.hash || port < 1 || port > 65535) {
      fields.push('DATABASE_URL');
    }
  } catch { fields.push('DATABASE_URL'); }
  if (nodeEnv === 'production' && (user.toLowerCase() === 'postgres' ||
    /(^|_)(test|testing)(_|$)/i.test(database) ||
    /^(postgres|password|secret|changeme|replace_with.*)$/i.test(password))) fields.push('DATABASE_URL');
  const sslMode = env.DATABASE_SSL_MODE ?? (nodeEnv === 'production' ? 'verify-full' : 'disable');
  if (!['disable', 'verify-full'].includes(sslMode) || (nodeEnv === 'production' && sslMode !== 'verify-full')) fields.push('DATABASE_SSL_MODE');
  let ca:string|undefined;
  if(env.DATABASE_SSL_CA_FILE!==undefined){try{
    if(sslMode!=='verify-full')throw 0;
    ca=readConfigurationFile(env.DATABASE_SSL_CA_FILE,'DATABASE_SSL_CA_FILE',nodeEnv==='production',false);
    const certificates=ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if(!certificates?.length||certificates.length>16||ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,'').trim())throw 0;
    for(const certificate of certificates)new X509Certificate(certificate);
  }catch{fields.push('DATABASE_SSL_CA_FILE');}}
  const bounded = (key: string, fallback: number, min: number, max: number): number => {
    const value = env[key] ?? String(fallback), number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(number) || number < min || number > max) fields.push(key);
    return number;
  };
  const poolMax = bounded('DATABASE_POOL_MAX', 5, 1, 20);
  const connectionTimeoutMs = bounded('DATABASE_CONNECTION_TIMEOUT_MS', 5000, 100, 30000);
  const idleTimeoutMs = bounded('DATABASE_IDLE_TIMEOUT_MS', 10000, 1000, 60000);
  const statementTimeoutMs = bounded('DATABASE_STATEMENT_TIMEOUT_MS', 30000, 100, 120000);
  const migrationTarget = env.DATABASE_MIGRATION_TARGET;
  if (migrationTarget !== undefined && (!/^[a-z_][a-z0-9_]{0,62}$/.test(migrationTarget) || migrationTarget !== database)) fields.push('DATABASE_MIGRATION_TARGET');
  if (fields.length) throw new DatabaseConfigurationError([...new Set(fields)]);
  const configuration = { host, port, database, user, password, sslMode: sslMode as DatabaseConfiguration['sslMode'],
    poolMax, connectionTimeoutMs, idleTimeoutMs, statementTimeoutMs, production: nodeEnv === 'production',
    ...(migrationTarget ? { migrationTarget } : {}), ...(ca?{ca}:{}) };
  const diagnostic = () => ({ sslMode, poolMax, connectionTimeoutMs, idleTimeoutMs, statementTimeoutMs,
    credentials: '[REDACTED]' });
  Object.defineProperties(configuration, {
    toJSON: { value: diagnostic }, [inspect.custom]: { value: diagnostic },
  });
  return Object.freeze(configuration);
}
