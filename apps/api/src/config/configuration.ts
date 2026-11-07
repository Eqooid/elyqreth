import { AuthenticationConfiguration, authenticationEnvironment } from '../auth/auth-configuration';
import { resolveFileInputs, FileInputError } from './file-inputs';
import { existsSync, readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { resolve } from 'node:path';
import { inspect, parseEnv } from 'node:util';
import { DatabaseConfiguration, DatabaseConfigurationError, validateDatabaseEnvironment } from '../database/database-configuration';
import { RegistryConfiguration, registryEnvironment } from '../agents/registry-configuration';
import { RuntimeConfiguration, runtimeEnvironment } from '../runtime/runtime-configuration';
import { LlmConfiguration, llmEnvironment } from '../runtime/providers/provider-configuration';
import { CityReadConfiguration, cityReadEnvironment } from '../city/city-read.configuration';
import { InteractionConfiguration, interactionEnvironment } from '../interaction/interaction.configuration';
import { CollaborationReadConfiguration,collaborationReadEnvironment } from '../city/collaboration-read.configuration';
import { ExternalConfiguration, externalEnvironment } from '../external-orchestrators/external-configuration';

export interface ApiConfiguration {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly authentication?: AuthenticationConfiguration;
  readonly database?: DatabaseConfiguration;
  readonly registry?: RegistryConfiguration;
  readonly runtime?: RuntimeConfiguration;
  readonly llm?: LlmConfiguration;
  readonly cityRead?: CityReadConfiguration;
  readonly interaction?: InteractionConfiguration;
  readonly externalOrchestrators?: ExternalConfiguration;
  readonly collaborationRead?:CollaborationReadConfiguration;
}

type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigurationError extends Error {
  constructor(fields: readonly string[]) {
    // Field names only: never echo environment values or file contents.
    super(`Invalid API configuration: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

export function validateEnvironment(env: Environment): ApiConfiguration {
  const errors: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV');
  if (nodeEnv === 'production') {
    for (const field of ['API_HOST', 'API_PORT', 'CORS_ORIGINS']) {
      if (!env[field]) errors.push(field);
    }
  }
  const host = env.API_HOST ?? '127.0.0.1';
  if (host !== 'localhost' && !isIP(host)) errors.push('API_HOST');
  const rawPort = env.API_PORT ?? '3001';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('API_PORT');
  }
  const rawOrigins = env.CORS_ORIGINS ?? (nodeEnv === 'production' ? '' :
    'http://localhost:5173,http://127.0.0.1:5173');
  const corsOrigins = rawOrigins.split(',').map(origin => origin.trim());
  if (corsOrigins.some(origin => !isOrigin(origin, nodeEnv === 'production'))) errors.push('CORS_ORIGINS');
  let database: DatabaseConfiguration | undefined;
  try { database = validateDatabaseEnvironment(env, nodeEnv); }
  catch (error) {
    if (error instanceof DatabaseConfigurationError) errors.push(...error.fields);
    else throw error;
  }
  const authentication=authenticationEnvironment(env,!!database,errors);
  const registry = registryEnvironment(env, nodeEnv, host, !!database, errors, !!authentication);
  const cityRead = cityReadEnvironment(env, nodeEnv, host, registry, errors, !!authentication);
  const interaction = interactionEnvironment(env,nodeEnv,host,registry,cityRead,errors);
  const runtime = runtimeEnvironment(env, nodeEnv, !!registry, errors, !!authentication);
  const llm = llmEnvironment(env, !!runtime, errors);
  const collaborationRead=collaborationReadEnvironment(env,nodeEnv,host,registry,[cityRead?.token,interaction?.token],errors,!!authentication);
  const externalOrchestrators = externalEnvironment(env,nodeEnv,registry,errors);
  if(collaborationRead&&externalOrchestrators?.credentials.contains(collaborationRead.token))errors.push('COLLABORATION_READ_TOKEN');
  if (errors.length) throw new ConfigurationError(errors);
  const configuration = {
    nodeEnv: nodeEnv as ApiConfiguration['nodeEnv'], host, port,
    corsOrigins: Object.freeze([...new Set(corsOrigins)]),
    ...(database ? { database } : {}),
    ...(authentication ? { authentication } : {}),
    ...(registry ? { registry } : {}),
    ...(runtime ? { runtime } : {}),
    ...(llm ? { llm } : {}),
    ...(cityRead ? { cityRead } : {}),
    ...(interaction ? { interaction } : {}),
    ...(externalOrchestrators ? { externalOrchestrators } : {}),
    ...(collaborationRead?{collaborationRead}:{}),
  };
  // Standard diagnostics must never serialize bearer tokens or connection credentials.
  // This is not a public configuration endpoint; do not spread private configuration into logs.
  const diagnostic = () => ({ nodeEnv: configuration.nodeEnv, host, port,
    corsOrigins: configuration.corsOrigins, databaseConfigured: !!database,
    registryEnabled: !!registry, runtimeEnabled: !!runtime, cityReadEnabled: !!cityRead,
    interactionEnabled: !!interaction, collaborationReadEnabled: !!collaborationRead,
    externalOrchestratorsEnabled: !!externalOrchestrators });
  Object.defineProperties(configuration, {
    toJSON: { value: diagnostic }, [inspect.custom]: { value: diagnostic },
  });
  return Object.freeze(configuration);
}

const developmentAddresses = new BlockList();
developmentAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
developmentAddresses.addAddress('0.0.0.0', 'ipv4');
developmentAddresses.addAddress('::1', 'ipv6');
developmentAddresses.addAddress('::', 'ipv6');

function isOrigin(value: string, production: boolean): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    if (production && (url.protocol !== 'https:' || hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      (isIP(hostname) !== 0 && developmentAddresses.check(hostname, isIP(hostname) === 4 ? 'ipv4' : 'ipv6')))) return false;
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value &&
      !url.username && !url.password && !url.hostname.includes('*');
  } catch { return false; }
}

export function loadConfiguration(
  environment: Environment = process.env,
  envPath = resolve(__dirname, '../../.env'),
): ApiConfiguration {
  let file: Environment = {};
  try {
    if (existsSync(envPath)) file = parseEnv(readFileSync(envPath, 'utf8'));
  } catch { throw new ConfigurationError(['.env file']); }
  // Do not mutate process.env. Undefined process values do not mask file settings.
  const overrides = Object.fromEntries(Object.entries(environment).filter(([, v]) => v !== undefined));
  try{return validateEnvironment(resolveFileInputs({ ...file, ...overrides }));}
  catch(error){if(error instanceof FileInputError)throw new ConfigurationError([error.field]);throw error;}
}
