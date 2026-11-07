import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { ExecutionReadGuard } from './execution-read.guard';
import { EventsModule } from '../events/events.module';

@Module({ imports: [DatabaseModule, EventsModule], controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionReadGuard], exports: [ExecutionsService] })
export class ExecutionsModule {}
