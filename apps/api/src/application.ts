import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfiguration, ApiConfiguration } from './config/configuration';
import { ApiConfig } from './config/config.module';
import { ApiLogger } from './common/api-logger';
import { configureHttp } from './common/http-foundation';
import { ReadinessService } from './health/readiness.service';

export async function createApplication(
  configuration: ApiConfiguration = loadConfiguration(),
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(configuration), {
    bodyParser: false, logger: false, abortOnError: false,
  });
  configureHttp(app, app.get(ApiConfig).value, app.get(ApiLogger));
  app.use((req:{path:string},res:{status:(status:number)=>{json:(value:unknown)=>void}},next:()=>void)=>{
    if(app.get(ReadinessService).isDraining&&req.path!=='/health'&&req.path!=='/ready'){
      res.status(503).json({statusCode:503,message:'Service unavailable.'});return;
    }next();
  });
  const server = app.getHttpServer();
  server.once('listening',()=>app.get(ReadinessService).markServing());
  // Accommodate the existing 16 KiB bearer plus ordinary/edge metadata while remaining bounded.
  Object.assign(server, { maxHeaderSize: 24 * 1024 });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return app;
}
