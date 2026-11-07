import { Global, Module } from '@nestjs/common';
import { ApiLogger } from '../common/api-logger';
import { RuntimeHostService } from './runtime-host.service';
@Global()
@Module({providers:[RuntimeHostService,ApiLogger],exports:[RuntimeHostService]})
export class RuntimeHostModule {}
