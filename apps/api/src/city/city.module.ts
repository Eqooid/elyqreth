import { CollaborationActivityService } from './collaboration-activity.service';
import { CollaborationActivityController,CollaborationActivityGuard } from './collaboration-activity.controller';
import { CollaborationApiFilter } from '../collaboration/collaboration-api.filter';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AgentNpcBindingRepository } from './binding.repository';
import { AgentNpcBindingService } from './binding.service';
import { ApiLogger } from '../common/api-logger';
import { AgentActivityRepository } from './activity.repository';
import { AgentActivityProjectionService } from './activity.service';
import { CityActivityController, CityReadGuard } from './activity.controller';

// Binding writes stay internal; T03 controllers only read safe projections.
@Module({imports:[DatabaseModule],controllers:[CityActivityController,CollaborationActivityController],providers:[CollaborationActivityService,CollaborationActivityGuard,CollaborationApiFilter,AgentNpcBindingRepository,AgentNpcBindingService,
  AgentActivityRepository,AgentActivityProjectionService,CityReadGuard,ApiLogger],exports:[AgentNpcBindingService,AgentActivityProjectionService]})
export class CityModule {}
