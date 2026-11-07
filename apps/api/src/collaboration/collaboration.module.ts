import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CollaborationRepository } from './collaboration.repository';
import { CollaborationController } from './collaboration.controller';
import { CollaborationApiService } from './collaboration-api.service';
import { CollaborationHttpGuard } from './collaboration-http.guard';
import { CollaborationApiFilter } from './collaboration-api.filter';
import { NativeCoordinationService } from './native-coordination.service';
import { RuntimeModule } from '../runtime/runtime.module';
import { TasksModule } from '../tasks/tasks.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { CollaborationRecoveryService } from './collaboration-recovery.service';

// Explicit bounded activation; no scheduler, consumer or parallel execution engine.
@Module({ imports: [DatabaseModule, RuntimeModule, TasksModule, LifecycleModule], controllers: [CollaborationController],
  providers: [CollaborationRepository, CollaborationApiService, CollaborationHttpGuard, CollaborationApiFilter, NativeCoordinationService, CollaborationRecoveryService], exports: [CollaborationRepository] })
export class CollaborationModule {}
