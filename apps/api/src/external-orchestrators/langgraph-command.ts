import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { loadConfiguration } from '../config/configuration';
import { LangGraphReferenceModule } from './langgraph-reference.module';
import { LangGraphObservationService } from './langgraph-observation.service';
import { ExternalAdapterService } from './external-adapter.service';
import { ExternalIngestionService } from './external-ingestion.service';
import { IngestionAuthority } from './ingestion-authority';
import { LANGGRAPH_DOMAIN,LANGGRAPH_CAPABILITIES } from './langgraph.adapter';
import { AdapterError } from './adapter.error';
async function main(){
 const [command,id,reference,...extra]=process.argv.slice(2);
 if(extra.length||!['health','discover','approve','observe','result','replay'].includes(command??'')||!id)throw new AdapterError('INVALID_INPUT');
 const config=loadConfiguration();if(!config.registry)throw new AdapterError('ACCESS_DENIED');
 class Root{};Module({imports:[ConfigModule.register(config),LangGraphReferenceModule]})(Root);
 const app=await NestFactory.createApplicationContext(Root,{logger:false,abortOnError:false});
 try{const authority=app.get(IngestionAuthority),operator=authority.authorize(config.registry.token,id,randomUUID(),'operator',LANGGRAPH_DOMAIN),g=authority.check(operator,true);
 if(g.connection.adapterType!=='langgraph.v1')throw new AdapterError('ACCESS_DENIED');
 const service=app.get(LangGraphObservationService);let result:unknown;
 switch(command){
 case 'health':result=await app.get(ExternalAdapterService).health({ownerId:g.connection.ownerId,correlationId:g.correlationId,operations:LANGGRAPH_CAPABILITIES},id);break;
 case 'discover':result=await service.discover(operator,10,reference);break;
 case 'approve':if(!reference)throw new AdapterError('INVALID_INPUT');{const mapped=await service.approve(operator,reference);result={mappingId:mapped.id,externalId:mapped.externalId};}break;
 case 'observe':if(!reference)throw new AdapterError('INVALID_INPUT');result=await service.observe(operator,authority.authorize(config.registry.token,id,g.correlationId,'ingestion',LANGGRAPH_DOMAIN),reference);break;
 case 'result':if(!reference)throw new AdapterError('INVALID_INPUT');result=await service.result(operator,reference);break;
 case 'replay':result=await app.get(ExternalIngestionService).replay(operator,{limit:10,...(reference?{after:reference}:{})});break;
 }
 process.stdout.write(JSON.stringify(result)+'\n');
 }finally{await app.close();}
}
if(require.main===module)void main().catch(()=>{process.stderr.write('Reference observation failed. Check approved connection, mappings and safe operation diagnostics.\n');process.exitCode=1;});
