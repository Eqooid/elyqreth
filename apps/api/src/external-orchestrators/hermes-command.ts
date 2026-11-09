import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiConfig, ConfigModule } from '../config/config.module';
import { loadConfiguration } from '../config/configuration';
import { ExternalOrchestratorsModule } from './external-orchestrators.module';
import { ExternalAdapterService } from './external-adapter.service';
import { IngestionAuthority } from './ingestion-authority';
import { AdapterError } from './adapter.error';
import { uuid } from './adapter.validation';
import { HERMES_CAPABILITIES } from './hermes.adapter';

export function hermesConnectionArgument(args: readonly string[]): string {
  if (args.length !== 1) throw new AdapterError('INVALID_INPUT');
  try { return uuid(args[0]); } catch { throw new AdapterError('INVALID_INPUT'); }
}
async function main() {
  const id = hermesConnectionArgument(process.argv.slice(2)), config = loadConfiguration();
  if (!config.registry) throw new AdapterError('ACCESS_DENIED');
  // Reuse the legacy local source approval boundary; account/production mode stays closed.
  const authority = new IngestionAuthority(new ApiConfig(config));
  const operator = authority.authorize(config.registry.token, id, randomUUID(), 'operator');
  const grant = authority.check(operator, true);
  if (grant.connection.adapterType !== 'hermes.v1') throw new AdapterError('ACCESS_DENIED');
  class Root {}
  Module({ imports: [ConfigModule.register(config), ExternalOrchestratorsModule] })(Root);
  const app = await NestFactory.createApplicationContext(Root, { logger: false, abortOnError: false });
  try {
    authority.check(operator, true);
    const result = await app.get(ExternalAdapterService).health({ ownerId: grant.connection.ownerId,
      correlationId: grant.correlationId, operations: HERMES_CAPABILITIES }, id);
    authority.check(operator, true);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.state !== 'HEALTHY') process.exitCode = 1;
  } finally { await app.close(); }
}
if (require.main === module) void main().catch(() => {
  process.stderr.write('Hermes connectivity check failed. Check approved connection and safe operation diagnostics.\n');
  process.exitCode = 1;
});
