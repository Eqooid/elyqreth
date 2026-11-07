require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {ApiLogger}=require('../dist/common/api-logger'),{requestContext,bindRequestSecrets}=require('../dist/common/request-context');
async function capture(t,run){const lines=[];for(const stream of [process.stdout,process.stderr]){const original=stream.write.bind(stream);t.mock.method(stream,'write',(value,...args)=>{
 if(typeof value==='string'&&value.startsWith('{')){lines.push(value);return true;}return original(value,...args);
 });}
 try{await run();}finally{t.mock.restoreAll();}return lines.flatMap(line=>line.trim().split('\n')).filter(Boolean).map(line=>JSON.parse(line));}
test('T11 closed log fields protect envelope, configured credentials, request tokens, cookies and payloads without invoking getters',async t=>{
 const secret='synthetic-private-db-password',session='synthetic-private-session',cookie='synthetic-private-cookie',provider='synthetic-provider-key';let touched=false;
 const logger=new ApiLogger({value:{nodeEnv:'test',database:{password:secret},registry:{token:provider}}});
 const context=Object.freeze({requestId:'owned-request'});bindRequestSecrets(context,'Bearer '+session,'session='+cookie);
 const fields={timestamp:'forged',level:'debug',service:'attacker',environment:'forged',event:'attacker.event',requestId:'forged-request',taskId:randomUUID(),route:'/api/v1/tasks/:taskId',
  operation:provider,code:session,audience:cookie,headers:{authorization:'Bearer '+session},body:{password:secret},error:new Error(secret),get outcome(){touched=true;return secret;}};
 const lines=await capture(t,()=>requestContext.run(context,()=>logger.info('http_request',fields)));
 assert.equal(touched,false);assert.equal(lines.length,1);assert.equal(lines[0].event,'http_request');assert.equal(lines[0].level,'info');assert.equal(lines[0].service,'elyqreth-api');
 assert.equal(lines[0].environment,'test');assert.equal(lines[0].requestId,'owned-request');assert.equal(lines[0].taskId,fields.taskId);
 for(const value of [secret,session,cookie,provider,'attacker','forged'])assert.ok(!JSON.stringify(lines).includes(value));
 assert.equal(lines[0].body,undefined);assert.equal(lines[0].error,undefined);
});
test('T11 logger rejects arbitrary event dimensions and nested/cyclic/toJSON data, and isolates sink failure',async t=>{
 const logger=new ApiLogger(),cycle={};cycle.self=cycle;let called=false;
 const lines=await capture(t,()=>{logger.error('user_supplied_event_123',{code:cycle,headers:{toJSON(){called=true;throw Error();}},durationMs:NaN});});
 assert.equal(lines[0].event,'telemetry.rejected');assert.equal(lines[0].code,undefined);assert.equal(called,false);
 const context=Object.freeze({requestId:'cookie-event'});bindRequestSecrets(context,undefined,'sid=http_request');
 const preserved=await capture(t,()=>requestContext.run(context,()=>logger.info('http_request',{statusCode:401})));
 assert.equal(preserved[0].event,'http_request');assert.equal(preserved[0].statusCode,401);
 const startup=await capture(t,()=>logger.error('startup_failed',{message:'Invalid API configuration: LLM_PROFILES/budgets, .env'}));
 assert.equal(startup[0].message,'Invalid API configuration: LLM_PROFILES/budgets, .env');
 t.mock.method(process.stdout,'write',()=>{throw Error('sink unavailable');});assert.doesNotThrow(()=>logger.info('runtime.started'));t.mock.restoreAll();
});
test('T11 asynchronous request contexts do not cross-contaminate correlation',async t=>{
 const logger=new ApiLogger();const lines=await capture(t,()=>Promise.all(Array.from({length:20},(_,i)=>requestContext.run(Object.freeze({requestId:'request-'+i}),async()=>{
  await new Promise(r=>setImmediate(r));logger.info('runtime.requested',{taskId:randomUUID()});logger.info('runtime.conflict',{code:'CAPACITY_EXCEEDED'});
 }))));
 assert.equal(lines.length,40);for(let i=0;i<20;i++)assert.equal(lines.filter(v=>v.requestId==='request-'+i).length,2);
});
test('T11 private readiness diagnostics classify bounded dependency transitions without repeating identical logs',async t=>{
 const {ReadinessService}=require('../dist/health/readiness.service'),{performance}=require('node:perf_hooks');let clock=0,mode='ready',queries=0;const logs=[];
 t.mock.method(performance,'now',()=>clock);
 const database={diagnostics:()=>({configured:true,total:2,idle:1,waiting:1}),async checkReadiness(){queries++;if(mode==='permission')throw {code:'42501',message:'private connection string'};return mode==='ready';}};
 const service=new ReadinessService(database,{value:{nodeEnv:'test',database:{}}},{info:(...args)=>logs.push(args)});
 try{await service.onApplicationBootstrap();service.markServing();assert.equal(await service.ready(),true);const count=logs.length;assert.equal(await service.ready(),true);assert.equal(logs.length,count);assert.equal(queries,1);
  mode='permission';clock=2000;assert.equal(await service.ready(),false);assert.equal(service.snapshot().dependency,'DATABASE_PERMISSION');
  mode='schema';clock=4000;assert.equal(await service.ready(),false);assert.equal(service.snapshot().dependency,'SCHEMA_INCOMPATIBLE');
  mode='ready';clock=6000;assert.equal(await service.ready(),true);assert.equal(service.snapshot().database.waiting,1);assert.ok(!JSON.stringify(logs).includes('private connection'));
 }finally{service.onApplicationShutdown();t.mock.restoreAll();}
});
test('T11 real HTTP logs omit query and request credentials, and private diagnostics retain health contracts',async t=>{
 const {createApplication}=require('../dist/application'),{validateEnvironment}=require('../dist/config/configuration');
 const app=await createApplication(validateEnvironment({NODE_ENV:'test'}));let logs;
 try{await app.listen(0,'127.0.0.1');const origin=await app.getUrl();logs=await capture(t,async()=>{
  const r=await fetch(origin+'/unknown?access_token=private-query-marker',{headers:{Authorization:'Bearer opaque-session-marker',Cookie:'sid=opaque-cookie-marker','X-Request-Id':'opaque-session-marker'}});assert.equal(r.status,404);await r.text();
  const diagnostic=await fetch(origin+'/ready?diagnostics=true');assert.equal(diagnostic.status,200);const body=await diagnostic.json();assert.equal(body.readiness.database.configured,false);assert.equal(body.runtime.state,'READY');
 });
 const encoded=JSON.stringify(logs);for(const value of ['private-query-marker','opaque-session-marker','opaque-cookie-marker'])assert.ok(!encoded.includes(value));
 const request=logs.find(v=>v.event==='http_request');assert.equal(request.route,'unmatched');
 }finally{await app.close();}
});
