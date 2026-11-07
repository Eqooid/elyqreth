require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {ConfigModule}=require('../dist/config/config.module'),{validateEnvironment}=require('../dist/config/configuration');
const {createApplication}=require('../dist/application');
const {ExternalAdapterService}=require('../dist/external-orchestrators/external-adapter.service');
const {AdapterRegistry,EXTERNAL_ADAPTERS}=require('../dist/external-orchestrators/adapter-registry');
const {ExternalHttpTransport}=require('../dist/external-orchestrators/external-http.transport');
const {ApiLogger}=require('../dist/common/api-logger');const {fixture}=require('./external-adapter-fixtures.cjs');
test('actual application boots and serves health with no external adapters configuration secrets or network',async()=>{
 const app=await createApplication(validateEnvironment({NODE_ENV:'test'}));try{await app.listen(0,'127.0.0.1');assert.equal((await fetch(await app.getUrl()+'/health')).status,200);assert.ok(app.get(ExternalAdapterService));assert.throws(()=>app.get(AdapterRegistry).resolve('fixture.v1'),e=>e.code==='UNKNOWN_ADAPTER');}finally{await app.close();}
});
test('reviewed fixture registers through actual Nest DI validates configuration and negotiates safe health',async()=>{
 const f=fixture();class FixtureModule{};Module({imports:[ConfigModule.register({...validateEnvironment({NODE_ENV:'test'}),...f.config})],providers:[{provide:EXTERNAL_ADAPTERS,useValue:[f.adapter]},AdapterRegistry,{provide:ExternalHttpTransport,useValue:f.transport},{provide:ApiLogger,useValue:f.logger},ExternalAdapterService]})(FixtureModule);
 const app=await NestFactory.createApplicationContext(FixtureModule,{logger:false,abortOnError:false});try{assert.equal((await app.get(ExternalAdapterService).health(f.access,f.c.id)).state,'HEALTHY');assert.equal((await app.get(ExternalAdapterService).agents(f.access,f.c.id,{limit:1})).items[0].externalId,f.agent.externalId);}finally{await app.close();}
});
test('configured unknown adapters fail application init safely without exposing credentials',async()=>{
 const f=fixture(),app=await createApplication({...validateEnvironment({NODE_ENV:'test'}),...f.config});try{await assert.rejects(app.init(),e=>e.code==='INVALID_CONFIGURATION'&&!String(e.stack).includes('fixture-bearer-value'));}finally{await app.close();}
});
