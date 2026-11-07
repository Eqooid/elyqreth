const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,dirname,resolve,basename}=require('node:path');const {rootCertificates}=require('node:tls');
const {loadConfiguration,validateEnvironment}=require('../dist/config/configuration');const {resolveFileInputs}=require('../dist/config/file-inputs');const {ReadinessService}=require('../dist/health/readiness.service');const {internalProbe}=require('../dist/health/readiness-access');
const cleanup=dir=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.match(basename(dir),/^elyqreth-(file-input|ca-input)-/);rmSync(dir,{recursive:true,force:true});};
const url='postgresql://app:synthetic-private-fixture@db.invalid/elyqreth';
test('file inputs are backend-only bounded copies with no ambiguous environment fallback or process mutation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'elyqreth-file-input-'));try{const path=join(dir,'database');writeFileSync(path,url+'\n',{mode:0o600});
  const source={NODE_ENV:'test',DATABASE_URL_FILE:path};const out=resolveFileInputs(source);assert.equal(out.DATABASE_URL,url);assert.equal(source.DATABASE_URL,undefined);
  const config=loadConfiguration(source,join(dir,'absent'));assert.equal(config.database.host,'db.invalid');assert.ok(!JSON.stringify(config).includes('synthetic-private-fixture'));
  assert.throws(()=>resolveFileInputs({...source,DATABASE_URL:url}),e=>!e.message.includes(url)&&!e.message.includes(dir));
  for(const value of ['', 'x'.repeat(65537),'\0',Buffer.from([0xff])]){writeFileSync(path,value);assert.throws(()=>resolveFileInputs(source));}
  writeFileSync(path,url);assert.throws(()=>resolveFileInputs({...source,DATABASE_URL_FILE:'relative/path'}));assert.throws(()=>resolveFileInputs({...source,NODE_ENV:'production'}));
  const key=join(dir,'provider');writeFileSync(key,'synthetic-provider-key\n');assert.equal(resolveFileInputs({OPENAI_API_KEY_FILE:key}).OPENAI_API_KEY,'synthetic-provider-key');assert.equal(resolveFileInputs({EXTERNAL_SECRET_REFERENCE_FILE:key}).EXTERNAL_SECRET_REFERENCE,'synthetic-provider-key');
 }finally{cleanup(dir);}
});
test('database CA loading rejects invalid content and TLS downgrade; diagnostics never include URL or file contents',()=>{
 const dir=mkdtempSync(join(tmpdir(),'elyqreth-ca-input-'));try{const path=join(dir,'ca.pem');writeFileSync(path,rootCertificates[0],{mode:0o600});
  const config=validateEnvironment({DATABASE_URL:url,DATABASE_SSL_MODE:'verify-full',DATABASE_SSL_CA_FILE:path});assert.ok(config.database.ca.includes('BEGIN CERTIFICATE'));assert.ok(!JSON.stringify(config.database).includes('BEGIN CERTIFICATE'));
  assert.throws(()=>validateEnvironment({DATABASE_URL:url,DATABASE_SSL_CA_FILE:path}));for(const text of ['synthetic-private-value',rootCertificates[0]+'\nprivatejunk','-----BEGIN PRIVATE KEY-----']){writeFileSync(path,text);assert.throws(()=>validateEnvironment({DATABASE_URL:url,DATABASE_SSL_MODE:'verify-full',DATABASE_SSL_CA_FILE:path}),e=>!e.message.includes(text)&&!e.message.includes(dir));}
 }finally{cleanup(dir);}
});
test('readiness accepts only exact local peers and ignores forwarded address assertions',()=>{
 const probe=(ip,extra={})=>({path:'/ready',method:'GET',socket:{remoteAddress:ip},...extra});assert.equal(internalProbe(probe('127.0.0.1')),true);
 for(const ip of ['172.18.0.2','203.0.113.4',undefined])assert.equal(internalProbe(probe(ip,{headers:{'x-forwarded-for':'127.0.0.1',host:'localhost'}})),false);
 assert.equal(internalProbe(probe('127.0.0.1',{method:'POST'})),false);
});
test('readiness is bounded coalesced and unavailable before bootstrap or during drain without optional provider calls',async()=>{
 let calls=0,finish;const db={checkReadiness:()=>{calls++;return new Promise(r=>finish=r);}},logs=[];const service=new ReadinessService(db,{value:{nodeEnv:'test'}},{info:(...args)=>logs.push(args)});
 try{assert.equal(await service.ready(),false);await service.onApplicationBootstrap();service.markServing();const a=service.ready(),b=service.ready();assert.equal(calls,1);finish(true);assert.deepEqual(await Promise.all([a,b]),[true,true]);service.drain();assert.equal(await service.ready(),false);assert.equal(logs.filter(v=>v[0]==='api_draining').length,1);assert.equal(logs.filter(v=>v[0]==='readiness.changed').length,2);}finally{service.onApplicationShutdown();}
 const unavailable=new ReadinessService({checkReadiness:async()=>false},{value:{nodeEnv:'production'}},{info(){}});await assert.rejects(unavailable.onApplicationBootstrap(),e=>!e.message.includes('db.invalid'));unavailable.onApplicationShutdown();
});
test('container compatibility launcher never synthesizes unverified production database configuration',()=>{
 const {databaseEnvironment}=require('../../../docker/api-start.cjs');const production={NODE_ENV:'production',POSTGRES_PASSWORD:'synthetic-only'};databaseEnvironment(production);assert.equal(production.DATABASE_URL,undefined);
 const development={NODE_ENV:'development',POSTGRES_PASSWORD:'synthetic-only'};databaseEnvironment(development);assert.ok(development.DATABASE_URL.startsWith('postgresql:'));
});

test('initialization-only maintenance commands do not emit HTTP drain logs into machine-readable stdout',async()=>{
 const logs=[],service=new ReadinessService({checkReadiness:async()=>true},{value:{nodeEnv:'test'}},{info:(...args)=>logs.push(args)});
 try{await service.onApplicationBootstrap();service.onModuleDestroy();assert.equal(service.isDraining,true);assert.deepEqual(logs,[]);}finally{service.onApplicationShutdown();}
});

test('production rejects compressed request bodies before optional decoder or authentication work',async()=>{
 const {closedApplication}=require('./helpers/production-configuration.cjs');const app=await closedApplication({NODE_ENV:'production'});
 try{await app.listen(0,'127.0.0.1');const origin=await app.getUrl();for(const encoding of ['br','gzip','deflate','br, gzip']){const response=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':encoding},body:'not compressed and must never reach a decoder'});assert.equal(response.status,415);assert.ok(!(await response.text()).includes('not compressed'));}}finally{await app.close();}
});

test('readiness cache expires against monotonic time even when the system wall clock moves backwards',async({mock})=>{
 let healthy=true;const service=new ReadinessService({checkReadiness:async()=>healthy},{value:{nodeEnv:'test'}},{info(){}});
 try{await service.onApplicationBootstrap();assert.equal(await service.ready(),true);healthy=false;mock.method(Date,'now',()=>0);await new Promise(r=>setTimeout(r,1100));assert.equal(await service.ready(),false);}finally{mock.restoreAll();service.onApplicationShutdown();}
});

test('HTTP header budget accommodates approved bearer length without accepting unbounded headers',async()=>{
 const {createApplication}=require('../dist/application');
 const app=await createApplication(validateEnvironment({NODE_ENV:'test'}));
 try{await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address(),url='http://127.0.0.1:'+address.port+'/unknown-route';
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+'a'.repeat(16384)}})).status,404);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+'a'.repeat(25000)}})).status,431);
 }finally{await app.close();}
});
