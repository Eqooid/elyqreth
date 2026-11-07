import 'reflect-metadata';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, desc, eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { ApiConfiguration, ConfigurationError, loadConfiguration } from '../config/configuration';
import { ApiConfig } from '../config/config.module';
import { isLoopback } from '../agents/registry-configuration';
import { TasksService } from '../tasks/tasks.service';
import { DatabaseService } from '../database/database.module';
import { tasks, executions, executionResults } from '../database/schema';
import { RuntimeCoordinator } from './runtime-coordinator';
import { RuntimeHostService } from './runtime-host.service';
import { executionCommand, ExecuteTaskCommand } from './runtime-command';
import { RuntimeError } from './contracts/runtime-error.contract';
import { createRuntimeExecutionRequest } from './contracts/execution-request.contract';
import { createRuntimeExecutionResult } from './contracts/execution-result.contract';
import { parseRuntimeSnapshot } from './contracts/runtime-snapshot';

export type LocalOptions = { readonly inspect: boolean; readonly taskId: string; readonly taskVersion?: number };
export function localOptions(args: readonly string[]): LocalOptions {
  const values = new Map<string, string>();
  let inspect = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--inspect' && !inspect) { inspect = true; continue; }
    if (!['--task-id','--task-version'].includes(key!) || values.has(key!) || !args[i+1] || args[i+1]!.startsWith('--'))
      throw new RuntimeError('INVALID_INPUT', 'request');
    values.set(key!, args[++i]!);
  }
  const rawVersion = values.get('--task-version');
  if (rawVersion !== undefined && !/^[1-9][0-9]{0,9}$/.test(rawVersion)) throw new RuntimeError('INVALID_INPUT', 'request');
  if (inspect && rawVersion !== undefined) throw new RuntimeError('INVALID_INPUT', 'request');
  const command = executionCommand({taskId:values.get('--task-id'), taskVersion:inspect ? 1 : Number(rawVersion)} as ExecuteTaskCommand);
  return Object.freeze({inspect,taskId:command.taskId,...(inspect ? {} : {taskVersion:command.taskVersion})});
}

export function assertLocalRuntime(config: ApiConfiguration): void {
  if (!['development','test'].includes(config.nodeEnv) || !isLoopback(config.host) || !config.registry || !config.runtime || !config.database)
    throw new RuntimeError('ACCESS_DENIED', 'request');
}

// Trusted local operator only, not an HTTP handler or alternate execution pipeline.
export async function runLocalCommand(app: INestApplicationContext, options: LocalOptions, signal?: AbortSignal) {
  const config = app.get(ApiConfig).value;
  assertLocalRuntime(config);
  if (signal?.aborted) throw new RuntimeError('CANCELLED', 'context');
  const task = await app.get(TasksService).get(options.taskId);
  if (!config.runtime!.bindings.some(b => b.agentId === task.agentId && b.orchestratorId === task.orchestratorId))
    throw new RuntimeError('ACCESS_DENIED', 'request');
  if (options.inspect) {
    const [saved] = await app.get(DatabaseService).db.select({execution:executions, input:tasks.input, body:executionResults.body})
      .from(executions).innerJoin(tasks, eq(tasks.id,executions.taskId))
      .leftJoin(executionResults, eq(executionResults.executionId,executions.id))
      .where(and(eq(executions.taskId,task.id),eq(executions.ownerId,config.registry!.ownerId)))
      .orderBy(desc(executions.attemptNumber)).limit(1);
    if (!saved) return {kind:'inspection' as const,taskId:task.id,taskStatus:task.status,execution:null};
    const execution = saved.execution;
    let result;
    if (saved.body !== null) {
      const snapshot = parseRuntimeSnapshot(execution.agentConfigSnapshot.runtime);
      const request = createRuntimeExecutionRequest({ids:{ownerId:execution.ownerId,taskId:task.id,agentId:execution.agentId,
        orchestratorId:execution.orchestratorId,executionId:execution.id,correlationId:snapshot.correlationId},input:saved.input,definition:snapshot.definition});
      result = createRuntimeExecutionResult(saved.body, request);
    }
    return {kind:'inspection' as const,taskId:task.id,taskStatus:task.status,execution:{id:execution.id,status:execution.status,attemptNumber:execution.attemptNumber},
      resultReference:execution.resultReference,...(result ? {result} : {})};
  }
  const coordinator = app.get(RuntimeCoordinator);
  // Caller must supply its observed version; never silently upgrade stale intent.
  const queued = await coordinator.queueTask({taskId:task.id,taskVersion:options.taskVersion!});
  return coordinator.executeTask({taskId:task.id,taskVersion:queued.task.version},signal);
}

export async function localMain(args = process.argv.slice(2)): Promise<void> {
  let app: INestApplicationContext | undefined;
  const controller = new AbortController();
  let signalled=false,shutdownTimer:NodeJS.Timeout|undefined;
  const abort = () => {if(signalled)return;signalled=true;
    shutdownTimer=setTimeout(()=>process.exit(1),30000);shutdownTimer.unref();
    if(app)void app.get(RuntimeHostService).stop();else controller.abort();
  };
    process.on('SIGINT',abort); process.on('SIGTERM',abort);
  try {
    const options = localOptions(args), config = loadConfiguration();
    assertLocalRuntime(config); // Reject before opening the database/application.
    app = await NestFactory.createApplicationContext(AppModule.register(config), {logger:false,abortOnError:false});
    if(signalled)void app.get(RuntimeHostService).beginDrain();
    const result = await runLocalCommand(app,options,controller.signal);
    process.stdout.write(JSON.stringify(result)+'\n');
    if ('kind' in result && (result.kind === 'unresolved' || result.kind === 'finished' && result.task.status !== 'COMPLETED')) process.exitCode = 1;
  } catch (error) {
    const safe = error instanceof RuntimeError ? error : new RuntimeError(error instanceof ConfigurationError ? 'CONFIGURATION_ERROR' : 'INTERNAL_RUNTIME_ERROR');
    process.stderr.write(JSON.stringify({error:safe.toJSON()})+'\n'); process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT',abort); process.removeListener('SIGTERM',abort);
    try { await app?.close(); }
    catch { process.stderr.write(JSON.stringify({error:new RuntimeError('PERSISTENCE_UNAVAILABLE').toJSON()})+'\n'); process.exitCode=1; }
    clearTimeout(shutdownTimer);if(signalled)process.exit(process.exitCode??0);
  }
}
if (require.main === module) void localMain();
