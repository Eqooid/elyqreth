import { RuntimeHostModule } from '../runtime/runtime-host.module';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseModule } from '../database/database.module';
import { ReadinessService } from './readiness.service';
import { ApiLogger } from '../common/api-logger';

@Module({ imports:[RuntimeHostModule,DatabaseModule],controllers: [HealthController],providers:[ReadinessService,ApiLogger],exports:[ReadinessService] })
export class HealthModule {}
