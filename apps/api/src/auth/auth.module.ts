import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AuthenticationService } from './auth.service';
import { AuthenticationGuard } from './auth.guard';
import { AuthenticationController } from './auth.controller';
@Module({imports:[DatabaseModule],controllers:[AuthenticationController],providers:[AuthenticationService,{provide:APP_GUARD,useClass:AuthenticationGuard}],exports:[AuthenticationService]})
export class AuthenticationModule{}
