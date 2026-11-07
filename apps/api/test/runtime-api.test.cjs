const { closedApplication } = require('./helpers/production-configuration.cjs');
﻿'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {plainToInstance}=require('class-transformer');
const {validate}=require('class-validator');
const {RuntimeApiController,HTTP_EXECUTION_TIMEOUT_MS}=require('../dist/runtime/http/runtime-api.controller');
const {RuntimeApiGuard}=require('../dist/runtime/http/runtime-api.guard');
const {RuntimeApiService}=require('../dist/runtime/http/runtime-api.service');
const {RuntimeApiFilter,runtimeHttpStatus}=require('../dist/runtime/http/runtime-api.filter');
const {CancelExecutionDto}=require('../dist/runtime/http/runtime.dto');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {ApiLogger}=require('../dist/common/api-logger');
const {requestContext}=require('../dist/common/request-context');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {fixture,text}=require('./llm-fixtures.cjs');
const {deferred}=require('./runtime-fixtures.cjs');

const config=()=>({value:{nodeEnv:'test',host:'127.0.0.1',corsOrigins:[],database:{},runtime:{bindings:[]},
 registry:{ownerId:randomUUID(),token:'a'.repeat(64)}}});
const request=()=>Object.assign(new EventEmitter(),{method:'POST',query:{},params:{taskId:randomUUID()},body:{},
 socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost',authorization:'Bearer '+'a'.repeat(64)},is:type=>type==='application/json'});
const response=()=>Object.assign(new EventEmitter(),{writableFinished:false,destroyed:false});
const host=req=>({switchToHttp:()=>({getRequest:()=>req})});

test('T11 runtime guard authenticates before input inspection and rejects overrides, raw prototype keys, queries and nonlocal origins',()=>{
 const guard=new RuntimeApiGuard(config()),req=request();assert.equal(guard.canActivate(host(req)),true);
 for(const patch of [{body:{provider:'openai'}},{body:JSON.parse('{"__proto__":{}}')},{body:[]},{query:{model:'evil'}},
  {headers:{host:'evil.invalid',authorization:req.headers.authorization}},{headers:{host:'localhost',origin:'https://evil.invalid',authorization:req.headers.authorization}}]){
  assert.throws(()=>guard.canActivate(host({...request(),...patch})));
 }
 assert.throws(()=>guard.canActivate(host({...request(),headers:{host:'localhost'},body:{provider:'evil'}})),e=>e.getStatus()===401);
 assert.throws(()=>new RuntimeApiGuard({value:{...config().value,nodeEnv:'production'}}).canActivate(host(request())),e=>e.getStatus()===404);
 assert.throws(()=>new RuntimeApiGuard({value:{...config().value,runtime:undefined}}).canActivate(host(request())),e=>e.getStatus()===404);
});

test('T11 cancellation DTO rejects strings, missing/unsafe versions and unknown command fields',async()=>{
 for(const value of [{},{taskVersion:'1'},{taskVersion:0},{taskVersion:2147483648},{taskVersion:1,provider:'evil'}]){
  assert.ok((await validate(plainToInstance(CancelExecutionDto,value),{whitelist:true,forbidNonWhitelisted:true})).length);
 }
 assert.equal((await validate(plainToInstance(CancelExecutionDto,{taskVersion:1}))).length,0);
});

test('T11 synchronous controller relays disconnect and timeout, removing all owned listeners and timers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const timeout of [false,true]){
  const req=request(),res=response();let observed;
  const controller=new RuntimeApiController({execute:async(_id,_version,signal)=>{observed=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const pending=controller.execute(req.params.taskId,'"1"',req,res);
  if(timeout)t.mock.timers.tick(HTTP_EXECUTION_TIMEOUT_MS);else res.emit('close');
  await assert.rejects(pending,e=>e.code===(timeout?'DEADLINE_EXCEEDED':'CANCELLED'));
  assert.equal(observed.aborted,true);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
 }
 const req=request(),res=response();const controller=new RuntimeApiController({execute:async()=>({kind:'finished'})});
 assert.deepEqual(await controller.execute(req.params.taskId,'"2"',req,res),{kind:'finished'});
 assert.equal(res.listenerCount('close'),0);await assert.rejects(controller.execute(req.params.taskId,undefined,req,res),e=>e.getStatus()===400);
});

test('T11 runtime error filter emits closed safe codes and preserves the existing error envelope',()=>{
 for(const [code,status] of Object.entries({INVALID_INPUT:400,ACCESS_DENIED:403,CAPACITY_EXCEEDED:409,CANCELLED:409,
  DEADLINE_EXCEEDED:504,PROVIDER_AUTH_FAILED:502,PROVIDER_RATE_LIMITED:429,PERSISTENCE_UNAVAILABLE:503})){
  assert.equal(runtimeHttpStatus(code),status);let sent;
  const res={status:n=>{assert.equal(n,status);return res;},json:value=>{sent=value;}};
  new RuntimeApiFilter().catch(new RuntimeError(code),{switchToHttp:()=>({getRequest:()=>({requestId:'safe-id'}),getResponse:()=>res})});
  assert.equal(sent.code,code);assert.equal(sent.requestId,'safe-id');assert.equal(Object.hasOwn(sent,'stack'),false);
 }
});

test('T11 request context isolates concurrent structured logs and cannot be replaced by supplied log fields',async t=>{
 const writes=[];t.mock.method(process.stdout,'write',chunk=>{writes.push(JSON.parse(chunk));return true;});
 const entered=deferred(),release=deferred(),logger=new ApiLogger();
 const a=requestContext.run({requestId:'request-A'},async()=>{entered.resolve();await release.promise;logger.info('runtime.started',{requestId:'forged'});});
 await entered.promise;await requestContext.run({requestId:'request-B'},async()=>{await Promise.resolve();logger.info('runtime.completed',{durationMs:2});});
 release.resolve();await a;
 assert.deepEqual(writes.map(v=>v.requestId),['request-B','request-A']);assert.equal(requestContext.getStore(),undefined);
});

test('T11 scoped runtime measurements reject prompts, credentials, invalid labels and excessive durations',async()=>{
 const f=fixture();f.context.logger.info('provider.started',{providerId:'ollama'});f.context.logger.info('tool.completed',{toolId:'calculator',durationMs:1});
 for(const fields of [{prompt:'private'},{apiKey:'private'},{providerId:'http://evil.invalid'},{toolId:'shell command'},{durationMs:Infinity}])
  assert.throws(()=>f.context.logger.info('provider.completed',fields),e=>e.code==='INVALID_INPUT');
 assert.ok(!JSON.stringify(f.logs).includes('private'));assert.equal(f.logs[0][1].executionId,f.ids.executionId);
});

test('T11 API service resolves the owned Task and allowlist before invoking the existing coordinator',async()=>{
 const taskId=randomUUID(),agentId=randomUUID(),orchestratorId=randomUUID(),c=config();let calls=0;
 const service=new RuntimeApiService(c,{}, {get:async()=>({id:taskId,agentId,orchestratorId,status:'CREATED'})},
  {executeTask:async command=>{calls++;assert.equal(command.taskId,taskId);return {kind:'finished',task:{status:'COMPLETED'},execution:{},result:{safe:true}};}},{},{info(){}});
 await assert.rejects(service.execute(taskId,1,new AbortController().signal),e=>e.code==='ACCESS_DENIED');assert.equal(calls,0);
 c.value.runtime.bindings.push({agentId,orchestratorId});service.latest=async()=>undefined;
 assert.equal((await service.execute(taskId,1,new AbortController().signal)).result.safe,true);assert.equal(calls,1);
});

test('T11 disabled/default and production applications never expose anonymous runtime controls',async()=>{
 for(const env of [{},{NODE_ENV:'production',CORS_ORIGINS:'https://example.com'}]){
  const app=await closedApplication(env);try{
   await app.listen(0,'127.0.0.1');const url=await app.getUrl(),id=randomUUID();
   for(const path of [`tasks/${id}/execute`,`tasks/${id}/executions/${id}/cancel`,`tasks/${id}/status`,`tasks/${id}/executions/${id}/result`]){
    const r=await fetch(`${url}/api/v1/${path}`,path.endsWith('/execute')||path.endsWith('/cancel')?{method:'POST',headers:{'content-type':'application/json'},body:'{}'}:{});
    assert.equal(r.status,404);
   }
  }finally{await app.close();}
 }
});

test('T11 telemetry backend failure cannot turn a validated strategy result into a lifecycle failure',async()=>{
 const f=fixture();f.factory.logger.info=()=>{throw new Error('private logging transport unavailable');};
 f.factory.logger.error=()=>{throw new Error('private logging transport unavailable');};
 f.context.logger.error('CANCELLED');const result=await f.run();assert.equal(result.output.text,'Safe final answer');
});
