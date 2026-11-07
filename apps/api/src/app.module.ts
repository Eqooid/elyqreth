import { AuthenticationModule } from './auth/auth.module';
import { DynamicModule, Module } from '@nestjs/common';
import { ApiConfiguration } from './config/configuration';
import { ConfigModule } from './config/config.module';
import { ApiLogger } from './common/api-logger';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { AgentsModule } from './agents/agents.module';
import { TasksModule } from './tasks/tasks.module';
import { ExecutionsModule } from './executions/executions.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { RuntimeModule } from './runtime/runtime.module';
import { CityModule } from './city/city.module';
import { InteractionModule } from './interaction/interaction.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { ExternalOrchestratorsModule } from './external-orchestrators/external-orchestrators.module';
import { LangGraphReferenceModule } from './external-orchestrators/langgraph-reference.module';
import { ExternalIngestionModule } from './external-orchestrators/external-ingestion.module';

@Module({ imports: [HealthModule, DatabaseModule, AuthenticationModule, InteractionModule, AgentsModule, TasksModule, ExecutionsModule, LifecycleModule, RuntimeModule, CityModule, CollaborationModule, ExternalOrchestratorsModule, ExternalIngestionModule, LangGraphReferenceModule], providers: [ApiLogger] })
export class AppModule {
  static register(configuration: ApiConfiguration): DynamicModule {
    return { module: AppModule, imports: [ConfigModule.register(configuration)] };
  }
}
