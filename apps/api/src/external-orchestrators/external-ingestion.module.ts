import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IngestionAuthority } from './ingestion-authority';
import { ExternalIngestionService } from './external-ingestion.service';
@Module({imports:[DatabaseModule],providers:[IngestionAuthority,ExternalIngestionService],exports:[IngestionAuthority,ExternalIngestionService]})
export class ExternalIngestionModule {}
