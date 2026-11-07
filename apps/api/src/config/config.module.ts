import { DynamicModule, Global, Inject, Injectable, Module } from '@nestjs/common';
import { ApiConfiguration } from './configuration';

const CONFIGURATION = Symbol('API_CONFIGURATION');

@Injectable()
export class ApiConfig {
  constructor(@Inject(CONFIGURATION) readonly value: ApiConfiguration) {}
}

@Global()
@Module({})
export class ConfigModule {
  static register(configuration: ApiConfiguration): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIGURATION, useValue: configuration }, ApiConfig],
      exports: [ApiConfig],
    };
  }
}
