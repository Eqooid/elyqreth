import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { ApiLogger } from '../common/api-logger';
import { LocalAccessGuard } from '../common/local-access.guard';
import { InteractionService } from './interaction.service';
import { InteractionGuard } from './interaction.guard';
import { InteractionInterceptor } from './interaction.interceptor';
import { InteractionController } from './interaction.controller';

@Module({imports:[DatabaseModule],controllers:[InteractionController],providers:[InteractionService,LocalAccessGuard,ApiLogger,
 {provide:APP_GUARD,useClass:InteractionGuard},{provide:APP_INTERCEPTOR,useClass:InteractionInterceptor}]})
export class InteractionModule {}
