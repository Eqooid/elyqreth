import { createApplication } from './application';
import { ApiConfig } from './config/config.module';
import { ConfigurationError, ApiConfiguration, loadConfiguration } from './config/configuration';
import { ApiLogger } from './common/api-logger';
import { DatabaseConnectionError } from './database/pool';
import { DatabaseAccessError } from './database/access-policy';
import { runtimeSignals } from './runtime/runtime-signals';

export async function bootstrap(configuration:ApiConfiguration=loadConfiguration()): Promise<void> {
  const app = await createApplication(configuration);
  try {
    const config = app.get(ApiConfig).value;
    await app.listen(config.port, config.host);
    runtimeSignals(app);
    app.get(ApiLogger).info('api_started', { service: 'elyqreth-api' });
  } catch (error) {
    await app.close();
    throw error;
  }
}

export function startupFailure(error:unknown):void{
  new ApiLogger().error('startup_failed', {
    message: error instanceof ConfigurationError || error instanceof DatabaseConnectionError || error instanceof DatabaseAccessError ? error.message : 'API startup failed.',
  });
  process.exitCode = 1;
}
if(require.main===module)void bootstrap().catch(startupFailure);
