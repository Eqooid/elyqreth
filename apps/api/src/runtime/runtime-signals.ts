import type { INestApplication } from '@nestjs/common';
import { RuntimeHostService } from './runtime-host.service';
import { ReadinessService } from '../health/readiness.service';
import { ApiLogger } from '../common/api-logger';

let installed:{app:INestApplication;cleanup:()=>void}|undefined;

/** Only actual HTTP process bootstrap owns signals; factories/tests/CLI contexts do not install duplicates. */
export function runtimeSignals(app:INestApplication):()=>void {
  if(installed){if(installed.app!==app)throw new Error('Only one signal-owned HTTP application is supported per process.');return installed.cleanup;}
  const host=app.get(RuntimeHostService),readiness=app.get(ReadinessService),logger=app.get(ApiLogger);
  let shutdown:Promise<void>|undefined,deadline:NodeJS.Timeout|undefined;
  const cleanup=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.removeListener('SIGUSR2',drain);clearTimeout(deadline);if(installed?.app===app)installed=undefined;};
  const stop=()=>{
    if(shutdown)return;
    void host.beginDrain();
    deadline=setTimeout(()=>{try{logger.error('shutdown_deadline_exceeded',{service:'elyqreth-api'});}finally{process.exit(1);}},30000);deadline.unref();
    shutdown=(async()=>{await host.stop();readiness.drain();await app.close();cleanup();process.exit(0);})()
      .catch(()=>{try{logger.error('shutdown_failed',{service:'elyqreth-api'});}finally{process.exit(1);}});
  };
  const drain=()=>{void host.beginDrain();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  if(process.platform!=='win32')process.on('SIGUSR2',drain);
  installed={app,cleanup};return cleanup;
}
