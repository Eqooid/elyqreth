const {test}=require('node:test'),assert=require('node:assert/strict');const {createApplication}=require('../dist/application');const {validateEnvironment}=require('../dist/config/configuration');const {ReadinessService}=require('../dist/health/readiness.service');
module.exports=({getUrl,getPool})=>{
 test('T05 real HTTP readiness checks persisted schema compatibility, recovers after drift correction and rejects work while draining',async()=>{
  const app=await createApplication(validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable'}));let original;
  try{await app.listen(0,'127.0.0.1');const origin=await app.getUrl(),read=async path=>(await fetch(origin+path)).status;
   assert.equal(await read('/health'),200);assert.equal(await read('/ready'),200);
   const diagnostic=await (await fetch(origin+'/ready?diagnostics=true')).json();assert.equal(diagnostic.readiness.database.configured,true);assert.equal(typeof diagnostic.readiness.database.waiting,'number');assert.ok(!JSON.stringify(diagnostic).includes('postgresql:'));assert.equal(diagnostic.readiness.database.host,undefined);
   original=(await getPool().query('SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1')).rows[0];await getPool().query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',['f'.repeat(64),original.id]);await new Promise(r=>setTimeout(r,1100));assert.equal(await read('/ready'),503);assert.equal(await read('/health'),200);
   assert.equal((await (await fetch(origin+'/ready?diagnostics=true')).json()).readiness.dependency,'SCHEMA_INCOMPATIBLE');
   await getPool().query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',[original.hash,original.id]);await new Promise(r=>setTimeout(r,1100));assert.equal(await read('/ready'),200);
   app.get(ReadinessService).drain();assert.equal(await read('/ready'),503);assert.equal(await read('/api/v1/agents'),503);assert.equal(await read('/health'),200);
  }finally{if(original)await getPool().query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',[original.hash,original.id]);await app.close();}
 });
};
