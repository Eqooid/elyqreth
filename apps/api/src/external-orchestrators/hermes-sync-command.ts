import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { loadConfiguration } from '../config/configuration';
import { HermesObservationModule } from './hermes-observation.module';
import { HermesObservationService } from './hermes-observation.service';
import { IngestionAuthority } from './ingestion-authority';
import { HERMES_DOMAIN } from './hermes.adapter';
import { AdapterError } from './adapter.error';
import { uuid } from './adapter.validation';

export function hermesSyncArguments(args: readonly string[]) {
  const [action, connectionId, count] = args;
  if (!['apply', 'sync', 'watch'].includes(action ?? '') || args.length < 2 || args.length > 3 ||
    action !== 'watch' && count !== undefined || count !== undefined && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(count))
    throw new AdapterError('INVALID_INPUT');
  try { return { action: action!, connectionId: uuid(connectionId), iterations: action === 'watch' ? Number(count ?? 20) : 1 }; }
  catch { throw new AdapterError('INVALID_INPUT'); }
}
export async function boundedHermesWatch(iterations: number, sync: () => Promise<unknown>, wait: (ms: number) => Promise<unknown>) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new AdapterError('INVALID_INPUT');
  let failures = 0;
  for (let i = 0; i < iterations; i++) {
    try { await sync(); failures = 0; }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (!['CONNECTION_UNAVAILABLE', 'TRANSIENT_FAILURE', 'TIMEOUT', 'RATE_LIMITED'].includes(code ?? '') || ++failures >= 3) throw error;
    }
    if (i + 1 < iterations) await wait(Math.min(30000, 5000 * 2 ** failures));
  }
  if (failures) throw new AdapterError('CONNECTION_UNAVAILABLE');
}
async function main() {
  const options = hermesSyncArguments(process.argv.slice(2)), config = loadConfiguration();
  if (!config.registry) throw new AdapterError('ACCESS_DENIED');
  class Root {}
  Module({ imports: [ConfigModule.register(config), HermesObservationModule] })(Root);
  const app = await NestFactory.createApplicationContext(Root, { logger: false, abortOnError: false });
  try {
    const authority = app.get(IngestionAuthority), service = app.get(HermesObservationService);
    const operator = () => authority.authorize(config.registry!.token, options.connectionId, randomUUID(), 'operator', HERMES_DOMAIN);
    if (options.action === 'apply') process.stdout.write(JSON.stringify(await service.apply(operator())) + '\n');
    else await boundedHermesWatch(options.iterations, async () => {
      const op = operator(), grant = authority.check(op, true);
      const source = authority.authorize(config.registry!.token, options.connectionId, grant.correlationId, 'ingestion', HERMES_DOMAIN);
      process.stdout.write(JSON.stringify(await service.sync(op, source)) + '\n');
    }, ms => delay(ms));
  } finally { await app.close(); }
}
if (require.main === module) void main().catch(() => {
  process.stderr.write('Hermes configuration/synchronization failed. Check owned registration, configured runs and safe diagnostics.\n');
  process.exitCode = 1;
});
