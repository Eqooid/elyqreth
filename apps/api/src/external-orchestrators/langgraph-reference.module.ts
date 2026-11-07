import { Module } from '@nestjs/common';
import { ExternalOrchestratorsModule } from './external-orchestrators.module';
import { ExternalIngestionModule } from './external-ingestion.module';
import { LangGraphObservationService } from './langgraph-observation.service';
@Module({imports:[ExternalOrchestratorsModule,ExternalIngestionModule],providers:[LangGraphObservationService],exports:[LangGraphObservationService]})
export class LangGraphReferenceModule {}
