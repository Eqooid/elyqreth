import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskRequestGuard } from './task-request.guard';
import { EventsModule } from '../events/events.module';

@Module({ imports: [DatabaseModule, EventsModule], controllers: [TasksController], providers: [TasksService, TaskRequestGuard], exports:[TasksService] })
export class TasksModule {}
