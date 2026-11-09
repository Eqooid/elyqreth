import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { RegistryGuard } from './registry.guard';
import { EventsModule } from '../events/events.module';
import { CityModule } from '../city/city.module';

@Module({ imports: [DatabaseModule, EventsModule, CityModule], controllers: [AgentsController], providers: [AgentsService, RegistryGuard], exports: [AgentsService] })
export class AgentsModule {}
