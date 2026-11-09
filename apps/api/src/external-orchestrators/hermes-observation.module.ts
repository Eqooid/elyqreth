import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { CityModule } from '../city/city.module';
import { ExternalOrchestratorsModule } from './external-orchestrators.module';
import { ExternalIngestionModule } from './external-ingestion.module';
import { HermesObservationService } from './hermes-observation.service';
@Module({ imports: [AgentsModule, CityModule, ExternalOrchestratorsModule, ExternalIngestionModule],
  providers: [HermesObservationService], exports: [HermesObservationService] })
export class HermesObservationModule {}
