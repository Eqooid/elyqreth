import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventHistoryGuard } from './event-history.guard';

@Module({imports:[DatabaseModule],controllers:[EventsController],providers:[EventsService,EventHistoryGuard],exports:[EventsService]})
export class EventsModule {}
