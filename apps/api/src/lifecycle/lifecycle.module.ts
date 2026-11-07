import { RuntimeHostModule } from '../runtime/runtime-host.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionsModule } from '../executions/executions.module';
import { TaskLifecycleService } from './task-lifecycle.service';
import { ExecutionLifecycleService } from './execution-lifecycle.service';
import { EventsModule } from '../events/events.module';

@Module({ imports: [RuntimeHostModule, DatabaseModule, ExecutionsModule, EventsModule], providers: [TaskLifecycleService, ExecutionLifecycleService],
  exports: [TaskLifecycleService, ExecutionLifecycleService] })
export class LifecycleModule {}
