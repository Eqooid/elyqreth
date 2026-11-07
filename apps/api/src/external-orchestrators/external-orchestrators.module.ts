import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdapterRegistry,EXTERNAL_ADAPTERS } from './adapter-registry';
import { ExternalHttpTransport,EXTERNAL_DNS,externalDns } from './external-http.transport';
import { LangGraphAdapter } from './langgraph.adapter';
import { ExternalAdapterService } from './external-adapter.service';
@Module({imports:[DatabaseModule],providers:[{provide:EXTERNAL_ADAPTERS,useValue:Object.freeze([new LangGraphAdapter()])},AdapterRegistry,{provide:EXTERNAL_DNS,useValue:externalDns},ExternalHttpTransport,ExternalAdapterService],
  exports:[AdapterRegistry,ExternalAdapterService]})
export class ExternalOrchestratorsModule {}
